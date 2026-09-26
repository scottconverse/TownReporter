import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { getSql } from "../db.ts";
import { ensureFollowUpsSchema } from "./follow-ups.ts";

/**
 * Migration/ensure drift for `follow_ups`, both directions, without a Postgres.
 *
 * `schema-parity.test.ts` does this properly and generally, but it needs
 * `TEST_POSTGRES_ADMIN_URL` and skips without one (see its docstring), which
 * means the drift 0101 could introduce would go unchecked in every
 * `node --test` run and in the PGLite preview. This is the same diff narrowed
 * to one table and built on PGlite instead: database A is `migrations/*.sql`
 * alone (the deploy path), database B is `ensureFollowUpsSchema()` alone (the
 * path a plain `node --test` run and a rebuilt preview actually take).
 *
 * It reads the migration FILES rather than restating them, so the comparison
 * is between the two real artifacts and not between two copies of a constant
 * -- a column added to 0101 and forgotten in `ensureFollowUpsSchema` fails
 * here on the column-set assert, and a constraint widened on one side only
 * fails on the insert asserts below.
 */

const MIGRATION_FILES = ["0042_follow_ups.sql", "0101_ai_follow_ups.sql"];

/** Every column the table must have after both migrations, sorted. */
const EXPECTED_COLUMNS = [
  "agent_kind", "answered_at", "article_id", "created_at", "due_on", "finding_json",
  "id", "last_run_at", "last_state", "lead_id", "model_choice", "newsroom_id",
  "next_run_at", "nudged_at", "reply_text", "schedule", "status", "targets_json",
  "updated_at", "user_id", "what", "who",
].sort();

async function migrationColumns(): Promise<string[]> {
  const db = new PGlite();
  try {
    for (const file of MIGRATION_FILES) {
      await db.exec(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"));
    }
    // Applied twice: every statement in both files has to be idempotent, since
    // scripts/migrate.mjs replays the directory and 0101 drops and re-adds
    // three constraints.
    await db.exec(await readFile(new URL("../../../migrations/0101_ai_follow_ups.sql", import.meta.url), "utf8"));
    const result = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'follow_ups'
        order by column_name`,
    );
    return result.rows.map((row) => row.column_name);
  } finally {
    await db.close();
  }
}

async function ensureColumns(): Promise<string[]> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const rows = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'follow_ups'
    order by column_name
  `;
  return rows.map((row) => row.column_name);
}

/** Does this database accept the value? The check constraints' real behaviour. */
async function accepts(
  sql: SqlLike,
  column: "status" | "agent_kind" | "last_state",
  value: string,
): Promise<boolean> {
  try {
    await sql.query(
      `insert into follow_ups (user_id, newsroom_id, who, what, ${column})
       values ('drift-probe', 991001, 'probe', 'probe', $1)`,
      [value],
    );
    return true;
  } catch {
    return false;
  }
}

type SqlLike = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
  exec?: (text: string) => Promise<unknown>;
};

describe("0101_ai_follow_ups.sql and ensureFollowUpsSchema agree", { timeout: 30000 }, () => {
  it("creates the same column set on both sides", async () => {
    const fromMigration = await migrationColumns();
    assert.deepEqual(fromMigration, EXPECTED_COLUMNS, "migrations 0042+0101 must create exactly these columns");
    assert.deepEqual(
      await ensureColumns(),
      EXPECTED_COLUMNS,
      "ensureFollowUpsSchema must mirror migrations 0042+0101 column-for-column",
    );
  });

  it("accepts both status vocabularies and refuses anything else, on both sides", async () => {
    const db = new PGlite();
    try {
      for (const file of MIGRATION_FILES) {
        await db.exec(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"));
      }
      // The old manual vocabulary must survive 0101: this is the whole reason
      // the constraint was widened rather than rewritten.
      for (const value of ["open", "answered", "dropped", "active", "paused", "stopped", "done"]) {
        assert.equal(await accepts(db, "status", value), true, `migration side must accept status ${value}`);
      }
      assert.equal(await accepts(db, "status", "archived"), false);
      assert.equal(await accepts(db, "agent_kind", "recheck"), true);
      assert.equal(await accepts(db, "agent_kind", "dig"), false);
      assert.equal(await accepts(db, "last_state", "could-not-check"), true);
      assert.equal(await accepts(db, "last_state", "failed"), false);
    } finally {
      await db.close();
    }

    await ensureFollowUpsSchema();
    const sql = (await getSql()) as unknown as SqlLike;
    for (const value of ["open", "answered", "dropped", "active", "paused", "stopped", "done"]) {
      assert.equal(await accepts(sql, "status", value), true, `ensure side must accept status ${value}`);
    }
    assert.equal(await accepts(sql, "status", "archived"), false);
    assert.equal(await accepts(sql, "agent_kind", "recheck"), true);
    assert.equal(await accepts(sql, "agent_kind", "dig"), false);
    assert.equal(await accepts(sql, "last_state", "could-not-check"), true);
    assert.equal(await accepts(sql, "last_state", "failed"), false);
  });

  it("upgrades a populated 0042 table without losing the manual row", async () => {
    const db = new PGlite();
    try {
      await db.exec(await readFile(new URL("../../../migrations/0042_follow_ups.sql", import.meta.url), "utf8"));
      await db.exec(`
        insert into follow_ups (user_id, newsroom_id, who, what, due_on, status)
        values ('old-editor', 991002, 'Fire marshal', 'the incident report', '2026-09-09', 'open')
      `);
      await db.exec(await readFile(new URL("../../../migrations/0101_ai_follow_ups.sql", import.meta.url), "utf8"));
      const rows = await db.query(`
        select who, what, due_on::text as due_on, status, agent_kind, targets_json, schedule,
               model_choice, last_state, last_run_at, next_run_at, finding_json
        from follow_ups where user_id = 'old-editor'
      `);
      assert.equal(rows.rows.length, 1);
      assert.deepEqual(rows.rows[0], {
        who: "Fire marshal",
        what: "the incident report",
        due_on: "2026-09-09",
        status: "open",
        agent_kind: null,
        targets_json: "[]",
        schedule: "",
        model_choice: "auto",
        last_state: null,
        last_run_at: null,
        next_run_at: null,
        finding_json: "{}",
      });
    } finally {
      await db.close();
    }
  });
});
