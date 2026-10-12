// guards: batch and bulk selection keep held, killed and published leads.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/routes/desk.queue.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "queue.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const page = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "QueuePage",
);

test("batch and bulk selection keep held, killed and published leads for explicit server warnings", () => {
  const wanted = new Set(["batchEligible", "bulkDraftable"]);
  const declarations = page.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && wanted.has(declaration.name.text)));
  const body = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
  const run = new Function("batchPool", "selectedLeads", body + "return { batchEligible, bulkDraftable };");
  const leads = ["new", "held", "killed", "published"].map((status, index) => ({id:index+1,status}));
  const result = run({data:leads},leads);
  assert.deepEqual(result.batchEligible,leads);
  assert.deepEqual(result.bulkDraftable,leads);
});
