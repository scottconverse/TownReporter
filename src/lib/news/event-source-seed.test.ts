import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql, withTransaction } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  EVENT_SOURCE_FORMAT_KEY,
  EVENT_SOURCE_READERS,
  EventSourceSeedError,
  readEventSourceSeed,
  seedEventSources,
} from "./event-source-seed.server.ts";
import { ROUTINE_NOTICE_SOURCE_LIMIT_ENV } from "./routine-notice-source-limit.ts";

await applyMigrationsToTestPglite();

async function seedRoom(room: number, automation = true) {
  const sql = await getSql();
  const owner = `event-seed-owner-${room}`;
  await sql.query("insert into newsrooms(id,name) values($1,$2)", [room, `Event seed ${room}`]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')", [
    owner,
    room,
  ]);
  await sql.query("insert into routine_notice_policies(newsroom_id) values($1)", [room]);
  if (automation) {
    await sql.query(
      `insert into routine_notice_automations(newsroom_id,enabled,revision,timezone,local_time,today_section,weekend_section,deadlines_section,activated_by)
       values($1,false,4,'America/Denver','06:15','news','events','deadlines',$2)`,
      [room, owner],
    );
  }
  return owner;
}

async function counts(room: number) {
  const sql = await getSql();
  const [row] = await sql.query<{
    sources: number;
    approvals: number;
    links: number;
    changes: number;
    audits: number;
  }>(
    `select
       (select count(*)::int from sources where newsroom_id=$1) sources,
       (select count(*)::int from routine_notice_approvals where newsroom_id=$1) approvals,
       (select count(*)::int from routine_notice_automation_sources where newsroom_id=$1) links,
       (select count(*)::int from routine_notice_automation_changes where newsroom_id=$1) changes,
       (select count(*)::int from audit_events where newsroom_id=$1 and action='routine-notice-automation') audits`,
    [room],
  );
  return row!;
}

describe("reviewed event source list", () => {
  it("has 37 working HTTPS feeds and six separate skips", () => {
    const seed = readEventSourceSeed();
    assert.equal(seed.sources.length, 37);
    assert.equal(seed.skipped.length, 6);
    assert.equal(new Set(seed.sources.map((source) => source.url)).size, 37);
    for (const source of seed.sources) {
      assert.equal(new URL(source.url).protocol, "https:", source.url);
      assert.ok(EVENT_SOURCE_READERS.includes(source.reader), source.url);
      assert.ok(source.town.trim(), source.url);
      assert.match(source.devResult, /^worked:/);
    }
    const workingUrls = new Set(seed.sources.map((source) => source.url));
    for (const skipped of seed.skipped) assert.equal(workingUrls.has(skipped.url), false);
  });
});

