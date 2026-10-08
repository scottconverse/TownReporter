/**
 * Stage 2 — the Dark Signal Desk.
 *
 * The Black Desk (stage 1, `synthesizeSignals` in dark.ts) files speculative
 * signals capped at 0.5. This stage records adversarial searches and review
 * questions for the editor. It does not decide whether a lead may remain open
 * or move to the working queue.
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
import { grokChat, parseJsonBlock, plannerModel, providerBudget, type EffectiveProviderChoice } from "./ai.ts";
import type { ModelEffort, ProviderOverrides } from "./provider-registry.ts";
import { searchWithFallback } from "./search-web.ts";
import { boilerplatePageReason } from "./result-quality.ts";
import { storableText } from "./storable-text.ts";
import type { WebHit, SearchAttempt } from "./search-web.ts";
import type { DarkRunBudget, DarkRunUsageSnapshot } from "./dark-run-budget.ts";
import { junkQueryReason } from "./extract.ts";
import { queryNamesUngroundedSpecific } from "./dark-specific-grounding.ts";
import { groundingCorpus } from "./investigate.ts";
import {
  DARK_VERIFY_SYSTEM,
  adversarialQueries,
  adversarialSourceRefusalReason,
  newsworthyDecision,
  readGates,
  readNewsworthiness,
  tierForUrl,
  verify,
  type AdversarialRecord,
  type Place,
} from "./dark-gates.ts";

/** Signals reviewed per round. A round that files thirty does not pay for thirty model calls. */
export const VERIFY_PER_ROUND = 6;

export type VerifySearchFn = (query: string) => Promise<WebHit[] | SearchAttempt>;
export type VerifyModelFn = (
  system: string,
  pack: string,
  reasoningEffort?: ModelEffort | null,
) => Promise<string | null>;

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

