import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";
import type { SearchAttempt } from "./search-web.ts";

/**
 * Stop, across two real PostgreSQL processes.
 *
 * THE CLAIM THIS FILE EXISTS FOR: a follow-up run that has passed its last
 * cancellation boundary and is about to write its result records NOTHING if
 * the editor's Stop commits in that window. The run is not a fake -- it is the
 * real `performFollowUpRun` dispatched by the real `executeJob`, with only the
 * network (the search provider, the judge, the page reader) faked -- and the
 * Stop is the real `performFollowUpAction`, committed by the test process on
 * its own connection while the worker process sits between its boundary check
 * and the write.
 *
 * `deps.beforeRecord` is what makes that window reachable at all; it is
 * documented as a test seam in ./follow-up-agents.ts. Without it the test could
 * only stop the run EARLIER, and it would pass or fail on the boundary check --
 * which is precisely the thing this file must not be proving. Deleting the
 * `status <> 'stopped'` predicate from the fence in `performRecordFollowUpRun`
 * makes the first test fail with the new finding in the story's notes.
 *
 * The second test is the other half of item 1, in a second process: a run that
 * was QUEUED when the Stop committed is never started by anyone. Both are about
 * rows in a database one process writes and another reads, which is why they
 * cannot be PGlite tests.
 */

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the cross-process Stop proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `townreporter_test_follow_up_stop_${process.pid}_${Date.now()}`;
const newsroomId = 974_500;
const EDITOR = "stop-postgres-editor";
/** The finding a PREVIOUS run recorded: everything below is measured against it. */
const EARLIER_CHECKED_AT = "2026-09-28T12:00:00.000Z";
const EARLIER_NOTE = "Budget papers — The papers were posted on 24 September.";
let created = false;
let db: typeof import("../db.ts");
let followUps: typeof import("./follow-ups.ts");
let jobs: typeof import("./jobs.ts");
let agents: typeof import("./follow-up-agents.ts");

/** The advisory-lock namespace `executeJob` serializes a newsroom's claims on. */
const NEWSROOM_JOB_CLAIM_LOCK_NAMESPACE = 1_414_670_918;

/** Wait until some statement in this database is blocked on another session's
 * lock. That is the witness that a barrier is really holding, rather than a
 * sleep long enough to hope so. */
