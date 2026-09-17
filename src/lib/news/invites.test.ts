import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  acceptInvite,
  checkInvite,
  createInvite,
  ensureInviteSchema,
  ensureNewsroomSchema,
  ForbiddenError,
  leaveAsEditor,
  signupOpenFor,
} from "./membership.ts";

/**
 * The invite lifecycle (v0.5.3): the one keyed door through the claimed-desk
 * wall. Every property here is one a stranger would probe:
 *
 *  - only the owner mints; an invited editor is refused
 *  - a link is bound to ONE address; sign-up stays closed for every other
 *  - a link burns on use and dies at expiry
 *  - accepting seats an editor, never an owner
 *  - an editor leaving removes their own seat; the newsroom stands
 *
 * Runs on the in-process PGLite. The auth "user" table is opt-in schema in
 * real deployments, so the test creates the two columns these functions read.
 */
const OWNER = "invite-test-owner";
const GUEST = "invite-test-guest";
const OWNER_EMAIL = "owner@invites.test";
const GUEST_EMAIL = "guest@invites.test";

before(async () => {
  const sql = await getSql();
  await sql.query(`create table if not exists "user" (id text primary key, email text not null)`);
  await ensureNewsroomSchema();
  await ensureInviteSchema();
  await sql`delete from editor_invites`;
  await sql`delete from newsroom_members`;
  await sql`delete from "user" where id in (${OWNER}, ${GUEST})`;
  await sql`insert into "user" (id, email) values (${OWNER}, ${OWNER_EMAIL})`;
  await sql`insert into "user" (id, email) values (${GUEST}, ${GUEST_EMAIL})`;
  await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${OWNER}, 'owner', 1)`;
});

describe("editor invites", () => {
  it("keeps signup closed for a stranger on a claimed desk", async () => {
    assert.equal(await signupOpenFor("stranger@invites.test"), false);
  });

  it("refuses a malformed address and a bogus token", async () => {
    await assert.rejects(() => createInvite(OWNER, "not-an-email"), ForbiddenError);
    assert.equal((await checkInvite("zzzz")).ok, false);
    assert.equal((await checkInvite("a".repeat(64))).ok, false);
  });

  it("owner mints; the named address may sign up; every other stays shut", async () => {
    const token = await createInvite(OWNER, GUEST_EMAIL);
    assert.match(token, /^[0-9a-f]{64}$/);
    const check = await checkInvite(token);
    assert.deepEqual(check, { ok: true, email: GUEST_EMAIL });
    assert.equal(await signupOpenFor(GUEST_EMAIL), true);
    assert.equal(await signupOpenFor("other@invites.test"), false);
  });

  it("stores only a hash -- the raw token never touches the table", async () => {
    const token = await createInvite(OWNER, "hash-check@invites.test");
    const sql = await getSql();
    const rows = await sql<{ token_hash: string }>`
      select token_hash from editor_invites where email = ${"hash-check@invites.test"}
    `;
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]!.token_hash, token);
  });

  it("refuses acceptance from a different address, then seats the right one as editor", async () => {
    const token = await createInvite(OWNER, GUEST_EMAIL);
    await assert.rejects(() => acceptInvite(OWNER, token), /different email address/);
    const seated = await acceptInvite(GUEST, token);
    assert.equal(seated.role, "editor");
    const sql = await getSql();
    const row = await sql<{ role: string }>`
      select role from newsroom_members where user_id = ${GUEST}
    `;
    assert.equal(row[0]?.role, "editor");
  });

  it("a used link is dead, and the door is shut again", async () => {
    const sql = await getSql();
    const live = await sql<{ c: number }>`
      select count(*)::int as c from editor_invites
      where email = ${GUEST_EMAIL} and used_at is null
    `;
    assert.equal(live[0]?.c, 0);
    assert.equal(await signupOpenFor(GUEST_EMAIL), false);
  });

  it("an invited editor cannot mint invites or be re-invited", async () => {
    await assert.rejects(() => createInvite(GUEST, "friend@invites.test"), /Only the owner/);
    await assert.rejects(() => createInvite(OWNER, GUEST_EMAIL), /already an editor/);
  });

  it("an expired link is refused with its reason", async () => {
    const token = await createInvite(OWNER, "late@invites.test");
    const sql = await getSql();
    await sql`update editor_invites set expires_at = now() - interval '1 minute'
              where email = ${"late@invites.test"}`;
    const check = await checkInvite(token);
    assert.equal(check.ok, false);
    assert.match((check as { reason: string }).reason, /expired/);
  });

  it("an editor leaving removes only their own seat; the owner keeps the desk", async () => {
    await leaveAsEditor(GUEST);
    const sql = await getSql();
    const rows = await sql<{ user_id: string; role: string }>`
      select user_id, role from newsroom_members
    `;
    assert.deepEqual(rows, [{ user_id: OWNER, role: "owner" }]);
  });
});
