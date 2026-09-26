import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { assertDraftBatchCanContinue } from "./draft-batch.server.ts";

it("an ordinary draft does not require the draft_batches table", async () => {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(
    "create table desk_jobs(id integer primary key,newsroom_id integer,status text,draft_batch_id integer); insert into desk_jobs values(1,7,'running',null)",
  );
  // The table above is a stub, not a copy of production -- it carries a column
  // production has no counterpart for. It still applies the real migrations,
  // because a stub that omits one is how a schema drift gets in (PROJECT-BRIEF
  // rule 14): the day `assertDraftBatchCanContinue` reads a column that only
  // 0099 adds, this test would fail for a reason that has nothing to do with
  // batches. `status` is here for the same reason one step earlier: 0099's
  // partial index is declared on it, so a stub without it cannot accept the
  // migration at all.
  await db.exec(
    await readFile(new URL("../../../migrations/0099_desk_job_progress.sql", import.meta.url), "utf8"),
  );
  const sql = (async () => []) as unknown as Sql;
  sql.query = async <T>(text: string, params: unknown[] = []) => {
    const result = await db.query<T>(text, params);
    return result.rows;
  };
  try {
    const snapshot = await assertDraftBatchCanContinue(sql, {
      id: 1,
      newsroom_id: 7,
      user_id: "ordinary-editor",
      claim_token: "ordinary-claim",
    });
    assert.equal(snapshot, null);
  } finally {
    await db.close();
  }
});