async function waitForBlockedLock(observer: Client, expected = 1): Promise<void> {
  let waiting = 0;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = await observer.query<{ waiting: string }>(
      "select count(*)::text as waiting from pg_locks where not granted",
    );
    waiting = Number(result.rows[0]?.waiting ?? 0);
    if (waiting >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected at least ${expected} blocked lock(s); observed ${waiting}`);
}

/** Did this promise settle within `ms`? Used to assert that something is STILL
 * blocked -- a claim that has not been refused, a Stop that has not returned. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

type WorkerMessage =
  | { type: "paused" }
  | { type: "settled"; took: boolean; reads: number }
  | { type: "entered" };

type Worker = {
  waitFor(type: WorkerMessage["type"]): Promise<WorkerMessage>;
  release(): void;
  waitForExit(): Promise<void>;
};

/** The follow-up the worker process is told to run; set before each spawn. */
let mountedFollowUpId = 0;

/**
 * The worker process: one `follow-up` job, run the way the drainer runs it.
 *
 * `mode: "fence"` puts the run down inside `beforeRecord` -- past its last
 * boundary check, before the result write. `mode: "boundary"` puts it down
 * inside the first page read, so the Stop arrives while there is still work
 * left for the run to decide not to do.
 */
function startWorker(mode: "fence" | "boundary"): Worker {
  const urls = {
    db: pathToFileURL(resolve("src/lib/db.ts")).href,
    agents: pathToFileURL(resolve("src/lib/news/follow-up-agents.ts")).href,
    jobs: pathToFileURL(resolve("src/lib/news/jobs.ts")).href,
  };
  const source = `
    const db = await import(${JSON.stringify(urls.db)});
    const agents = await import(${JSON.stringify(urls.agents)});
    const jobs = await import(${JSON.stringify(urls.jobs)});
    const mode = process.env.U16_MODE;
    const newsroomId = Number(process.env.U16_NEWSROOM_ID);
    const followUpId = Number(process.env.U16_FOLLOW_UP_ID);
    const send = (message) => new Promise((resolve, reject) => process.send(message, (error) => error ? reject(error) : resolve()));
    const waitForRelease = () => new Promise((resolve) => process.once("message", (message) => { if (message === "release") resolve(); }));
    const doc = (text) => ({ ok: true, status: 200, outcome: "fetched", text, title: "Record", extras: [],
      contentType: "text/html", needsOcr: false, redirectChain: [], extractionMethod: "html", pages: [], notices: [] });
    // "Reads" counts the units of work the run got through: one per page for the
    // re-check, one per search for the search agent.
    const reads = [];
    const job = await jobs.latestJob({ newsroomId, kind: "follow-up", subjectId: followUpId });
    if (!job) throw new Error("the worker process found no job to run");
    const pause = async () => { await send({ type: "paused" }); await waitForRelease(); };
    jobs.__setJobWorkForTest(async (running) => {
      process.send({ type: "entered", jobId: running.id });
      await agents.performFollowUpRun(running, {
        agents: {
          model: async (_label, run) => {
            if (mode === "boundary") { reads.push("work"); if (reads.length === 1) await pause(); }
            return run();
          },
          fetch: async () => { if (mode !== "boundary") reads.push("work"); return doc("The papers are unchanged."); },
          search: async () => { reads.push("work"); return { state: "ok", provider: "fake",
            hits: [{ title: "Budget papers", url: "https://clerk.test/new-answer", snippet: "posted 26 September" }] }; },
          judge: async () => ({ ok: true, answers: true, url: "https://clerk.test/new-answer",
            title: "Budget papers", summary: "The papers were posted on 26 September." }),
        },
        beforeRecord: mode === "fence" ? pause : undefined,
      });
    });
    const took = await jobs.executeJob(job);
    await send({ type: "settled", took, reads: reads.length });
    await db.closePoolForTests();
  `;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        U16_MODE: mode,
        U16_NEWSROOM_ID: String(newsroomId),
        U16_FOLLOW_UP_ID: String(mountedFollowUpId),
        // The worker dials the scratch database through DATABASE_URL, exactly
        // like the server does; the admin URL is the test process's business.
        TEST_POSTGRES_ADMIN_URL: "",
        TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL: "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stderr?.on("data", (data) => (stderr += data.toString()));
  const messages: WorkerMessage[] = [];
  const waiters = new Map<WorkerMessage["type"], ((message: WorkerMessage) => void)[]>();
  const rejections = new Map<WorkerMessage["type"], ((error: Error) => void)[]>();
  let exitState: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<void>((resolveExit) => child.once("exit", (code, signal) => {
    exitState = { code, signal };
    for (const pending of rejections.values()) {
      for (const reject of pending) reject(new Error(`worker exited before its message: ${code ?? signal}; ${stderr}`));
    }
    waiters.clear();
    rejections.clear();
    resolveExit();
  }));
  child.on("message", (raw) => {
    const message = raw as WorkerMessage;
    const resolveMessage = waiters.get(message.type)?.shift();
    rejections.get(message.type)?.shift();
    if (resolveMessage) resolveMessage(message);
    else messages.push(message);
  });
  child.once("error", (error) => {
    for (const pending of rejections.values()) for (const reject of pending) reject(error);
  });

  return {
    waitFor(type) {
      const index = messages.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      if (exitState) return Promise.reject(new Error(`worker exited before ${type}: ${exitState.code ?? exitState.signal}; ${stderr}`));
      return new Promise((resolveMessage, rejectMessage) => {
        const timer = setTimeout(() => rejectMessage(new Error(`worker timed out before ${type}; ${stderr}`)), 15000);
        const settle = (message: WorkerMessage) => {
          clearTimeout(timer);
          resolveMessage(message);
        };
        const fail = (error: Error) => {
          clearTimeout(timer);
          rejectMessage(error);
        };
        waiters.set(type, [...(waiters.get(type) ?? []), settle]);
        rejections.set(type, [...(rejections.get(type) ?? []), fail]);
      });
    },
    release() {
      if (child.connected) child.send("release", () => undefined);
    },
    async waitForExit() {
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise<void>((resolveExit) => {
          timeout = setTimeout(resolveExit, 5000);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (!exitState) child.kill();
      await exited;
    },
  };
}

function ctx() {
  return { userId: EDITOR, newsroomId };
}

async function seedFollowUp(what: string, kind: "recheck" | "search", targets: string[]): Promise<number> {
  const sql = await db.getSql();
  const leadRows = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, status, notes_json)
    values (${EDITOR}, ${newsroomId}, 'Budget vote', 'The council votes Monday', 'new',
            ${JSON.stringify({ news: "The council votes Monday", todo: [], found: [{ t: EARLIER_NOTE, src: "machine" }] })})
    returning id
  `;
  const made = await followUps.performCreateAiFollowUp(ctx(), {
    leadId: leadRows[0]!.id,
    what,
    agentKind: kind,
    schedule: "daily",
    targets,
  });
  assert.equal(made.ok, true, made.ok ? "" : made.error);
  const id = made.ok ? made.id : 0;
  // The earlier run's finding, on the record exactly as a completed run leaves
  // it: this is the work Stop must preserve, and the row the fence is measured
  // against.
  await sql`
    update follow_ups
    set last_state = 'found', last_run_at = now(), next_run_at = now(),
        finding_json = ${JSON.stringify({
          title: "Budget papers",
          summary: "The papers were posted on 24 September.",
          url: "https://clerk.test/papers",
          reason: "",
          checkedAt: EARLIER_CHECKED_AT,
          changed: true,
        })}
    where id = ${id}
  `;
  return id;
}

async function enqueue(followUpId: number) {
  return jobs.enqueueJob({
    userId: EDITOR,
    newsroomId,
    kind: "follow-up",
    subjectId: followUpId,
    modelChoice: "auto",
    kick: false,
  });
}

async function stateOf(followUpId: number) {
  const sql = await db.getSql();
  const rows = await sql<{
    status: string;
    last_state: string | null;
    finding_json: string;
    lead_id: number | null;
  }>`select status, last_state, finding_json, lead_id from follow_ups where id = ${followUpId}`;
  const lead = rows[0]!.lead_id!;
  const notes = await sql<{ notes_json: string }>`select notes_json from leads where id = ${lead}`;
  return {
    ...rows[0]!,
    notes: JSON.parse(notes[0]!.notes_json) as {
      news: string;
      found: { t: string; src: string }[];
    },
    job: await jobs.latestJob({ newsroomId, kind: "follow-up", subjectId: followUpId }),
  };
}

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
      created = true;
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = withDatabase(adminUrl, databaseName);
    db = await import("../db.ts");
    followUps = await import("./follow-ups.ts");
    jobs = await import("./jobs.ts");
    agents = await import("./follow-up-agents.ts");
    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await jobs.ensureJobsSchema();
    await followUps.ensureFollowUpsSchema();
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]);
      await admin.query(`drop database ${databaseName}`);
    } finally {
      await admin.end();
    }
  });
}

