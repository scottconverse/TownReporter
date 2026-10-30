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
import type { RoutineNoticeFormatKey } from "./routine-notice-types.ts";

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

type ActivationSpec = {
  title: string;
  issuer: string;
  locality: string;
  formatKey: RoutineNoticeFormatKey;
  collectionArea?: string | null;
  publicUrl?: string;
};

async function activateFormats(specs: ActivationSpec[]) {
  const sql = await getSql();
  const sources: Array<ActivationSpec & { id: number; url: string; publicUrl: string }> = [];
  for (const [index, spec] of specs.entries()) {
    const publicUrl = spec.publicUrl ?? `https://calendar.example/${index + 1}`;
    const [source] = await sql.query<{ id: number; url: string }>(
      "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,$4,'accepted') returning id,url",
      [owner, room, `https://source.example/${index + 1}/feed`, spec.title],
    );
    sources.push({ ...spec, ...source!, publicUrl });
  }
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: sources.map((source) => ({
      sourceId: source.id,
      sourceUrl: source.url,
      formatKey: source.formatKey,
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
      formatKey: source.formatKey,
      issuer: source.issuer,
      locality: source.locality,
      collectionArea: source.collectionArea ?? null,
    })),
  });
  return sources;
}

function event(
  sourceId: number,
  eventKey: string,
  overrides: Partial<RoutineEventInput> = {},
): RoutineEventInput {
  const input: RoutineEventInput = {
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
    fields: {},
    ...overrides,
  };
  return {
    ...input,
    fields: overrides.fields ?? {
      issuer: { value: "Arts", locator: "issuer" },
      title: { value: input.title, locator: "title" },
      start: {
        value:
          input.allDay || input.startMinutes === null
            ? input.localDate
            : `${input.localDate}T${String(Math.floor(input.startMinutes / 60)).padStart(2, "0")}:${String(input.startMinutes % 60).padStart(2, "0")}:00`,
        locator: "start",
      },
      venue: { value: input.place ?? "", locator: "venue" },
    },
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

async function runningJobAt(at: Date) {
  await tickRoutineNoticeEditions(at);
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

type EventFieldMap = Record<string, { value: string; locator: string }>;

function eventCheck(
  source: { id: number; title: string; url: string },
  fields: EventFieldMap | null = null,
) {
  return {
    ok: true as const,
    check: {
      checkId: source.id,
      source: { id: source.id, title: source.title, url: source.url, sourceHref: "/desk/sources" },
      formatKey: "community-arts-event-logistics" as const,
      checkedAt: now.toISOString(),
      capture: {
        captureEventId: source.id,
        artifactVersionId: source.id + 10,
        observedAt: now.toISOString(),
        evidenceHref: null,
        textAvailable: true,
      },
      state: "parsed" as const,
      counts: { parsed: fields ? 1 : 0, refused: 0, conflicts: 0 },
      refusals: [],
      candidates: fields
        ? [{
            id: source.id,
            externalId: `event-${source.id}`,
            externalIdHash: `hash-${source.id}`,
            formatKey: "community-arts-event-logistics" as const,
            variant: "event",
            fields,
            conflict: false,
          }]
        : [],
      newerCaptureAvailable: false,
      policy: { revision: 1, paused: false, approvalValid: true },
      canCheck: true,
    },
  };
}

function libraryCheck(
  source: { id: number; title: string; url: string },
  fields: EventFieldMap | null = null,
) {
  return {
    ok: true as const,
    check: {
      checkId: source.id,
      source: { id: source.id, title: source.title, url: source.url, sourceHref: "/desk/sources" },
      formatKey: "library-notice" as const,
      checkedAt: now.toISOString(),
      capture: {
        captureEventId: source.id,
        artifactVersionId: source.id + 10,
        observedAt: now.toISOString(),
        evidenceHref: null,
        textAvailable: true,
      },
      state: "parsed" as const,
      counts: { parsed: fields ? 1 : 0, refused: 0, conflicts: 0 },
      refusals: [],
      candidates: fields
        ? [{
            id: source.id,
            externalId: `event-${source.id}`,
            externalIdHash: `hash-${source.id}`,
            formatKey: "library-notice" as const,
            variant: "program" as const,
            fields,
            conflict: false,
          }]
        : [],
      newerCaptureAvailable: false,
      policy: { revision: 1, paused: false, approvalValid: true },
      canCheck: true,
    },
  };
}
async function rerun(job: DeskJob) {
  const sql = await getSql();
  const [again] = await sql.query<DeskJob>(
    "update desk_jobs set status='running',claim_token=$2,finished_at=null,updated_at=now() where id=$1 returning *",
    [job.id, `events-table-rerun-${Math.random()}`],
  );
  return again!;
}

async function latestRunSummary() {
  const sql = await getSql();
  const [row] = await sql.query<{ summary_json: string }>(
    "select summary_json from routine_notice_runs where newsroom_id=$1 order by id desc limit 1",
    [room],
  );
  return JSON.parse(row!.summary_json) as {
    needsReview: number;
    reviewReasons: Array<{ why: string; count: number }>;
  };
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

test("a table event with postponed status is held for review", async () => {
  const [source] = await activate([{ title: "Postponed Events", issuer: "Arts", locality: "Longmont" }]);
  const fields: EventFieldMap = {
    issuer: { value: source!.issuer, locator: "OWNER_ISSUER" },
    title: { value: "Rain-delayed concert", locator: "title" },
    start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
    venue: { value: "Stone Cup", locator: "venue" },
    eventStatus: { value: "postponed", locator: "eventStatus" },
  };
  const job = await runningJob();
  await performRoutineNoticeWorkWith(job, {
    now,
    check: (async () => eventCheck(source!, fields)) as any,
    verifyCheck: async () => {},
  });
  const sql = await getSql();
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1 and status='published'", [room]))[0]?.n,
    0,
    "the postponed event is not printed in Today",
  );
  const summary = await latestRunSummary();
  assert.ok(summary.needsReview >= 1);
  assert.ok(summary.reviewReasons.some((reason) => reason.why === "it is cancelled or its status changed"));
  const [stored] = await sql.query<{ fields: EventFieldMap }>("select fields from routine_events where newsroom_id=$1", [room]);
  assert.deepEqual(stored?.fields, fields, "the table keeps the candidate's own field map");
});

test("a table event with cancellation set is held for review", async () => {
  const [source] = await activate([{ title: "Cancelled Events", issuer: "Arts", locality: "Longmont" }]);
  const fields: EventFieldMap = {
    issuer: { value: source!.issuer, locator: "OWNER_ISSUER" },
    title: { value: "Cancelled concert", locator: "title" },
    start: { value: "2026-09-08T19:00:00-06:00", locator: "start" },
    venue: { value: "Stone Cup", locator: "venue" },
    cancellation: { value: "The organizer cancelled this event.", locator: "cancellation" },
  };
  const job = await runningJob();
  await performRoutineNoticeWorkWith(job, {
    now,
    check: (async () => eventCheck(source!, fields)) as any,
    verifyCheck: async () => {},
  });
  const sql = await getSql();
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1 and status='published'", [room]))[0]?.n,
    0,
    "the cancelled event is not printed in Today",
  );
  const summary = await latestRunSummary();
  assert.ok(summary.needsReview >= 1);
  assert.ok(summary.reviewReasons.some((reason) => reason.why === "it is cancelled or its status changed"));
});


test("a table event keeps Free and Sign up on its Today line", async () => {
  const [source] = await activate([{ title: "Free Events", issuer: "Arts", locality: "Longmont" }]);
  const registrationUrl = "https://signup.example/stone-cup";
  const fields: EventFieldMap = {
    issuer: { value: source!.issuer, locator: "OWNER_ISSUER" },
    title: { value: "Free Stone Cup show", locator: "title" },
    start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
    venue: { value: "Stone Cup", locator: "venue" },
    admission: { value: "Free", locator: "admission" },
    registrationUrl: { value: registrationUrl, locator: "registrationUrl" },
  };
  const job = await runningJob();
  await performRoutineNoticeWorkWith(job, {
    now,
    check: (async () => eventCheck(source!, fields)) as any,
    verifyCheck: async () => {},
  });
  const sql = await getSql();
  const [article] = await sql.query<{ body: string }>("select body from articles where newsroom_id=$1 and status='published'", [room]);
  assert.ok(article!.body.includes("Free"));
  assert.ok(article!.body.includes("Sign up: " + registrationUrl));
});

test("a skipped source keeps its stored cancelled event out of Today on the next run", async () => {
  const [skipped, good] = await activate([
    { title: "Skipped Events", issuer: "Skipped Arts", locality: "Longmont" },
    { title: "Good Events", issuer: "Good Arts", locality: "Longmont" },
  ]);
  const cancelledFields: EventFieldMap = {
    issuer: { value: skipped!.issuer, locator: "OWNER_ISSUER" },
    title: { value: "Cancelled show", locator: "title" },
    start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
    venue: { value: "Stone Cup", locator: "venue" },
    eventStatus: { value: "cancelled", locator: "eventStatus" },
  };
  const job = await runningJob();
  await performRoutineNoticeWorkWith(job, {
    now,
    check: (async (_actor: unknown, input: { sourceId: number }) =>
      input.sourceId === skipped!.id ? eventCheck(skipped!, cancelledFields) : eventCheck(good!)) as any,
    verifyCheck: async () => {},
  });
  const sql = await getSql();
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1 and status='published'", [room]))[0]?.n,
    0,
    "the first run held the cancelled event",
  );
  const second = await rerun(job);
  await performRoutineNoticeWorkWith(second, {
    now,
    check: (async (_actor: unknown, input: { sourceId: number }) => {
      if (input.sourceId === skipped!.id) throw new Error("capture failed");
      return eventCheck(good!);
    }) as any,
    verifyCheck: async () => {},
  });
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1 and status='published'", [room]))[0]?.n,
    0,
    "the skipped source stored row stayed out of Today",
  );
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from routine_events where newsroom_id=$1 and source_id=$2", [room, skipped!.id]))[0]?.n,
    1,
    "the skipped source row was retained",
  );
});

