import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getSql } from "../db.ts";
import { ROUTINE_EDITION_UPDATE_PREFIX } from "./correction-origin.ts";
import {
  ensureRoutineNoticePolicySchema,
  saveRoutineNoticePolicyFor,
} from "./routine-notice-policy.ts";
import {
  ensureRoutineNoticeAutomationSchema,
  readRoutineNoticeAutomationFor,
  saveRoutineNoticeAutomationFor,
} from "./routine-notice-automation.ts";
import { ensureJobsSchema, type DeskJob } from "./jobs.ts";
import { checkRoutineNoticeSourceForOwner } from "./routine-notice-checks.server.ts";
import type { IngestDocument } from "./ingest.ts";
import {
  performRoutineNoticeWork,
  performRoutineNoticeWorkWith,
  tickRoutineNoticeEditions,
} from "./routine-notice-worker.server.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

const room = 9650,
  owner = "routine-beta-owner",
  runNow = new Date("2026-09-08T13:00:00Z");
// The database is migrated before this file loads (U18a-1,
// src/lib/test-support/pglite-migrations.ts). This used to replay every
// migration by hand, which is now a second application: several carry
// unguarded seed inserts and collide with the rows the first pass wrote.
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
  await sql.query(
    "create table if not exists articles(id serial primary key,user_id text not null,newsroom_id integer not null,slug text not null unique,headline text not null,dek text not null default '',body text not null,topic text not null,source_urls text not null default '[]',status text not null default 'published',published_at timestamptz not null default now(),area text)",
  );
  await sql.query(
    "create table if not exists corrections(id serial primary key,user_id text not null,newsroom_id integer not null,article_id integer references articles(id) on delete set null,body text not null,created_at timestamptz not null default now())",
  );
  await sql.query(
    "create table if not exists newsroom_sections(newsroom_id integer not null,key text not null,name text not null,visible boolean not null default true,replacement_key text,primary key(newsroom_id,key))",
  );
  await ensureRoutineNoticePolicySchema();
  await ensureRoutineNoticeAutomationSchema();
  await ensureJobsSchema();
  await sql.query("delete from desk_jobs where newsroom_id=$1", [room]);
  await sql.query("delete from audit_events where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_automation_changes where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_publications where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_runs where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_automations where newsroom_id=$1", [room]);
  await sql.query("delete from corrections where newsroom_id=$1", [room]);
  await sql.query("delete from articles where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_policy_changes where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_approvals where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_policies where newsroom_id=$1", [room]);
  await sql.query("delete from sources where newsroom_id=$1", [room]);
  await sql.query("delete from newsroom_sections where newsroom_id=$1", [room]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [room]);
  await sql.query(
    "insert into newsrooms(id,name) values($1,'Routine beta') on conflict(id) do nothing",
    [room],
  );
  await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')", [
    owner,
    room,
  ]);
  for (const [position, key] of ["news", "events", "deadlines"].entries())
    await sql.query(
      "insert into newsroom_sections(newsroom_id,key,name,visible,position) values($1,$2,$2,true,$3)",
      [room, key, position],
    );
});

async function activateFixture() {
  const sql = await getSql();
  const [source] = await sql.query<{ id: number; url: string }>(
    "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,'https://events.example/private/calendar?token=secret','Events','accepted') returning id,url",
    [owner, room],
  );
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [
      { sourceId: source!.id, sourceUrl: source!.url, formatKey: "community-arts-event-logistics" },
    ],
  });
  await saveRoutineNoticeAutomationFor(owner, room, {
    expectedRevision: 0,
    enabled: true,
    timezone: "America/Denver",
    localTime: "06:15",
    sections: { today: "news", weekend: "events", deadlines: "deadlines" },
    sources: [
      {
        sourceId: source!.id,
        sourceUrl: source!.url,
        publicSourceUrl: "https://events.example/calendar",
        formatKey: "community-arts-event-logistics",
        issuer: "Arts Council",
        locality: "Longmont",
        collectionArea: null,
      },
    ],
  });
  return source!;
}

