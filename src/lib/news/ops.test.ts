import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { assertRate, checkCooldown, checkRate } from "./ops.ts";

/**
 * Item 25 (hourly caps) and item 26 (cooldown) behavior, per Scott's rule: the
 * scoped desk actions WARN, and the editor may press again. These drive the
 * real `checkRate` / `checkCooldown` against the real (PGlite) `desk_rate` and
 * `audit_events` tables -- the same tables and the same `getSql()` the server
 * path uses -- with no providers and no Postgres.
 *
 * The two properties that matter for a cost ceiling:
 *   1. a refused warning records NOTHING, so a refused press never consumes its
 *      own budget;
 *   2. an approved override records the unit AND leaves an `override` audit row.
 * And the Reddit budget stays hard: a rejected `assertRate` must not leave the
 * row it inserted behind, or a blocked burst would still burn the quota.
 */

async function rateRows(userId: string, action: string) {
  const sql = await getSql();
  return await sql<{ c: number }>`
    select count(*)::int as c from desk_rate where user_id = ${userId} and action = ${action}`;
}

async function lastOverride(userId: string) {
  const sql = await getSql();
  const [row] = await sql<{ action: string; detail: string; subject_kind: string | null; subject_id: number | null }>`
    select action, detail, subject_kind, subject_id from audit_events
    where user_id = ${userId} and action = 'override' order by id desc limit 1`;
  return row;
}

describe("checkRate (hourly caps, item 25)", () => {
  const user = "rate-editor";
  it("all five desk caps warn without spending and allow a named audited override", async () => {
    const sql = await getSql();
    for (const [action, cap] of [["scan",10],["draft",20],["dark",8],["pull",40],["brief",40]] as const) {
      const editor = `all-caps-${action}`;
      await sql.query("insert into desk_rate(user_id,action,newsroom_id) select $1,$2,1 from generate_series(1,$3)",[editor,action,cap]);
      const warning = await checkRate(editor,action,1);
      assert.equal(warning?.warning.sentence,`You have run ${action} ${cap} times this hour; the cap is ${cap}. It may cost more.`);
      assert.equal((await rateRows(editor,action))[0].c,cap);
      assert.equal(await checkRate(editor,action,1,[`rate-${action}`]),null);
      assert.equal((await rateRows(editor,action))[0].c,cap+1);
      const audit = await lastOverride(editor);
      assert.equal(JSON.parse(audit!.detail).key,`rate-${action}`);
      assert.equal(audit?.subject_kind,`rate:${action}`);
    }
  });

  it("returns the exact sentence at the cap, records nothing, and stays refused on a repeat press", async () => {
    for (let i = 0; i < 10; i++) {
      const result = await checkRate(user, "scan", 31);
      assert.equal(result, null, `run ${i + 1} is inside the cap`);
    }
    const sentence = "You have run scan 10 times this hour; the cap is 10. It may cost more.";
    const refused = await checkRate(user, "scan", 31);
    assert.deepEqual(refused, { ok: false, warning: { key: "rate-scan", sentence }, error: sentence });
    const again = await checkRate(user, "scan", 31);
    assert.equal(again?.warning.key, "rate-scan", "a refused press stays refused, and consumes nothing");
    assert.equal((await rateRows(user, "scan"))[0]!.c, 10, "neither refused press recorded a row");
  });

  it("counts per newsroom, so another newsroom's runs do not cap this one", async () => {
    for (let i = 0; i < 10; i++) await checkRate("rate-editor-2", "scan", 31);
    assert.equal((await checkRate("rate-editor-2", "scan", 31))?.warning.key, "rate-scan", "newsroom 31 is at cap");
    assert.equal(await checkRate("rate-editor-2", "scan", 99), null, "newsroom 99 has its own budget");
  });

  it("runs and records on the second press, writing one override audit for the named action", async () => {
    const approved = await checkRate(user, "scan", 31, ["rate-scan"]);
    assert.equal(approved, null, "an approved override lets the run proceed");
    assert.equal((await rateRows(user, "scan"))[0]!.c, 11, "the approved run recorded its own unit");
    const audit = await lastOverride(user);
    assert.equal(audit!.action, "override");
    assert.equal(audit!.subject_kind, "rate:scan");
    assert.equal(audit!.subject_id, 31);
    assert.deepEqual(JSON.parse(audit!.detail), { key: "rate-scan", target: { kind: "rate:scan", id: 31 } });
  });

  it("does not honour an unrelated override key", async () => {
    assert.equal(await checkRate("rate-editor-3", "dark", 44, ["rate-pull"]), null, "still inside the dark cap");
    for (let i = 1; i < 8; i++) await checkRate("rate-editor-3", "dark", 44);
    const capped = await checkRate("rate-editor-3", "dark", 44, ["rate-pull"]);
    assert.equal(capped?.warning.key, "rate-dark", "the wrong key does not open the cap");
  });
});

describe("assertRate (Reddit hard budget)", () => {
  it("throws over the cap and leaves no rejected row behind, so a blocked burst cannot burn quota", async () => {
    const user = "reddit-editor";
    for (let i = 0; i < 6; i++) await assertRate(user, "reddit", 1);
    await assert.rejects(() => assertRate(user, "reddit", 1), /Rate limit: reddit is capped at 6 per hour\./);
    await assert.rejects(() => assertRate(user, "reddit", 1), /Rate limit/);
    assert.equal((await rateRows(user, "reddit"))[0]!.c, 6, "the two rejected attempts recorded nothing");
  });
});

describe("checkCooldown (source Check now, item 26)", () => {
  const user = "cooldown-editor";
  const action = "check-source:7";

  it("warns inside the cooldown window, records nothing, then runs on the second press with an audit", async () => {
    assert.equal(await checkCooldown(user, action, 60, 12), null, "the first check runs");
    const refused = await checkCooldown(user, action, 60, 12);
    assert.equal(refused?.ok, false);
    assert.equal(refused?.warning.key, "source-check-cooldown");
    assert.match(refused!.warning.sentence, /checked a moment ago\. Try again in \d+s\./);
    assert.equal(refused!.error, refused!.warning.sentence, "error keeps the old sentence");
    assert.equal((await rateRows(user, action))[0]!.c, 1, "the refused press recorded nothing");

    const approved = await checkCooldown(user, action, 60, 12, ["source-check-cooldown"]);
    assert.equal(approved, null, "the second press runs");
    assert.equal((await rateRows(user, action))[0]!.c, 2, "the approved press recorded its own row");
    assert.equal((await lastOverride(user))!.action, "override");
  });
});
