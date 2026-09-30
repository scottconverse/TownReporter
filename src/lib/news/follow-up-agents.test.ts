import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import type { IngestDocument } from "./ingest.ts";
import type { PrimeGovMeeting } from "./primegov.ts";
import type { SearchAttempt, WebHit } from "./search-web.ts";
import {
  FOLLOW_UP_STAGES,
  agentFor,
  budgetStopReason,
  followUpRunLimits,
  performFollowUpRun,
  resolveFollowUpModel,
  runAgendaAgent,
  runRecheckAgent,
  runSearchAgent,
  sameTarget,
  searchQuestionFor,
  watchOutcomeState,
  type FollowUpAgentInput,
  type SearchJudgeResult,
} from "./follow-up-agents.ts";
import {
  ensureFollowUpsSchema,
  parseFinding,
  performCreateAiFollowUp,
  performListFollowUps,
} from "./follow-ups.ts";
import { JobCancelledError, enqueueJob, ensureJobsSchema, requestJobCancel } from "./jobs.ts";
import { parseNotes } from "./notes.ts";
import { createDarkRunBudget } from "./dark-run-budget.ts";
import { setFetchImplForTests } from "./fetch-url.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

/**
 * The three AI follow-up agents, and the worker that runs one.
 *
 * EVERYTHING THAT LEAVES THE PROCESS IS A FAKE. No model is called, no search
 * provider is asked and no page is fetched: the page-watch engine is the real
 * one but its `fetch` is a fake `IngestDocument`, and the search agent's
 * provider and judge are functions in this file. The database is real (PGlite,
 * the same as follow-ups.test.ts), because the thing under test is what a run
 * WRITES -- `last_state`, `finding_json`, and a line in the story's notes.
 *
 * The two states the whole feature turns on are asserted separately and by
 * name: `no-change` is a run that got where it was going and learned nothing,
 * `could-not-check` is a run that did not get there and carries the real reason.
 */

const doc = (text: string, extra: Partial<IngestDocument> = {}): IngestDocument => ({
  ok: true,
  status: 200,
  outcome: "fetched",
  text,
  title: "Record",
  extras: [],
  contentType: "text/html",
  needsOcr: false,
  redirectChain: [],
  extractionMethod: "html",
  pages: [],
  notices: [],
  ...extra,
});

const hit = (url: string, title = "Result"): WebHit => ({ title, url, snippet: "…" });

function attempt(hits: WebHit[], extra: Partial<SearchAttempt> = {}): SearchAttempt {
  return { state: "ok", hits, provider: "fake", ...extra } as SearchAttempt;
}

function input(over: Partial<FollowUpAgentInput> = {}): FollowUpAgentInput {
  return {
    id: 1,
    userId: "agent-editor",
    newsroomId: 1,
    what: "Has the council posted the budget papers?",
    targets: [],
    modelChoice: "auto",
    lastFinding: parseFinding("{}"),
    ...over,
  };
}

before(async () => {
  const sql = await getSql();
  // The real base newsroom schema comes from `migrations/*.sql`, which the
  // suite applies to this database before the file loads (U18a-1,
  // src/lib/test-support/pglite-migrations.ts). The hand replay of 0002 that
  // stood in for Node's missing Vite migration glob is gone: running it again
  // would only repeat its unguarded welcome-article seed insert.
  for (const table of ["sources", "articles", "leads", "drafts", "scan_runs"])
    await sql.query("alter table " + table + " add column if not exists newsroom_id integer not null default 1");
  await sql.query("alter table leads add column if not exists notes_json text not null default '{}'");
  await ensureJobsSchema();
  await ensureFollowUpsSchema();
});

