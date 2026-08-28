import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enqueueJob, findOpenJob, latestJob, drainQueuedJobs, claimJob } from "./jobs.ts";
import { handleMonitorsCron } from "./monitors-cron.ts";

describe("desk jobs", () => {
  it("reuses a queued/running job for the same subject", async () => {
    const user = `job-${Date.now()}`;
    const newsroomId = 91001;
    const a = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 424242,
      kick: false,
    });
    const b = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 424242,
      kick: false,
    });
    assert.equal(a.id, b.id);
    const latest = await latestJob({ newsroomId, kind: "draft", subjectId: 424242 });
    assert.equal(latest?.id, a.id);
    assert.ok(latest?.status === "queued" || latest?.status === "running");
  });

  it("finds an open scan without knowing the run id", async () => {
    const user = `job-scan-${Date.now()}`;
    const newsroomId = 91002;
    const a = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "scan",
      subjectId: 9001,
      kick: false,
    });
    const found = await findOpenJob({ newsroomId, kind: "scan" });
    assert.ok(found);
    assert.equal(found.id, a.id);
    assert.equal(found.kind, "scan");
  });

  it("a wake-up finishes a queued job even if kick never ran", async () => {
    const user = `job-drain-${Date.now()}`;
    const newsroomId = 91003;
    const job = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 1,
      kick: false,
    });
    assert.equal(job.status, "queued");
    const { ran } = await drainQueuedJobs();
    assert.ok(ran >= 1);
    const latest = await latestJob({ newsroomId, kind: "draft", subjectId: 1 });
    assert.ok(latest);
    assert.ok(latest.status === "completed" || latest.status === "failed", latest.status);
    assert.notEqual(latest.status, "queued");
    if (latest.status === "failed") {
      assert.ok((latest.error ?? "").length > 0);
    }
  });
});

describe("job drain CAS", () => {
  it("two claimers cannot both run the same job", async () => {
    const user = `job-cas-${Date.now()}`;
    const newsroomId = 91004;
    const job = await enqueueJob({
      userId: user,
      newsroomId,
      kind: "draft",
      subjectId: 77,
      kick: false,
    });
    assert.equal(job.status, "queued");
    const [a, b] = await Promise.all([claimJob(job.id), claimJob(job.id)]);
    const won = [a, b].filter(Boolean);
    assert.equal(won.length, 1);
    assert.equal(won[0]!.status, "running");
    const lost = [a, b].filter((row) => row == null);
    assert.equal(lost.length, 1);
  });
});

describe("cron fail-closed", () => {
  it("empty CRON_SECRET returns 503 from the production handler", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await handleMonitorsCron(new Request("https://example.com/api/cron/monitors"));
      assert.equal(res.status, 503);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("wrong bearer is 403 and a matching bearer is allowed", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "desk-cron";
    try {
      const bad = await handleMonitorsCron(
        new Request("https://example.com/api/cron/monitors", {
          headers: { authorization: "Bearer no" },
        }),
      );
      assert.equal(bad.status, 403);
      const good = await handleMonitorsCron(
        new Request("https://example.com/api/cron/monitors", {
          headers: { authorization: "Bearer desk-cron" },
        }),
      );
      assert.equal(good.status, 200);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
