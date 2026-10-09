// guards: a cancelled writer could keep a saved draft locked and overwrite it later while active work is hidden behind queued jobs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSql } from "../src/lib/db.ts";
import { applyMigrationsToTestPglite } from "../src/lib/test-support/pglite-migrations.ts";
import { enqueueJob, requestJobCancel, findOpenJob, executeJob, __setJobWorkForTest, JOB_CANCELLED_REASON } from "../src/lib/news/jobs.ts";
import { withClaimedLeadDraftLock } from "../src/lib/news/draft-order.server.ts";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
installDom(); const React = await import("react"), { createRoot } = await import("react-dom/client");
const base = new URL("../src/lib/news/", import.meta.url);
const { readDeskJobs } = await import(await moduleUrl("src/lib/news/job-progress.ts", {
  "@tanstack/react-start": stubUrl('export const createServerFn=()=>({middleware(){return this},validator(){return this},handler(fn){return fn}});'),
  "../db.ts": new URL("../src/lib/db.ts", import.meta.url).href,
  "./desk-auth.ts": stubUrl('export const deskMiddleware={};'),
  "./model-choice.ts": new URL("model-choice.ts", base).href,
  "./jobs.ts": new URL("jobs.ts", base).href,
  ...Object.fromEntries(["./follow-ups.ts", "./follow-up-agents.ts", "./automatic-failover.ts", "./ai.ts", "./draft-reconcile.server.ts", "./model-request-commit.server.ts"].map(name => [name, stubUrl('throw new Error("No worker transport in this flow");')])),
}));
const { JobCard } = await import("./job-card-render.harness.mjs");
test("cancelling queued or running work unlocks its draft at once and keeps active work first", async () => {
  await applyMigrationsToTestPglite(); const sql = await getSql(), room = 89917;
  const queued = await enqueueJob({ userId: "cancel-editor", newsroomId: room, kind: "draft", subjectId: room, modelChoice: "openai", kick: false });
  const active = await enqueueJob({ userId: "cancel-editor", newsroomId: room, kind: "scan", subjectId: room, modelChoice: "openai", kick: false });
  await sql.query("update desk_jobs set status='running',claim_token='old-worker' where id=$1", [active.id]);
  const newer = await enqueueJob({ userId: "cancel-editor", newsroomId: room, kind: "draft", subjectId: room + 1, modelChoice: "openai", kick: false });
  const root = createRoot(document.getElementById("root"));
  try {
  await React.act(async () => root.render(React.createElement(JobCard, { now: Date.now(), job: (await readDeskJobs(room)).find(job => job.id === queued.id), onCancel: () => requestJobCancel(queued.id) })));
  const cancel = [...document.querySelectorAll("button")].find(button => /Cancel|Stop/.test(button.textContent));
  assert.ok(cancel); await React.act(async () => cancel.click());
  assert.equal(await findOpenJob({ newsroomId: room, kind: "draft", subjectId: room }), null);
  const [stopped] = await sql.query("select * from desk_jobs where id=$1", [queued.id]);
  assert.equal(stopped.status, "failed"); assert.equal(stopped.error, JOB_CANCELLED_REASON); assert.ok(stopped.finished_at);
  let ran = false; __setJobWorkForTest(async () => { ran = true; });
  try { await executeJob(queued); } finally { __setJobWorkForTest(); }
  assert.equal(ran, false);
  assert.equal((await readDeskJobs(room))[0].id, active.id);
  await requestJobCancel(active.id);
  await assert.rejects(withClaimedLeadDraftLock({ ...active, claim_token: "old-worker" }, room, async () => { throw new Error("stale writer reached draft"); }), /lease was lost/);
  assert.equal((await readDeskJobs(room))[0].id, newer.id);
  } finally { await React.act(async () => root.unmount()); }
});
