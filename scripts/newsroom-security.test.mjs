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

/*
  The 0.5.1 flows are exercised by something that runs again.

  Opinion, delete, Undo, the trash and its restore, the Server page and the
  Dark Desk dials shipped with no browser coverage at all. A locator leak and
  an editorial that could not be edited both reached the paper, because those
  screens were verified once by an agent looking at them. Audit finding TE-04.
*/
test("CI walks the 0.5.1 desk flows in a browser", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /desk-flows-e2e\.mjs/, "CI must run the desk flows walk");
  const walk = readFileSync(join(ROOT, "scripts", "desk-flows-e2e.mjs"), "utf8");
  for (const flow of [
    "desk/opinion",
    "Recently deleted",
    "Undo",
    "Restore",
    "How hard to dig",
    "row-acts",
  ]) {
    assert.ok(walk.includes(flow), `the walk must cover: ${flow}`);
  }
});

/*
  .env.example is the inventory docs/setup.md says it is.

  An audit found several variables the code reads that the example file never
  mentioned — including EDITORIAL_TIMEOUT_MS, which the manual told operators
  to raise while the code ignored it entirely. A config file that lists some of
  the settings is worse than none: it reads as complete. Audit finding TW-006.

  OS-provided variables are excluded; nobody sets HOME in a .env.
*/
test(".env.example lists every setting the code reads", () => {
  const OS_PROVIDED = new Set(["APPDATA", "HOME", "USERPROFILE", "TEMP", "TMPDIR", "NODE_ENV"]);
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const declared = new Set(
    [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]{3,})\s*=/gm)].map((m) => m[1]),
  );

  const srcDir = join(ROOT, "src");
  const read = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{3,})/g)) read.add(m[1]);
        for (const m of text.matchAll(/\benv\("([A-Z][A-Z0-9_]{3,})"\)/g)) read.add(m[1]);
      }
    }
  };
  walk(srcDir);

  const missing = [...read].filter((k) => !OS_PROVIDED.has(k) && !declared.has(k)).sort();
  assert.deepEqual(missing, [], `these are read by the code but absent from .env.example: ${missing.join(", ")}`);
});

/**
 * The docs must not tell an operator to set a variable the code ignores.
 *
 * `NEWSROOM_SETUP_TOKEN` was removed from the code in 0.5.1 -- a single-editor
 * newsroom cannot re-issue a token it has lost, so the token was a lock with no
 * locksmith, and the operator asked for it to go. A test already forbids the
 * code path. Nothing forbade the prose, and an audit found the README,
 * .env.example, docs/setup.md, docs/editor.md and docs/manual.md all still
 * instructing operators to set it "on a public host" -- advice that reads like a
 * security step and does nothing at all.
 *
 * The archive and the changelog are exempt on purpose: they record what past
 * releases did, and rewriting history to match the present is how a changelog
 * stops being useful.
 */
test("no live doc tells the operator to set the removed setup token", () => {
  const roots = ["README.md", "SELF-HOSTING.md", ".env.example"];
  const docs = readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("docs", f));
  const offenders = [];
  for (const rel of [...roots, ...docs]) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      // A line explaining that it was removed is the fix, not the defect.
      if (!line.includes("NEWSROOM_SETUP_TOKEN")) return;
      if (/removed|no setup token|gone|used to/i.test(line)) return;
      offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `these lines still instruct the operator to set a variable the code ignores:\n  ${offenders.join("\n  ")}`,
  );
});

/**
 * The docs must not price the test suite wrongly, in either direction.
 *
 * SELF-HOSTING.md told operators `npm test` makes one real Claude call and
 * offered a variable to "skip it". That was true of an earlier release. The
 * suite has been hermetic since the live model path moved behind
 * `npm run test:live-model`, and an audit measured it: 540 tests, ~14 seconds,
 * no provider contacted. The cost claim survived because prose is not
 * executable, so nothing failed when it stopped being true.
 *
 * A wrong cost claim is not cosmetic. It teaches a contributor that running the
 * tests is something to avoid, which is the opposite of what the project wants,
 * and it is exactly the kind of sentence people trust without checking.
 */
test("no live doc claims the ordinary test suite spends money", () => {
  const files = ["README.md", "SELF-HOSTING.md", ...readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("docs", f))];
  const offenders = [];
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      if (!/`?npm test`?/.test(line)) return;
      // "makes no model call" and "used to" are the correction, not the defect.
      if (/\bno model call|costs nothing|used to make/i.test(line)) return;
      if (/real (Claude|model) call|billed|spends? (quota|money)|costs (money|real)/i.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `the suite is hermetic; these lines still say running it costs something:\n  ${offenders.join("\n  ")}`,
  );
});
