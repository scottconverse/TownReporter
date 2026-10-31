import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSql, withTransaction } from "../db.ts";
import type { DeskJob } from "./jobs.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { DUP_CHECK_SYSTEM, SAME_STORY_SYSTEM } from "./dup-check.ts";

/*
  D162 (Scott, Oct 19 2026: "why don't you update the queue live while it's
  searching"). A MANUAL scan files each batch's leads as soon as the model has
  read that batch, so they are on the Queue while the scan still runs. A
  SCHEDULED scan still files everything in its one commit at the end.

  These run the real `performScanWork` on the test PGlite with a fake model:
  20 sources of ~2,800 characters each make two model batches (48,000-character
  budget, scan-batches.ts), and the fake model looks at the `leads` table when
  the SECOND batch is sent -- which is the moment the old code had filed
  nothing yet.
*/

await applyMigrationsToTestPglite();

// desk.ts has Vite aliases and extensionless imports (as scan-section-cache.test.ts).
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context);
      }
      throw error;
    }
  },
});

let scan: typeof import("./desk.ts").performScanWork;
before(async () => {
  scan = (await import("./desk.ts")).performScanWork;
});
after(() => hooks.deregister());

let roomCounter = 9410;
const SOURCE_COUNT = 20;

function lead(headline: string) {
  return {
    headline,
    why: "A dated public meeting that affects residents.",
    topic: "council",
    source_urls: [],
    evidence: "The agenda lists the vote.",
    newsworthiness: 7,
    is_event: true,
  };
}

const BATCH_ONE = [
  lead("Longmont council votes Oct. 28 on a new water contract with Northern Water"),
  lead("Boulder County opens a free flu shot clinic Nov. 3 at the fairgrounds"),
];
const BATCH_TWO = [
  // The same headline batch one already filed: must not be filed twice.
  lead("Longmont council votes Oct. 28 on a new water contract with Northern Water"),
  lead("St. Vrain Valley schools cut two bus routes in east Longmont starting Nov. 12"),
];

async function seedManualScan(user: string, room: number, sourceCount = SOURCE_COUNT) {
  const sql = await getSql();
  await sql`insert into newsrooms(id,name) values(${room},'Live queue fixture')`;
  await sql`insert into newsroom_members(user_id,newsroom_id,role) values(${user},${room},'owner')`;
  for (let i = 0; i < sourceCount; i++) {
    await sql`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values(${user},${room},${`https://s${i}-${room}.example.test/agenda`},${`Agenda ${i}`},'page','A','accepted')`;
  }
  const [run] = await sql<{ id: number }>`insert into scan_runs(user_id,newsroom_id) values(${user},${room}) returning id`;
  const [job] = await sql<DeskJob>`insert into desk_jobs(user_id,newsroom_id,subject_id,kind,model_choice,model_choice_source,status,claim_token)
    values(${user},${room},${run!.id},'scan','grok','editor','running',${`live-queue-${room}`}) returning *`;
  return { runId: run!.id, job: job! };
}

function fakeModel(runId: number) {
  let calls = 0;
  // The AI duplicate checks (same-story finder, pair check) are counted apart
  // from the scan's reading batches and answer "no duplicates".
  let dupCalls = 0;
  let leadsOnQueueWhenBatchTwoSent: number | null = null;
  return {
    get calls() {
      return calls;
    },
    get leadsOnQueueWhenBatchTwoSent() {
      return leadsOnQueueWhenBatchTwoSent;
    },
    get dupCalls() {
      return dupCalls;
    },
    grokChat: async (system: string) => {
      if (system === SAME_STORY_SYSTEM || system === DUP_CHECK_SYSTEM) {
        dupCalls += 1;
        return { ok: true as const, text: "[]" };
      }
      calls += 1;
      if (calls === 2) {
        const sql = await getSql();
        const [row] = await sql<{ n: number }>`select count(*)::int as n from leads where scan_run_id = ${runId}`;
        leadsOnQueueWhenBatchTwoSent = row!.n;
      }
      const leads = calls === 1 ? BATCH_ONE : calls === 2 ? BATCH_TWO : [];
      return {
        ok: true as const,
        text: JSON.stringify({ leads, proposed_sources: [], editor_summary: `Batch ${calls} read.` }),
      };
    },
  };
}

