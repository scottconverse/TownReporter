import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureFollowUpsSchema, performListFollowUps, performReadFollowUp } from "./follow-ups.ts";

/**
 * The Follow-ups list, after the manual workflow was retired (0.6.81, unit CU).
 * `getSql()` auto-applies migrations/*.sql only under Vite; under plain `node
 * --test` the glob is a no-op (see src/lib/db.ts), so `leads` and `articles`
 * are declared here the same way dark-queue.test.ts and jobs.test.ts do for
 * their own fixtures. `ensureFollowUpsSchema` creates `follow_ups` itself.
 *
 * These call the plain `perform*` functions desk.ts exports for exactly this
 * reason (same shape as `performPublish`) rather than the `createServerFn`-
 * wrapped exports, which need the framework runtime around them.
 *
 * WHAT CHANGED HERE AND WHY. This file used to drive `performCreateFollowUp`,
 * `performRecordFollowUpReply`, `performNudgeFollowUp` and `performDropFollowUp`
 * -- create an ask, record the reply, nudge, drop. Those functions are gone
 * (see the note in follow-ups.ts where their bodies were, and DECISIONS.md:38
 * and :44 for why), so their tests went with them rather than being rewritten
 * around a function that no longer exists. What is left is the read the desk
 * actually makes, plus the one property the retirement adds to it: a manual row
 * cannot be listed, whatever its status. The writes an agent does have their
 * own files (follow-up-agents.test.ts, follow-up-scheduler.test.ts), and the
 * migration that closes the open manual rows has follow-up-migration.test.ts.
 */
