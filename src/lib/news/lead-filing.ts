import { sanitizePublicUrls } from "./schema.ts";
import { storableText } from "./storable-text.ts";
import { noEventVerdict, standingPageStamp, type LeadEventFields } from "./lead-newsworthiness.ts";
import type { DupCheckOutcome } from "./dup-check.ts";
import {
  findMatchingLead,
  matchStrength,
  newFactsIn,
  normalizeSourceUrl,
  sameStoryForMerge,
  type MatchCandidateLead,
  type NewsroomPlace,
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
} & LeadEventFields;

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
 *
 * Unit U26b (2026-09-30): `place` is the newsroom's own city/state/county, and
 * it is threaded to every matcher call below so this desk's region words are
 * its own (`getPaperPlace`, ./paper-settings.ts) and never the shipped
 * paper's. Omitted, the matcher uses the generic civic vocabulary only.
 *
 * Unit U28 (2026-09-30): `dupCheck` is the answer to the one question the
 * matcher cannot settle -- see ./dup-check.ts, which asks the desk's model
 * about every borderline pair in ONE batched call before this function runs.
 * Two things change when it is present:
 *
 *   - a "possible" match the check says is NOT the same story is not linked at
 *     all. The candidate files as a plain new lead, `possible_duplicate_of` and
 *     `dup_kind` stay null, and the Queue draws no chip. This is the ONLY
 *     behaviour in this function a verdict can remove, and it is a chip, not a
 *     row: nothing here merges, kills or hides anything (the operator's binding
 *     requirement, and dup-check.ts's header says the same).
 *   - a verdict that says the two ARE the same story, or that clears the chip
 *     against a published article, is recorded on the row it is about
 *     (migration 0113) with the model's own sentence, so the Queue can say WHY.
 *
 * A verdict is applied only to the candidate index it was reached for, and only
 * when the matcher this run agrees about who the other side is -- a stale or
 * mismatched verdict is simply not found and the word rule stands. Omitting
 * `dupCheck` is exactly the pre-U28 behaviour, which is what the check's own
 * failure path relies on: a call that failed, timed out or answered unusably
 * leaves this argument's decisions empty and files the scan by the word rule.
 *
 * Scan quality (2026-10-03): before any of the above, a candidate that is a
 * standing PAGE rather than a news EVENT is dropped -- the cheap rules and the
 * model's own `is_event` verdict, both in ./lead-newsworthiness.ts. The scan
 * had been filing obituaries indexes, directory pages and hours pages as leads;
 * an event is what makes a lead news (Galtung & Ruge 1965; Harcup & O'Neill
 * 2017), and a page watcher's news is the CHANGE to a standing page, never the
 * page (The Marshall Project's Klaxon). Dropped candidates are counted
 * (`standingPageDropped`, `noEventDropped`) and the first is named in
 * `firstDroppedReason` so the run can say what it left out and why.
 */
export async function fileScanLeads(
  sql: SqlTag,
  context: { userId: string; newsroomId?: number },
  newsroomId: number,
  runId: number,
  aiLeads: ScanAiLead[],
  existing: MatchCandidateLead[],
  place?: NewsroomPlace | null,
  dupCheck?: DupCheckOutcome | null,
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
  /** Unit U28: candidates the desk's duplicate check cleared -- the matcher
   * rated the pair "possible", the model read both and said they are not the
   * same story, so no `possible_duplicate_of` link and no chip. Counted
   * separately from `possibleMatched` (which is links actually made) so the
   * scan's own arithmetic still adds up: these file as plain new leads.
   * Always 0 when no check ran. */
  dupCheckCleared: number;
  /** Candidates dropped as standing pages by the cheap rules in
   * ./lead-newsworthiness.ts (an obituaries index, a directory/index, a
   * projects index, an events listing) -- a page that exists, not an event.
   * Not filed, not counted in `leadsCreated`. */
  standingPageDropped: number;
  /** Candidates the model itself said were not news events (`is_event: false`)
   * and that no cheap rule caught. Not filed; not counted in `leadsCreated`. */
  noEventDropped: number;
  /** The first dropped candidate's headline and the one-line reason, so the
   * scan summary can tell the editor what the pass deliberately left out. */
  firstDroppedReason?: { headline: string; reason: string };
}> {
  let leadsCreated = 0;
  let resurfacedKilled = 0;
  let resurfacedOpen = 0;
  let possibleMatched = 0;
  let developingFiled = 0;
  let mergedSameScan = 0;
  let dupCheckCleared = 0;
  let standingPageDropped = 0;
  let noEventDropped = 0;
  let firstDiscardedHeadline: string | undefined;
  let firstDroppedReason: { headline: string; reason: string } | undefined;
  /* Leads THIS call inserted, newest last. A candidate is only ever merged
   * into one of these -- see sameStoryForMerge's doc comment for why a row an
   * editor has already seen is never touched. */
  const insertedThisRun: MatchCandidateLead[] = [];
  /* Unit U28: this candidate's 0-based position in `aiLeads`, which is how the
   * duplicate check keys its verdicts (dup-check.ts's `collectDupPairs` numbers
   * the same list the same way). Counted at the top of the loop, before every
   * `continue`, so a skipped or merged candidate cannot shift the numbering for
   * the candidates after it. */
  let candidateIndex = -1;

  for (const lead of aiLeads) {
    candidateIndex += 1;
    /*
      Sanitize ONCE, at the top, and read from these locals for the rest of the
      loop -- matching included.

      These are the fields a model wrote, and the insert at the bottom of this
      loop is where they become Postgres `text`. A NUL in any one of them does
      not spoil one field: Postgres refuses the whole statement with "invalid
      byte sequence for encoding UTF8: 0x00", that fails the transaction, and
      the entire scan -- every lead it found, every source it touched -- is lost
      to one stray byte the model emitted. SCAN-001.

      Doing it here rather than at the insert matters for the matching too: the
      candidates this loop compares against (`existing`) were read back from
      the database and are therefore already clean, so a candidate still
      carrying its NUL is not the same string the desk matched on.

      `storableText`, not `postgresText`: this is model-written editorial text,
      not captured evidence, so the byte is dropped rather than turned into a
      visible U+FFFD. See storable-text.ts for the policy.
    */
    const headline = storableText(lead.headline);
    const why = storableText(lead.why ?? "");
    const topic = storableText(lead.topic ?? "council");
    const evidence = storableText(lead.evidence ?? "");
    const candidateUrls = sanitizePublicUrls(lead.source_urls);

    /*
      The headline is judged AFTER cleaning, not before.

      A headline the model wrote out of C0 bytes alone -- a NUL and a BEL, two
      characters rather than none -- is not empty, so the trim check that used
      to sit at the top of this loop passed it. `storableText` then dropped
      both bytes, so the row filed below carried headline `""`: a lead on the
      Queue with nothing to read, counted as one the run found. Nothing about
      such a candidate is usable, so it is skipped the way every other unusable
      model lead is skipped -- no row, no count, nothing for an editor to open.

      This is SCAN-001's sibling. The NUL is gone either way; here the whole
      candidate was nothing but NUL.

      It also has to be `headline` and not `lead.headline`: the string matched
      against `existing` a few lines below must be the string that would be
      stored.
    */
    if (!headline.trim()) continue;

    /*
      Is this a news EVENT, or a page that exists?

      Two layers, cheapest first, both in ./lead-newsworthiness.ts:

      1. The cheap deterministic rules (an obituaries index, a directory/index
         page, a projects index, an events listing) run first, on the cleaned
         headline and the sanitized URLs. A page that exists has no event, so
         it is dropped here with no model tokens spent and no lead row.
      2. The model's own verdict (`is_event: false`) drops the rest that the
         patterns could not settle. Only an explicit false counts -- a reply
         written before the field existed files exactly as it always did.

      Both sit BEFORE the merge and match steps on purpose: a dropped page must
      not resurface a killed lead, merge into a sibling, or draw a duplicate
      chip. Dropping is counted, not silent: `firstDroppedReason` reaches the
      scan summary so the editor can read what the pass left out and why
      (Reuters Tracer's explainability rule, ./lead-newsworthiness.ts).
    */
    const pageStamp = standingPageStamp({ headline, source_urls: candidateUrls });
    const verdict = pageStamp ? { reason: pageStamp.reason } : noEventVerdict(lead);
    if (verdict) {
      if (pageStamp) standingPageDropped += 1;
      else noEventDropped += 1;
      firstDroppedReason ??= { headline, reason: verdict.reason };
      continue;
    }

    const sibling = insertedThisRun.find((prior) =>
      sameStoryForMerge({ headline, source_urls: candidateUrls }, prior, place),
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

    const matchId = findMatchingLead({ headline, source_urls: candidateUrls }, existing, place);

    let possibleDuplicateOf: number | null = null;
    let initialStatus = "new";
    let dupKind: "possible" | "developing" | null = null;
    // The headline this candidate actually matched, kept for the verdict
    // lookup below (`matched` itself does not outlive the block).
    let matchedHeadline: string | null = null;
    if (matchId != null) {
      const matched = existing.find((l) => l.id === matchId)!;
      matchedHeadline = matched.headline;
      const strength = matchStrength(
        { headline, source_urls: candidateUrls },
        { headline: matched.headline, source_urls: matched.source_urls },
        place,
      );
      if (strength === "strong") {
        // Unit AK item 2: a strong match against a KILLED lead is normally
        // discarded -- only the stamp below moves. When the new finding says
        // something the killed lead never said, that would drop a real
        // development, so it is filed for review instead (still stamped, so
        // the killed row's "came back" count stays true).
        const killedWithNewFacts =
          matched.status === "killed" &&
          newFactsIn({ headline, why, evidence }, matched, place);
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
          firstDiscardedHeadline ??= headline;
          continue;
        }
      } else {
        /*
          "possible" (or, defensively, a null that findMatchingLead's looser
          rule somehow disagreed with) -- file it, linked to the match, do NOT
          stamp the existing row.

          R2 item 1: two verdicts carve out of that default. A "same" with no
          new fact is a resurfacing and is stamped (below). A "not the same" is
          cleared and files plain (U28, next paragraph). Only a "same" WITH a
          new fact -- or no verdict at all -- files the linked row this tier
          was written for.

          U28: unless the desk's duplicate check read both and said they are
          not the same story. Then the link is not made at all -- no
          `possible_duplicate_of`, no `dup_kind`, no "Possible duplicate ·
          compare" chip -- and the candidate files as the plain new lead the
          words could not prove it was not. The row still records the verdict
          and its sentence (below), so "why is this one not linked?" is
          answerable from the row itself.

          The verdict is looked up by THIS candidate's position AND the
          matched lead's headline, so a verdict reached for a different pair
          -- or for a target this run matched differently -- is not found, and
          the word rule stands. See dup-check.ts.

          L2 of the pre-merge audit: the headline half of that sentence was
          stated in the comment and not done in the code. The map is keyed by
          candidate index, and two candidates cannot collide, but the TARGET
          can differ -- `collectDupPairs` records the headline it matched
          against, and this loop matches independently. Comparing them is what
          makes "the verdict is about the pair we are filing" a property of the
          code rather than of the ordering.
        */
        const leadAnswer = dupCheck?.decisions.get(candidateIndex)?.lead ?? null;
        const verdict =
          leadAnswer && leadAnswer.headline === matched.headline ? leadAnswer.verdict : null;
        if (verdict && !verdict.same) {
          dupCheckCleared += 1;
        } else if (verdict && verdict.same && !newFactsIn({ headline, why, evidence }, matched, place)) {
          /*
            R2 item 1 (2026-10-03): the word rule rates the pair "possible", and
            the desk's duplicate check then READ BOTH and answered "same story"
            -- and the finding carries no fact the existing row did not already
            state. Filing it anyway puts one story on the desk twice: the live
            run did that for 8 of 19 filed leads, each of them a repeat of a lead
            already on the desk or in the paper.

            So this is the case the "possible" tier was waiting for, spelled out:
            a verdict of `same` with no genuinely new fact is a RESURFACING, and
            a resurfacing is a stamp, not a row. The existing lead's
            `resurfaced_count` goes up and its `last_resurfaced_at` moves, exactly
            as the "strong" tier does above, and nothing is filed.

            What still files: a verdict of `same` where `newFactsIn` finds an
            anchor the existing row does not state -- a new date, a different
            amount, a number that moved (`newFactsIn`, ./lead-match.ts). That is
            a development of a story the desk already has, and a development is
            worth a row (filed below, linked and held as before). A reworded
            headline, a fresh source URL, or extra background is NOT a new fact:
            the anchors are dates/amounts/counts, so a paraphrase folds to the
            same tokens and lands here, in the stamp.

            No verdict at all (`null`) is not this case: the desk did not ask,
            and "did not ask" must never be read as "same" -- see dup-check.ts.
          */
          await sql`
            update leads
            set resurfaced_count = resurfaced_count + 1,
                last_resurfaced_at = now(),
                last_resurfaced_scan_run_id = ${runId}
            where id = ${matchId} and newsroom_id = ${newsroomId}
          `;
          if (matched.status === "killed") resurfacedKilled += 1;
          else resurfacedOpen += 1;
          firstDiscardedHeadline ??= headline;
          continue;
        } else {
          possibleDuplicateOf = matchId;
          if (matched.status === "killed") initialStatus = "held";
          dupKind = "possible";
          possibleMatched += 1;
        }
      }
    }

    /*
      U28: the duplicate check's verdict on this candidate's borderline pairs,
      if the desk asked about them. `decision` is undefined for every candidate
      the check did not cover -- no borderline pair, past the pair cap, or a
      scan whose check failed -- and then all eight columns stay null, which is
      what leaves the word rule exactly as it was (see dup-check.ts's header:
      "the desk did not ask" and "the model said no" must never be the same
      stored value).

      `dup_ai_target` is the headline of the lead the link's verdict is about,
      written even when the verdict is what cleared the link, so the row keeps
      its own answer to "not linked to what?".
    */
    const decision = dupCheck?.decisions.get(candidateIndex);
    // L2 of the audit, the same guard the link above applies: a verdict for a
    // target this run did not match is not this row's verdict, and recording it
    // would put another pair's answer in `dup_ai_same`/`dup_ai_target`.
    const leadAnswer = decision?.lead ?? null;
    const leadVerdict = leadAnswer && leadAnswer.headline === matchedHeadline ? leadAnswer.verdict : null;
    const printedVerdict = decision?.printed?.verdict ?? null;
    const aiModel = decision ? (dupCheck?.model ?? null) : null;
    const aiCheckedAt = decision ? new Date().toISOString() : null;

    const urls = JSON.stringify(candidateUrls);
    const inserted = await sql<{ id: number; status: string; headline: string }>`
        insert into leads (user_id, newsroom_id, scan_run_id, headline, why, topic, source_urls, evidence, newsworthiness, status, possible_duplicate_of, topic_unchosen, dup_kind,
          dup_ai_same, dup_ai_why, dup_ai_target,
          dup_ai_printed_same, dup_ai_printed_why, dup_ai_printed_slug,
          dup_ai_model, dup_ai_checked_at)
        values (
          ${context.userId}, ${newsroomId}, ${runId}, ${headline.slice(0, 180)},
          ${why.slice(0, 800)},
          ${topic.slice(0, 40)},
          ${urls},
          ${evidence.slice(0, 2000)},
          ${Number(lead.newsworthiness) || 0},
          ${initialStatus},
          ${possibleDuplicateOf},
          ${lead.topicUnchosen === true},
          ${dupKind},
          ${leadVerdict ? leadVerdict.same : null},
          ${leadVerdict ? storableText(leadVerdict.why).slice(0, 400) || null : null},
          ${leadVerdict ? storableText(leadAnswer!.headline).slice(0, 180) || null : null},
          ${printedVerdict ? printedVerdict.same : null},
          ${printedVerdict ? storableText(printedVerdict.why).slice(0, 400) || null : null},
          ${decision?.printed?.slug ?? null},
          ${aiModel ? storableText(aiModel).slice(0, 120) : null},
          ${aiCheckedAt}
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
      // `== null` rather than the sanitized "" on purpose: a model that wrote
      // no `why` at all must still read as absent here, exactly as before.
      why: lead.why == null ? null : why,
      evidence: lead.evidence == null ? null : evidence,
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
    dupCheckCleared,
    firstDiscardedHeadline,
    standingPageDropped,
    noEventDropped,
    firstDroppedReason,
  };
}

export { parseLeadSourceUrls };
