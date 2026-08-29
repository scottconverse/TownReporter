import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function everyServerFnHasMiddleware(src, middleware) {
  const names = [...src.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1]);
  const missing = [];
  for (const name of names) {
    const idx = src.indexOf(`export const ${name} = createServerFn`);
    const next = src.indexOf("export const ", idx + 20);
    const block = next === -1 ? src.slice(idx) : src.slice(idx, next);
    if (!block.includes(`.middleware([${middleware}])`)) missing.push(name);
  }
  return missing;
}

test("sanitizePublicUrls is the journalism URL gate, not an origin allowlist", () => {
  const src = readFileSync(join(ROOT, "src/lib/news/schema.ts"), "utf8");
  assert.match(src, /export function sanitizePublicUrls/);
  assert.match(src, /assertHttpUrl/);
  assert.doesNotMatch(src, /allowed\.has\(u\.origin\)/);
  assert.match(src, /ScanResultSchema/);
  assert.match(src, /DraftResultSchema/);
});

test("every desk and dark mutation is gated by deskMiddleware", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  const dark = readFileSync(join(ROOT, "src/lib/news/dark.ts"), "utf8");
  assert.deepEqual(everyServerFnHasMiddleware(desk, "deskMiddleware"), []);
  assert.deepEqual(everyServerFnHasMiddleware(dark, "deskMiddleware"), []);
  assert.match(desk, /export const publishLead[\s\S]*?\.middleware\(\[deskMiddleware\]\)/);
  assert.match(desk, /sanitizePublicUrls/);
  assert.doesNotMatch(desk, /originAllowlist\(/);
  assert.match(desk, /assertRate\(context\.userId, "scan"\)/);
  assert.match(desk, /assertRate\(context\.userId, "draft"\)/);
  assert.match(desk, /withTransaction/);
  assert.match(dark, /assertRate\(context\.userId, "dark"\)/);
  assert.match(dark, /audit\(\s*(?:context\.)?userId,\s*"dark"/);
});

test("membership rejects a second identity (unauthorized publish path)", () => {
  const membership = readFileSync(join(ROOT, "src/lib/news/membership.ts"), "utf8");
  const auth = readFileSync(join(ROOT, "src/lib/news/desk-auth.ts"), "utf8");
  assert.match(membership, /class ForbiddenError/);
  assert.match(membership, /readonly status = 403/);
  assert.match(membership, /throw new ForbiddenError/);
  assert.match(membership, /role === "owner" \|\| mine\[0\]\?\.role === "editor"/);
  assert.match(auth, /requireUserId/);
  assert.match(auth, /requireEditor/);
  assert.match(auth, /assertSameSiteRequest/);
});

test("public paper SQL is a single LIMIT and has no desk middleware", () => {
  const pub = readFileSync(join(ROOT, "src/lib/news/public.ts"), "utf8");
  assert.doesNotMatch(pub, /limit 30\s*\n\s*limit /);
  assert.doesNotMatch(pub, /deskMiddleware/);
});

/*
  This module is imported by `/`, `/articles/$slug` and `/corrections`, so
  anything it imports lands in the browser bundle. It imported `node:crypto`
  for the newsletter's token hashing, which externalized in the client and
  killed hydration: `npm run dev` — the path the README gives a new
  contributor — showed "Opening..." forever with no sign-in form.

  The newsletter is gone (it also returned its confirmation token straight to
  the caller). These assertions keep both problems from coming back.

  Audit findings UIUX-01 / QA-001 (Blocker) and ENG-007 (Major).
*/
test("the public module keeps Node-only imports out of the browser bundle", () => {
  const pub = readFileSync(join(ROOT, "src/lib/news/public.ts"), "utf8");
  const code = pub.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const mod of ["node:crypto", "node:fs", "node:child_process", "node:os", "node:path"]) {
    assert.doesNotMatch(code, new RegExp(`from ["']${mod}["']`), `${mod} must not reach the client`);
  }
});

test("the newsletter RPC that handed out its own confirmation token stays gone", () => {
  const pub = readFileSync(join(ROOT, "src/lib/news/public.ts"), "utf8");
  const code = pub.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /confirm_token/);
  assert.doesNotMatch(code, /subscribeNewsletter|confirmNewsletter/);
  assert.doesNotMatch(code, /create table if not exists|alter table/i, "schema belongs in migrations/");
});

test("SSRF: fetch follows redirects manually and re-asserts each hop", () => {
  const src = readFileSync(join(ROOT, "src/lib/news/fetch-url.ts"), "utf8");
  assert.match(src, /redirect: "manual"/);
  assert.match(src, /fetchPublicHttpTracked/);
  assert.match(src, /assertPublicHttpUrl/);
  assert.match(src, /lookup\(host, \{ all: true \}\)/);
  assert.match(src, /isBlockedAddress/);
  assert.match(src, /isIP\(host\) && isBlockedAddress\(host\)/);
});

test("scan does not stamp last_hash until the writing pass succeeds", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.match(desk, /pendingHashes/);
  assert.match(desk, /shouldCommitFetchHashes/);
  assert.match(desk, /previousScanNeedsReread/);
  assert.match(desk, /parseScanResult/);
  assert.doesNotMatch(desk, /set last_hash = \$\{hash\}, last_fetched_at = now\(\)/);
});