test("a Longmont source with a state stays in the Longmont part of Today", async () => {
  const [longmontSource, lyonsSource] = await activate([
    { title: "Longmont Events", issuer: "Longmont Arts", locality: "Longmont, Colorado" },
    { title: "Lyons Events", issuer: "Lyons Arts", locality: "Lyons, Colorado" },
  ]);
  const sql = await getSql();
  await sql.query(
    "insert into paper_settings(newsroom_id,city) values($1,'Longmont') on conflict(newsroom_id) do update set city=excluded.city",
    [room],
  );
  const job = await runningJob();
  const fields: EventFieldMap = {
    issuer: { value: longmontSource!.issuer, locator: "issuer" },
    title: { value: "Longmont source event", locator: "title" },
    start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
    venue: { value: "Stone Cup", locator: "venue" },
  };
  await performRoutineNoticeWorkWith(job, {
    now,
    check: (async (_actor: unknown, input: { sourceId: number }) =>
      input.sourceId === longmontSource!.id ? eventCheck(longmontSource!, fields) : eventCheck(lyonsSource!)) as any,
    verifyCheck: async () => {},
  });
  const [article] = await sql.query<{ body: string }>(
    "select body from articles where newsroom_id=$1 and topic='news'",
    [room],
  );
  assert.match(article!.body, /Longmont source event/);
  assert.doesNotMatch(article!.body, /## Nearby/);
});

test("a venue in a known nearby town prints under Nearby as the town only", async () => {
  const [longmontSource, lyonsSource] = await activate([
    { title: "Longmont Events", issuer: "Longmont Arts", locality: "Longmont, Colorado" },
    { title: "Lyons Events", issuer: "Lyons Arts", locality: "Lyons, Colorado" },
  ]);
  const sql = await getSql();
  await sql.query(
    "insert into paper_settings(newsroom_id,city) values($1,'Longmont') on conflict(newsroom_id) do update set city=excluded.city",
    [room],
  );
  const job = await runningJob();
  const fields: EventFieldMap = {
    issuer: { value: longmontSource!.issuer, locator: "issuer" },
    title: { value: "Stone Cup show", locator: "title" },
    start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
    venue: { value: "Stone Cup, 442 High St, Lyons, CO", locator: "venue" },
  };
  await performRoutineNoticeWorkWith(job, {
    now,
    check: (async (_actor: unknown, input: { sourceId: number }) =>
      input.sourceId === longmontSource!.id ? eventCheck(longmontSource!, fields) : eventCheck(lyonsSource!)) as any,
    verifyCheck: async () => {},
  });
  const [article] = await sql.query<{ body: string }>(
    "select body from articles where newsroom_id=$1 and topic='news'",
    [room],
  );
  const nearbyAt = article!.body.indexOf("## Nearby");
  const eventAt = article!.body.indexOf("Stone Cup show");
  assert.ok(nearbyAt >= 0 && eventAt > nearbyAt, "the event is under the Nearby heading");
  assert.match(article!.body, /Stone Cup show \(Lyons\)/);
  assert.doesNotMatch(article!.body, /\(Lyons, Colorado\)/);
});

const fridayNow = new Date("2026-09-11T13:00:00Z");
const libraryEventsUrl = "https://library.example/events";
const cityEventsUrl = "https://events.example/city";

async function activateStorytimePair() {
  return activateFormats([
    {
      title: "Longmont Library Events",
      issuer: "City of Longmont Library",
      locality: "Longmont",
      formatKey: "library-notice",
      collectionArea: "Main branch",
      publicUrl: libraryEventsUrl,
    },
    {
      title: "City of Longmont events",
      issuer: "City of Longmont",
      locality: "Longmont",
      formatKey: "community-arts-event-logistics",
      publicUrl: cityEventsUrl,
    },
  ]);
}

function libraryStorytime(start: string): EventFieldMap {
  return {
    issuer: { value: "City of Longmont Library", locator: "OWNER_ISSUER" },
    program: { value: "All Ages Halloween Storytime", locator: "program" },
    start: { value: start, locator: "start" },
    location: { value: "Longmont Public Library", locator: "location" },
  };
}

function tableStorytime(start: string): EventFieldMap {
  return {
    issuer: { value: "City of Longmont", locator: "OWNER_ISSUER" },
    title: { value: "ALL AGES HALLOWEEN STORYTIME!", locator: "title" },
    start: { value: start, locator: "start" },
    venue: { value: "Longmont Public Library", locator: "venue" },
  };
}

test("a library notice and a same-day table event print once in Today with both sources credited", async () => {
  const [library, table] = await activateStorytimePair();
  const job = await runningJobAt(fridayNow);
  await performRoutineNoticeWorkWith(job, {
    now: fridayNow,
    check: (async (_actor: unknown, input: { sourceId: number }) =>
      input.sourceId === library!.id
        ? libraryCheck(library!, libraryStorytime("2026-09-11T10:00:00-06:00"))
        : eventCheck(table!, tableStorytime("2026-09-11T10:00:00-06:00"))) as any,
    verifyCheck: async () => {},
  });

  const sql = await getSql();
  const [todayArticle] = await sql.query<{ body: string; source_urls: string }>(
    "select body,source_urls from articles where newsroom_id=$1 and topic='news'",
    [room],
  );
  assert.equal((todayArticle!.body.match(/Halloween Storytime/gi) ?? []).length, 1, "the duplicate event prints once");
  assert.ok(todayArticle!.body.includes(`(${cityEventsUrl})`));
  assert.ok(todayArticle!.body.includes(`(${libraryEventsUrl})`));
  assert.deepEqual(
    new Set(JSON.parse(todayArticle!.source_urls) as string[]),
    new Set([cityEventsUrl, libraryEventsUrl]),
  );
});

test("the same library title at a different start time still prints as two Today lines", async () => {
  const [library, table] = await activateStorytimePair();
  const job = await runningJobAt(fridayNow);
  await performRoutineNoticeWorkWith(job, {
    now: fridayNow,
    check: (async (_actor: unknown, input: { sourceId: number }) =>
      input.sourceId === library!.id
        ? libraryCheck(library!, libraryStorytime("2026-09-11T10:00:00-06:00"))
        : eventCheck(table!, tableStorytime("2026-09-11T11:00:00-06:00"))) as any,
    verifyCheck: async () => {},
  });

  const sql = await getSql();
  const [todayArticle] = await sql.query<{ body: string }>(
    "select body from articles where newsroom_id=$1 and topic='news'",
    [room],
  );
  assert.equal((todayArticle!.body.match(/Halloween Storytime/gi) ?? []).length, 2);
  assert.match(todayArticle!.body, /\*\*10 a\.m\.\*\*\nAll Ages Halloween Storytime/);
  assert.match(todayArticle!.body, /\*\*11 a\.m\.\*\*\nALL AGES HALLOWEEN STORYTIME!/);
});

test("deduplicating Today leaves the weekend edition's library notice unchanged", async () => {
  const [library, table] = await activateStorytimePair();
  const job = await runningJobAt(fridayNow);
  await performRoutineNoticeWorkWith(job, {
    now: fridayNow,
    check: (async (_actor: unknown, input: { sourceId: number }) =>
      input.sourceId === library!.id
        ? libraryCheck(library!, libraryStorytime("2026-09-11T10:00:00-06:00"))
        : eventCheck(table!, tableStorytime("2026-09-11T10:00:00-06:00"))) as any,
    verifyCheck: async () => {},
  });

  const sql = await getSql();
  const [todayArticle] = await sql.query<{ body: string }>(
    "select body from articles where newsroom_id=$1 and topic='news'",
    [room],
  );
  const [weekendArticle] = await sql.query<{ body: string }>(
    "select body from articles where newsroom_id=$1 and topic='events'",
    [room],
  );
  assert.equal((todayArticle!.body.match(/Halloween Storytime/gi) ?? []).length, 1);
  assert.ok(weekendArticle!.body.includes("- All Ages Halloween Storytime: "));
  assert.ok(weekendArticle!.body.includes(`Source: ${libraryEventsUrl}`));
});
