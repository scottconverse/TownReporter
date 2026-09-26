/**
 * Unit AO (0.6.70): a suggested source says WHY it was suggested and WHO
 * suggested it, all three passes propose through one door, and a list of 175
 * waiting rows can be decided in a batch without half of it landing.
 *
 * The three claims this file exists to make executable rather than assertable:
 *
 *   1. The duplicate guard is about the PAGE, not the URL string. `http://x/`,
 *      `https://x` and `https://www.x/` are three spellings of one page, and a
 *      suggestion that is already a source -- waiting, accepted or dropped --
 *      is not proposed again.
 *   2. The research pass and the Dark Desk reach the same insert the scan does,
 *      each with its own `proposed_by`, and what they offer is what they
 *      actually read.
 *   3. The review press is ONE transaction. "A failure changes nothing" is a
 *      claim about the database, so the batch test below runs the real
 *      `withTransaction` against a real (PGlite) database and then breaks the
 *      section write on purpose.
 *
 * Schema comes from `migrations/*.sql` read off disk and applied with
 * `pg.exec`, the way `routine-notice-automation.test.ts` does it. `getSql()`
 * does NOT apply migrations under plain `node --test` -- the `import.meta.glob`
 * that loads them is a Vite-only macro -- so a test that builds its own
 * `sources` table must apply 0097 itself or it will be testing a table
 * production does not have (the lesson from AK3).
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { before, describe, it } from "node:test";
import { getPglite, getSql } from "../db.ts";
import { queueInvestigationFor } from "./dark.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { parseScanResult } from "./schema.ts";
import { insertProposedNewsroomSource, proposePassSources } from "./source-seeds.server.ts";
import { performReviewSuggestedSources } from "./suggested-sources.server.ts";
import { isSearchResultUrl, sourceIdentity } from "./url-guard.ts";

const USER = "ao-suggestions-owner";
/** A newsroom of its own, so the section rows below are the ones this file made. */
const ROOM = 9640;
/** The ten sections 0045 seeds, by key. */
const SECTIONS = [
  "council",
  "budget",
  "housing",
  "utilities",
  "schools",
  "planning",
  "infrastructure",
  "elections",
  "opinion",
  "about",
];

type SourceRow = {
  id: number;
  url: string;
  title: string;
  kind: string;
  tier: string;
  status: string;
  proposed_reason: string | null;
  proposed_by: string | null;
  proposed_scan_run_id: number | null;
  proposed_lead_id: number | null;
  proposed_section: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
};

before(async () => {
  const pg = await getPglite();
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(name, dir), "utf8"));

  const sql = await getSql();
  /*
    The sections schema, seeded the way 0045's `resolve_story_section` trigger
    seeds it, for the two newsrooms this file uses. Room 1 is seeded here
    rather than left to the trigger so the Dark Desk fixture below picks its
    section the same way every run instead of depending on what the trigger
    happened to create first.
  */
  await sql.query(
    `insert into section_config(newsroom_id, revision) values (1, 0), (${ROOM}, 7) on conflict do nothing`,
  );
  await sql.query(
    `insert into newsroom_sections(newsroom_id, key, name, position, visible)
     select room, k, initcap(k), n::integer, k <> 'about'
     from unnest(array[1, ${ROOM}]) as room
     cross join unnest(array[${SECTIONS.map((k) => `'${k}'`).join(", ")}]) with ordinality as t(k, n)
     on conflict do nothing`,
  );
});

