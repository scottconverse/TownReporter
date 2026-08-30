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
 * This is a source-shape check and that is a compromise worth naming. The
 * behavioural version would need a running server, a claimed desk and a lead in
 * the queue, and it belongs in the browser walks. What this catches is the
 * cheap, likely regression: someone adds a fourth model-spending action and
 * forgets the guard, exactly as happened here. So rather than assert that one
 * function contains one string, it enumerates every server function that
 * enqueues model work and requires each to preflight first -- a new one is
 * caught by being new, not by being remembered.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");

/** Split the file into `export const <name> = createServerFn(...)` blocks. */
function serverFunctions() {
  const out = [];
  const re = /export const (\w+) = createServerFn/g;
  const starts = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push([m[1], m.index]);
  for (let i = 0; i < starts.length; i++) {
    const [name, at] = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1][1] : src.length;
    out.push({ name, body: src.slice(at, end) });
  }
  return out;
}

test("every server function that enqueues model work preflights first", () => {
  const spenders = serverFunctions().filter((f) => /enqueueJob\(/.test(f.body));
  assert.ok(spenders.length > 0, "no model-spending server functions found — has desk.ts moved?");

  const unguarded = [];
  for (const f of spenders) {
    const guardAt = f.body.indexOf("scanPreflight(");
    const spendAt = f.body.indexOf("enqueueJob(");
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
    if (!/if \(!ready\.ok\)[\s\S]{0,200}return/.test(between)) {
      unguarded.push(`${f.name}: preflights but does not return when the provider is absent`);
    }
  }
  assert.deepEqual(
    unguarded,
    [],
    `these spend the editor's time before checking whether a model exists:\n  ${unguarded.join("\n  ")}`,
  );
});
