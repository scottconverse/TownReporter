import { describe, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { reinsert, snapshotArticle, snapshotDraft, snapshotLead } from "./trash-store.ts";

/**
 * Apply the real migrations, from disk.
 *
 * Under `node --test` there is no Vite glob transform, so `getSql()` brings up
 * an empty PGLite and every table comes from an `ensure*` helper. `leads`,
 * `drafts` and `articles` have none — they are declared in `migrations/`. What
 * is being tested here is the schema itself (two foreign keys and a dropped
 * not-null), so copying the DDL into the test would test the copy. Read the
 * files instead.
 */
async function applyMigrations() {
  const sql = await getSql();
  // `sql.query` prepares a statement, and a migration file is many statements.
  // `exec` is what db.ts uses for exactly this, so use the same door.
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // A migration that does not apply on a bare PGLite is not this test's
      // problem. The assertion below fails loudly if the ones that matter
      // were among them, so this can never quietly make the test vacuous.
    }
  }
  const cols = await sql<{ table_name: string; column_name: string; is_nullable: string }>`
    select table_name, column_name, is_nullable from information_schema.columns
    where table_name in ('leads','drafts','articles')
  `;
  const has = (t: string) => cols.some((c) => c.table_name === t);
  assert.ok(has("leads") && has("drafts") && has("articles"), "migrations did not apply");
  const leadId = cols.find((c) => c.table_name === "drafts" && c.column_name === "lead_id");
  assert.equal(leadId?.is_nullable, "YES", "drafts.lead_id must be nullable (migration 0015)");
}

before(applyMigrations);

/**
 * What deleting is allowed to take with it.
 *
 * The desk could not delete anything at all until now — Kill only moved a lead
 * into a pile. These tests pin the two rules that make delete safe to hand an
 * editor, both of which live in the schema rather than in the code that calls
 * it, so they would break silently:
 *
 *   1. Deleting a lead takes its drafts (ON DELETE CASCADE) but LEAVES a
 *      printed story standing (ON DELETE SET NULL). Removing something from
 *      the paper has to be its own, louder action.
 *   2. A draft can exist with no lead at all, which is what an editorial is.
 */
async function seed(tag: string) {
  const sql = await getSql();
  const user = `del-${tag}-${Math.random().toString(36).slice(2, 8)}`;
  const lead = await sql<{ id: number }>`
    insert into leads (user_id, headline, why, topic, newsworthiness)
    values (${user}, ${"A lead"}, ${"Why"}, ${"council"}, ${9})
    returning id
  `;
  return { sql, user, leadId: lead[0]!.id };
}

describe("deleting a lead", () => {
  it("takes its drafts with it", async () => {
    const { sql, user, leadId } = await seed("drafts");
    await sql`
      insert into drafts (user_id, lead_id, headline, dek, body, topic)
      values (${user}, ${leadId}, ${"H"}, ${""}, ${"B"}, ${"council"})
    `;
    const before = await sql<{ n: string }>`select count(*) as n from drafts where lead_id = ${leadId}`;
    assert.equal(Number(before[0]!.n), 1, "seed failed");

    await sql`delete from leads where id = ${leadId}`;

    const after = await sql<{ n: string }>`select count(*) as n from drafts where lead_id = ${leadId}`;
    assert.equal(Number(after[0]!.n), 0, "the draft outlived its lead");
  });

  /**
   * The rule that keeps a delete from quietly unpublishing something. An
   * editor tidying the queue must not remove a story readers already have.
   */
  it("leaves a printed story on the paper", async () => {
    const { sql, user, leadId } = await seed("article");
    const slug = `del-test-${leadId}`;
    await sql`
      insert into articles (user_id, lead_id, slug, headline, dek, body, topic)
      values (${user}, ${leadId}, ${slug}, ${"Printed"}, ${""}, ${"Body"}, ${"council"})
    `;

    await sql`delete from leads where id = ${leadId}`;

    const rows = await sql<{ lead_id: number | null }>`
      select lead_id from articles where slug = ${slug}
    `;
    assert.equal(rows.length, 1, "deleting a lead unpublished a story");
    assert.equal(rows[0]!.lead_id, null, "the article should keep standing with no lead");
    await sql`delete from articles where slug = ${slug}`;
  });
});

describe("an editorial draft", () => {
  /**
   * Until migration 0015 this threw a not-null violation, which meant every
   * editorial the voice finished died on the way into the database — the
   * Opinion desk could never have produced a draft at all.
   */
  it("can exist with no lead", async () => {
    const sql = await getSql();
    const user = `del-ed-${Math.random().toString(36).slice(2, 8)}`;
    const rows = await sql<{ id: number; lead_id: number | null }>`
      insert into drafts (user_id, lead_id, headline, dek, body, topic, form)
      values (${user}, ${null}, ${"OPINION: A piece"}, ${""}, ${"Body"}, ${"opinion"}, ${"editorial"})
      returning id, lead_id
    `;
    assert.equal(rows[0]!.lead_id, null);
    await sql`delete from drafts where id = ${rows[0]!.id}`;
  });
});

/**
 * The trash is only worth having if a restore really restores.
 *
 * These round-trip the real thing: snapshot, delete, put it back, then check
 * the row is there with the SAME id — because an article's corrections and an
 * editorial request both point at ids, and a restore that renumbers quietly
 * orphans them.
 */
