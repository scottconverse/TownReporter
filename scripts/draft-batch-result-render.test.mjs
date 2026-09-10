import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("../src/components/draft-batch-result.tsx", import.meta.url), "utf8");
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText;
const states = `data:text/javascript;base64,${Buffer.from(`import{createElement}from${JSON.stringify(import.meta.resolve("react"))};export function Notice({children}){return createElement("div",{role:"alert"},children)}`).toString("base64")}`;
output = output.replaceAll('"@/components/states"', JSON.stringify(states)).replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { DraftBatchResult } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("a warned batch result distinguishes the saved draft from the current workbench", () => {
  const html = renderToStaticMarkup(createElement(DraftBatchResult, { headline: "Council story", item: { leadId: 4, jobId: 9, status: "completed", stage: "Done", error: null, draftId: 27, evidenceCheckIncomplete: true, workbenchHref: "/desk/story/4" } }));
  assert.match(html, /Batch saved draft #27/);
  assert.match(html, /Open current story workbench: Council story/);
  assert.match(html, /This batch draft(?:'|&#x27;)s evidence check was incomplete/);
  assert.doesNotMatch(html, /Completed|· Done/);
});
