import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { ensureAuditEventsSchema } from "./ops.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { editorWarning } from "./editor-override.ts";
/**
 * Behavior tests for the ONE helper every "warn, never block" press goes
 * through (Scott's rule, Oct 10 2026). These drive the real `editorWarning`
 * over a real `audit_events` table in an embedded PGlite -- no providers, no
 * Postgres -- and check the two halves that matter:
 *
 *   1. No override (or an override that does not name the exact key) => the
 *      structured warning comes back and NOTHING is written.
 *   2. The override names the key => the action may proceed (null) and one
 *      audit row records action `override`, the editor, the key and the target.
 */

async function makeSql(db: PGlite) {
  return (async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  }) as unknown as import("../db.ts").Sql;
}

describe("editorWarning", () => {
  let db: PGlite;
  let sql: import("../db.ts").Sql;

  before(async () => {
    db = new PGlite();
    sql = await makeSql(db);
    await db.exec(`
      create table audit_events (
        id serial primary key,
        user_id text not null,
        action text not null,
        detail text not null default '',
        created_at timestamptz not null default now(),
        newsroom_id integer not null default 1,
        subject_kind text,
        subject_id integer
      );`);
  });

  after(async () => {
    await db.close();
  });

  async function overrides() {
    return await sql<{ user_id: string; action: string; detail: string; newsroom_id: number; subject_kind: string | null; subject_id: number | null }>`
      select user_id, action, detail, newsroom_id, subject_kind, subject_id
      from audit_events where action = 'override' order by id`;
  }

  it("returns the structured warning, with error kept as the same sentence, and writes nothing", async () => {
    const before = (await overrides()).length;
    const result = await editorWarning(
      { userId: "editor-a", newsroomId: 5, sql },
      undefined,
      "lead-edit-why",
      "Say why this is news.",
      { kind: "lead", id: 12 },
    );
    assert.deepEqual(result, {
      ok: false,
      warning: { key: "lead-edit-why", sentence: "Say why this is news." },
      error: "Say why this is news.",
    });
    assert.equal((await overrides()).length, before, "a warning must not write an audit row");
  });

  it("does not honour an override that does not name the exact key (no prefix, no case fold)", async () => {
    const result = await editorWarning(
      { userId: "editor-b", newsroomId: 5, sql },
      ["lead-edit", "LEAD-EDIT-WHY", " lead-edit-why"],
      "lead-edit-why",
      "Say why this is news.",
      { kind: "lead", id: 9 },
    );
    assert.equal(result?.ok, false);
    assert.equal(result?.warning.key, "lead-edit-why");
    assert.equal((await overrides()).length, 0);
  });

  it("records the override audit (action, editor, key, target, newsroom) and lets the action proceed", async () => {
    const result = await editorWarning(
      { userId: "editor-c", newsroomId: 42, sql },
      ["lead-edit-headline-short"],
      "lead-edit-headline-short",
      "That headline is very short.",
      { kind: "lead", id: 77 },
    );
    assert.equal(result, null, "an approved override must let the action run");
    const rows = await overrides();
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.user_id, "editor-c");
    assert.equal(row.action, "override");
    assert.equal(row.newsroom_id, 42);
    assert.equal(row.subject_kind, "lead");
    assert.equal(row.subject_id, 77);
    assert.deepEqual(JSON.parse(row.detail), {
      key: "lead-edit-headline-short",
      target: { kind: "lead", id: 77 },
    });
  });

  it("writes a real audit row even when a caller passes no target", async () => {
    const result = await editorWarning(
      { userId: "editor-d", newsroomId: 3, sql },
      ["rate-scan"],
      "rate-scan",
      "You have run scan 10 times this hour; the cap is 10. It may cost more.",
    );
    assert.equal(result, null);
    const rows = (await overrides()).filter((r) => r.user_id === "editor-d");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, "override");
    assert.equal(rows[0]!.subject_kind, null);
  });

  it("falls back to the default newsroom when the context names none", async () => {
    await editorWarning(
      { userId: "editor-e", sql },
      ["lead-edit-why"],
      "lead-edit-why",
      "Say why this is news.",
      { kind: "lead", id: 1 },
    );
    const rows = (await overrides()).filter((r) => r.user_id === "editor-e");
    assert.equal(rows[0]!.newsroom_id, DEFAULT_NEWSROOM_ID);
  });
});

describe("ensureAuditEventsSchema", () => {
  it("does not throw on a database that already has the table", async () => {
    await ensureAuditEventsSchema();
  });
});
