import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  ensureNewsroomSchema,
  ensureInviteSchema,
  ForbiddenError,
  deskIsClaimed,
  leaveAsEditor,
  readNewsroomAccess,
} from "./membership.ts";

/*
  `isGrokPreviewHost` and its test lived here. Both are gone: TownReporter
  removed Grok as a provider, so nothing calls it and nothing sets a grok.me
  host any more. A test for a host no code reads is a test that pins a fact
  about a product this is not.
*/

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

/*
  Who owns the desk, against a real PGlite.

  The Server card's "Owner" row used to print `paper_settings.editor_email` --
  a hand-typed contact address -- so the test that matters is that the read
  answers with the ACCOUNT's address and name when the paper's Contact field
  says something else entirely. The `"user"` table is opt-in schema in real
  deployments, so this file creates the three columns the read needs.
*/
describe("who owns the desk", () => {
  const OWNER = "access-owner";
  const EDITOR = "access-editor";
  const CONTACT_EMAIL = "letters@townreporter.example";
  const OWNER_EMAIL = "scott@townreporter.example";

  it("answers with the owner's account, not the paper's contact address", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    await sql.query(
      `create table if not exists "user" (id text primary key, email text not null, name text)`,
    );
    await sql`delete from newsroom_members`;
    await sql`delete from "user" where id in (${OWNER}, ${EDITOR})`;
    await sql`insert into "user" (id, email, name, "emailVerified") values (${OWNER}, ${OWNER_EMAIL}, ${"Scott Converse"}, true)`;
    await sql`insert into "user" (id, email, name, "emailVerified") values (${EDITOR}, ${"desk@townreporter.example"}, ${"Desk Editor"}, true)`;
    await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${OWNER}, 'owner', 1)`;

    const access = await readNewsroomAccess(OWNER);
    assert.deepEqual(access.owner, { email: OWNER_EMAIL, name: "Scott Converse" });
    assert.notEqual(access.owner?.email, CONTACT_EMAIL);
  });

  /*
    "Invites open" is the count of doors that are actually open: minted,
    unused, unexpired. A used invite and an expired one are not doors, and the
    card must not print them as if they were.
  */
  it("counts the invite links that are still open, and only those", async () => {
    const sql = await getSql();
    await sql`delete from newsroom_members`;
    await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${OWNER}, 'owner', 1)`;
    await ensureInviteSchema();
    await sql`delete from editor_invites`;
    assert.equal((await readNewsroomAccess(OWNER)).invitesOpen, 0, "a fresh desk has none open");

    await sql`insert into editor_invites (newsroom_id, email, token_hash, expires_at)
              values (1, ${"open@example.com"}, ${"a".repeat(64)}, now() + interval '1 day')`;
    await sql`insert into editor_invites (newsroom_id, email, token_hash, expires_at, used_at)
              values (1, ${"used@example.com"}, ${"b".repeat(64)}, now() + interval '1 day', now())`;
    await sql`insert into editor_invites (newsroom_id, email, token_hash, expires_at)
              values (1, ${"late@example.com"}, ${"c".repeat(64)}, now() - interval '1 day')`;
    assert.equal(
      (await readNewsroomAccess(OWNER)).invitesOpen,
      1,
      "only the live link counts; a used or expired one is not an open door",
    );
    await sql`delete from editor_invites`;
  });

  it("refuses anyone who is not the owner, and answers Not set for an owner whose account is gone", async () => {
    const sql = await getSql();
    await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${EDITOR}, 'editor', 1)`;
    await assert.rejects(() => readNewsroomAccess(EDITOR), (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      return true;
    });
    /*
      An owner membership whose `"user"` row is gone. Reachable (the account was
      deleted) and the one case where the read answers null instead of
      throwing: the desk is held, so the caller is the owner, but there is no
      address to print -- which is the card's "Not set".
    */
    await sql`delete from newsroom_members`;
    await sql`insert into newsroom_members (user_id, role, newsroom_id) values ('access-ghost', 'owner', 1)`;
    assert.deepEqual(await readNewsroomAccess("access-ghost"), { owner: null, invitesOpen: 0 });
    await sql`delete from newsroom_members`;
    await sql`delete from "user" where id in (${OWNER}, ${EDITOR})`;
    assert.equal(await deskIsClaimed(), false);
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