test("scan never auto-promotes model URLs to official or Tier A", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.match(desk, /'discovered', 'unclassified', 'proposed'/);
  assert.doesNotMatch(desk, /'official', 'B', 'proposed'/);
  assert.match(desk, /ingestUrl/);
  assert.doesNotMatch(desk, /tier: 'A', 'accepted'/);
});

test("scan includes Tier C and never prunes snapshot history", () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.doesNotMatch(desk, /tier <> 'C'/);
  assert.doesNotMatch(desk, /delete from snapshots/);
  assert.doesNotMatch(desk, /offset 8/);
});

test("Dark Desk digs, does not auto-publish, does not cap confidence", () => {
  const dark = readFileSync(join(ROOT, "src/lib/news/dark.ts"), "utf8");
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  const prompt = readFileSync(join(ROOT, "src/lib/news/dark-prompt.ts"), "utf8");
  assert.match(dark, /researchLoop/);
  assert.match(dark, /continueInvestigation/);
  assert.match(dark, /Math\.min\(1,/);
  assert.doesNotMatch(dark, /Math\.min\(0\.5,/);
  assert.doesNotMatch(dark, /insert into articles/);
  assert.doesNotMatch(dark, /update leads set status = 'published'/);
  assert.match(desk, /Held and killed leads cannot print|Un-hold this lead before publishing/);
  assert.doesNotMatch(desk, /Dark desk items cannot print/);
  assert.doesNotMatch(prompt, /CAPPED AT 0\.5/);
  assert.match(prompt, /Search broadly/);
});

test("ingest follows documents across origins", () => {
  const src = readFileSync(join(ROOT, "src/lib/news/ingest.ts"), "utf8");
  assert.doesNotMatch(src, /abs\.origin !== base\.origin/);
});

/*
  The default test suite must not call a paid model.

  `scan-pass.test.ts` used to run a real 90-second Claude request whenever a
  CLI happened to be installed. An audit ran the documented `npm test` on a
  clean machine and got 494/495 with a timeout — so the "495 tests pass" claim
  in the docs was not reproducible, and every contributor and CI runner with a
  discoverable provider paid for it.

  A default suite is deterministic, offline and free. Live evaluation is
  quality telemetry, behind RUN_LIVE_MODEL_TESTS=1.

  Audit findings TE-01 / ENG-006 / QA-003.
*/
test("no test in the default suite can reach a live model unasked", () => {
  const dir = join(ROOT, "src", "lib", "news");
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
  for (const name of files) {
    const src = readFileSync(join(dir, name), "utf8");
    if (!/\bgrokChat\s*\(|\bclaudeCodeChat\s*\(/.test(src)) continue;
    // Two honest ways to call the entry point without spending anything: gate
    // the test behind the opt-in, or take the provider out of the chain first
    // so the call resolves to "unavailable" without a process or a request.
    const gated = /RUN_LIVE_MODEL_TESTS/.test(src);
    const providerDisabled = /TOWNREPORTER_CLAUDE_CODE\s*=\s*["']0["']/.test(src);
    assert.ok(
      gated || providerDisabled,
      `${name} calls a model — gate it behind RUN_LIVE_MODEL_TESTS, or disable the provider in the test`,
    );
  }
});

/*
  Test discovery is a glob, not a hand-maintained list.

  package.json used to name all 44 test files explicitly. A 45th existed on
  disk — coerce-draft.test.ts, covering the code that stops a model's raw JSON
  reaching the page as the story body — written against vitest, which this repo
  does not install. It could not run, so instead of being fixed it was left off
  the list, where its absence was invisible. An audit found it (TE-02).

  A list you edit by hand is a place for things to quietly not run.
*/
test("every test file on disk is discovered by npm test", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const cmd = pkg.scripts.test;
  assert.doesNotMatch(
    cmd,
    /\.test\.ts(?!")/,
    "npm test must not name individual test files — use a glob",
  );
  assert.match(cmd, /src\/\*\*\/\*\.test\.ts/, "the src glob must be present");
  assert.match(cmd, /scripts\/\*\*\/\*\.test\.mjs/, "the scripts glob must be present");
});

/*
  CI must build, boot and open a browser.

  Two release-blocking defects shipped past a green pipeline because it ran
  typecheck, unit tests and a lifecycle script against `npm run dev` — and
  never ran `npm run build`, never booted `.output`, and never loaded a page in
  a browser. Every server response was 200 while the client bundle threw and
  the sign-in form never rendered.

  Both modes are required. I proved the difference deliberately: with
  node:crypto reintroduced into the client graph, the built-server smoke passed
  and the dev-mode smoke failed with the exact externalization error. A
  built-only check would have shipped the Blocker again.

  Audit finding TE-05.
*/
test("CI builds, boots and smoke-tests in a browser", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /npm run build/, "CI must build");
  assert.match(ci, /npm start/, "CI must boot the built server");
  assert.match(ci, /smoke-built-server\.mjs/, "CI must run the browser smoke");
  assert.match(ci, /smoke-dev:/, "CI must smoke the documented dev path too");
  assert.match(ci, /smoke-built:/, "CI must smoke the built server too");
});

test("the smoke script actually opens a browser", () => {
  const smoke = readFileSync(join(ROOT, "scripts", "smoke-built-server.mjs"), "utf8");
  assert.match(smoke, /from "playwright"/, "a fetch-only smoke cannot see a dead client");
  assert.match(smoke, /pageerror|console/, "it must read the console");
  assert.match(smoke, /Opening/, "it must catch the hydration dead-end specifically");
});