test("actual scheduled worker atomically publishes one logistics-only article and completes its claim", async () => {
  const source = await activateFixture();
  assert.deepEqual(await tickRoutineNoticeEditions(new Date("2026-09-08T13:00:00Z")), {
    queued: 1,
  });
  assert.deepEqual(await tickRoutineNoticeEditions(new Date("2026-09-08T13:01:00Z")), {
    queued: 0,
  });
  const sql = await getSql();
  const [job] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='routine-claim' where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  let eventTitle = "Concert";
  const fakeCheck = async () => ({
    ok: true as const,
    check: {
      checkId: 44,
      source: { id: source.id, title: "Events", url: source.url, sourceHref: "/desk/sources" },
      formatKey: "community-arts-event-logistics" as const,
      checkedAt: new Date().toISOString(),
      capture: {
        captureEventId: 8,
        artifactVersionId: 9,
        observedAt: new Date().toISOString(),
        evidenceHref: null,
        textAvailable: true,
      },
      state: "parsed" as const,
      counts: { parsed: 1, refused: 0, conflicts: 0 },
      refusals: [],
      candidates: [
        {
          id: 1,
          externalIdHash: "event-1",
          formatKey: "community-arts-event-logistics" as const,
          variant: "event",
          fields: {
            issuer: { value: "Arts Council", locator: "issuer" },
            title: { value: eventTitle, locator: "title" },
            start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
            venue: { value: "Park", locator: "venue" },
          },
          conflict: false,
        },
      ],
      newerCaptureAvailable: false,
      policy: { revision: 1, paused: false, approvalValid: true },
      canCheck: true,
    },
  });
  await sql.query(
    `create function fail_routine_run_audit() returns trigger language plpgsql as $$
       begin if NEW.action='routine-notice-run' then raise exception 'forced routine audit failure'; end if; return NEW; end $$`,
  );
  await sql.query(
    "create trigger fail_routine_run_audit before insert on audit_events for each row execute function fail_routine_run_audit()",
  );
  await assert.rejects(
    performRoutineNoticeWorkWith(job as DeskJob, {
      now: runNow,
      check: fakeCheck as any,
      verifyCheck: async () => {},
    }),
    /forced routine audit failure/i,
  );
  const [rolledBack] = await sql.query<{ articles: number; publications: number; job_status: string }>(
    "select (select count(*)::int from articles where newsroom_id=$1) articles,(select count(*)::int from routine_notice_publications where newsroom_id=$1) publications,(select status from desk_jobs where id=$2) job_status",
    [room, job.id],
  );
  assert.deepEqual(rolledBack, { articles: 0, publications: 0, job_status: "running" });
  await sql.query("drop trigger fail_routine_run_audit on audit_events");
  await sql.query("drop function fail_routine_run_audit()");

  await performRoutineNoticeWorkWith(job as DeskJob, {
    now: runNow,
    check: fakeCheck as any,
    verifyCheck: async () => {},
  });
  const [result] = await sql.query<{ articles: number; jobs: number; runs: number }>(
    "select (select count(*)::int from articles where newsroom_id=$1) articles,(select count(*)::int from desk_jobs where newsroom_id=$1 and status='completed') jobs,(select count(*)::int from routine_notice_runs where newsroom_id=$1 and status='completed') runs",
    [room],
  );
  assert.deepEqual(result, { articles: 1, jobs: 1, runs: 1 });
  const [article] = await sql.query<{ body: string; source_urls: string }>(
    "select body,source_urls from articles where newsroom_id=$1",
    [room],
  );
  assert.equal(`${article?.body} ${article?.source_urls}`.includes("token=secret"), false);
  assert.deepEqual(JSON.parse(article!.source_urls), ["https://events.example/calendar"]);

  const [receiptArticle] = await sql.query<{ id: number }>(
    "insert into articles(user_id,newsroom_id,slug,headline,body,topic,source_urls) values($1,$2,$3,'Prior deadlines','Prior','deadlines','[]') returning id",
    [owner, room, `prior-deadlines-${room}`],
  );
  await sql.query(
    "insert into routine_notice_publications(newsroom_id,run_id,channel,issue_date,article_id,content_fingerprint,candidate_keys_json,article_body_hash) values($1,$2,'deadlines','2026-09-07',$3,'old','\"bad\"','old')",
    [room, job.subject_id, receiptArticle!.id],
  );
  const [malformedJob] = await sql.query<any>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'routine-notice',$3,'deterministic','scheduled','supplied','default','running','Working','routine-malformed') returning *",
    [room, owner, job.subject_id],
  );
  await assert.rejects(
    performRoutineNoticeWorkWith(malformedJob as DeskJob, { now: runNow, check: fakeCheck as any, verifyCheck: async () => {} }),
    /receipt is malformed/i,
  );
  await sql.query("update desk_jobs set status='failed' where id=$1", [malformedJob.id]);
  await sql.query("delete from routine_notice_publications where newsroom_id=$1 and channel='deadlines'", [room]);

  eventTitle = "Concert — new time";
  const [correctionJob] = await sql.query<any>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'routine-notice',$3,'deterministic','scheduled','supplied','default','running','Working','routine-correction') returning *",
    [room, owner, job.subject_id],
  );
  await performRoutineNoticeWorkWith(correctionJob as DeskJob, {
    now: runNow,
    check: fakeCheck as any,
    verifyCheck: async () => {},
  });
  const [afterCorrection] = await sql.query<{ corrections: number; articles: number; candidate_keys_json: string }>(
    "select (select count(*)::int from corrections where newsroom_id=$1) corrections,(select count(*)::int from articles where newsroom_id=$1) articles,candidate_keys_json from routine_notice_publications where newsroom_id=$1",
    [room],
  );
  assert.equal(afterCorrection?.corrections, 1);
  assert.equal(afterCorrection?.articles, 2);
  assert.notDeepEqual(JSON.parse(afterCorrection!.candidate_keys_json), []);
  /*
    The correction the worker appended carries the mark the public page reads
    to tell an automatic row from an editor's (unit U14). Writer and reader
    share one constant, `correction-origin.ts`; this is the writer half, and
    `scripts/corrections-automatic-render.test.mjs` is the reader half. It was
    a bare string literal here before, which is exactly how the two could have
    drifted apart silently.
  */
  const [automatic] = await sql.query<{ body: string }>(
    "select body from corrections where newsroom_id=$1",
    [room],
  );
  assert.ok(
    automatic!.body.startsWith(ROUTINE_EDITION_UPDATE_PREFIX),
    `a machine-appended correction must open with the shared marker, got: ${automatic!.body.slice(0, 60)}`,
  );

  await sql.query("update articles set body='Editor changed this edition.' where newsroom_id=$1", [room]);
  eventTitle = "Concert — final time";
  const [editedJob] = await sql.query<any>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'routine-notice',$3,'deterministic','scheduled','supplied','default','running','Working','routine-edited') returning *",
    [room, owner, job.subject_id],
  );
  await performRoutineNoticeWorkWith(editedJob as DeskJob, {
    now: runNow,
    check: fakeCheck as any,
    verifyCheck: async () => {},
  });
  const [afterEdit] = await sql.query<{ corrections: number; needs_review: number }>(
    "select (select count(*)::int from corrections where newsroom_id=$1) corrections,(summary_json::jsonb->>'needsReview')::int needs_review from routine_notice_runs where id=$2",
    [room, job.subject_id],
  );
  assert.deepEqual(afterEdit, { corrections: 1, needs_review: 1 });
});

