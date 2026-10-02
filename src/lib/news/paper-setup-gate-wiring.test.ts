/*
  SG1 / Option A, item 4(b) and 4(d): EVERY spending entry point is wired to
  the one gate, and every gated button says so BEFORE the press.

  WHY THIS IS A SOURCE-SHAPE TEST. The gated things are `createServerFn`
  handlers, which cannot be invoked without a live request context and an
  authenticated editor; the repo's own precedent for holding a handler's
  behaviour is exactly this (scripts/newsroom-security.test.mjs,
  scripts/model-preflight.test.mjs, src/lib/news/scan-coverage.test.ts). What
  it proves is the thing that rots: that the call is still there, in the right
  function, BEFORE the enqueue/commit it protects, and with the right verb in
  its sentence. The gate's own behaviour (onboarded false refuses, the LIVE
  SHAPE allows, an unreadable read fails closed) is held by
  `paper-setup-gate.test.ts`, and the scheduler skip by
  `daily-scan.execution.test.ts`.

  THE MUTATION THIS CATCHES: delete any one of the gate calls below and its
  entry disappears from the list, so this fails.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

/** The text from `export const <name> = createServerFn` to the next top-level `export`. */
function serverFnBody(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} = createServerFn`);
  assert.notEqual(start, -1, `${name} must still be a createServerFn`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

type Gated = { file: string; name: string; verb: string };

/*
  Every user-facing START of an action that spends a model or a search on this
  paper's behalf. Read-only list/get functions are deliberately NOT here.
*/
const GATED: Gated[] = [
  // Scan: the manual scan and the Scan desk's own starters.
  { file: "desk.ts", name: "runScan", verb: "start the scan" },
  // Drafting: the story's "Draft with AI", the batch starter, the Pull.
  { file: "desk.ts", name: "draftLead", verb: "draft this story" },
  { file: "desk.ts", name: "pullTodo", verb: "start a Pull" },
  // Follow-up agents: made here, run here.
  { file: "desk.ts", name: "createAiFollowUp", verb: "start a follow-up" },
  { file: "desk.ts", name: "followUpAction", verb: "run this follow-up" },
  { file: "draft-batch.ts", name: "startDraftBatch", verb: "start a batch draft" },
  {
    file: "draft-reconcile-actions.ts",
    name: "requestDraftReconciliationFn",
    verb: "check this draft's evidence",
  },
  // Dark Desk.
  { file: "dark.ts", name: "runDarkDesk", verb: "start a Dark Desk run" },
  { file: "dark.ts", name: "findSomethingToDigInto", verb: "start a Dark Desk run" },
  { file: "dark.ts", name: "openDarkInvestigation", verb: "open an investigation" },
  { file: "dark.ts", name: "continueInvestigation", verb: "keep digging" },
  { file: "dark.ts", name: "queueInvestigation", verb: "send this to the Queue" },
  { file: "dark.ts", name: "scanTipSubreddit", verb: "check the tip subreddit" },
  // Meeting capture: reads this paper's own YouTube channels.
  { file: "meeting-manual-run.ts", name: "runMeetingsNow", verb: "run meeting capture" },
  { file: "meeting-manual-run.ts", name: "forceRecaptureMeeting", verb: "re-capture that meeting" },
];

describe("every spending entry point calls the one gate", () => {
  for (const { file, name, verb } of GATED) {
    it(`${file}: ${name} refuses with "…then ${verb}."`, () => {
      const body = serverFnBody(read(`./${file}`), name);
      assert.match(
        body,
        /await (requirePaperSetUp|paperSetUpRefusal)\(/,
        `${name} must call requirePaperSetUp/paperSetUpRefusal`,
      );
      assert.ok(
        body.includes(`"${verb}"`),
        `${name} must name its action, so the sentence reads "…then ${verb}."`,
      );
    });
  }

  it("runScan's refusal comes BEFORE the scan is committed (nothing is queued)", () => {
    const body = serverFnBody(read("./desk.ts"), "runScan");
    const gate = body.indexOf("requirePaperSetUp(");
    const commit = body.indexOf("commitScanForAuthenticatedEditor(");
    assert.notEqual(commit, -1, "runScan still commits a scan");
    assert.ok(gate < commit, "the gate must run before anything is enqueued");
  });

  it("draftLead's refusal comes BEFORE the draft is committed", () => {
    const body = serverFnBody(read("./desk.ts"), "draftLead");
    const gate = body.indexOf("requirePaperSetUp(");
    const commit = body.indexOf("commitStoryDraftForAuthenticatedEditor(");
    assert.notEqual(commit, -1, "draftLead still commits a draft");
    assert.ok(gate < commit, "the gate must run before anything is enqueued");
  });

  it("the daily scan's SCHEDULER skips an un-set-up newsroom quietly", () => {
    const source = read("./daily-scan.server.ts");
    const tick = source.slice(source.indexOf("export async function tickDailyScans"));
    const loop = tick.slice(tick.indexOf("for (const p of ps)"));
    assert.match(
      loop.slice(0, 900),
      /requirePaperSetUp\(p\.newsroom_id/,
      "the tick must check the paper before it reserves anything",
    );
    assert.match(loop.slice(0, 1400), /console\.log\(/, "and skip with a log line, not an error");
  });

  it("read-only reads are NOT gated (they answer, they do not spend)", () => {
    const desk = read("./desk.ts");
    for (const name of ["listScans", "listLeads", "listQueuePage", "getLead", "listDraftsDesk"]) {
      assert.doesNotMatch(
        serverFnBody(desk, name),
        /requirePaperSetUp|paperSetUpRefusal/,
        `${name} only reads and must keep working on an un-set-up install`,
      );
    }
    const dark = read("./dark.ts");
    for (const name of ["listInvestigations", "listDarkRuns", "getInvestigation"]) {
      assert.doesNotMatch(
        serverFnBody(dark, name),
        /requirePaperSetUp|paperSetUpRefusal/,
        `${name} only reads`,
      );
    }
  });

  it("the one check lives in ONE place: no other module writes the sentence", () => {
    for (const file of [
      "desk.ts",
      "dark.ts",
      "draft-batch.ts",
      "draft-reconcile-actions.ts",
      "meeting-manual-run.ts",
      "daily-scan.server.ts",
    ]) {
      assert.doesNotMatch(
        read(`./${file}`),
        /has not been set up yet\. Finish Paper setup first/,
        `${file} must carry the refusal from paper-settings.ts, not repeat it`,
      );
    }
  });
});

describe("the gated buttons say so BEFORE the press (item 4d)", () => {
  const SCREENS: Array<{ file: string; action: string }> = [
    { file: "../../routes/desk.scan.tsx", action: "start the scan" },
    { file: "../../routes/desk.index.tsx", action: "start the scan" },
    { file: "../../routes/desk.dark.tsx", action: "start a Dark Desk run" },
    { file: "../../routes/desk.story.$leadId.tsx", action: "draft this story" },
  ];

  for (const { file, action } of SCREENS) {
    it(`${file} disables its control and draws the reason in text`, () => {
      const source = read(file);
      assert.match(
        source,
        new RegExp(`usePaperSetupGate\\("${action}"\\)`),
        "the screen must read the shared gate for this action",
      );
      assert.match(source, /<PaperSetupGateNote gate=\{paperGate\} \/>/, "and draw the sentence");
      assert.match(source, /paperGate\.blocked/, "and disable the control on it");
    });
  }

  it("the shared hook reads the SAME query the Server panel and /desk/setup read", () => {
    const hook = read("../../components/paper-setup-gate.ts");
    assert.match(hook, /queryKey: \["first-run-setup"\]/);
    assert.match(hook, /firstRunSetupState\(\)/);
    // Fail closed: an error or an absent answer is "could not check", never
    // "set up" -- the same rule the Server panel's Paper-setup section follows.
    assert.match(hook, /state\.isError \|\| !state\.data/);
    assert.match(hook, /PAPER_SETUP_UNCHECKABLE_SENTENCE\(action\)/);
    assert.match(hook, /PAPER_NOT_SET_UP_SENTENCE\(action\)/);
    assert.match(hook, /blocked: true/, "checking, unknown and needs-setup all block");
  });
});
