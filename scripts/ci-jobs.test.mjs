import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every browser walk that claims a desk must have a server to itself.
 *
 * The 0.5.1 desk-flows walk was added as a STEP inside the lifecycle job,
 * running after `lifecycle-e2e.mjs` on the same dev server. Both scripts create
 * their own owner at /login, and the first account in owns the newsroom -- so
 * the second one arrived at a sign-in page with no sign-up form and died at
 * step zero, every time, with an empty completed list. It could never have gone
 * green. An audit called it a blocker, and the reason it survived is that a
 * weaker guard test passed simply because the filename appeared in ci.yml.
 *
 * This asserts the property that actually matters: each desk-claiming script is
 * invoked in a job that starts its own server, and no job runs two of them.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Scripts that call `Create editor account`, i.e. that need a virgin desk. */
const CLAIMERS = [
  "scripts/lifecycle-e2e.mjs",
  "scripts/desk-flows-e2e.mjs",
  "scripts/sources-reach-the-reader.mjs",
];

/** Split the workflow into jobs by indentation, without a YAML parser. */
function jobs() {
  const out = {};
  let current = null;
  for (const line of ci.split(/\r?\n/)) {
    const m = /^ {2}([a-z0-9][a-z0-9-]*):\s*$/.exec(line);
    if (m) {
      current = m[1];
      out[current] = [];
      continue;
    }
    if (current) out[current].push(line);
  }
  return out;
}

test("each desk-claiming walk exists and is referenced by CI", () => {
  for (const s of CLAIMERS) {
    readFileSync(join(ROOT, s), "utf8"); // throws if the script is gone
    assert.ok(ci.includes(s), `${s} is never run by CI`);
  }
});

test("no CI job runs two walks that both claim the desk", () => {
  const offenders = [];
  for (const [name, body] of Object.entries(jobs())) {
    const text = body.join("\n");
    const found = CLAIMERS.filter((s) => text.includes(s));
    if (found.length > 1) {
      offenders.push(
        `job "${name}" runs ${found.length}: ${found.join(", ")} — ` +
          `the first claims the desk and the rest cannot sign up`,
      );
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("every job that runs a desk-claiming walk starts its own server", () => {
  const offenders = [];
  for (const [name, body] of Object.entries(jobs())) {
    const text = body.join("\n");
    if (!CLAIMERS.some((s) => text.includes(s))) continue;
    if (!/npm run dev|npm start/.test(text)) {
      offenders.push(`job "${name}" runs a desk walk but never starts a server`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
