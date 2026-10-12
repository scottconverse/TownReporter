// Guards: a new-story warning must wait for one explicit Draft anyway press.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import ts from "typescript";

test("new-story picker and confirmation use Draft anyway and submit once after consent", async (t) => {
  const root = resolve(import.meta.dirname, "..");
  const stubs = new Map();
  const serviceNames = new Set([
    "@/lib/news/desk", "@/lib/news/dark", "@/lib/news/meeting-manual-run",
    "@/lib/news/draft-reconcile-actions", "@/lib/news/daily-scan", "@/lib/news/draft-batch",
    "@/lib/news/job-progress", "@/lib/news/editor-dialog-actions", "@/lib/news/story-document-api",
    "@/lib/news/provider-availability", "@/lib/news/provider-availability-key",
    "@/lib/news/provider-settings", "@/lib/news/custom-ai-settings", "@/lib/news/claim",
  ]);
  const imports = new Map();
  for (const file of ["src/components/scoped-actions.ts", "src/components/dialogs/editor-dialogs.tsx", "src/components/model-picker.tsx"]) {
    const output = ts.transpileModule(await readFile(resolve(root, file), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    }).outputText;
    const ast = ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !serviceNames.has(statement.moduleSpecifier.text)) continue;
      const names = imports.get(statement.moduleSpecifier.text) ?? new Set();
      for (const entry of statement.importClause?.namedBindings?.elements ?? []) names.add(entry.propertyName?.text ?? entry.name.text);
      imports.set(statement.moduleSpecifier.text, names);
    }
  }
  for (const [module, names] of imports) stubs.set(module, [...names].map((name) =>
    name === "writeStoryFromInput"
      ? `export async function writeStoryFromInput({data}){window.calls.push(data);if(!data.override?.includes('writer-not-ready'))return {ok:false,warning:{key:'writer-not-ready',sentence:'Claude is signed out on this server.'},error:'Claude is signed out on this server.'};window.jobs++;return {ok:true,leadId:1,jobId:1};}`
      : name === "PROVIDER_AVAILABILITY_QUERY_KEY"
        ? `export const ${name}=['provider-availability'];`
        : `export const ${name}=async()=>undefined;`
  ).join("\n"));
  stubs.set("@tanstack/react-query", `export function useQuery({queryKey}){return {data:queryKey[0]==='custom-ai-connections'?[]:queryKey[0]==='provider-availability'?{'claude-haiku':false,reasons:{'claude-haiku':'Claude is signed out on this server.'}}:undefined};}export const useMutation=()=>({});export const useQueryClient=()=>({});`);
  // The production assignment hook stays in the dialog. Its transport and
  // failover module's AI dependency must remain outside this isolated bundle.
  stubs.set("@/lib/news/model-assignments-settings", `export const MODEL_ASSIGNMENTS_QUERY_KEY=['model-assignments'];export const getModelAssignmentsFn=async()=>({ok:true,assignments:[]});`);
  stubs.set("consent-ai-transport", `export const AUTOMATIC_LADDER=[];`);
  stubs.set("@/lib/use-sections", `export const useEditorSections=()=>({sections:[{key:'community',name:'Community'}],isPending:false});`);
  stubs.set("@/components/first-run-picker-default", `export const useFirstRunPickerDefault=()=> 'auto';`);
  stubs.set("@/components/desk-chrome-utils", `export const announceToDesk=()=>{};export const announceOnly=()=>{};`);
  stubs.set("@/components/desk-chrome", `import React from 'react';export const InkButton=({children,ariaLabel,onClick,disabled})=>React.createElement('button',{onClick,disabled,'aria-label':ariaLabel},children);`);
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
    import {NewStoryDialog} from '@/components/dialogs/editor-dialogs';
    import {WarningConsentHost} from '@/components/warning-consent-host';
    import {deskWarningConsent} from '@/components/editor-warning-consent';
    window.calls=[];window.jobs=0;
    createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
      React.createElement(NewStoryDialog,{open:true,onClose(){},onDone(){window.done=true;}}),
      React.createElement(WarningConsentHost,{channel:deskWarningConsent()})));`;
  const bundle = await rolldown({ cwd: root, input: "consent-fixture", transform: { jsx: "react-jsx", define: { "import.meta.env": "{}" } }, plugins: [{
    name: "isolated-new-story",
    resolveId(id, importer) {
      if (id === "./ai.ts" && importer?.endsWith("automatic-failover.ts")) return "\0consent-ai-transport";
      if (id === "consent-fixture" || stubs.has(id)) return "\0" + id;
      if (id === "./desk-chrome" && importer?.includes("components")) return "\0@/components/desk-chrome";
      if (id.startsWith("@/")) {
        const path = resolve(root, "src", id.slice(2));
        return extname(id) ? path : [".tsx", ".ts"].map((ext) => path + ext).find(existsSync);
      }
    },
    load(id) {
      if (id === "\0consent-fixture") return entry;
      if (stubs.has(id.slice(1))) return stubs.get(id.slice(1));
      if (process.env.DIALOG_SOURCE_OVERRIDE && id.endsWith("scoped-actions.ts")) return readFile(resolve(process.env.DIALOG_SOURCE_OVERRIDE, "src/components/scoped-actions.ts"), "utf8");
    },
  }] });
  t.after(() => bundle.close());
  const { output } = await bundle.generate({ format: "iife" });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: output[0].code });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]'), { timeout: 3000 }).catch(() => assert.fail(JSON.stringify(errors)));
  await page.getByLabel("Model", { exact: true }).selectOption("claude-haiku");
  await page.getByPlaceholder("Paste long material here", { exact: true }).fill("Supplied development-test source material for a complete notice.");
  await page.getByPlaceholder("What's the story? Angle, what to find out, what to ignore", { exact: true }).fill("Write a complete community notice from the supplied material.");
  await page.getByRole("button", { name: "Start drafting", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation.waitFor();
  const action = confirmation.locator("button.action-btn");
  assert.equal(await action.innerText(), "Draft anyway");
  assert.equal(await page.evaluate(() => window.calls.length), 1);
  assert.equal(await page.evaluate(() => window.jobs), 0);
  await action.click();
  await page.waitForFunction(() => window.done === true);
  assert.equal(await page.evaluate(() => window.calls.length), 2);
  assert.equal(await page.evaluate(() => window.jobs), 1);
  assert.deepEqual(await page.evaluate(() => window.calls[1]), { ...await page.evaluate(() => window.calls[0]), override: ["writer-not-ready"] });
});
