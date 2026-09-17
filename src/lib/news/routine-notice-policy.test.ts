import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getSql } from "../db.ts";
import {
  ensureRoutineNoticePolicySchema,
  readRoutineNoticePolicyFor,
  saveRoutineNoticePolicyFor,
} from "./routine-notice-policy.ts";
import { ensureRoutineNoticeAutomationSchema } from "./routine-notice-automation.ts";

const room = 9520;
const owner = "routine-owner";

beforeEach(async () => {
  const sql = await getSql();
  await sql.query(
    "create table if not exists newsrooms(id integer primary key,name text not null)",
  );
  await sql.query(
    "create table if not exists newsroom_members(user_id text primary key,newsroom_id integer not null,role text not null)",
  );
  await sql.query(
    "create table if not exists sources(id serial primary key,user_id text not null,newsroom_id integer not null,url text not null,title text not null,status text not null default 'accepted')",
  );
  await sql.query(
    "create table if not exists audit_events(id serial primary key,user_id text not null,action text not null,detail text not null default '',created_at timestamptz not null default now(),newsroom_id integer not null default 1,subject_kind text,subject_id integer)",
  );
  await ensureRoutineNoticePolicySchema();
  await sql.query("delete from routine_notice_policy_changes where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_approvals where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_policies where newsroom_id=$1", [room]);
  await sql.query("delete from audit_events where newsroom_id=$1", [room]);
  await sql.query("delete from sources where newsroom_id in ($1,$2)", [room, room + 1]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [room]);
  await sql.query(
    "insert into newsrooms(id,name) values($1,'Routine test') on conflict(id) do nothing",
    [room],
  );
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')", [
    owner,
    room,
  ]);
});

async function source(newsroomId = room, status = "accepted") {
  const sql = await getSql();
  const [row] = await sql.query<{ id: number; url: string }>(
    "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,'Library',$4) returning id,url",
    [owner, newsroomId, `https://example.test/${newsroomId}/${Math.random()}`, status],
  );
  return row!;
}

test("defaults empty and saves/revokes with monotonic CAS and audit", async () => {
  const s = await source();
  const empty = await readRoutineNoticePolicyFor(owner, room);
  assert.equal(empty.revision, 0);
  assert.deepEqual(empty.approvals, []);
  assert.equal(empty.effectivePublicationAvailable, true);
  const saved = await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" }],
  });
  assert.equal(saved.revision, 1);
  assert.equal(saved.approvals[0]?.valid, true);
  const revoked = await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 1,
    paused: true,
    approvals: [],
  });
  assert.equal(revoked.revision, 2);
  assert.equal(revoked.paused, true);
  assert.deepEqual(revoked.approvals, []);
  assert.equal(
    revoked.recentChanges.some((x) => x.revision === 2 && x.action === "revoked"),
    true,
  );
  assert.equal(
    revoked.recentChanges.find((x) => x.revision === 2 && x.action === "revoked")?.sourceUrl,
    s.url,
  );
  assert.equal(
    revoked.recentChanges.some((x) => x.revision === 2 && x.action === "paused"),
    true,
  );
  assert.equal(
    revoked.recentChanges.some((x) => x.revision === 1 && x.action === "approved"),
    true,
  );
  const sql = await getSql();
  const [count] = await sql.query<{ n: number }>(
    "select count(*)::int n from audit_events where newsroom_id=$1 and action='routine-notice-policy'",
    [room],
  );
  assert.equal(count?.n, 2);
});

test("refuses nonowner, foreign, unaccepted, malformed and stale saves without writes", async () => {
  const sql = await getSql();
  await sql.query(
    "insert into newsroom_members(user_id,newsroom_id,role) values('routine-editor',$1,'editor')",
    [room],
  );
  await assert.rejects(readRoutineNoticePolicyFor("routine-editor", room), /only.*owner/i);
  const foreign = await source(room + 1);
  const dropped = await source(room, "dropped");
  for (const [actor, input] of [
    ["routine-editor", { expectedRevision: 0, paused: false, approvals: [] }],
    [
      owner,
      {
        expectedRevision: 0,
        paused: false,
        approvals: [{ sourceId: foreign.id, sourceUrl: foreign.url, formatKey: "library-notice" }],
      },
    ],
    [
      owner,
      {
        expectedRevision: 0,
        paused: false,
        approvals: [{ sourceId: dropped.id, sourceUrl: dropped.url, formatKey: "library-notice" }],
      },
    ],
    [
      owner,
      {
        expectedRevision: 0,
        paused: false,
        approvals: [{ sourceId: dropped.id, sourceUrl: dropped.url, formatKey: "bogus" }],
      },
    ],
  ] as const)
    await assert.rejects(saveRoutineNoticePolicyFor(actor, room, input as never));
  const [count] = await sql.query<{ n: number }>(
    "select count(*)::int n from routine_notice_policies where newsroom_id=$1",
    [room],
  );
  assert.equal(count?.n, 0);
});

