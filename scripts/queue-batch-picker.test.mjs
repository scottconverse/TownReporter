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
  const wanted = new Set(["batchEligible", "bulkDraftable", "offScreenPicks"]);
  const declarations = page.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && wanted.has(declaration.name.text)));
  const body = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
  const run = new Function("batchPool", "selectedDeleteLeadIds", "shownIds", body + "return { batchEligible, bulkDraftable, offScreenPicks };");
  const leads = ["new", "held", "killed", "published"].map((status, index) => ({id:index+1,status}));
  const ids = leads.map((lead) => lead.id);
  const result = run({data:leads}, ids, ids);
  assert.deepEqual(result.batchEligible,leads);
  assert.deepEqual(result.bulkDraftable,ids);
  assert.equal(result.offScreenPicks,0);
});

// Scott, Nov 18 2026: he ticked 6 leads and the paper wrote 5. Start drafts
// every ticked lead, also one the list on screen no longer shows.
test("Start drafts every ticked lead, also one the list no longer shows", () => {
  const wanted = new Set(["bulkDraftable", "offScreenPicks"]);
  const declarations = page.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && wanted.has(declaration.name.text)));
  const body = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
  const run = new Function("selectedDeleteLeadIds", "shownIds", body + "return { bulkDraftable, offScreenPicks };");
  const picked = [1385, 1391, 1366, 1398, 1374, 1400];
  assert.deepEqual(run(picked, picked.slice(0, 5)), { bulkDraftable: picked, offScreenPicks: 1 });
  assert.deepEqual(run([5, 5, 6], [5]), { bulkDraftable: [5, 6], offScreenPicks: 1 }, "a lead ticked twice is drafted once");
});