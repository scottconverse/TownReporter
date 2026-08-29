import { describe, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import {
  reinsert,
  repointRequests,
  snapshotArticle,
  snapshotDraft,
  snapshotLead,
} from "./trash-store.ts";

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

/**
 * The bug that only showed up by clicking Undo.
 *
 * `editorial_requests.draft_id` is a plain integer with no foreign key, and
 * deleting the draft nulls it. Restoring the draft alone put the piece back in
 * the database and left it invisible on the Opinion desk, because that list is
 * driven by the pointer rather than by the draft.
 */
describe("restoring an editorial", () => {
  it("points the Opinion desk back at it", async () => {
    const sql = await getSql();
    /*
      `editorial_requests` is created by `ensureEditorialRequestSchema()`, which
      lives in a `.server.ts` file full of path aliases that `node --test`
      cannot resolve. What is under test here is the pointer repair, not that
      table's full shape, so the two columns it turns on are declared locally.
    */
    await getPglite().then((pg) =>
      pg.exec(`create table if not exists editorial_requests (
        id serial primary key,
        user_id text not null,
        newsroom_id integer not null default 1,
        subject text not null,
        draft_id integer,
        error text
      )`),
    );

    const user = `repoint-${Math.random().toString(36).slice(2, 8)}`;
    const made = await sql<{ id: number }>`
      insert into drafts (user_id, lead_id, headline, dek, body, topic, form)
      values (${user}, ${null}, ${"OPINION: A piece"}, ${""}, ${"Body"}, ${"opinion"}, ${"editorial"})
      returning id
    `;
    const draftId = made[0]!.id;
    const req = await sql<{ id: number }>`
      insert into editorial_requests (user_id, subject, draft_id)
      values (${user}, ${"A subject"}, ${draftId})
      returning id
    `;
    const requestId = req[0]!.id;

    const snap = await snapshotDraft(sql, draftId);
    assert.deepEqual(snap?.requestIds, [requestId], "the pointer was not captured");

    // What the delete does.
    await sql`delete from drafts where id = ${draftId}`;
    await sql`update editorial_requests set draft_id = null where draft_id = ${draftId}`;

    // What the restore does.
    await reinsert(sql, "drafts", snap!.row);
    await repointRequests(sql, draftId, snap!.requestIds ?? []);

    const back = await sql<{ draft_id: number | null }>`
      select draft_id from editorial_requests where id = ${requestId}
    `;
    assert.equal(back[0]!.draft_id, draftId, "the desk still points at nothing");

    await sql`delete from editorial_requests where id = ${requestId}`;
    await sql`delete from drafts where id = ${draftId}`;
  });
});

/**
 * Deleting a story must take its corrections off the paper with it.
 *
 * `corrections.article_id` is ON DELETE SET NULL. deleteArticle deleted the
 * article first and only then ran `delete from corrections where article_id =
 * <id>` — by which time Postgres had already nulled that column, so the
 * cleanup matched nothing. The correction survived, detached, and
 * listPublicCorrections left-joins with no `article_id is not null` filter, so
 * it stayed on the public corrections page forever with a null headline.
 *
 * Correction text repeats the error it is correcting. An editor removing a
 * story specifically to take something off the paper left the most sensitive
 * sentence in it published, under no headline, with no way to find it.
 *
 * Audit finding ENG-005.
 */
describe("deleting a story takes its corrections", () => {
  async function seedStoryWithCorrection(tag: string) {
    const sql = await getSql();
    const user = `corr-${tag}-${Math.random().toString(36).slice(2, 8)}`;
    const lead = await sql<{ id: number }>`
      insert into leads (user_id, headline, why, topic) values (${user}, ${"L"}, ${"W"}, ${"council"})
      returning id
    `;
    const slug = `corr-order-${lead[0]!.id}`;
    const art = await sql<{ id: number }>`
      insert into articles (user_id, lead_id, slug, headline, dek, body, topic)
      values (${user}, ${lead[0]!.id}, ${slug}, ${"Printed"}, ${""}, ${"Body"}, ${"council"})
      returning id
    `;
    await sql`
      insert into corrections (user_id, article_id, body)
      values (${user}, ${art[0]!.id}, ${"We named the wrong person."})
    `;
    return { sql, user, leadId: lead[0]!.id, articleId: art[0]!.id, slug };
  }

  it("leaves no orphaned correction behind", async () => {
    const { sql, articleId, slug } = await seedStoryWithCorrection("orphan");

    // Production order, as deleteArticle performs it.
    await sql`delete from corrections where article_id = ${articleId}`;
    await sql`delete from articles where slug = ${slug}`;

    const orphans = await sql<{ id: number }>`
      select id from corrections where article_id is null
    `;
    assert.equal(orphans.length, 0, "a correction outlived the story it belonged to");
  });

  /**
   * Defence in depth: even if an orphan exists from before this fix, the
   * public feed must not print it.
   */
  it("the public corrections query refuses orphans", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./public.ts", import.meta.url), "utf8"),
    );
    const q = src.slice(src.indexOf("listPublicCorrections"));
    assert.match(
      q.slice(0, 800),
      /article_id is not null|inner join/i,
      "a correction with no article must not reach the public page",
    );
  });

  it("deleteArticle deletes corrections before the article, not after", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./desk.ts", import.meta.url), "utf8"),
    );
    const fn = src.slice(src.indexOf("export const deleteArticle"));
    const body = fn.slice(0, fn.indexOf("\n});"));
    const corrFirst = body.indexOf("delete from corrections");
    const artNext = body.indexOf("delete from articles");
    assert.ok(corrFirst > -1 && artNext > -1, "both deletes must exist");
    assert.ok(
      corrFirst < artNext,
      "corrections must go first — ON DELETE SET NULL makes the reverse order a no-op",
    );
  });
});