test("revocation at the final boundary leaves no article, correction, audit, or completed run", async () => {
  const source = await activateFixture();
  assert.deepEqual(await tickRoutineNoticeEditions(new Date("2026-09-08T13:00:00Z")), {
    queued: 1,
  });
  const sql = await getSql();
  const [job] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='lost-boundary' where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  const fake = async () => ({
    ok: true as const,
    check: {
      checkId: 1,
      source: { id: source.id, title: "Events", url: source.url, sourceHref: "/desk/sources" },
      formatKey: "community-arts-event-logistics" as const,
      checkedAt: "2026-09-08",
      capture: null,
      state: "parsed" as const,
      counts: { parsed: 1, refused: 0, conflicts: 0 },
      refusals: [],
      candidates: [
        {
          id: 1,
          externalIdHash: "event-x",
          formatKey: "community-arts-event-logistics" as const,
          variant: "event",
          fields: {
            issuer: { value: "Arts Council", locator: "i" },
            title: { value: "Concert", locator: "t" },
            start: { value: "2026-09-08T18:00:00-06:00", locator: "s" },
            venue: { value: "Park", locator: "v" },
          },
          conflict: false,
        },
      ],
      newerCaptureAvailable: false,
      policy: { revision: 1, paused: false, approvalValid: true },
      canCheck: true,
    },
  });
  await assert.rejects(
    performRoutineNoticeWorkWith(job as DeskJob, {
      now: runNow,
      check: fake as any,
      verifyCheck: async () => {},
      beforeCommit: async () => {
        await sql.query(
          "update routine_notice_policies set paused=true,revision=revision+1 where newsroom_id=$1",
          [room],
        );
      },
    }),
    /authority changed/i,
  );
  const [counts] = await sql.query<{ articles: number; corrections: number; audits: number }>(
    "select (select count(*)::int from articles where newsroom_id=$1) articles,(select count(*)::int from corrections where newsroom_id=$1) corrections,(select count(*)::int from audit_events where newsroom_id=$1 and action='routine-notice-run') audits",
    [room],
  );
  assert.deepEqual(counts, { articles: 0, corrections: 0, audits: 0 });
});

