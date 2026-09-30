import { before, after, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSql } from "../db.ts";
import { setFetchImplForTests } from "./fetch-url.ts";
import { ingestUrl } from "./ingest.ts";
import { sha256 } from "./url-guard.ts";
import { ensureJobsSchema, type DeskJob } from "./jobs.ts";
import type { SectionScanSnapshot } from "./section-types.ts";
import { scanSourceExcerpt } from "./scan-source-excerpt.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

// This test executes desk.ts itself. Resolve its Vite alias/extensionless imports
// inside this isolated Node test process; no production loader is changed.
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
const marker = "SCHOOLS_AFTER_EIGHT_HUNDRED_CHARACTERS";
const body =
  "A local public report. ".repeat(60) + marker + " Important schools detail. ".repeat(30);
let roomCounter = 8810;
before(async () => {
  // `migrations/*.sql` is applied to this database before the file loads
  // (U18a-1, src/lib/test-support/pglite-migrations.ts). The hand replay that
  // used to stand in for Node's missing Vite migration glob is gone: a second
  // application re-runs the unguarded seed inserts several migrations carry.
  scan = (await import("./desk.ts")).performScanWork;
  setFetchImplForTests(
    async () => new Response(body, { headers: { "content-type": "text/plain" } }),
  );
});
after(() => {
  setFetchImplForTests(null);
  hooks.deregister();
});
async function modelPack(
  section: boolean,
  priorSection: boolean,
  priorGeneral = false,
  changed = false,
  attachment = false,
) {
  const sql = await getSql();
  const room = roomCounter++;
  const user = `scan-scope-${room}`;
  const url = `https://93.184.216.34/scope-${room}`;
  const text = (await ingestUrl(url)).text;
  assert.ok(text.indexOf(marker) > 800 && text.indexOf(marker) < 2800);
  const [source] = await sql<{
    id: number;
  }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status,last_hash)
    values(${user},${room},${url},'Shared report','page','A','accepted',${changed ? "older-content-hash" : await sha256(text)}) returning id`;
  const snapshot: SectionScanSnapshot = {
    key: "schools",
    name: "Schools",
    brief: "Look for school details",
    instructions: "Read the whole available excerpt",
    sourceIds: [source.id],
    revision: 2,
  };
  await sql`insert into scan_runs(user_id,newsroom_id,section_snapshot,finished_at,sources_fetched,leads_created,started_at)
    values(${user},${room},${priorSection ? JSON.stringify({ ...snapshot, brief: "Older brief", revision: 1 }) : null},now(),1,1,now()-interval '2 minutes')`;
  if (priorGeneral)
    await sql`insert into scan_runs(user_id,newsroom_id,finished_at,sources_fetched,leads_created,started_at)
    values(${user},${room},now(),1,1,now()-interval '1 minute')`;
  const [run] = await sql<{
    id: number;
  }>`insert into scan_runs(user_id,newsroom_id,section_snapshot)
    values(${user},${room},${section ? JSON.stringify(snapshot) : null}) returning id`;
  await ensureJobsSchema();
  const claimToken = `scan-cache-claim-${room}`;
  const [jobRow] = await sql<{ id: number }>`
    insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token)
    values(${room},${user},'scan',${run.id},'grok','editor','default','running','Working',${claimToken})
    returning id
  `;
  let pack = "";
  await scan(
    {
      id: jobRow.id,
      user_id: user,
      newsroom_id: room,
      subject_id: run.id,
      model_choice: "grok",
      model_choice_source: "editor",
      claim_token: claimToken,
    } as DeskJob,
    {
      ...(attachment
        ? {
            ingestUrl: async (requested: string) =>
              requested.endsWith("/packet.pdf")
                ? {
                    text: "PACKET_ONLY_FACT: The board will consider expanded after-school places on September 15.",
                    titleHint: "School board packet",
                    extras: [],
                  }
                : {
                    text: "Public meeting archive and navigation. ".repeat(160),
                    titleHint: "Shared report",
                    extras: [url + "/packet.pdf"],
                  },
          }
        : {}),
      grokChat: async (_system, userMessage) => {
        pack = userMessage;
        return {
          ok: true,
          text: JSON.stringify({
            leads: [],
            proposed_sources: [],
            editor_summary: "QA scoped read",
          }),
        };
      },
      setJobStage: async () => {},
      setJobModelChoice: async () => {},
    },
  );
  await sql`update desk_jobs set status='completed',finished_at=now(),claim_token=null where id=${jobRow.id}`;
  assert.ok(pack.includes("SOURCE: Shared report"), "actual fetched source must reach the model");
  return pack;
}
it("first section scan expands unchanged sources previously read by General", async () => {
  assert.ok((await modelPack(true, false)).includes(marker));
});
it("changed section brief still receives the expanded excerpt", async () => {
  assert.ok((await modelPack(true, true)).includes(marker));
});
it("General cannot trust shared hashes even after a later General run", async () => {
  assert.ok((await modelPack(false, true, true)).includes(marker));
});
it("General-only newsrooms retain the unchanged-source optimization", async () => {
  assert.ok(!(await modelPack(false, false)).includes(marker));
});
it("expanded section excerpts preserve the actual changed-source signal", async () => {
  const pack = await modelPack(true, false, false, true);
  assert.match(pack, /CHANGED: yes; expanded excerpt for this scan scope/);
  assert.ok(pack.includes(marker));
});
it("a fetched attachment reaches the scan model even after a long parent page", async () => {
  const pack = await modelPack(true, false, false, true, true);
  assert.match(pack, /DOCUMENT https:\/\/93\.184\.216\.34\/scope-\d+\/packet\.pdf/);
  assert.match(pack, /PACKET_ONLY_FACT/);
  assert.match(pack, /Public meeting archive and navigation/);
});
it("four fetched documents keep separate attribution within either existing scan budget", () => {
  const extras = Array.from({ length: 4 }, (_, i) => ({
    url: `https://example.org/packet-${i}.pdf`,
    text: `DOCUMENT_FACT_${i}. ` + "More captured evidence. ".repeat(200),
  }));
  for (const budget of [800, 2800]) {
    const excerpt = scanSourceExcerpt(
      "PARENT_FACT. " + "Parent page text. ".repeat(200),
      extras,
      budget,
    );
    assert.ok(excerpt.length <= budget);
    assert.match(excerpt, /Partial excerpts/);
    assert.match(excerpt, /PARENT_FACT/);
    for (const [i, extra] of extras.entries()) {
      assert.ok(excerpt.includes(`DOCUMENT ${extra.url}\nEXCERPT:\nDOCUMENT_FACT_${i}`));
    }
  }
});