/** Propose one page and hand back the row it wrote. */
async function suggest(input: {
  url: string;
  title?: string;
  reason?: string;
  proposedBy?: "scan" | "research" | "dark" | "editor";
  scanRunId?: number | null;
  leadId?: number | null;
  section?: string | null;
  newsroomId?: number;
}): Promise<SourceRow> {
  const sql = await getSql();
  const newsroomId = input.newsroomId ?? ROOM;
  const stored = input.url.startsWith("http") ? new URL(input.url).toString() : input.url;
  await insertProposedNewsroomSource(sql, {
    userId: USER,
    newsroomId,
    url: stored,
    title: input.title ?? "Untitled page",
    reason: input.reason,
    proposedBy: input.proposedBy,
    scanRunId: input.scanRunId ?? null,
    leadId: input.leadId ?? null,
    section: input.section ?? null,
  });
  const rows = await sql<SourceRow>`
    select * from sources where newsroom_id = ${newsroomId} and url = ${stored} order by id limit 1
  `;
  assert.ok(rows[0], `no source row was written for ${stored}`);
  return rows[0];
}

async function statusOf(id: number, newsroomId = ROOM): Promise<SourceRow | undefined> {
  const sql = await getSql();
  const rows = await sql<SourceRow>`
    select * from sources where newsroom_id = ${newsroomId} and id = ${id}
  `;
  return rows[0];
}

async function revisionOf(newsroomId = ROOM): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ revision: number }>`
    select revision from section_config where newsroom_id = ${newsroomId}
  `;
  return rows[0]?.revision ?? -1;
}

describe("the duplicate guard is about the page, not the URL string", () => {
  it("treats three spellings of one page as one page", () => {
    const identity = sourceIdentity("https://www.example.org/council/packets/");
    assert.ok(identity);
    assert.equal(sourceIdentity("http://example.org/council/packets"), identity);
    assert.equal(sourceIdentity("https://EXAMPLE.ORG/council/packets?page=2"), identity);
    assert.equal(sourceIdentity("https://example.org/council/packets#top"), identity);
    assert.notEqual(sourceIdentity("https://example.org/council/budget"), identity);
  });

  it("refuses a URL with no page behind it", () => {
    assert.equal(sourceIdentity("mailto:clerk@example.org"), null);
    assert.equal(sourceIdentity("not a url"), null);
  });

  it("refuses to suggest a search-results page", async () => {
    assert.equal(isSearchResultUrl("https://www.google.com/search?q=council+packets"), true);
    assert.equal(isSearchResultUrl("https://news.google.com/search?q=budget"), true);
    assert.equal(isSearchResultUrl("https://example.org/council/packets"), false);

    const sql = await getSql();
    const url = "https://www.google.com/search?q=ao-search-page";
    const wrote = await insertProposedNewsroomSource(sql, {
      userId: USER,
      newsroomId: ROOM,
      url,
      title: "Council packets search",
    });
    assert.equal(wrote, false, "a results page is not a page");
    const rows = await sql`select id from sources where newsroom_id = ${ROOM} and url = ${url}`;
    assert.equal(rows.length, 0);
  });

  /*
    A social profile is only a source for a paper that already watches social
    sources. The Longmont edition ships with `@CityofLongmont` and
    `@LongmontPublicMedia` on the watch list, so this is a real case in both
    directions, not a hypothetical: a paper that watches social should still
    get a city account proposed, and one that does not should not have a
    Facebook group appear on its list because a pass read one on the way to a
    story.
  */
  it("suggests a social profile only to a newsroom that already watches one", async () => {
    const sql = await getSql();
    const room = ROOM + 1;
    const page = "https://www.facebook.com/groups/ao-neighborhood";

    const refused = await insertProposedNewsroomSource(sql, {
      userId: USER,
      newsroomId: room,
      url: page,
      title: "Neighborhood group",
    });
    assert.equal(refused, false, "this newsroom watches no social source");

    // A suggestion already waiting is not a standing decision to watch social.
    await sql.query(
      "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values($1,$2,$3,'Unrelated suggestion','social','C','proposed')",
      [USER, room, "https://www.facebook.com/groups/ao-other"],
    );
    const stillRefused = await insertProposedNewsroomSource(sql, {
      userId: USER,
      newsroomId: room,
      url: `${page}/posts/1`,
      title: "Neighborhood group post",
    });
    assert.equal(stillRefused, false, "waiting is not watching");

    // A dropped social source is not one either.
    await sql.query(
      "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values($1,$2,$3,'Dropped social source','social','C','dropped')",
      [USER, room, "https://www.facebook.com/groups/ao-dropped"],
    );
    const dropped = await insertProposedNewsroomSource(sql, {
      userId: USER,
      newsroomId: room,
      url: "https://www.instagram.com/ao-neighborhood/",
      title: "Neighborhood on Instagram",
    });
    assert.equal(dropped, false, "dropped is not watched");

    // Accepted is. The owner has decided this paper watches social sources.
    await sql.query(
      "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values($1,$2,$3,'City account','social','B','accepted')",
      [USER, room, "https://x.com/ao-city"],
    );
    const allowed = await insertProposedNewsroomSource(sql, {
      userId: USER,
      newsroomId: room,
      url: page,
      title: "Neighborhood group",
      reason: "The group posts the school board's own meeting notices.",
      proposedBy: "scan",
    });
    assert.equal(allowed, true, "the paper watches social sources now");
    const rows = await sql<{ kind: string; status: string }>`
      select kind, status from sources where newsroom_id = ${room} and url = ${page}
    `;
    assert.deepEqual(rows, [{ kind: "discovered", status: "proposed" }]);
  });

  it("does not propose a page this newsroom already has, however it is spelled", async () => {
    const first = await suggest({ url: "https://www.example.org/ao/one-pager/", title: "One pager" });
    const sql = await getSql();
    const again = await insertProposedNewsroomSource(sql, {
      userId: USER,
      newsroomId: ROOM,
      url: "http://example.org/ao/one-pager",
      title: "One pager again",
    });
    assert.equal(again, false);
    const rows = await sql<{ id: number }>`
      select id from sources where newsroom_id = ${ROOM} and url like '%one-pager%'
    `;
    assert.deepEqual(rows.map((r) => r.id), [first.id]);
  });
});

