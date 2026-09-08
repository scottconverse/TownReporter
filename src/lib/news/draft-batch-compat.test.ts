import assert from "node:assert/strict";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { assertDraftBatchCanContinue } from "./draft-batch.server.ts";

it("an ordinary draft does not require the draft_batches table", async () => {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(
    "create table desk_jobs(id integer primary key,newsroom_id integer,draft_batch_id integer); insert into desk_jobs values(1,7,null)",
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
