
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { ensureReportingSchema, loadLeadReportingPackage, loadReportingRequest } from "./civic-reporting.server.ts";
import { performReportingWork, fileRunLeads, loadMethodInstructions, normalizeClaims, normalizeScore, readJsonBlock, seedUrlsOf, loadScopedObservations, gatherIndependentSources, furtherResearchPass, resolveModel } from "./civic-reporting-run.server.ts";
import {
  FIXTURE_VIDEO,
  coldReplyColdOnly, ingestDouble, passChat,
  researchDouble, seedMeetingFixture, seedScopedLead,
  warmReplyWarmOnly, writerReply,
  seedClaimedJob, cancelSeededJob, reclaimSeededJob,
  contraryMalformedReply, contraryRepairReply, contraryRepairStillBadReply,
} from "./civic-reporting-fixtures.test-helper.ts";
import { resolveMeetingIdentity, loadWholeRecord } from "./civic-reporting-meeting.server.ts";
import {
  reconcileLedgers, canonicalVote, fallbackOpenQuestions, documentDigest, contraryPass, scoringPass, bindClaimsToEvidence,
  type DocumentRead,
  writingPass, writerLengthProblems, financialRelationshipProblems, reassessContraryAfterResearch, bindStoryClaimsToEvidence, loadMethodInstructions as loadMethodForPrompt,
  retainedRecordingNote, validatePacketSources, canonicalModelReceipt, writerDecisionWindowEvidence,
  reviewOpenStoryClaims,
} from "./civic-reporting-run.server.ts";
import type { CoverageAction } from "./civic-reporting.ts";
import { reportingStoryReviewClaims } from "./reporting-evidence-adapter.ts";
import { evidenceCheckRows } from "./evidence-check-list.ts";
import { firstSentenceForDek } from "./dek-fallback.ts";
import { publishBlockers } from "./publish-blockers.ts";
import type { Sql } from "../db.ts";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { JobCancelledError } from "./jobs.ts";
import type { DeskJob } from "./jobs.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import type { DeskResearchDeps, DeskResearchInput, DeskResearchOutcome } from "./editorial-research.server.ts";

/* ... file doc ... */
await applyMigrationsToTestPglite();

const NEWSROOM = 947;
const USER = "civic-reporting-runner-test";

it("checks the editor's explicit story word range without counting evidence metadata", () => {
  const words = (count: number) => Array(count).fill("word").join(" ");
  assert.equal(writerLengthProblems({ stories: [{ draft: words(400), cannotSay: words(500) }] }, "Develop a 400–800 word story.").length, 0);
  assert.equal(writerLengthProblems({ stories: [{ draft: words(800) }] }, "Develop a 400-800-word story.").length, 0);
  assert.match(writerLengthProblems({ stories: [{ draft: words(1086) }] }, "Develop a 400–800 word story.")[0]!, /1086 words.*400–800/);
  assert.equal(writerLengthProblems({ stories: [{ draft: words(399) }] }, "Develop a 400—800 word story.").length, 1);
  assert.deepEqual(writerLengthProblems({ stories: [{ draft: words(1086) }] }, "Develop a substantial story."), [], "no assistant-chosen length limit");
});

it("does not turn an exact fund-table equality into an appropriation relationship", () => {
  const documents = [{ url: "https://city.example/budget.pdf", ok: true, title: "PIF changes", reason: "", text: "PUBLIC IMPROVEMENT FUND CHANGES\nRevenue Changes\n$672,625 reduction in transfers from General Fund\nExpense Changes\n$1,646,233 reduction in expense set aside for TRP131\n$973,608 reduction in use of fund balance" }];
  const packet = (draft: string) => ({ stories: [{ draft }] });
  assert.equal(financialRelationshipProblems(packet("Residents should read them as two line items in one fund-balance adjustment, not as $2.3 million of new spending."), documents).length, 1, "actual replay-b assertion is not proved by the equality");
  assert.equal(financialRelationshipProblems(packet("Adding these amounts would double-count one flow of money."), documents).length, 1);
  assert.equal(financialRelationshipProblems(packet("The relationship remains unclear; the records do not establish separate appropriations."), documents).length, 0, "preserve a candid qualification");
  assert.equal(financialRelationshipProblems(packet("Whether the two amounts are separate spending, overlapping, or one flow counted on two sides of a fund boundary is not stated in the documents, so this story does not add them together."), documents).length, 0, "actual corrected replay-c wording expresses an unanswered question, not an assertion of overlap");
  const direct = "These appropriations overlap because the transfer funds the project appropriation.";
  assert.equal(financialRelationshipProblems(packet(direct), [{ ...documents[0]!, text: direct }]).length, 0, "a direct documentary statement is distinct from calculated equality");
});

before(async () => {
  const sql = await getSql();
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [NEWSROOM, "Runner test room"]);
  await ensureReportingSchema(sql);
});

/*
  A REAL claimed desk_jobs row for this request -- NOT an in-memory stub. The
  run now files behind a `for update` fence that asserts the job row's own
  status, claim token and cancel flag, so a fake `id: 0` job can never pass it
  and weakening the fence to admit one would be the wrong repair. Every filing
  (and every fenced FAILED write) therefore seeds the row the fence will lock.

  `over.user_id` is honoured by seeding the row as that user, which is how the
  "another editor's request" case gets a real row owned by someone else.
*/
async function claimedJobFor(requestId: number, over: Partial<DeskJob> = {}): Promise<DeskJob> {
  const job = await seedClaimedJob(await getSql(), {
    requestId,
    researchScope: (over.research_scope as "public" | "supplied" | undefined),
    resultJson: over.result_json ?? undefined,
  });
  if (over.user_id) {
    const sql = await getSql();
    await sql`update desk_jobs set user_id = ${over.user_id} where id = ${job.id}`;
    job.user_id = over.user_id;
  }
  return job;
}

async function newRequest(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into reporting_requests
      (user_id, newsroom_id, request_kind, lead_id, action, assignment, seed_urls, model_choice, method_version)
    values (
      ${USER}, ${NEWSROOM}, ${(over.request_kind as string) ?? "assignment"},
      ${(over.lead_id as number | null) ?? null}, ${(over.action as string) ?? "Report this meeting"},
      ${(over.assignment as string) ?? "Report the Sept. 29 council meeting"},
      ${JSON.stringify(over.seed_urls ?? [])}::jsonb, ${(over.model_choice as string) ?? "auto"}, ${"2.6.0"}
    ) returning id
  `;
  return Number(row!.id);
}

/**
 * Where the installed civic-scanner method actually lives. `resolveCivicMethodDir`
 * prefers a configured dir, then a packaged one, then the known install; the
 * real resolver already finds it, so this is the SAME call the runner makes. A
 * machine with no method exercises the FAILED path instead, and the run tests
 * below skip rather than pretend.
 */
import { resolveCivicMethodDir } from "./civic-reporting.server.ts";
const installedMethod = resolveCivicMethodDir();
const haveMethod = installedMethod.complete;

/** The runner's real method resolver -- no stub, so the run reads real files. */
function methodDeps() {
  return { resolveMethodDir: () => resolveCivicMethodDir() };
}

/** Add the explicit unknown artifact-version value omitted by the shared fixture helper. */
function researchWithCaptureVersionIds(): (
  input: DeskResearchInput,
  deps?: DeskResearchDeps,
) => Promise<DeskResearchOutcome> {
  const run = researchDouble();
  return async () => {
    const outcome = await run();
    return {
      ...outcome,
      captures: outcome.captures.map((capture) => ({ ...capture, versionId: null })),
    };
  };
}

describe("readJsonBlock and the normalizers hold the method rules", () => {
  it("reads a fenced or bare JSON object and refuses junk", () => {
    assert.deepEqual(readJsonBlock<{ a: number }>("```json\n{\"a\":1}\n```"), { a: 1 });
    assert.deepEqual(readJsonBlock<{ a: number }>("noise {\"a\":2} tail"), { a: 2 });
    assert.equal(readJsonBlock("no braces at all"), null);
    assert.equal(readJsonBlock(""), null);
  });

  it("downgrades a VERIFIED claim that resolves to no Tier A source", () => {
    const sources = [
      { id: "S1", title: "A blog", tier: "C" as const, url: "https://blog.example/x", locator: "", offlineReference: "" },
    ];
    const claims = normalizeClaims(
      [{ id: "C1", text: "The vote passed", status: "VERIFIED", sourceIds: ["S1"], nextCheck: "" }],
      sources,
    );
    assert.equal(claims[0]!.status, "UNVERIFIED");
    assert.match(claims[0]!.nextCheck, /Tier A/);

    const withA = normalizeClaims(
      [{ id: "C1", text: "The vote passed", status: "VERIFIED", sourceIds: ["S1"], nextCheck: "" }],
      [{ id: "S1", title: "Minutes", tier: "A" as const, url: "https://city.example/minutes.pdf", locator: "p.2", offlineReference: "" }],
    );
    assert.equal(withA[0]!.status, "VERIFIED");
  });

  it("refuses a source with neither a URL nor an offline reference", () => {
    const claims = normalizeClaims([{ id: "C1", text: "x", status: "VERIFIED", sourceIds: ["S9"] }], []);
    assert.equal(claims[0]!.status, "UNVERIFIED");
    assert.deepEqual(claims[0]!.sourceIds, []);
  });

  it("treats an all-zero score as unscored, not as a low score", () => {
    assert.equal(normalizeScore({ immediacy: 0, impact: 0, conflict: 0, novelty: 0 }), null);
    const scored = normalizeScore({ immediacy: 3, impact: 4, conflict: 2, novelty: 5, whyItMatters: "w" });
    assert.equal(scored!.total, 14);
  });

  it("parses seed URLs from an array or a JSON string", () => {
    assert.deepEqual(seedUrlsOf({ seed_urls: ["https://a", " https://b " ] }), ["https://a", "https://b"]);
    assert.deepEqual(seedUrlsOf({ seed_urls: "[\"https://c\"]" }), ["https://c"]);
    assert.deepEqual(seedUrlsOf({ seed_urls: "not json" }), []);
  });
});

describe("loadMethodInstructions reports a precise gap for a missing method", () => {
  it("names every missing file rather than claiming the method", () => {
    const loaded = loadMethodInstructions("C:/definitely/not/a/method/dir");
    assert.equal(loaded.complete, false);
    assert.equal(loaded.files.length, 0);
    assert.ok(loaded.missing.length >= 4);
  });
});