async function ensureFixtureTables() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists leads (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      headline text not null,
      why text not null,
      topic text not null default 'council',
      status text not null default 'new',
      source_urls text not null default '[]',
      evidence text not null default '',
      newsworthiness integer not null default 0,
      notes_json text not null default '{}',
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists articles (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      lead_id integer,
      slug text not null unique,
      headline text not null,
      status text not null default 'published',
      published_at timestamptz not null default now(),
      /* 0098. Hand-built schema tracks production, column for column. */
      area text
    )
  `);
}

function ctx(userId: string, newsroomId: number) {
  return { userId, newsroomId };
}

/** A newsroom number nobody else in this process is using. */
function room(base: number) {
  return base + (Math.floor(Math.random() * 100_000) + 1);
}

/**
 * CI failure reproduction (postgres-integration job, run 34023014131): the
 * hypothesis was that `follow_ups` never joins the runtime ensure chain, so
 * a fresh database's first `/desk` request hits a missing relation. This is
 * that check in isolation, run first in this file (before any other test's
 * `ensureFixtureTables()`/`ensureFollowUpsSchema()` call could create the
 * table) against a database this process has not migrated at all -- plain
 * `node --test` never runs `migrations/*.sql` (see the file docstring above
 * and src/lib/db.ts's `createPgliteSql`), so this IS "boot PGLite fresh,
 * skip migrations". It calls `performListFollowUps`, the exact function
 * `listFollowUps` (desk.ts, a createServerFn) delegates to for the desk
 * loader's query, and asserts the table goes from absent to present as a
 * side effect of that one call.
 */
describe("a fresh database with no migrations applied", { timeout: 30000 }, () => {
  it("has no follow_ups table until the first perform* call, which creates it via the ensure chain", async () => {
    // performListFollowUps joins leads/articles too -- migrations-only
    // tables with no ensure* counterpart (see schema-parity.test.ts's
    // ALLOWLIST), unrelated to the bug this test guards against. Stand
    // those up the same way every other test in this file does; the thing
    // under test is follow_ups specifically, created by ensureFollowUpsSchema
    // (called at the top of performListFollowUps) and nothing else here.
    await ensureFixtureTables();

    const sql = await getSql();
    /*
      U18a-1: `migrations/*.sql` is applied to this database before the file
      loads, so `follow_ups` is already there and the "boot PGLite fresh, skip
      migrations" state this test reproduces has to be produced deliberately.
      Drop the table AND its `ensureSchemaOnce` marker -- the marker is what
      makes the ensure chain a no-op -- so the property under test is unchanged:
      one `performListFollowUps` call brings the table into being.
    */
    await sql.query("drop table if exists follow_ups cascade");
    const [markerTable] = await sql<{ exists: boolean }>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = '_schema_ensure_state'
      ) as exists
    `;
    if (markerTable!.exists)
      await sql.query("delete from _schema_ensure_state where name = 'follow-ups'");
    const before = await sql<{ exists: boolean }>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'follow_ups'
      ) as exists
    `;
    assert.equal(before[0]!.exists, false, "follow_ups must not exist before any Follow-ups call on a fresh database");

    // The same code path the desk loader's listFollowUps hits -- see
    // src/lib/news/desk.ts's listFollowUps handler.
    const rows = await performListFollowUps(ctx(`fresh-db-user-${Date.now()}`, 999_999));
    assert.deepEqual(rows, []);

    const after = await sql<{ exists: boolean }>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'follow_ups'
      ) as exists
    `;
    assert.equal(after[0]!.exists, true, "performListFollowUps's ensureFollowUpsSchema() call must create follow_ups");
  });
});

describe("the follow-up list is the agents'", { timeout: 30000 }, () => {
  it("lists an agent row and never a manual one, whatever the manual row's status", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const sql = await getSql();
    const userId = `fu-user-${Date.now()}-${Math.random()}`;
    const ns = room(100_000);

    // The three shapes a manual row can be in: the open one migrations/0106
    // closes, the one it leaves alone, and one an editor answered before
    // 0.6.81. None of them may reach a screen.
    await sql`
      insert into follow_ups (user_id, newsroom_id, who, what, due_on, status, reply_text) values
        (${userId}, ${ns}, 'City Manager''s office', 'cause report on the 15th Avenue explosion', '2026-09-09', 'open', null),
        (${userId}, ${ns}, 'Treasurer', 'the ledger', null, 'dropped', null),
        (${userId}, ${ns}, 'Clerk', 'the minutes', '2026-09-01', 'answered', 'mailed them')
    `;
    const agent = await sql<{ id: number }>`
      insert into follow_ups (user_id, newsroom_id, who, what, status, agent_kind, schedule)
      values (${userId}, ${ns}, 'Re-check the agenda page', 'the agenda page', 'active', 'recheck', 'daily')
      returning id
    `;

    const rows = await performListFollowUps(ctx(userId, ns));
    assert.equal(rows.length, 1, "only the agent row is listed");
    assert.equal(rows[0]!.id, agent[0]!.id);
    assert.equal(rows[0]!.agent_kind, "recheck");
    // The list is what every screen draws, so this is the assertion behind
    // "no Record reply, no Nudge, no manual card anywhere": the row those
    // buttons belonged to is not in the data any screen receives.
    assert.equal(rows.some((r) => r.who === "City Manager's office"), false);
  });

  it("hands back every 0101 column, so a branch that forgot one fails here", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const sql = await getSql();
    const userId = `fu-cols-${Date.now()}-${Math.random()}`;
    const ns = room(200_000);
    const leadRows = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why)
      values (${userId}, ${ns}, 'The council votes Monday', 'because it changes the budget')
      returning id
    `;
    const leadId = leadRows[0]!.id;
    const inserted = await sql<{ id: number }>`
      insert into follow_ups (
        user_id, newsroom_id, lead_id, who, what, status, agent_kind, targets_json, schedule,
        model_choice, last_state, last_run_at, next_run_at, finding_json
      ) values (
        ${userId}, ${ns}, ${leadId}, 'Re-check the packet', 'the packet', 'active', 'recheck',
        '["https://clerk.test/packet"]', 'daily', 'sonnet', 'found', now(), now(), '{"url":"https://clerk.test/packet"}'
      )
      returning id
    `;
    const row = (await performListFollowUps(ctx(userId, ns)))[0]!;
    assert.equal(row.id, inserted[0]!.id);
    assert.equal(row.lead_id, leadId);
    assert.equal(row.lead_headline, "The council votes Monday", "the lead join is part of the shape");
    assert.equal(row.targets_json, '["https://clerk.test/packet"]');
    assert.equal(row.schedule, "daily");
    assert.equal(row.model_choice, "sonnet");
    assert.equal(row.last_state, "found");
    assert.ok(row.last_run_at, "last_run_at came back");
    assert.ok(row.next_run_at, "next_run_at came back");
    assert.match(row.finding_json, /clerk\.test\/packet/);
  });

  it("scopes the list and the single read to one newsroom", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const sql = await getSql();
    const userId = `fu-scope-${Date.now()}-${Math.random()}`;
    const nsA = room(300_000);
    const nsB = nsA + 1;
    const mine = await sql<{ id: number }>`
      insert into follow_ups (user_id, newsroom_id, who, what, status, agent_kind, schedule)
      values (${userId}, ${nsA}, 'Re-check', 'the agenda', 'active', 'recheck', 'daily')
      returning id
    `;

    assert.equal((await performListFollowUps(ctx(userId, nsA))).length, 1);
    assert.deepEqual(await performListFollowUps(ctx(userId, nsB)), [], "a second newsroom's list is empty");
    assert.equal((await performReadFollowUp(ctx(userId, nsA), mine[0]!.id))?.id, mine[0]!.id, "a run reads its own row");
    assert.equal(
      await performReadFollowUp(ctx(userId, nsB), mine[0]!.id),
      null,
      "and another newsroom's read answers 'not mine' rather than the row",
    );
  });

  it("clamps the limit rather than trusting it", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const sql = await getSql();
    const userId = `fu-limit-${Date.now()}-${Math.random()}`;
    const ns = room(400_000);
    for (let n = 0; n < 3; n += 1) {
      await sql`
        insert into follow_ups (user_id, newsroom_id, who, what, status, agent_kind, schedule)
        values (${userId}, ${ns}, 'Re-check', ${`the agenda ${n}`}, 'active', 'recheck', 'daily')
      `;
    }
    assert.equal((await performListFollowUps(ctx(userId, ns), { limit: 2 })).length, 2);
    assert.equal((await performListFollowUps(ctx(userId, ns), { limit: 0 })).length, 1, "0 is raised to 1, not to everything");
    assert.equal((await performListFollowUps(ctx(userId, ns), { limit: 9_999 })).length, 3);
  });
});
