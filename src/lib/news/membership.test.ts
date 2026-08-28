import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  ensureNewsroomSchema,
  isGrokPreviewHost,
  newsroomSetupToken,
  SetupRequiredError,
  ForbiddenError,
  leaveAsEditor,
  deskIsClaimed,
  requireEditor,
  claimOwner,
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

describe("setup token env", () => {
  it("reads NEWSROOM_SETUP_TOKEN", () => {
    const prev = process.env.NEWSROOM_SETUP_TOKEN;
    process.env.NEWSROOM_SETUP_TOKEN = "desk-secret";
    try {
      assert.equal(newsroomSetupToken(), "desk-secret");
    } finally {
      if (prev === undefined) delete process.env.NEWSROOM_SETUP_TOKEN;
      else process.env.NEWSROOM_SETUP_TOKEN = prev;
    }
  });

  it("SetupRequiredError is a 403", () => {
    const err = new SetupRequiredError();
    assert.equal(err.status, 403);
    assert.match(err.message, /NEWSROOM_SETUP_TOKEN/);
  });

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
    await sql`delete from newsroom_members where user_id = ${decoy}`;
  });
});

describe("newsroom isolation", () => {
  it("deskIsClaimed ignores members of another newsroom", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    const before = await deskIsClaimed();
    const decoy = `claim-decoy-${Date.now()}`;
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${decoy}, ${"editor"}, ${99})
    `;
    try {
      assert.equal(await deskIsClaimed(), before);
    } finally {
      await sql`delete from newsroom_members where user_id = ${decoy}`;
    }
  });

  it("a second identity is not an editor", async () => {
    const owner = `sec-own-${Date.now()}`;
    const other = `sec-oth-${Date.now()}`;
    const prev = process.env.NEWSROOM_SETUP_TOKEN;
    delete process.env.NEWSROOM_SETUP_TOKEN;
    try {
      try {
        await requireEditor(owner);
      } catch (err) {
        if (!(err instanceof ForbiddenError)) throw err;
      }
      await assert.rejects(() => requireEditor(other), (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        return true;
      });
    } finally {
      if (prev === undefined) delete process.env.NEWSROOM_SETUP_TOKEN;
      else process.env.NEWSROOM_SETUP_TOKEN = prev;
    }
  });
});

describe("one owner", { concurrency: false }, () => {
  it("parallel requireEditor yields one owner", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    const prev = process.env.NEWSROOM_SETUP_TOKEN;
    delete process.env.NEWSROOM_SETUP_TOKEN;
    const a = `par-a-${Date.now()}`;
    const b = `par-b-${Date.now()}`;
    await sql`delete from newsroom_members where newsroom_id = ${1}`;
    try {
      const results = await Promise.allSettled([requireEditor(a), requireEditor(b)]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
      assert.equal(lost.length, 1);
      if (lost[0] && lost[0].status === "rejected") {
        assert.ok(lost[0].reason instanceof ForbiddenError);
      }
      const owners = await sql<{ c: number }>`
        select count(*)::int as c from newsroom_members
        where newsroom_id = ${1} and role = ${"owner"}
      `;
      assert.equal(owners[0]?.c, 1);
    } finally {
      if (prev === undefined) delete process.env.NEWSROOM_SETUP_TOKEN;
      else process.env.NEWSROOM_SETUP_TOKEN = prev;
      await sql`delete from newsroom_members where user_id = ${a} or user_id = ${b}`;
    }
  });

  it("parallel claimOwner yields one owner", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    const prev = process.env.NEWSROOM_SETUP_TOKEN;
    process.env.NEWSROOM_SETUP_TOKEN = "race-token";
    const a = `clm-a-${Date.now()}`;
    const b = `clm-b-${Date.now()}`;
    await sql`delete from newsroom_members where newsroom_id = ${1}`;
    try {
      const results = await Promise.allSettled([
        claimOwner(a, "race-token"),
        claimOwner(b, "race-token"),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
      const owners = await sql<{ c: number }>`
        select count(*)::int as c from newsroom_members
        where newsroom_id = ${1} and role = ${"owner"}
      `;
      assert.equal(owners[0]?.c, 1);
    } finally {
      if (prev === undefined) delete process.env.NEWSROOM_SETUP_TOKEN;
      else process.env.NEWSROOM_SETUP_TOKEN = prev;
      await sql`delete from newsroom_members where user_id = ${a} or user_id = ${b}`;
    }
  });
});
