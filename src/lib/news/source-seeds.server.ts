import { withTransaction, type Sql } from "../db.ts";
import { kindFromSourceUrl } from "./desk-copy.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPaperConfig, isOnboarded } from "./paper-settings.ts";
import { parseHttpUrl } from "./source-lines.ts";
import { assertHttpUrl, isSearchResultUrl, sourceIdentity } from "./url-guard.ts";

/** Seed only the configured, onboarded newsroom that owns this editor action. */
export async function ensureNewsroomSources(userId: string, newsroomId = DEFAULT_NEWSROOM_ID) {
  if (!(await isOnboarded(newsroomId))) return;
  const config = await getPaperConfig(newsroomId);
  await withTransaction(async (sql) => {
    // Serialize seeding for this newsroom without requiring a new uniqueness
    // constraint that historical duplicate rows could not satisfy.
    const room = await sql<{ newsroom_id: number }>`
      select newsroom_id
      from paper_settings
      where newsroom_id=${newsroomId}
      for update
    `;
    if (!room.length) return;

    for (const source of config.seedSources)
      await sql`
        insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
        select ${userId},${newsroomId},${source.url},${source.title},${source.kind},${source.tier},'accepted'
        where not exists (
          select 1
          from sources
          where newsroom_id=${newsroomId} and url=${source.url}
        )
        on conflict(user_id,newsroom_id,url) do nothing
      `;
  });
}

/** The name a first-time row falls back to when the editor typed no label. */
function hostFor(url: string): string {
  const parsed = parseHttpUrl(url);
  return parsed.ok ? parsed.host : url;
}

/**
 * Save an accepted source, keyed on the newsroom's URL.
 *
 * Both add boxes -- the Sources page's and the one inside a section -- send the
 * label the editor typed, and on the Sources page that field is optional. The
 * empty label is inert: it never becomes a title, and it never overwrites one.
 *
 * It used to. The caller supplied the host name for an empty label, so
 * re-adding a URL already on watch renamed the source to its own host --
 * "City Council packets" became "www.example-city-council.test" because the
 * editor left a field blank they were told was optional. Two rules replace
 * that: a label that was given still renames the row (today's Sources-page
 * behaviour, pinned in sections.test.ts), and an empty one leaves the existing
 * title alone. Only a row that has no title yet -- a first-time source -- takes
 * the host, because a source with no name at all is not usable in the watch
 * list or in the section panels.
 *
 * The `on conflict` branch repeats the rule rather than trusting the lookup
 * above it: that branch only runs on a race, which is exactly when the row
 * exists and its title must not be clobbered.
 */
export async function saveAcceptedNewsroomSource(input: {
  userId: string;
  newsroomId: number;
  url: string;
  title: string;
  kind: string;
  tier: string;
}) {
  const label = input.title.trim();
  return withTransaction(async (sql) => {
    await sql`select newsroom_id from paper_settings where newsroom_id=${input.newsroomId} for update`;
    const existing = await sql<{ id: number; title: string }>`select id,title from sources where newsroom_id=${input.newsroomId} and url=${input.url} order by id limit 1`;
    const rows = existing[0]
      ? await sql`update sources set title=${label || existing[0].title},kind=${input.kind},tier=${input.tier},status='accepted' where id=${existing[0].id} and newsroom_id=${input.newsroomId} returning *`
      : await sql`insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values(${input.userId},${input.newsroomId},${input.url},${label || hostFor(input.url)},${input.kind},${input.tier},'accepted') on conflict(user_id,newsroom_id,url) do update set title=case when ${label}='' then sources.title else excluded.title end,kind=excluded.kind,tier=excluded.tier,status='accepted' returning *`;
    return rows[0] ?? null;
  });
}

/** Who found a suggested source. See migrations/0097 for why this is text. */
export type ProposedBy = "scan" | "research" | "dark" | "editor";

/** The model's reason, capped the way the scan schema caps it (schema.ts). */
const REASON_MAX = 400;
/** A section key guess, capped so a runaway model reply cannot bloat a row. */
const SECTION_MAX = 120;

