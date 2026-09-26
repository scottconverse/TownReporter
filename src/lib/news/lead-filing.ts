import { sanitizePublicUrls } from "./schema.ts";
import {
  findMatchingLead,
  matchStrength,
  newFactsIn,
  normalizeSourceUrl,
  sameStoryForMerge,
  type MatchCandidateLead,
} from "./lead-match.ts";

/**
 * The narrow slice of `Sql` (src/lib/db.ts) this module actually calls: the
 * tagged-template form only. Declared locally, with no `@/lib/db` import, so
 * this file -- and the integration test that exercises `fileScanLeads`
 * directly -- can run under plain `node --test` without a bundler resolving
 * the `@/*` path alias. The real `Sql` interface satisfies this structurally;
 * callers pass their own `getSql()` result straight through.
 */
export interface SqlTag {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}

function parseLeadSourceUrls(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Union two source-URL lists, keeping every URL once, compared the way the
 * matcher compares them (normalizeSourceUrl) so a trailing slash or a `www.`
 * cannot smuggle in a second copy of the same page. Order: the existing lead's
 * URLs first, then anything the second sighting adds -- merging must never
 * drop a source an editor could need. */
function mergeSourceUrls(a: string[], b: string[]): string[] {
  const out = [...a];
  const seen = new Set(a.map(normalizeSourceUrl).filter(Boolean));
  for (const url of b) {
    const key = normalizeSourceUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** One AI-returned lead, as parsed out of the scan model's JSON. */
export type ScanAiLead = {
  headline?: string;
  why?: string;
  topic?: string;
  source_urls?: string[];
  evidence?: string;
  newsworthiness?: number;
  /**
   * True when `topic` is the desk's fallback rather than the section the model
   * named (`parseScanResult`, ./schema.ts). Absent means the model chose the
   * section, which is what every caller written before this flag meant.
   */
  topicUnchosen?: boolean;
};

/**
 * The lead-filing half of `performScanWork` (src/lib/news/desk.ts), pulled
 * out so it can be tested directly against a real scratch database without
 * spinning up a whole scan (fetch sources, call the AI, etc). For every
 * AI-returned lead that `findMatchingLead` (./lead-match.ts) finds is the
 * same story as something already in `existing`, `matchStrength` decides how
 * hard to trust that:
 *
 *   - "strong" -- stamp the existing row's resurfaced columns instead of
 *     inserting a duplicate (the original 0.6.1/0.6.4 behaviour). A killed
 *     match counts toward `resurfacedKilled`, an open (new/held/drafted)
 *     match toward `resurfacedOpen`.
 *   - "possible" (GauntletGate QA-1, round 3) -- lexical overlap real enough
 *     to flag but not strong enough to trust blindly (see matchStrength's
 *     doc comment for why a binary decision merged different agenda items).
 *     The candidate is filed as its own lead, but
 *     with `possible_duplicate_of` pointing at the existing lead so the
 *     editor -- not the matcher -- decides. A possible match to a killed
 *     lead starts held for review, rather than returning to NEW. Other
 *     possible matches start new. Counts toward `possibleMatched`.
 *     The existing row is NOT stamped.
 *   - no match at all -- insert as a plain new lead, same as before this
 *     feature existed.
 *
 * `existing` is mutated in place with each newly-inserted lead so two
 * AI-returned leads that are the same story within one scan don't both get
 * inserted.
 *
 * Unit AK items 1 and AK2 item 2 (2026-09-26) -- that promise used to hold
 * only for the "strong" tier. A pair the matcher flagged as "possible" fell
 * through to the insert below, so one story found twice in one scan run was
 * filed twice: leads 207 and 212, same city page, same second, one of them
 * later published while the other sat on the Queue under a "≈ PRINTED" badge.
 * Any candidate that `sameStoryForMerge` says is the same story as a lead THIS
 * RUN already inserted is now merged into it instead: the later sighting's
 * source URLs are unioned onto the row that already exists, `mergedSameScan`
 * is counted so the scan summary can say it happened, and no second row is
 * created.
 *
 * AK item 1 merged only "strong" pairs, which did NOT cover 207/212: with the
 * real 212 headline ("...to offer free evening meals beginning Oct. 2") the
 * pair scores 0.43 content-token Jaccard and is merely "possible". AK2 item 2
 * adds the evidence that actually decides it -- a shared page addressing ONE
 * story (`sharesStoryPageUrl`) -- and `sameStoryForMerge` states the rule and
 * the exclusions in full. A shared section front or a shared agenda/packet/
 * minutes document is deliberately NOT that evidence.
 *
 * The merge only ever looks at leads this call inserted -- never at a row an
 * editor has already seen, killed or held.
 */
export async function fileScanLeads(
  sql: SqlTag,
  context: { userId: string; newsroomId?: number },
  newsroomId: number,
  runId: number,
  aiLeads: ScanAiLead[],
  existing: MatchCandidateLead[],
): Promise<{
  leadsCreated: number;
  resurfacedKilled: number;
  resurfacedOpen: number;
  /** QA-1 round 3: candidates filed (not discarded) because matchStrength
   * judged the overlap "possible" rather than "strong" -- see
   * matchStrength's doc comment in ./lead-match.ts. Included in
   * `leadsCreated`. */
  possibleMatched: number;
  /** Unit AK item 2: candidates filed HELD, linked to a KILLED lead, because
   * the finding carries facts that killed lead did not have (`newFactsIn`,
   * ./lead-match.ts) -- a story the editor killed has developed, so it is back
   * on the desk with the old kill reason next to it rather than discarded.
   * Included in `leadsCreated`; the killed row is also stamped, which is what
   * makes "Came back N times" true on its row. */
  developingFiled: number;
  /** QA-1: the headline of the first AI-returned candidate this call
   * discarded as a STRONG match, so the caller can name it in the scan
   * summary rather than let a merge -- right or wrong -- pass with no
   * trace. A "possible" match is never discarded -- it is filed -- so it
   * never sets this. */
  firstDiscardedHeadline?: string;
  /** Unit AK item 1: how many AI-returned candidates were the same story as
   * a lead this same run had already inserted, and were merged into it
   * instead of becoming a second row for one story. Not included in
   * `leadsCreated`. */
  mergedSameScan: number;
}> {
  let leadsCreated = 0;
  let resurfacedKilled = 0;
  let resurfacedOpen = 0;
  let possibleMatched = 0;
  let developingFiled = 0;
  let mergedSameScan = 0;
  let firstDiscardedHeadline: string | undefined;
  /* Leads THIS call inserted, newest last. A candidate is only ever merged
   * into one of these -- see sameStoryForMerge's doc comment for why a row an
   * editor has already seen is never touched. */
  const insertedThisRun: MatchCandidateLead[] = [];

  for (const lead of aiLeads) {
    if (!lead.headline?.trim()) continue;
    const candidateUrls = sanitizePublicUrls(lead.source_urls);

    const sibling = insertedThisRun.find((prior) =>
      sameStoryForMerge({ headline: lead.headline!, source_urls: candidateUrls }, prior),
    );
    if (sibling) {
      const merged = mergeSourceUrls(sibling.source_urls, candidateUrls);
      await sql`
          update leads set source_urls = ${JSON.stringify(merged)}
          where id = ${sibling.id} and newsroom_id = ${newsroomId}
        `;
      // Same object as the one in `existing`: keeping it in step means a third
      // sighting later in this run sees the union, not the first URL list.
      sibling.source_urls = merged;
      mergedSameScan += 1;
      continue;
    }

    const matchId = findMatchingLead({ headline: lead.headline, source_urls: candidateUrls }, existing);

    let possibleDuplicateOf: number | null = null;
    let initialStatus = "new";
    let dupKind: "possible" | "developing" | null = null;
    if (matchId != null) {
      const matched = existing.find((l) => l.id === matchId)!;
      const strength = matchStrength(
        { headline: lead.headline, source_urls: candidateUrls },
        { headline: matched.headline, source_urls: matched.source_urls },
      );
      if (strength === "strong") {
        // Unit AK item 2: a strong match against a KILLED lead is normally
        // discarded -- only the stamp below moves. When the new finding says
        // something the killed lead never said, that would drop a real
        // development, so it is filed for review instead (still stamped, so
        // the killed row's "came back" count stays true).
        const killedWithNewFacts =
          matched.status === "killed" &&
          newFactsIn({ why: lead.why, evidence: lead.evidence }, matched);
        await sql`
            update leads
            set resurfaced_count = resurfaced_count + 1,
                last_resurfaced_at = now(),
                last_resurfaced_scan_run_id = ${runId}
            where id = ${matchId} and newsroom_id = ${newsroomId}
          `;
        if (killedWithNewFacts) {
          developingFiled += 1;
          possibleDuplicateOf = matchId;
          initialStatus = "held";
          dupKind = "developing";
        } else {
          if (matched.status === "killed") resurfacedKilled += 1;
          else resurfacedOpen += 1;
          firstDiscardedHeadline ??= lead.headline;
          continue;
        }
      } else {
        // "possible" (or, defensively, a null that findMatchingLead's looser
        // rule somehow disagreed with) -- file it, linked to the match, do
        // NOT stamp the existing row.
        possibleDuplicateOf = matchId;
        if (matched.status === "killed") initialStatus = "held";
        dupKind = "possible";
        possibleMatched += 1;
      }
    }

    const urls = JSON.stringify(candidateUrls);
    const inserted = await sql<{ id: number; status: string; headline: string }>`
        insert into leads (user_id, newsroom_id, scan_run_id, headline, why, topic, source_urls, evidence, newsworthiness, status, possible_duplicate_of, topic_unchosen, dup_kind)
        values (
          ${context.userId}, ${newsroomId}, ${runId}, ${lead.headline.slice(0, 180)},
          ${String(lead.why ?? "").slice(0, 800)},
          ${String(lead.topic ?? "council").slice(0, 40)},
          ${urls},
          ${String(lead.evidence ?? "").slice(0, 2000)},
          ${Number(lead.newsworthiness) || 0},
          ${initialStatus},
          ${possibleDuplicateOf},
          ${lead.topicUnchosen === true},
          ${dupKind}
        )
        returning id, status, headline
      `;
    leadsCreated += 1;
    const insertedRow: MatchCandidateLead = {
      id: inserted[0]!.id,
      status: inserted[0]!.status,
      headline: inserted[0]!.headline,
      source_urls: candidateUrls,
      created_at: new Date().toISOString(),
      why: lead.why ?? null,
      evidence: lead.evidence ?? null,
    };
    existing.push(insertedRow);
    insertedThisRun.push(insertedRow);
  }

  return {
    leadsCreated,
    resurfacedKilled,
    resurfacedOpen,
    possibleMatched,
    developingFiled,
    mergedSameScan,
    firstDiscardedHeadline,
  };
}

export { parseLeadSourceUrls };
