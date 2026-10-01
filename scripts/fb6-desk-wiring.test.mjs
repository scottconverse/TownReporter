/*
  FB6: the wiring, pinned where a browser walk cannot see it.

  Three kinds of claim live in this file, and each is here for its own reason:

    1. THE MECHANICAL ONE. "Every mutation on these four screens reports a
       failure" is a property of the SOURCE, not of a render -- a route needs a
       database, a router and a session to mount, and a test that mounted one
       would be testing the harness. FB0-Report says the audit itself was done
       by exactly this scan ("this is mechanisable -- the 22 gaps in this report
       were found by exactly that scan"), so the same scan is the regression
       test for them.

    2. THE NAMED CONTROLS. FB0 Table B lists, control by control, what each one
       was missing. Each of those is pinned here by the markup or the copy that
       supplies it, so re-breaking one fails a named case rather than a
       general one.

    3. THE OWNER'S OWN BUGS (2026-09-30, 7a-7d) and the two story-page
       contradictions from the stand-in walkthrough (A2c-REPORT.md §6 C4/C5).

  Source pins are the house convention for route files
  (`scripts/fb5-desk-wiring.test.mjs`, `scripts/desk-uiux-pins.test.mjs`,
  `src/components/announce-tone-wiring.test.ts` all read their call sites as
  text), and the pieces that ARE importable are tested directly instead:
  `src/components/desk-triage.test.ts` for the keys,
  `src/components/desk-lead-status.test.ts` for the optimistic arithmetic,
  `scripts/fb6-optimistic-rollback.test.mjs` for the press itself.

  A NOTE ON COMMENTS: every assertion below reads a blanked copy of the file.
  Several of these fixes carry a comment quoting the very string being asserted
  ("this used to read `Start 0 stories`"), and a pin that a comment can satisfy
  is not a pin.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const raw = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
/** The file with its comments blanked: a pin may only be satisfied by code. */
const read = (path) =>
  raw(path)
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");

const SCREENS = [
  "src/routes/desk.index.tsx",
  "src/routes/desk.queue.tsx",
  "src/routes/desk.drafts.tsx",
  "src/components/desk-leads.tsx",
];

/* ------------------------------------------------------------ 1. mechanical */

/**
 * Every `useMutation(` options object in `source`, as raw text.
 *
 * Brace matching from the call's own parenthesis: an options object literal can
 * nest (`onError: (e) => { ... }`), so a regex that stopped at the first `)` of
 * `useMutation(` would stop inside an arrow function and read a fragment.
 */
function mutationCalls(source) {
  const calls = [];
  const needle = "useMutation(";
  for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) {
    // `useDeskMutation(` also contains `useMutation(`; those report by
    // construction and are collected separately.
    if (source.slice(at - 4, at) === "Desk") continue;
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({ body: source.slice(at, end + 1), line: source.slice(0, at).split("\n").length });
  }
  return calls;
}

/*
  The one press in these four files whose failure is reported WITHOUT an
  `onError`: "Kill as duplicate" rejects on purpose so the ROW can print
  "That did not save." beside the press, with a Try again (desk-leads.tsx). A
  toast as well would say the same thing twice. The exemption is checked below
  rather than trusted, so it cannot quietly become a second silent failure.
*/
const REPORTED_BY_THE_ROW = [
  {
    file: "src/routes/desk.queue.tsx",
    because: "Kill as duplicate rejects into the row's own saved/failed line",
  },
];

test("every mutation on the four screens reports a failure", () => {
  for (const file of SCREENS) {
    const source = read(file);
    const exempt = REPORTED_BY_THE_ROW.some((entry) => entry.file === file);
    for (const call of mutationCalls(source)) {
      const hasErrorPath = /onError\s*:/.test(call.body);
      if (hasErrorPath) continue;
      assert.ok(
        exempt,
        `${file}:${call.line} is a bare useMutation with no onError -- FB0's silent-failure scan is back`,
      );
      // The exemption has to be true: the row really does print the failure.
      assert.match(
        read("src/components/desk-leads.tsx"),
        /That did not save\./,
        "the row no longer reports it, so the exemption is a silent failure after all",
      );
    }
  }
});

test("every screen that presses something uses the shared action family", () => {
  /*
    Drafts is not in this list on purpose: it has no mutation at all. Its only
    press is Cancel, which belongs to the job card's own `DeskJobCard` (the same
    wrapper Today and the story page mount), and its rows are links. A screen
    with no press has nothing to route through the family.
  */
  for (const file of SCREENS.filter((f) => mutationCalls(read(f)).length > 0)) {
    assert.match(read(file), /useDeskMutation|useDeskAction/, `${file} left the shared action family`);
  }
});

