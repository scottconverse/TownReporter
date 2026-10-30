import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { ensureJobsSchema, type DeskJob } from "./jobs.ts";
import {
  ensureRoutineNoticeAutomationSchema,
  saveRoutineNoticeAutomationFor,
} from "./routine-notice-automation.ts";
import {
  ensureRoutineNoticePolicySchema,
  saveRoutineNoticePolicyFor,
} from "./routine-notice-policy.ts";
import {
  performRoutineNoticeWorkWith,
  tickRoutineNoticeEditions,
} from "./routine-notice-worker.server.ts";
import { recordSourceRead, type RoutineEventInput } from "./routine-events.server.ts";

await applyMigrationsToTestPglite();

const room = 9743;
const owner = "events-table-owner";
const now = new Date("2026-09-08T13:00:00Z");
const localDate = "2026-09-08";
const window = { start: localDate, end: "2026-09-15" };

beforeEach(async () => {
  const sql = await getSql();
  await ensureRoutineNoticePolicySchema();
  await ensureRoutineNoticeAutomationSchema();
  await ensureJobsSchema();
  await sql.query("delete from routine_events where newsroom_id=$1", [room]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_publications where newsroom_id=$1", [room]);
  await sql.query("delete from corrections where newsroom_id=$1", [room]);
  await sql.query("delete from articles where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_runs where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_automations where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_policies where newsroom_id=$1", [room]);
  await sql.query("delete from sources where newsroom_id=$1", [room]);
  await sql.query("delete from newsroom_sections where newsroom_id=$1", [room]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [room]);
  await sql.query("delete from newsrooms where id=$1", [room]);
  await sql.query("insert into newsrooms(id,name) values($1,'Events table test')", [room]);
  await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')", [owner, room]);
  for (const [position, key] of ["news", "events", "deadlines"].entries())
    await sql.query(
      "insert into newsroom_sections(newsroom_id,key,name,visible,position) values($1,$2,$2,true,$3)",
      [room, key, position],
    );
});

async function activate(specs: Array<{ title: string; issuer: string; locality: string }>) {
  const sql = await getSql();
  const sources: Array<{ id: number; url: string; publicUrl: string; title: string; issuer: string; locality: string }> = [];
  for (const [index, spec] of specs.entries()) {
    const publicUrl = `https://calendar.example/${index + 1}`;
    const [source] = await sql.query<{ id: number; url: string }>(
      "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,$4,'accepted') returning id,url",
      [owner, room, `https://source.example/${index + 1}/feed`, spec.title],
    );
    sources.push({ ...source!, publicUrl, ...spec });
  }
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: sources.map((source) => ({
      sourceId: source.id,
      sourceUrl: source.url,
      formatKey: "community-arts-event-logistics",
    })),
  });
  await saveRoutineNoticeAutomationFor(owner, room, {
    expectedRevision: 0,
    enabled: true,
    timezone: "America/Denver",
    localTime: "06:15",
    sections: { today: "news", weekend: "events", deadlines: "deadlines" },
    sources: sources.map((source) => ({
      sourceId: source.id,
      sourceUrl: source.url,
      publicSourceUrl: source.publicUrl,
      formatKey: "community-arts-event-logistics",
      issuer: source.issuer,
      locality: source.locality,
      collectionArea: null,
    })),
  });
  return sources;
}

function event(
  sourceId: number,
  eventKey: string,
  overrides: Partial<RoutineEventInput> = {},
): RoutineEventInput {
  return {
    eventKey,
    candidateKey: `candidate-${eventKey}`,
    matchKey: "stone cup show|2026-09-08|1080|stone cup",
    title: "Stone Cup show",
    startsAt: "2026-09-09T00:00:00.000Z",
    localDate,
    startMinutes: 18 * 60,
    allDay: false,
    place: "Stone Cup",
    town: "Longmont",
    area: "longmont",
    link: `https://event.example/${eventKey}`,
    ...overrides,
  };
}

async function runningJob() {
  await tickRoutineNoticeEditions(now);
  const sql = await getSql();
  const [job] = await sql.query<DeskJob>(
    "update desk_jobs set status='running',claim_token=$2 where newsroom_id=$1 and kind='routine-notice' returning *",
    [room, `events-table-${Math.random()}`],
  );
  return job!;
}