test("an editor's Cancel ends a routine edition at the source boundary, before the next read", async () => {
  /*
    B8B item 2. The routine-notice loop asked about AUTHORITY between sources
    (`assertRoutineRunCanContinue`) and never about the editor's Cancel, so a
    Cancel was not noticed until the loop happened to end -- and `report` spoke
    once per source, leaving the card silent (and stall-eligible) during a long
    read.

    THE MUTATION THAT MATTERS: delete `await throwIfJobCancelled(job.id)` from
    the loop and this case fails twice over -- the run reads a source it was
    told not to, and the error is not the cancellation the card renders.
  */
  await activateFixture();
  await tickRoutineNoticeEditions(runNow);
  const sql = await getSql();
  const [job] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='cancelled-run',cancel_requested=true where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  let checks = 0;
  await assert.rejects(
    performRoutineNoticeWork(job as DeskJob, {
      now: runNow,
      check: (async () => {
        checks += 1;
        throw new Error("must not read a source after a Cancel");
      }) as any,
    }),
    /Cancelled by the editor/,
    "the honest reason, not a failure line against a source nobody read",
  );
  assert.equal(checks, 0, "the boundary was checked before the fetch, not after it");
  const [run] = await sql.query<{ status: string; summary_json: string }>(
    "select status,summary_json from routine_notice_runs where id=$1",
    [job.subject_id],
  );
  assert.equal(run?.status, "failed", "the run is closed, not left running");
  assert.match(run?.summary_json ?? "", /Cancelled by the editor/);
  assert.equal(
    (await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1", [room]))[0]
      ?.n,
    0,
    "and nothing was published on the way out",
  );
});

test("every routine source read is wrapped in the ticker that beats while it runs", async () => {
  /*
    The heartbeat half of B8B item 2, stated as the property that can be checked
    without waiting twelve real seconds: the read runs INSIDE `waitForModel`, so
    the ticker's own first beat ("Waiting on …") is written before the fetch is
    awaited, and the job is not stall-eligible while it is in flight.

    Asserted through the seam the worker already has: `check` is handed no way
    to report, so the "Waiting on …" line on the job row can only have come from
    the ticker wrapping it.
  */
  const source = await activateFixture();
  await tickRoutineNoticeEditions(runNow);
  const sql = await getSql();
  const [job] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='beat-run' where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  let rowInsideRead: { step_text: string | null; beat_at: string | null } | undefined;
  await performRoutineNoticeWorkWith(job as DeskJob, {
    now: runNow,
    check: (async () => {
      // The ticker's first beat is fired, not awaited, before the read starts
      // (`waitForModel` beats then runs), so give the write the beat it needs
      // to land before reading it back -- one connection, in order.
      await new Promise((resolve) => setTimeout(resolve, 50));
      [rowInsideRead] = await sql.query<{ step_text: string | null; beat_at: string | null }>(
        "select step_text,beat_at from desk_jobs where id=$1",
        [job.id],
      );
      return {
        ok: true as const,
        check: {
          checkId: 1,
          source: { id: source.id, title: "Events", url: source.url, sourceHref: "/desk/sources" },
          formatKey: "community-arts-event-logistics" as const,
          checkedAt: runNow.toISOString(),
          capture: null,
          state: "refused" as const,
          counts: { parsed: 0, refused: 1, conflicts: 0 },
          refusals: [{ code: "structurally-invalid", locator: "document", count: 1 }],
          candidates: [],
          newerCaptureAvailable: false,
          policy: { revision: 1, paused: false, approvalValid: true },
          canCheck: true,
        },
      };
    }) as any,
  });
  assert.match(
    String(rowInsideRead?.step_text ?? ""),
    /Waiting on Reading the routine sources/,
    "the ticker spoke while the read was in flight",
  );
  assert.ok(rowInsideRead?.beat_at, "and wrote the beat the stall rule reads");
});

test("a lost job lease refuses before any source fetch", async () => {
  await activateFixture();
  await tickRoutineNoticeEditions(new Date("2026-09-08T13:00:00Z"));
  const sql = await getSql();
  const [job] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='original-claim' where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  await sql.query("update desk_jobs set claim_token='replacement-claim' where id=$1", [job.id]);
  let checks = 0;
  await assert.rejects(
    performRoutineNoticeWorkWith(job as DeskJob, {
      now: runNow,
      check: (async () => {
        checks += 1;
        throw new Error("must not fetch");
      }) as any,
    }),
    /authority changed before source work/i,
  );
  assert.equal(checks, 0);
  assert.equal((await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1", [room]))[0]?.n, 0);
});

test("real captured checks publish, correct a changed source revision, and then remain idempotent", async () => {
  const source = await activateFixture();
  await tickRoutineNoticeEditions(runNow);
  const sql = await getSql();
  const [firstJob] = await sql.query<any>("update desk_jobs set status='running',claim_token='real-check-1' where newsroom_id=$1 and kind='routine-notice' returning *", [room]);
  let title = "Captured concert";
  const check = (actor: { userId: string; newsroomId: number }, input: unknown) => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", "@id": "real-event-1", name: title, startDate: "2026-09-08T18:00:00-06:00", organizer: { name: "Arts Council" }, location: { name: "Park" } })}</script>`;
    const document: IngestDocument = { ok: false, status: 200, outcome: "parse-failed", text: "", title: "Events", extras: [], contentType: "text/html", needsOcr: false, redirectChain: [], extractionMethod: "readability", pages: [], notices: [], rawBytes: new TextEncoder().encode(html) };
    return checkRoutineNoticeSourceForOwner(actor, input, { ingest: async () => document });
  };
  await performRoutineNoticeWorkWith(firstJob as DeskJob, { now: runNow, check });
  title = "Captured concert at seven";
  const nextJob = async (token: string) => (await sql.query<any>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'routine-notice',$3,'deterministic','scheduled','supplied','default','running','Working',$4) returning *",
    [room, owner, firstJob.subject_id, token],
  ))[0];
  await performRoutineNoticeWorkWith(await nextJob("real-check-2"), { now: runNow, check });
  const [changedState] = await sql.query<any>("select (select count(*)::int from corrections where newsroom_id=$1) corrections,(select count(*)::int from articles where newsroom_id=$1) articles,(select summary_json from routine_notice_runs where id=$2) summary,(select body from articles where newsroom_id=$1 limit 1) body", [room, firstJob.subject_id]);
  assert.equal(changedState?.corrections, 1, JSON.stringify(changedState));
  await performRoutineNoticeWorkWith(await nextJob("real-check-3"), { now: runNow, check });
  assert.equal((await sql.query<{ n: number }>("select count(*)::int n from corrections where newsroom_id=$1", [room]))[0]?.n, 1);
  const groups = await sql.query<{ state: string }>("select state from routine_notice_checks where newsroom_id=$1 order by id", [room]);
  assert.deepEqual(groups.map((group) => group.state), ["parsed", "parsed", "parsed"]);
  assert.equal(source.id > 0, true);
});

