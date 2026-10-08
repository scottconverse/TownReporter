// guards: the editor's nightly proof could scan every source and block the desk instead of its daily twelve.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyScan } from "./nightly-proof-scan.mjs";

test("clicks the daily control when general scan controls are also present", async () => {
  let clock = 0, clicked, polls = 0;
  const page = {
    goto: async () => {},
    getByRole: (role, { name }) => ({ click: async () => {
      assert.equal(role, "button");
      clicked = ["Run scan", "Run scan now", "Scan every accepted source (228)"].filter(x => name.test(x));
    } }),
    waitForTimeout: async ms => { clock += ms; },
  };
  const row = { id: 8, policy_snapshot: { daily: true }, finished_at: "done", job_status: "completed" };
  const pool = { query: async (_sql, params) => {
    if (!params) return { rows: [{ id: 7 }] };
    assert.equal(params[0], 7);
    if (polls++) assert.equal(params[1], 8);
    return { rows: [{ ...row, job_status: polls === 1 ? "running" : "completed" }] };
  } };
  assert.equal((await dailyScan(page, pool, "offline", () => clock)).id, 8);
  assert.deepEqual(clicked, ["Run scan now"]);
  assert.equal(polls, 2);
});
