import { sanitizePublicUrls } from "./schema.ts";
import { findMatchingLead, type MatchCandidateLead } from "./lead-match.ts";

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

/** One AI-returned lead, as parsed out of the scan model's JSON. */
export type ScanAiLead = {
  headline?: string;
  why?: string;
  topic?: string;
  source_urls?: string[];
  evidence?: string;
  newsworthiness?: number;
};

/**
 * The lead-filing half of `performScanWork` (src/lib/news/desk.ts), pulled
 * out so it can be tested directly against a real scratch database without
 * spinning up a whole scan (fetch sources, call the AI, etc). For every
 * AI-returned lead: if `findMatchingLead` (./lead-match.ts) finds it is the
 * same story as something already in `existing`, stamp that row's
 * resurfaced columns instead of inserting a duplicate -- a killed match
 * counts toward `resurfacedKilled`, an open (new/held/drafted) match toward
 * `resurfacedOpen`. Otherwise insert as a new lead, same as before this
 * feature existed. `existing` is mutated in place with each newly-inserted
 * lead so two AI-returned leads that are the same story within one scan
 * don't both get inserted.
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
  /** QA-1: the headline of the first AI-returned candidate this call
   * discarded as a match, so the caller can name it in the scan summary
   * rather than let a merge -- right or wrong -- pass with no trace. */
  firstDiscardedHeadline?: string;
}> {
  let leadsCreated = 0;
  let resurfacedKilled = 0;
  let resurfacedOpen = 0;
  let firstDiscardedHeadline: string | undefined;

  for (const lead of aiLeads) {
    if (!lead.headline?.trim()) continue;
    const candidateUrls = sanitizePublicUrls(lead.source_urls);
    const matchId = findMatchingLead({ headline: lead.headline, source_urls: candidateUrls }, existing);
    if (matchId != null) {
      const matched = existing.find((l) => l.id === matchId)!;
      await sql`
          update leads
          set resurfaced_count = resurfaced_count + 1,
              last_resurfaced_at = now(),
              last_resurfaced_scan_run_id = ${runId}
          where id = ${matchId} and newsroom_id = ${newsroomId}
        `;
      if (matched.status === "killed") resurfacedKilled += 1;
      else resurfacedOpen += 1;
      firstDiscardedHeadline ??= lead.headline;
      continue;
    }
    const urls = JSON.stringify(candidateUrls);
    const inserted = await sql<{ id: number; status: string; headline: string }>`
        insert into leads (user_id, scan_run_id, headline, why, topic, source_urls, evidence, newsworthiness, status)
        values (
          ${context.userId}, ${runId}, ${lead.headline.slice(0, 180)},
          ${String(lead.why ?? "").slice(0, 800)},
          ${String(lead.topic ?? "council").slice(0, 40)},
          ${urls},
          ${String(lead.evidence ?? "").slice(0, 2000)},
          ${Number(lead.newsworthiness) || 0},
          'new'
        )
        returning id, status, headline
      `;
    leadsCreated += 1;
    existing.push({
      id: inserted[0]!.id,
      status: inserted[0]!.status,
      headline: inserted[0]!.headline,
      source_urls: candidateUrls,
      created_at: new Date().toISOString(),
    });
  }

  return { leadsCreated, resurfacedKilled, resurfacedOpen, firstDiscardedHeadline };
}

export { parseLeadSourceUrls };