test("an old queued run expires with a visible failure before any source fetch", async () => {
  await activateFixture();
  await tickRoutineNoticeEditions(new Date("2026-09-08T13:00:00Z"));
  const sql = await getSql();
  const [job] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='expired-run' where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  let checks = 0;
  await assert.rejects(
    performRoutineNoticeWork(job as DeskJob, {
      now: new Date("2026-09-09T13:00:00Z"),
      check: (async () => { checks += 1; throw new Error("must not fetch"); }) as any,
    }),
    /expired before publication/i,
  );
  assert.equal(checks, 0);
  const [run] = await sql.query<{ status: string; summary_json: string }>("select status,summary_json from routine_notice_runs where id=$1", [job.subject_id]);
  assert.equal(run?.status, "failed");
  assert.match(run?.summary_json ?? "", /expired before publication/i);
});

test("a run crossing the newsroom day during source work refuses at the final transaction", async () => {
  const source = await activateFixture();
  await tickRoutineNoticeEditions(runNow);
  const sql = await getSql();
  const [job] = await sql.query<any>("update desk_jobs set status='running',claim_token='midnight-run' where newsroom_id=$1 and kind='routine-notice' returning *", [room]);
  let clock = runNow;
  const check = async () => ({ ok: true as const, check: {
    checkId: 1, source: { id: source.id, title: "Events", url: source.url, sourceHref: "/desk/sources" }, formatKey: "community-arts-event-logistics" as const,
    checkedAt: runNow.toISOString(), capture: null, state: "refused" as const, counts: { parsed: 0, refused: 1, conflicts: 0 }, refusals: [{ code: "structurally-invalid", locator: "document", count: 1 }], candidates: [], newerCaptureAvailable: false,
    policy: { revision: 1, paused: false, approvalValid: true }, canCheck: true,
  }});
  await assert.rejects(
    performRoutineNoticeWorkWith(job as DeskJob, { now: () => clock, check: check as any, beforeCommit: async () => { clock = new Date("2026-09-09T13:00:00Z"); } }),
    /expired before publication/i,
  );
  assert.equal((await sql.query<{ n: number }>("select count(*)::int n from articles where newsroom_id=$1", [room]))[0]?.n, 0);
});

