/**
 * Dynamic sources unit 6 (D169; Goals\TownReporter-SPEC-DYNAMIC-SOURCES-2026-10-20.md
 * sections 5b and 10a.4/10a.5): sources move between accepted, trial and
 * dormant by themselves. Nothing is deleted; `sources.status` is the truth.
 *
 *   trial    -> accepted  after 6 trial reads with 2 or more changes that hold a
 *                         dated local item (a place word and a date, no model);
 *   trial    -> dormant   after 6 trial reads without that;
 *   dormant  -> trial     when its monthly re-check finds such a change;
 *   accepted -> dormant   when 45 days pass with no change and no lead. Official
 *                         and tier-A sources never go dormant, and neither does
 *                         an editor's daily pick (editor control is absolute).
 *
 * Trials and dormant re-checks are read by a LIGHT PASS on the hourly clock:
 * a fetch, a hash, an observation, no model call, outside the scan budget
 * (spec 10a.4). Every move writes a `promoted` or `demoted` observation with
 * the numbers that caused it. The editor can move any source back by hand.
 *
 * Declared with the narrow tagged-template SQL type so a test can run it under
 * plain `node --test`; the page reader is passed in.
 */
import type { SqlTag } from "./lead-filing.ts";
import { sha256, sourceIdentity } from "./url-guard.ts";

export const TRIAL_READS = 6;
export const TRIAL_LOCAL_CHANGES = 2;
export const DORMANT_RECHECK_DAYS = 30;
export const DORMANT_AFTER_DAYS = 45;
/** Light-pass reads per newsroom per hourly tick, at most one per site. */
export const LIGHT_PASS_PER_TICK = 6;
/** A trial source is read at most this often. */
const TRIAL_GAP_HOURS = 4;
/** The note that marks a changed trial read that held a dated local item. */
export const LOCAL_CHANGE_NOTE = "New dated local item.";

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PATTERN = new RegExp(
  `\\b(?:(?:${MONTHS})\\.?\\s+\\d{1,2}\\b|\\d{1,2}/\\d{1,2}/\\d{2,4}\\b|\\d{4}-\\d{2}-\\d{2}\\b)`,
  "i",
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Spec 10a.5 default: the text names the paper's place and carries a date. */
export function hasDatedLocalItem(text: string, placeNames: readonly string[]): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  return placeNames
    .map((name) => name.trim())
    .filter((name) => name.length >= 3)
    .some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text));
}

/** The words that name the paper's place: its city and its county. */
export function placeNamesOf(place: { city?: string | null; county?: string | null } | null | undefined): string[] {
  const names = [place?.city, place?.county].filter((name): name is string => Boolean(name?.trim()));
  // "Boulder County" also counts as "Boulder County"; a bare county word is too wide.
  return [...new Set(names)];
}

/** Spec 5b with 10a.4: what a finished trial becomes. Null while it is still running. */
export function trialVerdict(trialReads: number, localChanges: number): "accepted" | "dormant" | null {
  if (trialReads < TRIAL_READS) return null;
  return localChanges >= TRIAL_LOCAL_CHANGES ? "accepted" : "dormant";
}

export type PageReader = (url: string) => Promise<{ text: string }>;

type LightRow = {
  id: number;
  url: string;
  status: string;
  last_hash: string | null;
  trial_reads: number;
  trial_started_at: string | Date | null;
};

async function note(
  sql: SqlTag,
  newsroomId: number,
  sourceId: number,
  kind: string,
  text: string,
  by = "trial-pass",
): Promise<void> {
  await sql`
    insert into source_observations (newsroom_id, source_id, kind, note, observed_by)
    values (${newsroomId}, ${sourceId}, ${kind}, ${text.slice(0, 600)}, ${by})`;
}

/** Move a source to a new status and log why. */
export async function moveSource(
  sql: SqlTag,
  input: { newsroomId: number; sourceId: number; to: "accepted" | "trial" | "dormant"; why: string; by?: string },
): Promise<void> {
  const { newsroomId, sourceId, to, why } = input;
  if (to === "trial") {
    await sql`update sources set status = 'trial', trial_started_at = now(), trial_reads = 0,
      dormant_at = null, dormant_reason = null where id = ${sourceId} and newsroom_id = ${newsroomId}`;
  } else if (to === "dormant") {
    await sql`update sources set status = 'dormant', dormant_at = now(), dormant_reason = ${why.slice(0, 300)},
      interval_minutes = 43200 where id = ${sourceId} and newsroom_id = ${newsroomId}`;
  } else {
    // A new member of the scan pool starts at a daily interval and is due now.
    await sql`update sources set status = 'accepted', reviewed_at = now(), interval_minutes = 1440,
      next_due_at = null, dormant_at = null, dormant_reason = null
      where id = ${sourceId} and newsroom_id = ${newsroomId}`;
  }
  await note(sql, newsroomId, sourceId, to === "dormant" ? "demoted" : "promoted", why, input.by);
}

/**
 * One light pass for one newsroom: read up to LIGHT_PASS_PER_TICK trial
 * sources (each at most every 4 hours) and dormant sources due their monthly
 * re-check, one per site, then apply the trial rules. Returns the ids read.
 */
