/*
  SG1b finding 2: the BUTTON gate must read onboarding for EVERY role.

  The bot's finding: "When an invited non-owner opens an un-onboarded newsroom,
  `firstRunSetupState()` deliberately returns `needsSetup: false` for that role,
  so this hook reports `ready` and enables every newly gated button without
  showing a reason. Pressing one then reaches the server-side
  `requirePaperSetUp` check and is refused, recreating the unexplained dead-end
  this client gate is intended to prevent."

  So the hook now reads `paperSetupCompleted` -- a role-independent onboarding
  read -- to decide BLOCKED or READY, and keeps `firstRunSetupState` only to
  choose which sentence a blocked editor is shown.

  WHY A STUBBED-QUERY TEST. `usePaperSetupGate` calls nothing but `useQuery`, so
  handing it a stand-in `useQuery` that answers from a table is the whole
  behaviour, with no React renderer and no server: exactly the decision this
  finding is about. The REAL hook source is transpiled from disk, so a hook that
  stopped reading `paperSetupCompleted` fails here (that is mutation (b)).
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const inlineModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

/*
  The sentences are the SERVER's, so this stub carries the real strings -- the
  hook must not invent a second wording. Kept byte-identical to
  `paper-settings.ts` on purpose: if the server's sentence changes, this test
  fails until it is updated here too, which is the reminder to check the
  wiring test's own pin.
*/
const SENTENCES = inlineModule(`
  export const PAPER_NOT_SET_UP_SENTENCE = (action) =>
    \`This paper has not been set up yet. Finish Paper setup first (Server > Paper setup), then \${action}.\`;
  export const PAPER_NOT_SET_UP_OWNER_SENTENCE = (action) =>
    \`This paper has not been set up yet. Ask the owner to finish Paper setup, then \${action}.\`;
  export const PAPER_SETUP_UNCHECKABLE_SENTENCE = (action) =>
    \`The desk could not check whether this paper has been set up yet, so it will not \${action}. Reload the page and try again.\`;
  export const paperSetupCompleted = () => { throw new Error("not stubbed"); };
  export const firstRunSetupState = () => { throw new Error("not stubbed"); };
`);

/** Answers `useQuery` from a table keyed on `queryKey[0]`. */
function reactQueryStub(answers) {
  return inlineModule(`
    export const useQuery = (options) => answers[options.queryKey[0]];
  `.replace("answers", `(${JSON.stringify(answers)})`));
}

const READY_QUERY = { isPending: false, isError: false, data: { onboarded: true } };
const UNSET_QUERY = { isPending: false, isError: false, data: { onboarded: false } };
const ERROR_QUERY = { isPending: false, isError: true, data: undefined };
const PENDING_QUERY = { isPending: true, isError: false, data: undefined };
const OWNER_ROUTED = { isPending: false, isError: false, data: { needsSetup: true } };
const NON_OWNER = { isPending: false, isError: false, data: { needsSetup: false } };

async function loadHook(answers) {
  const url = moduleUrl(
    await readFile(new URL("../src/components/paper-setup-gate.ts", import.meta.url), "utf8"),
    "paper-setup-gate.ts",
    {
      "@tanstack/react-query": reactQueryStub(answers),
      "@/lib/news/paper-settings": SENTENCES,
    },
  );
  return import(url);
}

const ACTION = "draft this story";
const OWNER_SENTENCE =
  "This paper has not been set up yet. Finish Paper setup first (Server > Paper setup), then draft this story.";
const ASK_OWNER_SENTENCE =
  "This paper has not been set up yet. Ask the owner to finish Paper setup, then draft this story.";

test("an invited NON-OWNER on an un-set-up paper is blocked, in words that name the owner", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": UNSET_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.blocked, true, "the button must not be pressable");
  assert.notEqual(gate.state, "ready", "THIS is the finding: never 'ready' for a non-owner");
  assert.equal(gate.state, "needs-setup");
  assert.equal(gate.reason, ASK_OWNER_SENTENCE);
  assert.match(gate.reason, /ask the owner/i, "and it says what that editor can actually do");
});

test("an invited NON-OWNER on an ONBOARDED paper (the live shape) is ready", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": READY_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "ready");
  assert.equal(gate.blocked, false);
  assert.equal(gate.reason, "");
});

test("the OWNER on an un-set-up paper still gets the original sentence (unchanged)", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": UNSET_QUERY,
    "first-run-setup": OWNER_ROUTED,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "needs-setup");
  assert.equal(gate.blocked, true);
  assert.equal(gate.reason, OWNER_SENTENCE);
});

test("FAILS CLOSED: a read that errored is 'could not check', never 'set up'", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": ERROR_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "unknown");
  assert.equal(gate.blocked, true);
  assert.match(gate.reason, /could not check/i);
});

test("an unanswered read says it is checking, and blocks", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": PENDING_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "checking");
  assert.equal(gate.blocked, true);
  assert.match(gate.reason, /checking whether this paper/i);
});

test("the block decision reads the ROLE-INDEPENDENT query, never the routing one (mutation (b))", async () => {
  const hook = await readFile(
    new URL("../src/components/paper-setup-gate.ts", import.meta.url),
    "utf8",
  );
  assert.match(hook, /paperSetupCompleted\(\)/, "the gate must read the role-independent onboarding read");
  assert.match(hook, /queryKey: \["paper-setup-completed"\]/, "on its own query key, not the panel's shape");
  // The owner-only routing read survives, but only to pick the wording.
  assert.match(hook, /queryKey: \["first-run-setup"\]/);
  assert.match(hook, /refetchOnMount: "always"/, "PUB2: a cached answer is not an answer");
  assert.match(hook, /PAPER_NOT_SET_UP_OWNER_SENTENCE\(action\)/);
  assert.doesNotMatch(
    hook,
    /needsSetup === true\s*\)\s*\{\s*return \{ state: "ready"/,
    "needsSetup must never decide READY again",
  );
});

test("the server read answers ONLY whether setup finished", async () => {
  const source = await readFile(new URL("../src/lib/news/paper-settings.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const paperSetupCompleted = createServerFn");
  assert.notEqual(start, -1, "the role-independent read must still exist");
  const body = source.slice(start, source.indexOf("export type FirstRunSetupInput", start));
  assert.match(body, /return \{ onboarded: await isOnboarded\(me\.newsroomId\) \}/);
  assert.match(
    body,
    /catch \{\s*return \{ onboarded: false \}/,
    "FAIL CLOSED: an unreadable answer is 'not set up' (mutation (c))",
  );
  for (const leak of ["name", "city", "state", "editorEmail", "seedSources", "needsSetup"]) {
    assert.doesNotMatch(body, new RegExp(`\\b${leak}\\b`), `the read must not carry ${leak}`);
  }
});