it("a stop committed after the run's last boundary leaves no finding and no note", { skip, timeout: 60000 }, async () => {
  const followUpId = await seedFollowUp(
    "Has the council posted the revised budget papers?",
    "search",
    [],
  );
  mountedFollowUpId = followUpId;
  await enqueue(followUpId);

  const worker = startWorker("fence");
  try {
    // The run has done its work and is standing between its last cancellation
    // boundary and the result write. Nothing is held open on either side.
    await worker.waitFor("paused");

    // The editor's Stop, committed by THIS process while the worker waits.
    const stopped = await followUps.performFollowUpAction(ctx(), followUpId, "stop");
    assert.equal(stopped.ok, true);
    const sql = await db.getSql();
    const midStop = await sql<{ status: string }>`select status from follow_ups where id = ${followUpId}`;
    assert.equal(midStop[0]!.status, "stopped", "the stop is committed before the write is attempted");

    worker.release();
    const settled = await worker.waitFor("settled");
    assert.equal(settled.type === "settled" && settled.took, true, "the job ran; it was the WRITE that had to be refused");
    await worker.waitForExit();

    const after = await stateOf(followUpId);
    // No new NOTE first, because that is the write that would reach the editor
    // through the story: the page still holds the earlier run's one line, and
    // the stopped run's "posted on 26 September" is nowhere in it.
    assert.equal(after.notes.found.length, 1, "the stopped run's finding never reached the notes");
    assert.equal(after.notes.found[0]!.t, EARLIER_NOTE);
    assert.equal(after.notes.news, "The council votes Monday");

    // And no new finding: the row still carries the earlier run's, field for
    // field -- only the reason says why nothing followed it.
    const finding = JSON.parse(after.finding_json) as Record<string, unknown>;
    assert.equal(finding.url, "https://clerk.test/papers");
    assert.equal(finding.summary, "The papers were posted on 24 September.");
    assert.equal(finding.checkedAt, EARLIER_CHECKED_AT);
    assert.notEqual(after.last_state, "found", "a stopped run records no outcome");
    assert.notEqual(after.last_state, "running");
    assert.equal(after.status, "stopped");

    // The run's own record: the job system's existing cancel vocabulary.
    assert.equal(after.job?.status, "failed");
    assert.equal(after.job?.error, "Cancelled by the editor");
    assert.equal(after.job?.cancel_requested, true);
  } finally {
    worker.release();
    await worker.waitForExit();
  }
});