export async function runLightPass(
  sql: SqlTag,
  input: { newsroomId: number; placeNames: readonly string[]; read: PageReader },
): Promise<number[]> {
  const { newsroomId, placeNames, read } = input;
  const candidates = await sql<LightRow>`
    select id, url, status, last_hash, trial_reads, trial_started_at from sources
    where newsroom_id = ${newsroomId}
      and (retry_after is null or retry_after <= now())
      and (
        (status = 'trial' and (last_fetched_at is null or last_fetched_at < now() - make_interval(hours => ${TRIAL_GAP_HOURS})))
        or (status = 'dormant' and (last_fetched_at is null or last_fetched_at < now() - make_interval(days => ${DORMANT_RECHECK_DAYS})))
      )
    order by (status = 'trial') desc, last_fetched_at asc nulls first, id
    limit 200`;
  const hosts = new Set<string>();
  const picked: LightRow[] = [];
  for (const row of candidates) {
    const host = (sourceIdentity(row.url) ?? row.url).split("/")[0]!;
    if (hosts.has(host)) continue;
    hosts.add(host);
    picked.push(row);
    if (picked.length >= LIGHT_PASS_PER_TICK) break;
  }

  for (const row of picked) {
    const counts = row.status === "trial" ? 1 : 0;
    let text: string;
    try {
      text = (await read(row.url)).text ?? "";
      if (!text.trim()) throw new Error("Page had almost no readable text");
    } catch (error) {
      const message = (error instanceof Error ? error.message : "fetch failed").slice(0, 300);
      await sql`update sources set last_fetched_at = now(), last_error = ${message},
        consecutive_failures = consecutive_failures + 1,
        failure_streak_started_at = coalesce(failure_streak_started_at, now()),
        trial_reads = trial_reads + ${counts}
        where id = ${row.id} and newsroom_id = ${newsroomId}`;
      await note(sql, newsroomId, row.id, "retrieval-error", message);
      if (row.status === "trial") await settleTrial(sql, newsroomId, row.id);
      continue;
    }
    const hash = await sha256(text);
    const changed = row.last_hash !== hash;
    const local = changed && hasDatedLocalItem(text, placeNames);
    await sql`update sources set last_fetched_at = now(), last_ok_at = now(), last_error = null,
      consecutive_failures = 0, failure_streak_started_at = null, last_hash = ${hash},
      trial_reads = trial_reads + ${counts}
      where id = ${row.id} and newsroom_id = ${newsroomId}`;
    await note(
      sql,
      newsroomId,
      row.id,
      changed ? "changed" : "quiet",
      local ? LOCAL_CHANGE_NOTE : changed ? "Changed, but no dated local item." : "No change since the last read.",
    );
    if (row.status === "trial") await settleTrial(sql, newsroomId, row.id);
    else if (local) {
      await moveSource(sql, {
        newsroomId,
        sourceId: row.id,
        to: "trial",
        why: "Monthly re-check found a new dated local item. Trial started again.",
      });
    }
  }
  return picked.map((row) => row.id);
}

/** Apply the trial rule to one trial source after a read. */
async function settleTrial(sql: SqlTag, newsroomId: number, sourceId: number): Promise<void> {
  const [row] = await sql<{ trial_reads: number; local_changes: number }>`
    select s.trial_reads,
      (select count(*)::int from source_observations o
        where o.source_id = s.id and o.kind = 'changed' and o.note = ${LOCAL_CHANGE_NOTE}
          and o.created_at >= coalesce(s.trial_started_at, s.created_at)) as local_changes
    from sources s where s.id = ${sourceId} and s.newsroom_id = ${newsroomId} and s.status = 'trial'`;
  if (!row) return;
  const verdict = trialVerdict(row.trial_reads, row.local_changes);
  if (!verdict) return;
  await moveSource(sql, {
    newsroomId,
    sourceId,
    to: verdict,
    why:
      verdict === "accepted"
        ? `Trial passed: ${row.local_changes} new dated local items in ${row.trial_reads} reads. Now read by the scan.`
        : `Trial ended: ${row.local_changes} new dated local item${row.local_changes === 1 ? "" : "s"} in ${row.trial_reads} reads (needs ${TRIAL_LOCAL_CHANGES}). Re-checked once a month.`,
  });
}

/**
 * Spec 5b: accepted sources with no change and no lead for 45 days go dormant.
 * Never official or tier-A sources, never an editor's saved pick, and never a
 * source watched for less than 45 days. Returns the ids moved.
 */
export async function demoteQuietSources(sql: SqlTag, newsroomId: number): Promise<number[]> {
  const [policy] = await sql<{ selected_source_ids: unknown }>`
    select selected_source_ids from daily_scan_policies where newsroom_id = ${newsroomId}`;
  const picks = new Set<number>(
    Array.isArray(policy?.selected_source_ids) ? (policy!.selected_source_ids as unknown[]).map(Number) : [],
  );
  const quiet = await sql<{ id: number }>`
    select s.id from sources s
    where s.newsroom_id = ${newsroomId} and s.status = 'accepted'
      and coalesce(s.kind, '') <> 'official' and coalesce(s.tier, '') <> 'A'
      and exists (select 1 from source_observations o where o.source_id = s.id
        and o.created_at < now() - make_interval(days => ${DORMANT_AFTER_DAYS}))
      and not exists (select 1 from source_observations o where o.source_id = s.id and o.kind = 'changed'
        and o.created_at >= now() - make_interval(days => ${DORMANT_AFTER_DAYS}))
      -- source_yield.last_lead_at also counts older leads matched by URL (unit 2).
      and not exists (select 1 from source_yield y where y.source_id = s.id
        and y.last_lead_at >= now() - make_interval(days => ${DORMANT_AFTER_DAYS}))
      and not exists (select 1 from leads l where l.source_id = s.id
        and l.created_at >= now() - make_interval(days => ${DORMANT_AFTER_DAYS}))
    order by s.id`;
  const moved: number[] = [];
  for (const row of quiet) {
    if (picks.has(row.id)) continue;
    await moveSource(sql, {
      newsroomId,
      sourceId: row.id,
      to: "dormant",
      why: `No change and no lead in ${DORMANT_AFTER_DAYS} days. Re-checked once a month; it comes back when it changes.`,
    });
    moved.push(row.id);
  }
  return moved;
}
