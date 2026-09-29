import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the cross-process claim proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `townreporter_test_job_claim_fence_${process.pid}_${Date.now()}`;
const newsroomId = 81001;
const NEWSROOM_JOB_CLAIM_LOCK_NAMESPACE = 1_414_670_918;
let created = false;
let db: typeof import("../db.ts");
let jobs: typeof import("./jobs.ts");

type WorkerMessage = { type: "attempting" | "entered" | "settled"; jobId: number; took?: boolean };

type JobWorker = {
  child: ChildProcess;
  waitFor(type: WorkerMessage["type"]): Promise<WorkerMessage>;
  waitForOutcome(): Promise<WorkerMessage>;
  release(): void;
  waitForExit(): Promise<void>;
};

function startWorker(job: { id: number; kind: string; subject_id: number }, hold: boolean): JobWorker {
  const dbUrl = pathToFileURL(resolve("src/lib/db.ts")).href;
  const jobsUrl = pathToFileURL(resolve("src/lib/news/jobs.ts")).href;
  const source = `
    const db = await import(${JSON.stringify(dbUrl)});
    const jobs = await import(${JSON.stringify(jobsUrl)});
    const newsroomId = Number(process.env.ENG001_NEWSROOM_ID);
    const job = await jobs.latestJob({
      newsroomId,
      kind: process.env.ENG001_JOB_KIND,
      subjectId: Number(process.env.ENG001_SUBJECT_ID),
    });
    if (!job) throw new Error("worker could not find its queued job");
    jobs.__setJobWorkForTest(async () => {
      if (process.env.ENG001_HOLD === "1") {
        await new Promise(resolve => {
          process.once("message", message => { if (message === "release") resolve(); });
          process.send({ type: "entered", jobId: job.id });
        });
      } else {
        process.send({ type: "entered", jobId: job.id });
      }
    });
    process.send({ type: "attempting", jobId: job.id });
    const took = await jobs.executeJob(job);
    await new Promise((resolve, reject) => process.send({ type: "settled", jobId: job.id, took }, error => error ? reject(error) : resolve()));
    await db.closePoolForTests();
  `;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ENG001_NEWSROOM_ID: String(newsroomId),
        ENG001_JOB_KIND: job.kind,
        ENG001_SUBJECT_ID: String(job.subject_id),
        ENG001_HOLD: hold ? "1" : "0",
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
  const failures = new Map<WorkerMessage["type"], ((error: Error) => void)[]>();
  let exitState: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<void>((resolveExit) => child.once("exit", (code, signal) => {
    exitState = { code, signal };
    for (const [type, pending] of waiters) {
      for (const reject of failures.get(type) ?? []) reject(new Error(`worker exited before ${type}: ${code ?? signal}; ${stderr}`));
      pending.length = 0;
    }
    resolveExit();
  }));
  child.on("message", (raw) => {
    const message = raw as WorkerMessage;
    const resolveMessage = waiters.get(message.type)?.shift();
    failures.get(message.type)?.shift();
    if (resolveMessage) {
      resolveMessage(message);
    } else {
      messages.push(message);
    }
  });
  child.once("error", (error) => {
    for (const pending of failures.values()) for (const reject of pending) reject(error);
  });

  return {
    child,
    waitFor(type) {
      const index = messages.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      if (exitState) return Promise.reject(new Error(`worker exited before ${type}: ${exitState.code ?? exitState.signal}; ${stderr}`));
      return new Promise((resolveMessage, rejectMessage) => {
        const timer = setTimeout(() => rejectMessage(new Error(`worker timed out before ${type}; ${stderr}`)), 10000);
        const resolveWithCleanup = (message: WorkerMessage) => {
          clearTimeout(timer);
          resolveMessage(message);
        };
        const rejectWithCleanup = (error: Error) => {
          clearTimeout(timer);
          rejectMessage(error);
        };
        waiters.set(type, [...(waiters.get(type) ?? []), resolveWithCleanup]);
        failures.set(type, [...(failures.get(type) ?? []), rejectWithCleanup]);
      });
    },
    waitForOutcome() {
      const index = messages.findIndex((message) => message.type === "entered" || message.type === "settled");
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      if (exitState) return Promise.reject(new Error(`worker exited before an execution outcome: ${exitState.code ?? exitState.signal}; ${stderr}`));
      return new Promise((resolveMessage, rejectMessage) => {
        const timer = setTimeout(() => {
          cleanup();
          rejectMessage(new Error(`worker timed out before an execution outcome; ${stderr}`));
        }, 10000);
        const onMessage = (raw: unknown) => {
          const message = raw as WorkerMessage;
          if (message.type !== "entered" && message.type !== "settled") return;
          cleanup();
          resolveMessage(message);
        };
        const onExit = () => {
          cleanup();
          rejectMessage(new Error(`worker exited before an execution outcome: ${exitState?.code ?? exitState?.signal}; ${stderr}`));
        };
        const cleanup = () => {
          clearTimeout(timer);
          child.off("message", onMessage);
          child.off("exit", onExit);
        };
        child.on("message", onMessage);
        child.once("exit", onExit);
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

/** Wait until every worker is visibly queued on the same PostgreSQL claim lock. */
async function waitForAdvisoryWaiters(client: Client, expected: number): Promise<void> {
  let observed = 0;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = await client.query<{ waiting: string }>(
      `select count(*)::text as waiting
       from pg_locks
       where locktype = 'advisory'
         and database = (select oid from pg_database where datname = current_database())
         and classid = $1::oid
         and objid = $2::oid
         and objsubid = 2
         and not granted`,
      [NEWSROOM_JOB_CLAIM_LOCK_NAMESPACE, newsroomId],
    );
    observed = Number(result.rows[0]?.waiting ?? 0);
    if (observed === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${expected} workers waiting on the claim advisory lock; observed ${observed}`);
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
    jobs = await import("./jobs.ts");
    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await jobs.ensureJobsSchema();
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

it("independent PostgreSQL processes enforce and release the newsroom execution fence", { skip, timeout: 30000 }, async () => {
  const sql = await db.getSql();
  const workers: JobWorker[] = [];
  let subject = 8100;
  try {
    for (const [firstKind, secondKind] of [
      ["follow-up", "follow-up"],
      ["draft", "follow-up"],
      ["follow-up", "draft"],
    ] as const) {
      const first = await jobs.enqueueJob({
        userId: "eng001-postgres-test",
        newsroomId,
        kind: firstKind,
        subjectId: subject++,
        kick: false,
      });
      const firstWorker = startWorker(first, true);
      workers.push(firstWorker);
      assert.equal((await firstWorker.waitFor("entered")).jobId, first.id);

      const second = await jobs.enqueueJob({
        userId: "eng001-postgres-test",
        newsroomId,
        kind: secondKind,
        subjectId: subject++,
        kick: false,
      });
      const blockedWorker = startWorker(second, false);
      workers.push(blockedWorker);
      const blocked = await blockedWorker.waitFor("settled");
      assert.equal(blocked.took, false, `${secondKind} must remain queued while ${firstKind} is running`);
      assert.equal((await jobs.latestJob({ newsroomId, kind: secondKind, subjectId: second.subject_id }))?.status, "queued");

      firstWorker.release();
      assert.equal((await firstWorker.waitFor("settled")).took, true);

      const retryWorker = startWorker(second, false);
      workers.push(retryWorker);
      assert.equal((await retryWorker.waitFor("settled")).took, true, "blocked work must become claimable after release");
      assert.equal((await jobs.latestJob({ newsroomId, kind: secondKind, subjectId: second.subject_id }))?.status, "completed");

      await sql`delete from desk_jobs where id in (${first.id}, ${second.id})`;
      await Promise.all([firstWorker.waitForExit(), blockedWorker.waitForExit(), retryWorker.waitForExit()]);
    }
  } finally {
    for (const worker of workers) worker.release();
    await Promise.all(workers.map((worker) => worker.waitForExit()));
    await sql`delete from desk_jobs where newsroom_id = ${newsroomId}`;
  }
});

it("simultaneous PostgreSQL follow-up claims contend before either can enter", { skip, timeout: 30000 }, async () => {
  const sql = await db.getSql();
  const gate = new Client({ connectionString: process.env.DATABASE_URL });
  const workers: JobWorker[] = [];
  const firstSubject = 8201;
  const secondSubject = 8202;
  let gateOpen = false;

  try {
    const first = await jobs.enqueueJob({
      userId: "eng001-postgres-test",
      newsroomId,
      kind: "follow-up",
      subjectId: firstSubject,
      kick: false,
    });
    const second = await jobs.enqueueJob({
      userId: "eng001-postgres-test",
      newsroomId,
      kind: "follow-up",
      subjectId: secondSubject,
      kick: false,
    });

    await gate.connect();
    await gate.query("begin");
    gateOpen = true;
    // Keep both independent workers inside executeJob's claim transaction
    // until pg_stat_activity confirms both are waiting on this exact lock.
    // This namespace is intentionally mirrored from jobs.ts; drift fails the
    // waiter assertion instead of weakening the concurrency proof.
    await gate.query("select pg_advisory_xact_lock($1, $2)", [NEWSROOM_JOB_CLAIM_LOCK_NAMESPACE, newsroomId]);

    const firstWorker = startWorker(first, true);
    const secondWorker = startWorker(second, true);
    workers.push(firstWorker, secondWorker);
    await Promise.all([firstWorker.waitFor("attempting"), secondWorker.waitFor("attempting")]);
    await waitForAdvisoryWaiters(gate, 2);

    await gate.query("commit");
    gateOpen = false;

    const outcomes = await Promise.all([firstWorker.waitForOutcome(), secondWorker.waitForOutcome()]);
    const entered = outcomes.filter((outcome) => outcome.type === "entered");
    const settled = outcomes.filter((outcome) => outcome.type === "settled");
    assert.equal(entered.length, 1, "exactly one process may enter follow-up work");
    assert.equal(settled.length, 1, "the losing process must return without entering work");
    assert.equal(settled[0]?.took, false, "the losing claim must be refused");

    const winnerId = entered[0]!.jobId;
    const loser = winnerId === first.id ? second : first;
    const winner = winnerId === first.id ? first : second;
    assert.equal((await jobs.latestJob({ newsroomId, kind: "follow-up", subjectId: winner.subject_id }))?.status, "running");
    assert.equal((await jobs.latestJob({ newsroomId, kind: "follow-up", subjectId: loser.subject_id }))?.status, "queued");

    const winnerWorker = winnerId === first.id ? firstWorker : secondWorker;
    winnerWorker.release();
    assert.equal((await winnerWorker.waitFor("settled")).took, true);
    assert.equal((await jobs.latestJob({ newsroomId, kind: "follow-up", subjectId: winner.subject_id }))?.status, "completed");

    const retryWorker = startWorker(loser, false);
    workers.push(retryWorker);
    assert.equal((await retryWorker.waitFor("settled")).took, true, "the queued claim must remain runnable after the winner completes");
    assert.equal((await jobs.latestJob({ newsroomId, kind: "follow-up", subjectId: loser.subject_id }))?.status, "completed");
    await Promise.all([firstWorker.waitForExit(), secondWorker.waitForExit(), retryWorker.waitForExit()]);
  } finally {
    if (gateOpen) await gate.query("rollback").catch(() => undefined);
    for (const worker of workers) worker.release();
    await Promise.all(workers.map((worker) => worker.waitForExit()));
    await sql`delete from desk_jobs where newsroom_id = ${newsroomId} and subject_id in (${firstSubject}, ${secondSubject})`;
    await gate.end().catch(() => undefined);
  }
});
