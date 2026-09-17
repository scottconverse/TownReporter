import { it, mock } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { getSql } from "../db.ts";
import {
  claimOwner,
  ensureNewsroomSchema,
  ForbiddenError,
  readMyDesk,
  requireEditor,
} from "./membership.ts";

for (const claim of [requireEditor, claimOwner]) {
  for (const phase of ["membership", "count"]) {
    for (const sameUser of [true, false]) {
      it(`${claim.name}: ${sameUser ? "same owner succeeds" : "stranger denied"} after concurrent claim at ${phase}`, async () => {
        await ensureNewsroomSchema();
        const sql = await getSql();
        await sql`delete from newsroom_members`;
        const pg = await (globalThis as typeof globalThis & { __pgliteInstance__: Promise<PGlite> })
          .__pgliteInstance__;
        const original = pg.query.bind(pg);
        let injected = false;
        const hook = mock.method(pg, "query", async (text: string, params?: unknown[]) => {
          const result = await original(text, params);
          const selected =
            phase === "membership"
              ? /select role, newsroom_id from newsroom_members where user_id/.test(text)
              : /select count\(\*\)::int as c from newsroom_members where newsroom_id/.test(text);
          if (!injected && selected) {
            injected = true;
            await original(
              "insert into newsroom_members(user_id,role,newsroom_id) values ($1,'owner',1)",
              [sameUser ? "racing-owner" : "other-owner"],
            );
          }
          return result;
        });
        try {
          if (sameUser)
            assert.deepEqual(await claim("racing-owner"), { role: "owner", newsroomId: 1 });
          else await assert.rejects(claim("racing-owner"), ForbiddenError);
          assert.equal(injected, true);
          const rows = await sql`select user_id from newsroom_members`;
          assert.equal(rows.length, 1);
        } finally {
          hook.mock.restore();
          await sql`delete from newsroom_members`;
        }
      });
    }
  }
}

it("desk status uses one snapshot and never grants a stranger or unsupported role access", async () => {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql`delete from newsroom_members`;
  assert.deepEqual(await readMyDesk("owner"), {
    ok: false,
    role: null,
    newsroomId: null,
    claimed: false,
  });
  const pg = await (globalThis as typeof globalThis & { __pgliteInstance__: Promise<PGlite> })
    .__pgliteInstance__;
  const original = pg.query.bind(pg);
  let snapshots = 0;
  const hook = mock.method(pg, "query", async (text: string, params?: unknown[]) => {
    if (/left join newsroom_members m/.test(text)) {
      snapshots++;
      await original(
        "insert into newsroom_members(user_id,role,newsroom_id) values ('owner','owner',1) on conflict do nothing",
      );
    }
    return original(text, params);
  });
  try {
    assert.deepEqual(await readMyDesk("owner"), {
      ok: true,
      role: "owner",
      newsroomId: 1,
      claimed: true,
    });
    assert.equal(snapshots, 1);
    assert.deepEqual(await readMyDesk("stranger"), {
      ok: false,
      role: null,
      newsroomId: null,
      claimed: true,
    });
    await sql`insert into newsroom_members(user_id,role,newsroom_id) values ('reader','reader',1), ('invited','editor',7)`;
    assert.equal((await readMyDesk("reader")).ok, false);
    await assert.rejects(requireEditor("reader"), ForbiddenError);
    await assert.rejects(claimOwner("reader"), ForbiddenError);
    assert.deepEqual(await readMyDesk("invited"), {
      ok: true,
      role: "editor",
      newsroomId: 7,
      claimed: true,
    });
  } finally {
    hook.mock.restore();
    await sql`delete from newsroom_members`;
  }
});