it("a run queued when the stop committed is never started by any process", { skip, timeout: 60000 }, async () => {
  const followUpId = await seedFollowUp(
    "Whether the pool has reopened",
    "recheck",
    ["https://clerk.test/pool"],
  );
  mountedFollowUpId = followUpId;
  const queued = await enqueue(followUpId);
  assert.equal(queued.status, "queued");

  const stopped = await followUps.performFollowUpAction(ctx(), followUpId, "stop");
  assert.equal(stopped.ok, true);

  // A second process, told to run that very job row, must refuse it: the claim
  // is `status = 'queued'`, and the Stop has already made it terminal.
  const worker = startWorker("fence");
  try {
    const settled = await worker.waitFor("settled");
    assert.equal(settled.type === "settled" && settled.took, false, "the claim must be refused");
    assert.equal(settled.type === "settled" && settled.reads, 0, "and no unit of work may run");
    await worker.waitForExit();
  } finally {
    worker.release();
    await worker.waitForExit();
  }

  const after = await stateOf(followUpId);
  assert.equal(after.job?.status, "failed");
  assert.equal(after.job?.error, "Cancelled by the editor");
  // Preserved, in another process's view of the same rows: the earlier finding
  // and the one note it wrote.
  assert.equal(after.notes.found.length, 1);
  assert.equal(after.notes.found[0]!.t, EARLIER_NOTE);
  assert.equal(after.status, "stopped");
  assert.equal(after.last_state, "found", "nothing ran, so nothing changed the last outcome");
});

it("a run stopped while it is working stops at its next unit, not at the end", { skip, timeout: 60000 }, async () => {
  const followUpId = await seedFollowUp(
    "Whether the pool page changed",
    "recheck",
    ["https://clerk.test/pool", "https://clerk.test/pool-2"],
  );
  mountedFollowUpId = followUpId;
  await enqueue(followUpId);

  const worker = startWorker("boundary");
  try {
    // The first page has been read; the run is standing inside its first unit
    // of work with a second page still to fetch.
    await worker.waitFor("paused");

    const stopped = await followUps.performFollowUpAction(ctx(), followUpId, "stop");
    assert.equal(stopped.ok, true);

    worker.release();
    const settled = await worker.waitFor("settled");
    assert.equal(settled.type === "settled" && settled.took, true);
    assert.equal(
      settled.type === "settled" && settled.reads,
      1,
      "the cancel flag one process wrote is what stopped the other process's run, before the second page",
    );
    await worker.waitForExit();
  } finally {
    worker.release();
    await worker.waitForExit();
  }

  const after = await stateOf(followUpId);
  assert.equal(after.job?.status, "failed");
  assert.equal(after.job?.error, "Cancelled by the editor");
  assert.equal(after.notes.found.length, 1, "nothing was recorded");
  assert.notEqual(after.last_state, "found");
  assert.equal(after.status, "stopped");
});