const pageText = (url: string) =>
  `${url} agenda. ` + "The council will hear public comment on the items below. ".repeat(60);

it("a manual scan's first batch of leads is on the Queue before the second batch is read, and a repeated headline is filed once", async () => {
  const room = roomCounter++;
  const user = `live-queue-${room}`;
  const { runId, job } = await seedManualScan(user, room);
  const model = fakeModel(runId);
  await scan(job, {
    ingestUrl: async (url: string) => ({ text: pageText(url), titleHint: "Agenda", extras: [] }),
    grokChat: model.grokChat,
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
  });
  const sql = await getSql();
  assert.equal(model.calls, 2, "the fixture must make exactly two model batches");
  assert.ok(model.dupCalls > 0, "the AI duplicate check reads the new leads before they are filed");
  assert.equal(model.leadsOnQueueWhenBatchTwoSent, 2, "batch one's two leads are filed before batch two is read");
  const filed = await sql<{ headline: string }>`select headline from leads where scan_run_id = ${runId} order by id`;
  assert.deepEqual(
    filed.map((row) => row.headline),
    [BATCH_ONE[0]!.headline, BATCH_ONE[1]!.headline, BATCH_TWO[1]!.headline],
    "three different stories, the repeated headline filed once",
  );
  const [receipt] = await sql<{ leads_created: number; finished_at: string | null; error: string | null }>`
    select leads_created, finished_at, error from scan_runs where id = ${runId}`;
  assert.ok(receipt!.finished_at, "the run is settled");
  assert.equal(receipt!.error, null);
  assert.equal(receipt!.leads_created, 3, "the receipt counts every lead the scan filed, early or late");
});

it("a scheduled scan still files nothing before its one commit", async () => {
  const room = roomCounter++;
  const user = `live-queue-${room}`;
  const { runId, job } = await seedManualScan(user, room);
  const model = fakeModel(runId);
  await scan(job, {
    ingestUrl: async (url: string) => ({ text: pageText(url), titleHint: "Agenda", extras: [] }),
    grokChat: model.grokChat,
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
    scheduledCommit: (write) => withTransaction(write),
  });
  const sql = await getSql();
  assert.equal(model.calls, 2, "the fixture must make exactly two model batches");
  assert.ok(model.dupCalls > 0, "the AI duplicate check reads the new leads before the commit");
  assert.equal(model.leadsOnQueueWhenBatchTwoSent, 0, "the scheduled lane files nothing early");
  const filed = await sql<{ n: number }>`select count(*)::int as n from leads where scan_run_id = ${runId}`;
  assert.equal(filed[0]!.n, 3, "the one commit files all three stories");
});

const STREAM_SOURCE_COUNT = 45;
const STREAM_BATCH_ONE_LEAD = lead(
  "Longmont council votes Oct. 28 on a new water contract with Northern Water",
);
const STREAM_BATCH_THREE_LEAD = lead(
  "St. Vrain Valley schools cut two bus routes in east Longmont starting Nov. 12",
);