describe("the agent seam", () => {
  it("maps every page-watch outcome, and maps a sixth one to could-not-check", () => {
    assert.equal(watchOutcomeState("changed"), "found");
    assert.equal(watchOutcomeState("moved"), "found");
    assert.equal(watchOutcomeState("unchanged"), "no-change");
    assert.equal(watchOutcomeState("first-capture"), "no-change");
    for (const outcome of [
      "refused-too-large",
      "needs-ocr",
      "blocked",
      "unavailable",
      "failed",
      "no-readable-text",
    ])
      assert.equal(watchOutcomeState(outcome), "could-not-check", outcome);
    assert.equal(watchOutcomeState("something-new-upstream"), "could-not-check");
  });

  it("ignores the query string and a trailing slash when asking 'is this the same page?'", () => {
    assert.equal(sameTarget("https://a.test/x?y=1", "https://www.a.test/x/"), true);
    assert.equal(sameTarget("https://a.test/x", "https://a.test/z"), false);
    assert.equal(sameTarget("", "https://a.test/x"), false);
  });

  it("caps a run at ten minutes, or the provider's own wall budget when shorter", () => {
    // `local-model` ships a forty-minute wall budget (provider-registry.ts,
    // KIND_BUDGETS.local): the run is still capped at ten, because a follow-up
    // is a background check, not a pipeline.
    assert.equal(followUpRunLimits("local-model").elapsedMs, 10 * 60_000);
    // A provider whose own budget is shorter keeps it: the Claude CLI rungs
    // carry a seven-minute wall (KIND_BUDGETS["claude-code"]).
    assert.equal(followUpRunLimits("claude-sonnet").elapsedMs, 420_000);
    assert.equal(followUpRunLimits("auto").elapsedMs <= 10 * 60_000, true);
  });

  it("passes an explicit pick through and leaves `auto` for the assignment table", async () => {
    const explicit = await resolveFollowUpModel({ newsroom_id: 97001, model_choice: "codex-frontier" });
    assert.equal(explicit.providerId, "codex-frontier");
    assert.equal(explicit.source, "explicit");
    // `auto` must arrive as no explicit pick, or resolveJobModel stops reading
    // the table at all and the phase 5 order is bypassed.
    const auto = await resolveFollowUpModel({ newsroom_id: 97001, model_choice: "auto" });
    assert.notEqual(auto.source, "explicit");
  });

  it("routes a method name to its agent, and an unknown one to nothing", () => {
    assert.equal(agentFor("recheck"), runRecheckAgent);
    assert.equal(agentFor("search"), runSearchAgent);
    assert.equal(agentFor("agenda"), runAgendaAgent);
    assert.equal(agentFor("telepathy"), null);
  });
});

describe("recheck, on the real page-watch engine", () => {
  it("is not a finding the first time, and is one when the page really changes", async () => {
    const who = input({
      what: "Whether the library's opening hours changed",
      targets: ["https://example.test/hours"],
    });
    let body = "The library opens at nine.";
    const deps = { fetch: async () => doc(body) };

    const first = await runRecheckAgent(who, deps);
    assert.equal(first.state, "no-change", "a first capture has no previous version to differ from");
    assert.equal(first.finding.reason, "");

    const again = await runRecheckAgent(who, deps);
    assert.equal(again.state, "no-change");

    body = "The library opens at ten.";
    const changed = await runRecheckAgent(who, deps);
    assert.equal(changed.state, "found");
    assert.match(changed.finding.summary ?? "", /opens at ten/);
  });

  it("calls a page it could not read could-not-check, with the monitor's own reason", async () => {
    const who = input({
      what: "Whether the agenda packet is up",
      targets: ["https://example.test/blocked-agenda"],
    });
    const outcome = await runRecheckAgent(who, {
      fetch: async () => doc("", { ok: false, status: 403, outcome: "fetch-failed" }),
    });
    assert.equal(outcome.state, "could-not-check");
    assert.notEqual(outcome.finding.reason, "");
    assert.equal(outcome.finding.changed, false);
  });

  it("says so when there is no page saved to check", async () => {
    const outcome = await runRecheckAgent(input({ targets: [] }), {});
    assert.equal(outcome.state, "could-not-check");
    assert.match(outcome.finding.reason ?? "", /No page was saved/);
  });

  it("stops mid-run when the editor cancels", async () => {
    let calls = 0;
    await assert.rejects(
      runRecheckAgent(
        input({ targets: ["https://example.test/one", "https://example.test/two"] }),
        {
          fetch: async () => doc("unchanged"),
          step: async () => {
            if (++calls >= 2) throw new JobCancelledError();
          },
        },
      ),
      (e: unknown) => e instanceof JobCancelledError,
    );
  });
});

