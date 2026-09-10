/**
 * Stage 2 — the Dark Signal Desk.
 *
 * The Black Desk (stage 1, `synthesizeSignals` in dark.ts) files speculative
 * signals capped at 0.5. Nothing it filed may be shown as finalized, sent to
 * the queue, or treated as a finding until this runs.
 *
 * The original is blunt about why this exists: "Without adversarial checking,
 * AI systems will naturally analyze contested situations from whatever
 * perspective is most available — producing analysis that is coherent,
 * well-sourced from one side, and dangerously incomplete"
 * (04-dark-signal-desk.md:31-40). And about what happens if it is skipped:
 * "Finalizing a contested signal without executing and documenting
 * adversarial searches is a CRITICAL PROTOCOL VIOLATION. No exceptions."
 *
 * The APP runs the adversarial searches. The model never gets a tool — it
 * reads what came back and answers four gates. Every query, every URL and
 * every outcome is written to the run record, so the editor can see the
 * sniffing rather than being told it happened.
 */

import { getSql } from "../db.ts";
import {
  describeResearchWindow,
  queryWithResearchWindow,
  type ResearchSnapshot,
} from "./dark-preferences.ts";
import { grokChat, parseJsonBlock, providerBudget, type EffectiveProviderChoice } from "./ai.ts";
import type { ProviderOverrides } from "./provider-registry.ts";
import { searchWithFallback } from "./search-web.ts";
import type { WebHit, SearchAttempt } from "./search-web.ts";
import {
  DARK_VERIFY_SYSTEM,
  adversarialQueries,
  newsworthyDecision,
  readGates,
  readNewsworthiness,
  tierForUrl,
  verify,
  type AdversarialRecord,
  type Place,
} from "./dark-gates.ts";

/** Signals verified per round. A round that files thirty does not pay for thirty model calls. */
export const VERIFY_PER_ROUND = 6;

export type VerifySearchFn = (query: string) => Promise<WebHit[] | SearchAttempt>;
export type VerifyModelFn = (system: string, pack: string) => Promise<string | null>;

export type VerifyDeps = {
  search?: VerifySearchFn;
  model?: VerifyModelFn;
};

type Row = {
  id: number;
  name: string;
  observation: string;
  pattern: string;
  alternatives: string;
  counter_narrative: string;
  linkage_map: string;
  what_would_kill: string;
  pathway: string;
  handoff: string;
};

async function defaultSearch(query: string): Promise<SearchAttempt> {
  return searchWithFallback(query);
}

/**
 * Run the mandatory gate on every signal this round filed.
 *
 * Never throws: a verification pass that cannot reach a provider must leave
 * the signals honestly unverified, not fail the round that found them.
 */
