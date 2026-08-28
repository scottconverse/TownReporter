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