it("a Stop waits for a result write already inside its transaction, and the note survives (M3a)", { skip, timeout: 60000 }, async () => {
  /*
    The other side of the fence, which the race test above cannot show. There,
    Stop won. Here the result write is already inside its transaction -- its
    fenced UPDATE has run and it is parked on the story's notes row -- and Stop
    must WAIT for it rather than interleave. That is the linearization the fence
    promises: the note and the finding are on the same side of the Stop as the
    follow_up row, so a run that got there first keeps what it recorded.

    The barrier is a lock the write itself takes (`select ... for update` on
    `leads`, part of the fenced transaction), not a test seam: if the notes
    write ever moves out of that transaction, the fence commits without waiting
    for the story row, Stop returns immediately, and the first assertion here
    fails.
  */
  const followUpId = await seedFollowUp("Whether the pool page changed", "recheck", [
    "https://clerk.test/pool",
  ]);
  const after = await stateOf(followUpId);
  const leadId = after.lead_id!;

  const gate = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await gate.connect();
  await observer.connect();
  const sql = await db.getSql();
  let gateOpen = false;
  try {
    // Hold the story's notes row, so the write's own `for update` blocks there.
    await gate.query("begin");
    gateOpen = true;
    await gate.query("select notes_json from leads where id = $1 for update", [leadId]);

    const writing = followUps.performRecordFollowUpRun(ctx(), {
      id: followUpId,
      state: "found",
      finding: {
        title: "The pool reopened",
        summary: "The pool page says it reopened on 30 September.",
        url: "https://clerk.test/pool-reopened",
      },
      nextRunAt: null,
    });
    await waitForBlockedLock(observer);

    const stopping = followUps.performFollowUpAction(ctx(), followUpId, "stop");
    assert.equal(
      await settlesWithin(stopping, 500),
      false,
      "Stop must be waiting on the result write's transaction, not committing alongside it",
    );

    // Let the write finish. Everything queued behind its row lock goes through
    // in order: the note first, then the Stop.
    await gate.query("commit");
    gateOpen = false;

    const recorded = await writing;
    assert.deepEqual(recorded, { ok: true, noteWritten: true });
    assert.equal((await stopping).ok, true);

    const settled = await stateOf(followUpId);
    assert.equal(settled.status, "stopped");
    // Both notes: the earlier run's, and the one this run recorded before the
    // Stop landed. Nothing was lost, and nothing was written after the stop.
    assert.equal(settled.notes.found.length, 2, "the note the write committed survives the Stop");
    assert.match(settled.notes.found[1]!.t, /pool-reopened/);
    assert.match(String(settled.finding_json), /pool-reopened/);
  } finally {
    if (gateOpen) await gate.query("rollback").catch(() => undefined);
    await gate.end().catch(() => undefined);
    await observer.end().catch(() => undefined);
    await sql`delete from follow_ups where id = ${followUpId}`;
  }
});

it("a Stop interleaved into the worker's claim ends the job cancelled, never completed (M3b)", { skip, timeout: 60000 }, async () => {
  /*
    The window M1 is about: the worker has read the follow-up (it is active) and
    has not claimed it yet. Stop commits there. The claim refuses, and what the
    worker does with that refusal is the whole test -- a bare `return` lets
    `executeJob` write "Done" over a run that did no work.
  */
  const followUpId = await seedFollowUp("Has the pool reopened?", "search", []);
  const job = await enqueue(followUpId);
  let searched = false;
  jobs.__setJobWorkForTest(async (running) => {
    await agents.performFollowUpRun(running, {
      agents: {
        model: async (_label, run) => run(),
        search: async () => {
          searched = true;
          return { state: "SEARCH_OK", provider: "fake", hits: [] } as unknown as SearchAttempt;
        },
      },
      beforeClaim: async () => {
        const stopped = await followUps.performFollowUpAction(ctx(), followUpId, "stop");
        assert.equal(stopped.ok, true, "the editor's Stop commits in the window");
      },
    });
  });
  try {
    assert.equal(await jobs.executeJob(job), true);
  } finally {
    jobs.__setJobWorkForTest();
  }

  assert.equal(searched, false, "the run never did any work");
  const after = await stateOf(followUpId);
  assert.equal(after.job?.status, "failed", "a run that did nothing is not recorded as completed");
  assert.equal(after.job?.error, "Cancelled by the editor");
  assert.notEqual(after.job?.status, "completed");
  assert.equal(after.status, "stopped");
  assert.notEqual(after.last_state, "running", "the row is released rather than left running");
});

