import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("../src/components/draft-batch-result.tsx", import.meta.url), "utf8");
const queueSource = await readFile(new URL("../src/routes/desk.queue.tsx", import.meta.url), "utf8");
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText;
const states = `data:text/javascript;base64,${Buffer.from(`import{createElement}from${JSON.stringify(import.meta.resolve("react"))};export function Notice({children}){return createElement("div",{role:"alert"},children)}`).toString("base64")}`;
output = output.replaceAll('"@/components/states"', JSON.stringify(states)).replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { DraftBatchResult } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("a warned batch result distinguishes the saved draft from the current workbench", () => {
  const html = renderToStaticMarkup(createElement(DraftBatchResult, { headline: "Council story", item: { leadId: 4, jobId: 9, status: "completed", stage: "Draft saved — review required", error: null, draftId: 27, evidenceCheckIncomplete: true, reviewRequired: true, workbenchHref: "/desk/story/4" } }));
  assert.match(html, /Batch saved draft #27.*review required/);
  assert.match(html, /Open current story workbench: Council story/);
  assert.match(html, /This draft was saved, but one or more source, evidence, or name checks need review before publication/);
  assert.doesNotMatch(html, /Completed|· Done/);
});

function findElement(node, predicate) {
  if (node == null || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("a failed local batch item can redraft with the exact selected cloud runtime", () => {
  const item = {
    leadId: 14,
    jobId: 29,
    status: "failed",
    stage: "Local model failed",
    error: "The saved local model was unavailable.",
    draftId: null,
    evidenceCheckIncomplete: false,
    reviewRequired: false,
    workbenchHref: "/desk/story/14",
  };
  let queued = null;
  const tree = DraftBatchResult({
    headline: "Water-rate story",
    item,
    redraftLabel: "Codex Sol",
    onRedraft: () => {
      queued = {
        leadId: item.leadId,
        modelChoice: "codex-frontier",
        modelEffort: "high",
        fromBatch: true,
      };
    },
  });
  const button = findElement(tree, (node) => node.type === "button");
  assert.ok(button, "a terminal failed item must expose Redraft");
  assert.equal(button.props.children, "Redraft with Codex Sol");
  button.props.onClick();
  assert.deepEqual(queued, {
    leadId: 14,
    modelChoice: "codex-frontier",
    modelEffort: "high",
    fromBatch: true,
  });

  const html = renderToStaticMarkup(tree);
  assert.match(html, /Open current story workbench: Water-rate story/);
  assert.match(html, /Your current saved draft stays in place until the redraft finishes/);
  assert.match(html, /The saved local model was unavailable/);
  assert.match(
    queueSource,
    /queueDraft\.mutate\(\{\s*leadId: item\.leadId,\s*modelChoice: batchRuntime,\s*modelEffort: batchEffort,\s*fromBatch: true\s*\}\)/,
    "the live action must send the currently selected exact runtime and effort",
  );
});

test("queue hydrates a restored batch runtime once so redraft is not stranded", () => {
  assert.match(queueSource, /hydratedBatchId\.current === current\.id/);
  assert.match(queueSource, /setBatchRuntime\(current\.runtime\.modelChoice\)/);
  assert.match(queueSource, /setBatchEffort\(current\.runtime\.modelEffort\)/);
});

test("an in-flight batch item does not expose Redraft", () => {
  const tree = DraftBatchResult({
    headline: "Running story",
    item: {
      leadId: 15,
      jobId: 30,
      status: "running",
      stage: "Researching",
      error: null,
      draftId: null,
      evidenceCheckIncomplete: false,
      reviewRequired: false,
      workbenchHref: "/desk/story/15",
    },
    onRedraft: () => assert.fail("running work must not redraft"),
  });
  assert.equal(findElement(tree, (node) => node.type === "button"), null);
});