describe("a suggestion records why and where it came from", () => {
  it("carries the reason, the pass, the run, the lead and the section guess", async () => {
    const row = await suggest({
      url: "https://records.example.org/ao/budget-book",
      title: "Adopted budget book",
      reason: "The city's adopted budget with line-item detail the paper can cite.",
      proposedBy: "scan",
      scanRunId: 52,
      leadId: 3009,
      section: "budget",
    });

    assert.equal(row.status, "proposed");
    assert.equal(row.kind, "discovered");
    assert.equal(row.tier, "unclassified");
    assert.equal(row.proposed_reason, "The city's adopted budget with line-item detail the paper can cite.");
    assert.equal(row.proposed_by, "scan");
    assert.equal(row.proposed_scan_run_id, 52);
    assert.equal(row.proposed_lead_id, 3009);
    assert.equal(row.proposed_section, "budget");
    assert.equal(row.reviewed_at, null);
    assert.equal(row.review_note, null);
  });

  it("still takes a reply written before 0.6.70, and reads it as not recorded", async () => {
    // The old shape: a URL and a title, no `why`, no `section`. It has to parse
    // (the scan's reply is a model's, and old prompts go out with old output
    // coming back) and it has to insert as nulls rather than as invented text.
    const parsed = parseScanResult({
      editor_summary: "",
      proposed_sources: [{ url: "https://old.example.org/ao/undescribed", title: "Undescribed page" }],
    });
    assert.equal(parsed.parseError, null);
    assert.equal(parsed.proposed_sources.length, 1);
    assert.equal(parsed.proposed_sources[0]!.why, "");
    assert.equal(parsed.proposed_sources[0]!.section, "");

    const row = await suggest({
      url: parsed.proposed_sources[0]!.url,
      title: parsed.proposed_sources[0]!.title,
      reason: parsed.proposed_sources[0]!.why,
      proposedBy: "scan",
      section: parsed.proposed_sources[0]!.section || null,
    });

    assert.equal(row.proposed_reason, null, "an old reply has no reason -- null means not recorded");
    assert.equal(row.proposed_by, "scan");
    assert.equal(row.proposed_section, null);
  });

  it("wires the scan's own reply through to the insert", async () => {
    // The scan's loop is inside `desk.ts`, which plain `node --test` cannot
    // load (it reaches `@/lib/...` aliases). The executed half of this claim is
    // the insert directly above; this pins the wiring that feeds it.
    const desk = await readFile(new URL("./desk.ts", import.meta.url), "utf8");
    assert.match(
      desk,
      /insertProposedNewsroomSource\(writeSql, \{[^}]*reason: p\.why,[^}]*proposedBy: "scan",[^}]*scanRunId: runId,[^}]*section: p\.section \|\| null,/s,
    );
  });
});

