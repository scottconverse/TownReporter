import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ROUTINE_EDITION_UPDATE_PREFIX, correctionIsAutomatic } from "./correction-origin.ts";
import { CORRECTION_ROUTINE_PREFIX_KEY, performAddCorrection } from "./corrections.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

/**
 * U18a-1: `articles` is the real table now, so a row needs the columns it
 * declares `not null` (`body`, `topic` among them), and 0045's trigger refuses
 * a topic whose section the newsroom does not have. These two helpers write
 * the room, its section and the story the way the desk would.
 */
async function ensureRoom(sql: Awaited<ReturnType<typeof getSql>>, newsroomId: number) {
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    newsroomId,
    `Test room ${newsroomId}`,
  ]);
  await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [
    newsroomId,
  ]);
  await sql.query(
    `insert into newsroom_sections(newsroom_id,key,name,position,visible)
     values($1,'council','Council',0,true) on conflict (newsroom_id,key) do nothing`,
    [newsroomId],
  );
}

async function ensureFixtureTables() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists articles (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      slug text not null unique,
      headline text not null,
      status text not null default 'published',
      /* 0098. Hand-built schema tracks production, column for column. */
      area text
    )
  `);
  await sql.query(`
    create table if not exists corrections (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      article_id integer,
      body text not null,
      created_at timestamptz not null default now()
    )
  `);
  return sql;
}

describe("corrections stay inside the editor's newsroom", () => {
  it("attaches only to this newsroom's published articles and rejects every unavailable slug without writes", async () => {
    const sql = await ensureFixtureTables();
    const stamp = `${Date.now()}-${Math.random()}`;
    const newsroomA = 820_001;
    const newsroomB = 820_002;
    const editorA = `correction-editor-a-${stamp}`;
    const slugA = `own-published-${stamp}`;
    const slugB = `foreign-published-${stamp}`;
    const unpublishedSlug = `own-unpublished-${stamp}`;
    await ensureRoom(sql, newsroomA);
    await ensureRoom(sql, newsroomB);
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, body, topic, status)
      values (${newsroomA}, ${editorA}, ${slugA}, ${"Own published story"}, 'Body', 'council', 'published')
    `;
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, body, topic, status)
      values (${newsroomB}, ${"editor-b"}, ${slugB}, ${"Foreign published story"}, 'Body', 'council', 'published')
    `;
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, body, topic, status)
      values (${newsroomA}, ${editorA}, ${unpublishedSlug}, ${"Own draft story"}, 'Body', 'council', 'draft')
    `;

    const own = await performAddCorrection(
      { userId: editorA, newsroomId: newsroomA },
      { articleSlug: slugA, body: "The date in this story was corrected." },
    );
    assert.deepEqual(own, { ok: true });

    for (const slug of [slugB, unpublishedSlug, `missing-${stamp}`]) {
      const result = await performAddCorrection(
        { userId: editorA, newsroomId: newsroomA },
        { articleSlug: slug, body: "The date in this story was incorrect." },
      );
      assert.deepEqual(result, {
        ok: false,
        error: "That published story is not available in this newsroom.",
      });
    }

    const general = await performAddCorrection(
      { userId: editorA, newsroomId: newsroomA },
      { body: "A general correction note remains available." },
    );
    assert.deepEqual(general, { ok: true });

    const corrections = await sql<{ article_id: number | null }>`
      select article_id from corrections where user_id = ${editorA} and newsroom_id = ${newsroomA}
      order by id asc
    `;
    assert.equal(corrections.length, 2, "only the own-story and general correction may be written");
    assert.notEqual(
      corrections[0]!.article_id,
      null,
      "the own correction must attach to its published article",
    );
    assert.equal(
      corrections[1]!.article_id,
      null,
      "a no-slug general correction remains permitted",
    );
    const audits = await sql<{ id: number }>`
      select id from audit_events where user_id = ${editorA} and newsroom_id = ${newsroomA} and action = 'correction'
    `;
    assert.equal(audits.length, 2, "rejected slugs must not write audit events");
  });
});


describe("an editor's correction cannot wear the machine's marker", () => {
  it("asks before the marker, stores the editor's own words once accepted, and still accepts a note that merely mentions it", async () => {
    const sql = await ensureFixtureTables();
    const stamp = `${Date.now()}-${Math.random()}`;
    const newsroom = 820_003;
    const editor = `correction-editor-marker-${stamp}`;
    const slug = `own-published-${stamp}`;
    await ensureRoom(sql, newsroom);
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, body, topic, status)
      values (${newsroom}, ${editor}, ${slug}, ${"Own published story"}, 'Body', 'council', 'published')
    `;

    const body = `${ROUTINE_EDITION_UPDATE_PREFIX}\n\nThe concert moved.`;
    const asked = await performAddCorrection(
      { userId: editor, newsroomId: newsroom },
      { articleSlug: slug, body },
    );
    assert.equal(asked.ok, false);
    assert.ok("warning" in asked, "the marker is a question, not a wall");
    if (asked.ok || !("warning" in asked)) throw new Error("expected a warning");
    assert.equal(asked.warning.key, CORRECTION_ROUTINE_PREFIX_KEY);
    const beforeWrite = await sql<{ id: number }>`
      select id from corrections where user_id = ${editor} and newsroom_id = ${newsroom}
    `;
    assert.equal(beforeWrite.length, 0, "the first call must not have reached the table");

    const posted = await performAddCorrection(
      { userId: editor, newsroomId: newsroom },
      { articleSlug: slug, body, override: [CORRECTION_ROUTINE_PREFIX_KEY] },
    );
    assert.deepEqual(posted, { ok: true });

    // The prefix is the row's OPENING. A correction that talks about a routine
    // update in its own words is an ordinary correction and posts with no
    // warning at all.
    const mentions = await performAddCorrection(
      { userId: editor, newsroomId: newsroom },
      {
        articleSlug: slug,
        body: "A reader asked about the routine edition update: the concert start time was right.",
      },
    );
    assert.deepEqual(mentions, { ok: true });

    const written = await sql<{ body: string }>`
      select body from corrections where user_id = ${editor} and newsroom_id = ${newsroom}
      order by id asc
    `;
    assert.equal(written.length, 2, "the accepted marker and the ordinary mention both posted");
    assert.equal(
      correctionIsAutomatic(written[0]!.body),
      false,
      "the row a person wrote must not be read as automatic",
    );
    assert.ok(!written[0]!.body.startsWith(ROUTINE_EDITION_UPDATE_PREFIX));
    assert.equal(written[0]!.body, "The concert moved.");
    const overrides = await sql<{ id: number }>`
      select id from audit_events where user_id = ${editor} and newsroom_id = ${newsroom} and action = 'override'
    `;
    assert.equal(overrides.length, 1, "the accepted warning is one audited override");
    const correctionsAudit = await sql<{ id: number }>`
      select id from audit_events where user_id = ${editor} and newsroom_id = ${newsroom} and action = 'correction'
    `;
    assert.equal(correctionsAudit.length, 2, "both posts are the desk's ordinary correction audit");
  });
});