it("a Stop holding the queue's claim lock against a worker leaves no completed job (M3b2)", { skip, timeout: 60000 }, async () => {
  /*
    The same interleaving from the queue's side: the worker is inside
    `executeJob`'s claim transaction, blocked on the newsroom's advisory lock,
    and Stop commits while it waits. The claim then matches nothing, and the row
    it was about to claim is already terminal -- so the job can never be
    completed by it.
  */
  const followUpId = await seedFollowUp("Has the pool reopened?", "search", []);
  const job = await enqueue(followUpId);
  const gate = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await gate.connect();
  await observer.connect();
  let entered = false;
  jobs.__setJobWorkForTest(async () => {
    entered = true;
  });
  let gateOpen = false;
  try {
    await gate.query("begin");
    gateOpen = true;
    await gate.query("select pg_advisory_xact_lock($1, $2)", [
      NEWSROOM_JOB_CLAIM_LOCK_NAMESPACE,
      newsroomId,
    ]);

    const claiming = jobs.executeJob(job);
    await waitForBlockedLock(observer);
    assert.equal(await settlesWithin(claiming, 500), false, "the claim is waiting on the lock");

    const stopped = await followUps.performFollowUpAction(ctx(), followUpId, "stop");
    assert.equal(stopped.ok, true, "Stop does not need the claim lock");

    await gate.query("commit");
    gateOpen = false;
    assert.equal(await claiming, false, "the claim is refused");

    assert.equal(entered, false, "so no work ever started");
    const after = await stateOf(followUpId);
    assert.equal(after.job?.status, "failed");
    assert.equal(after.job?.error, "Cancelled by the editor");
  } finally {
    if (gateOpen) await gate.query("rollback").catch(() => undefined);
    jobs.__setJobWorkForTest();
    await gate.end().catch(() => undefined);
    await observer.end().catch(() => undefined);
  }
});

it("a Stop between Run now's read and its write leaves the agent stopped (M3c)", { skip, timeout: 60000 }, async () => {
  /*
    `startFollowUpRun` reads the row (active or paused), then writes. The write
    is the run-now update, and its `status in ('active','paused')` predicate is
    what stops a Stop that landed in between from being overwritten -- which
    would resurrect an agent the editor had ended.
  */
  const followUpId = await seedFollowUp("Has the pool reopened?", "search", []);
  const read = await followUps.performReadFollowUp(ctx(), followUpId);
  assert.equal(read?.status, "active", "the read Run now does first");

  const stopped = await followUps.performFollowUpAction(ctx(), followUpId, "stop");
  assert.equal(stopped.ok, true);

  const moved = await followUps.performFollowUpAction(ctx(), followUpId, "run-now");
  assert.equal(moved.ok, false, "the write must not overwrite the Stop");
  const after = await stateOf(followUpId);
  assert.equal(after.status, "stopped");
  assert.equal(after.job, null, "and no run was queued for it");

  // The whole press, for the same reason: refused, with the sentence that says
  // which state the row is in.
  const started = await (await import("./follow-up-scheduler.ts")).startFollowUpRun(
    ctx(),
    followUpId,
    new Date(),
    { kick: false },
  );
  assert.equal(started.started, false);
  assert.equal(started.skipped, "not-active");
  assert.equal((await stateOf(followUpId)).job, null);
});