const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);
type NulScanFixture = {
  sourceText?: string;
  fetchError?: string;
  generalScope?: boolean;
  throwAtBatchBoundary?: boolean;
  throwAfterFirstModelCallAtBatchBoundary?: boolean;
  sourceCount?: number;
  failFirstBatch?: boolean;
  supersedeClaimBeforeCommit?: boolean;
  response?: Record<string, unknown>;
};

async function runNulScanFixture(input: NulScanFixture) {
  const sql = await getSql();
  const room = roomCounter++;
  const user = `scan-nul-${room}`;
  const sourceIds: number[] = [];
  const sourceCount = input.sourceCount ?? 1;
  for (let i = 0; i < sourceCount; i += 1) {
    const [source] = await sql<{ id: number }>`
      insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values(${user},${room},${`https://example.org/scan-nul-${room}-${i}`},${`NUL fixture ${i + 1}`},'official','A','accepted')
      returning id
    `;
    sourceIds.push(source.id);
  }
  const [run] = await sql<{ id: number }>`
    insert into scan_runs(user_id,newsroom_id,section_snapshot)
    values(${user},${room},${input.generalScope ? null : JSON.stringify({ kind: "custom", sourceIds })})
    returning id
  `;
  await ensureJobsSchema();
  const claimToken = `scan-nul-claim-${room}`;
  const [jobRow] = await sql<{ id: number }>`
    insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token)
    values(${room},${user},'scan',${run.id},'grok','editor','default','running','Working',${claimToken})
    returning id
  `;
  let modelPrompt = "";
  let modelCalls = 0;
  let guardCalls = 0;
  let error: unknown;
  try {
    await scan(
      {
        id: jobRow.id,
        user_id: user,
        newsroom_id: room,
        subject_id: run.id,
        model_choice: "grok",
        model_choice_source: "editor",
        claim_token: claimToken,
      } as DeskJob,
      {
        ingestUrl: async () => {
          if (input.fetchError) throw new Error(input.fetchError);
          return { text: input.sourceText ?? "Council votes Tuesday on a water contract.", titleHint: "Council", extras: [] };
        },
        grokChat: async (_system, userMessage) => {
          modelCalls += 1;
          modelPrompt = userMessage;
          if (input.failFirstBatch && modelCalls === 1)
            return { ok: false as const, error: "First analysis batch failed." };
          return {
            ok: true,
            text: JSON.stringify(input.response ?? {
              leads: [],
              proposed_sources: [],
              editor_summary: "The scan finished.",
            }),
          };
        },
        setJobStage: async () => {},
        setJobModelChoice: async () => {},
        scheduledGuard: async () => {
          guardCalls += 1;
          if (input.throwAtBatchBoundary && guardCalls === 3)
            throw new Error("Injected worker failure before the model call.");
          if (input.throwAfterFirstModelCallAtBatchBoundary && modelCalls === 1)
            throw new Error("Injected worker failure before the second model call.");
        },
        beforeScheduledCommit: async () => {
          if (input.supersedeClaimBeforeCommit)
            await sql`update desk_jobs set claim_token='new-worker-lease', updated_at=clock_timestamp() where id=${jobRow.id}`;
        },
      },
    );
  } catch (caught) {
    error = caught;
  }
  await sql`
    update desk_jobs set status='failed',error='fixture complete',finished_at=now(),claim_token=null
    where id=${jobRow.id} and claim_token=${claimToken}
  `;
  const [scanRun] = await sql<{
    finished_at: string | null;
    sources_selected: number;
    sources_attempted: number;
    sources_fetched: number;
    sources_failed: number;
    sources_analyzed: number;
    model_batches_used: number;
    model_batches_failed: number;
    failed_sources: string | null;
    error: string | null;
    summary: string | null;
    leads_created: number;
  }>`
    select finished_at,sources_selected,sources_attempted,sources_fetched,sources_failed,
      sources_analyzed,model_batches_used,model_batches_failed,failed_sources,error,summary,
      leads_created
    from scan_runs where id=${run.id}
  `;
  const [lead] = await sql<{ headline: string; why: string; evidence: string; topic: string }>`
    select headline,why,evidence,topic from leads where scan_run_id=${run.id} order by id limit 1
  `;
  const [savedSource] = await sql<{ last_error: string | null }>`
    select last_error from sources where id=${sourceIds[0]}
  `;
  const [snapshot] = await sql<{ excerpt: string }>`
    select excerpt from snapshots where source_id=${sourceIds[0]} order by id desc limit 1
  `;
  const [jobAfter] = await sql<{ status: string; claim_token: string | null }>`
    select status,claim_token from desk_jobs where id=${jobRow.id}
  `;
  return { error, modelPrompt, modelCalls, scanRun, lead, savedSource, snapshot, jobAfter };
}

it("normalizes NUL in fetched source text before the transactional snapshot write", async () => {
  const result = await runNulScanFixture({
    sourceText: `Council votes Tuesday on a water contract.${NUL} Agenda item 7.`,
  });
  assert.equal(result.error, undefined, `scan should finish: ${String(result.error)}`);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.sources_selected, 1);
  assert.equal(result.scanRun.sources_attempted, 1);
  assert.equal(result.scanRun.sources_fetched, 1);
  assert.equal(result.scanRun.sources_failed, 0);
  assert.equal(result.scanRun.sources_analyzed, 1);
  assert.equal(result.scanRun.model_batches_used, 1);
  assert.equal(result.modelCalls, 1);
  assert.ok(result.modelPrompt.includes(REPLACEMENT));
  assert.ok(!result.modelPrompt.includes(NUL));
  assert.ok(result.snapshot?.excerpt.includes(REPLACEMENT));
  assert.ok(!result.snapshot?.excerpt.includes(NUL));
});

it("settles a default General scan through the same NUL-safe result path", async () => {
  const result = await runNulScanFixture({
    generalScope: true,
    sourceText: `Council votes Tuesday on a water contract.${NUL} Agenda item 7.`,
  });
  assert.equal(result.error, undefined, `General scan should finish: ${String(result.error)}`);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.sources_selected, 1);
  assert.equal(result.scanRun.sources_fetched, 1);
  assert.equal(result.scanRun.sources_analyzed, 1);
  assert.ok(result.snapshot?.excerpt.includes(REPLACEMENT));
  assert.ok(!result.snapshot?.excerpt.includes(NUL));
});

it("keeps a NUL-bearing source-specific fetch failure in the settled scan receipt", async () => {
  const failure = `upstream parser failed${NUL} while reading the page`;
  const result = await runNulScanFixture({ fetchError: failure });
  assert.ok(result.error instanceof Error);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.sources_selected, 1);
  assert.equal(result.scanRun.sources_attempted, 1);
  assert.equal(result.scanRun.sources_fetched, 0);
  assert.equal(result.scanRun.sources_failed, 1);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.savedSource.last_error, failure.replace(NUL, REPLACEMENT));
  const [sourceFailure] = JSON.parse(result.scanRun.failed_sources ?? "[]") as {
    title: string;
    error: string;
  }[];
  assert.equal(sourceFailure?.title, "NUL fixture 1");
  assert.equal(sourceFailure?.error, failure.replace(NUL, REPLACEMENT));
  assert.ok(result.scanRun.error?.includes(failure.replace(NUL, REPLACEMENT)));
});

it("settles the manual run when the worker throws before its result transaction", async () => {
  const result = await runNulScanFixture({ throwAtBatchBoundary: true });
  assert.ok(result.error instanceof Error);
  assert.match(result.error.message, /Injected worker failure before the model call/);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.sources_selected, 1);
  assert.equal(result.scanRun.sources_attempted, 1);
  assert.equal(result.scanRun.sources_fetched, 1);
  assert.equal(result.scanRun.sources_failed, 0);
  assert.equal(result.scanRun.sources_analyzed, 0);
  assert.equal(result.scanRun.model_batches_used, 0);
  assert.equal(result.modelCalls, 0);
  assert.ok(result.scanRun.error?.includes("Injected worker failure before the model call"));
});

it("counts only started model batches when failure interrupts the next batch boundary", async () => {
  const result = await runNulScanFixture({
    sourceCount: 41,
    throwAfterFirstModelCallAtBatchBoundary: true,
  });
  assert.ok(result.error instanceof Error);
  assert.match(result.error.message, /before the second model call/);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.sources_selected, 41);
  assert.equal(result.scanRun.sources_fetched, 41);
  assert.equal(result.scanRun.sources_analyzed, 40, "the first batch should have completed");
  assert.equal(result.modelCalls, 1, "one model call must precede the second-boundary failure");
  assert.equal(result.scanRun.model_batches_used, 1);
  assert.equal(result.scanRun.model_batches_failed, 0);
});

it("counts successful later batches when an earlier batch fails", async () => {
  const result = await runNulScanFixture({ sourceCount: 41, failFirstBatch: true });
  assert.equal(result.error, undefined, `partial scan should settle: ${String(result.error)}`);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.sources_selected, 41);
  assert.equal(result.scanRun.sources_attempted, 41);
  assert.equal(result.scanRun.sources_fetched, 41);
  assert.equal(result.scanRun.model_batches_used, 2);
  assert.equal(result.scanRun.model_batches_failed, 1);
  assert.equal(result.scanRun.sources_analyzed, 1, "only the final one-source batch succeeded");
  assert.ok(result.scanRun.summary?.includes("1 of 2 analysis batches failed"));
});

it("stores a model-written lead whose headline carries a NUL instead of losing the run", async () => {
  /*
    This test used to assert the opposite: that a NUL in the model's headline
    failed the result write, settled the run and left `0x00` in its error
    column. That was an accurate description of the defect -- one byte in one
    field rolled back every lead the run had found -- written up as though the
    settling were the point. SCAN-001 fixes the defect, so the assertion moves
    to the outcome the desk wants: the run completes and the stored lead is the
    model's sentence with the byte gone.
  */
  const result = await runNulScanFixture({
    response: {
      leads: [
        {
          headline: `Council approves the contract${NUL}`,
          why: `The vote is Tuesday.${NUL}`,
          topic: "council",
          source_urls: ["https://example.org/agenda"],
          evidence: `Council approved the contract.${NUL}`,
          newsworthiness: 10,
        },
      ],
      proposed_sources: [],
      editor_summary: `The council approved the contract.${NUL}`,
    },
  });
  assert.equal(result.error, undefined, `NUL-bearing model text must not fail the run: ${String(result.error)}`);
  assert.ok(result.scanRun.finished_at);
  assert.equal(result.scanRun.leads_created, 1);
  assert.equal(result.scanRun.sources_selected, 1);
  assert.equal(result.scanRun.sources_attempted, 1);
  assert.equal(result.scanRun.sources_fetched, 1);
  assert.equal(result.scanRun.sources_failed, 0);
  assert.equal(result.scanRun.sources_analyzed, 1);
  assert.equal(result.scanRun.error, null);
  assert.equal(result.scanRun.summary, "The council approved the contract.");
  assert.deepEqual(result.lead, {
    headline: "Council approves the contract",
    why: "The vote is Tuesday.",
    evidence: "Council approved the contract.",
    topic: "council",
  });
  assert.ok(result.snapshot, "the successful run still writes its snapshot");
});

it("does not let a superseded scan claim commit results or settle its run", async () => {
  const result = await runNulScanFixture({ supersedeClaimBeforeCommit: true });
  assert.ok(result.error instanceof Error);
  assert.match(result.error.message, /claim was superseded/);
  assert.equal(result.scanRun.finished_at, null, "the newer claim owns the still-open run");
  assert.equal(result.scanRun.error, null);
  assert.equal(result.snapshot, undefined, "stale result writes must roll back");
  assert.equal(result.jobAfter.status, "running");
  assert.equal(result.jobAfter.claim_token, "new-worker-lease");
});
