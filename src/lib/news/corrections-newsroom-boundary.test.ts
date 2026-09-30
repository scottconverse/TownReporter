import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ROUTINE_EDITION_UPDATE_PREFIX } from "./correction-origin.ts";
import { performAddCorrection } from "./corrections.ts";

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
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, status)
      values (${newsroomA}, ${editorA}, ${slugA}, ${"Own published story"}, 'published')
    `;
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, status)
      values (${newsroomB}, ${"editor-b"}, ${slugB}, ${"Foreign published story"}, 'published')
    `;
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, status)
      values (${newsroomA}, ${editorA}, ${unpublishedSlug}, ${"Own draft story"}, 'draft')
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
      assert.deepEqual(result, { ok: false, error: "That published story is not available in this newsroom." });
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
    assert.notEqual(corrections[0]!.article_id, null, "the own correction must attach to its published article");
    assert.equal(corrections[1]!.article_id, null, "a no-slug general correction remains permitted");
    const audits = await sql<{ id: number }>`
      select id from audit_events where user_id = ${editorA} and newsroom_id = ${newsroomA} and action = 'correction'
    `;
    assert.equal(audits.length, 2, "rejected slugs must not write audit events");
  });
});

/*
  A different boundary, in the same write path: what the desk lets an editor
  put in the box. The `corrections` table has no column saying who wrote a row,
  so `/corrections` and the story page decide it from the row's opening words
  (src/lib/news/correction-origin.ts). An editor who typed those words would
  wear the machine's byline, so `performAddCorrection` refuses the marker --
  the row's opening, not any mention of the phrase -- before it opens a
  transaction. Exercised here rather than in the form because this is the
  function every caller goes through.
*/
describe("an editor's correction cannot wear the machine's marker", () => {
  it("refuses the marker, writes nothing, and still accepts a note that merely mentions it", async () => {
    const sql = await ensureFixtureTables();
    const stamp = `${Date.now()}-${Math.random()}`;
    const newsroom = 820_003;
    const editor = `correction-editor-marker-${stamp}`;
    const slug = `own-published-${stamp}`;
    await sql`
      insert into articles (newsroom_id, user_id, slug, headline, status)
      values (${newsroom}, ${editor}, ${slug}, ${"Own published story"}, 'published')
    `;

    const marker = await performAddCorrection(
      { userId: editor, newsroomId: newsroom },
      { articleSlug: slug, body: `${ROUTINE_EDITION_UPDATE_PREFIX}\n\nThe concert moved.` },
    );
    assert.deepEqual(marker, {
      ok: false,
      error:
        "Start the correction with your own words. That opening line is how the desk marks a correction it wrote by itself, so a person cannot use it.",
    });

    // The prefix is the row's OPENING. A correction that talks about a routine
    // update in its own words is an ordinary correction and posts.
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
    `;
    assert.equal(written.length, 1, "the refused marker must not have reached the table");
    assert.ok(!written[0]!.body.startsWith(ROUTINE_EDITION_UPDATE_PREFIX));
    const audits = await sql<{ id: number }>`
      select id from audit_events where user_id = ${editor} and newsroom_id = ${newsroom} and action = 'correction'
    `;
    assert.equal(audits.length, 1, "a refused correction must not write an audit event");
  });
});
