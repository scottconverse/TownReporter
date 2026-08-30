import { describe, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { purgeAllOldTrash, TRASH_DAYS } from "./trash-store.ts";
import { tickAllDueMonitors } from "./monitors-cron.ts";

/**
 * Apply the real migrations, from disk. Same approach as delete.test.ts: under
 * `node --test` there is no Vite glob transform, so `deleted_items` (declared
 * in `migrations/0016_trash.sql`) only exists if the migration files are
 * actually applied. Copying the DDL into this file would test the copy, not
 * the schema that runs in production.
 */
async function applyMigrations() {
  const sql = await getSql();
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // Same rationale as delete.test.ts: a migration that does not apply to
      // a bare PGLite is not this test's problem. The assertion below fails
      // loudly if `deleted_items` itself was among the casualties.
    }
  }
  const cols = await sql<{ table_name: string }>`
    select table_name from information_schema.columns where table_name = 'deleted_items'
  `;
  assert.ok(cols.length > 0, "migrations did not create deleted_items");
}

before(applyMigrations);

/**
 * Insert a trash row directly, backdated by `ageSeconds`, without going
 * through the app's delete path.
 *
 * Seconds rather than days: the boundary case below needs to land just
 * inside and just outside the thirty-day cutoff, and real wall-clock time
 * elapses between seeding a row and the purge query running against it. An
 * "exactly TRASH_DAYS old" row is a coin flip by the time the DELETE
 * actually executes — a several-second margin is not.
 */
async function seedTrashRow(newsroomId: number, ageSeconds: number, label: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into deleted_items (newsroom_id, kind, ref_id, label, payload, deleted_by, deleted_at)
    values (${newsroomId}, 'lead', 1, ${label}, '{}', 'test',
      now() - make_interval(secs => ${ageSeconds}))
    returning id
  `;
  return rows[0]!.id;
}

const DAY_SECONDS = 86_400;

async function trashCount(): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ c: number }>`select count(*)::int as c from deleted_items`;
  return rows[0]!.c;
}

describe("ENG-106: the thirty-day trash window must expire without an operator looking", () => {
  it(
    "reproduces the original bug, then proves the fix: the five-minute cron tick — the " +
      "trigger that fires with no operator present — must expire a row nobody's Trash " +
      "page ever looked at",
    async () => {
      // Same shape as the finding: a lead deleted well outside the thirty-day
      // promise, in a newsroom whose Trash panel nobody has opened since.
      // Seeded directly into the table, exactly like an operator who never
      // opens /desk/ops — the app-level "look at Trash" trigger (listTrash's
      // lazy purgeOld) is never invoked anywhere in this test.
      const staleId = await seedTrashRow(
        999001,
        (TRASH_DAYS + 400) * DAY_SECONDS,
        "a source's name, deleted a year ago",
      );

      // Before ENG-106 the only DELETE against deleted_items lived behind
      // listTrash. Running the cron tick — the one trigger the finding says
      // fires without an operator — used to leave this row untouched, which
      // is the bug: "kept for thirty days" silently meant "forever" for any
      // desk nobody opens. Revert the sweep call in monitors-cron.ts (or the
      // purgeAllOldTrash call it makes) and this assertion goes red again.
      await tickAllDueMonitors();

      const rows = await getSql().then((sql) =>
        sql<{ id: number }>`select id from deleted_items where id = ${staleId}`,
      );
      assert.equal(
        rows.length,
        0,
        "a year-old trash row must be gone after the unattended cron tick runs, " +
          "with no Trash page ever opened",
      );
    },
  );

  it("purgeAllOldTrash removes rows past the window, across newsrooms, without a newsroomId", async () => {
    const before = await trashCount();
    const staleA = await seedTrashRow(1, (TRASH_DAYS + 1) * DAY_SECONDS, "stale in newsroom 1");
    const staleB = await seedTrashRow(2, (TRASH_DAYS + 90) * DAY_SECONDS, "stale in newsroom 2");
    const fresh = await seedTrashRow(1, (TRASH_DAYS - 1) * DAY_SECONDS, "still inside the window");
    // Thirty seconds shy of the cutoff: close enough to prove the boundary is
    // real, far enough that the seed-to-purge gap can't flip it (see the
    // comment on seedTrashRow).
    const justInside = await seedTrashRow(1, TRASH_DAYS * DAY_SECONDS - 30, "just inside the window");

    const purged = await purgeAllOldTrash(await getSql());

    assert.equal(purged, 2, "exactly the two rows older than TRASH_DAYS should be purged");
    assert.equal(await trashCount(), before + 2, "the survivors must still be counted");

    const sql = await getSql();
    const remainingIds = (await sql<{ id: number }>`select id from deleted_items`).map((r) => r.id);
    assert.ok(!remainingIds.includes(staleA), "a row older than the window must be gone");
    assert.ok(!remainingIds.includes(staleB), "a stale row in a DIFFERENT newsroom must also be gone");
    assert.ok(remainingIds.includes(fresh), "a row well inside the window must survive");
    assert.ok(
      remainingIds.includes(justInside),
      "a row just inside the thirty-day window must survive (the cutoff is 'older than', not 'at least')",
    );
  });

  it("running the sweep twice in a row is harmless: nothing left to purge purges nothing", async () => {
    const purgedAgain = await purgeAllOldTrash(await getSql());
    assert.equal(purgedAgain, 0);
  });
});
