/**
 * Dynamic sources unit 7 (D169; Goals\TownReporter-SPEC-DYNAMIC-SOURCES-2026-10-20.md
 * section 5f): suggested sources are tried without the editor.
 *
 * Suggestions (`status = 'proposed'`) are grouped by site. A site the paper
 * already has (accepted, trial, dormant, paused or rejected) is left alone: its
 * suggestions stay where they are for the editor, and the inventory counts
 * them per site. A NEW site gets one automatic check on the hourly clock:
 *
 *   - the page checked is the suggestion itself when it looks like a list or
 *     a feed, otherwise the site's front page (a suggestion is usually one
 *     article, and an article never changes, so a trial of it would always fail);
 *   - it passes when the read works and the page is a feed or shows 3 or more
 *     dates;
 *   - pass: a trial source for that page starts (unit 6 then keeps or drops it);
 *   - fail: the suggestions stay suggestions, with a note saying why.
 *
 * Social sites, search engines and link shorteners are never tried. Nothing is
 * deleted, and the editor can still accept or reject any suggestion by hand.
 */
import type { SqlTag } from "./lead-filing.ts";
import { moveSource } from "./source-trials.ts";

export const INTAKE_PER_TICK = 3;
export const MIN_DATED_ITEMS = 3;

const NEVER_TRY = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "linkedin.com",
  "google.com", "bing.com", "duckduckgo.com", "yahoo.com", "t.co", "bit.ly", "tinyurl.com",
  "nextdoor.com", "pinterest.com", "threads.net",
];

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATES = new RegExp(
  `\\b(?:(?:${MONTHS})\\.?\\s+\\d{1,2}\\b|\\d{1,2}/\\d{1,2}/\\d{2,4}\\b|\\d{4}-\\d{2}-\\d{2}\\b)`,
  "gi",
);

/** The site of a URL: host without www, lower case. Null when not http(s). */
export function siteOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function neverTry(site: string): boolean {
  return NEVER_TRY.some((blocked) => site === blocked || site.endsWith(`.${blocked}`));
}

/** The suggestion itself when it looks like a list or feed, else the front page. */
export function pageToTry(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "");
  if (!path || /(^|\/)(feed|rss|news|events?|calendar|agendas?|meetings?|blog|press|newsroom|announcements?)(\/|$|\.)/i.test(path))
    return url;
  return `${u.protocol}//${u.host}/`;
}

/** Spec 5f: a feed, or a page with 3 or more dates on it. */
export function looksLikeListing(text: string, method?: string | null): { ok: boolean; why: string } {
  if (method === "feed") return { ok: true, why: "it is a feed" };
  const dates = text.match(DATES)?.length ?? 0;
  return dates >= MIN_DATED_ITEMS
    ? { ok: true, why: `the page shows ${dates} dates` }
    : { ok: false, why: `the page shows ${dates} date${dates === 1 ? "" : "s"} (needs ${MIN_DATED_ITEMS})` };
}

export type IntakeReader = (url: string) => Promise<{ text: string; method?: string | null }>;

type Proposal = { id: number; user_id: string; url: string };

/** One intake round for one newsroom. Returns the sites it checked. */
export async function runIntake(
  sql: SqlTag,
  input: { newsroomId: number; read: IntakeReader },
): Promise<string[]> {
  const { newsroomId, read } = input;
  const all = await sql<{ id: number; user_id: string; url: string; status: string; reviewed_at: unknown }>`
    select id, user_id, url, status, reviewed_at from sources where newsroom_id = ${newsroomId} order by id`;
  const known = new Set<string>();
  for (const row of all) {
    const site = siteOf(row.url);
    if (site && row.status !== "proposed") known.add(site);
  }
  const bySite = new Map<string, Proposal[]>();
  const checked = new Set<string>();
  for (const row of all) {
    if (row.status !== "proposed") continue;
    const site = siteOf(row.url);
    if (!site || known.has(site) || neverTry(site)) continue;
    if (row.reviewed_at) checked.add(site);
    const list = bySite.get(site) ?? [];
    list.push(row);
    bySite.set(site, list);
  }
  const sites = [...bySite.keys()].filter((site) => !checked.has(site)).slice(0, INTAKE_PER_TICK);

  for (const site of sites) {
    const proposals = bySite.get(site)!;
    const first = proposals[0]!;
    const target = pageToTry(first.url);
    let verdict: { ok: boolean; why: string };
    try {
      const page = await read(target);
      verdict = page.text?.trim() ? looksLikeListing(page.text, page.method) : { ok: false, why: "the page had no readable text" };
    } catch (error) {
      verdict = { ok: false, why: `it could not be read (${(error instanceof Error ? error.message : "fetch failed").slice(0, 120)})` };
    }
    const ids = proposals.map((p) => p.id);
    if (!verdict.ok) {
      await sql`update sources set reviewed_at = now(),
        review_note = ${`Automatic check of ${target}: not tried, because ${verdict.why}. Still a suggestion.`}
        where newsroom_id = ${newsroomId} and id = any(${ids})`;
      continue;
    }
    const why = `Suggested site checked on its own: ${verdict.why}. Trial started on ${target}.`;
    const existing = proposals.find((p) => p.url === target);
    let trialId: number;
    if (existing) {
      trialId = existing.id;
    } else {
      const [row] = await sql<{ id: number }>`
        insert into sources (user_id, newsroom_id, url, title, kind, tier, status, proposed_reason, proposed_via)
        values (${first.user_id}, ${newsroomId}, ${target}, ${site}, 'page', 'C', 'proposed',
          ${`Found from ${proposals.length} suggestion${proposals.length === 1 ? "" : "s"}, first ${first.url}`.slice(0, 500)}, 'discovery')
        on conflict (user_id, newsroom_id, url) do update set proposed_via = excluded.proposed_via
        returning id`;
      trialId = row!.id;
    }
    await moveSource(sql, { newsroomId, sourceId: trialId, to: "trial", why });
    await sql`update sources set reviewed_at = now(), review_note = ${`Its site is on trial as source ${trialId}.`}
      where newsroom_id = ${newsroomId} and id = any(${ids}) and id <> ${trialId}`;
  }
  return sites;
}