describe("search, on the existing research tools", () => {
  const found: SearchJudgeResult = {
    ok: true,
    answers: true,
    url: "https://clerk.test/minutes-2026-09",
    title: "Minutes, September",
    summary: "The minutes were posted on 12 September.",
  };

  it("finds something when the judge says a result answers the question", async () => {
    const outcome = await runSearchAgent(input({ what: "Were the September minutes posted?" }), {
      search: async () => attempt([hit("https://clerk.test/minutes-2026-09")]),
      judge: async () => found,
    });
    assert.equal(outcome.state, "found");
    assert.equal(outcome.finding.url, "https://clerk.test/minutes-2026-09");
    assert.equal(outcome.finding.changed, true);
  });

  it("reports no-change when nothing answers it, and when the answer is the same as last time", async () => {
    const quiet = await runSearchAgent(input(), {
      search: async () => attempt([hit("https://other.test/old-story")]),
      judge: async () => ({
        ok: true,
        answers: false,
        url: "",
        title: "",
        summary: "An older story about the same topic.",
      }),
    });
    assert.equal(quiet.state, "no-change");

    const same = await runSearchAgent(
      input({ lastFinding: { ...parseFinding("{}"), url: found.url } }),
      { search: async () => attempt([hit(found.url)]), judge: async () => found },
    );
    assert.equal(same.state, "no-change", "the same answer as last time is not news");
    assert.match(same.finding.summary ?? "", /Still the same result/);
  });

  it("keeps a failed search apart from an empty one, and both apart from no-change", async () => {
    const failed = await runSearchAgent(input(), {
      search: async () =>
        attempt([], {
          state: "SEARCH_FAILED_PROVIDER",
          error: "All providers failed (unavailable).",
        }),
    });
    assert.equal(failed.state, "could-not-check");
    assert.match(failed.finding.reason ?? "", /All providers failed/);

    const empty = await runSearchAgent(input(), { search: async () => attempt([]) });
    assert.equal(empty.state, "could-not-check");
    assert.match(empty.finding.reason ?? "", /No search provider returned results/);
  });

  it("treats a judge that could not answer as could-not-check, never as no-change", async () => {
    const outcome = await runSearchAgent(input(), {
      search: async () => attempt([hit("https://clerk.test/x")]),
      judge: async () => ({ ok: false, error: "the model call failed" }),
    });
    assert.equal(outcome.state, "could-not-check");
    assert.match(outcome.finding.reason ?? "", /Could not tell whether the results answer it/);
  });

  it("stops a run whose search budget is spent before it searches", async () => {
    const budget = createDarkRunBudget({ elapsedMs: 60_000, modelCalls: 1, searches: 0, documentReads: 1 });
    let searched = false;
    const outcome = await runSearchAgent(input(), {
      budget,
      search: async () => {
        searched = true;
        return attempt([hit("https://clerk.test/x")]);
      },
    });
    assert.equal(searched, false);
    assert.equal(outcome.state, "could-not-check");
    assert.match(outcome.finding.reason ?? "", /search limit/);
  });

  it("trims the question into a query a provider will take", () => {
    assert.equal(searchQuestionFor("  Were the minutes posted?  "), "Were the minutes posted");
    assert.equal(searchQuestionFor("x".repeat(400)).length, 180);
  });
});