async function defaultSearch(
  query: string,
  relevance?: { officialDomains: string[]; localityStopwords: string[] },
): Promise<SearchAttempt> {
  return searchWithFallback(
    query,
    undefined,
    relevance
      ? { officialDomains: relevance.officialDomains, localityStopwords: relevance.localityStopwords }
      : undefined,
  );
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
  runBudget?: DarkRunBudget;
  onUsage?: (usage: DarkRunUsageSnapshot) => Promise<unknown>;
  onStage?: (stage: string) => Promise<unknown>;
  reasoningEffort?: ModelEffort | null;
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
  const official = opts.officialDomains ?? [];
  const press = opts.pressDomains ?? [];
  /*
    Unit U25, B2: the app's own search runs with the same relevance contract the
    dig uses, and the same refusal list.

    This used to be `searchWithFallback(query)` with no relevance options at
    all, which returns the FIRST provider's results unfiltered -- so with the
    scraped engines blocked in this environment every adversarial query was
    answered by Bing's raw list, in Bing's order, and the desk wrote the first
    entry down as the source that answered it. On the Kid City USA file that
    was `https://www.youtubekids.com/` for four separate queries: Bing matched
    the word "Kid" in the query and returned the landing page for a children's
    app, and nothing between the provider and the run record asked whether a
    landing page could answer a question about a daycare.

    A reader who supplies `deps.search` (every test, and the live failover
    path) is left exactly as they were.
  */
  const relevance = {
    officialDomains: official,
    localityStopwords: [opts.place.city, opts.place.state, opts.place.county ?? ""].filter(Boolean),
  };
  const search: VerifySearchFn =
    opts.deps?.search ?? ((query: string) => defaultSearch(query, relevance));
  const allSearches: AdversarialRecord[] = [];
  /*
    Every query this round refused to run, with the rule that refused it. The
    lane used to build this list and then drop it on the floor, so a round that
    planned four searches per signal and ran none looked exactly like a round
    that found nothing to search for. It is reported in the summary below.
  */
  const refusedQueries: string[] = [];

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

  /*
    M1 of the pre-merge audit: what this lane judges its own queries against.

    Read once per round, not once per signal, and allowed to fail to null: a
    database that cannot list its captures has not thereby made every specific
    in the round invented, and dropping all four queries per signal on a
    transient read error would turn a working round into a silent no-op. A null
    corpus means the junk filter alone decides, exactly as it did before.
  */
  const grounding = await groundingCorpus(opts.investigationId, opts.newsroomId, opts.place).catch(
    () => null,
  );

  let verified = 0;
  let unverified = 0;
  let unsaved = 0;
  let failed = 0;
  const limit = opts.preferences?.verificationLimit ?? VERIFY_PER_ROUND;
  const selected = rows.slice(0, limit);
  let deferred = rows.length - selected.length;

  signalLoop: for (let signalIndex = 0; signalIndex < selected.length; signalIndex++) {
    const sig = selected[signalIndex]!;
    await opts.onStage?.(`Testing explanations for signal ${signalIndex + 1} of ${selected.length}`);
    /*
      Unit DD1, item 2: the hop lane's junk filter, on this lane too.

      A query this lane plans is one the APP runs, so it passes the same
      `junkQueryReason` gate the hop planner's queries pass. The dropped ones
      are said out loud in the round summary rather than silently skipped, the
      way the hop loop says them.
    */
    /*
      The window operators go on LAST, and that ordering is load-bearing.

      `after:`/`before:` are the DESK's own words, and they carry dates the file
      has no reason to hold -- "2026-06-09" is when this run started looking, not
      something a capture says. Judged as if the model had written them, every
      query in a lookback round would name an ungrounded date and be dropped,
      which is a round that searches nothing and blames the model for it. The
      hop lane applies them after its judgement for exactly this reason
      (`investigate.ts`, the `usable` filter), and this lane now does too.
    */
    const droppedQueries: string[] = refusedQueries;
    const plan = adversarialQueries(sig, opts.place, official)
      .filter((q) => {
        const reason = junkQueryReason(q.query);
        if (reason) {
          droppedQueries.push(`${reason}: ${q.query.slice(0, 120)}`);
          return false;
        }
        /*
          M1 of the pre-merge audit: the grounding rule, on this lane too.

          The hop lane has run `queryNamesUngroundedSpecific` over every query it
          runs since DD1, and this lane did not -- so a signal filed as
          "Operator transition at 1749 Main Street" had that address run against
          a provider four times one stage later. It is the walkthrough's exact
          failure through the door the first fix left open, and the rule is the
          same one: the corpus is the file's captures and the lead, and a query
          naming a specific nothing there carries is not run.

          The corpus is read once for the round, above, so a round does not pay
          for a capture read per signal.
        */
        const invented = grounding ? queryNamesUngroundedSpecific(q.query, grounding) : null;
        if (invented) {
          droppedQueries.push(`names a specific no capture carries (${invented}): ${q.query.slice(0, 120)}`);
          return false;
        }
        return true;
      })
      .map((q) => ({ ...q, query: queryWithResearchWindow(q.query, opts.preferences) }));
    const records: AdversarialRecord[] = [];

    const evidence: string[] = [];
    let trailSaved = true;
    for (const q of plan) {
      if (opts.runBudget && !opts.runBudget.consumeSearch()) {
        deferred += selected.length - signalIndex;
        unverified += selected.length - signalIndex;
        break signalLoop;
      }
      let hits: WebHit[] = [];
      let outcome = "no results found";
      let state: SearchAttempt["state"] = "SEARCH_SUCCESS_ZERO_RESULTS";
      /** Whether the search judged its own results to be on the question. */
      let relevanceDecision: string = "not-evaluated";
      try {
        const attempt = await search(q.query);
        hits = Array.isArray(attempt) ? attempt : attempt.hits;
        relevanceDecision = Array.isArray(attempt)
          ? "not-evaluated"
          : (attempt.relevance?.decision ?? "not-evaluated");
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
      if (opts.runBudget) await opts.onUsage?.(opts.runBudget.snapshot());
      /*
        Unit U25, B2: a result that is not the article does not get to answer
        the query, and the run record says which rule refused it.

        A dictionary entry, an app landing page or another engine's own page is
        never the record a gate was looking for, so it is dropped by name
        (`boilerplatePageReason`) rather than left in the list where the first
        entry becomes "the source". When the search itself judged that nothing
        came back on the question -- `relevance.decision === "degraded"` -- no
        URL is recorded at all: the query ran, and it did not get an answer.
      */
      /*
        Unit DD1, item 2: a page that is not a record does not get to answer the
        query, and the run record says which rule refused it.

        `boilerplatePageReason` names the dictionary, the app landing page and
        the engine's own page; `adversarialSourceRefusalReason` adds the
        reference works -- `en.wikipedia.org/wiki/Childcare` came back as "the
        source" for four of the five verification signals on the Kid City USA
        file, because the query named a childcare closure and the entry is
        titled "Childcare".

        When nothing survives, the query ran and got no answer: no URL is
        recorded at all, and the outcome says so instead of showing the editor a
        page nobody could have used.
      */
      // How many the provider returned, before any rule refused one -- the
      // difference between "the search found nothing" and "the search found
      // pages that are not records", which are two different facts.
      const returned = hits.length;
      const refused: string[] = [];
      hits = hits.filter((h) => {
        const why = boilerplatePageReason(h.url) ?? adversarialSourceRefusalReason(h.url);
        if (why) refused.push(`${why} (${h.url.slice(0, 120)})`);
        return !why;
      });
      const answered = relevanceDecision !== "degraded" && hits.length > 0;
      if (state.startsWith("SEARCH_SUCCESS")) {
        outcome = answered
          ? `${hits.length} result(s)${relevanceDecision === "relevant" ? "" : " (not assessed for relevance)"}`
          : returned && relevanceDecision === "degraded"
            ? `${returned} result(s), none matching the question (kept as candidates, not as an answer)`
            : "no independent source found";
      }
      if (refused.length)
        outcome = `${outcome}; refused ${refused.length}: ${[...new Set(refused)].slice(0, 3).join("; ")}`.slice(
          0,
          500,
        );
      hits = hits.slice(0, 6).map((h) => ({
        url: h.url.slice(0, 1000),
        title: h.title.slice(0, 300),
        snippet: h.snippet.slice(0, 800),
      }));
      const url = answered ? (hits[0]?.url ?? null) : null;
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

      /*
        Logged where every other search this desk runs is logged, so the
        research trail on the open file shows the verification too.

        `q.query` and the research question are MODEL-WRITTEN -- the query came
        out of the model's adversarial plan, the question quotes the signal's
        own name -- and both are `text` columns, so a U+0000 in either fails
        the insert. This one is worse than a failed insert would suggest: the
        `.catch` below turns it into `trailSaved = false`, which downgrades the
        signal to unverified without a word about why. `results_json` and
        `selected_json` are the search provider's own answer, and the
        JSON.stringify there turns any NUL into an escape rather than a byte,
        so the captured-evidence side of this row is left as it is.

        `storableText`, not `postgresText`: the query and the question are what
        the desk generated, not what a page said.
      */
      await sql`
        insert into search_log (
          user_id, newsroom_id, investigation_id, hop, query, results_json,
          provider, state, strategy, tier, research_question, selected_json
        ) values (
          ${opts.userId}, ${opts.newsroomId}, ${opts.investigationId}, ${0},
          ${storableText(q.query).slice(0, 300)},
          ${JSON.stringify(hits)},
          ${"adversarial"},
          ${state},
          ${`adversarial:${q.kind}`}, ${record.tier},
          ${storableText(`Gate 2 — ${q.kind}: disprove "${sig.name}"`).slice(0, 300)},
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
      `BENIGN EXPLANATION AS FILED: ${sig.alternatives.slice(0, 1000) || "(none written — say so)"}`,
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
    const modelCall = opts.runBudget?.startModelCall({
      stage: `verification signal ${signalIndex + 1}`,
      /*
        Production verification runs through a failover callback, so testing
        `deps.model` and calling every such call "injected" recorded live
        provider work as a test double - runs 5 and 7 of 2026-09-16 both show
        it. Name the editor's actual choice; only an unknown transport falls
        back to "injected".
      */
      provider: opts.choice ?? "injected",
      model: opts.choice ? plannerModel(opts.choice) || opts.choice : "injected",
    });
    if (opts.runBudget && !modelCall) {
      deferred += selected.length - signalIndex;
      unverified += selected.length - signalIndex;
      break;
    }
    if (modelCall) await opts.onUsage?.(opts.runBudget!.snapshot());
    try {
      if (opts.deps?.model) {
        text = await opts.deps.model(DARK_VERIFY_SYSTEM, pack, opts.reasoningEffort);
        modelCall?.finish({ result: text ? "ok" : "error" });
      }
      else {
        const callMs = providerBudget(opts.choice, opts.overrides).callMs;
        const ai = await grokChat(DARK_VERIFY_SYSTEM, pack, 1400, {
          timeoutMs: Math.max(1, Math.min(callMs, opts.runBudget?.remainingMs() ?? callMs)),
          choice: opts.choice,
          newsroomId: opts.newsroomId,
          localModel: opts.overrides?.["local-model"]?.localModel,
          // Stage 2 reads what the app already fetched. It never searches.
          noTools: true,
          reasoningEffort: opts.reasoningEffort,
        });
        modelCall?.finish({
          result: ai?.ok ? "ok" : "error",
          durationMs: ai?.meta?.durationMs,
          timedOut: ai?.meta?.timedOut ?? false,
          provider: ai?.meta?.provider,
          model: ai?.meta?.model,
          inputTokens: ai?.meta?.inputTokens,
          outputTokens: ai?.meta?.outputTokens,
          totalTokens: ai?.meta?.totalTokens,
          costDollars: ai?.meta?.costDollars,
        });
        if (!ai?.ok) throw new Error(ai && "error" in ai ? ai.error : "empty model response");
        text = ai.text;
      }
    } catch (error) {
      modelCall?.finish({ result: "error" });
      throw error;
    }
    if (opts.runBudget) await opts.onUsage?.(opts.runBudget.snapshot());

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

    /*
      `counter_narrative` is the verification model's own sentence about the
      opposing account, falling back to the stage-1 text when the model wrote
      none. Model prose into a `text` column, so a U+0000 in it fails this
      UPDATE -- which the `.catch` below turns into `saved = false` and an
      `unsaved` count, losing a verification that did happen.
      `adversarial_json` and `newsworthiness_json` beside it are
      JSON.stringify'd text columns, where the same byte survives as an escape
      and nothing in this repository casts them back to jsonb.

      `storableText`: the model wrote it. See storable-text.ts.
    */
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
        counter_narrative = ${storableText(
          String(parsed.counter_narrative ?? sig.counter_narrative ?? ""),
        ).slice(0, 4000)},
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

  const refused = [...new Set(refusedQueries)].slice(0, 4);
  const summary = rows.length
    ? `Adversarial review: ${verified} of ${rows.length} eligible signal(s) completed the four-question protocol. Attempted ${selected.length} with ${allSearches.length} searches; ${unverified} remain protocol-incomplete (${failed} encountered failures). ${deferred} saved for a later review round.` +
      (refusedQueries.length
        ? ` ${refusedQueries.length} planned query/queries were not run: ${refused.join("; ")}`
        : "")
    : "Adversarial review: no new signals to check this round.";

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
        ? ` ${unsaved} review result(s) could not be saved; retry the review.`
        : "") +
      (!runSaved ? " The round search summary could not be saved." : ""),
  };
}
