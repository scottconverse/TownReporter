import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every action that needs the model must refuse before it spends anything.
 *
 * `runScan` learned this the hard way and was fixed. `draftLead` had not: an
 * audit clicked "Draft with AI" on a first-run paper with no provider, watched
 * it work for thirty-six seconds, and was then told the writing model is not
 * set up and that fixing it "is an operator job" -- addressed to the only
 * operator there is, who is the person reading it.
 *
 * The desk already knew, from the same probe, before the click. Nothing was
 * learned in those thirty-six seconds.
 *
 * This source-shape tripwire now complements the behavioural disposable-DB
 * proof in model-request-commit.test.ts. It still catches the cheap, likely
 * regression: someone adds a fourth model-spending action and forgets the
 * guard, exactly as happened here. The Story and Opinion server functions
 * delegate to authenticated production commit functions; those commit
 * functions, plus any direct enqueuer, are enumerated here.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
const opinionSrc = readFileSync(join(ROOT, "src/lib/news/opinion.ts"), "utf8");
const commitSrc = readFileSync(join(ROOT, "src/lib/news/model-request-commit.server.ts"), "utf8");
const deskAuthSrc = readFileSync(join(ROOT, "src/lib/news/desk-auth.ts"), "utf8");

/** Split the file into `export const <name> = createServerFn(...)` blocks. */
function serverFunctions(source = src, file = "desk.ts") {
  const out = [];
  const re = /export const (\w+) = createServerFn/g;
  const starts = [];
  for (let m = re.exec(source); m; m = re.exec(source)) starts.push([m[1], m.index]);
  for (let i = 0; i < starts.length; i++) {
    const [name, at] = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1][1] : source.length;
    out.push({ file, name, body: source.slice(at, end) });
  }
  return out;
}

/** Split a helper file into exported async function blocks. */
function exportedAsyncFunctions(source, file) {
  const out = [];
  const re = /export async function (\w+)/g;
  const starts = [];
  for (let m = re.exec(source); m; m = re.exec(source)) starts.push([m[1], m.index]);
  for (let i = 0; i < starts.length; i++) {
    const [name, at] = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1][1] : source.length;
    out.push({ file, name, body: source.slice(at, end) });
  }
  return out;
}

function modelSpenders() {
  return [
    ...serverFunctions(src, "desk.ts"),
    ...serverFunctions(opinionSrc, "opinion.ts"),
    ...exportedAsyncFunctions(commitSrc, "model-request-commit.server.ts"),
  ].filter((f) => /enqueueJob\b/.test(f.body));
}

test("every server function that enqueues model work preflights first", () => {
  const spenders = modelSpenders();
  assert.ok(spenders.length >= 3, "expected Scan, Draft, and Opinion model enqueuers");

  const unguarded = [];
  for (const f of spenders) {
    const guardAt = f.body.search(/\b(?:scanPreflight|checkReadiness)\b/);
    const spendAt = f.body.search(/enqueueJob\b/);
    if (guardAt < 0) {
      unguarded.push(`${f.name}: enqueues model work with no provider preflight`);
      continue;
    }
    if (guardAt > spendAt) {
      unguarded.push(`${f.name}: preflights AFTER enqueuing, which spends the work anyway`);
      continue;
    }
    // A preflight that does not return on failure is decoration.
    const between = f.body.slice(guardAt, spendAt);
    if (!/if \(!(?:ready\.ok|readiness\.ready)\)[\s\S]{0,200}return/.test(between)) {
      unguarded.push(`${f.name}: preflights but does not return when the provider is absent`);
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    `these spend the editor's time before checking whether a model exists:\n  ${unguarded.join("\n  ")}`,
  );
});

test("auth and readiness refuse model work before adapters, rate, or persistence", () => {
  const middlewareServer = deskAuthSrc.slice(deskAuthSrc.indexOf(".server("));
  const userAt = middlewareServer.indexOf("requireUserId(");
  const editorAt = middlewareServer.indexOf("requireEditor(");
  const nextAt = middlewareServer.indexOf("return next(");
  assert.ok(
    userAt >= 0 && editorAt > userAt && nextAt > editorAt,
    "desk middleware must authenticate and authorize before invoking a model-work handler",
  );

  const spenders = modelSpenders();
  assert.ok(spenders.length >= 3, "expected Scan, Draft, and Opinion model enqueuers");

  const authenticatedEntries = new Map([
    [
      "commitStoryDraftForAuthenticatedEditor",
      serverFunctions(src, "desk.ts").find((f) => f.name === "draftLead"),
    ],
    [
      "commitOpinionForAuthenticatedEditor",
      serverFunctions(opinionSrc, "opinion.ts").find((f) => f.name === "startEditorial"),
    ],
    [
      "commitScanForAuthenticatedEditor",
      serverFunctions(src, "desk.ts").find((f) => f.name === "runScan"),
    ],
  ]);

  const violations = [];
  for (const f of spenders) {
    const label = `${f.file}:${f.name}`;
    const entry = authenticatedEntries.get(f.name) ?? f;
    const middlewareAt = entry?.body.indexOf(".middleware([deskMiddleware])") ?? -1;
    const handlerAt = entry?.body.indexOf(".handler(") ?? -1;
    if (middlewareAt < 0 || handlerAt < 0 || middlewareAt > handlerAt) {
      violations.push(`${label}: authenticated desk middleware does not gate the handler`);
      continue;
    }
    if (entry !== f && !entry.body.includes(`${f.name}(`)) {
      violations.push(
        `${label}: authenticated server function does not delegate to this commit boundary`,
      );
      continue;
    }

    const adapterAt = f.body.search(/\b(?:probeProvider|checkReadiness|checkOpinionReadiness)\b/);
    if (adapterAt < 0) {
      violations.push(`${label}: no provider readiness adapter found`);
    }

    const readinessAt = f.body.search(/\b(?:scanPreflight|checkReadiness|checkOpinionReadiness)\b/);
    const refusalAt = f.body.search(/if \(!(?:ready\.ok|readiness\.ready)\)/);
    const refusalReturnAt = refusalAt < 0 ? -1 : f.body.indexOf("return", refusalAt);
    const sideEffects = [
      ["rate charge", f.body.indexOf("assertRate(")],
      ["editorial request insert", f.body.search(/insert into editorial_requests/i)],
      ["job enqueue", f.body.search(/enqueueJob\b/)],
    ].filter(([, at]) => at >= 0);

    if (readinessAt < 0 || refusalAt < readinessAt || refusalReturnAt < refusalAt) {
      violations.push(`${label}: readiness failure does not return from the commit boundary`);
      continue;
    }
    for (const [effect, at] of sideEffects) {
      if (refusalReturnAt > at) {
        violations.push(`${label}: ${effect} happens before readiness refusal returns`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `model work can escape an auth/readiness refusal:\n  ${violations.join("\n  ")}`,
  );
});
