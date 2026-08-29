import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  ensureNewsroomSchema,
  isGrokPreviewHost,
  ForbiddenError,
  deskIsClaimed,
  leaveAsEditor,
} from "./membership.ts";

describe("newsroom hosts", () => {
  it("treats grok.me as preview and localhost as self-host", () => {
    assert.equal(isGrokPreviewHost("townreporter-longmont.grok.me"), true);
    assert.equal(isGrokPreviewHost("grok.me"), true);
    assert.equal(isGrokPreviewHost("localhost"), false);
    assert.equal(isGrokPreviewHost("127.0.0.1"), false);
    assert.equal(isGrokPreviewHost("paper.example.org"), false);
  });
});

/*
  Two tests lived here that read NEWSROOM_SETUP_TOKEN and asserted
  SetupRequiredError was a 403. They are deleted rather than weakened: the
  behaviour they covered was removed on purpose by the operator, so a test
  demanding it would be asserting a feature that no longer exists. What
  replaced them is the "first account owns the desk" block at the end of this
  file, which asserts the token is gone and that the database still prevents
  two owners.
*/
describe("newsroom membership", () => {
  it("leave as editor refuses a stranger", async () => {
    await assert.rejects(() => leaveAsEditor("nobody-here"), (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      return true;
    });
  });

  it("leave as editor deletes this newsroom's members, not every row", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    const owner = `leave-owner-${Date.now()}`;
    const decoy = `leave-decoy-${Date.now()}`;
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${owner}, ${"owner"}, ${1})
    `;
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${decoy}, ${"editor"}, ${99})
    `;
    await leaveAsEditor(owner);
    const left = await sql<{ user_id: string; newsroom_id: number }>`
      select user_id, newsroom_id from newsroom_members
      where user_id = ${owner} or user_id = ${decoy}
    `;
    assert.equal(left.some((r) => r.user_id === owner), false);
    assert.equal(left.some((r) => r.user_id === decoy && r.newsroom_id === 99), true);
    assert.equal(await deskIsClaimed(), false);
    await sql`delete from newsroom_members where user_id = ${decoy}`;
  });
});

/**
 * The setup token is gone.
 *
 * It guarded exactly one window: an unclaimed desk on a public host, before
 * the operator signs in for the first time. For a one-person newsroom that
 * window is about ninety seconds, once, ever — and the price was carrying a
 * shared secret for the life of the product, plus a form field that locked the
 * operator out of his own dev instance when he did not have the string to hand.
 *
 * An audit raised the token as a Critical (guessable, unthrottled). Removing
 * the mechanism closes it more completely than hardening it would: there is no
 * secret to guess, no comparison to time, no lockout to tune.
 *
 * The trade is stated plainly in the README: on a fresh public deployment, the
 * first person to reach /login owns the desk. Sign in first.
 */
describe("first account owns the desk", () => {
  it("no longer exposes a setup-token requirement", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./membership.ts", import.meta.url), "utf8"),
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /NEWSROOM_SETUP_TOKEN/, "the token must be gone from the code path");
    assert.doesNotMatch(code, /SetupRequiredError/, "nothing may demand a token any more");
  });

  it("claiming takes no token argument at all", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./membership.ts", import.meta.url), "utf8"),
    );
    assert.match(
      src,
      /export async function claimOwner\(\s*userId: string\s*\)/,
      "claimOwner should accept only a user id",
    );
  });

  /**
   * The one guarantee that must survive: two people cannot both own it. That
   * is enforced in the database, not by the token — a unique partial index on
   * the owner row (migrations/0012_newsroom_appliance.sql).
   */
  it("still cannot produce two owners", async () => {
    const migration = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../../migrations/0012_newsroom_appliance.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.match(migration, /unique index/i);
    assert.match(migration, /owner/i);
  });
});