test("exact displayed URL is required and later source changes invalidate without blocking pause/revoke", async () => {
  const sql = await getSql();
  const s = await source();
  await assert.rejects(
    saveRoutineNoticePolicyFor(owner, room, {
      expectedRevision: 0,
      paused: false,
      approvals: [{ sourceId: s.id, sourceUrl: s.url + "/changed", formatKey: "library-notice" }],
    }),
    /changed|reload/i,
  );
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" }],
  });
  await sql.query("update sources set url=$2,status='dropped' where id=$1", [s.id, s.url + "/new"]);
  const invalid = await readRoutineNoticePolicyFor(owner, room);
  assert.equal(invalid.approvals[0]?.sourceState, "changed");
  assert.equal(invalid.approvals[0]?.valid, false);
  const paused = await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 1,
    paused: true,
    approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" }],
  });
  assert.equal(paused.paused, true);
  const revoked = await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 2,
    paused: true,
    approvals: [],
  });
  assert.deepEqual(revoked.approvals, []);
});

test("retains unchanged automation selections while pausing and cascades only revoked or replaced approvals", async () => {
  const sql = await getSql();
  const first = await source();
  const second = await source();
  const approvals = [
    { sourceId: first.id, sourceUrl: first.url, formatKey: "library-notice" as const },
    { sourceId: second.id, sourceUrl: second.url, formatKey: "library-notice" as const },
  ];
  await saveRoutineNoticePolicyFor(owner, room, { expectedRevision: 0, paused: false, approvals });
  await ensureRoutineNoticeAutomationSchema();
  await sql.query(
    "insert into routine_notice_automations(newsroom_id,enabled,revision,timezone,local_time,today_section,weekend_section,deadlines_section) values($1,false,1,'America/Denver','06:15','Today','Weekend','Deadlines')",
    [room],
  );
  for (const pair of approvals)
    await sql.query(
      "insert into routine_notice_automation_sources(newsroom_id,source_id,format_key,source_url,public_source_url,issuer,locality,collection_area) values($1,$2,$3,$4,$4,'Fixture issuer','Fixture locality',null)",
      [room, pair.sourceId, pair.formatKey, pair.sourceUrl],
    );
  const selections = async () =>
    (await sql.query<{ n: number }>(
      "select count(*)::int n from routine_notice_automation_sources where newsroom_id=$1",
      [room],
    ))[0]?.n;

  const paused = await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 1,
    paused: true,
    approvals,
  });
  assert.equal(paused.paused, true);
  assert.equal(await selections(), 2);

  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 2,
    paused: true,
    approvals: [approvals[1]!],
  });
  assert.equal(await selections(), 1);

  const replacementUrl = `${second.url}/replacement`;
  await sql.query("update sources set url=$2 where id=$1", [second.id, replacementUrl]);
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 3,
    paused: true,
    approvals: [{ ...approvals[1]!, sourceUrl: replacementUrl }],
  });
  assert.equal(await selections(), 0);
});

test("source deletion irreversibly removes live approval without erasing history", async () => {
  const sql = await getSql();
  const s = await source();
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" }],
  });
  await sql.query("delete from sources where id=$1", [s.id]);
  const read = await readRoutineNoticePolicyFor(owner, room);
  assert.deepEqual(read.approvals, []);
  assert.equal(
    read.recentChanges.some((x) => x.sourceId === s.id),
    true,
  );
  assert.equal(read.recentChanges.find((x) => x.sourceId === s.id)?.sourceUrl, null);
});

