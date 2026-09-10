import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { getSql } from "../db.ts";

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}

describe("desk job drainer module identity", { timeout: 15_000 }, () => {
  it("shares default-lane ownership across two bundled module identities", async () => {
    const jobsUrl = pathToFileURL(resolve("src/lib/news/jobs.ts")).href;
    const background = (await import(`${jobsUrl}?bundle=background`)) as typeof import("./jobs.ts");
    const ssr = (await import(`${jobsUrl}?bundle=ssr`)) as typeof import("./jobs.ts");
    const newsroomId = 92000 + Math.floor(Math.random() * 999);
    const started: number[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    const work = async (job: { id: number }) => {
      started.push(job.id);
      await held;
    };
    background.__setJobWorkForTest(work);
    ssr.__setJobWorkForTest(work);

    const jobs = await Promise.all(
      [1, 2, 3].map((subjectId) =>
        background.enqueueJob({
          userId: `module-copy-${newsroomId}`,
          newsroomId,
          kind: "draft",
          subjectId,
          kick: false,
        }),
      ),
    );
    let firstDrain: Promise<{ ran: number }> | undefined;
    let secondDrain: Promise<{ ran: number }> | undefined;

    try {
      firstDrain = background.drainQueuedJobs();
      await waitFor(() => started.length === 2, "the first module should fill concurrency 2");

      secondDrain = ssr.drainQueuedJobs();
      await delay(100);
      assert.equal(started.length, 2, "the second module must not open a third default-lane slot");

      release();
      const [first, second] = await Promise.all([firstDrain, secondDrain]);
      assert.equal(second.ran, 0, "the second module should observe the shared active drainer");
      assert.equal(first.ran, 3, "the owning drainer should finish the queued third job after a slot opens");
    } finally {
      release();
      await Promise.allSettled([firstDrain, secondDrain].filter((drain) => drain != null));
      background.__setJobWorkForTest();
      ssr.__setJobWorkForTest();
      const sql = await getSql();
      await sql.query("delete from desk_jobs where id = any($1::int[])", [jobs.map((job) => job.id)]);
    }
  });
});