describe("event source seed transaction", () => {
  it("dry run writes nothing", async () => {
    const room = 951_001;
    await seedRoom(room);
    const before = await counts(room);
    const result = await withTransaction((sql) =>
      seedEventSources(sql, { newsroomId: room, batch: 1, apply: false }),
    );
    assert.equal(result.applied, false);
    assert.equal(result.selected, 10);
    assert.deepEqual(await counts(room), before);
  });

  it("adds batch 1 once, then a second apply adds nothing", async () => {
    const room = 951_002;
    const owner = await seedRoom(room);
    const expected = readEventSourceSeed().sources.filter((source) => source.batch === 1);

    const first = await withTransaction((sql) =>
      seedEventSources(sql, { newsroomId: room, batch: 1, apply: true }),
    );
    assert.equal(first.sourceRowsAdded, expected.length);
    assert.equal(first.approvalsAdded, expected.length);
    assert.equal(first.linksAdded, expected.length);
    assert.equal(first.revision, 5);

    const afterFirst = await counts(room);
    assert.deepEqual(afterFirst, {
      sources: expected.length,
      approvals: expected.length,
      links: expected.length,
      changes: 1,
      audits: 1,
    });

    const sql = await getSql();
    const [source] = await sql.query<{
      user_id: string;
      title: string;
      kind: string;
      tier: string;
      status: string;
      interval_minutes: number;
    }>(
      "select user_id,title,kind,tier,status,interval_minutes from sources where newsroom_id=$1 and url=$2",
      [room, expected[0]!.url],
    );
    assert.deepEqual(source, {
      user_id: owner,
      title: expected[0]!.name,
      kind: "community",
      tier: "A",
      status: "accepted",
      interval_minutes: 1440,
    });

    const [link] = await sql.query<{
      format_key: string;
      source_url: string;
      public_source_url: string;
      issuer: string;
      locality: string;
    }>(
      "select format_key,source_url,public_source_url,issuer,locality from routine_notice_automation_sources where newsroom_id=$1 and source_url=$2",
      [room, expected[0]!.url],
    );
    assert.deepEqual(link, {
      format_key: EVENT_SOURCE_FORMAT_KEY,
      source_url: expected[0]!.url,
      public_source_url: expected[0]!.url,
      issuer: expected[0]!.name,
      locality: `${expected[0]!.town}, Colorado`,
    });

    const second = await withTransaction((sql) =>
      seedEventSources(sql, { newsroomId: room, batch: 1, apply: true }),
    );
    assert.equal(second.sourceRowsAdded, 0);
    assert.equal(second.approvalsAdded, 0);
    assert.equal(second.linksAdded, 0);
    assert.equal(second.revision, 5);
    assert.deepEqual(await counts(room), afterFirst);

    const [automation] = await sql.query<{ revision: number }>(
      "select revision from routine_notice_automations where newsroom_id=$1",
      [room],
    );
    assert.equal(automation!.revision, 5);

    const [change] = await sql.query<{ action: string; detail: string }>(
      "select action,detail from routine_notice_automation_changes where newsroom_id=$1",
      [room],
    );
    assert.deepEqual(change, { action: "saved", detail: "added 10 event sources" });
  });

  it("reuses an existing source URL", async () => {
    const room = 951_003;
    const owner = await seedRoom(room);
    const source = readEventSourceSeed().sources.find((item) => item.batch === 1)!;
    const sql = await getSql();
    const [existing] = await sql.query<{ id: number }>(
      `insert into sources(newsroom_id,user_id,url,title,kind,tier,status,interval_minutes)
       values($1,$2,$3,'Existing title','official','B','accepted',60) returning id`,
      [room, owner, source.url],
    );

    const result = await withTransaction((tx) =>
      seedEventSources(tx, { newsroomId: room, batch: 1, apply: true }),
    );
    assert.equal(result.sourceRowsAdded, 9);
    assert.equal(result.approvalsAdded, 10);
    assert.equal(result.linksAdded, 10);

    const rows = await sql.query<{ id: number; title: string; kind: string }>(
      "select id,title,kind from sources where newsroom_id=$1 and url=$2",
      [room, source.url],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { id: existing!.id, title: "Existing title", kind: "official" });
  });

  it("names the number of event sources actually linked in the change detail", async () => {
    const room = 951_006;
    const owner = await seedRoom(room);
    const expected = readEventSourceSeed().sources.filter((source) => source.batch === 1);
    const alreadyLinked = expected[0]!;
    const sql = await getSql();
    const [existing] = await sql.query<{ id: number }>(
      `insert into sources(newsroom_id,user_id,url,title,kind,tier,status,interval_minutes)
       values($1,$2,$3,$4,'community','A','accepted',1440) returning id`,
      [room, owner, alreadyLinked.url, alreadyLinked.name],
    );
    await sql.query(
      `insert into routine_notice_approvals(newsroom_id,source_id,format_key,source_url)
       values($1,$2,$3,$4)`,
      [room, existing!.id, EVENT_SOURCE_FORMAT_KEY, alreadyLinked.url],
    );
    await sql.query(
      `insert into routine_notice_automation_sources(newsroom_id,source_id,format_key,source_url,public_source_url,issuer,locality)
       values($1,$2,$3,$4,$4,$5,$6)`,
      [
        room,
        existing!.id,
        EVENT_SOURCE_FORMAT_KEY,
        alreadyLinked.url,
        alreadyLinked.name,
        `${alreadyLinked.town}, Colorado`,
      ],
    );

    const result = await withTransaction((tx) =>
      seedEventSources(tx, { newsroomId: room, batch: 1, apply: true }),
    );
    assert.equal(result.linksAdded, expected.length - 1);

    const [change] = await sql.query<{ detail: string }>(
      "select detail from routine_notice_automation_changes where newsroom_id=$1",
      [room],
    );
    assert.equal(change!.detail, "added 9 event sources");
  });

  it("leaves an existing source with a non-accepted status unapproved and unlinked", async () => {
    const room = 951_007;
    const owner = await seedRoom(room);
    const source = readEventSourceSeed().sources.find((item) => item.batch === 1)!;
    const sql = await getSql();
    const [existing] = await sql.query<{ id: number }>(
      `insert into sources(newsroom_id,user_id,url,title,kind,tier,status,interval_minutes)
       values($1,$2,$3,'Existing paused title','official','B','paused',60) returning id`,
      [room, owner, source.url],
    );

    const result = await withTransaction((tx) =>
      seedEventSources(tx, { newsroomId: room, batch: 1, apply: true }),
    );
    assert.deepEqual(result.notAccepted, [
      { name: source.name, town: source.town, url: source.url, status: "paused" },
    ]);
    assert.equal(result.planned.some((item) => item.source.url === source.url), false);
    assert.equal(result.sourceRowsAdded, 9);
    assert.equal(result.approvalsAdded, 9);
    assert.equal(result.linksAdded, 9);

    const [unchanged] = await sql.query<{ status: string }>(
      "select status from sources where newsroom_id=$1 and url=$2",
      [room, source.url],
    );
    assert.equal(unchanged!.status, "paused");
    const [permissions] = await sql.query<{ approvals: number; links: number }>(
      `select
         (select count(*)::int from routine_notice_approvals where newsroom_id=$1 and source_id=$2) approvals,
         (select count(*)::int from routine_notice_automation_sources where newsroom_id=$1 and source_id=$2) links`,
      [room, existing!.id],
    );
    assert.deepEqual(permissions, { approvals: 0, links: 0 });
  });

  it("refuses over the source limit and writes nothing", async () => {
    const room = 951_004;
    await seedRoom(room);
    const before = await counts(room);
    const previous = process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
    process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = "9";
    try {
      await assert.rejects(
        withTransaction((sql) =>
          seedEventSources(sql, { newsroomId: room, batch: 1, apply: true }),
        ),
        (error) => error instanceof EventSourceSeedError && error.code === "over-limit",
      );
    } finally {
      if (previous === undefined) delete process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV];
      else process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV] = previous;
    }
    assert.deepEqual(await counts(room), before);
  });

  it("refuses without an automation row and writes nothing", async () => {
    const room = 951_005;
    await seedRoom(room, false);
    await assert.rejects(
      withTransaction((sql) => seedEventSources(sql, { newsroomId: room, batch: 1, apply: true })),
      (error) => error instanceof EventSourceSeedError && error.code === "no-automation",
    );
    assert.deepEqual(await counts(room), {
      sources: 0,
      approvals: 0,
      links: 0,
      changes: 0,
      audits: 0,
    });
  });
});
