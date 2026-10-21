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
 *     dates, and (D176) names the paper's city or county when the paper has a
 *     place set — a far-away website never gets a trial;
 *   - pass: a trial source for that page starts (unit 6 then keeps or drops it);
 *   - fail: the suggestions stay suggestions, with a note saying why.
 *
 * Social sites, search engines and link shorteners are never tried. Nothing is
 * deleted, and the editor can still accept or reject any suggestion by hand.
 */
import type { SqlTag } from "./lead-filing.ts";
import { moveSource, namesPlace, note } from "./source-trials.ts";

export const INTAKE_PER_TICK = 3;
export const MIN_DATED_ITEMS = 3;

const NEVER_TRY = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "linkedin.com",
  "google.com", "bing.com", "duckduckgo.com", "yahoo.com", "t.co", "bit.ly", "tinyurl.com",
  "nextdoor.com", "pinterest.com", "threads.net",
  // File storage and CDNs hold documents, not news sites (Test walk, Oct 20 2026).
  "googleapis.com", "googleusercontent.com", "amazonaws.com", "cloudfront.net", "website-files.com",
  "dropbox.com", "box.com", "sharepoint.com", "squarespace-cdn.com", "wixstatic.com", "akamaized.net",
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
  // Only the LAST part of the path says "list": /news/ is a list, /news/some-story is not.
  const last = path.split("/").pop() ?? "";
  if (!path || /^(feed|rss|news|events?|calendar|agendas?|meetings?|blog|press|press-releases|newsroom|announcements?)(\.[a-z]+)?$/i.test(last))
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

/**
 * D182: the reader also hands back the page's full text when it has one, so a
 * site that names its city only in the header, footer or address — the parts
 * article extraction drops — can still count as local.
 */
export type IntakeReader = (
  url: string,
) => Promise<{ text: string; method?: string | null; rawText?: string | null }>;