test("history never attributes an old approval to a replacement URL or recreated source ID", async () => {
  const sql = await getSql();
  const s = await source();
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" }],
  });
  const replacementUrl = `${s.url}/replacement`;
  await sql.query("update sources set url=$2 where id=$1", [s.id, replacementUrl]);
  const reapproved = await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 1,
    paused: false,
    approvals: [{ sourceId: s.id, sourceUrl: replacementUrl, formatKey: "library-notice" }],
  });
  const oldApproval = reapproved.recentChanges.find(
    (change) => change.revision === 1 && change.action === "approved",
  );
  assert.equal(oldApproval?.sourceUrl, null);
  assert.equal(
    reapproved.recentChanges.some(
      (change) => change.revision === 2 && change.action === "revoked" && change.sourceUrl === null,
    ),
    true,
  );
  assert.equal(
    reapproved.recentChanges.some(
      (change) =>
        change.revision === 2 &&
        change.action === "approved" &&
        change.sourceUrl === replacementUrl,
    ),
    true,
  );
  await sql.query("delete from sources where id=$1", [s.id]);
  await sql.query(
    "insert into sources(id,user_id,newsroom_id,url,title,status) values($1,$2,$3,$4,'Recreated source','accepted')",
    [s.id, owner, room, replacementUrl],
  );
  const recreated = await readRoutineNoticePolicyFor(owner, room);
  assert.deepEqual(recreated.approvals, []);
  assert.equal(
    recreated.recentChanges.some(
      (change) =>
        change.revision === 1 && change.action === "approved" && change.sourceUrl === null,
    ),
    true,
  );
  assert.equal(
    recreated.recentChanges.some(
      (change) => change.revision === 2 && change.action === "revoked" && change.sourceUrl === null,
    ),
    true,
  );
  assert.equal(
    recreated.recentChanges.some(
      (change) =>
        change.revision === 2 &&
        change.action === "approved" &&
        change.sourceUrl === replacementUrl,
    ),
    true,
  );
});

test("audit insertion failure rolls the policy transaction back", async () => {
  const sql = await getSql();
  const s = await source();
  await sql.query(
    "create or replace function fail_routine_audit() returns trigger language plpgsql as $$ begin if NEW.action='routine-notice-policy' then raise exception 'forced audit failure'; end if; return NEW; end $$",
  );
  await sql.query(
    "create trigger fail_routine_audit before insert on audit_events for each row execute function fail_routine_audit()",
  );
  try {
    await assert.rejects(
      saveRoutineNoticePolicyFor(owner, room, {
        expectedRevision: 0,
        paused: false,
        approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" }],
      }),
      /forced audit failure/,
    );
    const [count] = await sql.query<{ n: number }>(
      "select count(*)::int n from routine_notice_policies where newsroom_id=$1",
      [room],
    );
    assert.equal(count?.n, 0);
  } finally {
    await sql.query("drop trigger if exists fail_routine_audit on audit_events");
    await sql.query("drop function if exists fail_routine_audit()");
  }
});

test("two same-revision saves produce one commit and one conflict", async () => {
  const s = await source();
  const input = {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" as const }],
  };
  const outcomes = await Promise.allSettled([
    saveRoutineNoticePolicyFor(owner, room, input),
    saveRoutineNoticePolicyFor(owner, room, { ...input, paused: true }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.filter((x) => x.status === "rejected" && /reload/i.test(String(x.reason))).length,
    1,
  );
  const sql = await getSql();
  const [policy] = await sql.query<{ revision: number }>(
    "select revision from routine_notice_policies where newsroom_id=$1",
    [room],
  );
  const [audits] = await sql.query<{ n: number }>(
    "select count(*)::int n from audit_events where newsroom_id=$1 and action='routine-notice-policy'",
    [room],
  );
  assert.equal(policy?.revision, 1);
  assert.equal(audits?.n, 1);
});

test("duplicate pairs and malformed booleans refuse before persistence", async () => {
  const s = await source();
  const pair = { sourceId: s.id, sourceUrl: s.url, formatKey: "library-notice" };
  await assert.rejects(
    saveRoutineNoticePolicyFor(owner, room, {
      expectedRevision: 0,
      paused: false,
      approvals: [pair, pair],
    }),
    /once/,
  );
  await assert.rejects(
    saveRoutineNoticePolicyFor(owner, room, {
      expectedRevision: 0,
      paused: "false",
      approvals: [],
    }),
    /malformed/,
  );
  await assert.rejects(
    saveRoutineNoticePolicyFor(owner, room, {
      expectedRevision: 0,
      paused: false,
      approvals: Array.from({ length: 61 }, (_, index) => ({
        sourceId: index + 1,
        sourceUrl: `https://example.test/oversized/${index + 1}`,
        formatKey: "library-notice",
      })),
    }),
    /malformed/,
  );
  const sql = await getSql();
  const [count] = await sql.query<{ n: number }>(
    "select count(*)::int n from routine_notice_policies where newsroom_id=$1",
    [room],
  );
  assert.equal(count?.n, 0);
});