describe("one door for three passes", () => {
  it("proposes what a research pass read, tagged research", async () => {
    const sql = await getSql();
    const proposed = await proposePassSources(sql, {
      userId: USER,
      newsroomId: ROOM,
      proposedBy: "research",
      leadId: 4242,
      section: "council",
      pages: [
        {
          url: "https://records.example.org/ao/minutes-2026-08-19",
          title: "Council minutes, August 19",
          reason: 'Opened while reporting "The council postponed the vote again".',
        },
        { url: "https://records.example.org/ao/agenda.pdf" },
      ],
    });

    assert.equal(proposed, 2);
    const rows = await sql<SourceRow>`
      select * from sources
      where newsroom_id = ${ROOM} and proposed_by = 'research' and proposed_lead_id = 4242
      order by id
    `;
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.proposed_section, "council");
    assert.match(rows[0]!.proposed_reason ?? "", /Opened while reporting/);
    // A page handed over with no wording of its own is named by its host, not
    // left blank -- a nameless row is not reviewable.
    assert.equal(rows[1]!.title, "records.example.org");
    assert.equal(rows[1]!.proposed_scan_run_id, null);
  });

  it("offers each page once, and no more than twelve, in one pass", async () => {
    const sql = await getSql();
    const spellings = await proposePassSources(sql, {
      userId: USER,
      newsroomId: ROOM,
      proposedBy: "research",
      pages: [
        { url: "https://www.example.org/ao/twice/" },
        { url: "http://example.org/ao/twice" },
        { url: "https://example.org/ao/twice?utm_source=newsletter" },
      ],
    });
    assert.equal(spellings, 1, "three spellings of one page are one suggestion");

    const many = await proposePassSources(sql, {
      userId: USER,
      newsroomId: ROOM,
      proposedBy: "research",
      pages: Array.from({ length: 20 }, (_, n) => ({
        url: `https://records.example.org/ao/batch/${n}`,
      })),
    });
    assert.equal(many, 12, "one pass may offer twelve pages, the way a scan reply may");

    // And the ones past the cap are not silently waiting for the next pass
    // either: nothing was written for them.
    const overflow = await sql<{ id: number }>`
      select id from sources where newsroom_id = ${ROOM} and url = ${"https://records.example.org/ao/batch/19"}
    `;
    assert.equal(overflow.length, 0);
  });

  it("wires the research pass's own ending through to the insert", async () => {
    const desk = await readFile(new URL("./desk.ts", import.meta.url), "utf8");
    assert.match(
      desk,
      /await proposePassSources\(sql, \{[^}]*proposedBy: "research",[^}]*leadId,[^}]*section: guessSection \? reported\.topic : null,/s,
    );
  });

  it(
    "proposes the pages the Dark Desk read when it hands a file to the queue",
    { timeout: 60000 },
    async () => {
      await ensureInvestigateSchema();
      const user = `ao-dark-${Date.now()}`;
      const opened = await openInvestigationForEditor(
        user,
        { paste: "Council procurement file.", title: "Council procurement file" },
        DEFAULT_NEWSROOM_ID,
      );
      const sql = await getSql();
      const url = `https://records.example.org/ao/dark-procurement-${Date.now()}.pdf`;
      await sql`
        insert into artifacts(user_id, newsroom_id, investigation_id, url, title, content_hash)
        values (${user}, ${DEFAULT_NEWSROOM_ID}, ${opened.investigationId}, ${url}, 'Procurement file', ${`hash-${Date.now()}`})
      `;

      const sent = await queueInvestigationFor(user, DEFAULT_NEWSROOM_ID, opened.investigationId);
      assert.ok(sent.ok, "the handoff itself still works");

      const rows = await sql<SourceRow>`
        select * from sources where newsroom_id = ${DEFAULT_NEWSROOM_ID} and url = ${url}
      `;
      assert.equal(rows.length, 1, "the page the Dark Desk read comes with the file");
      assert.equal(rows[0]!.proposed_by, "dark");
      assert.equal(rows[0]!.proposed_lead_id, sent.ok ? sent.leadId : 0);
      assert.equal(rows[0]!.proposed_scan_run_id, null, "a Dark pass has no scan run");
      assert.equal(rows[0]!.status, "proposed");
      assert.match(rows[0]!.proposed_reason ?? "", /Read while developing/);
    },
  );
});