describe("agenda, on a meeting body's portal", () => {
  const meeting = (over: Partial<PrimeGovMeeting> = {}): PrimeGovMeeting =>
    ({
      id: 1,
      title: "City Council",
      date: "2026-09-22",
      documentList: [
        { templateName: "Minutes", templateId: 41 },
        { templateName: "Agenda", templateId: 42 },
      ],
      ...over,
    }) as PrimeGovMeeting;
  const portal = "https://city.primegov.com/Portal/Meeting?meetingId=1";

  it("finds a newly posted document, and prefers the minutes", async () => {
    const outcome = await runAgendaAgent(input({ targets: [portal] }), {
      meetings: async () => [meeting()],
    });
    assert.equal(outcome.state, "found");
    assert.match(outcome.finding.url ?? "", /41/, "minutes rank above the agenda");
    assert.equal(outcome.finding.changed, true);
  });

  it("is a no-change while the newest posting is the one it already reported", async () => {
    const posted = await runAgendaAgent(input({ targets: [portal] }), {
      meetings: async () => [meeting()],
    });
    const again = await runAgendaAgent(
      input({ targets: [portal], lastFinding: { ...parseFinding("{}"), url: posted.finding.url ?? "" } }),
      { meetings: async () => [meeting()] },
    );
    assert.equal(again.state, "no-change");
    assert.match(again.finding.summary ?? "", /Still the same posting/);
  });

  it("refuses a portal it cannot read, and says why", async () => {
    const outcome = await runAgendaAgent(input({ targets: ["https://example.test/council-agendas"] }), {
      meetings: async () => [meeting()],
    });
    assert.equal(outcome.state, "could-not-check");
    assert.match(outcome.finding.reason ?? "", /can only watch PrimeGov portals/);
  });

  it("distinguishes an unreadable portal from an empty one", async () => {
    const broken = await runAgendaAgent(input({ targets: ["https://city.primegov.com/Portal"] }), {
      meetings: async () => {
        throw new Error("the portal timed out");
      },
    });
    assert.equal(broken.state, "could-not-check");
    assert.match(broken.finding.reason ?? "", /timed out/);

    const empty = await runAgendaAgent(input({ targets: ["https://city.primegov.com/Portal"] }), {
      meetings: async () => [],
    });
    assert.equal(empty.state, "could-not-check");
    assert.match(empty.finding.reason ?? "", /listed no meetings/);
  });

  it("calls a real portal outage could-not-check, not an empty portal", async () => {
    /*
      The live read, not an injected one: `fetchPrimeGovMeetings` is the real
      function against a fake 503. It used to swallow both API failures into an
      empty list, and this agent then reported "the portal listed no meetings"
      -- a portal that answered nothing at all, described as a portal that has
      nothing. That reading is what makes an outage look like evidence.
    */
    setFetchImplForTests(async () => new Response("gateway down", { status: 503 }));
    try {
      const outcome = await runAgendaAgent(
        input({ targets: ["https://longmont.primegov.com/public/portal"] }),
      );
      assert.equal(outcome.state, "could-not-check");
      assert.match(outcome.finding.reason ?? "", /503/);
      assert.doesNotMatch(outcome.finding.reason ?? "", /listed no meetings/);
      assert.match(outcome.finding.reason ?? "", /longmont\.primegov\.com/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("says so when no meeting has a document posted yet", async () => {
    const outcome = await runAgendaAgent(input({ targets: [portal] }), {
      meetings: async () => [meeting({ documentList: [] })],
    });
    assert.equal(outcome.state, "could-not-check");
    assert.match(outcome.finding.reason ?? "", /no meeting has a posted document/);
  });
});

describe("the run, end to end with the queue and the notes column", () => {
  it("writes the finding to the story's notes and never publishes", async () => {
    const sql = await getSql();
    const newsroomId = 97101;
    const userId = "agent-run-editor";
    const leadRows = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why, status, notes_json)
      values (${userId}, ${newsroomId}, 'Budget vote', 'The council votes Monday', 'new',
              '{"news":"The council votes Monday","todo":[{"t":"Ask the clerk"}],"found":[]}')
      returning id
    `;
    const leadId = leadRows[0]!.id;
    const articleRows = await sql<{ id: number }>`
      insert into articles (user_id, newsroom_id, lead_id, slug, headline, body, topic, status)
      values (${userId}, ${newsroomId}, ${leadId}, ${`budget-vote-${newsroomId}`}, 'Budget vote', 'Body text', 'council', 'draft')
      returning id
    `;
    const articleId = articleRows[0]!.id;
    const created = await performCreateAiFollowUp(
      { userId, newsroomId },
      {
        leadId,
        what: "Has the council posted the budget papers?",
        agentKind: "search",
        schedule: "daily",
        modelChoice: "auto",
      },
    );
    assert.equal(created.ok, true);
    const followUpId = created.ok ? created.id : 0;

    const job = await enqueueJob({
      userId,
      newsroomId,
      kind: "follow-up",
      subjectId: followUpId,
      modelChoice: "auto",
      kick: false,
    });

    const before = await sql<{ body: string; status: string; headline: string }>`
      select body, status, headline from articles where id = ${articleId}
    `;

    await performFollowUpRun(job, {
      agents: {
        search: async () => attempt([hit("https://clerk.test/budget-papers")]),
        judge: async () => ({
          ok: true,
          answers: true,
          url: "https://clerk.test/budget-papers",
          title: "Budget papers",
          summary: "The papers were posted on 24 September.",
        }),
      },
    });

    // No status filter: the list takes none since 0.6.81 (unit CU) -- the
    // screens narrow what they were given client-side (`matchesFollowUpFilter`).
    const rows = await performListFollowUps({ userId, newsroomId }, {});
    const row = rows.find((r) => r.id === followUpId)!;
    assert.equal(row.last_state, "found");
    assert.equal(parseFinding(row.finding_json).url, "https://clerk.test/budget-papers");
    assert.ok(row.next_run_at, "a run reschedules itself");

    const notes = await sql<{ notes_json: string }>`select notes_json from leads where id = ${leadId}`;
    const written = parseNotes(notes[0]!.notes_json);
    assert.equal(written.found.length, 1);
    assert.match(written.found[0]!.t, /Budget papers/);
    assert.match(
      written.found[0]!.t,
      /clerk\.test\/budget-papers/,
      "the note carries the link the card shows",
    );
    assert.equal(written.found[0]!.src, "machine", "the desk found it, not the editor");
    assert.equal(written.todo.length, 1, "the editor's own notes are untouched");
    assert.equal(written.todo[0]!.t, "Ask the clerk");
    assert.equal(written.news, "The council votes Monday");

    const after = await sql<{ body: string; status: string; headline: string }>`
      select body, status, headline from articles where id = ${articleId}
    `;
    assert.deepEqual(after[0], before[0], "a finding never publishes: the article is byte-identical");
  });

  it("records no-change without touching the notes, and stops a failed judge as could-not-check", async () => {
    const sql = await getSql();
    const newsroomId = 97102;
    const userId = "agent-quiet-editor";
    const leadRows = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why, status, notes_json)
      values (${userId}, ${newsroomId}, 'Ferry schedule', 'The ferry timetable changes', 'new', '{"open":[],"found":[],"notes":[]}')
      returning id
    `;
    const leadId = leadRows[0]!.id;
    const created = await performCreateAiFollowUp(
      { userId, newsroomId },
      { leadId, what: "Has the ferry timetable changed?", agentKind: "search", schedule: "daily" },
    );
    const followUpId = created.ok ? created.id : 0;
    const makeJob = () =>
      enqueueJob({
        userId,
        newsroomId,
        kind: "follow-up",
        subjectId: followUpId,
        modelChoice: "auto",
        kick: false,
      });

    // A run that reached the provider and learned nothing new.
    const quiet = await makeJob();
    await performFollowUpRun(quiet, {
      agents: {
        search: async () => attempt([hit("https://ferry.test/times")]),
        judge: async () => ({ ok: true, answers: false, url: "", title: "", summary: "" }),
      },
    });
    const afterQuiet = await sql<{ notes_json: string }>`select notes_json from leads where id = ${leadId}`;
    assert.deepEqual(parseNotes(afterQuiet[0]!.notes_json).found, []);
    let rows = await performListFollowUps({ userId, newsroomId }, {});
    assert.equal(rows.find((r) => r.id === followUpId)!.last_state, "no-change");

    // A run whose judge could not answer: could-not-check with the reason, and
    // the notes still untouched -- a failure must never look like a finding.
    const failed = await makeJob();
    await performFollowUpRun(failed, {
      agents: {
        search: async () => attempt([hit("https://ferry.test/times")]),
        judge: async () => ({ ok: false, error: "the model call failed" }),
      },
    });
    rows = await performListFollowUps({ userId, newsroomId }, {});
    const failedRow = rows.find((r) => r.id === followUpId)!;
    assert.equal(failedRow.last_state, "could-not-check");
    assert.match(parseFinding(failedRow.finding_json).reason, /Could not tell whether/);
    const afterFailed = await sql<{ notes_json: string }>`select notes_json from leads where id = ${leadId}`;
    assert.deepEqual(parseNotes(afterFailed[0]!.notes_json).found, []);
  });

  it("leaves a stopped follow-up alone when its job's run reaches it", async () => {
    const sql = await getSql();
    const newsroomId = 97103;
    const userId = "agent-stopped-editor";
    const created = await performCreateAiFollowUp(
      { userId, newsroomId },
      { what: "Has the pool reopened?", agentKind: "search", schedule: "daily" },
    );
    const followUpId = created.ok ? created.id : 0;
    await sql`
      update follow_ups set status = 'stopped' where id = ${followUpId} and newsroom_id = ${newsroomId}
    `;
    const job = await enqueueJob({
      userId,
      newsroomId,
      kind: "follow-up",
      subjectId: followUpId,
      modelChoice: "auto",
      kick: false,
    });
    let searched = false;
    await performFollowUpRun(job, {
      agents: {
        search: async () => {
          searched = true;
          return attempt([hit("https://pool.test/x")]);
        },
      },
    });
    assert.equal(searched, false, "a stopped follow-up does not run");
    const rows = await performListFollowUps({ userId, newsroomId }, {});
    const row = rows.find((r) => r.id === followUpId)!;
    assert.notEqual(row.last_state, "running", "the row is released rather than left running");
  });

  it("records nothing for a follow-up that is not this newsroom's", async () => {
    const sql = await getSql();
    const created = await performCreateAiFollowUp(
      { userId: "agent-other", newsroomId: 97104 },
      { what: "Anything at all", agentKind: "search", schedule: "daily" },
    );
    const followUpId = created.ok ? created.id : 0;
    const job = await enqueueJob({
      userId: "agent-other",
      newsroomId: 97104,
      kind: "follow-up",
      subjectId: followUpId,
      modelChoice: "auto",
      kick: false,
    });
    // The same job row, read as a different newsroom.
    await performFollowUpRun({ ...job, newsroom_id: 97105 }, { agents: {} });
    const rows = await sql<{ last_state: string }>`
      select last_state from follow_ups where id = ${followUpId}
    `;
    assert.equal(rows[0]!.last_state, "waiting", "another newsroom's run leaves the row alone");
  });

  it("releases the row when the editor cancels the job mid-run", async () => {
    const newsroomId = 97106;
    const userId = "agent-cancel-editor";
    const created = await performCreateAiFollowUp(
      { userId, newsroomId },
      {
        what: "Has the road reopened?",
        agentKind: "recheck",
        schedule: "daily",
        targets: ["https://example.test/road"],
      },
    );
    const followUpId = created.ok ? created.id : 0;
    const job = await enqueueJob({
      userId,
      newsroomId,
      kind: "follow-up",
      subjectId: followUpId,
      modelChoice: "auto",
      kick: false,
    });
    await requestJobCancel(job.id);
    await assert.rejects(
      performFollowUpRun(job, { agents: { fetch: async () => doc("unchanged") } }),
      (e: unknown) => e instanceof JobCancelledError,
    );
    const rows = await performListFollowUps({ userId, newsroomId }, {});
    const row = rows.find((r) => r.id === followUpId)!;
    assert.notEqual(row.last_state, "running", "a cancelled run does not leave the row running");
    assert.match(parseFinding(row.finding_json).reason, /stopped this run|not active|stopped before it finished/);
  });

  it("names the cap it stopped at, and the chip row both phrases the agents write", () => {
    // The wall budget is a full minute here, not one millisecond: the budget's
    // `stopReason` getter evaluates the elapsed clock lazily, so a 1 ms limit
    // races the reason this test is actually about.
    const budget = createDarkRunBudget({
      elapsedMs: 60_000,
      modelCalls: 1,
      searches: 1,
      documentReads: 1,
    });
    budget.markStop("elapsed-time-limit");
    assert.match(budgetStopReason(budget), /minute limit/);
    const calls = createDarkRunBudget({
      elapsedMs: 60_000,
      modelCalls: 0,
      searches: 1,
      documentReads: 1,
    });
    calls.startModelCall({ stage: "s", provider: "p", model: "m" });
    assert.equal(calls.startModelCall({ stage: "s", provider: "p", model: "m" }), null);
    assert.equal(budgetStopReason(calls), "The run reached its model-call limit.");
    assert.deepEqual([...FOLLOW_UP_STAGES], ["Running the check", "Recording the result"]);
  });
});