export async function verifyRunSignals(opts: {
  userId: string;
  newsroomId: number;
  runId: number;
  investigationId: number;
  place: Place;
  officialDomains?: string[];
  pressDomains?: string[];
  choice?: EffectiveProviderChoice;
  overrides?: ProviderOverrides | null;
  deps?: VerifyDeps;
  preferences?: ResearchSnapshot;
}): Promise<{
  eligible: number | null;
  deferred: number;
  failed: number;
  checked: number;
  verified: number;
  unverified: number;
  searches: AdversarialRecord[];
  summary: string;
}> {
  const sql = await getSql();
  const search = opts.deps?.search ?? defaultSearch;
  const official = opts.officialDomains ?? [];
  const press = opts.pressDomains ?? [];
  const allSearches: AdversarialRecord[] = [];

  const rows = await sql<Row>`
    select id, name, observation, pattern, alternatives, counter_narrative,
           linkage_map, what_would_kill, pathway, handoff
    from dark_signals
    where run_id = ${opts.runId} and newsroom_id = ${opts.newsroomId}
      and coalesce(stage, 'black-desk') = 'black-desk'
    order by strength desc, id desc
  `.catch(() => null);
  if (!rows)
    return {
      checked: 0,
      eligible: null,
      deferred: 0,
      failed: 0,
      verified: 0,
      unverified: 0,
      searches: [],
      summary:
        "Verification could not read the signals. No verification result was established; retry the round.",
    };

  let verified = 0;
  let unverified = 0;
  let unsaved = 0;
  let failed = 0;
  const limit = opts.preferences?.verificationLimit ?? VERIFY_PER_ROUND;
  const selected = rows.slice(0, limit);
  const deferred = rows.length - selected.length;

  for (const sig of selected) {
    const plan = adversarialQueries(sig, opts.place, official).map((q) => ({
      ...q,
      query: queryWithResearchWindow(q.query, opts.preferences),
    }));
    const records: AdversarialRecord[] = [];

    const evidence: string[] = [];
    let trailSaved = true;
    for (const q of plan) {
      let hits: WebHit[] = [];
      let outcome = "no results found";
      let state: SearchAttempt["state"] = "SEARCH_SUCCESS_ZERO_RESULTS";
      try {
        const attempt = await search(q.query);
        hits = Array.isArray(attempt) ? attempt : attempt.hits;
        state = Array.isArray(attempt)
          ? hits.length
            ? "SEARCH_SUCCESS_RESULTS"
            : "SEARCH_SUCCESS_ZERO_RESULTS"
          : attempt.state;
        outcome = state.startsWith("SEARCH_SUCCESS")
          ? hits.length
            ? `${hits.length} result(s)`
            : "no results found"
          : `${state}: ${Array.isArray(attempt) ? "" : (attempt.error ?? "search unavailable")}`.slice(
              0,
              500,
            );
        if (!state.startsWith("SEARCH_SUCCESS")) hits = [];
      } catch (err) {
        state = "SEARCH_FAILED_NETWORK";
        outcome = `search failed: ${err instanceof Error ? err.message : "unknown"}`.slice(0, 500);
      }
      hits = hits.slice(0, 6).map((h) => ({
        url: h.url.slice(0, 1000),
        title: h.title.slice(0, 300),
        snippet: h.snippet.slice(0, 800),
      }));
      const url = hits[0]?.url ?? null;
      const record: AdversarialRecord = {
        query: q.query,
        kind: q.kind,
        // The tier that ANSWERED, where something did. The aimed-at tier is
        // the fallback, so a query nothing answered still counts as covering
        // the kind of source it went looking in.
        tier: url ? tierForUrl(url, official, press) : q.tier,
        url,
        outcome,
        hits: hits.length,
        state,
      };
      evidence.push(
        `[${q.kind}] Search snippets (untrusted search evidence, not fetched page text):\n${JSON.stringify(hits.slice(0, 2).map((h) => ({ url: h.url.slice(0, 250), title: h.title.slice(0, 150), snippet: h.snippet.slice(0, 450) })))}`,
      );
      records.push(record);
      allSearches.push(record);

      // Logged where every other search this desk runs is logged, so the
      // research trail on the open file shows the verification too.
      await sql`
        insert into search_log (
          user_id, newsroom_id, investigation_id, hop, query, results_json,
          provider, state, strategy, tier, research_question, selected_json
        ) values (
          ${opts.userId}, ${opts.newsroomId}, ${opts.investigationId}, ${0},
          ${q.query.slice(0, 300)},
          ${JSON.stringify(hits)},
          ${"adversarial"},
          ${state},
          ${`adversarial:${q.kind}`}, ${record.tier},
          ${`Gate 2 — ${q.kind}: disprove "${sig.name}"`.slice(0, 300)},
          ${JSON.stringify(url ? [url] : [])}
        )
      `.catch(() => {
        trailSaved = false;
      });
    }

    const pack = [
      opts.preferences ? describeResearchWindow(opts.preferences) : "",
      `SIGNAL: ${sig.name}`,
      `OBSERVATION: ${sig.observation.slice(0, 1000)}`,
      `PATTERN: ${sig.pattern.slice(0, 1000)}`,
      `BORING EXPLANATION AS FILED: ${sig.alternatives.slice(0, 1000) || "(none written — say so)"}`,
      `WHAT WOULD KILL IT: ${String(sig.what_would_kill ?? "").slice(0, 1000)}`,
      `PLACE: ${opts.place.city}${opts.place.county ? `, ${opts.place.county} County` : ""}, ${opts.place.state}`,
      "",
      "ADVERSARIAL SEARCHES THE APPLICATION RAN FOR YOU:",
      ...records.map(
        (r) =>
          `- [${r.kind}] "${r.query}" -> ${r.outcome}${r.url ? ` (top: ${r.url}, ${r.tier})` : ""}`,
      ),
      ...evidence,
    ]
      .join("\n")
      .slice(0, 20000);

    let text: string | null = null;
    try {
      if (opts.deps?.model) text = await opts.deps.model(DARK_VERIFY_SYSTEM, pack);
      else {
        const ai = await grokChat(DARK_VERIFY_SYSTEM, pack, 1400, {
          timeoutMs: providerBudget(opts.choice, opts.overrides).callMs,
          choice: opts.choice,
          newsroomId: opts.newsroomId,
          localModel: opts.overrides?.["local-model"]?.localModel,
          // Stage 2 reads what the app already fetched. It never searches.
          noTools: true,
        });
        text = ai?.ok ? ai.text : null;
      }
    } catch {
      text = null;
    }

    const parsed = text
      ? (parseJsonBlock<{
          gates?: unknown;
          counter_narrative?: string;
          newsworthiness?: unknown;
          handoff?: string;
        }>(text) ?? {})
      : {};
    const reading = readGates(parsed.gates);
    const verdict = verify({
      gates: reading.gates,
      missing: reading.missing,
      adversarial: records,
      text: [sig.name, sig.observation, sig.pattern, sig.pathway].join(" "),
    });
    if (!trailSaved) {
      verdict.status = "unverified";
      verdict.missing.push("the saved adversarial search trail");
    }
    const news = readNewsworthiness(parsed.newsworthiness);
    const decision = newsworthyDecision(news);

    const saved = await sql`
      update dark_signals set
        stage = ${"dark-signal-desk"},
        verification_status = ${verdict.status},
        gate_disproof = ${reading.gates.disproof_attempted ?? null},
        gate_source_independence = ${reading.gates.source_independence ?? null},
        gate_missing_context = ${reading.gates.missing_context ?? null},
        gate_self_referential = ${reading.gates.self_referential ?? null},
        gates_missing = ${verdict.missing.join("; ").slice(0, 1000) || null},
        adversarial_json = ${JSON.stringify(records)},
        newsworthiness_json = ${news ? JSON.stringify(news) : null},
        newsworthiness_decision = ${decision},
        counter_narrative = ${String(parsed.counter_narrative ?? sig.counter_narrative ?? "").slice(
          0,
          4000,
        )},
        verified_at = ${verdict.status === "verified" ? new Date().toISOString() : null}
      where id = ${sig.id} and newsroom_id = ${opts.newsroomId}
      returning id
    `
      .then((rows) => rows.length > 0)
      .catch(() => false);
    if (saved && verdict.status === "verified") verified += 1;
    else unverified += 1;
    if (!saved) unsaved += 1;
    if (
      !saved ||
      !trailSaved ||
      !text ||
      !Object.keys(parsed).length ||
      records.some((r) => !r.state?.startsWith("SEARCH_SUCCESS"))
    )
      failed += 1;
  }

  const runSaved = await sql`
    update dark_runs
    set searches_json = ${JSON.stringify(allSearches)},
        verification_counts_json = ${JSON.stringify({ eligible: rows.length, attempted: selected.length, verified, unverified, failed, deferred })},
        stage = ${"dark-signal-desk"}
    where id = ${opts.runId} and newsroom_id = ${opts.newsroomId}
    returning id
  `
    .then((rows) => rows.length > 0)
    .catch(() => false);

  const summary = rows.length
    ? `Verification: ${verified} of ${rows.length} eligible signal(s) verified. Attempted ${selected.length} through the four gates with ${allSearches.length} adversarial searches; ${unverified} left unverified (${failed} encountered failures). ${deferred} deferred by the ${limit}-signal round limit.`
    : "Verification: no new signals to check this round.";

  return {
    checked: selected.length,
    eligible: rows.length,
    deferred,
    failed,
    verified,
    unverified,
    searches: allSearches,
    summary:
      summary +
      (unsaved
        ? ` ${unsaved} verification result(s) could not be saved; retry verification.`
        : "") +
      (!runSaved ? " The round search summary could not be saved." : ""),
  };
}