/* -------------------------------------------------- 2. the named controls --- */

test("Today: Start story and S show a pending state and a real failure", () => {
  const today = read("src/routes/desk.index.tsx");
  assert.match(today, /const startDraft = useDeskMutation\(/);
  assert.match(today, /failedLead: "Could not start that draft\. "/);
  // The per-LEAD pending: eight rows share one mutation, so the flag is the
  // lead's own or every row would say "Starting…" at once.
  assert.match(today, /const startingThis = startDraft\.isPending && startDraft\.variables === l\.id/);
  assert.match(today, /pending=\{startingThis\}\s*pendingLabel="Starting…"/);
});

test("Today: Undo and U show a pending state", () => {
  const today = read("src/routes/desk.index.tsx");
  assert.match(today, /const undoingThis =/);
  assert.match(today, /pending=\{undoingThis\}\s*pendingLabel="Putting it back…"/);
});

test("Today: Run scan now draws the scan's own card and reports a failure", () => {
  const today = read("src/routes/desk.index.tsx");
  assert.match(today, /const scan = useDeskMutation\(/);
  assert.match(today, /failedLead: "Could not start the scan\. "/);
  // The card, from the one job query, drawn where the press is.
  assert.match(today, /const scanJob =[\s\S]{0,240}row\.kind === "scan" && \(row\.status === "queued" \|\| row\.status === "running"\)/);
  assert.match(today, /\{scanJob \? \([\s\S]{0,200}<DeskJobCard/);
});

test("Today: Accept and Drop are neither dead nor silent", () => {
  const today = read("src/routes/desk.index.tsx");
  assert.match(today, /const srcStatus = useDeskMutation\(/);
  assert.match(today, /failedLead: "Could not change that source\. "/);
  // One pending state per SOURCE, covering both of that row's presses.
  assert.match(
    today,
    /pending=\{srcStatus\.isPending && srcStatus\.variables\?\.id === s\.id\}/,
  );
});

test("Today: a failed Start digging is announced, not only printed", () => {
  const today = read("src/routes/desk.index.tsx");
  assert.match(
    today,
    /\{darkErr \? \(\s*<p className="note err" role="alert">/,
    "the Dark Desk failure line is drawn for the eye and silent to a screen reader",
  );
  assert.match(today, /pendingLabel="Opening…"/);
});

test("Queue: Run scan now draws the scan's own card and reports a failure", () => {
  const queue = read("src/routes/desk.queue.tsx");
  assert.match(queue, /const scan = useDeskMutation\(/);
  assert.match(queue, /failedLead: "Could not start the scan\. "/);
  assert.match(queue, /\{scanJob \? \([\s\S]{0,200}<DeskJobCard/);
});

test("Queue: bulk Hold and Kill stand down, say what they are doing, and ask before a batch kill", () => {
  const queue = read("src/routes/desk.queue.tsx");
  assert.match(queue, /pending=\{bulkStatus\.isPending && bulkStatus\.variables\?\.status === "held"\}\s*pendingLabel="Holding…"/);
  assert.match(queue, /pending=\{bulkStatus\.isPending && bulkStatus\.variables\?\.status === "killed"\}\s*pendingLabel="Killing…"/);
  // One shared reason, asked for before several leads are killed in one press.
  assert.match(queue, /if \(selectedLeads\.length > 1\) setBulkKillReason\(""\);/);
  assert.match(queue, /Yes, kill \{selectedLeads\.length\}/);
});

test("Queue: the row's own way back is on the row, with a pending state", () => {
  const leads = read("src/components/desk-leads.tsx");
  assert.match(leads, /lead\.status === "killed" \? \([\s\S]{0,320}Bring back/, "a killed row keeps its only way back in the menu");
  assert.match(leads, /pending=\{backPending\} pendingLabel="Bringing it back…"/);
  assert.match(leads, /pending=\{backPending\} pendingLabel="Releasing…"/);
  assert.match(read("src/routes/desk.queue.tsx"), /backPending=\{setStatus\.isPending && setStatus\.variables\?\.id === l\.id\}/);
});

test("Drafts: a running row is the drawn card, not a stand-in", () => {
  const drafts = read("src/routes/desk.drafts.tsx");
  // FB0 Table B, Drafts: the dashed stand-in had "no chips, no bar, no Cancel".
  // The row draws the real card, and at FULL size -- `compact` is what drops
  // the stage chips, and this row is one per story across the whole width.
  const branch = drafts.indexOf("state.running ? (");
  assert.notEqual(branch, -1, "the running row's own branch is gone");
  assert.ok(
    drafts.slice(branch).includes("<DeskJobCard"),
    "the running row no longer draws the job card at all",
  );
  assert.equal(
    /<DeskJobCard[\s\S]{0,200}\scompact\s/.test(drafts),
    false,
    "a compact card has no chip row, which is half of what this unit fixed",
  );
  // The stand-in the report named is gone from the desk entirely.
  assert.equal(/JobSlot/.test(read("src/components/desk-chrome.tsx")), false, "JobSlot is back");
});

/* ------------------------------------------------------- 3. the owner's bugs */

test("7a: a held lead is not open work, anywhere", () => {
  const copy = read("src/lib/news/desk-copy.ts");
  assert.match(
    copy,
    /export function openLeads<T extends \{ status: string \}>\(leads: readonly T\[\]\): T\[\] \{[\s\S]{0,220}l\.status !== "held"/,
  );
  // Today's two segments and the Queue's Open tab read that one rule.
  const today = read("src/routes/desk.index.tsx");
  assert.match(today, /const heldQueue = workingLeads\(allLeads\)\.filter\(\(l\) => l\.status === "held"\)/);
  assert.match(today, /Open · \{queue\.length\}/);
  assert.match(today, /Held · \{heldQueue\.length\}/);
  assert.equal(/queue\.length - heldCount/.test(today), false, "the Open count is back to arithmetic");
});

test("7b: the bulk button cannot read 'Start 0 stories'", () => {
  const queue = read("src/routes/desk.queue.tsx");
  assert.match(queue, /bulkDraftable\.length === 0\s*\?\s*"Start stories"/);
  // And the label it WOULD have printed is behind a guard, not printed anyway.
  assert.equal(
    /Start \$\{bulkDraftable\.length\} \$\{bulkDraftable\.length === 1 \? "story" : "stories"\}`\}/.test(
      queue,
    ),
    true,
    "the counted label must still exist for the case that has a count",
  );
  assert.match(queue, /disabled=\{\s*startBatch\.isPending \|\| bulkDraftable\.length === 0 \|\| bulkDraftable\.length > 5\s*\}/);
});

test("7c: the lead menu fits 'Start an AI follow-up' on one line", () => {
  const css = read("src/desk-astra.css");
  // The panel is wide enough for its widest block row. The rule's own body is
  // read out by braces rather than by a window, because the comment above it is
  // long and blanking comments leaves a lot of whitespace in between.
  const rule = css.slice(css.indexOf(".desk-ltr.astra .more-menu {"));
  const body = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
  assert.match(body, /min-width: 264px/);
  // And a block row's button does not break its label, which is what actually
  // wrapped: `.btn` is `white-space: normal` in this stylesheet.
  assert.match(
    css,
    /\.desk-ltr\.astra \.more-menu \.more-block :is\(\.btn, \.document-add-button\) \{\s*white-space: nowrap;/,
  );
});

test("7d: a lead filed from the desk's own dialog lands on the list it was filed from", () => {
  const dialogs = read("src/components/dialogs/editor-dialogs.tsx");
  assert.match(
    dialogs,
    /export function AddLeadButton\(\{[\s\S]{0,200}onDone,[\s\S]{0,1200}<AddLeadDialog open=\{open\} onClose=\{\(\) => setOpen\(false\)\} onDone=\{onDone\} \/>/,
    "AddLeadButton drops the dialog's own onDone on the floor again",
  );
  for (const screen of ["src/routes/desk.index.tsx", "src/routes/desk.queue.tsx"]) {
    assert.match(
      read(screen),
      /<AddLeadButton[\s\S]{0,260}onDone=\{\(\) => \{[\s\S]{0,240}invalidateQueries\(\{ queryKey: \["leads"\] \}\)/,
      `${screen} files a lead into a list it never refreshes`,
    );
  }
});

test("8a: publish-prep work is not offered on a story with no draft", () => {
  const lib = read("src/lib/news/publish-blockers.ts");
  assert.match(lib, /export function showsPublishPrep\(status: string, hasDraft: boolean\): boolean \{/);
  assert.match(lib, /if \(status === "killed"\) return false;\s*return hasDraft;/);
  const route = read("src/routes/desk.story.$leadId.tsx");
  assert.match(route, /showsPublishPrep\(data\.lead\.status, Boolean\(data\.draft\)\)/);
  // And the pane says the one next step instead of a dead sentence.
  assert.match(route, /Nothing to check yet — there is no draft\./);
  assert.match(route, /Draft with AI<\/InkButton>|"Draft with AI"\}/);
});

test("8b: the two Checks panes agree about what there is to review", () => {
  const panel = read("src/components/finding-evidence-review.tsx");
  /*
    The paragraph must key off the LIST it sits above, not off `review.rows`:
    the list is built by `evidenceCheckRows` from the review AND from the three
    rows the page holds itself (claims of absence, names, style), and any of
    those can carry "! Needs review" while `review.rows` is empty.
  */
  assert.match(panel, /\{review && listRows\.length === 0 && !meetingEvidence \? \(/);
  assert.equal(
    /review && review\.rows\.length === 0 && !meetingEvidence/.test(panel),
    false,
    "the pane is denying in one line what the row below it asserts in the next",
  );
});

/* ------------------------------------------- 4. the keys, and the running card */

test("both lists bind the same triage keys", () => {
  for (const file of ["src/routes/desk.index.tsx", "src/routes/desk.queue.tsx"]) {
    assert.match(read(file), /useTriageKeys\(/, `${file} does not bind the triage keys`);
  }
  const queue = read("src/routes/desk.queue.tsx");
  // Every action the README names has a handler on the Queue, not just a key.
  for (const kind of ["move", "start", "hold", "kill", "undo", "open", "new"]) {
    assert.match(queue, new RegExp(`case "${kind}":`), `the Queue's switch has no "${kind}" action`);
  }
  // And the cursor is drawn, not invisible.
  assert.match(queue, /selected=\{index === movedIndex\(cursor, 0, shown\.length\)\}/);
  assert.match(read("src/components/desk-leads.tsx"), /\(selected \? " sel" : ""\)/);
});

test("a running card carries the Cancel the Drafts row needs", async () => {
  /*
    FB0 Table B, Drafts: "no chips, no bar, **no Cancel** -- a draft can only be
    cancelled from the story page". The card itself is the fix, so this renders
    the REAL `DeskJobCard` -- the component `desk.drafts.tsx` mounts -- with a
    running job and reads the buttons it draws.
  */
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const ts = (await import("typescript")).default;
  const readFile = (await import("node:fs/promises")).readFile;
  const React = import.meta.resolve("react");
  const moduleUrl = (source, fileName, imports) => {
    let output = ts.transpileModule(source, {
      fileName,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    }).outputText;
    for (const [name, url] of Object.entries(imports)) {
      output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
    }
    return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  };
  const inline = (body) =>
    `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;
  const jobProgress = inline(`
    export async function cancelStoryJob() { throw new Error("not pressed in a render test"); }
    export async function retryStoryJob() { throw new Error("not pressed in a render test"); }
    export async function listDeskJobs() { return []; }
  `);
  const reactQuery = inline(`
    export function useQuery() { return { data: undefined, state: { data: undefined } }; }
    export function useMutation() { return { mutate() {}, isPending: false, error: null, data: null }; }
    export function useQueryClient() { return { invalidateQueries() {} }; }
  `);
  const stateUrl = moduleUrl(
    await readFile(new URL("../src/components/job-card-state.ts", import.meta.url), "utf8"),
    "job-card-state.ts",
    { "@/lib/news/job-progress": jobProgress, "@tanstack/react-query": reactQuery },
  );
  const cardUrl = moduleUrl(
    await readFile(new URL("../src/components/JobCard.tsx", import.meta.url), "utf8"),
    "JobCard.tsx",
    {
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
      react: React,
      "@/lib/news/job-progress": jobProgress,
      "@tanstack/react-query": reactQuery,
      "./job-card-state": stateUrl,
    },
  );
  const { DeskJobCard } = await import(cardUrl);

  const running = {
    id: 41,
    leadId: 7,
    kind: "draft",
    status: "running",
    title: "Drafting story",
    model: "DeepSeek v4.1 Flash",
    stages: ["Planning the reporting", "Writing the draft", "Checking the draft"],
    stageIndex: 1,
    pct: 42,
    step: "Writing the draft",
    startedAt: Date.now() - 75_000,
    endedAt: null,
    beatAt: Date.now() - 2_000,
    error: null,
    resultHref: null,
    openLabel: null,
    canRetry: false,
    cancelRequested: false,
    failoverNote: null,
    doneText: "Done",
  };
  const html = renderToStaticMarkup(createElement(DeskJobCard, { job: running }));
  assert.match(html, />Cancel</, "a running draft cannot be stopped from the Drafts row");
  assert.match(html, /job-card-chip/, "the stage chips are the card's, not a stand-in's");
  assert.match(html, /Writing the draft/, "and the step is in words");
  assert.match(html, /42%/, "and the percent the stand-in never carried");

  // A job whose cancellation has been asked for draws no second Cancel.
  const cancelled = renderToStaticMarkup(
    createElement(DeskJobCard, { job: { ...running, cancelRequested: true } }),
  );
  assert.equal(/button[^>]*>Cancel</.test(cancelled), false);
  assert.match(cancelled, /Cancelling/);
});