/** D182 rule 2: a host names the place when it contains it, spaces and punctuation dropped. */
export function hostNamesPlace(site: string | null, placeNames: readonly string[]): boolean {
  if (!site) return false;
  const squashed = site.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return placeNames
    .map((name) => name.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter((name) => name.length >= 3)
    .some((name) => squashed.includes(name));
}

type Proposal = { id: number; user_id: string; url: string; reviewed_at: unknown };

/** Spec 5f: the statuses that own a website (a suggestion there is attached, not tried). */
const OWNED_STATUSES = ["accepted", "trial", "dormant"];

export type SiteProposals = { site: string; count: number; firstUrl: string; note: string | null };

/**
 * Spec 5f: the suggestions waiting, one entry per website (biggest count
 * first), so the inventory can show 330 sites instead of 1,316 rows.
 * `firstUrl` is the oldest suggestion on the site; `note` is the note the
 * intake wrote on it, when it has one.
 */
export async function proposalsBySite(sql: SqlTag, newsroomId: number): Promise<SiteProposals[]> {
  const rows = await sql<{ url: string; note: string | null }>`
    select url, coalesce(review_note, '') as note from sources
    where newsroom_id = ${newsroomId} and status = 'proposed' order by id`;
  const groups = new Map<string, SiteProposals>();
  for (const row of rows) {
    const site = siteOf(row.url);
    if (!site) continue;
    const group = groups.get(site);
    if (!group) {
      groups.set(site, { site, count: 1, firstUrl: row.url, note: row.note || null });
      continue;
    }
    group.count += 1;
    if (!group.note && row.note) group.note = row.note;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
}

/** One intake round for one newsroom. Returns the sites it checked. */
export async function runIntake(
  sql: SqlTag,
  input: { newsroomId: number; placeNames: readonly string[]; read: IntakeReader },
): Promise<string[]> {
  const { newsroomId, placeNames, read } = input;
  const all = await sql<{ id: number; user_id: string; url: string; status: string; reviewed_at: unknown }>`
    select id, user_id, url, status, reviewed_at from sources where newsroom_id = ${newsroomId} order by id`;
  const known = new Set<string>();
  // Spec 5f: the lowest-id accepted/trial/dormant source of each website owns it.
  const ownerBySite = new Map<string, { id: number; status: string }>();
  const dormantBySite = new Map<string, number>();
  for (const row of all) {
    const site = siteOf(row.url);
    if (!site || row.status === "proposed") continue;
    known.add(site);
    if (!OWNED_STATUSES.includes(row.status)) continue;
    if (!ownerBySite.has(site)) ownerBySite.set(site, { id: row.id, status: row.status });
    if (row.status === "dormant" && !dormantBySite.has(site)) dormantBySite.set(site, row.id);
  }
  const bySite = new Map<string, Proposal[]>();
  const attachedBySite = new Map<string, Proposal[]>();
  const checked = new Set<string>();
  for (const row of all) {
    if (row.status !== "proposed") continue;
    const site = siteOf(row.url);
    if (!site) continue;
    if (ownerBySite.has(site)) {
      const list = attachedBySite.get(site) ?? [];
      list.push(row);
      attachedBySite.set(site, list);
      continue;
    }
    if (known.has(site) || neverTry(site)) continue;
    if (row.reviewed_at) checked.add(site);
    const list = bySite.get(site) ?? [];
    list.push(row);
    bySite.set(site, list);
  }

  // Spec 5f: a suggestion on a website the paper already has is attached to
  // that source, counted on it, and noted once. Its status does not change.
  for (const [site, proposals] of attachedBySite) {
    const owner = ownerBySite.get(site)!;
    await sql`update sources set proposed_count = ${proposals.length}
      where newsroom_id = ${newsroomId} and id = ${owner.id}`;
    const ids = proposals.map((p) => p.id);
    await sql`update sources set reviewed_at = now(), review_note = ${`Same website as source ${owner.id}.`}
      where newsroom_id = ${newsroomId} and id = any(${ids}) and reviewed_at is null`;
    // Spec 5b: a NEW suggestion on a dormant source's website puts it on trial again.
    const dormantId = dormantBySite.get(site);
    if (dormantId != null && proposals.some((p) => !p.reviewed_at)) {
      await moveSource(sql, {
        newsroomId,
        sourceId: dormantId,
        to: "trial",
        why: "A new link on its website was suggested. Trial started again.",
      });
    }
  }
  const sites = [...bySite.keys()].filter((site) => !checked.has(site)).slice(0, INTAKE_PER_TICK);

  for (const site of sites) {
    const proposals = bySite.get(site)!;
    const first = proposals[0]!;
    const target = pageToTry(first.url);
    let text = "";
    let rawText = "";
    let verdict: { ok: boolean; why: string };
    try {
      const page = await read(target);
      text = page.text ?? "";
      rawText = page.rawText ?? "";
      verdict = text.trim() ? looksLikeListing(text, page.method) : { ok: false, why: "the page had no readable text" };
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
    // D176 with D182: a website that never names the paper's city or county is
    // not the paper's neighbourhood news, so it stays a suggestion. The place
    // counts when the extracted text names it, when the host name carries it,
    // or when the full page text names it somewhere extraction dropped.
    const targetSite = siteOf(target);
    const local =
      namesPlace(text, placeNames) ||
      hostNamesPlace(targetSite, placeNames) ||
      (rawText.trim().length > 0 && namesPlace(rawText, placeNames));
    if (placeNames.length > 0 && !local) {
      const why = `the page does not name ${placeNames.join(" or ")}`;
      const reason = `Automatic check of ${target}: not tried, because ${why}. Still a suggestion.`;
      await sql`update sources set reviewed_at = now(), review_note = ${reason}
        where newsroom_id = ${newsroomId} and id = any(${ids})`;
      await note(sql, newsroomId, first.id, "not-local", reason);
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