test("saved permissions remain dormant until an owner explicitly activates an exact source identity", async () => {
  const sql = await getSql();
  const [s] = await sql.query<{ id: number; url: string }>(
    "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,'https://library.example/events','Library','accepted') returning id,url",
    [owner, room],
  );
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: s!.id, sourceUrl: s!.url, formatKey: "library-notice" }],
  });
  assert.equal((await readRoutineNoticeAutomationFor(owner, room)).enabled, false);
  const active = await saveRoutineNoticeAutomationFor(owner, room, {
    expectedRevision: 0,
    enabled: true,
    timezone: "America/Denver",
    localTime: "06:15",
    sections: { today: "news", weekend: "events", deadlines: "deadlines" },
    sources: [
      {
        sourceId: s!.id,
        sourceUrl: s!.url,
        publicSourceUrl: "https://library.example/events",
        formatKey: "library-notice",
        issuer: "City Library",
        locality: "Longmont",
        collectionArea: "Main branch",
      },
    ],
  });
  assert.equal(active.enabled, true);
  assert.equal(active.revision, 1);
  assert.equal(active.sources[0]?.issuer, "City Library");
  await assert.rejects(
    saveRoutineNoticeAutomationFor(owner, room, {
      ...active,
      expectedRevision: 0,
      updatedAt: undefined,
    } as any),
    /changed/i,
  );
  await sql.query("update sources set url='https://library.example/new' where id=$1", [s!.id]);
  await assert.rejects(
    saveRoutineNoticeAutomationFor(owner, room, {
      expectedRevision: 1,
      enabled: true,
      timezone: "America/Denver",
      localTime: "06:15",
      sections: active.sections,
      sources: active.sources,
    }),
    /permission changed/i,
  );
  const [count] = await sql.query<{ n: number }>(
    "select count(*)::int n from audit_events where newsroom_id=$1 and action='routine-notice-automation'",
    [room],
  );
  assert.equal(count!.n, 1);
});

