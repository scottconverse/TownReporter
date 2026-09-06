import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  ensureFollowUpsSchema,
  performCreateFollowUp,
  performDropFollowUp,
  performListFollowUps,
  performNudgeFollowUp,
  performRecordFollowUpReply,
} from "./follow-ups.ts";
import { parseNotes } from "./notes.ts";

/**
 * The Follow-ups object (Direction A, stage 1). `getSql()` auto-applies
 * migrations/*.sql only under Vite; under plain `node --test` the glob is a
 * no-op (see src/lib/db.ts), so `leads` and `articles` are declared here the
 * same way dark-queue.test.ts and jobs.test.ts do for their own fixtures.
 * `ensureFollowUpsSchema` (real, from desk.ts) creates `follow_ups` itself.
 *
 * These call the plain `perform*` functions desk.ts exports for exactly this
 * reason (same shape as `performPublish`) rather than the `createServerFn`-
 * wrapped exports, which need the framework runtime around them.
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
      published_at timestamptz not null default now()
    )
  `);
}

function ctx(userId: string, newsroomId: number) {
  return { userId, newsroomId };
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

describe("Follow-ups server functions", { timeout: 30000 }, () => {
  it("creates a follow-up and lists it back, newsroom-scoped", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const userId = `fu-user-${Date.now()}-${Math.random()}`;
    const nsA = Math.floor(Math.random() * 1_000_000) + 100;
    const nsB = nsA + 1;

    const created = await performCreateFollowUp(ctx(userId, nsA), {
      who: "City Manager's office",
      what: "cause report on the 15th Avenue explosion",
      dueOn: "2026-09-09",
    });
    assert.equal(created.ok, true);

    const listA = await performListFollowUps(ctx(userId, nsA));
    assert.equal(listA.length, 1);
    assert.equal(listA[0]!.who, "City Manager's office");
    assert.equal(listA[0]!.status, "open");

    // A second newsroom cannot see the first's follow-up.
    const listB = await performListFollowUps(ctx(userId, nsB));
    assert.equal(listB.length, 0);
  });

  it("rejects an empty who/what", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const userId = `fu-empty-${Date.now()}`;
    const ns = Math.floor(Math.random() * 1_000_000) + 200_000;
    const res = await performCreateFollowUp(ctx(userId, ns), { who: "  ", what: "" });
    assert.equal(res.ok, false);
  });

  it("recording a reply marks it answered and appends to the linked lead's reporting notes", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const sql = await getSql();
    const userId = `fu-reply-${Date.now()}-${Math.random()}`;
    const ns = Math.floor(Math.random() * 1_000_000) + 300_000;
    const leadRows = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why) values (${userId}, ${ns}, 'A lead', 'because')
      returning id
    `;
    const leadId = leadRows[0]!.id;

    const created = await performCreateFollowUp(ctx(userId, ns), {
      leadId,
      who: "Fire marshal",
      what: "incident report",
    });
    assert.equal(created.ok, true);
    const id = created.ok ? created.id : -1;

    const replied = await performRecordFollowUpReply(ctx(userId, ns), {
      id,
      replyText: "The cause was a severed line.",
      repliedOn: "2026-09-06",
    });
    assert.equal(replied.ok, true);

    const list = await performListFollowUps(ctx(userId, ns), { status: "answered" });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.status, "answered");
    assert.ok(list[0]!.answered_at);

    const leadRow = await sql<{ notes_json: string }>`select notes_json from leads where id = ${leadId}`;
    const notes = parseNotes(leadRow[0]!.notes_json);
    assert.ok(
      notes.found.some((f) => f.t.includes("Reply from Fire marshal") && f.t.includes("severed line")),
      "expected the reply appended to the lead's found notes",
    );
  });

  it("a second newsroom cannot record a reply or drop another newsroom's follow-up", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const userId = `fu-cross-${Date.now()}-${Math.random()}`;
    const nsA = Math.floor(Math.random() * 1_000_000) + 400_000;
    const nsB = nsA + 1;
    const created = await performCreateFollowUp(ctx(userId, nsA), {
      who: "Water utility",
      what: "billing spike explanation",
    });
    assert.equal(created.ok, true);
    const id = created.ok ? created.id : -1;

    const replyFromOther = await performRecordFollowUpReply(ctx(userId, nsB), {
      id,
      replyText: "Should not land.",
    });
    assert.equal(replyFromOther.ok, false);

    await performDropFollowUp(ctx(userId, nsB), id);
    const stillOpen = await performListFollowUps(ctx(userId, nsA));
    assert.equal(stillOpen[0]!.status, "open");
  });

  it("nudge stamps nudged_at and drop marks it dropped", async () => {
    await ensureFixtureTables();
    await ensureFollowUpsSchema();
    const userId = `fu-nudge-${Date.now()}-${Math.random()}`;
    const ns = Math.floor(Math.random() * 1_000_000) + 500_000;
    const created = await performCreateFollowUp(ctx(userId, ns), {
      who: "Planning board",
      what: "a hearing date",
    });
    const id = created.ok ? created.id : -1;

    await performNudgeFollowUp(ctx(userId, ns), id);
    const afterNudge = await performListFollowUps(ctx(userId, ns));
    assert.ok(afterNudge[0]!.nudged_at);
    assert.equal(afterNudge[0]!.status, "open");

    await performDropFollowUp(ctx(userId, ns), id);
    const afterDrop = await performListFollowUps(ctx(userId, ns), { status: "dropped" });
    assert.equal(afterDrop.length, 1);
  });
});