async function rawEvent(source: { id: number }, key: string, date: string) {
  const sql = await getSql();
  await sql.query(
    `insert into routine_events(
       newsroom_id,source_id,event_key,candidate_key,match_key,title,local_date,start_minutes,
       all_day,place,town,area,source_url,source_issuer,source_title
     ) values($1,$2,$3,$4,$5,$6,$7,540,false,'Park','Longmont','longmont',$8,'Arts','Calendar')`,
    [room, source.id, key, `candidate-${key}`, `park|${date}|540|park`, key, date, `https://source.example/${source.id}`],
  );
}

test("a full source read removes only its own unseen window rows", async () => {
  const [a, b] = await activate([
    { title: "Source A", issuer: "Arts A", locality: "Longmont" },
    { title: "Source B", issuer: "Arts B", locality: "Longmont" },
  ]);
  const sql = await getSql();
  await recordSourceRead(sql, {
    newsroomId: room,
    sourceId: a!.id,
    sourceUrl: a!.publicUrl,
    sourceIssuer: a!.issuer,
    sourceTitle: a!.title,
    localDate,
    window,
    fullRead: true,
    events: [event(a!.id, "a-x")],
  });
  await recordSourceRead(sql, {
    newsroomId: room,
    sourceId: b!.id,
    sourceUrl: b!.publicUrl,
    sourceIssuer: b!.issuer,
    sourceTitle: b!.title,
    localDate,
    window,
    fullRead: true,
    events: [event(b!.id, "b-x")],
  });
  await rawEvent(a!, "a-beyond", "2026-09-16");
  await rawEvent(a!, "a-yesterday", "2026-09-07");

  await recordSourceRead(sql, {
    newsroomId: room,
    sourceId: a!.id,
    sourceUrl: a!.publicUrl,
    sourceIssuer: a!.issuer,
    sourceTitle: a!.title,
    localDate,
    window,
    fullRead: true,
    events: [],
  });

  const rows = await sql.query<{ source_id: number; event_key: string; local_date: string }>(
    "select source_id,event_key,local_date from routine_events where newsroom_id=$1 order by event_key",
    [room],
  );
  assert.deepEqual(
    rows.map((row) => `${row.source_id}:${row.event_key}:${String(row.local_date).slice(0, 10)}`),
    [`${a!.id}:a-beyond:2026-09-16`, `${b!.id}:b-x:2026-09-08`],
    "A's unseen in-window row is gone; B's same event and A's outside-window row stay",
  );
  assert.equal(rows.some((row) => row.event_key === "a-yesterday"), false, "yesterday is pruned");
});

test("a refused or partial read removes nothing", async () => {
  const [a] = await activate([{ title: "Source A", issuer: "Arts A", locality: "Longmont" }]);
  const sql = await getSql();
  const input = {
    newsroomId: room,
    sourceId: a!.id,
    sourceUrl: a!.publicUrl,
    sourceIssuer: a!.issuer,
    sourceTitle: a!.title,
    localDate,
    window,
  };
  await recordSourceRead(sql, { ...input, fullRead: true, events: [event(a!.id, "keep")] });
  await recordSourceRead(sql, { ...input, fullRead: false, events: [] });
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from routine_events where newsroom_id=$1 and source_id=$2", [room, a!.id]))[0]?.n,
    1,
  );
});

