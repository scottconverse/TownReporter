import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
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
      status text not null default 'published'
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