describe("the review press decides a batch in one transaction", () => {
  it("accepts several suggestions into a section, and bumps the revision", async () => {
    const first = await suggest({
      url: "https://records.example.org/ao/accept-packets",
      title: "Council packets",
    });
    const second = await suggest({
      url: "https://records.example.org/ao/accept-budget",
      title: "Budget book",
    });
    const revision = await revisionOf();

    const result = await performReviewSuggestedSources(
      { userId: USER, newsroomId: ROOM, role: "owner" },
      { ids: [first.id, second.id], decision: "accepted", sectionKey: "council", note: "On the beat" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.reviewed, 2);
    assert.equal(result.ok && result.sectionName, "Council");

    const sql = await getSql();
    const rows = await sql<SourceRow>`
      select * from sources where newsroom_id = ${ROOM} and id = any(${[first.id, second.id]}::int[])
      order by id
    `;
    for (const row of rows) {
      assert.equal(row.status, "accepted");
      assert.ok(row.reviewed_at, "an accepted suggestion records when it was decided");
      assert.equal(row.review_note, "On the beat");
    }
    const filed = await sql<{ source_id: number }>`
      select source_id from section_sources
      where newsroom_id = ${ROOM} and section_key = 'council' and source_id = any(${[first.id, second.id]}::int[])
      order by source_id
    `;
    assert.deepEqual(filed.map((f) => f.source_id), [first.id, second.id]);
    assert.equal(await revisionOf(), revision + 1, "the sections save is invalidated, not raced");
  });

  it("rejects with a note and files nothing", async () => {
    const row = await suggest({
      url: "https://records.example.org/ao/reject-dance",
      title: "T2 Dance Company RSS feed",
      reason: "A dance studio's class feed.",
      proposedBy: "scan",
      section: "opinion",
    });

    const result = await performReviewSuggestedSources(
      { userId: USER, newsroomId: ROOM, role: "owner" },
      { ids: [row.id], decision: "rejected", note: "Not a news source for this paper." },
    );

    assert.equal(result.ok, true);
    const after = await statusOf(row.id);
    assert.equal(after?.status, "rejected");
    assert.equal(after?.review_note, "Not a news source for this paper.");
    assert.ok(after?.reviewed_at);
    // The reason survives the rejection: "why was this dropped?" is answerable.
    assert.equal(after?.proposed_reason, "A dance studio's class feed.");
    const sql = await getSql();
    const filed = await sql`
      select source_id from section_sources where newsroom_id = ${ROOM} and source_id = ${row.id}
    `;
    assert.equal(filed.length, 0);
  });

  it("refuses a section from someone who is not the owner, and changes nothing", async () => {
    const row = await suggest({
      url: "https://records.example.org/ao/editor-files",
      title: "Editor tries to file",
    });

    const result = await performReviewSuggestedSources(
      { userId: "ao-suggestions-editor", newsroomId: ROOM, role: "editor" },
      { ids: [row.id], decision: "accepted", sectionKey: "council" },
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && /owner/i.test(result.error));
    const after = await statusOf(row.id);
    assert.equal(after?.status, "proposed");
    assert.equal(after?.reviewed_at, null);
    const sql = await getSql();
    const filed = await sql`
      select source_id from section_sources where newsroom_id = ${ROOM} and source_id = ${row.id}
    `;
    assert.equal(filed.length, 0);
  });

  it("refuses a section this newsroom does not file under, and changes nothing", async () => {
    const row = await suggest({
      url: "https://records.example.org/ao/unknown-section",
      title: "Unknown section",
    });
    const revision = await revisionOf();

    const result = await performReviewSuggestedSources(
      { userId: USER, newsroomId: ROOM, role: "owner" },
      { ids: [row.id], decision: "accepted", sectionKey: "gossip" },
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && /not one this newsroom files under/.test(result.error));
    const after = await statusOf(row.id);
    assert.equal(after?.status, "proposed");
    assert.equal(await revisionOf(), revision);
  });

  it("decides all of the batch or none of it", async () => {
    const row = await suggest({
      url: "https://records.example.org/ao/stale-row",
      title: "Stale row",
    });

    const result = await performReviewSuggestedSources(
      { userId: USER, newsroomId: ROOM, role: "owner" },
      { ids: [row.id, 9_999_998], decision: "accepted", sectionKey: "council" },
    );

    assert.equal(result.ok, false);
    assert.ok(!result.ok && /not on this list any more/.test(result.error));
    const after = await statusOf(row.id);
    assert.equal(after?.status, "proposed", "the one row that did exist is untouched too");
  });

  it("leaves nothing behind when a write fails after the status change", async () => {
    const row = await suggest({
      url: "https://records.example.org/ao/failure-case",
      title: "Failure case",
    });
    const revision = await revisionOf();
    const sql = await getSql();
    assert.equal((await statusOf(row.id))?.status, "proposed", "there is something for the press to decide");

    /*
      A failure BETWEEN the two halves of the accept -- a lock timeout, a
      dropped connection, or here a section table that is not there. The status
      update has already run when this throws, so if the press were a loop
      instead of a transaction the row would read "accepted" with nothing filed
      and no way to tell from the screen.
    */
    await sql.query("drop table section_sources");
    const result = await performReviewSuggestedSources(
      { userId: USER, newsroomId: ROOM, role: "owner" },
      { ids: [row.id], decision: "accepted", sectionKey: "council" },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reviewed, 0);
    // Pin WHERE it failed: the section write, not something before it. Without
    // this the test would pass just as well on a press that never got as far
    // as writing anything.
    assert.ok(!result.ok && /section_sources/.test(result.error), result.ok ? "" : result.error);

    const after = await statusOf(row.id);
    assert.equal(after?.status, "proposed", "the status update rolled back with the section write");
    assert.equal(after?.reviewed_at, null);
    assert.equal(await revisionOf(), revision, "and so did the revision bump");

    // Put the table back, so a later test in this file is not reading a schema
    // this one broke. Same shape 0045 creates.
    await sql.query(
      `create table if not exists section_sources (newsroom_id integer not null, section_key text not null,
        source_id integer not null references sources(id) on delete cascade,
        primary key (newsroom_id,section_key,source_id),
        foreign key (newsroom_id,section_key) references newsroom_sections(newsroom_id,key))`,
    );
  });
});