describe("the trash puts things back", () => {
  it("restores a lead and the draft that went with it", async () => {
    const { sql, user, leadId } = await seed("restore");
    const draft = await sql<{ id: number }>`
      insert into drafts (user_id, lead_id, headline, dek, body, topic)
      values (${user}, ${leadId}, ${"Draft head"}, ${""}, ${"Draft body"}, ${"council"})
      returning id
    `;
    const draftId = draft[0]!.id;

    const snap = await snapshotLead(sql, leadId);
    assert.ok(snap, "nothing captured");
    assert.equal(snap!.drafts?.length, 1, "the draft was not captured with the lead");

    await sql`delete from leads where id = ${leadId}`;
    const mid = await sql<{ n: string }>`select count(*) as n from leads where id = ${leadId}`;
    assert.equal(Number(mid[0]!.n), 0, "it did not actually delete");

    await reinsert(sql, "leads", snap!.row);
    for (const d of snap!.drafts ?? []) await reinsert(sql, "drafts", d);

    const back = await sql<{ id: number; headline: string }>`
      select id, headline from leads where id = ${leadId}
    `;
    assert.equal(back.length, 1, "the lead did not come back");
    assert.equal(back[0]!.headline, "A lead");
    const draftBack = await sql<{ id: number; body: string }>`
      select id, body from drafts where id = ${draftId}
    `;
    assert.equal(draftBack.length, 1, "the draft did not come back");
    assert.equal(draftBack[0]!.body, "Draft body");
    assert.equal(draftBack[0]!.id, draftId, "the draft came back with a different id");

    await sql`delete from leads where id = ${leadId}`;
  });

  it("restores a story with its corrections attached", async () => {
    const { sql, user, leadId } = await seed("corr");
    const slug = `trash-test-${leadId}`;
    const art = await sql<{ id: number }>`
      insert into articles (user_id, lead_id, slug, headline, dek, body, topic)
      values (${user}, ${leadId}, ${slug}, ${"Printed"}, ${""}, ${"Body"}, ${"council"})
      returning id
    `;
    const articleId = art[0]!.id;
    await sql`
      insert into corrections (user_id, article_id, body)
      values (${user}, ${articleId}, ${"We got the date wrong."})
    `;

    const snap = await snapshotArticle(sql, articleId);
    assert.equal(snap?.corrections?.length, 1, "the correction was not captured");

    await sql`delete from corrections where article_id = ${articleId}`;
    await sql`delete from articles where id = ${articleId}`;

    await reinsert(sql, "articles", snap!.row);
    for (const c of snap!.corrections ?? []) await reinsert(sql, "corrections", c);

    const back = await sql<{ id: number; slug: string }>`
      select id, slug from articles where id = ${articleId}
    `;
    assert.equal(back.length, 1, "the story did not come back");
    assert.equal(back[0]!.slug, slug, "it came back under a different URL");
    const corr = await sql<{ body: string }>`
      select body from corrections where article_id = ${articleId}
    `;
    assert.equal(corr.length, 1, "the correction did not come back with it");

    await sql`delete from corrections where article_id = ${articleId}`;
    await sql`delete from articles where id = ${articleId}`;
    await sql`delete from leads where id = ${leadId}`;
  });

  it("restores an editorial draft that never had a lead", async () => {
    const sql = await getSql();
    const user = `trash-ed-${Math.random().toString(36).slice(2, 8)}`;
    const made = await sql<{ id: number }>`
      insert into drafts (user_id, lead_id, headline, dek, body, topic, form)
      values (${user}, ${null}, ${"OPINION: A piece"}, ${""}, ${"The piece."}, ${"opinion"}, ${"editorial"})
      returning id
    `;
    const draftId = made[0]!.id;

    const snap = await snapshotDraft(sql, draftId);
    assert.ok(snap, "nothing captured");

    await sql`delete from drafts where id = ${draftId}`;
    await reinsert(sql, "drafts", snap!.row);

    const back = await sql<{ id: number; headline: string; lead_id: number | null }>`
      select id, headline, lead_id from drafts where id = ${draftId}
    `;
    assert.equal(back.length, 1, "the editorial did not come back");
    assert.equal(back[0]!.headline, "OPINION: A piece");
    assert.equal(back[0]!.lead_id, null);

    await sql`delete from drafts where id = ${draftId}`;
  });

  /**
   * A snapshot taken before a migration added a column must still restore
   * afterwards, and a column the table no longer has must not fail the whole
   * thing. The insert is rebuilt from the live table, not from the blob.
   */
  it("ignores a column the table no longer has", async () => {
    const sql = await getSql();
    const user = `trash-old-${Math.random().toString(36).slice(2, 8)}`;
    const lead = await sql<{ id: number }>`
      insert into leads (user_id, headline, why, topic) values (${user}, ${"Old"}, ${"Why"}, ${"council"})
      returning id
    `;
    const snap = await snapshotLead(sql, lead[0]!.id);
    await sql`delete from leads where id = ${lead[0]!.id}`;

    const stale = { ...snap!.row, a_column_that_was_dropped: "whatever" };
    await reinsert(sql, "leads", stale);

    const back = await sql<{ headline: string }>`select headline from leads where id = ${lead[0]!.id}`;
    assert.equal(back.length, 1, "a stale column broke the restore");
    await sql`delete from leads where id = ${lead[0]!.id}`;
  });
});