describe("performReportingWork: the run", () => {
  it("fails loudly when the civic-scanner method is not installed", async () => {
    const requestId = await newRequest();
    const sql = await getSql();
    const pin = initialModelRuntimeReceipt({
      requestedRuntime: "auto",
      requestedEffort: "none",
      actualRuntime: "local-model",
      actualEffort: "none",
      localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
    });
    await sql`update reporting_requests set model_receipt = ${JSON.stringify(pin)}::jsonb where id = ${requestId}`;
    const job = await claimedJobFor(requestId, { result_json: JSON.stringify(pin) });
    await assert.rejects(
      performReportingWork(job, {
        resolveMethodDir: () => ({ dir: "C:/no/such/dir", source: "none", complete: false, missing: ["SKILL.md"] }),
        probe: (async () => ({ ok: true, label: "LLM", choice: "local-model" })) as never,
      }),
    );
    const row = await loadReportingRequest(sql, requestId, NEWSROOM);
    assert.ok(row, "the failed request remains loadable");
    assert.equal(row.run_status, "FAILED");
    assert.match(row.run_note, /not installed/);
    assert.equal(row.error !== null, true);
    const [storedReceipt] = await sql<{ model_receipt: string }>`
      select model_receipt::text as model_receipt from reporting_requests where id = ${requestId}
    `;
    assert.ok(storedReceipt, "the failure retained its runtime receipt");
    const failureReceipt = JSON.parse(storedReceipt.model_receipt) as Record<string, unknown>;
    assert.equal(failureReceipt.actualRuntime, "local-model", "FAILED retains its enqueue runtime pin");
    assert.equal(failureReceipt.modelEffort, "none", "FAILED retains off/none effort");
    assert.deepEqual(failureReceipt.localModel, pin.localModel, "FAILED retains the exact model and endpoint");
  });

  it("stops at a cancellation boundary without filing a package", { skip: !haveMethod }, async () => {
    const requestId = await newRequest();
    const sql = await getSql();
    await assert.rejects(
      performReportingWork(await claimedJobFor(requestId), {
        ...methodDeps(),
        throwIfCancelled: async () => { throw new JobCancelledError(); },
      }),
      (err: unknown) => err instanceof JobCancelledError,
    );
    const row = await loadReportingRequest(sql, requestId, NEWSROOM);
    assert.equal(row!.run_status, "PENDING", "a cancelled run does not overwrite its request");
  });

  it("runs the full method offline: real files, whole tape, a saved package", { skip: !haveMethod }, async () => {
    // guards: a newly filed draft could lose its readiness state before the editor opens it.
    // A REAL scoped meeting. The lead names artifact 39 / video zMglXtVlIMA, so
    // the run resolves the meeting from the LEAD ARTIFACT -- the first seed is a
    // budget PDF and must not be treated as the recording.
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const modelPin = initialModelRuntimeReceipt({
      requestedRuntime: "auto",
      requestedEffort: "none",
      actualRuntime: "local-model",
      actualEffort: "none",
      localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
    });
    const requestId = await newRequest({
      lead_id: leadId,
      seed_urls: ["https://city.example/budget-2027.pdf", "https://youtu.be/zMglXtVlIMA"],
    });
    await sql`update reporting_requests set model_receipt = ${JSON.stringify(modelPin)}::jsonb where id = ${requestId}`;
    const job = await claimedJobFor(requestId, { result_json: JSON.stringify(modelPin) });
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-runner-"));
    const routes: string[] = [];
    try {
      await performReportingWork(job, {
        ...methodDeps(),
        workspaceRoot,
        ingest: ingestDouble("Sept. 29 council packet. Item 6A: airport-noise contract, $733,170."),
        runResearch: researchWithCaptureVersionIds(),
        chat: (async (system: string, prompt: string, _maxTokens: number, opts: { reasoningEffort?: string; effort?: string }) => {
          assert.equal(opts.reasoningEffort, "none", "every reporting stage sends its saved effort through the transport's actual option");
          assert.equal(opts.effort, undefined, "the ignored transport option must not silently replace the saved pin");
          return passChat({ count: (route) => routes.push(route) })(system, prompt);
        }) as never,
        probe: async () => ({
          ok: true, label: "LLM", choice: "local-model",
          localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "probe-model" },
        }) as never,
      });

      // The method actually routed through its independent passes, not one call.
      for (const pass of ["warm", "cold", "contrary", "scoring", "writer"]) {
        assert.ok(routes.includes(pass), "the " + pass + " pass ran");
      }
      assert.ok(routes.includes("reassessment"), "new research is checked against earlier contrary findings before scoring/writing");
      assert.ok(routes.filter((r) => r === "warm").length >= 1, "the warm pass read every tape window");
      assert.ok(routes.filter((r) => r === "cold").length >= 1, "the cold pass re-read the tape independently");

      const row = await loadReportingRequest(sql, requestId, NEWSROOM);
      assert.equal(row!.run_status, "COMPLETE", row!.run_note);
      assert.ok(row!.workspace_dir.includes("request-" + requestId), "a durable workspace was written");

      const [pkgRow] = await sql<{ lead_id: number; draft_id: number | null; package: unknown }>`
        select lead_id, draft_id, package from reporting_packages where request_id = ${requestId}
      `;
      assert.ok(pkgRow, "a package row exists");
      // The assignment retained its lead; a new draft was written against it.
      assert.equal(Number(pkgRow!.lead_id), leadId, "the run kept the assignment's own lead");
      const readBack = await loadLeadReportingPackage(sql, Number(pkgRow!.lead_id), NEWSROOM);
      assert.ok(readBack, "the package reads back through the story route's helper");
      const pkg = readBack!.pkg;
      assert.ok(pkg.stories.length >= 1, "at least one substantial story was written");
      assert.ok(pkg.stories[0]!.draft.length >= 600, "the draft is substantial, not a scan excerpt");
      assert.ok(pkg.actions.length >= 1, "the reconciled action ledger is non-empty");
      assert.equal(pkg.coverageComplete, true, "coverage was earned, not parsed");
      assert.equal(pkg.runStatus, "COMPLETE");
      assert.ok(pkg.score && pkg.score.total > 0, "the lead was scored on the four components");
      // A claim the tape supports under its own item survives the code binding.
      assert.equal(pkg.stories[0]!.claims[0]!.status, "VERIFIED", pkg.stories[0]!.claims[0]!.nextCheck);
      assert.equal(readBack!.draftId !== null, true, "the copy is saved as a new draft");
      const [draftRow] = await sql<{ research_json: unknown; dek: string }>`
        select research_json, dek from drafts where id = ${readBack!.draftId}
      `;
      const research = typeof draftRow!.research_json === "string"
        ? JSON.parse(draftRow!.research_json)
        : draftRow!.research_json as Record<string, unknown>;
      const readiness = (research as Record<string, unknown>).storyReadiness as Record<string, unknown>;
      assert.equal(readiness?.version, 1);
      assert.equal(readiness?.state, "verified");
      assert.equal(readiness?.openCount, 0);
      // guards: a filed story could show the writer's 114-word brief as its reader-facing dek.
      assert.equal(draftRow!.dek, pkg.stories[0]!.dek);
      assert.equal(pkg.receipt.requestedRuntime, "auto", "the package keeps the enqueued runtime");
      assert.equal(pkg.receipt.requestedEffort, "none", "the package keeps the requested effort");
      assert.equal(pkg.receipt.actualRuntime, "local-model", "the package keeps the answering runtime");
      assert.equal(pkg.receipt.modelEffort, "none", "the package keeps the exact OFF effort");
      assert.equal(pkg.receipt.modelId, "deepseek-v4.1-flash:cloud", "the pinned model wins over the probe's model");
      assert.equal(pkg.receipt.modelEndpoint, "http://127.0.0.1:11434/v1", "the pinned endpoint wins over the probe's endpoint");
      assert.equal(pkg.receipt.runtimeProvider, "Ollama");
      assert.equal(pkg.receipt.modelLabel, "DeepSeek v4.1 Flash", "the panel does not receive a generic LLM label");

      const [jobRow] = await sql<{ result_json: string | null }>`
        select result_json from desk_jobs where id = ${job.id}
      `;
      const terminal = JSON.parse(jobRow!.result_json || "{}") as Record<string, unknown>;
      assert.equal(terminal.actualRuntime, "local-model", "terminal filing preserves the canonical runtime pin");
      assert.equal(terminal.requestedEffort, "none", "terminal filing preserves the requested effort");
      assert.equal(terminal.modelEffort, "none", "terminal filing preserves the exact OFF effort");
      assert.deepEqual(terminal.localModel, modelPin.localModel, "terminal filing preserves exact model id and endpoint");
      assert.deepEqual(terminal.leadIds, [leadId], "terminal filing pointers coexist with the model pin");
      assert.ok(Array.isArray(terminal.filed) && terminal.filed.length === 1, "filed result coexists with the pin");

      // The new source the discovery pass opened was proposed through the real door,
      // and the dispositions were saved as observations for the next assignment.
      const observations = await sql<{ kind: string; n: number }>`
        select kind, count(*)::int as n from reporting_observations
        where request_id = ${requestId} group by kind
      `;
      const total = observations.reduce((sum, row) => sum + Number(row.n), 0);
      assert.ok(total >= 2, "a source observation and a disposition observation were saved");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("files the readable budget draft when a later claim check returns no result", { skip: !haveMethod }, async () => {
    // guards: the editor could lose a readable budget draft when a later writer check fails.
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const job = await claimedJobFor(requestId);
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-later-writer-failure-"));
    const headline = "Longmont’s proposed budget trims energy work as transit funding needs emerge";
    const openReason = "The raw passage establishes an announced 6–1 result. The missing continuous interval prevents establishing that the adopted airport-fee motion retained the earlier wording and schedule.";
    const run6Draft = readFileSync(new URL("./fixtures/civic-reporting-run6-budget-story.md", import.meta.url), "utf8")
      .replace(/^#[^\r\n]*\r?\n+/, "")
      .trim();
    const story = {
      id: "LONGMONT-20261006-BUDGET",
      headline,
      dek: "City staff proposed reducing energy-project funding while Longmont considers transit needs, leaving final budget action open for further council review.",
      draft: run6Draft,
      plainBrief: "The proposed energy allocation remains subject to final budget action.",
      cannotSay: "The final budget action and the effect on residents.",
      readinessTier: 3,
      claims: [{ id: "energy-allocation", text: "The proposed energy allocation would leave $916,000.", status: "UNVERIFIED", sourceIds: [], nextCheck: "Check the adopted budget." }],
      sources: [],
    };
    const writer = { stories: [story], held: [{ storyId: story.id, headline: "Airport-fee motion and its announced 6–1 result", reason: openReason, nextCheck: "Review the continuous motion and result passage.", unverified: true }] };
    const routedChat = passChat({ writer: () => ({ ok: true, text: JSON.stringify(writer) }) });
    const chat = async (system: string, prompt: string) => {
      if (prompt.includes("Check this one unresolved story claim")) throw new Error(openReason);
      return routedChat(system, prompt);
    };
    try {
      await performReportingWork(job, {
        ...methodDeps(),
        workspaceRoot,
        ingest: ingestDouble(),
        runResearch: researchWithCaptureVersionIds(),
        chat: chat as never,
        probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
      });
      const [filed] = await sql<{ package: { stories: { headline: string; draft: string }[]; held: { headline: string; reason: string }[]; runStatus: string }; draft_id: number | null }>`
        select package, draft_id from reporting_packages where request_id = ${requestId}
      `;
      assert.ok(filed, "the first readable draft reached the editor's package row");
      assert.equal(filed.package.stories.length, 1);
      assert.match(filed.package.stories[0]!.headline, /Longmont’s proposed budget/);
      assert.equal(filed.package.stories[0]!.draft.trim().split(/\s+/).length, 657);
      assert.equal(filed.package.runStatus, "PARTIAL");
      assert.ok(filed.package.held.some((item) => /6–1/.test(item.headline) && /continuous interval/.test(item.reason)));
      const [draft] = await sql<{ headline: string; dek: string; body: string; research_json: unknown }>`
        select headline, dek, body, research_json from drafts where id = ${filed.draft_id}
      `;
      const research = typeof draft!.research_json === "string" ? JSON.parse(draft!.research_json) : draft!.research_json as Record<string, unknown>;
      const readiness = (research as Record<string, unknown>).storyReadiness as Record<string, unknown>;
      assert.equal(readiness.state, "not-ready");
      assert.equal(readiness.reason, openReason);
      const blockers = publishBlockers({
        headline: draft!.headline, dek: draft!.dek, body: draft!.body, sectionReady: true,
        readiness: "not-ready", readinessReason: String(readiness.reason), openClaims: 0,
        unreviewedClaims: 0, unreviewedAccepted: false, namedOutlets: [], evidenceStale: false,
        reviewingEvidence: false, reconcileActive: false, publishing: false,
      });
      assert.ok(blockers.some((blocker) => blocker.key === "readiness"), "the existing Publish gate remains closed");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not leave a story file when the package transaction rolls back", { skip: !haveMethod }, async () => {
    // guards: an editor could mistake an unfiled story file for a saved draft.
    const sql = await getSql();
    const requestId = await newRequest({ seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-file-rollback-"));
    try {
      await assert.rejects(performReportingWork(await claimedJobFor(requestId), {
        ...methodDeps(),
        workspaceRoot,
        ingest: ingestDouble(),
        runResearch: researchWithCaptureVersionIds(),
        chat: passChat() as never,
        probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
        savePackage: (async () => { throw new Error("fixture package save failure"); }) as never,
      }), /fixture package save failure/);
      const [count] = await sql<{ n: number }>`select count(*)::int as n from reporting_packages where request_id = ${requestId}`;
      assert.equal(Number(count!.n), 0);
      const files = readdirSync(pathJoin(workspaceRoot, "request-" + requestId));
      assert.deepEqual(files.filter((name) => name === "package.json" || /^story-.*\.md$/.test(name)), []);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("fails precisely when the writer cannot answer, filing no empty package", { skip: !haveMethod }, async () => {
    const requestId = await newRequest({ seed_urls: ["https://city.example/meeting"] });
    const sql = await getSql();
    await assert.rejects(
      performReportingWork(await claimedJobFor(requestId), {
        ...methodDeps(),
        runResearch: async () => ({ findings: "", searches: 0, pages: 0, captures: [], window: null,
          stopReason: "no-more-queries", stopDetail: null, nothingFoundReason: "nothing" }),
        ingest: async () => ({ ok: false, status: 0, outcome: "fetch-failed", text: "", title: "",
          extras: [], contentType: "", needsOcr: false, redirectChain: [], extractionMethod: "", pages: [], notices: [] }),
        chat: async () => ({ ok: false, error: "provider sign-in lapsed" }),
      }),
      /provider sign-in lapsed/,
    );
    const row = await loadReportingRequest(sql, requestId, NEWSROOM);
    assert.equal(row!.run_status, "FAILED");
    const pkgs = await sql<{ n: number }>`select count(*)::int as n from reporting_packages where request_id = ${requestId}`;
    assert.equal(Number(pkgs[0]!.n), 0, "no package is filed for a run that could not write");
  });

  it("refuses to run another editor's request", async () => {
    const requestId = await newRequest();
    await assert.rejects(
      performReportingWork(await claimedJobFor(requestId, { user_id: "someone-else" }), methodDeps()),
      /not this editor's/,
    );
  });

  it("resolves the meeting from the LEAD artifact, never the first seed", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    // The FIRST seed is a budget PDF; the meeting lives on the lead's artifact.
    const identity = await resolveMeetingIdentity(sql, {
      newsroomId: NEWSROOM,
      leadId,
      seedUrls: ["https://city.example/budget-2027.pdf", "https://youtu.be/" + FIXTURE_VIDEO],
      fallbackTitle: "Report the Sept. 29 council meeting",
    });
    assert.equal(identity.source, "lead-artifact");
    assert.equal(identity.artifactId, artifactId);
      assert.equal(identity.videoId, FIXTURE_VIDEO);
      const record = await loadWholeRecord(sql, { newsroomId: NEWSROOM, identity });
      assert.equal(record.complete, true, record.gaps.join(" "));
      assert.equal(record.segments.length, 5, "every retained segment was read");
      assert.match(record.coverageLedger, /Read 5 of 5 retained segments/);
    });

    it("binds the coverage URL to the retained artifact's video, not the first YouTube seed", async () => {
      /*
        THE TWO-VIDEO HAZARD, made concrete. The retained artifact is video
        zMglXtVlIMA. The editor ALSO supplied the official recording of the same
        meeting under a DIFFERENT id -- fWMTQj830Ho -- whose recording start and
        time offsets differ, so its timestamps are NOT the retained tape's. The
        coverage ledger's timestamps come from the retained artifact, so its
        recordingUrl must be the retained video's URL. Stamping the supplied
        seed's URL here would put one recording's clock on another recording's
        link: wrong evidence.
      */
      const sql = await getSql();
      const artifactId = await seedMeetingFixture(sql);
      const leadId = await seedScopedLead(sql, artifactId);
      const identity = await resolveMeetingIdentity(sql, {
        newsroomId: NEWSROOM,
        leadId,
        // The official same-meeting upload first; the retained video's own link
        // is not even supplied. The identity must still name the retained video.
        seedUrls: ["https://www.youtube.com/watch?v=fWMTQj830Ho"],
        fallbackTitle: "Report the Sept. 29 council meeting",
      });
      assert.equal(identity.source, "lead-artifact");
      assert.equal(identity.videoId, FIXTURE_VIDEO, "the retained artifact's video is the identity");
      assert.match(identity.videoUrl, /zMglXtVlIMA/, "the coverage URL names the retained video");
      assert.doesNotMatch(identity.videoUrl, /fWMTQj830Ho/, "a different upload's URL is not borrowed");
      // A seed that IS the retained video is still accepted verbatim.
      const viaOwnSeed = await resolveMeetingIdentity(sql, {
        newsroomId: NEWSROOM, leadId,
        seedUrls: ["https://youtu.be/" + FIXTURE_VIDEO],
        fallbackTitle: "t",
      });
      assert.match(viaOwnSeed.videoUrl, /zMglXtVlIMA/);
    });

  it("reads the whole tape in bounded windows and drops no segment", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    // 900 synthetic segments, > 400 (the segment cap) and > 24k chars.
    const body = "A".repeat(60);
    for (let index = 5; index < 905; index += 1) {
      await sql`
        insert into meeting_transcript_segments
          (artifact_id, segment_index, start_seconds, end_seconds, item, excerpt, caption_sha256)
        values (${artifactId}, ${index}, ${index * 10}, ${index * 10 + 9}, '6A', ${body}, ${"cap-" + String(index)})
        on conflict (artifact_id, segment_index) do nothing
      `;
    }
    // Scope a lead so the identity resolves to the artifact, exactly as the
    // real prepared assignment does.
    const leadId = await seedScopedLead(sql, artifactId);
    const identity = await resolveMeetingIdentity(sql, {
      newsroomId: NEWSROOM, leadId,
      seedUrls: ["https://youtu.be/" + FIXTURE_VIDEO], fallbackTitle: "t",
    });
    assert.equal(identity.source, "lead-artifact");
    const record = await loadWholeRecord(sql, { newsroomId: NEWSROOM, identity });
    assert.ok(record.windows.length > 1, "the tape was split into more than one window");
    // No segment is dropped: the windows' segment count equals the tape's.
    const inWindows = record.windows.reduce((sum, window) => sum + window.segments.length, 0);
    assert.equal(inWindows, record.segments.length);
    // Each window is genuinely bounded by both the segment and character budget.
    for (const window of record.windows) {
      assert.ok(window.segments.length <= 400 + 1, "a window honours the segment budget");
    }
    assert.match(record.coverageLedger, new RegExp("Read " + record.segments.length + " of " + record.segments.length));
  });

  it("records a warm/cold disagreement instead of averaging it away", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-reconcile-"));
    try {
      // Warm finds only the policy action; cold finds it AND a second action the
      // warm pass never saw. The reconciled ledger must carry the cold-only
      // action as unresolved, and the disagreement must be recorded.
      await performReportingWork(await claimedJobFor(requestId), {
        ...methodDeps(),
        workspaceRoot,
        ingest: ingestDouble(),
        runResearch: researchWithCaptureVersionIds(),
        chat: passChat({
          warm: warmReplyWarmOnly,
          cold: coldReplyColdOnly,
        }) as never,
        probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
      });
      const [row] = await sql<{ package: { coverageComplete: boolean; actions: { disposition: string }[] } }>`
        select package from reporting_packages where request_id = ${requestId}
      `;
      assert.ok(row, "a package is still filed for a partly reconciled run");
      // A contradiction keeps the run out of COMPLETE, and the cold-only action
      // is in the ledger with an explicit unresolved disposition.
      const coldOnly = row!.package.actions.find((a) => /unresolved \(cold pass only\)/.test(a.disposition));
      assert.ok(coldOnly, "the cold-only action is retained as unresolved");
      assert.equal(row!.package.coverageComplete, false);
      const request = await loadReportingRequest(sql, requestId, NEWSROOM);
      assert.equal(request!.run_status, "PARTIAL");
      assert.match(request!.run_note, /disagree|did not find|found an action/i);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects a figure bound to the wrong item in code, even when it appears elsewhere", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-crossitem-"));
    try {
      // The writer declares a VERIFIED claim about item 7B (the procedural item)
      // that cites the $733,170 figure. That figure lives under item 6A, not 7B,
      // so the code-side binding must DOWNGRADE it to UNVERIFIED -- a figure that
      // appears elsewhere in the packet does not verify this action.
      await performReportingWork(await claimedJobFor(requestId), {
        ...methodDeps(),
        workspaceRoot,
        ingest: ingestDouble("Item 6A: airport-noise contract, $733,170. Item 7B: staff direction."),
        runResearch: researchWithCaptureVersionIds(),
        chat: passChat({
          writer: () =>
            writerReply({
              claimText: "Item 7B carried a contract worth $733,170.",
              claimItem: "7B",
            }),
        }) as never,
        probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
      });
      const [row] = await sql<{ package: { stories: { claims: { status: string; nextCheck: string }[] }[] } }>`
        select package from reporting_packages where request_id = ${requestId}
      `;
      const claim = row!.package.stories[0]!.claims[0]!;
      assert.equal(claim.status, "UNVERIFIED", "the cross-item figure was rejected in code");
      assert.match(claim.nextCheck, /not in this item's own record|does not support it/i);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("stops at a cancellation boundary mid-run without filing a package", { skip: !haveMethod }, async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-cancel-"));
    let calls = 0;
    try {
      await assert.rejects(
        performReportingWork(await claimedJobFor(requestId), {
          ...methodDeps(),
          workspaceRoot,
          ingest: ingestDouble(),
          runResearch: researchWithCaptureVersionIds(),
          // The first pass runs; the SECOND boundary check throws, so the run
          // stops between stages with no package filed.
          throwIfCancelled: async () => {
            calls += 1;
            if (calls >= 2) throw new JobCancelledError();
          },
          chat: passChat() as never,
          probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
        }),
        (err: unknown) => err instanceof JobCancelledError,
      );
      const pkgs = await sql<{ n: number }>`select count(*)::int as n from reporting_packages where request_id = ${requestId}`;
      assert.equal(Number(pkgs[0]!.n), 0, "a cancelled run files no package");
      const request = await loadReportingRequest(sql, requestId, NEWSROOM);
      assert.notEqual(request!.run_status, "COMPLETE");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("files NOTHING when a successor reclaimed the job mid-run (stale claim)", { skip: !haveMethod }, async () => {
    /*
      THE STALE-CLAIM RACE. This worker owns claim token A and runs the whole
      method. Before it files, the drainer decides the worker died and hands the
      job to a successor under a NEW token B. The fence locks the row, sees B,
      and throws: the dying worker writes NO lead, NO draft, NO package, no
      request status, and -- the whole point -- does NOT clobber the successor's
      `result_json`. Progress and dispositions are written after the commit, so
      the throw leaves the request PENDING and the job row exactly as the
      successor left it.
    */
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const job = await claimedJobFor(requestId);
    const successorJson = JSON.stringify({ leadIds: [424242], filed: [{ leadId: 424242 }] });
    // The successor reclaims: a new token, and its OWN result already recorded.
    await reclaimSeededJob(sql, job.id, "successor-token");
    await sql`update desk_jobs set result_json = ${successorJson} where id = ${job.id}`;
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-stale-"));
    try {
      await assert.rejects(
        performReportingWork(job, {
          ...methodDeps(),
          workspaceRoot,
          ingest: ingestDouble(),
          runResearch: researchWithCaptureVersionIds(),
          chat: passChat() as never,
          probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
        }),
        (err: unknown) => err instanceof JobCancelledError,
        "a reclaimed job's worker is fenced out at filing",
      );
      const pkgs = await sql<{ n: number }>`select count(*)::int as n from reporting_packages where request_id = ${requestId}`;
      assert.equal(Number(pkgs[0]!.n), 0, "the stale worker filed no package");
      const request = await loadReportingRequest(sql, requestId, NEWSROOM);
      assert.equal(request!.run_status, "PENDING", "the stale worker did not stamp a terminal status");
      const [row] = await sql<{ result_json: string | null }>`select result_json from desk_jobs where id = ${job.id}`;
      assert.equal(row!.result_json, successorJson, "the successor's result_json was not clobbered");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("refuses to file when the worker's job carries no claim token (null-token guard)", { skip: !haveMethod }, async () => {
    /*
      A CLAIMED DESK JOB ALWAYS HAS A TOKEN. A worker whose in-memory job has a
      null/empty token is therefore NOT a real claimant -- and the fence must not
      interpret that as "skip the token comparison". If it did, such a job would
      file against whatever running row shared its id, overwriting a live
      successor. The fence is symmetric: the expected token must be a nonempty
      string AND equal the locked row's. This seeds a real running row whose
      token is present, then hands the worker a token-less copy of it.
    */
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const seeded = await claimedJobFor(requestId);
    const tokenless: DeskJob = { ...seeded, claim_token: null };
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-nulltoken-"));
    try {
      await assert.rejects(
        performReportingWork(tokenless, {
          ...methodDeps(),
          workspaceRoot,
          ingest: ingestDouble(),
          runResearch: researchWithCaptureVersionIds(),
          chat: passChat() as never,
          probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
        }),
        (err: unknown) => err instanceof JobCancelledError,
        "a token-less worker is fenced out",
      );
      const pkgs = await sql<{ n: number }>`select count(*)::int as n from reporting_packages where request_id = ${requestId}`;
      assert.equal(Number(pkgs[0]!.n), 0, "the token-less worker filed no package");
      const request = await loadReportingRequest(sql, requestId, NEWSROOM);
      assert.equal(request!.run_status, "PENDING", "nothing was stamped over the live row");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("preserves the editor's notes and draft and files no duplicate at a final cancel", { skip: !haveMethod }, async () => {
    /*
      THE FINAL-CANCEL RACE. The editor clicks Cancel after the run has already
      earned coverage. The cancel request lands on the job row; at filing the
      fence sees `cancel_requested` and throws. Nothing is filed, and the editor's
      own work must survive intact: their lead's `notes_json` is never rewritten
      by a run, and a run writes its copy as a NEW draft -- so no partial write
      can have eaten an editor draft. There is also no duplicate package for the
      request.
    */
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const editorNotes = JSON.stringify([{ at: "2026-10-04", note: "Hold the contract until the audit lands." }]);
    await sql`update leads set notes_json = ${editorNotes} where id = ${leadId}`;
    const before = await sql<{ n: number }>`select count(*)::int as n from drafts where lead_id = ${leadId}`;
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const job = await claimedJobFor(requestId);
    // The editor cancels the job while this worker is between its last pass and
    // the filing -- then the worker reaches the fence.
    await cancelSeededJob(sql, job.id);
    const workspaceRoot = mkdtempSync(pathJoin(tmpdir(), "ds-finalcancel-"));
    try {
      await assert.rejects(
        performReportingWork(job, {
          ...methodDeps(),
          workspaceRoot,
          ingest: ingestDouble(),
          runResearch: researchWithCaptureVersionIds(),
          chat: passChat() as never,
          probe: async () => ({ ok: true, label: "Fake model", choice: "auto" }) as never,
        }),
        (err: unknown) => err instanceof JobCancelledError,
        "a cancelled job files nothing",
      );
      const pkgs = await sql<{ n: number }>`select count(*)::int as n from reporting_packages where request_id = ${requestId}`;
      assert.equal(Number(pkgs[0]!.n), 0, "no duplicate or partial package");
      const after = await sql<{ n: number }>`select count(*)::int as n from drafts where lead_id = ${leadId}`;
      assert.equal(Number(after[0]!.n), Number(before[0]!.n), "no run draft was written");
      const [lead] = await sql<{ notes_json: string | null }>`select notes_json from leads where id = ${leadId}`;
      assert.equal(lead!.notes_json, editorNotes, "the editor's notes were not overwritten");
      const request = await loadReportingRequest(sql, requestId, NEWSROOM);
      assert.equal(request!.run_status, "PENDING", "the cancelled run left the request alone");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps a warm/cold ledger honest when the cold pass invents a tally", async () => {
    // A focused unit check on the reconciler's item-bound tally rule: the packet
    // mentions a 7-0, but under a DIFFERENT item, so the procedural item's own
    // "6-1" is what its record supports. The reconciler flags the borrowed tally.
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    // Scope a lead: without it the identity resolves to no artifact and the
    // tape is empty, which would make every tally "absent" for the wrong reason.
    const leadId = await seedScopedLead(sql, artifactId);
    const identity = await resolveMeetingIdentity(sql, {
      newsroomId: NEWSROOM, leadId, seedUrls: ["https://youtu.be/" + FIXTURE_VIDEO], fallbackTitle: "t",
    });
    const record = await loadWholeRecord(sql, { newsroomId: NEWSROOM, identity });
    assert.equal(record.complete, true, record.gaps.join(" "));
    const warm: CoverageAction[] = [
      { actionId: "W1", timestamp: "00:01:15", agendaItem: "6A", motionOrAction: "Approve the airport-noise contract",
        outcome: "carries", vote: "7-0", policyStage: "final", evidence: "tape 00:00:30, item 6A", disposition: "Lead" },
    ];
    const cold: CoverageAction[] = [
      { actionId: "C1", timestamp: "00:01:15", agendaItem: "6A", motionOrAction: "Approve the airport-noise contract",
        outcome: "carries", vote: "7-0", policyStage: "final", evidence: "tape 00:00:30, item 6A", disposition: "Lead" },
    ];
    const reconciled = reconcileLedgers(warm, cold, record, {
      transcriptText: record.segments.map((s) => s.text).join("\n"),
      packetText: "",
    });
    // The 7-0 IS under item 6A, so it is not flagged.
    assert.equal(reconciled.voteMismatches.length, 0);

    const borrowed: CoverageAction[] = [{ ...warm[0]!, agendaItem: "PROC", vote: "7-0" }];
    const flagged = reconcileLedgers(borrowed, [{ ...borrowed[0]!, actionId: "C2" }], record, {
      transcriptText: record.segments.map((s) => s.text).join("\n"),
      packetText: "The packet says the contract passed 7-0.",
    });
    assert.equal(flagged.voteMismatches.length, 1, "the borrowed tally is flagged against its own item");
  });
});
/*
  The update note required two seams that the run test alone does not exercise:
  (1) a scoped retrieval of prior editor corrections -- relevant to THIS lead,
  never another lead's or another newsroom's lessons; and (2) a research pass
  that is actually PLANNED and READ by the request's pinned runtime, not left to
  a global default (runDeskResearch stops immediately without a plan seam).
*/
describe("scoped corrections and pinned research runtime", () => {
  it("retrieves this lead's prior correction and excludes another lead's", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    // A second, unrelated lead in the same newsroom, and a lead in another room.
    const [otherLead] = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why, topic, status, meeting_video_id, meeting_lead_purpose)
      values (${USER}, ${NEWSROOM}, 'Unrelated park levy', 'Not this meeting.', 'council', 'new', ${"other-video"}, 'whole-meeting')
      returning id
    `;
    await sql`
      insert into reporting_observations (newsroom_id, user_id, request_id, lead_id, kind, text, evidence)
      values
        (${NEWSROOM}, ${USER}, ${null}, ${leadId}, 'correction', 'The contract figure is the total, not the annual spend.', 'editor note 2026-10-01'),
        (${NEWSROOM}, ${USER}, ${null}, ${Number(otherLead!.id)}, 'correction', 'PARK LEVY NOTE that must not travel.', 'editor note'),
        (${999}, ${USER}, ${null}, ${leadId}, 'correction', 'OTHER NEWSROOM note that must not travel.', 'editor note')
    `;
    const rows = await loadScopedObservations(sql, {
      newsroomId: NEWSROOM, leadId, parentRequestId: null, requestId,
    });
    const texts = rows.map((r) => r.text).join(" | ");
    assert.match(texts, /total, not the annual spend/, "this lead's correction is retrieved");
    assert.doesNotMatch(texts, /PARK LEVY/, "another lead's correction is excluded");
    assert.doesNotMatch(texts, /OTHER NEWSROOM/, "another newsroom's correction is excluded");
  });

  it("plans and reads research with the pinned runtime, not a global default", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const planCalls: string[] = [];
    const readCalls: string[] = [];
    const plan = async (system: string) => {
      planCalls.push(system);
      return { ok: true as const, text: JSON.stringify({ queries: ["airport noise contract 2026"], stop: true, reason: "narrow" }) };
    };
    const read = async (_system: string, user: string) => {
      readCalls.push(user);
      return { ok: true as const, text: "The packet lists the $733,170 contract at p.57." };
    };
    const gather = await gatherIndependentSources({
      request: { id: requestId, user_id: USER, newsroom_id: NEWSROOM, lead_id: leadId, parent_request_id: null,
        request_kind: "assignment", action: "Report this meeting", assignment: "Report the Sept. 29 council meeting",
        seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO], model_choice: "auto", method_version: "2.6.0",
        method_source: "", model_receipt: {}, workspace_dir: "", run_status: "PENDING", run_note: "", error: null,
        created_at: "", finished_at: null } as never,
      sql,
      deps: {
        runResearch: async (input: DeskResearchInput, deps?: DeskResearchDeps) => {
          // The real planner/reader seams must be present -- without them
          // runDeskResearch stops as planner-failed.
          const planResearch = deps?.plan;
          const readResearch = deps?.read;
          assert.ok(planResearch, "a plan seam is passed to research");
          assert.ok(readResearch, "a read seam is passed to research");
          await planResearch("system", "plan this search");
          await readResearch("system", "read this page");
          return {
            findings: "planned", searches: 1, pages: 1, captures: [], window: null,
            stopReason: "protocol-satisfied", stopDetail: null, nothingFoundReason: null,
          };
        },
        plan,
        read,
      } as never,
      paper: { city: "Longmont", state: "CO", officialHost: null },
      researchRuntime: { choice: "auto", localModel: null, effort: null },
      researchScope: "public",
      report: async () => {},
      throwIfCancelled: async () => {},
    });
    assert.equal(planCalls.length, 1, "the planner ran");
    assert.equal(readCalls.length, 1, "the reader ran");
    assert.equal(gather.searches, 1);
  });
});
/*
  The method's "further research" step must be a REAL retrieval call, not a
  sentence in a prompt: after the adversarial pass names what the story cannot
  yet stand on, a second research pass runs, reads the NEW primary document it
  finds, and hands that document's own words to the writer.
*/
describe("the further-research pass is a real retrieval, not a promise", () => {
  it("runs a second research call scoped to the contrary findings and reads the new document", async () => {
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    let researchCalls = 0;
    let sawFocus = "";
    const readUrls: string[] = [];
    const result = await furtherResearchPass({
      request: { id: requestId, user_id: USER, newsroom_id: NEWSROOM, lead_id: leadId, parent_request_id: null,
        request_kind: "assignment", action: "Report this meeting", assignment: "Report the Sept. 29 meeting",
        seed_urls: [], model_choice: "auto", method_version: "2.6.0", method_source: "", model_receipt: {},
        workspace_dir: "", run_status: "PENDING", run_note: "", error: null, created_at: "", finished_at: null } as never,
      deps: {
        runResearch: async (input: DeskResearchInput) => {
          researchCalls += 1;
          sawFocus = String(input.researchPack ?? "");
          return {
            findings: "The adopted budget line for noise mitigation is p.57.",
            searches: 1, pages: 1,
            captures: [{ url: "https://city.example/budget-2027.pdf", title: "2027 budget", captureEventId: 2, versionId: null, locator: "p.57" }],
            window: null, stopReason: "protocol-satisfied" as const, stopDetail: null, nothingFoundReason: null,
          };
        },
        ingest: (async (url: string) => {
          readUrls.push(String(url));
          return { ok: true, status: 200, outcome: "fetched", text: "Line 57: noise mitigation $240,000 per year.",
            title: "2027 budget", extras: [], contentType: "application/pdf", needsOcr: false, redirectChain: [],
            extractionMethod: "pdf", pages: [], notices: [] };
        }) as never,
      } as never,
      researchRuntime: { choice: "auto", localModel: null, effort: null },
      researchScope: "public",
      contrary: { contrary: [{ challenge: "The per-year noise-mitigation spend is not on the tape.", status: "unresolved", source: "packet" }], unknowns: ["The annual noise spend."] } as never,
      action: "Report this meeting",
      assignment: "Report the Sept. 29 meeting",
      paper: { city: "Longmont", state: "CO", officialHost: null },
      documents: [{ url: "https://city.example/packet.pdf", title: "packet", ok: true, text: "Item 6A: contract.", reason: "" }],
      workspaceDir: mkdtempSync(pathJoin(tmpdir(), "ds-further-")),
      report: async () => {},
      throwIfCancelled: async () => {},
    });
    assert.equal(researchCalls, 1, "the further-research pass made its own research call");
    assert.match(sawFocus, /per-year noise-mitigation spend/, "it is scoped to the contrary finding");
    assert.ok(readUrls.includes("https://city.example/budget-2027.pdf"), "the new document was actually read");
    const budget = result.documents.find((d) => d.url.endsWith("budget-2027.pdf"));
    assert.match(budget!.text, /\$240,000 per year/, "the writer receives the document's own words");
    assert.ok(result.documents.some((d) => d.url.endsWith("packet.pdf")), "the seed document remains in the further-research document set");
  });
  it("pins the run to the enqueue receipt, not a re-resolved live selection", async () => {
    /*
      THE PIN IS THE SAVED RECEIPT, NOT THE DESK DROPDOWN.
      A real enqueue writes `initialModelRuntimeReceipt` into the job:
      `actualRuntime` / `modelEffort` (the SAVED actual effort) / `localModel`.
      The editor then changes the desk selection while the job runs. The run must
      still speak with the runtime, endpoint AND effort it was promised. This
      builds the receipt through the REAL serializer -- so it fails if the saved
      key is ever renamed -- with requestedEffort "none" but actualEffort "high",
      the distinct pair that catches a parser reading the wrong field and
      collapsing to the registry default.
    */
    const sql = await getSql();
    const artifactId = await seedMeetingFixture(sql);
    const leadId = await seedScopedLead(sql, artifactId);
    const requestId = await newRequest({ lead_id: leadId, seed_urls: ["https://youtu.be/" + FIXTURE_VIDEO] });
    const pinnedEndpoint = { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-r1:8b" };
    const receiptJson = JSON.stringify(initialModelRuntimeReceipt({
      requestedRuntime: "auto",
      requestedEffort: "none",
      actualRuntime: "local-model",
      actualEffort: "high",
      localModel: pinnedEndpoint,
    }));
    // The row is seeded with the REAL serialized receipt, exactly as enqueue writes it.
    const job = await claimedJobFor(requestId, { result_json: receiptJson });
    assert.match(String(job.result_json), /"modelEffort":"high"/, "the fixture carries the real saved-effort key");
    const request = await loadReportingRequest(sql, requestId, NEWSROOM);
    // The probe answers a DIFFERENT label/choice/endpoint, as a changed desk pick would.
    const resolved = await resolveModel(request!, job, {
      probe: (async () => ({
        ok: true as const,
        label: "Some other live pick",
        choice: "auto" as never,
        localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "some-other-model" },
      })) as never,
    });
    assert.equal(resolved.effort, "high", "the pinned effort is the one saved at enqueue, not requested and not the default");
    assert.deepEqual(resolved.localModel, pinnedEndpoint, "the receipt endpoint wins over the probe's");
    assert.equal(resolved.requested, "auto", "the editor's own choice is echoed");
  });
});

/*
  THE DOCUMENT DIGEST CARRIES LATE OFFICIAL FACTS.

  The real Sept. 29 memo put its decisive lines -- the $15,330 human-services
  reduction, the $495,670 savings placeholder, the $672,625 transit transfer --
  at its END, after pages of background. A prefix-only excerpt hid them, and the
  run then called documented city figures "unverified". These tests pin the
  head+tail contract and the honest cut notice that replaces it.
*/
describe("the document digest carries both ends of an official record", () => {
  it("carries a short primary document WHOLE, so nothing is lost", () => {
    const memo = "Budget overview; total appropriation is $2,947,545. Human Services Agency funding decreases by $15,330.";
    const out = documentDigest([{
      url: "memo.pdf", title: "Memo", ok: true, text: memo, reason: "",
      pages: [
        { page: 1, text: "Budget overview; total appropriation is $2,947,545.", layoutText: "Budget overview;\nTotal appropriation is $2,947,545." },
        { page: 3, text: "Human Services Agency funding decreases by $15,330.", layoutText: "Human Services Agency funding\nDecreases by $15,330." },
      ],
    }]);
    assert.match(out, /\$2,947,545/, "the closing figure of a short memo is present");
    assert.match(out, /=== PDF PAGE 1 ===[\s\S]*appropriation is \$2,947,545/i, "actual page 1 text is available to cite");
    assert.match(out, /=== PDF PAGE 3 ===[\s\S]*decreases by \$15,330/i, "actual page 3 text is available to cite");
    assert.doesNotMatch(out, /were NOT shown to you/, "a fully carried document is not cut");
    assert.match(out, /=== PDF PAGE 3 ===\nHuman Services Agency funding\nDecreases by \$15,330\./i, "retained page layout helps the writer locate the exact section");
    assert.doesNotMatch(out, /Additional extraction without page mapping/, "flattened legacy text matches the page-level source");
  });

  it("shows the TAIL of a document too large to fit, and names the unseen middle", () => {
    // A real-shaped >=10k official budget doc whose late-page summary carries the facts.
    const head = "Longmont 2027 Proposed Budget. ".repeat(300);
    const middle = "Background and narrative. ".repeat(300);
    const tail = "SUMMARY OF CHANGES: $15,330 reduction for Human Services Agency funding; $495,670 for budget savings; $672,625 one-time transfer to the Public Improvement Fund; $1,646,233 for TRP131 transit.";
    const text = head + middle + tail;
    assert.ok(text.length >= 10_000, "the fixture is a real-shaped large document");
    /*
      THE BIG-DOC CASE ASKS FOR THE EXCERPT EXPLICITLY. The run's default budget
      is generous enough to carry a ~10k document whole, so this test states its
      own 6_000 head+tail budget rather than leaning on a default that is no
      longer small enough to trigger the cut. Otherwise the assertion would pass
      for the wrong reason -- an untouched document, not a correctly-cut one.
    */
    const out = documentDigest([{ url: "budget.pdf", title: "Budget", ok: true, text, reason: "" }], 6_000);
    assert.match(out, /\$15,330/, "a late-page fact in a big document reaches the prompt");
    assert.match(out, /\$1,646,233/, "the transit figure in the summary reaches the prompt");
    assert.match(out, /were NOT shown to you/, "an honest cut notice states what was not shown");
    assert.doesNotMatch(out, /the rest was NOT shown/i, "the old 'the rest' wording is gone");
  });

  it("carries a >=10k short primary document WHOLE, INCLUDING its middle", () => {
    /*
      THE MIDDLE IS THE POINT. A head+tail excerpt can keep both ends of an
      official record and still silently drop the middle -- and a fact that sits
      there then reads as "unverified". The default per-document budget must be
      large enough that a real short primary record (a staff memo, a budget
      presentation) is carried COMPLETE, so nothing in it is unavailable to the
      writer. This fixture puts one important fact at each end AND one in the
      exact middle, and asserts all three survive with no cut notice.
    */
    const headFact = "HEAD FACT: the total appropriation is $2,947,545. ";
    const midFact = "MIDDLE FACT: the human-services reduction is $15,330. ";
    const tailFact = "TAIL FACT: the one-time transit transfer is $672,625.";
    const text = headFact + "Background narrative detail. ".repeat(400) + midFact + "More narrative detail. ".repeat(400) + tailFact;
    assert.ok(text.length >= 10_000, "the fixture is a real-shaped short primary document");
    const out = documentDigest([{ url: "memo.pdf", title: "Memo", ok: true, text, reason: "" }]);
    assert.match(out, /\$2,947,545/, "the head fact is present");
    assert.match(out, /\$15,330/, "the MIDDLE fact is present -- the middle was not dropped");
    assert.match(out, /\$672,625/, "the tail fact is present");
    assert.doesNotMatch(out, /were NOT shown to you/, "a document under the default budget is carried whole");
  });
});

/*
  THE ADVERSARIAL PASS RECOVERS FROM A BAD PARSE, ONCE, AND NEVER SILENTLY
  DROPS THE FURTHER-RESEARCH STEP.
*/
describe("the adversarial pass survives a malformed reply", () => {
  it("makes exactly ONE bounded repair and keeps the original evidence", async () => {
    let repairPrompt = "";
    let calls = 0;
    const chat = (async (_system: string, prompt: string) => {
      calls += 1;
      if (prompt.includes("previous reply could not be read as JSON")) {
        repairPrompt = prompt;
        return contraryRepairReply();
      }
      return contraryMalformedReply();
    }) as never;
    const result = await contraryPass({
      record: { windows: [], segments: [], votes: [], gaps: [] } as never,
      documents: [],
      gather: { findings: "" } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 },
      assignment: "Report the budget meeting",
      action: "Develop this lead",
      method: { text: "", version: "2.6.0" } as never,
      chat,
      chatOpts: {},
      workspaceDir: "",
      throwIfCancelled: async () => {},
    });
    assert.equal(calls, 2, "exactly one repair call follows the malformed reply");
    assert.match(repairPrompt, /per-year noise-mitigation spend is not on the tape/, "the repair preserves the original evidence");
    assert.equal(result.contrary.length, 1, "the repaired content is parsed");
    assert.equal(result.raw.truncated, true, "the receipt records that a repair was attempted");
    assert.match(result.raw.text, /REPAIR REPLY/, "the raw receipt keeps the reply and the repair");
  });

  it("records the failure and keeps real open questions when the repair ALSO fails", async () => {
    let calls = 0;
    const chat = (async () => {
      calls += 1;
      return calls === 1 ? contraryMalformedReply() : contraryRepairStillBadReply();
    }) as never;
    const result = await contraryPass({
      record: { windows: [], segments: [], votes: [], gaps: [] } as never,
      documents: [],
      gather: { findings: "" } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 },
      assignment: "Report the budget meeting",
      action: "Develop this lead",
      method: { text: "", version: "2.6.0" } as never,
      chat,
      chatOpts: {},
      workspaceDir: "",
      throwIfCancelled: async () => {},
    });
    assert.equal(calls, 2, "no retry loop: one malformed reply, one repair, then stop");
    assert.ok(result.contrary.length === 0, "nothing is invented as a successful validation");
    assert.match(result.gaps.join(" "), /did not return readable JSON/, "the failure is recorded");
    /*
      The fallback questions are the run's own REAL open questions, so the
      further-research seam still has something concrete to retrieve against.
    */
    const fallback = fallbackOpenQuestions({
      reconcile: {
        actions: [], contradictions: ["the cold pass did not find this warm action: 6A approve the contract"],
        warmOnly: [], coldOnly: [], voteMismatches: ["item 6A: the tally is not in this action's own record window."], matched: 0,
      },
      documents: [{ url: "memo.pdf", title: "Memo", ok: false, text: "", reason: "fetch-failed" }],
      assignment: "Lead with the proposed 2027 budget changes.",
      recordGaps: ["Window 3 was not read."],
      existing: [],
    });
    assert.ok(fallback.length >= 3, "real questions survive a total adversarial failure");
    assert.ok(fallback.some((q) => /cold pass did not find/.test(q)), "a reconciliation disagreement becomes an open question");
    assert.ok(fallback.some((q) => /memo\.pdf/.test(q)), "an unreadable document becomes an open question");
    assert.ok(fallback.some((q) => /proposed 2027 budget/.test(q)), "the assignment's own facts become open questions");
  });
});

/*
  EQUALLY-UNKNOWN VOTES ARE NOT A TALLY CONFLICT; A REAL DISAGREEMENT STILL IS.
*/
describe("canonicalizing the vote description removes only false conflicts", () => {
  const base = (vote: string): CoverageAction => ({
    actionId: "A", timestamp: "00:01:00", agendaItem: "6A",
    motionOrAction: "Approve the contract", outcome: "carries", vote,
    policyStage: "final", evidence: "tape 00:01:00, item 6A", disposition: "Lead",
  });
  const record = {
    identity: {} as never, agenda: [], votes: [], gaps: [], coverageLedger: "", complete: true,
    windows: [],
    segments: [{ index: 0, seconds: 60, item: "6A", itemTitle: "", text: "The motion carries 5 to 2." }],
  } as never;
  const texts = { transcriptText: "", packetText: "" };

  it("does NOT report two differently-worded 'no vote taken' results as a conflict", () => {
    const warm = [base("unverified (no tally stated; roll call responses only)")];
    const cold = [base("unverified (no vote taken)")];
    const out = reconcileLedgers(warm, cold, record, texts);
    assert.equal(out.contradictions.length, 0, "equally-unknown results are not a tally conflict");
  });

  it("STILL reports a genuine 5-2 versus 7-0 disagreement", () => {
    const warm = [base("5-2")];
    const cold = [base("7-0")];
    const out = reconcileLedgers(warm, cold, record, texts);
    assert.equal(out.contradictions.length, 1, "a real tally disagreement is preserved");
    assert.match(out.contradictions[0]!, /warm vote "5-2" vs cold "7-0"/);
  });

  it("keeps canonicalVote honest: a real tally never collapses to unverified", () => {
    assert.equal(canonicalVote("unverified (no vote taken)"), "unverified");
    assert.equal(canonicalVote("unverified (no tally stated; roll call responses only)"), "unverified");
    assert.equal(canonicalVote(""), "unverified");
    assert.notEqual(canonicalVote("5-2"), "unverified");
    assert.notEqual(canonicalVote("7-0"), "unverified");
    assert.notEqual(canonicalVote("unanimous"), "unverified");
    assert.equal(canonicalVote("unanimous"), canonicalVote("Unanimous"));
  });
});

/*
  THE WRITER MUST TREAT A PROPOSAL AS A PROPOSAL.
*/
describe("the writer's method prompt states the status policy", () => {
  const method = loadMethodForPrompt(resolveCivicMethodDir().dir);
  /**
   * Capture the writer's ACTUAL user prompt by running the real writingPass with
   * a chat double that records the prompt it was handed. This asserts on the
   * prompt the method really builds, not on a copy of the text.
   */
  async function callWritingPass(
    documents: DocumentRead[] = [],
    record: unknown = { windows: [], segments: [], votes: [], gaps: [] },
    actions: CoverageAction[] = [],
    assignment = "Report the Sept. 29 meeting",
    reply: () => ReturnType<typeof writerReply> = writerReply,
  ): Promise<{ prompt: string; system: string; result: Awaited<ReturnType<typeof writingPass>> }> {
    let captured = "";
    let system = "";
    const chat = (async (systemPrompt: string, prompt: string) => {
      system = systemPrompt;
      captured = prompt;
      return reply();
    }) as never;
    const result = await writingPass({
      record: record as never,
      documents,
      further: { findings: "", documents, gaps: [] },
      gather: { findings: "", observations: [] } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: { actions, contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 },
      contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
      scoring: { score: null, readiness: 0, why: "", gaps: [] },
      assignment,
      action: "Develop this lead",
      city: "Longmont",
      method: method as never,
      chat,
      chatOpts: {},
      workspaceDir: "",
      throwIfCancelled: async () => {},
    });
    return { prompt: captured, system, result };
  }
  async function writingUserPrompt(): Promise<string> {
    return (
      await callWritingPass([])
    ).prompt;
  }
  // guards: the editor could be told a budget motion is missing even though it is in the retained transcript.
  it("removes a missing-motion caveat when the retained transcript has the motion", async () => {
    const story = { id: "budget", headline: "Council gives final budget direction", dek: "The council considered its proposed budget and final direction, while the legal effect of the announced result remains under review for residents.", draft: "Council approved the budget motion.", plainBrief: "", cannotSay: "", readinessTier: 1, claims: [], sources: [] };
    const reason = "The raw passage establishes unanimous passage. The complete motion is available only as a reconciled description, so final legislative enactment remains unverified.";
    const { result } = await callWritingPass([], { identity: { videoId: "meeting" }, windows: [], votes: [], gaps: [], segments: [
      { index: 1, seconds: 100, item: "12A", itemTitle: "Budget direction", text: "I move to approve the proposed budget and final council direction." },
      { index: 2, seconds: 110, item: "12A", itemTitle: "Budget direction", text: "The motion carries unanimously." },
    ] }, [], "Develop this lead", () => ({ ok: true, text: JSON.stringify({ stories: [story], held: [{ storyId: "budget", headline: "Final budget enactment and complete budget-motion wording", reason, nextCheck: "Check the complete motion.", unverified: true }] }) }));
    assert.doesNotMatch(result.held[0]!.reason, /complete motion.*reconciled description/i);
    const sql = await getSql();
    const request = await loadReportingRequest(sql, await newRequest({ action: "Develop this lead", assignment: "Develop this lead" }), NEWSROOM);
    const [filed] = await fileRunLeads({ sql, request: request!, stories: result.stories, score: null, actions: [], held: result.held, receipt: { methodVersion: "2.6.0", modelLabel: "fixture" } as never } as never);
    const [row] = await sql<{ research_json: unknown }>`select research_json from drafts where id = ${filed!.draftId}`;
    const research = typeof row!.research_json === "string" ? JSON.parse(row!.research_json) : row!.research_json as Record<string, unknown>;
    assert.doesNotMatch(String((research.storyReadiness as Record<string, unknown>).reason), /complete motion.*reconciled description/i);
  });
  it("tells the writer a proposal is not an adopted decision and to condition resident effects", async () => {
    const status = await writingUserPrompt();
    assert.match(status, /STATUS IS THE LEDE/, "the status policy is stated as its own rule");
    assert.match(status, /A proposal[\s\S]{0,400}NOT an adopted decision/i, "a proposal is not an adopted decision");
    assert.match(status, /condition any resident effect on[\s\S]{0,80}adoption/i, "resident effects are conditioned on adoption");
    assert.match(status, /damaged caption|adapter/i, "a cut quote may not be presented as an exact quotation");
  });
  // guards: a malformed dek could be filed as a long notebook summary instead of a reader-facing summary.
  it("rewrites an invalid dek once and falls back to the first sentence if it stays invalid", async () => {
    const body = "The city council proposed a $3 million airport-noise plan for neighbors near the runway and will hold a public hearing before adopting any changes. The story continues with background for residents.";
    const validDek = "The city council proposed a $3 million airport-noise plan for neighbors near the runway, with a public hearing scheduled before any change is adopted.";
    const invalidDek = "The supplied record passage gives a tiered action account.";
    async function run(secondDek: string) {
      let calls = 0;
      const opts = { modelChoice: "pinned", effort: "high" };
      const result = await writingPass({
        record: { windows: [], segments: [], votes: [], gaps: [], identity: {} } as never,
        documents: [], further: { findings: "", documents: [], gaps: [] },
        gather: { findings: "", observations: [] } as never,
        warm: { actions: [], windows: [], gaps: [] } as never,
        cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
        reconcile: { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 },
        contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
        scoring: { score: null, readiness: 0, why: "", gaps: [] },
        assignment: "Develop this lead", action: "Develop this lead", city: "Longmont", method: method as never,
        chatOpts: opts, workspaceDir: "", throwIfCancelled: async () => {},
        chat: (async (_system: string, prompt: string, _tokens: number, receivedOpts: unknown) => {
          calls += 1;
          assert.equal(receivedOpts, opts);
          if (calls === 1) {
            assert.match(prompt, /one or two sentences, 20 to 40 words/);
            return { ok: true as const, text: JSON.stringify({
              stories: [{ id: "dek", headline: "Council considers airport-noise plan", dek: invalidDek,
                draft: body, plainBrief: "", cannotSay: "", readinessTier: 1, claims: [], sources: [] }], held: [],
            }) };
          }
          assert.match(prompt, /DEK REWRITE — one bounded attempt/);
          return { ok: true as const, text: JSON.stringify({ dek: secondDek }) };
        }) as never,
      });
      assert.equal(calls, 2, "one writer call plus one dek rewrite");
      return result.stories[0]!.dek;
    }
    assert.equal(await run(validDek), validDek);
    assert.equal(await run(invalidDek), firstSentenceForDek(body));
  });
  // guards: the writer can omit a vote announced after the first 6,000 transcript characters.
  it("passes a reconciled vote's announcement from its transcript window to the writer", async () => {
    const resultTexts = ["The motion was approved 5-2.", "The item is approved.", "It passes.", "It fails.", "Motion carries unanimously.", "If this is approved, the clerk will post notice."];
    const segments = resultTexts.map((text, index) => ({ index, seconds: 100 + index * 30, item: "12A", itemTitle: "Budget direction", text }));
    const windows = segments.map((segment, windowIndex) => ({ windowIndex, startClock: "0:00", endClock: "0:00", items: [{ item: "12A", title: "Budget direction" }], segments: [segment] }));
    const action = { timestamp: "4:16:37", agendaItem: "12A", motionOrAction: "Final council direction on the proposed budget", outcome: "carries unanimously", vote: "unanimously" } as CoverageAction;
    const record = { windows, segments, votes: [], gaps: [], identity: { videoId: "meeting" } };
    const evidence = writerDecisionWindowEvidence(record as never);
    await callWritingPass([], record, [action]);
    for (const result of resultTexts.slice(0, 5)) assert.ok(evidence.includes(result), result);
    assert.ok(!evidence.includes(resultTexts[5]!));
  });
  // guards: the editor could lose readable stories when their already stated meeting results use natural wording.
  it("keeps the minutes and Dry Creek stories when they state unanimous results", async () => {
    const stories = [
      { id: "minutes", headline: "Council minutes in regular session", dek: "The chair announced unanimous approval of the October 6 minutes, one of several procedural decisions recorded during Longmont City Council's regular session.", draft: "The chair announced unanimous approval of the October 6 minutes.", plainBrief: "", cannotSay: "", readinessTier: 1, claims: [], sources: [] },
      { id: "dry-creek", headline: "Dry Creek annexation", dek: "The Dry Creek annexation had unanimous results for its amendments and main motion, while the complete motion wording and final condition text remain unavailable to readers.", draft: "The Dry Creek annexation had unanimous results for its amendments and main motion, but the complete motion wording and final condition text remain missing.\n\nReceipts: retained recording S1kSaew-UUY, window 9, ordinance 2026-62, 2:19:30–2:19:54; window 16, item 12A, 4:14:42–4:16:37.", plainBrief: "In the separate Dry Creek case, council passed and adopted amended ordinance 2026-62 unanimously as announced.", cannotSay: "", readinessTier: 1, claims: [], sources: [] },
    ];
    const record = { identity: { videoId: "S1kSaew-UUY" }, agenda: [{ item: "4", title: "Approval of minutes" }, { item: "9", title: "CONSENT AGENDA AND INTRODUCTION AND READING BY TITLE OF FIRST READING ORDINANCES" }], votes: [], gaps: [], windows: [], segments: [
      { index: 154, seconds: 623, item: "4", itemTitle: "Approval of minutes", text: "Approval of the minutes." }, { index: 158, seconds: 635, item: "4", itemTitle: "Approval of minutes", text: "The motion was made by council." }, { index: 163, seconds: 649, item: "4", itemTitle: "Approval of minutes", text: "That carries unanimously." },
      { index: 3428, seconds: 8370, item: "9", itemTitle: "Dry Creek annexation ordinance 2026-62", text: "I move ordinance 2026-62." }, { index: 3437, seconds: 8394, item: "9", itemTitle: "Dry Creek annexation ordinance 2026-62", text: "That item carries unanimously." },
    ] };
    const initial = stories.map((story, index) => ({ ...story, plainBrief: "", dek: index ? "The council considered the Dry Creek annexation as an action with unresolved wording and conditions for further review by the city." : "The council considered the October 6 minutes during its regular session as part of the meeting's recorded business.", draft: index ? "The council considered Dry Creek ordinance 2026-62 during its meeting." : "The chair discussed the October 6 minutes during the meeting." }));
    let calls = 0;
    const { result } = await callWritingPass([], record, [{ agendaItem: "4", timestamp: "00:10:49", motionOrAction: "Approve the minutes" } as CoverageAction, { agendaItem: "9; specific subitem unresolved", timestamp: "02:19:54", motionOrAction: "Amend the ordinance to incorporate the applicant's four requests" } as CoverageAction], "Report the meeting", () => { calls++; return { ok: true, text: JSON.stringify({ stories: calls === 1 ? initial : stories, held: [] }) }; });
    assert.equal(calls, 2);
    assert.deepEqual(result.gaps, []);
    assert.equal(result.stories.length, 2);
  });
  // guards: the editor could receive a story that mentions an agenda item but omits its announced result.
  it("revises a story once to add an omitted result for an item it mentions", async () => {
    const videoId = "zMglXtVlIMA";
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const initialDraft = "The council considered Dry Creek ordinance 2026-62 as amended during its meeting.";
    const revisedDraft = `${initialDraft} Council approved the measure unanimously.`;
    const headline = "Council considers Dry Creek ordinance";
    const dek = "The council considered Dry Creek ordinance 2026-62 as amended during its meeting, giving residents time to understand how the measure may affect the neighborhood.";
    const writerPackage = (draft: string) => ({ ok: true as const, text: JSON.stringify({
      stories: [{ id: "dry-creek", headline, dek, draft, plainBrief: "The council considered Dry Creek ordinance 2026-62.",
        cannotSay: "", readinessTier: 1, claims: [], sources: [] }], held: [],
    }) });
    const segments = [
      { index: 1, seconds: 110, item: "9A", itemTitle: "Dry Creek ordinance 2026-62", text: "I move to approve Dry Creek ordinance 2026-62 as amended." },
      { index: 2, seconds: 120, item: "9A", itemTitle: "Dry Creek ordinance 2026-62", text: "That motion carries unanimously." },
    ];
    const action = { actionId: "dry-creek-vote", timestamp: "00:02:00", agendaItem: "9A",
      motionOrAction: "Approve Dry Creek ordinance 2026-62 as amended", outcome: "carries unanimously",
      vote: "unanimously", policyStage: "final", evidence: "tape 00:02:00, item 9A", disposition: "Lead" } as CoverageAction;
    let calls = 0;
    const { prompt, result } = await callWritingPass([], {
      identity: { videoId, videoUrl }, segments, votes: [], gaps: [],
      agenda: [{ item: "9A", title: "Dry Creek ordinance 2026-62" }],
      windows: [{ windowIndex: 0, startClock: "0:00", endClock: "0:02", items: [{ item: "9A", title: "Dry Creek ordinance 2026-62" }], segments }],
    }, [action], "Develop this lead", () => ++calls === 1 ? writerPackage(initialDraft) : writerPackage(revisedDraft));
    assert.equal(calls, 2);
    assert.match(prompt, /missing announced final result/i);
    assert.ok(result.stories[0]?.draft.includes("approved the measure unanimously"));
  });
  // guards: the editor could lose a readable draft and its known vote gap before the Publish gate sees it.
  it("files a result gap as not ready and blocks Publish", async () => {
    const headline = "Council considers Dry Creek ordinance";
    const draft = "The council considered Dry Creek ordinance 2026-62 as amended during its meeting.";
    const packageText = JSON.stringify({ stories: [{ id: "dry-creek", headline, dek: "The council considered Dry Creek ordinance 2026-62 as amended during its meeting, giving residents time to understand the measure before the chair's announced result.", draft, plainBrief: "", cannotSay: "", readinessTier: 1, claims: [], sources: [] }], held: [] });
    const segments = [{ index: 1, seconds: 110, item: "9A", itemTitle: "Dry Creek ordinance 2026-62", text: "I move to approve Dry Creek ordinance 2026-62 as amended." }, { index: 2, seconds: 120, item: "9A", itemTitle: "Dry Creek ordinance 2026-62", text: "That motion carries unanimously." }];
    const action = { actionId: "dry-creek-vote", timestamp: "00:02:00", agendaItem: "9A", motionOrAction: "Approve Dry Creek ordinance 2026-62 as amended", outcome: "carries unanimously", vote: "unanimously", policyStage: "final", evidence: "tape 00:02:00", disposition: "Lead" } as CoverageAction;
    let calls = 0;
    const { result } = await callWritingPass([], { identity: { videoId: "meeting" }, segments, votes: [], gaps: [], agenda: [{ item: "9A", title: "Dry Creek ordinance 2026-62" }], windows: [] }, [action], "Develop this lead", () => { calls++; return { ok: true, text: packageText }; });
    assert.equal(calls, 2);
    assert.equal(result.stories.length, 1);
    const held = result.held.find((row) => row.storyId === "dry-creek");
    assert.match(held?.reason ?? "", /Dry Creek ordinance 2026-62.*not stated/i);
    const sql = await getSql();
    const request = await loadReportingRequest(sql, await newRequest({ action: "Develop this lead", assignment: "Develop this lead" }), NEWSROOM);
    const filed = await fileRunLeads({ sql, request: request!, stories: result.stories, score: null, actions: [], held: result.held, receipt: { methodVersion: "2.6.0", modelLabel: "fixture" } as never } as never);
    const [row] = await sql<{ research_json: unknown }>`select research_json from drafts where id = ${filed[0]!.draftId}`;
    const research = typeof row!.research_json === "string" ? JSON.parse(row!.research_json) : row!.research_json as Record<string, unknown>;
    const readiness = research.storyReadiness as { state: string; reason: string };
    assert.equal(readiness.state, "not-ready");
    assert.equal(readiness.reason, held!.reason);
    const blockers = publishBlockers({ headline, dek: "The council considered Dry Creek ordinance 2026-62 as amended during its meeting, giving residents time to understand the measure before the chair's announced result.", body: draft, sectionReady: true, readiness: readiness.state as never, readinessReason: readiness.reason, openClaims: 0, unreviewedClaims: 0, unreviewedAccepted: false, namedOutlets: [], evidenceStale: false, reviewingEvidence: false, reconcileActive: false, publishing: false });
    assert.equal(blockers.find((blocker) => blocker.key === "readiness")?.sentence, held!.reason);
  });
  // guards: an assignment can divert the writer into changing models or effort.
  it("keeps model and effort instructions in the assignment from changing the desk's route", async () => {
    const assignment = "Report the meeting. Use only Codex Sol 6.1 at medium effort; stop if unavailable.";
    const { prompt, system } = await callWritingPass([], undefined, [], assignment);
    assert.ok(prompt.includes("Use only Codex Sol 6.1 at medium effort"));
    assert.ok(/assignment[\s\S]{0,300}(?:model|effort)/i.test(system));
    assert.ok(/never[\s\S]{0,80}(?:spawn|start|invoke)[\s\S]{0,40}another model/i.test(system));
  });
  // guards: a failed run could misreport an open story fact as the cause of failure.
  it("names the writer step when no readable story is returned", async () => {
    const reason = "The transcript's missing roll-call passage leaves the dissenter unidentified.";
    const held = { stories: [], held: [{ storyId: "meeting", headline: "Council vote", reason, nextCheck: "Review the roll call.", unverified: true }] };
    const { result } = await callWritingPass([], undefined, [], "Report the council vote", () => ({ ok: true, text: JSON.stringify(held) }));
    assert.match(result.error, /initial writer call returned no story/i);
    assert.doesNotMatch(result.error, /missing roll-call passage|dissenter unidentified/i);
  });
  it("does not hardcode one story: the status policy is free of this story's facts", async () => {
    const policy = (await writingUserPrompt()).split("STATUS IS THE LEDE")[1]!.split("EDITOR'S ASSIGNMENT")[0]!;
    assert.doesNotMatch(policy, /\$15,330|\$495,670|\$672,625|TRP131/, "the policy carries no budget figures");
  });

  it("gives the writer complete short memo and presentation text, including their middles", async () => {
    const memo: DocumentRead = {
      url: "https://city.example/memo.pdf", title: "Budget memo", ok: true,
      text: "MEMO-HEAD-CLAIM " + "memo narrative. ".repeat(450) + "MEMO-MIDDLE-CLAIM " +
        "memo narrative. ".repeat(450) + "MEMO-TAIL-CLAIM", reason: "",
    };
    const presentation: DocumentRead = {
      url: "https://city.example/slides.pdf", title: "Budget presentation", ok: true,
      text: "SLIDES-HEAD-CLAIM " + "slide narrative. ".repeat(330) + "SLIDES-MIDDLE-CLAIM " +
        "slide narrative. ".repeat(330) + "SLIDES-TAIL-CLAIM", reason: "",
    };
    assert.ok(memo.text.length < 24_000 && presentation.text.length < 24_000);
    const prompt = (await callWritingPass([memo, presentation])).prompt;
    for (const marker of ["MEMO-HEAD-CLAIM", "MEMO-MIDDLE-CLAIM", "MEMO-TAIL-CLAIM",
      "SLIDES-HEAD-CLAIM", "SLIDES-MIDDLE-CLAIM", "SLIDES-TAIL-CLAIM"]) {
      assert.ok(prompt.includes(marker), "writer prompt contains full document marker " + marker);
    }
    assert.doesNotMatch(prompt, /characters in the middle of this \d+-char document were NOT shown to you/i, "neither short document is cut");
  });

  it("keeps seed memo and presentation in the scoring prompt after further research", async () => {
    const methodDocs: DocumentRead[] = [
      { url: "https://city.example/memo.pdf", title: "Budget memo", ok: true,
        text: "MEMO-HEAD " + "memo narrative. ".repeat(220) + "MEMO-MIDDLE " + "memo narrative. ".repeat(220) + "MEMO-TAIL", reason: "" },
      { url: "https://city.example/slides.pdf", title: "Budget slides", ok: true,
        text: "SLIDES-HEAD " + "slide narrative. ".repeat(220) + "SLIDES-MIDDLE " + "slide narrative. ".repeat(220) + "SLIDES-TAIL", reason: "" },
      { url: "https://city.example/new-record.pdf", title: "Further record", ok: true,
        text: "FURTHER-RESEARCH-FACT", reason: "" },
    ];
    let prompt = "";
    await scoringPass({
      record: { windows: [], segments: [], votes: [], gaps: [] } as never,
      documents: methodDocs,
      gather: { findings: "", observations: [] } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 },
      contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
      further: { findings: "", documents: methodDocs, gaps: [] },
      assignment: "Report the proposed budget", action: "Develop the lead", city: "Longmont",
      method: method as never,
      chat: (async (_system: string, user: string) => {
        prompt = user;
        return { ok: true, text: "```json\n{\"score\":{\"immediacy\":3,\"impact\":4,\"conflict\":2,\"novelty\":3},\"readiness\":2,\"why\":\"documented proposal\"}\n```" };
      }) as never,
      chatOpts: {}, workspaceDir: "", throwIfCancelled: async () => {},
    });
    for (const marker of ["MEMO-HEAD", "MEMO-MIDDLE", "MEMO-TAIL", "SLIDES-HEAD", "SLIDES-MIDDLE", "SLIDES-TAIL", "FURTHER-RESEARCH-FACT"]) {
      assert.ok(prompt.includes(marker), "scoring prompt contains " + marker);
    }
  });
});

/*
  THE RETAINED RECORDING IS THE TAPE, AND A DIFFERENT UPLOAD IS A DIFFERENT CLOCK.

  The retained transcript is artifact 39 / video zMglXtVlIMA. The editor also
  supplied the official recording of the SAME meeting under fWMTQj830Ho, whose
  recording start and offsets differ. A source that cites a retained tape
  timestamp (27:19, 3:20:39, ...) while pointing at fWMTQj830Ho staples one
  recording's clock onto another recording's link. These tests pin the rule in
  code: the identity note names the retained video, and a misbound source is
  re-pointed / downgraded rather than printed as verified retained evidence.
*/
describe("the retained recording identity is enforced, not assumed", () => {
  const RETAINED = "zMglXtVlIMA";
  const OTHER = "fWMTQj830Ho";
  const record = () =>
    ({
      identity: {
        videoId: RETAINED,
        artifactId: 39,
        title: "City Council Study Session",
        date: "2026-09-29",
        videoUrl: "https://www.youtube.com/watch?v=" + RETAINED,
        source: "lead-artifact",
        reason: "",
      },
      segments: [],
      windows: [],
      votes: [],
      gaps: [],
      coverageLedger: "",
      complete: true,
    }) as never;

  it("names the retained video and canonical URL, never the other upload", () => {
    const note = retainedRecordingNote(record());
    assert.match(note, new RegExp(RETAINED), "the retained video id is stated");
    assert.match(note, new RegExp("watch\\?v=" + RETAINED), "the canonical retained URL is stated");
    assert.doesNotMatch(note, new RegExp(OTHER), "the different upload is never named as the retained record");
    assert.match(note, /different upload is a different clock|DIFFERENT video id is a DIFFERENT recording/);
  });

  it("preserves the other upload URL and cannot publish its timestamp as retained evidence", () => {
    /*
      The writer hands back a source whose locator cites a retained tape time
      (27:19) but whose URL names the OTHER upload. Validation must not rewrite
      that source onto the retained video's clock. It remains cited as written,
      and the claim that leaned on it becomes UNVERIFIED with both identities
      in the next check.
    */
    const story = {
      id: "s1",
      headline: "h",
      draft: "d",
      plainBrief: "",
      cannotSay: "",
      readinessTier: 2,
      claims: [
        { id: "C1", text: "The council acted at 27:19 into the meeting.", status: "VERIFIED" as const,
          sourceIds: ["S1"], nextCheck: "" },
      ],
      sources: [
        { id: "S1", title: "Official recording", tier: "A" as const,
          url: "https://www.youtube.com/watch?v=" + OTHER, locator: "27:19", offlineReference: "" },
      ],
    };
    const out = validatePacketSources(story as never, record());
    const source = out.sources[0]!;
    assert.equal(source.url, "https://www.youtube.com/watch?v=" + OTHER, "the cited URL is preserved verbatim");
    assert.equal(source.title, "Official recording", "the cited title is preserved verbatim");
    assert.equal(source.locator, "27:19", "the locator is preserved, not rebased onto another clock");
    assert.match(source.offlineReference, new RegExp(RETAINED), "the source note names the retained video");
    assert.equal(out.claims[0]!.status, "UNVERIFIED", "the claim leaning on the misbound source is downgraded");
    assert.match(out.claims[0]!.nextCheck, new RegExp(RETAINED), "the next check names the retained identity");
    assert.match(out.claims[0]!.nextCheck, new RegExp(OTHER), "the next check also names the cited upload");
  });

  it("holds a timestamped transcript source whose URL has no identifiable video", () => {
    const story = {
      id: "s1", headline: "h", draft: "d", plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "C1", text: "The motion passed at 27:19.", status: "VERIFIED" as const,
        sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Official meeting transcript", tier: "A" as const,
        url: "https://city.example/transcript.html", locator: "27:19", offlineReference: "" }],
    };
    const out = validatePacketSources(story as never, record());
    assert.equal(out.sources[0]!.url, "https://city.example/transcript.html", "the source URL is not rewritten");
    assert.equal(out.sources[0]!.locator, "27:19", "the cited locator is preserved verbatim");
    assert.match(out.sources[0]!.offlineReference, /no identifiable video id/i);
    assert.equal(out.claims[0]!.status, "UNVERIFIED");
    assert.match(out.claims[0]!.nextCheck, /transcript\.html/);
    assert.match(out.claims[0]!.nextCheck, new RegExp(RETAINED));
  });

  it("leaves a correctly-bound retained source alone, and never touches a different-recording source", () => {
    // The retained video's own link is the truth; it is left verbatim.
    const good = {
      id: "s1", headline: "h", draft: "d", plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "C1", text: "t", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Retained transcript", tier: "A" as const,
        url: "https://youtu.be/" + RETAINED + "?t=45", locator: "00:00:45, item 6A", offlineReference: "" }],
    };
    const out = validatePacketSources(good as never, record());
    assert.equal(out.sources[0]!.url, "https://youtu.be/" + RETAINED + "?t=45", "the retained source is untouched");
    assert.equal(out.claims[0]!.status, "VERIFIED", "a correctly-bound claim stays verified");
    assert.equal(out.claims[0]!.nextCheck, "", "nothing owed");
  });
  // guards: a timestamp on an editor-supplied summary could be mislabeled as a retained recording cite.
  it("keeps a time-coded action account separate from the retained video", () => {
    const story = {
      id: "s1", headline: "h", draft: "d", plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "C1", text: "The amendment passed.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Editor-supplied reconciled action account", tier: "B" as const,
        url: "", locator: "3:08:35–3:21:00", offlineReference: "Derivative action account supplied with this assignment." }],
    };
    const out = validatePacketSources(story as never, record());
    assert.equal(out.claims[0]!.status, "VERIFIED");
    assert.doesNotMatch(out.claims[0]!.nextCheck, /recording identity is not established/i);
    assert.equal(out.sources[0]!.offlineReference, "Derivative action account supplied with this assignment.");
  });
});

const ACTUAL_MEMO_PAGE_THREE = [
  "This budget does not include revenues or expenses that are part of a future implementation of the Rates",
  "and Charges Schedule, implementation of the VNAP improvement recommendations, or the Airport",
  "Visioning. These changes could be incorporated into a future appropriation or budget amendment.",
  "SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET",
  "Several changes have been made to the Proposed 2027 Budget since it was first presented to Council on",
  "September 1st. In total, these changes affected two funds, resulting in a net decrease of $1,183,625 in",
  "projected revenues and a $2,829,858 reduction in expenses. Following these changes, the revised total",
  "budget for 2027 is $544,645,951.",
  "GENERAL FUND",
  "Ongoing Budget Adjustments",
  "As mentioned previously, preliminary property tax certifications from the county came in $511,000 lower",
  "than originally anticipated. As a result, the General Fund needs to be adjusted to reflect a $511,000",
  "decrease in ongoing property tax revenue. This brings the new ongoing property tax amount to",
  "$29,698,908. Since the Human Services Agencies funding is based on 3% of budgeted tax revenue, the",
  "decrease in property tax results in a $15,330 decrease, bringing the 2027 proposed budget for Human",
  "Service Agency funding to $2,947,545. To balance the ongoing property tax reduction, staff is proposing",
  "to budget a “savings” of $495,670 in the non-departmental budget service. After the first of the year the",
  "City Manager and finance staff will begin meeting with departments to start the zero-based budgeting",
  "process. As part of those meetings staff will be identifying department line items where the savings for",
  "2027 will come from. Budget adjustments will be made to reduce the department budgets to offset this",
  "negative budget adjustment in the non-departmental budget service.",
  "One- Time Budget Adjustments",
  "The proposed General Fund budget includes a one-time transfer of $672,625 to the Public Improvement",
  "Fund for costs associated with the 1st and Main Transit Hub. These funds are instead needed in 2026",
  "and are therefore being removed from the proposed 2027 budget. An ordinance will come to council in",
  "October to appropriate this amount in 2026.",
  "These changes bring the General Fund 2027 proposed budget to $132,532,296.",
  "PUBLIC IMPROVEMENT FUND",
  "The above one-time transfer of $672,625 from the General Fund also needs to be removed as revenue",
  "from the Public Improvement Fund. In addition, the 2027 proposed budget included $1,646,233 set",
  "aside for CIP project TRP131, 1st and Main Transit Station Area Improvements. These funds are needed",
  "in 2026 to begin construction prior to year end and are therefore being removed from the proposed",
  "2027 budget. These funds will be included in the appropriation ordinance that will come to council in",
  "October.",
  "These changes bring the Public Improvement Fund 2027 proposed budget to $11,388,343.",
  "ATTACHMENTS:",
  "None",
].join("\n");

describe("scoped correction provenance survives contrary, scoring, and writing", () => {
  const correctionUrl = "https://city.example/memo.pdf";
  const correction = {
    id: 182,
    origin: "reporting",
    kind: "correction",
    text: "The Sept. 29 memo describes a PROPOSED $15,330 reduction in Human Service Agency funding to $2,947,545. The full memo also says $672,625 and $1,646,233 for First and Main are needed in 2026, with an October appropriation planned.",
    evidence: correctionUrl + " — Summary of Changes to the Proposed 2027 Budget, General Fund and Public Improvement Fund sections.",
    observedOn: null,
    createdAt: "Tue Oct 06 2026 00:06:09 GMT-0600 (Mountain Daylight Time)",
    scope: ["lead", "parent-request"],
    observedBy: null,
    reversalOf: null,
  };
  const memo: DocumentRead = {
    url: correctionUrl,
    title: "Council Communication 9-29-26",
    ok: true,
    text: ACTUAL_MEMO_PAGE_THREE,
    reason: "",
    pages: [{ page: 3, text: ACTUAL_MEMO_PAGE_THREE, layoutText: ACTUAL_MEMO_PAGE_THREE }],
  };
  const correctionFinding = "The dated editor correction saved with this lead is not among the documents read, so its source cannot be verified and it cannot be treated as an instruction beyond the desk's summary.";
  const reconcile = { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 };
  const record = { windows: [], segments: [], votes: [], gaps: [], identity: { videoId: "", videoUrl: "" } };
  const method = { text: "", version: "2.6.0" };

  it("reassesses only evidence-backed earlier findings and preserves the initial record", async () => {
    const text = "The changes affected two funds: General Fund and Public Improvement Fund. The revised proposed total is $544,645,951 after a $2,829,858 expense reduction from $547,475,809.";
    const document: DocumentRead = { ...memo, text, pages: [{ page: 3, text: "BUDGET CHANGES\n" + text, layoutText: "BUDGET CHANGES\n" + text }] };
    const initial = {
      contrary: [{ challenge: "The two funds are unnamed.", status: "unresolved", source: "Initial summary" }],
      unknowns: ["The $547,475,809 and $544,645,951 totals with $2,829,858 expense reduction cannot be reconciled.", "The $672,625 and $1,646,233 amounts may represent overlapping spending."],
      gaps: [], raw: { ok: true, error: "", text: "Original contrary reply", chars: 22, truncated: false },
    };
    const preserved = JSON.stringify(initial);
    const source = { url: correctionUrl, locator: "p.3, BUDGET CHANGES", quote: text };
    async function run(evidence: unknown[], malformed = false) {
      let calls = 0;
      const result = await reassessContraryAfterResearch({ previous: initial, documents: [document], assignment: "Report proposed budget changes", method: method as never,
        chat: (async (_system: string, prompt: string) => {
          calls++;
          assert.match(prompt, /EARLIER contrary findings/);
          assert.match(prompt, /ONLY resolved findings, at most six/);
          assert.match(prompt, /Omit every unresolved finding/);
          return { ok: true as const, text: malformed ? "malformed" : JSON.stringify({ findings: [
            { id: "c0", status: "resolved", explanation: "Both funds are named in the read record.", evidence },
            { id: "u0", status: "resolved", explanation: "547475809 minus2829858 equals544645951.", evidence },
            { id: "u1", status: "unresolved", explanation: "Numeric lines do not establish separate underlying spending.", evidence: [] },
          ] }) };
        }) as never, chatOpts: {}, workspaceDir: "", throwIfCancelled: async () => {},
      });
      assert.equal(calls, 1, "no repeated discovery, tape processing or repair loop");
      assert.equal(JSON.stringify(initial), preserved, "original findings and raw reply retained unchanged");
      return result;
    }
    const resolved = await run([source]);
    assert.equal(resolved.contrary.length, 0);
    assert.deepEqual(resolved.unknowns, [initial.unknowns[1]]);
    for (const evidence of [[], [{ ...source, locator: "p.4, BUDGET CHANGES" }], [{ ...source, quote: "Unrelated Airport operating expenses are not described in this budget record." }], [{ ...source, quote: "The revised proposed total is $544,645,951." }]]) {
      const result = await run(evidence);
      assert.equal(result.unknowns.length, 2, "missing, wrong-page, unrelated or incomplete arithmetic support stays open");
    }
    const malformed = await run([], true);
    assert.deepEqual(malformed.unknowns, initial.unknowns, "unreadable reassessment never clears prior concerns");
  });

  it("resolves the missing-correction finding against the saved row and its read source, retaining the raw model reply", async () => {
    const chat = (async () => ({
      ok: true as const,
      text: "```json\n" + JSON.stringify({ contrary: [{ challenge: correctionFinding, status: "unresolved", source: "No document contains the correction" }], unknowns: [correctionFinding] }) + "\n```",
    })) as never;
    const result = await contraryPass({
      record: record as never,
      documents: [memo],
      gather: { findings: "", observations: [correction] } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: reconcile as never,
      assignment: "Use the Sept. 29 correction",
      action: "Develop this lead",
      method: method as never,
      chat,
      chatOpts: {},
      workspaceDir: "",
      throwIfCancelled: async () => {},
    });
    assert.equal(result.contrary.length, 0, "a read source resolves the false retrieval challenge");
    assert.equal(result.unknowns.length, 0, "the false missing-row unknown does not flow to writing");
    assert.equal(result.observationProvenance?.[0]?.id, 182, "the pass receipt retains structured provenance");
    assert.deepEqual(result.guardedCorrectionFindings, [correctionFinding], "the guard records the exact assertion it resolved");
    assert.match(result.raw.text, /not among the documents read/, "the verbatim reply remains available for audit");
  });

  it("keeps a real support gap when the correction's cited document was not read", async () => {
    const chat = (async () => ({
      ok: true as const,
      text: "```json\n" + JSON.stringify({ contrary: [{ challenge: correctionFinding, status: "unresolved", source: "No document contains the correction" }], unknowns: [correctionFinding] }) + "\n```",
    })) as never;
    const result = await contraryPass({
      record: record as never,
      documents: [],
      gather: { findings: "", observations: [correction] } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: reconcile as never,
      assignment: "Use the Sept. 29 correction",
      action: "Develop this lead",
      method: method as never,
      chat,
      chatOpts: {},
      workspaceDir: "",
      throwIfCancelled: async () => {},
    });
    assert.equal(result.contrary.length, 1, "the underlying evidence gap remains contrary material");
    assert.match(result.contrary[0]!.challenge, /correction #182 is present/i, "the wording distinguishes retrieval from support");
    assert.match(result.contrary[0]!.challenge, /cited source has not been read/i, "the unavailable source remains explicit");
    assert.doesNotMatch(result.contrary[0]!.challenge, /not among the documents read/i, "the correction itself is not called missing");
  });

  it("passes observation ID, scope, and cited evidence into scoring and corrects stale rationale", async () => {
    let prompt = "";
    const result = await scoringPass({
      record: record as never,
      documents: [memo],
      gather: { findings: "", observations: [correction] } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: reconcile as never,
      contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
      further: { findings: "", documents: [memo], gaps: [] },
      assignment: "Use the Sept. 29 correction",
      action: "Develop this lead",
      city: "Longmont",
      method: method as never,
      chat: (async (_system: string, user: string) => {
        prompt = user;
        return { ok: true, text: "```json\n{\"score\":{\"immediacy\":3,\"impact\":4,\"conflict\":2,\"novelty\":3},\"readiness\":2,\"why\":" + JSON.stringify(correctionFinding) + "}\n```" };
      }) as never,
      chatOpts: {},
      workspaceDir: "",
      throwIfCancelled: async () => {},
    });
    assert.match(prompt, /"observationId":182/, "scoring receives the correction row ID");
    assert.match(prompt, /"scope":\["lead","parent-request"\]/, "scoring receives the matched scope");
    assert.match(prompt, /Council Communication 9-29-26|https:\/\/city\.example\/memo\.pdf/, "scoring receives the supporting reference");
    assert.match(result.why, /correction #182 is present/i, "scoring output no longer describes the row as missing");
    assert.match(result.why, /does not establish factual support/i, "retrieval is not reported as corroboration");
    assert.doesNotMatch(result.why, /specific details were found/i);
    assert.doesNotMatch(result.why, /not among the documents read/i, "the stale availability assertion is removed");
    assert.equal(result.observationProvenance?.[0]?.id, 182);
  });

  // guards: the editor could be shown a different idea's hold reason for a rejected draft.
  it("files an overlength revision with its assignment gap", async () => {
    async function run(revisedWords: number) {
      let calls = 0;
      const result = await writingPass({
        record: record as never, documents: [memo], further: { findings: "", documents: [memo], gaps: [] },
        gather: { findings: "", observations: [correction] } as never,
        warm: { actions: [], windows: [], gaps: [] } as never, cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
        reconcile: reconcile as never,
        contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
        scoring: { score: null, readiness: 0, why: "", gaps: [] }, assignment: "Write a 400–800 word story.",
        action: "Develop this lead", city: "Longmont", method: method as never, chatOpts: {}, workspaceDir: "", throwIfCancelled: async () => {},
        chat: (async (_system: string, prompt: string) => {
          assert.match(prompt, /Draft length target: 600 words/);
          assert.match(prompt, /Numerical equality alone does not establish a funding relationship/);
          const count = calls++ === 0 ? 1086 : revisedWords;
          if (calls === 2) {
            assert.match(prompt, /1086 words.*400–800/);
            assert.match(prompt, /EDITORIAL LENGTH REVISION/);
            assert.match(prompt, /substantial editorial cut/);
            assert.match(prompt, /Human Service Agency funding/);
          }
          return { ok: true as const, text: JSON.stringify({ stories: [{ id: "s1", headline: "Proposal", dek: `${Array(25).fill("word").join(" ")}.`, draft: Array(count).fill("word").join(" "), plainBrief: "", cannotSay: "Pending ordinance", readinessTier: 2, claims: [], sources: [] }], held: count > 800 ? [{ storyId: "other-idea", headline: "Library parking", reason: "The library parking idea still needs its parcel count.", nextCheck: "Check parcel count", unverified: true }] : [] }) };
        }) as never,
      });
      assert.equal(calls, 2, "exactly one revision, never an unbounded retry loop");
      return result;
    }
    const revised = await run(700);
    assert.equal(revised.stories[0]!.draft.split(/\s+/).length, 700);
    assert.equal(revised.stories[0]!.cannotSay, "Pending ordinance");
    const refused = await run(860);
    assert.equal(refused.stories.length, 1, "keep the readable revision for the editor");
    assert.equal(refused.error, "");
    assert.match(refused.gaps.join(" "), /requested word range after one revision/);
    assert.ok(refused.held.some((entry) => entry.storyId === "s1" && /requested word range/.test(entry.reason)));
    assert.doesNotMatch(refused.error, /library parking idea/);
  });

  it("removes only a false final hold, while keeping unavailable support and genuine disagreement", async () => {
    async function runWriter(documents: DocumentRead[], reason: string, malformedReplies = 0) {
      let calls = 0;
      const reply = {
        stories: [{ id: "story-1", headline: "Budget proposal", dek: "The council proposed a new airport-noise plan for neighbors living near the runway and will hold a public hearing before it adopts any changes.", draft: "The city council proposed a new airport-noise plan for neighbors near the runway and will hold a public hearing before adopting any changes. It remains open for comment.", plainBrief: "", cannotSay: "", readinessTier: 2, claims: [], sources: [] }],
        held: [{ storyId: "story-1", headline: "Budget proposal", reason, nextCheck: reason, unverified: true }],
      };
      return writingPass({
        record: record as never,
        documents,
        further: { findings: "", documents, gaps: [] },
        gather: { findings: "", observations: [correction] } as never,
        warm: { actions: [], windows: [], gaps: [] } as never,
        cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
        reconcile: reconcile as never,
        contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
        scoring: { score: null, readiness: 0, why: "", gaps: [] },
        assignment: "Use the Sept. 29 correction",
        action: "Develop this lead",
        city: "Longmont",
        method: method as never,
        chat: (async () => ({ ok: true as const, text: calls++ < malformedReplies ? "```json\n{broken" : "```json\n" + JSON.stringify(reply) + "\n```" })) as never,
        chatOpts: {},
        workspaceDir: "",
        throwIfCancelled: async () => {},
      });
    }

    const available = await runWriter([memo], correctionFinding);
    assert.equal(available.held.length, 0, "the final package does not inherit a hold for a retrieved, sourced correction");

    const unavailable = await runWriter([], correctionFinding);
    assert.equal(unavailable.held.length, 1, "a source gap still holds the story");
    assert.match(unavailable.held[0]!.reason, /correction #182 is present/i, "the hold names the correction as retrieved");
    assert.match(unavailable.held[0]!.reason, /support remains unresolved/i, "the missing support remains the reason");

    const disagreement = await runWriter([memo], correctionFinding.replace("and it cannot be treated as an instruction beyond the desk's summary", "but the memo contradicts the correction"));
    assert.equal(disagreement.held.length, 1, "a real evidence conflict is not removed by the availability guard");
    assert.match(disagreement.held[0]!.reason, /evidence concern to assess/i);
    assert.match(disagreement.held[0]!.reason, /memo contradicts the correction/i);

    const unresolvedDate = await runWriter([memo], correctionFinding.replace(
      "and it cannot be treated as an instruction beyond the desk's summary",
      "and the October ordinance date has not been confirmed",
    ));
    assert.equal(unresolvedDate.held.length, 1, "a separate date gap is not removed with the false retrieval assertion");
    assert.match(unresolvedDate.held[0]!.reason, /correction #182 is present/i);
    assert.match(unresolvedDate.held[0]!.reason, /October ordinance date has not been confirmed/i);

    const repairedFormatting = await runWriter([memo], correctionFinding, 1);
    assert.equal(repairedFormatting.stories.length, 1, "one formatting repair recovers the existing writer story");
    const unrecoverableFormatting = await runWriter([memo], correctionFinding, 2);
    assert.equal(unrecoverableFormatting.stories.length, 0, "a second malformed reply remains failed rather than inventing copy");
    assert.match(unrecoverableFormatting.error, /did not parse as JSON/i);
  });
});

describe("document-only claims bind to their own cited PDF section", () => {
  const RETAINED = "zMglXtVlIMA";
  const OTHER = "fWMTQj830Ho";
  const record = { segments: [], identity: { videoId: "meeting-video", videoUrl: "https://youtu.be/meeting-video" } } as never;
  const noActions = { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 } as never;
  const url = "https://city.example/memo.pdf";
  const pageText = ACTUAL_MEMO_PAGE_THREE.replace(/\s+/g, " ").trim();
  const memoDocument = {
    url, title: "Proposed budget memo", ok: true, text: pageText, reason: "",
    pages: [{ page: 3, text: pageText, layoutText: ACTUAL_MEMO_PAGE_THREE }],
  };

  for (const [heading, locator] of [
    ["SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET", "p. 3, SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET"],
    ["2027 PROPOSED BUDGET", "slide 3, 2027 PROPOSED BUDGET"],
  ]) it("recognizes the explicit documentary locator " + locator, () => {
    const text = heading + "\nThe revised proposed total budget is $544,645,951.\n";
    const document = { ...memoDocument, text, pages: [{ page: 3, text, layoutText: text }] };
    const story = {
      id: "locator-format", headline: "Budget", draft: "", plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{ id: "C1", item: heading, text: "The revised proposed total budget is $544,645,951.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Budget memo", tier: "A" as const, url, locator, offlineReference: "" }],
    };
    const checked = bindStoryClaimsToEvidence(story as never, noActions, record, [document]);
    assert.equal(checked.claims![0]!.status, "VERIFIED", checked.claims![0]!.nextCheck);
    assert.equal(checked.sources![0]!.locator, "p. 3, " + heading);
    const wrongPage = { ...story, sources: [{ ...story.sources[0]!, locator: locator.replace(/3/, "4") }] };
    assert.equal(bindClaimsToEvidence(wrongPage as never, noActions, record, [document])[0]!.status, "UNVERIFIED", "a supported heading never permits the wrong page");
  });

  it("supports both HSA figures from the actual paragraph in Ongoing Budget Adjustments", () => {
    const story = {
      id: "s1", headline: "Budget proposal", draft: "The proposed 2027 budget would reduce Human Service Agency funding by $15,330 to $2,947,545.",
      plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{ id: "C1", item: "Human Service Agency funding", text: "The proposed 2027 budget would reduce Human Service Agency funding by $15,330 to $2,947,545.",
        status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Proposed budget memo", tier: "A" as const, url,
        locator: "p. 3, Ongoing Budget Adjustments", offlineReference: "" }],
    };
    const claims = bindClaimsToEvidence(story as never, noActions, record, [memoDocument]);
    assert.equal(claims[0]!.status, "VERIFIED", claims[0]!.nextCheck);
    assert.equal(claims[0]!.nextCheck, "", "document evidence supports proposed figures without claiming a meeting vote");
  });

  // guards: cited figures and dates from the meeting record are falsely marked absent when their ledger item cannot resolve.
  it("binds cited transcript figures and dates to their spoken windows", () => {
    const video = "S1kSaew-UUY";
    const record = { identity: { videoId: video, videoUrl: "https://www.youtube.com/watch?v=" + video }, segments: [
      { index: 1, seconds: 14235, item: "12A", itemTitle: "Budget", text: "Funding for this project would be 916,000 for 2027." },
      { index: 2, seconds: 11328, item: "11", itemTitle: "Ordinance 2026-69", text: "The hazardous vegetation work must be completed by May 1, 2027." },
      { index: 3, seconds: 11369, item: "11", itemTitle: "Ordinance 2026-69", text: "May 1, 2027 is the deadline for the mitigation." },
    ] };
    const story = {
      id: "run-3", headline: "Budget and ordinance", draft: "", plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [
        { id: "C02", item: "12A", text: "Staff said the proposed project 103 allocation would be $916,000 for 2027.", status: "VERIFIED" as const, sourceIds: ["S02"], nextCheck: "" },
        { id: "C04", item: "11; ordinance 2026-69", text: "A seconded amendment to ordinance 2026-69 proposed mitigation by May 1, 2027.", status: "VERIFIED" as const, sourceIds: ["S04"], nextCheck: "" },
        { id: "C06", item: "12A", text: "The proposed project 103 allocation would be $916,000 for 2027.", status: "VERIFIED" as const, sourceIds: ["S06"], nextCheck: "" },
      ],
      sources: [
        { id: "S02", title: "Supplied transcript, Window 15", tier: "A" as const, url: "https://www.youtube.com/watch?v=" + video, locator: "Item 12A; remaining proposed project allocation; 3:57:13–3:57:20", offlineReference: "" },
        { id: "S04", title: "Supplied transcript, Window 12", tier: "A" as const, url: "https://www.youtube.com/watch?v=" + video, locator: "Item 11; ordinance 2026-69; fire-condition motion; 3:08:35–3:09:48", offlineReference: "" },
        { id: "S06", title: "Supplied transcript, Window 12", tier: "A" as const, url: "https://www.youtube.com/watch?v=" + video, locator: "Item 12A; unrelated passage; 3:08:35–3:09:48", offlineReference: "" },
      ],
    };
    const unrelatedAction = {
      actionId: "allocation", timestamp: "3:57:13", agendaItem: "12A", motionOrAction: "Remaining project allocation", outcome: "discussed",
      vote: "unverified", policyStage: "discussion", evidence: "transcript", disposition: "",
    } as CoverageAction;
    const reconcile = { actions: [unrelatedAction], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 };
    const claims = bindClaimsToEvidence(story as never, reconcile as never, record as never, []);
    assert.deepEqual(claims.map((claim) => [claim.id, claim.status]), [["C02", "VERIFIED"], ["C04", "VERIFIED"], ["C06", "VERIFIED"]]);
  });

  it("binds request 7 claims C1-C5, C8-C9, and C16 to precise sections in their combined locators", () => {
    const memoPageTwo = [
      "AIRPORT BUDGET SUMMARY",
      "The 2027 proposed Airport Fund budget totals $733,170. This is a $7,796 (1.07%) increase from the 2026 adopted budget of $725,377.",
      "The Airport Fund pays for expenses associated with maintaining and improving Vance Brand Municipal Airport.",
    ].join("\n");
    const memoPages: DocumentRead = {
      url,
      title: "City Council Communication, Sept. 29, 2026 — 2027 Proposed Budget Presentation and First Public Hearing",
      ok: true,
      text: memoPageTwo + "\n" + ACTUAL_MEMO_PAGE_THREE,
      reason: "",
      pages: [
        { page: 2, text: memoPageTwo, layoutText: memoPageTwo },
        { page: 3, text: ACTUAL_MEMO_PAGE_THREE, layoutText: ACTUAL_MEMO_PAGE_THREE },
      ],
    };
    const gfPage = [
      "GENERAL FUND CHANGES",
      "UPDATED PROPOSED BUDGET PROPOSED CHANGES ORIGINAL PROPOSED BUDGET",
      "Revenues $126,988,855 ($511,000) $127,499,855",
      "Expenses $132,532,296 ($1,183,625) $133,715,921",
      "Use of Fund Balance $5,543,441 ($672,625) $6,216,066",
      "Revenue Changes: $511,000 reduction in ongoing property taxes",
      "Expense Changes: $15,330 reduction for Human Services Agency funding; $495,670 reduction for budget savings; $672,625 reduction for one-time transfer to Public Improvement Fund",
    ].join("\n");
    const pifPage = [
      "PUBLIC IMPROVEMENT FUND CHANGES",
      "UPDATED PROPOSED BUDGET PROPOSED CHANGES ORIGINAL PROPOSED BUDGET",
      "Revenues $10,720,663 ($672,625) $11,393,288",
      "Expenses $11,388,343 ($1,646,233) $13,034,576",
      "Use of Fund Balance $667,680 ($973,608) $1,641,288",
      "Revenue Changes: $672,625 reduction in transfers from General Fund",
      "Expense Changes: $1,646,233 reduction in expense set aside for TRP131 1st and Main Transit Facility",
    ].join("\n");
    const presentation: DocumentRead = {
      url: "https://city.example/budget-presentation.pdf",
      title: "2027 Proposed Budget Presentation, Sept. 29, 2026",
      ok: true,
      text: gfPage + "\n" + pifPage,
      reason: "",
      pages: [
        { page: 27, text: gfPage, layoutText: gfPage },
        { page: 28, text: pifPage, layoutText: pifPage },
      ],
    };
    const story = {
      id: "request-7",
      headline: "Proposed budget changes",
      draft: "Documentary claims from the Sept. 29 proposal.",
      plainBrief: "",
      cannotSay: "",
      readinessTier: 2,
      claims: [
        { id: "C1", item: "Summary of Changes to the Proposed 2027 Budget — General Fund, Ongoing Budget Adjustments", text: "Preliminary county property tax certifications came in $511,000 lower than anticipated, reducing General Fund ongoing property tax revenue to $29,698,908.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C2", item: "Summary of Changes to the Proposed 2027 Budget — General Fund, Ongoing Budget Adjustments", text: "Because Human Services Agencies funding is based on 3% of budgeted tax revenue, the property tax decrease results in a $15,330 decrease, bringing the 2027 proposed Human Service Agency funding to $2,947,545.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C3", item: "Summary of Changes to the Proposed 2027 Budget — General Fund, Ongoing Budget Adjustments", text: "Staff is proposing to budget a 'savings' of $495,670 in the non-departmental budget service, with department line items to be identified after the first of the year during zero-based budgeting.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C4", item: "Summary of Changes to the Proposed 2027 Budget — General Fund, One-Time Budget Adjustments", text: "The proposed General Fund budget included a one-time transfer of $672,625 to the Public Improvement Fund for 1st and Main Transit Hub costs; those funds are needed in 2026 and are being removed from the proposed 2027 budget, with an ordinance to appropriate the amount in 2026 coming in October.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C5", item: "Summary of Changes to the Proposed 2027 Budget — Public Improvement Fund", text: "The 2027 proposed budget included $1,646,233 set aside for CIP project TRP131, 1st and Main Transit Station Area Improvements; those funds are needed in 2026 to begin construction before year end and will be included in the October appropriation ordinance.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C6", item: "Summary of Changes to the Proposed 2027 Budget — General Fund, One-Time Budget Adjustments and Public Improvement Fund", text: "The $672,625 is a General Fund transfer that also appears as Public Improvement Fund revenue, and the $1,646,233 is a CIP set-aside for the same 1st and Main project; the documents do not establish them as two separate spending items.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C7", item: "Summary of Changes to the Proposed 2027 Budget — opening paragraph, General Fund, Public Improvement Fund", text: "Following the changes, the revised total budget for 2027 is $544,645,951; the General Fund 2027 proposed budget is $132,532,296 and the Public Improvement Fund 2027 proposed budget is $11,388,343.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
        { id: "C8", item: "General Fund Changes table", text: "The Sept. 29 presentation's General Fund change table shows a $511,000 revenue reduction, a $15,330 reduction for Human Services Agency funding, a $495,670 reduction for the budget 'savings' adjustment, and a $672,625 reduction for the one-time transfer to the Public Improvement Fund.", status: "VERIFIED" as const, sourceIds: ["S2"], nextCheck: "" },
        { id: "C9", item: "Public Improvement Fund Changes table", text: "The Sept. 29 presentation's Public Improvement Fund change table shows a $672,625 reduction in transfers from the General Fund and a $1,646,233 reduction in expense set aside for TRP131 1st and Main Transit Facility.", status: "VERIFIED" as const, sourceIds: ["S2"], nextCheck: "" },
        { id: "C16", item: "Airport Budget Summary", text: "The Sept. 29 memo states the 2027 proposed Airport Fund budget totals $733,170, described as a $7,796 (1.07%) increase from the 2026 adopted budget of $725,377.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" },
      ],
      sources: [
        { id: "S1", title: memoPages.title, tier: "A" as const, url, locator: "Page 3, 'SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET' — General Fund Ongoing Budget Adjustments; General Fund One-Time Budget Adjustments; Public Improvement Fund. Page 2, 'AIRPORT BUDGET SUMMARY'.", offlineReference: "" },
        { id: "S2", title: presentation.title, tier: "A" as const, url: presentation.url, locator: "Page 27, 'GENERAL FUND CHANGES' table and revenue/expense change bullets; page 28, 'PUBLIC IMPROVEMENT FUND CHANGES' table and change bullets; page 25, 'AIRPORT FUND BUDGET SUMMARY'; page 31, 'BUDGET MEETINGS'.", offlineReference: "" },
      ],
    };
    const result = bindStoryClaimsToEvidence(story as never, noActions, record, [memoPages, presentation]);
    const expected = new Map([
      ["C1", "p. 3, Ongoing Budget Adjustments"],
      ["C2", "p. 3, Ongoing Budget Adjustments"],
      ["C3", "p. 3, Ongoing Budget Adjustments"],
      ["C4", "p. 3, One- Time Budget Adjustments"],
      ["C5", "p. 3, PUBLIC IMPROVEMENT FUND"],
      ["C8", "p. 27, GENERAL FUND CHANGES"],
      ["C9", "p. 28, PUBLIC IMPROVEMENT FUND CHANGES"],
      ["C16", "p. 2, AIRPORT BUDGET SUMMARY"],
    ]);
    for (const [claimId, locator] of expected) {
      const claim = result.claims.find((row) => row.id === claimId)!;
      assert.equal(claim.status, "VERIFIED", claimId + ": " + claim.nextCheck);
      assert.equal(claim.sourceIds.length, 1, claimId + " resolves to one claim-specific document reference");
      assert.equal(result.sources.find((source) => source.id === claim.sourceIds[0])?.locator, locator, claimId + " exposes the precise locator in the package");
    }
    for (const claimId of ["C6", "C7"]) {
      assert.equal(result.claims.find((row) => row.id === claimId)?.status, "UNVERIFIED", claimId + " remains held as a composite claim");
    }

    const negative = bindClaimsToEvidence({
      id: "negative-budget-claims", headline: "Budget", draft: "",
      claims: [
        { id: "wrong-page", item: "Human Service Agency funding", text: "The proposed funding decreases by $15,330 to $2,947,545.", status: "VERIFIED" as const, sourceIds: ["wrong-page-source"], nextCheck: "" },
        { id: "wrong-subject", item: "Airport funding", text: "The proposed Airport funding decreases by $15,330.", status: "VERIFIED" as const, sourceIds: ["wrong-subject-source"], nextCheck: "" },
        { id: "proposal-is-not-vote", item: "Human Service Agency funding", text: "Council approved the proposed $15,330 reduction by a 7-0 vote.", status: "VERIFIED" as const, sourceIds: ["vote-source"], nextCheck: "" },
      ],
      sources: [
        { id: "wrong-page-source", title: memoPages.title, tier: "A" as const, url, locator: "Page 2, 'Ongoing Budget Adjustments'", offlineReference: "" },
        { id: "wrong-subject-source", title: memoPages.title, tier: "A" as const, url, locator: "Page 3, 'Ongoing Budget Adjustments'", offlineReference: "" },
        { id: "vote-source", title: memoPages.title, tier: "A" as const, url, locator: "Page 3, 'Ongoing Budget Adjustments'", offlineReference: "" },
      ],
    } as never, noActions, record, [memoPages]);
    assert.ok(negative.every((claim) => claim.status === "UNVERIFIED"), "wrong page, wrong subject, and proposal-as-vote claims remain held");

    const wrongSameSectionFigure = bindClaimsToEvidence({
      id: "wrong-same-section-figure", headline: "HSA funding", draft: "",
      claims: [{ id: "wrong-hsa-figure", item: "Human Service Agency funding", text: "Human Service Agency funding fell by $511,000.", status: "VERIFIED" as const, sourceIds: ["same-section-source"], nextCheck: "" }],
      sources: [{ id: "same-section-source", title: memoPages.title, tier: "A" as const, url, locator: "Page 3, 'Ongoing Budget Adjustments'", offlineReference: "" }],
    } as never, noActions, record, [memoPages]);
    assert.equal(wrongSameSectionFigure[0]!.status, "UNVERIFIED", "a property-tax figure in the same section cannot verify HSA funding");
    assert.match(wrongSameSectionFigure[0]!.nextCheck, /not near the claim's named item/i);

    const withWrongClock = bindStoryClaimsToEvidence({
      id: "mixed-source", headline: "Budget", draft: "The proposed HSA reduction is $15,330 to $2,947,545.", plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "mixed", item: "Human Service Agency funding — Ongoing Budget Adjustments", text: "The proposed HSA reduction is $15,330 to $2,947,545, at 27:19 in the meeting.", status: "VERIFIED" as const, sourceIds: ["S1", "S3"], nextCheck: "" }],
      sources: [
        { id: "S1", title: memoPages.title, tier: "A" as const, url, locator: "Page 3, 'SUMMARY OF CHANGES TO THE PROPOSED 2027 BUDGET' — General Fund Ongoing Budget Adjustments; General Fund One-Time Budget Adjustments; Public Improvement Fund. Page 2, 'AIRPORT BUDGET SUMMARY'.", offlineReference: "" },
        { id: "S3", title: "Official meeting recording", tier: "A" as const, url: "https://www.youtube.com/watch?v=" + OTHER, locator: "27:19", offlineReference: "" },
      ],
    } as never, noActions, { segments: [], identity: { videoId: RETAINED, videoUrl: "https://www.youtube.com/watch?v=" + RETAINED } } as never, [memoPages]);
    assert.ok(withWrongClock.claims[0]!.sourceIds.includes("S3"), "PDF normalization retains the separately cited recording");
    const validatedMixed = validatePacketSources(withWrongClock, { segments: [], identity: { videoId: RETAINED, videoUrl: "https://www.youtube.com/watch?v=" + RETAINED } } as never);
    assert.equal(validatedMixed.claims[0]!.status, "UNVERIFIED", "the later wrong-recording guard still sees the original cited URL");
    assert.ok(validatedMixed.sources.some((source) => source.id === "S3" && source.url.endsWith(OTHER)), "the source identity remains visible");
  });

  it("reports unresolved cited HTML as document support, not as an absent meeting-ledger item", () => {
    const calendar: DocumentRead = {
      url: "https://city.example/budget-calendar.html",
      title: "2027 Budget Documents",
      ok: true,
      text: "October 6 – Regular Meeting: final direction from Council; second public hearing; first reading of mill levy ordinances.",
      reason: "",
      pages: [],
    };
    const claims = bindClaimsToEvidence({
      id: "calendar", headline: "Budget schedule", draft: "The city lists a second public hearing on Oct. 6.",
      claims: [{ id: "C10", item: "October 6 Regular Meeting listing", text: "The budget calendar lists a second public hearing for October 6.", status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: calendar.title, tier: "A" as const, url: calendar.url, locator: "Meeting schedule entries for October 6", offlineReference: "" }],
    } as never, noActions, record, [calendar]);
    assert.equal(claims[0]!.status, "UNVERIFIED", "an unresolved HTML locator is not bulk-upgraded");
    assert.match(claims[0]!.nextCheck, /read Tier A document.*locator did not resolve/i);
    assert.doesNotMatch(claims[0]!.nextCheck, /not in this meeting's reconciled ledger/i);
  });

  it("does not let an Airport claim borrow the HSA reduction from the same PDF page", () => {
    const story = {
      id: "s1", headline: "Airport change", draft: "The proposed Airport funding would decrease by $15,330.",
      plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "C1", item: "Airport funding", text: "The proposed Airport funding would decrease by $15,330.",
        status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Proposed budget memo", tier: "A" as const, url,
        locator: "p. 3, Ongoing Budget Adjustments", offlineReference: "" }],
    };
    const claims = bindClaimsToEvidence(story as never, noActions, record, [memoDocument]);
    assert.equal(claims[0]!.status, "UNVERIFIED");
  });

  it("does not let a proposal document verify a council vote or adoption", () => {
    const story = {
      id: "s1", headline: "Budget adoption", draft: "Council approved the proposed $15,330 reduction by a 7-0 vote.",
      plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "C1", item: "Human Service Agency funding", text: "Council approved the proposed $15,330 reduction by a 7-0 vote.",
        status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Proposed budget memo", tier: "A" as const, url,
        locator: "p. 3, Ongoing Budget Adjustments", offlineReference: "" }],
    };
    const claims = bindClaimsToEvidence(story as never, noActions, record, [memoDocument]);
    assert.equal(claims[0]!.status, "UNVERIFIED");
    assert.match(claims[0]!.nextCheck, /Vote word not found in this item's record/i);
  });

  it("leaves a multi-section source locator unresolved instead of treating the whole page as evidence", () => {
    const story = {
      id: "s1", headline: "Budget changes", draft: "Funding would change by $15,330.",
      plainBrief: "", cannotSay: "", readinessTier: 2,
      claims: [{ id: "C1", item: "Human Service Agency funding", text: "Funding would change by $15,330.",
        status: "VERIFIED" as const, sourceIds: ["S1"], nextCheck: "" }],
      sources: [{ id: "S1", title: "Proposed budget memo", tier: "A" as const, url,
        locator: "p. 3, Airport / General Fund / Human Services", offlineReference: "" }],
    };
    const claims = bindClaimsToEvidence(story as never, noActions, record, [memoDocument]);
    assert.equal(claims[0]!.status, "UNVERIFIED");
  });
});

/*
  FINISHING A RUN MUST NOT EAT THE ENQUEUE MODEL PIN.

  `finishJob` writes the terminal `result_json`. The naive write
  (`{leadIds, filed}`) REPLACES the canonical runtime/effort pin `enqueueJob`
  stored there -- which is how job 323's none/local receipt became `{leadIds,
  filed}`. The regression: seed a real canonical pin, run a real finish, and
  read BOTH halves back -- the filing pointers AND the `none`/local pin.
*/
describe("finishing preserves the canonical model pin", () => {
  it("keeps the exact model id/endpoint/effort and a user-friendly label in the receipt", () => {
    const receipt = canonicalModelReceipt({
      prior: initialModelRuntimeReceipt({
        requestedRuntime: "auto",
        requestedEffort: "none",
        actualRuntime: "local-model",
        actualEffort: "none",
        localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
      }),
      requested: "auto",
      effective: "local-model",
      label: "LLM",
      localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" },
      effort: "none",
      reason: "",
    });
    // Canonical pin survives.
    assert.equal(receipt.actualRuntime, "local-model", "the canonical runtime pin survives");
    assert.equal(receipt.modelEffort, "none", "the canonical effort pin survives");
    assert.equal((receipt.localModel as { id: string }).id, "deepseek-v4.1-flash:cloud", "the exact model id survives");
    assert.equal((receipt.localModel as { baseUrl: string }).baseUrl, "http://127.0.0.1:11434/v1", "the exact endpoint survives");
    // The editor sees a real model, not "LLM".
    assert.notEqual(receipt.label, "LLM", "the generic label is replaced");
    assert.match(String(receipt.label), /DeepSeek/i, "the label names the model the editor should see");
  });
});

// guards: irrelevant discussion can overflow the writer input and displace announced votes.
it("keeps whole announced-result passages within the writer budget in time order", () => {
  const segments = Array.from({ length: 30 }, (_, index) => ({ index, seconds: index * 300,
    item: "12A", itemTitle: "", text: index === 0 ? "Please approve a bus pass." :
      `The motion carries unanimously. Result ${index}. ` + "context ".repeat(500) }));
  const windows = [...segments].reverse().map((segment) => ({ windowIndex: segment.index,
    startClock: "0:00", endClock: "0:00", segments: [segment], items: [] }));
  const block = writerDecisionWindowEvidence({ windows } as never);
  assert.ok(block.length <= 20_000, `writer received ${block.length} characters`);
  assert.ok(!block.includes(segments[0]!.text));
  assert.deepEqual(block.match(/Result \d+\./g), ["Result 1.", "Result 2.", "Result 3.", "Result 4."]);
  for (const segment of segments.slice(1, 5)) assert.ok(block.includes(segment.text));
});

// guards: an imprecise transcript citation can erase a claim's already verified ledger evidence.
it("keeps ledger verification when a transcript citation misses the item's passages", () => {
  const video = "S1kSaew-UUY";
  const record = { identity: { videoId: video }, segments: [
    { index: 1, seconds: 60, item: "12A", itemTitle: "Budget", text: "The allocation is $916,000." } ] };
  const action = { agendaItem: "12A", timestamp: "1:00", motionOrAction: "Allocation", vote: "unverified" };
  const claim = { id: "allocation", item: "12A", text: "The allocation is $916,000.", status: "VERIFIED", sourceIds: ["tape"], nextCheck: "" };
  const sources = [{ id: "tape", title: "Supplied transcript", tier: "A", url: "https://youtu.be/" + video,
    locator: "Item 12A; 2:00:00–2:01:00", offlineReference: "" }];
  const checked = bindClaimsToEvidence({ claims: [claim], sources } as never,
    { actions: [action] } as never, record as never, []);
  assert.equal(checked[0]!.status, "VERIFIED", checked[0]!.nextCheck);
});

// guards: an unresolved claim could be filed without searching the full retained record and read packet.
it("checks an unresolved claim against the full transcript and already-read documents once", async () => {
  const videoId = "S1kSaew-UUY";
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const claim = "The council approved $45,000 for creek repairs.";
  const chatOpts = { choice: "pinned-model", reasoningEffort: "high" };
  let calls = 0;
  const chat = async (_system: string, prompt: string, tokens: number, opts: unknown) => {
    calls += 1;
    assert.equal(tokens, 3_000);
    assert.equal(opts, chatOpts);
    assert.match(prompt, /MEETING IDENTITY:.*City Council regular session/s);
    assert.match(prompt, /NEXT CHECK NOTE: Find the amount in the record\./);
    assert.match(prompt, /ALREADY-READ DOCUMENTS:.*Budget packet/s);
    assert.match(prompt, new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return { ok: true, text: JSON.stringify({
      verdict: "VERIFIED", quote: claim, sourceKind: "transcript", sourceUrl: videoUrl,
      replacement: "", cut: false, reason: "The full meeting transcript says the same amount.",
    }) };
  };
  const result = await reviewOpenStoryClaims({
    story: {
      id: "repairs", headline: "Council takes up creek work", draft: claim, plainBrief: "", cannotSay: "",
      readinessTier: 1,
      claims: [{ id: "C1", text: claim, status: "UNVERIFIED", sourceIds: [], nextCheck: "Find the amount in the record.", item: "5" }],
      sources: [],
    },
    record: {
      identity: { videoId, videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments: [
        { index: 1, seconds: 100, item: "5", itemTitle: "Old item", text: "Unrelated opening comments." },
        { index: 2, seconds: 12_345, item: "11", itemTitle: "Creek repairs", text: claim },
      ],
    } as never,
    documents: [{ url: "https://city.test/budget.pdf", title: "Budget packet", ok: true, text: "The packet was read.", reason: "" }],
    method: { version: "test", text: "Use records only." } as never,
    chat: chat as never,
    chatOpts,
    throwIfCancelled: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.claims[0]?.status, "VERIFIED");
  assert.deepEqual(result.claims[0]?.transcriptEvidence, { quote: claim, startSeconds: 12_345, videoUrl });
  assert.equal(result.claims[0]?.item, "11");
});

// guards: an editor could be left with an open fact when its disposition is later in the retained transcript.
it("finds a motion's delayed result after its cited window", async () => {
  const videoUrl = "https://www.youtube.com/watch?v=S1kSaew-UUY";
  const claim = "The Copper Peak concept plan amendment includes a 50% for-sale housing requirement; the motion dies for lack of a second.";
  const opening = "Copper Peak concept plan amendment includes a 50% for-sale housing requirement.";
  const result = "The motion dies for lack of a second.";
  const segments = [
    { index: 1, seconds: 100, item: "9I", itemTitle: "Copper Peak", text: opening },
    ...Array.from({ length: 40 }, (_, index) => ({
      index: index + 2, seconds: 110 + index * 10, item: "9I", itemTitle: "Copper Peak", text: "Council discussed another agenda detail.",
    })),
    { index: 42, seconds: 510, item: "9I", itemTitle: "Copper Peak", text: result },
  ];
  const checked = await reviewOpenStoryClaims({
    story: {
      id: "copper-peak", headline: "Council considers Copper Peak", draft: claim,
      plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{
        id: "C18", text: claim, status: "UNVERIFIED", sourceIds: [], nextCheck: "Recheck the cited passage at 00:01:40.",
        closestEvidence: { kind: "transcript", quote: opening, url: videoUrl, locator: "Item 9I; 00:01:40", startSeconds: 100 },
      }],
      sources: [],
    },
    record: {
      identity: { videoId: "S1kSaew-UUY", videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments,
    } as never,
    documents: [],
    method: { version: "test", text: "Use records only." } as never,
    chat: (async (_system: string, prompt: string) => {
      const marker = "CLOSEST FULL-TRANSCRIPT PASSAGES: ";
      const start = prompt.indexOf(marker) + marker.length;
      const end = prompt.indexOf("\n\nAGENDA ITEMS ALREADY ON FILE:", start);
      const passages = JSON.parse(prompt.slice(start, end)) as Array<{ quote: string; url: string }>;
      const passage = passages.find((candidate) => candidate.quote.includes("50%") && candidate.quote.includes("dies for lack of a second"));
      return { ok: true, text: JSON.stringify(passage
        ? { verdict: "VERIFIED", quote: passage.quote, sourceKind: "transcript", sourceUrl: videoUrl, replacement: "", cut: false, reason: "The full motion and its disposition are in the retained record." }
        : { verdict: "OPEN", quote: passages[0]?.quote ?? "", sourceKind: "transcript", sourceUrl: videoUrl, replacement: "", cut: false, reason: "The cited passage has no result." }) };
    }) as never,
    chatOpts: { choice: "pinned-model", reasoningEffort: "high" },
    throwIfCancelled: async () => {},
  });
  assert.equal(checked.claims[0]?.status, "VERIFIED", checked.claims[0]?.nextCheck);
  assert.match(checked.claims[0]?.recordEvidence?.quote ?? "", /50%[\s\S]*dies for lack of a second/);
});

// guards: the editor could see a Supported vote whose saved quote omits its announced tally.
it("saves the motion through its announced vote result", async () => {
  const videoUrl = "https://www.youtube.com/watch?v=S1kSaew-UUY";
  const claim = "Ordinance 2026-69 as amended carried 6 to 1.";
  const motion = "The motion was to approve ordinance 2026-69 as amended.";
  const result = "The motion carries 6 to 1 with Council Member McCoy in opposition.";
  const checked = await reviewOpenStoryClaims({
    story: {
      id: "ordinance", headline: "Council approves an amended ordinance", draft: claim,
      plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{ id: "C15", item: "9E", text: claim, status: "UNVERIFIED", sourceIds: [], nextCheck: "Check the motion and its announced tally." }],
      sources: [],
    },
    record: {
      identity: { videoId: "S1kSaew-UUY", videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments: [
        { index: 1, seconds: 100, item: "9E", itemTitle: "Ordinance 2026-69", text: motion },
        { index: 2, seconds: 110, item: "9E", itemTitle: "Ordinance 2026-69", text: result },
      ],
    } as never,
    documents: [],
    method: { version: "test", text: "Use records only." } as never,
    chat: (async () => ({ ok: true, text: JSON.stringify({
      verdict: "VERIFIED", quote: result, sourceKind: "transcript", sourceUrl: videoUrl,
      replacement: "", cut: false, reason: "The vote and ordinance are in the retained transcript.",
    }) })) as never,
    chatOpts: { choice: "pinned-model", reasoningEffort: "high" },
    throwIfCancelled: async () => {},
  });
  const saved = checked.claims[0]?.recordEvidence?.quote ?? "";
  assert.equal(checked.claims[0]?.status, "VERIFIED");
  assert.ok(saved.includes(motion), "the saved evidence carries the motion into the result");
  assert.match(saved, /carries 6 to 1/i);
  assert.equal(checked.claims[0]?.transcriptEvidence?.quote, saved);
});

// guards: an announced vote could stay unchecked when its motion appears earlier in the transcript.
it("checks a vote against the passage from its motion through the result", async () => {
  const videoId = "S1kSaew-UUY";
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const claim = "motion uh to amend carries 5 to 2 with";
  const quote = "motion uh to amend carries 5 to 2 with";
  let prompt = "";
  let stagePrompt = "";
  let calls = 0;
  const result = await reviewOpenStoryClaims({
    story: {
      id: "fire-vote", headline: "Council amends fire ordinance", draft: claim, plainBrief: "", cannotSay: "",
      readinessTier: 1,
      claims: [
        { id: "fire-vote", text: claim, status: "UNVERIFIED", sourceIds: [], nextCheck: "Check the motion and result." },
        { id: "reading-stage", text: "The account places ordinance 2026-69 among first-reading items.", status: "UNVERIFIED", sourceIds: [], nextCheck: "Check the ordinance and reading stage." },
      ],
      sources: [],
    },
    record: {
      identity: { videoId, videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments: [
        { index: 1, seconds: 100, item: "9E", itemTitle: "Fire ordinance", text: "I move to amend ordinance 2026-69 to add fire protections." },
        { index: 2, seconds: 160, item: "9E", itemTitle: "Fire ordinance", text: "motion uh to amend carries 5 to 2 with" },
        { index: 3, seconds: 1_000, item: "11", itemTitle: "Fire ordinance", text: "Item E is ordinance 2026-69 on the agenda." },
        { index: 4, seconds: 1_258, item: "11", itemTitle: "Fire ordinance", text: "At the September 22 meeting, this item was approved on first reading with four additional conditions." },
      ],
    } as never,
    documents: [],
    method: { version: "test", text: "Use records only." } as never,
    chat: (async (_system: string, sent: string) => {
      calls++;
      if (calls === 1) prompt = sent;
      else stagePrompt = sent;
      return { ok: true, text: JSON.stringify({
        verdict: calls === 1 ? "VERIFIED" : "OPEN", quote: calls === 1 ? quote : "", sourceKind: "transcript", sourceUrl: videoUrl,
        replacement: "", cut: false, reason: "The retained transcript supplies the closest context.",
      }) };
    }) as never,
    chatOpts: { choice: "pinned-model", reasoningEffort: "high" },
    throwIfCancelled: async () => {},
  });
  assert.match(prompt, /I move to amend ordinance 2026-69[\s\S]*motion uh to amend carries 5 to 2 with/);
  const stageLine = stagePrompt.split(/\r?\n/).find((line) => line.startsWith("CLOSEST FULL-TRANSCRIPT PASSAGES: "));
  const stagePassages = JSON.parse(stageLine!.slice("CLOSEST FULL-TRANSCRIPT PASSAGES: ".length)) as Array<{ quote: string }>;
  assert.ok(stagePassages.some((passage) => passage.quote.includes("ordinance 2026-69") && passage.quote.includes("approved on first reading")));
  assert.equal(calls, 2);
  assert.equal(result.claims[0]?.status, "VERIFIED", result.claims[0]?.nextCheck);
});

// guards: a statement contradicted by the retained record could remain in the filed story.
it("rewrites a contradicted sentence to match the retained transcript", async () => {
  const videoUrl = "https://www.youtube.com/watch?v=S1kSaew-UUY";
  const unsupported = "The council approved $45,000 for creek repairs.";
  const corrected = "Staff proposed $45,000 for creek repairs.";
  const chat = async () => ({ ok: true, text: JSON.stringify({
    verdict: "CONTRADICTED", quote: corrected, sourceKind: "transcript", sourceUrl: videoUrl,
    replacement: corrected, cut: false, reason: "The transcript describes a proposal, not an approval.",
  }) });
  const result = await reviewOpenStoryClaims({
    story: {
      id: "repairs", headline: "Council takes up creek work",
      draft: `${unsupported} The report continues.`, plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{ id: "C1", text: unsupported, status: "UNVERIFIED", sourceIds: [], nextCheck: "Check the vote." }],
      sources: [],
    },
    record: {
      identity: { videoId: "S1kSaew-UUY", videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments: [{ index: 1, seconds: 900, item: "11", itemTitle: "Creek work", text: corrected }],
    } as never,
    documents: [],
    method: { version: "test", text: "Use records only." } as never,
    chat: chat as never,
    chatOpts: { choice: "pinned-model", reasoningEffort: "high" },
    throwIfCancelled: async () => {},
  });
  assert.equal(result.claims[0]?.status, "VERIFIED");
  assert.equal(result.claims[0]?.text, corrected);
  assert.equal(result.draft, `${corrected} The report continues.`);
});

// guards: a fact true in the record could stay unchecked because captions cannot prove a speaker's role.
it("narrows an open claim to the result the transcript can prove", async () => {
  const videoUrl = "https://www.youtube.com/watch?v=S1kSaew-UUY";
  const unsupported = "The chair announced that the fire amendment carried 5–2.";
  const narrowed = "The fire ordinance amendment carried 5 to 2.";
  const quote = "We are considering the fire ordinance. I move to amend ordinance 2026-69. The motion to amend carries 5 to 2.";
  let prompt = "";
  const result = await reviewOpenStoryClaims({
    story: {
      id: "fire-vote", headline: "Council amends a fire ordinance", draft: unsupported,
      plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{ id: "fire-vote", text: unsupported, status: "UNVERIFIED", sourceIds: [], nextCheck: "Check who announced the result." }],
      sources: [],
    },
    record: {
      identity: { videoId: "S1kSaew-UUY", videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments: [
        { index: 1, seconds: 100, item: "9E", itemTitle: "Fire ordinance", text: "We are considering the fire ordinance. I move to amend ordinance 2026-69." },
        { index: 2, seconds: 160, item: "9E", itemTitle: "Fire ordinance", text: "The motion to amend carries 5 to 2." },
      ],
    } as never,
    documents: [],
    method: { version: "test", text: "Use records only." } as never,
    chat: (async (_system: string, sent: string) => {
      prompt = sent;
      return { ok: true, text: JSON.stringify({
        verdict: "NARROWED", quote, sourceKind: "transcript", sourceUrl: videoUrl,
        replacement: narrowed, cut: false, reason: "The transcript identifies the result, but has no speaker labels.",
      }) };
    }) as never,
    chatOpts: { choice: "pinned-model", reasoningEffort: "high" },
    throwIfCancelled: async () => {},
  });
  assert.match(prompt, /no speaker labels/i);
  assert.equal(result.claims[0]?.status, "VERIFIED", result.claims[0]?.nextCheck);
  assert.equal(result.claims[0]?.text, narrowed);
  assert.equal(result.draft, narrowed);
});

// guards: an open fact could show the editor a quote and timestamp from the wrong passage.
it("keeps an open fact's closest evidence on the passage used for its re-check", async () => {
  const videoUrl = "https://www.youtube.com/watch?v=S1kSaew-UUY";
  const claim = "The chair announced that the Copper Peak approval motion carried 5 to 2.";
  const usedPassage = "The motion was to approve the Copper Peak development plan. The motion carries 5 to 2.";
  const result = await reviewOpenStoryClaims({
    story: {
      id: "copper-peak", headline: "Council considers Copper Peak", draft: claim,
      plainBrief: "", cannotSay: "", readinessTier: 1,
      claims: [{ id: "copper-peak-vote", text: claim, status: "UNVERIFIED", sourceIds: [], nextCheck: "Confirm who announced the vote." }],
      sources: [],
    },
    record: {
      identity: { videoId: "S1kSaew-UUY", videoUrl, title: "City Council regular session", date: "Oct. 6, 2026" },
      segments: [
        { index: 1, seconds: 500, item: "9I", itemTitle: "Copper Peak", text: "The motion was to approve the Copper Peak development plan." },
        { index: 2, seconds: 520, item: "9I", itemTitle: "Copper Peak", text: "The motion carries 5 to 2." },
        { index: 3, seconds: 900, item: "12A", itemTitle: "Other item", text: claim },
      ],
    } as never,
    documents: [],
    method: { version: "test", text: "Use records only." } as never,
    chat: (async () => ({ ok: true, text: JSON.stringify({
      verdict: "OPEN", quote: usedPassage, sourceKind: "transcript", sourceUrl: videoUrl,
      replacement: "", cut: false, reason: "The passage does not identify the speaker.",
    }) })) as never,
    chatOpts: { choice: "pinned-model", reasoningEffort: "high" },
    throwIfCancelled: async () => {},
  });
  assert.equal(result.claims[0]?.status, "UNVERIFIED");
  assert.equal(result.claims[0]?.closestQuote, usedPassage);
  assert.equal(result.claims[0]?.closestEvidence?.quote, usedPassage);
  assert.equal(result.claims[0]?.closestEvidence?.startSeconds, 500);
});

// guards: a transcript-supported claim could be filed as unchecked with no place to play it.
it("carries a retained transcript quote into the editor's supported row", async () => {
  const videoId = "S1kSaew-UUY";
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const quote = "The requirement should be subject to the availability and willingness of an operator.";
  const quoteParts = ["The requirement should be subject to the", "availability and willingness of an", "operator."];
  const story = {
    id: "bike-share", headline: "Dry Creek bike-share condition", draft: quote, plainBrief: "", cannotSay: "",
    readinessTier: 1,
    claims: [{ id: "bike-share-condition", text: quote, status: "UNVERIFIED" as const, sourceIds: ["tape"], nextCheck: "Confirm the amendment in the recording.", item: "Dry Creek; proposed amendment two" }],
    sources: [{ id: "tape", title: "Retained transcript", tier: "A" as const, url: videoUrl,
      locator: "Dry Creek; amendment two; operator availability; 1:25:17–1:25:48", offlineReference: "" }],
  };
  const record = { identity: { videoId, videoUrl }, segments: quoteParts.map((text, index) => ({
    index: index + 1, seconds: 5123 + index, item: "9", itemTitle: "Consent agenda", text,
  })) };
  const checked = bindClaimsToEvidence(story as never, {
    actions: [],
  } as never, record as never, []);
  assert.equal(checked[0]?.status, "VERIFIED");
  assert.deepEqual(checked[0]?.transcriptEvidence, { quote, startSeconds: 5123, videoUrl });

  const sql = { query: async <T>() => [] as T[] } as unknown as Sql;
  const review = await reportingStoryReviewClaims(sql, 1, { ...story, claims: checked } as never);
  const list = evidenceCheckRows({
    rows: [],
    claimRows: [{ key: "budget-vote", claim: review.rows[0]!, captures: [],
      judgment: { value: "unreviewed", reason: "", contraryVersionId: null } }],
    manualClaimRows: [], openClaims: [], nameCheck: null, styleFindings: [],
  });
  assert.equal(list[0]?.chip, "✓ Supported");
  assert.equal(list[0]?.note, quote);
  assert.deepEqual(list[0]?.action, {
    kind: "open-record", label: "Play at 1:25:23", href: `${videoUrl}&t=5123s`,
  });
});

// guards: a reconciled vote could be downgraded when its transcript citation replaces the ledger item.
it("keeps the reconciled vote on a cited transcript claim", () => {
  const videoId = "S1kSaew-UUY", videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const checked = bindClaimsToEvidence({ claims: [{ id: "vote", item: "9A", text: "The Dry Creek motion carries 5-2.", status: "UNVERIFIED", sourceIds: ["tape"], nextCheck: "" }], sources: [{ id: "tape", title: "Retained transcript", tier: "A", url: videoUrl, locator: "Item 9A; 1:40-1:42" }] } as never,
    { actions: [{ agendaItem: "9A", timestamp: "1:40", motionOrAction: "Dry Creek ordinance vote", outcome: "carries", vote: "5-2" }] } as never,
    { identity: { videoId, videoUrl }, segments: [{ index: 1, seconds: 100, item: "9A", text: "The motion was approved." }] } as never, []);
  assert.equal(checked[0]?.status, "VERIFIED");
});

// guards: an amount mentioned only between cited transcript passages could be falsely treated as supported.
it("does not use transcript figures between disjoint citations", () => {
  const videoId = "S1kSaew-UUY", videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const checked = bindClaimsToEvidence({ claims: [{ id: "amount", item: "9A", text: "The Dry Creek plan costs $42,000.", status: "UNVERIFIED", sourceIds: ["start", "end"], nextCheck: "" }], sources: ["1:40-1:42", "10:00-10:02"].map((locator, index) => ({ id: index ? "end" : "start", title: "Retained transcript", tier: "A", url: videoUrl, locator: `Item 9A; ${locator}` })) } as never,
    { actions: [{ agendaItem: "9A", timestamp: "1:40", motionOrAction: "Dry Creek plan", outcome: "approved", vote: "unverified" }] } as never,
    { identity: { videoId, videoUrl }, segments: [{ index: 1, seconds: 100, item: "9A", text: "The Dry Creek plan is on the agenda." }, { index: 2, seconds: 300, item: "9A", text: "The plan costs $42,000." }, { index: 3, seconds: 600, item: "9A", text: "The plan moves to a final vote." }] } as never, []);
  assert.notEqual(checked[0]?.status, "VERIFIED");
});

// guards: a timestamped supported row could show a transcript quote about a different amount.
it("saves the transcript line that states the checked amount", () => {
  const videoId = "S1kSaew-UUY";
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const claim = "The project 103 budget fell by $1.18 million.";
  const story = {
    claims: [{ id: "project-cut", item: "12A", text: claim, status: "VERIFIED", sourceIds: ["tape"], nextCheck: "" }],
    sources: [{ id: "tape", title: "Retained transcript", tier: "A", url: videoUrl,
      locator: "Item 12A; project 103 reduction; 3:56:54–3:57:13" }],
  };
  const record = { identity: { videoId, videoUrl }, segments: [
    { index: 1, seconds: 14_218, item: "12A", text: "The proposed budget included almost $2.1 million for CAP project 103." },
    { index: 2, seconds: 14_233, item: "12A", text: "We are reducing this budget by $1.18 million." },
  ] };
  const checked = bindClaimsToEvidence(story as never, { actions: [] } as never, record as never, []);
  assert.match(checked[0]?.transcriptEvidence?.quote ?? "", /\$1\.18 million/);
});
