import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobs } from "./ci-yaml.mjs";

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
  "scripts/delete-corrections-e2e.mjs",
  "scripts/provider-signin-e2e.mjs",
  "scripts/failover-e2e.mjs",
  "scripts/dark-picker-e2e.mjs",
  "scripts/scan-desk-e2e.mjs",
  "scripts/sources-desk-e2e.mjs",
  "scripts/claim-sources-pull-walk.mjs",
  // Unit CR (0.6.81): creates the first account, and its whole subject is what
  // the owner sees when the setup code is wrong -- so it needs a desk with a
  // PENDING code, which is a virgin desk by definition.
  "scripts/first-owner-setup-code-walk.mjs",
  // Unit U5 (0.6.82): three walks that were on disk and run by nothing. Each
  // creates the first account, so each needs a virgin desk of its own.
  "scripts/publish-blockers-walk.mjs",
  "scripts/co-transcript-walk.mjs",
  "scripts/meeting-settings-e2e.mjs",
  "scripts/cp-desk-dialogs-walk.mjs",
  "scripts/walk-every-control-0681.mjs",
  // FB6: the pending/optimistic/rolled-back states of Today, Queue and Drafts.
  // It creates the first account and boots its own server, so it carries its
  // own desk like the three above.
  "scripts/fb6-desk-feedback-walk.mjs",
  // Unit F6: every desk route measured against the window at five widths. It
  // creates the first account, so it needs a virgin desk of its own -- which
  // it gets by booting its own server on its own port over in-memory PGlite.
  "scripts/desk-narrow-width-walk.mjs",
  // Unit UI1b, step 1: every clickable on every desk route, measured for the
  // 3:1 edge/fill rule, the 44px target and the underline rule. It creates the
  // first account and seeds its own rows, so it carries its own desk -- booted
  // by the walk itself on its own port over in-memory PGlite.
  "scripts/desk-clickable-guard-walk.mjs",
];

/**
 * Walks that boot the built server THEMSELVES, in their own process, on their
 * own port over their own in-memory PGlite.
 *
 * This matters to the two tests below and only to them. Both were written when
 * every desk walk signed up on a `npm start` server the JOB owned, so two of
 * them in one job meant the second arrived at a sign-in page with no sign-up
 * form. A walk that imports `.output/server/index.mjs` (or spawns its own) has
 * its own desk by construction and cannot collide with anything -- so the rule
 * is applied to the walks it was written for, and the exemption is read off
 * the scripts rather than hand-listed, because a hand-list is what let
 * `publish-blockers-walk.mjs` look guarded while nothing ran it.
 */
function bootsItsOwnServer(script) {
  return readFileSync(join(ROOT, script), "utf8").includes(".output/server/index.mjs");
}

test("each desk-claiming walk exists and is referenced by CI", () => {
  for (const s of CLAIMERS) {
    readFileSync(join(ROOT, s), "utf8"); // throws if the script is gone
    assert.ok(ci.includes(s), `${s} is never run by CI`);
  }
});

test("no CI job runs two walks that would share one desk", () => {
  const offenders = [];
  for (const [name, body] of Object.entries(jobs(ci))) {
    const text = body.join("\n");
    const found = CLAIMERS.filter((s) => text.includes(s) && !bootsItsOwnServer(s));
    if (found.length > 1) {
      offenders.push(
        `job "${name}" runs ${found.length}: ${found.join(", ")} — ` +
          `the first claims the desk and the rest cannot sign up`,
      );
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("every job that runs a desk-claiming walk on the job's own server starts one", () => {
  const offenders = [];
  for (const [name, body] of Object.entries(jobs(ci))) {
    const text = body.join("\n");
    const found = CLAIMERS.filter((s) => text.includes(s) && !bootsItsOwnServer(s));
    if (!found.length) continue;
    if (!/npm run dev|npm start/.test(text)) {
      offenders.push(`job "${name}" runs a desk walk but never starts a server`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("the real-Postgres matrix uses the explicit runner for every discovered test", () => {
  const postgresJob = jobs(ci)["postgres-integration"]?.join("\n") ?? "";
  assert.match(postgresJob, /^ {4}name: Every discovered PostgreSQL-capable test, on a real Postgres, part \$\{\{ matrix\.part \}\} of 3$/m);
  assert.match(postgresJob, /fail-fast:\s*false/);
  assert.match(postgresJob, /part:\s*\[1, 2, 3\]/);
  assert.match(postgresJob, /TOWNREPORTER_POSTGRES_PART:\s*\$\{\{ matrix\.part \}\}/);
  assert.match(postgresJob, /TOWNREPORTER_POSTGRES_PARTS:\s*["']?3/);
  assert.match(postgresJob, /TOWNREPORTER_RUN_POSTGRES_INTEGRATION:\s*["']?1/);
  assert.match(postgresJob, /TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL:/);
  assert.match(postgresJob, /node scripts\/run-postgres-integration\.mjs/);
  assert.doesNotMatch(postgresJob, /TEST_POSTGRES_ADMIN_URL:/);
});
