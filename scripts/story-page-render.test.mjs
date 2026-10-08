// guards: the editor's story page could crash before loading a lead without a draft.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("story.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const imports = new Map();
const exportGroups = new Map();
const stub = {
  createFileRoute: `() => (options) => ({ ...options, useParams: () => ({leadId: "2"}) })`,
  useQuery: `({queryKey}) => ({data: queryKey[0] === "lead" ? {lead: {topic: "infrastructure"}, draft: null} : undefined, isPending: true, isError: false, error: new Error("offline")})`,
  useMutation: `() => ({})`, useQueryClient: `() => ({})`,
  useEditorSections: `() => ({sections: []})`,
  usePaperDateFormatters: `() => ({})`, usePaper: `() => ({})`, useAreaLabels: `() => ({})`,
  auditDraft: `() => ({findings: []})`, findingsWithIds: `() => []`,
  parseNotes: `() => ({todos: [], sources: []})`,
  DeskShell: `({children}) => children`, WorkbenchSkeleton: `() => "story loading screen"`,
};
for (const node of ast.statements) {
  if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
  const name = node.moduleSpecifier.text;
  if (name === "react") { imports.set(name, import.meta.resolve("react")); continue; }
  const bindings = node.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) continue;
  const exports = bindings.elements.filter((entry) => !entry.isTypeOnly).map((entry) => {
    const key = (entry.propertyName ?? entry.name).text;
    return `export const ${key} = ${stub[key] ?? "() => null"};`;
  });
  exportGroups.set(name, [...(exportGroups.get(name) ?? []), ...exports]);
}
for (const [name, exports] of exportGroups) imports.set(name, url(exports.join("\n")));
let output = ts.transpileModule(source, { compilerOptions: {target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext} }).outputText;
imports.set("react/jsx-runtime", import.meta.resolve("react/jsx-runtime"));
for (const [name, target] of imports) output = output.replaceAll(JSON.stringify(name), JSON.stringify(target));
const { Route } = await import(url(output));
test("renders the story loading screen for a lead without a draft", () => {
  assert.match(renderToStaticMarkup(createElement(Route.component)), /story loading screen/);
});