export async function insertProposedNewsroomSource(sql: Sql, input: {
  userId: string;
  newsroomId: number;
  url: string;
  title: string;
  reason?: string;
  proposedBy?: ProposedBy;
  scanRunId?: number | null;
  leadId?: number | null;
  section?: string | null;
}): Promise<boolean> {
  // A suggestion has to name a page something could actually be fetched from.
  // The identity is the duplicate guard's unit, and a URL with no identity is
  // not one the guard could ever match -- so it is refused here rather than
  // inserted as a row nobody can review.
  const identity = sourceIdentity(input.url);
  if (!identity) return false;

  // A results page is not a page. This refusal lives here, at the one function
  // every suggestion goes through, rather than at each of the three callers:
  // the rule is the same for all of them, and a fourth caller cannot forget it.
  // `false` is the same answer as "already a source" -- nothing was proposed --
  // which is exactly what it means.
  if (isSearchResultUrl(input.url)) return false;

  // Serialize suggestions for this newsroom, the way seeding and accepting do.
  // The dedupe below is read-then-write, so two passes proposing the same page
  // at once would both see it missing without this lock. The social check reads
  // the watch list too, so it belongs on this side of the lock.
  await sql`select newsroom_id from paper_settings where newsroom_id=${input.newsroomId} for update`;

  /*
    A social profile is only a source for a paper that already watches social
    sources. `kindFromSourceUrl` is the one place in this codebase that decides
    what counts as one (Twitter/X, Facebook, Instagram, Nextdoor, Reddit) and
    what tier follows from it, so the rule is read from there rather than
    written out again here -- a second list is a second thing to keep in step.

    Why it is conditional: the Longmont edition ships with `@CityofLongmont` and
    `@LongmontPublicMedia` on the watch list, so a scan finding a city account
    is proposing exactly what the owner asked it to watch. A paper that watches
    no social sources has made the opposite choice, and a pass that read a
    Facebook group on its way to a story should not quietly put one on the list.

    "Watches" means accepted. A dropped social source is not a standing
    decision to watch social, and a suggestion already waiting is not one
    either -- only rows the owner has accepted count.
  */
  if (kindFromSourceUrl(input.url) === "social") {
    const [watched] = await sql<{ n: number }>`
      select count(*)::int n from sources
      where newsroom_id=${input.newsroomId} and kind='social' and status='accepted'
    `;
    if (!watched?.n) return false;
  }

  // The same page, however it was spelled, is not proposed again. ONE rule,
  // applied to the suggestion and to every row this newsroom already has --
  // accepted, dropped or already waiting. The URL column is not the unit of
  // "already a source"; `sourceIdentity` is, because `http://x/`, `https://x`
  // and `https://www.x/` are three distinct strings and one page.
  //
  // Read whole rather than narrowed in SQL on purpose: expressing this rule a
  // second time in SQL is how the two drift apart, and at a few hundred rows
  // per newsroom the read is not worth the risk of a second spelling.
  const existing = await sql<{ url: string }>`
    select url from sources where newsroom_id=${input.newsroomId}
  `;
  for (const row of existing) {
    if (sourceIdentity(row.url) === identity) return false;
  }

  const reason = input.reason?.trim().slice(0, REASON_MAX) || null;
  const by = input.proposedBy ?? null;
  const scanRunId = input.scanRunId ?? null;
  const leadId = input.leadId ?? null;
  const section = input.section?.trim().slice(0, SECTION_MAX) || null;

  const rows = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status,proposed_reason,proposed_by,proposed_scan_run_id,proposed_lead_id,proposed_section)
    select ${input.userId},${input.newsroomId},${input.url},${input.title},'discovered','unclassified','proposed',${reason},${by},${scanRunId},${leadId},${section}
    where not exists (select 1 from sources where newsroom_id=${input.newsroomId} and url=${input.url})
    on conflict(user_id,newsroom_id,url) do nothing
    returning id
  `;
  return rows.length === 1;
}

/** How many pages one pass may suggest. The scan's reply is capped at 12 too. */
const PASS_SUGGESTION_MAX = 12;

/**
 * The pages one research pass read, offered to the owner as suggestions.
 *
 * The three passes end differently -- the scan with a model reply listing what
 * it saw, the research pass with the documents it opened and the pages it cited,
 * the Dark Desk with the artifacts it read -- so each one hands this function
 * the pages it actually touched, in its own words. What they have in common is
 * everything below: the same cap, the same insert, the same duplicate guard,
 * the same refusal of a search-results page, and a `proposed_by` that says
 * which pass it was.
 *
 * Only pages the pass FETCHED or CITED belong here. A URL the pass merely
 * considered, or one it read out of a search result, is not evidence that the
 * page exists in the form the desk would fetch tomorrow -- and `insert` refuses
 * the results-page shapes anyway, so a caller that gets this wrong loses the
 * suggestion rather than writing a source nobody can use.
 *
 * Returns how many were newly proposed. A page already on the watch list, or
 * already waiting, is not an error and not a suggestion: it returns nothing and
 * the count is simply lower.
 */
export async function proposePassSources(sql: Sql, input: {
  userId: string;
  newsroomId: number;
  proposedBy: ProposedBy;
  leadId?: number | null;
  scanRunId?: number | null;
  section?: string | null;
  pages: { url: string; title?: string; reason?: string }[];
}): Promise<number> {
  let proposed = 0;
  const seen = new Set<string>();
  for (const page of input.pages) {
    if (proposed >= PASS_SUGGESTION_MAX) break;
    const identity = sourceIdentity(page.url);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    const url = assertHttpUrl(page.url).toString();
    const wrote = await insertProposedNewsroomSource(sql, {
      userId: input.userId,
      newsroomId: input.newsroomId,
      url,
      title: page.title?.trim().slice(0, 200) || new URL(url).hostname,
      reason: page.reason,
      proposedBy: input.proposedBy,
      scanRunId: input.scanRunId ?? null,
      leadId: input.leadId ?? null,
      section: input.section ?? null,
    });
    if (wrote) proposed += 1;
  }
  return proposed;
}
