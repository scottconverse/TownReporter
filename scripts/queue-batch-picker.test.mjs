// guards: a new batch could silently spend credits using the previous batch's model.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Execute the route's picker hooks, including its effects, with a completed
// historical batch. No server, provider call, or assertion on source text.
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
const names = new Set(["batchRuntime", "batchEffort", "hydratedBatchId", "batch"]);
const identifiers = (node) => {
  const found = new Set();
  const visit = (child) => {
    if (ts.isIdentifier(child)) found.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
};
const hooks = page.body.statements.filter((node) => {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.some((decl) =>
      [...identifiers(decl.name)].some((name) => names.has(name)),
    );
  }
  return (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "useEffect" &&
    [...identifiers(node)].some((name) => name === "setBatchRuntime" || name === "setBatchEffort")
  );
});
const printer = ts.createPrinter();
const body = hooks.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n");
const executable = ts.transpileModule(body, {
  compilerOptions: { target: ts.ScriptTarget.ESNext },
}).outputText;

test("a previous batch does not choose the model or effort for a new batch", () => {
  const values = [];
  const effects = [];
  const useState = (initial) => {
    const index = values.push(initial) - 1;
    return [
      initial,
      (next) => {
        values[index] = next;
      },
    ];
  };
  const useQuery = () => ({
    data: {
      ok: true,
      batch: { id: 12, runtime: { modelChoice: "codex-frontier", modelEffort: "high" } },
    },
  });
  const run = new Function(
    "useState",
    "useRef",
    "useQuery",
    "useEffect",
    "newsroomId",
    "activeBatchId",
    executable,
  );
  run(
    useState,
    (current) => ({ current }),
    useQuery,
    (effect) => effects.push(effect),
    1,
    null,
  );
  for (const effect of effects) effect();
  assert.deepEqual(values, ["auto", null]);
});

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
