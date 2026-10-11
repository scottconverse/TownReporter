/* Execute the real setup hook with controlled query results; every setup state keeps actions enabled. */
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

const SENTENCES = inlineModule(`
  export const paperNotFullySetUpSentence = () => "This paper is not fully set up: finish Paper setup (Server > Paper setup).";
  export const paperSetupCompleted = () => { throw new Error("not stubbed"); };
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

test("an invited editor on an unfinished paper sees guidance and can press the action", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": UNSET_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.blocked, false, "Scott's rule: the control is never greyed — the press warns");
  assert.notEqual(gate.state, "ready", "unfinished setup stays visible");
  assert.equal(gate.state, "needs-setup");
  assert.match(gate.reason, /^This paper is not fully set up:/);
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

test("an owner on an unfinished paper sees the same guidance and can press the action", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": UNSET_QUERY,
    "first-run-setup": OWNER_ROUTED,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "needs-setup");
  assert.equal(gate.blocked, false, "the owner is warned in words, not greyed");
  assert.match(gate.reason, /^This paper is not fully set up:/);
});

test("an unreadable setup state warns and keeps the action enabled", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": ERROR_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "unknown");
  assert.equal(gate.blocked, false);
  assert.match(gate.reason, /could not be checked/i);
});

test("an unanswered read says it is checking, and warns rather than blocking", async () => {
  const { usePaperSetupGate } = await loadHook({
    "paper-setup-completed": PENDING_QUERY,
    "first-run-setup": NON_OWNER,
  });
  const gate = usePaperSetupGate(ACTION);
  assert.equal(gate.state, "checking");
  assert.equal(gate.blocked, false);
  assert.match(gate.reason, /checking whether this paper/i);
});