test("allows the supported Longmont HTML waste bulletin to use its own public attribution", async () => {
  const sql = await getSql();
  const sourceUrl = "https://longmontcolorado.gov/waste-services-trash-recycling-composting/special-services-events/fall-leaf-collection/";
  const [source] = await sql.query<{ id: number }>(
    "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,'Fall leaf bulletin','accepted') returning id",
    [owner, room, sourceUrl],
  );
  await saveRoutineNoticePolicyFor(owner, room, {
    expectedRevision: 0,
    paused: false,
    approvals: [{ sourceId: source!.id, sourceUrl, formatKey: "waste-recycling-schedule" }],
  });
  const saved = await saveRoutineNoticeAutomationFor(owner, room, {
    expectedRevision: 0,
    enabled: true,
    timezone: "America/Denver",
    localTime: "06:15",
    sections: { today: "news", weekend: "events", deadlines: "deadlines" },
    sources: [
      {
        sourceId: source!.id,
        sourceUrl,
        publicSourceUrl: sourceUrl,
        formatKey: "waste-recycling-schedule",
        issuer: "City of Longmont",
        locality: "Longmont",
        collectionArea: "North of 9th Avenue",
      },
    ],
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.sources[0]?.publicSourceUrl, sourceUrl);
});

test("nonowners cannot activate and a removed approval cascades the automation selection", async () => {
  const sql = await getSql();
  await sql.query(
    "insert into newsroom_members(user_id,newsroom_id,role) values('routine-beta-editor',$1,'editor')",
    [room],
  );
  await assert.rejects(readRoutineNoticeAutomationFor("routine-beta-editor", room), /only.*owner/i);
});

// guards: published notices consume the daily cap and displace unpublished notices
test("six eligible notices save the overflow and put it first in the next plan", async () => {
  const source = await activateFixture();
  const sql = await getSql();
  await tickRoutineNoticeEditions(runNow);
  const [firstJob] = await sql.query<any>(
    "update desk_jobs set status='running',claim_token='overflow-first' where newsroom_id=$1 and kind='routine-notice' returning *",
    [room],
  );
  const makeNotice = (id: number, title: string) => ({
    id,
    externalIdHash: `event-${id}`,
    formatKey: "community-arts-event-logistics" as const,
    variant: "event",
    fields: {
      issuer: { value: "Arts Council", locator: "issuer" },
      title: { value: title, locator: "title" },
      start: { value: "2026-09-08T18:00:00-06:00", locator: "start" },
      venue: { value: "Park", locator: "venue" },
    },
    conflict: false,
  });
  const check = (candidates: ReturnType<typeof makeNotice>[]) => async () => ({
    ok: true as const,
    check: {
      checkId: 44,
      source: { id: source.id, title: "Events", url: source.url, sourceHref: "/desk/sources" },
      formatKey: "community-arts-event-logistics" as const,
      checkedAt: runNow.toISOString(),
      capture: {
        captureEventId: 88,
        artifactVersionId: 99,
        observedAt: runNow.toISOString(),
        evidenceHref: null,
        textAvailable: true,
      },
      state: "parsed" as const,
      counts: { parsed: candidates.length, refused: 0, conflicts: 0 },
      refusals: [],
      candidates,
      newerCaptureAvailable: false,
      policy: { revision: 1, paused: false, approvalValid: true },
      canCheck: true,
    },
  });
  const first = [1, 2, 3, 4, 5]
    .map((id) => makeNotice(id, `A Concert ${id}`))
    .concat(makeNotice(6, "Z Deferred Concert"));
  await performRoutineNoticeWorkWith(firstJob as DeskJob, {
    now: runNow,
    check: check(first) as any,
    verifyCheck: async () => {},
  });
  const [firstRun] = await sql.query<{ summary_json: string }>("select summary_json from routine_notice_runs where id=$1", [firstJob!.subject_id]);
  const saved = JSON.parse(firstRun!.summary_json);
  const deferred = saved.notices.find((notice: any) => notice.line.includes("Z Deferred Concert"));
  assert.equal(saved.notices.length, 6);
  assert.equal(saved.notices.filter((notice: any) => notice.status === "published").length, 5);
  assert.ok(saved.notices.every((notice: any) =>
    notice.source.sourceId === source.id &&
    notice.binding.captureEventId === 88 &&
    notice.binding.artifactVersionId === 99));
  assert.equal(deferred.status, "deferred");
  assert.deepEqual(deferred.source, {
    sourceId: source.id,
    publicSourceUrl: "https://events.example/calendar",
    formatKey: "community-arts-event-logistics",
  });
  assert.equal(deferred.binding.captureEventId, 88);
  assert.equal(deferred.binding.artifactVersionId, 99);
  const listed = (await readRoutineNoticeAutomationFor(owner, room)).recentRuns[0]!.notices;
  assert.equal(
    listed.find((notice) => notice.binding.externalId === deferred.binding.externalId)?.status,
    "deferred",
  );

  const [revision] = await sql.query<{ revision: number }>("update routine_notice_automations set revision=revision+1 where newsroom_id=$1 returning revision", [room]);
  const [nextRun] = await sql.query<{ id: number }>(
    "insert into routine_notice_runs(newsroom_id,local_date,automation_revision,policy_revision,status,actor) values($1,'2026-09-08',$2,1,'running',$3) returning id",
    [room, revision!.revision, owner],
  );
  const [nextJob] = await sql.query<any>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'routine-notice',$3,'deterministic','scheduled','supplied','default','running','Working','overflow-next') returning *",
    [room, owner, nextRun!.id],
  );
  const second = [7, 8, 9, 10, 11]
    .map((id) => makeNotice(id, `A New Notice ${id}`))
    .concat(makeNotice(6, "Z Deferred Concert"), first.slice(0, 5));
  await performRoutineNoticeWorkWith(nextJob as DeskJob, {
    now: runNow,
    check: check(second) as any,
    verifyCheck: async () => {},
  });
  const [publication] = await sql.query<{ candidate_keys_json: string }>("select candidate_keys_json from routine_notice_publications where newsroom_id=$1 and channel='today'", [room]);
  assert.ok(JSON.parse(publication!.candidate_keys_json).includes(deferred.binding.externalId));
  const [next] = await sql.query<{ summary_json: string }>("select summary_json from routine_notice_runs where id=$1", [nextRun!.id]);
  assert.equal(JSON.parse(next!.summary_json).deferred, 1);
  const [update] = await sql.query<{ body: string }>("select body from corrections where newsroom_id=$1", [room]);
  assert.equal(update!.body.includes("A Concert"), false);
});