test("a repeat from two sites prints once with both source credits", async () => {
  const [aggregator, organizer] = await activate([
    { title: "Area calendar", issuer: "Area Arts", locality: "Longmont" },
    { title: "Stone Cup", issuer: "Stone Cup", locality: "Longmont" },
  ]);
  const job = await runningJob();
  const fakeCheck = async (_actor: unknown, input: { sourceId: number }) => {
    const source = input.sourceId === aggregator!.id ? aggregator! : organizer!;
    const organizerSite = source.id === organizer!.id;
    return {
      ok: true as const,
      check: {
        checkId: source.id,
        source: { id: source.id, title: source.title, url: source.url, sourceHref: "/desk/sources" },
        formatKey: "community-arts-event-logistics" as const,
        checkedAt: now.toISOString(),
        capture: { captureEventId: source.id, artifactVersionId: source.id + 10, observedAt: now.toISOString(), evidenceHref: null, textAvailable: true },
        state: "parsed" as const,
        counts: { parsed: 1, refused: 0, conflicts: 0 },
        refusals: [],
        candidates: [{
          id: source.id,
          externalId: `event-${source.id}`,
          externalIdHash: `hash-${source.id}`,
          formatKey: "community-arts-event-logistics" as const,
          variant: "event",
          fields: {
            issuer: { value: source.issuer, locator: "issuer" },
            title: { value: organizerSite ? "STONE CUP SHOW!" : "Stone cup show", locator: "title" },
            start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
            venue: { value: "Stone Cup", locator: "venue" },
            onlineUrl: { value: organizerSite ? "https://organizer.example/show" : "https://aggregator.example/show", locator: "url" },
          },
          conflict: false,
        }],
        newerCaptureAvailable: false,
        policy: { revision: 1, paused: false, approvalValid: true },
        canCheck: true,
      },
    };
  };
  await performRoutineNoticeWorkWith(job, { now, check: fakeCheck as any, verifyCheck: async () => {} });
  const sql = await getSql();
  const [article] = await sql.query<{ body: string; source_urls: string }>(
    "select body,source_urls from articles where newsroom_id=$1 and status='published'",
    [room],
  );
  assert.equal(article!.body.match(/STONE CUP SHOW!/g)?.length, 1);
  assert.match(article!.body, /Source: \[Stone Cup\]\(https:\/\/calendar\.example\/2\)/);
  assert.match(article!.body, /Source: \[Area calendar\]\(https:\/\/calendar\.example\/1\)/);
  assert.deepEqual(JSON.parse(article!.source_urls), [organizer!.publicUrl, aggregator!.publicUrl]);
  assert.equal((await sql.query<{ n: number }>("select count(*)::int n from routine_events where newsroom_id=$1", [room]))[0]?.n, 2);
});

test("a skipped source's stored rows stay and still print in the day's story", async () => {
  const [skipped, good] = await activate([
    { title: "Skipped Events", issuer: "Skipped Arts", locality: "Longmont" },
    { title: "Good Events", issuer: "Good Arts", locality: "Longmont" },
  ]);
  const sql = await getSql();
  await recordSourceRead(sql, {
    newsroomId: room,
    sourceId: skipped!.id,
    sourceUrl: skipped!.publicUrl,
    sourceIssuer: skipped!.issuer,
    sourceTitle: skipped!.title,
    localDate,
    window,
    fullRead: true,
    events: [event(skipped!.id, "skipped-show", { title: "Skipped source show" })],
  });
  const job = await runningJob();
  const fakeCheck = async (_actor: unknown, input: { sourceId: number }) => {
    if (input.sourceId === skipped!.id) throw new Error("capture failed");
    return {
      ok: true as const,
      check: {
        checkId: good!.id,
        source: { id: good!.id, title: good!.title, url: good!.url, sourceHref: "/desk/sources" },
        formatKey: "community-arts-event-logistics" as const,
        checkedAt: now.toISOString(),
        capture: null,
        state: "parsed" as const,
        counts: { parsed: 0, refused: 0, conflicts: 0 },
        refusals: [],
        candidates: [],
        newerCaptureAvailable: false,
        policy: { revision: 1, paused: false, approvalValid: true },
        canCheck: true,
      },
    };
  };
  await performRoutineNoticeWorkWith(job, { now, check: fakeCheck as any, verifyCheck: async () => {} });
  const [article] = await sql.query<{ body: string }>(
    "select body from articles where newsroom_id=$1 and status='published'",
    [room],
  );
  assert.match(article!.body, /Skipped source show/);
  assert.match(article!.body, /Source: \[Skipped Events\]\(https:\/\/calendar\.example\/1\)/);
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from routine_events where newsroom_id=$1 and source_id=$2", [room, skipped!.id]))[0]?.n,
    1,
  );
});