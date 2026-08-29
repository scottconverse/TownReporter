import { describe, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";

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