it("starts a manual scan's first model batch and files its leads before the last source fetch finishes", async () => {
  const room = roomCounter++;
  const user = `live-queue-${room}`;
  const { runId, job } = await seedManualScan(user, room, STREAM_SOURCE_COUNT);
  const sql = await getSql();
  let fetchCalls = 0;
  let firstModelCallAtFetchCalls: number | null = null;
  let leadWasFiledBeforeLastFetchFinished = false;
  let scanCalls = 0;
  let duplicateCalls = 0;

  await scan(job, {
    ingestUrl: async (url: string) => {
      fetchCalls += 1;
      if (fetchCalls === STREAM_SOURCE_COUNT) {
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline) {
          const [row] = await sql<{ n: number }>`
            select count(*)::int as n from leads
            where scan_run_id = ${runId} and headline = ${STREAM_BATCH_ONE_LEAD.headline}
          `;
          if (row!.n > 0) {
            leadWasFiledBeforeLastFetchFinished = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      return { text: pageText(url), titleHint: "Agenda", extras: [] };
    },
    grokChat: async (system: string) => {
      if (system === SAME_STORY_SYSTEM || system === DUP_CHECK_SYSTEM) {
        duplicateCalls += 1;
        return { ok: true as const, text: "[]" };
      }
      scanCalls += 1;
      if (scanCalls === 1) firstModelCallAtFetchCalls = fetchCalls;
      return {
        ok: true as const,
        text: JSON.stringify({
          leads: scanCalls === 1 ? [STREAM_BATCH_ONE_LEAD] : [],
          proposed_sources: [],
          editor_summary: `Batch ${scanCalls} read.`,
        }),
      };
    },
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
  });

  assert.equal(scanCalls, 3, "45 sources fill three scan batches");
  assert.ok(duplicateCalls > 0, "the first batch's duplicate check ran");
  assert.ok(
    firstModelCallAtFetchCalls !== null && firstModelCallAtFetchCalls < STREAM_SOURCE_COUNT,
    `the first model call must begin before the last source fetch starts (started at fetch ${firstModelCallAtFetchCalls})`,
  );
  assert.equal(
    leadWasFiledBeforeLastFetchFinished,
    true,
    "the first batch's lead must be on the Queue before the last source fetch finishes",
  );
});

it("a scheduled scan still waits for every fetch before its first model batch", async () => {
  const room = roomCounter++;
  const user = `live-queue-${room}`;
  const { job } = await seedManualScan(user, room);
  let lastFetchFinished = false;
  let firstModelCallAfterLastFetch = false;
  let scanCalls = 0;

  await scan(job, {
    ingestUrl: async () => {
      lastFetchFinished = true;
      return { text: pageText("https://scheduled.example.test/agenda"), titleHint: "Agenda", extras: [] };
    },
    grokChat: async (system: string) => {
      if (system === SAME_STORY_SYSTEM || system === DUP_CHECK_SYSTEM)
        return { ok: true as const, text: "[]" };
      scanCalls += 1;
      if (scanCalls === 1) firstModelCallAfterLastFetch = lastFetchFinished;
      return {
        ok: true as const,
        text: JSON.stringify({ leads: [], proposed_sources: [], editor_summary: `Batch ${scanCalls}.` }),
      };
    },
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
    scheduledCommit: (write) => withTransaction(write),
  });

  assert.ok(scanCalls > 0);
  assert.equal(firstModelCallAfterLastFetch, true);
});

it("a failed middle batch keeps the leads from the batches on either side", async () => {
  const room = roomCounter++;
  const user = `live-queue-${room}`;
  const { runId, job } = await seedManualScan(user, room, STREAM_SOURCE_COUNT);
  let scanCalls = 0;

  await scan(job, {
    ingestUrl: async (url: string) => ({ text: pageText(url), titleHint: "Agenda", extras: [] }),
    grokChat: async (system: string) => {
      if (system === SAME_STORY_SYSTEM || system === DUP_CHECK_SYSTEM)
        return { ok: true as const, text: "[]" };
      scanCalls += 1;
      if (scanCalls === 2) return { ok: false as const, error: "Middle scan batch failed." };
      return {
        ok: true as const,
        text: JSON.stringify({
          leads: scanCalls === 1 ? [STREAM_BATCH_ONE_LEAD] : scanCalls === 3 ? [STREAM_BATCH_THREE_LEAD] : [],
          proposed_sources: [],
          editor_summary: `Batch ${scanCalls}.`,
        }),
      };
    },
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
  });

  const sql = await getSql();
  const filed = await sql<{ headline: string }>`
    select headline from leads where scan_run_id = ${runId} order by id
  `;
  const [receipt] = await sql<{ model_batches_used: number; model_batches_failed: number; leads_created: number }>`
    select model_batches_used, model_batches_failed, leads_created from scan_runs where id = ${runId}
  `;
  assert.equal(scanCalls, 3);
  assert.deepEqual(filed.map((row) => row.headline), [
    STREAM_BATCH_ONE_LEAD.headline,
    STREAM_BATCH_THREE_LEAD.headline,
  ]);
  assert.deepEqual(receipt, { model_batches_used: 3, model_batches_failed: 1, leads_created: 2 });
});
