/*
  The first-owner race, measured against a real PGlite.

  Why this file had to be reworked, not just re-run: the claim is now one
  transaction that locks the newsroom row, re-checks the desk, then inserts.
  The old harness here simulated a lost race by mocking `pg.query` and injecting
  a competing insert on the second matching statement -- but `pg.transaction`
  hands its callback a `tx` object whose queries never reach `pg.query`
  (measured, §5.3(d) of the security report), so that mock saw none of the
  claim and its `assert.equal(injected, true)` failed for all eight cases.

  A mock could not have measured this even before: what needs proving is what
  two requests do to each other, so this file now runs four real claims at once
  against the real database. Two of them go through the public path; one drops
  the index first to show the lock alone holds; one takes the index away
  entirely to show the desk then refuses.
*/

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { getSql } from "../db.ts";
import {
  claimFirstOwner,
  claimOwner,
  ensureNewsroomSchema,
  ForbiddenError,
  ONE_OWNER_INDEX,
  readMyDesk,
  requireEditor,
} from "./membership.ts";

const CLAIMANTS = ["race-a", "race-b", "race-c", "race-d"];

/** The one PGlite instance this process's `getSql()` is pointed at. */
function pgliteInstance(): Promise<PGlite> {
  return (globalThis as typeof globalThis & { __pgliteInstance__: Promise<PGlite> })
    .__pgliteInstance__;
}

/** The catalog's own answer to "is the one-owner index there?" */
async function indexInCatalog(): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query(
    `select indexname from pg_indexes where indexname = $1`,
    [ONE_OWNER_INDEX],
  );
  return rows.length > 0;
}

async function ownerIds(): Promise<string[]> {
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from newsroom_members where role = 'owner' order by user_id
  `;
  return rows.map((r) => r.user_id);
}

describe("the owner claim", () => {
  for (const claim of [claimOwner, requireEditor]) {
    it(`${claim.name}: four claims arriving together leave one owner and three refusals`, async () => {
      await ensureNewsroomSchema();
      const sql = await getSql();
      await sql`delete from newsroom_members`;
      assert.equal(await indexInCatalog(), true, "premise: the one-owner index is in place");

      const settled = await Promise.allSettled(CLAIMANTS.map((id) => claim(id)));

      const won = settled.flatMap((r, i) => (r.status === "fulfilled" ? [CLAIMANTS[i]] : []));
      const refused = settled.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      assert.equal(won.length, 1, `winners: ${JSON.stringify(won)}`);
      assert.equal(refused.length, 3);
      for (const lost of refused) {
        assert.ok(
          lost.reason instanceof ForbiddenError,
          `a loser is refused, not thrown: ${String(lost.reason)}`,
        );
      }
      // The row that persisted is the request that was told it owns the desk --
      // not someone else's, and not two of them.
      assert.deepEqual(await ownerIds(), won);
      const total = await sql<{ c: number }>`
        select count(*)::int as c from newsroom_members
      `;
      assert.equal(total[0].c, 1);
      await sql`delete from newsroom_members`;
    });
  }

  /**
   * The lock on its own, with no index anywhere to backstop it.
   *
   * This drives `claimFirstOwner` rather than `claimOwner` on purpose: the
   * public path re-ensures the schema, which would put the index straight back
   * (and then, correctly, refuse to claim without one). The claim under
   * measurement here is exactly the one `requireEditor` runs.
   *
   * The last block is the negative control -- the same four claimants with the
   * same missing index and no transaction: four owners. So the single owner
   * above is the serialised re-check, not the database being slow.
   */
  it("with the one-owner index gone, the locked claim still leaves one owner", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    await sql`delete from newsroom_members`;
    await sql.query(`drop index if exists ${ONE_OWNER_INDEX}`);
    assert.equal(await indexInCatalog(), false, "premise: no index to enforce anything");

    const locked = await Promise.all(CLAIMANTS.map((id) => claimFirstOwner(id)));
    assert.equal(locked.filter((r) => r !== null).length, 1, JSON.stringify(locked));
    assert.equal(locked.filter((r) => r === null).length, 3);
    assert.equal((await ownerIds()).length, 1);
    await sql`delete from newsroom_members`;

    const plainCheck = async (id: string) => {
      const n = await sql<{ c: number }>`
        select count(*)::int as c from newsroom_members where newsroom_id = 1
      `;
      if ((n[0]?.c ?? 0) > 0) return "refused";
      await sql`
        insert into newsroom_members (user_id, role, newsroom_id) values (${id}, 'owner', 1)
      `;
      return "owner";
    };
    assert.deepEqual(await Promise.all(CLAIMANTS.map(plainCheck)), [
      "owner",
      "owner",
      "owner",
      "owner",
    ]);
    assert.equal((await ownerIds()).length, 4, "the plain check is not a fallback");
    await sql`delete from newsroom_members`;

    assert.equal(await ensureNewsroomSchema(), true, "the index is back");
  });

  /**
   * An install whose one-owner index cannot be put in place refuses the desk.
   *
   * Falling back on the check above would hand the desk to two requests at
   * once, which is the hole the index closes, so a claim is better refused than
   * raced. The creation failure is simulated (PGlite accepts the index, so the
   * real failure would be a permissions or corruption problem).
   */
  it("refuses to hand out an owner when the index cannot be put in place", async () => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    await sql`delete from newsroom_members`;
    await sql.query(`drop index if exists ${ONE_OWNER_INDEX}`);
    const pg = await pgliteInstance();
    const original = pg.query.bind(pg);
    const hook = mock.method(pg, "query", async (text: string, params?: unknown[]) => {
      if (text.includes(`create unique index if not exists ${ONE_OWNER_INDEX}`)) {
        throw new Error("permission denied for schema public");
      }
      return original(text, params);
    });
    try {
      await assert.rejects(() => claimOwner("first"), ForbiddenError);
      assert.equal(await indexInCatalog(), false, "premise: the index really is absent");
      assert.deepEqual(await ownerIds(), [], "no owner was created without the guarantee");
    } finally {
      hook.mock.restore();
    }
    assert.equal(await ensureNewsroomSchema(), true, "the index is back");
    assert.equal((await claimOwner("first")).role, "owner", "and the desk is claimable again");
    await sql`delete from newsroom_members`;
  });
});

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
  const pg = await pgliteInstance();
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
