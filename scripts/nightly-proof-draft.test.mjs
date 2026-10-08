// guards: queued work could consume the editor's draft budget or be queued behind an unfinished scan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { afterScan, waitForDraft } from "./nightly-proof-draft.mjs";

test("draft budget starts when the job runs after ninety seconds queued", async () => {
  let clock = 0;
  const page = { waitForTimeout: async ms => { clock += ms; } };
  const pool = { query: async () => ({ rows: [{ id: 5,
    status: clock < 90_000 ? "queued" : clock < 567_000 ? "running" : "completed",
    started_at: clock < 90_000 ? null : new Date(90_000).toISOString(),
    finished_at: new Date(567_000).toISOString(),
  }] }) };
  assert.equal((await afterScan({ ok: false }, () => { throw Error("queued behind scan"); })).ok, false);
  assert.equal((await afterScan({ ok: true }, () => waitForDraft(page, pool, 1, 4, () => clock))).id, 5);
  assert.equal(clock, 567_000);
});
