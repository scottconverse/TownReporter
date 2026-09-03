import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureJobsSchema, enqueueJob } from "./jobs.ts";
import { writeStoryForAuthenticatedEditor } from "./model-request-commit.server.ts";

/**
 * GauntletGate ENG-04 proof test.
 *
 * The guard test (scripts/newsroom-scoped-inserts.test.mjs) proves every
 * scoped INSERT's source text carries a `newsroom_id` column. This test
 * proves the value that lands there is the CALLER's newsroom, not always 1
 * -- exactly the gap ENG-04 named: "the first row with newsroom_id <> 1
 * makes that editor's hand-filed leads ... land in newsroom 1 and become
 * invisible to their own reads." It runs the real commit path
 * (`writeStoryForAuthenticatedEditor`, the same function
 * write-story-commit.test.ts exercises) for two different newsroom ids and
 * reads each back scoped, against a real in-process database (PGLite, no
 * DATABASE_URL needed).
 */
async function ensureScratchSchema() {
  const sql = await getSql();
  await ensureJobsSchema();
  await sql.query(`
    create table if not exists leads (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      headline text not null,
      why text not null,
      topic text not null default 'council',
      status text not null default 'new',
      source_urls text not null default '[]',
      evidence text not null default '',
      newsworthiness integer not null default 0,
      notes_json text not null default '{}',
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists drafts (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      lead_id integer not null,
      headline text not null,
      dek text not null default '',
      body text not null default '',
      topic text not null default 'council',
      source_urls text not null default '[]',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  return sql;
}

describe("a newsroom-scoped write lands in the caller's own newsroom, not always 1", () => {
  it("newsroom 2's lead and draft read back under newsroom 2, not newsroom 1", async () => {
    const sql = await ensureScratchSchema();
    const userId = `newsroom2-editor-${Date.now()}-${Math.random()}`;
    const text =
      "The planning board moved the Kimbark hearing to Oct. 2\nhttps://example.org/agenda";

    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 2 }, text, modelChoice: "auto" },
      {
        probeProvider: async () => ({ ok: true as const, choice: "claude-frontier" as const }),
        enqueueJob: async (opts) => enqueueJob({ ...opts, kick: false }),
      },
    );
    assert.equal(res.ok, true, res.ok ? "" : (res as { error: string }).error);

    // Scoped to newsroom 2: the row is there.
    const inNewsroom2 = await sql<{ id: number; user_id: string }>`
      select id, user_id from leads where user_id = ${userId} and newsroom_id = 2
    `;
    assert.equal(inNewsroom2.length, 1, "the lead did not land in newsroom 2");

    const draftInNewsroom2 = await sql<{ id: number }>`
      select id from drafts where user_id = ${userId} and newsroom_id = 2
    `;
    assert.equal(draftInNewsroom2.length, 1, "the draft did not land in newsroom 2");

    // Scoped to newsroom 1 (the old hard-coded default): the row is NOT
    // there. This is the exact silent-data-loss failure ENG-04 named -- a
    // regression here would show up as the row existing under newsroom 1
    // instead of newsroom 2, not as an error.
    const inNewsroom1 = await sql<{ id: number }>`
      select id from leads where user_id = ${userId} and newsroom_id = 1
    `;
    assert.equal(
      inNewsroom1.length,
      0,
      "the lead landed in newsroom 1 (the default) instead of the caller's newsroom 2 -- this is " +
        "the exact ENG-04 silent-data-loss bug",
    );
  });

  it("newsroom 1's own write still reads back under newsroom 1 (no regression for the default)", async () => {
    const sql = await ensureScratchSchema();
    const userId = `newsroom1-editor-${Date.now()}-${Math.random()}`;
    const text =
      "Council approves the Main Street repaving contract\nhttps://example.org/minutes";

    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 1 }, text, modelChoice: "auto" },
      {
        probeProvider: async () => ({ ok: true as const, choice: "claude-frontier" as const }),
        enqueueJob: async (opts) => enqueueJob({ ...opts, kick: false }),
      },
    );
    assert.equal(res.ok, true, res.ok ? "" : (res as { error: string }).error);

    const inNewsroom1 = await sql<{ id: number }>`
      select id from leads where user_id = ${userId} and newsroom_id = 1
    `;
    assert.equal(inNewsroom1.length, 1, "a plain newsroom-1 write must still read back under newsroom 1");
  });
});
