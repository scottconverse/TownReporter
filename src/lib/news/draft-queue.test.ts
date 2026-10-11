import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueueJob, drainQueuedJobs, latestJob, executeJob, __setJobWorkForTest } from "./jobs.ts";

async function until(check: () => Promise<boolean>, label: string) {
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(label);
}

test("FB16: a draft starts while a long scan and dig occupy the background workers", async () => {
  const newsroomId = 98601;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Set<string>();
  const drains: Promise<unknown>[] = [];
  __setJobWorkForTest(async (job) => {
    started.add(job.kind);
    if (job.kind !== "draft") await gate;
  });
  try {
    for (const kind of ["scan", "dark"] as const)
      await enqueueJob({
        newsroomId,
        userId: "fb16",
        kind,
        subjectId: 1,
        modelChoice: "gemini-flash",
        kick: false,
      });
    drains.push(drainQueuedJobs());
    await until(
      async () => started.has("scan") && started.has("dark"),
      "background jobs did not start",
    );
    await enqueueJob({
      newsroomId,
      userId: "fb16",
      kind: "draft",
      subjectId: 2,
      modelChoice: "gemini-flash",
      kick: false,
    });
    drains.push(drainQueuedJobs());
    await until(async () => started.has("draft"), "draft waited behind the scan and dig");
    assert.equal((await latestJob({ newsroomId, kind: "scan", subjectId: 1 }))?.status, "running");
  } finally {
    release();
    await Promise.all(drains);
    __setJobWorkForTest();
  }
});

test("FB16: two local jobs cannot run at once across lanes", async () => {
  const newsroomId = 98602;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Set<string>();
  const drains: Promise<unknown>[] = [];
  __setJobWorkForTest(async (job) => {
    started.add(job.kind);
    if (job.kind === "scan") await gate;
  });
  try {
    await enqueueJob({
      newsroomId,
      userId: "fb16",
      kind: "scan",
      subjectId: 1,
      modelChoice: "local-model",
      kick: false,
    });
    drains.push(drainQueuedJobs());
    await until(async () => started.has("scan"), "local scan did not start");
    const draft = await enqueueJob({
      newsroomId,
      userId: "fb16",
      kind: "draft",
      subjectId: 2,
      modelChoice: "local-model",
      kick: false,
    });
    assert.equal(
      await executeJob(draft),
      false,
      "direct admission must respect the local model guard",
    );
    await drainQueuedJobs();
    assert.equal(started.has("draft"), false, "two jobs entered the same local model");
    assert.equal((await latestJob({ newsroomId, kind: "draft", subjectId: 2 }))?.status, "queued");
    release();
    await Promise.all(drains);
    await drainQueuedJobs();
    assert.equal(started.has("draft"), true);
  } finally {
    release();
    await Promise.all(drains);
    __setJobWorkForTest();
  }
});

test("FB16: a later cloud draft uses a free slot while a local draft is still running", async () => {
  const newsroomId = 98603;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Set<number>();
  const drains: Promise<unknown>[] = [];
  __setJobWorkForTest(async (job) => {
    started.add(job.subject_id);
    if (job.subject_id === 1) await gate;
  });
  try {
    await enqueueJob({
      newsroomId,
      userId: "fb16",
      kind: "draft",
      subjectId: 1,
      modelChoice: "local-model",
      kick: false,
    });
    drains.push(drainQueuedJobs());
    await until(async () => started.has(1), "local draft did not start");
    // An empty worker has nothing to claim while the first draft holds its gate.
    // A second wake-up must keep the spare slot usable for a later press.
    await drainQueuedJobs();
    await enqueueJob({
      newsroomId,
      userId: "fb16",
      kind: "draft",
      subjectId: 2,
      modelChoice: "gemini-flash",
      kick: false,
    });
    drains.push(drainQueuedJobs());
    await until(
      async () => started.has(2),
      "an idle writing slot stayed reserved behind the long draft",
    );
    assert.equal((await latestJob({ newsroomId, kind: "draft", subjectId: 1 }))?.status, "running");
  } finally {
    release();
    await Promise.all(drains);
    __setJobWorkForTest();
  }
});
