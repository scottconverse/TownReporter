import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pull the `run:` command lines out of one job's `steps:` list in a GitHub
 * Actions workflow, without a YAML dependency (js-yaml is only present in
 * this repo as townreporter-web's extraneous transitive install -- not a
 * declared dependency here, and out of bounds to reach into).
 *
 * This still has to be structural, not a flat grep over the whole file: a
 * `#` comment describing a step is not a step. The indentation rules of a
 * GitHub Actions workflow are simple enough to walk by hand -- a job is a
 * `  name:` line at 2-space indent, its `steps:` is the list under it, each
 * step starts with a `- ` at a fixed deeper indent, and a step ends at the
 * next line back at that indent (or shallower). Comment lines start with
 * `#`, never `-`, so they fall out of every step boundary this walks.
 */
function jobRunLines(ciText, jobName) {
  const lines = ciText.split(/\r?\n/);
  const jobHeader = new RegExp(`^  ${jobName}:\\s*$`);
  const jobStart = lines.findIndex((l) => jobHeader.test(l));
  assert.notEqual(jobStart, -1, `job "${jobName}" not found in ci.yml`);
  let jobEnd = lines.length;
  for (let i = jobStart + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) {
      jobEnd = i;
      break;
    }
  }
  const jobLines = lines.slice(jobStart + 1, jobEnd);
  const stepsStart = jobLines.findIndex((l) => /^\s*steps:\s*$/.test(l));
  assert.notEqual(stepsStart, -1, `job "${jobName}" has no steps: list`);
  const stepIndentMatch = jobLines.slice(stepsStart + 1).find((l) => /\S/.test(l));
  const stepIndent = stepIndentMatch ? stepIndentMatch.match(/^\s*/)[0].length : 0;

  const out = [];
  let inRunBlock = false;
  let blockIndent = 0;
  for (const line of jobLines.slice(stepsStart + 1)) {
    if (/^\s*$/.test(line)) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent < stepIndent) break; // left the steps: list entirely
    const stripped = line.trim();
    if (inRunBlock) {
      if (indent > blockIndent) {
        out.push(stripped);
        continue;
      }
      inRunBlock = false; // fell through to the next key/step below
    }
    const singleLine = stripped.match(/^-?\s*run:\s*(.+)$/);
    const blockScalar = stripped.match(/^-?\s*run:\s*\|\s*$/);
    if (blockScalar) {
      inRunBlock = true;
      blockIndent = indent;
    } else if (singleLine) {
      out.push(singleLine[1].trim());
    }
  }
  return out;
}

/**
 * Bracket-count an `if (COND) { BODY }` guard out of TypeScript source,
 * anchored at the first occurrence of `anchor` inside COND.
 *
 * Regex alone can't isolate this: the condition itself contains parens
 * (`shouldCommitFetchHashes({ ... })`), so a naive `/if \(.*?\)/` stops at the
 * first `)` it meets, which lands inside the call. Counting brackets finds
 * the real end of the condition and of the block that follows it, so the
 * extracted text is exactly what the JS engine would treat as the guard —
 * not a string that merely contains the right names.
 */
function extractIfGuard(src, anchor) {
  const anchorIdx = src.indexOf(anchor);
  assert.notEqual(anchorIdx, -1, `anchor not found in source: ${anchor}`);
  const ifIdx = src.lastIndexOf("if (", anchorIdx);
  assert.notEqual(ifIdx, -1, `no enclosing "if (" before anchor: ${anchor}`);
  let depth = 0;
  let condStart = -1;
  let i = ifIdx + 3;
  for (; i < src.length; i++) {
    if (src[i] === "(") {
      if (depth === 0) condStart = i + 1;
      depth++;
    } else if (src[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  const condition = src.slice(condStart, i);
  let j = i + 1;
  while (/\s/.test(src[j])) j++;
  assert.equal(src[j], "{", "guard must be a braced block, not a single-statement if");
  let bdepth = 0;
  const bodyStart = j + 1;
  let k = j;
  for (; k < src.length; k++) {
    if (src[k] === "{") bdepth++;
    else if (src[k] === "}") {
      bdepth--;
      if (bdepth === 0) break;
    }
  }
  return { ifIdx, condition, body: src.slice(bodyStart, k), blockEnd: k };
}

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

/** Strip comments so a stray mention in prose cannot satisfy a source-shape check below. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Pull the identifiers out of a `.middleware([ ... ])` call by counting
 * brackets, not by matching a literal `.middleware([name])` string. A
 * formatter that reflows the array onto several lines, or a second
 * middleware added to the array, must not change whether this finds it.
 */
function extractMiddlewareNames(block) {
  const idx = block.indexOf(".middleware([");
  if (idx === -1) return [];
  const start = idx + ".middleware([".length;
  let depth = 1;
  let i = start;
  for (; i < block.length; i++) {
    if (block[i] === "[") depth++;
    else if (block[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  return block
    .slice(start, i)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Every `export const X = createServerFn` in one file, with the middleware
 * identifiers attached to it (comment-stripped source, so a comment cannot
 * forge a gate that isn't really there).
 *
 * The end of one function's block is the next top-level `export` of any
 * kind, not just the next `createServerFn` -- a plain `export const` or
 * `export type` sitting between two server functions (both happen in this
 * codebase, e.g. `public.ts`'s `SEARCH_MIN_INDEXED`) must not get folded into
 * the function above it, where its absence of a `.middleware([...])` would
 * be silently forgiven by the next real server function's gate.
 */
function discoverServerFnsInFile(relPath, rawSrc) {
  const src = stripComments(rawSrc);
  const results = [];
  for (const match of src.matchAll(/^export const (\w+) = createServerFn/gm)) {
    const name = match[1];
    const afterStart = match.index + match[0].length;
    const rest = src.slice(afterStart);
    const nextExportOffset = rest.search(/^export /m);
    const end = nextExportOffset === -1 ? src.length : afterStart + nextExportOffset;
    results.push({ file: relPath, name, middleware: extractMiddlewareNames(src.slice(match.index, end)) });
  }
  return results;
}

/**
 * Every server function in `src/`, discovered by walking the tree rather
 * than by naming files. This is the fix for the census this replaces: that
 * one read exactly `desk.ts` and `dark.ts` by name, so `opinion.ts`,
 * `trash.ts`, `dashboard.ts` and `claim.ts` -- 16 more gated functions,
 * including a permanent-delete and the ops health/actions endpoints -- were
 * never looked at. A seventh module added next month is covered by this
 * walk without anyone remembering to add it to a list.
 */
function discoverAllServerFns(srcRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const rel = relative(ROOT, full).replace(/\\/g, "/");
        out.push(...discoverServerFnsInFile(rel, readFileSync(full, "utf8")));
      }
    }
  };
  walk(srcRoot);
  return out;
}

/*
  This used to be a source-text match: `assert.match(src, /assertHttpUrl/)`.
  That is satisfied by the import line alone, so the actual defect an audit
  introduced here -- swapping `assertHttpUrl(raw.trim())` for a bare
  `new URL(raw.trim())` inside sanitizePublicUrls -- left every assertion
  green, because "assertHttpUrl" still appeared in the file (in the now-dead
  import) and nothing checked what the function actually *returns*.

  Running the real function is not just feasible here, it is strictly
  stronger: schema.ts has no Node built-ins, so Node's default TS type
  stripping (this repo targets Node 22+, which supports it) loads it
  directly, no build step, no mock. Feed it URLs a bare `new URL()` parses
  happily but the SSRF/internal-host gate must reject, and check what comes
  out the other side.
*/
test("sanitizePublicUrls is the journalism URL gate, not an origin allowlist", async () => {
  const mod = await import(pathToFileURL(join(ROOT, "src/lib/news/schema.ts")).href);
  const blocked = [
    "http://127.0.0.1/admin", // loopback
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://[::1]/", // IPv6 loopback
    "http://internal-service.internal/", // reserved TLD-ish suffix
    "http://my-desk.local/", // mDNS suffix
    "ftp://example.com/file", // non-http(s) scheme
    "not a url at all",
  ];
  const allowed = "https://example.com/a-real-story";
  const out = mod.sanitizePublicUrls([...blocked, allowed, allowed]); // + a dupe
  // Every blocked entry must be gone and the one legitimate URL survives,
  // deduplicated -- that's the whole contract of the function, proven by
  // running it rather than by hoping a call site was left unmodified.
  assert.deepEqual(out, [allowed]);
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

/*
  Every server function in `src/` is either gated or on a named,
  disk-checked allowlist of intentionally public reader endpoints.

  This is the direct fix for the finding that follows from the
  `desk.ts`/`dark.ts`-only census above: an audit removed `.middleware([
  deskMiddleware])` from `getOpsHealth` (`src/lib/ops/dashboard.ts`, no
  `context` argument, so nothing types it) and both `npm run typecheck` and
  the full suite stayed green, because nothing was looking at that file.
  `opinion.ts` (incl. `publishEditorial`/`deleteEditorial`), `trash.ts`
  (incl. the permanent-delete `purgeTrashItem`), `dashboard.ts` and
  `claim.ts` were equally unwatched.

  The allowlist exists so a genuinely public reader endpoint doesn't have to
  fake a middleware to pass this test -- but adding a name to it is a
  decision left in the diff for review, not a silent default, and the second
  assertion below fails the day the allowlist drifts from what's on disk
  (a renamed or deleted function left in it, masking the fact that nothing
  in `src/` claims to be that entry any more).
*/
test("every server function in src/ is gated, or is named on the public allowlist", () => {
  const PUBLIC_SERVER_FNS = new Set([
    // The one thing an unclaimed desk must answer before anyone can sign in.
    "src/lib/news/claim.ts::deskClaimState",
    // Is this invite link live? The invitee is BY DEFINITION not signed in
    // yet. Takes an unguessable 64-hex token, compares only its hash, and
    // reveals nothing about any address unless the token itself is valid.
    "src/lib/news/claim.ts::inviteState",
    // The public evidence trail behind a published story -- readable by anyone
    // who can read the story itself.
    "src/lib/news/evidence.ts::getPublicEvidence",
    "src/lib/news/evidence.ts::listPublicHistory",
    "src/lib/news/evidence.ts::listPublicVersionsForUrl",
    "src/lib/news/evidence.ts::comparePublicEvidence",
    // The public paper itself.
    "src/lib/news/public.ts::listPublishedArticles",
    "src/lib/news/public.ts::getPublishedArticle",
    "src/lib/news/public.ts::listPublishedByTopic",
    "src/lib/news/public.ts::searchPublished",
    "src/lib/news/public.ts::listPublicCorrections",
  ]);
  const GATES = new Set(["deskMiddleware", "authMiddleware"]);

  const found = discoverAllServerFns(join(ROOT, "src"));
  assert.ok(found.length >= 60, `expected dozens of server functions, found ${found.length} -- the walk may be broken`);

  const ungated = found
    .filter((fn) => !PUBLIC_SERVER_FNS.has(`${fn.file}::${fn.name}`))
    .filter((fn) => !fn.middleware.some((m) => GATES.has(m)))
    .map((fn) => `${fn.file}::${fn.name}`);
  assert.deepEqual(
    ungated,
    [],
    `these server functions carry no deskMiddleware/authMiddleware and are not on the public allowlist:\n  ${ungated.join("\n  ")}`,
  );

  const foundKeys = new Set(found.map((fn) => `${fn.file}::${fn.name}`));
  const stale = [...PUBLIC_SERVER_FNS].filter((k) => !foundKeys.has(k));
  assert.deepEqual(stale, [], `the public allowlist names a server function that no longer exists on disk: ${stale.join(", ")}`);
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

/*
  The old version asserted "shouldCommitFetchHashes" appears in desk.ts and
  that one specific dead SQL string ("...last_hash = ${hash}...") is absent.
  Neither checks what the guard does. The introduced defect changed
  `if (!shouldCommitFetchHashes(...))` to `if (false && !shouldCommitFetchHashes(...))`
  -- the identifier is still right there, the old dead-SQL string was never
  the shape of the real code anyway, and the guard now can never fire, so
  every scan stamps last_hash even when the writing pass produced nothing
  usable. Both old assertions stayed green.

  desk.ts can't be safely imported and run in this suite: importing it runs
  a module graph that reaches @tanstack/react-start, a live DB pool and
  outbound HTTP (grokChat, ingestUrl) at import or call time, none of which
  belong in a source-text/behavioural unit test. What *can* be exercised for
  real is the guard's own condition -- bracket-extracted from desk.ts, then
  evaluated as actual JavaScript with the real, unmodified
  shouldCommitFetchHashes imported from schema.ts. `false && ...` and other
  neutered variants change what that expression evaluates to; the identifier
  match alone never would have.
*/
test("scan does not stamp last_hash until the writing pass succeeds", async () => {
  const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
  assert.match(desk, /pendingHashes/);
  assert.match(desk, /previousScanNeedsReread/);
  assert.match(desk, /parseScanResult/);

  const { condition, body, ifIdx, blockEnd } = extractIfGuard(
    desk,
    "shouldCommitFetchHashes({ aiOk: true",
  );
  // The guard's own body must be the thing that stops the commit, not a
  // side-effect-free no-op left standing while the condition was gutted.
  assert.match(body, /throw new Error/, "the guard must actually abort the scan");

  const schema = await import(pathToFileURL(join(ROOT, "src/lib/news/schema.ts")).href);
  const evalGuard = (parseError) =>
     
    // condition text is the point: it is the exact expression the running
    // code branches on, not a paraphrase of it.
    new Function(
      "shouldCommitFetchHashes",
      "data",
      `return (${condition});`,
    )(schema.shouldCommitFetchHashes, { parseError });

  // A clean pass (no parse error): the guard must be false, i.e. must NOT
  // take the abort path, so pendingHashes get committed.
  assert.equal(evalGuard(null), false, "a successful writing pass must not trip the guard");
  // A failed writing pass: the guard must be true, i.e. MUST abort before
  // any hash gets stamped. `false && ...` fails exactly this line, because
  // it can never be true no matter what parseError says.
  assert.equal(evalGuard("Writing pass returned no usable JSON."), true, "a failed writing pass must trip the guard");

  // The commit loop must textually follow the whole guarded block, not sit
  // ahead of it where the throw could no longer prevent it from running.
  const commitLoopIdx = desk.indexOf("for (const p of pendingHashes)");
  assert.ok(commitLoopIdx > blockEnd, "the pendingHashes commit loop must come after the guard, not before it");
  assert.ok(ifIdx > desk.indexOf("const data = parseScanResult(raw)"), "the guard must run after parsing, not before");
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
/*
  `assert.match(ci, /npm run build/)` is satisfied by the prose comment above
  the smoke-built job -- which literally says "It never ran `npm run build`"
  while explaining the bug this test exists to prevent. Deleting the actual
  `- run: npm run build` step left that comment standing, so the regex never
  noticed the step was gone.

  A workflow file has no code to execute, so there is no behavioural
  equivalent to "run it and see" -- this genuinely is a source-shape check.
  What anchors it is parsing the YAML instead of grepping the text: a YAML
  comment is not data, so js-yaml throws it away before this test ever sees
  it, and a step string has to be an actual step in an actual job's `steps`
  list, not a run anywhere near the word "build". A `- run: npm run build`
  removed from the steps array cannot be satisfied by a comment, an env var
  named BUILD, or a step that runs "npm run build:dev" (different script).
*/
test("CI builds, boots and smoke-tests in a browser", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

  const builtSteps = jobRunLines(ci, "smoke-built");
  assert.ok(builtSteps.includes("npm run build"), "smoke-built must have a step that runs exactly `npm run build`");
  assert.ok(
    builtSteps.some((l) => l === "npm start" || l.startsWith("npm start ")),
    "smoke-built must boot the built server with npm start",
  );
  assert.ok(
    builtSteps.some((l) => l.includes("smoke-built-server.mjs")),
    "smoke-built must run the browser smoke script",
  );

  const devSteps = jobRunLines(ci, "smoke-dev");
  assert.ok(
    devSteps.some((l) => l.includes("smoke-built-server.mjs")),
    "smoke-dev must smoke the documented dev path with the same browser script",
  );
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

/**
 * DOC-003 (2026-08-29 documentation audit): desk searches leave the machine
 * via a third-party chain (Exa, then DuckDuckGo, Bing, Brave, Wikipedia --
 * src/lib/news/search-web.ts), unconditionally, on an editor's action. The
 * landing page's "Zero trackers" badge is true only of the reader's pages,
 * and nothing used to say so. Two invariants now enforced:
 *
 *  1. The landing badge (or any doc claiming zero outside requests) must
 *     scope that claim to the reader -- never state it unqualified.
 *  2. At least one reader-facing doc must actually name the third-party
 *     search chain, so the disclosure this test protects cannot be quietly
 *     deleted.
 */
test("the 'zero outside requests' claim is scoped to the reader, not the desk", () => {
  const text = readFileSync(join(ROOT, "docs/index.html"), "utf8");
  const offenders = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/zero outside requests/i.test(line)) return;
    // The badge and any restatement must carry a reader/page scope on the
    // same line -- an unqualified "zero outside requests" reads as covering
    // the whole product, which is false once the desk is used.
    if (/reader|page/i.test(line)) return;
    offenders.push(`docs/index.html:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
  assert.deepEqual(
    offenders,
    [],
    `"zero outside requests" must be scoped to the reader's page, not asserted unqualified:\n  ${offenders.join("\n  ")}`,
  );
});

test("at least one reader-facing doc discloses the desk's third-party search chain", () => {
  const files = ["README.md", join("docs", "setup.md"), join("docs", "manual.md")];
  const found = files.some((rel) => {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      return false;
    }
    return /mcp\.exa\.ai/i.test(text) && /duckduckgo/i.test(text);
  });
  assert.ok(
    found,
    "none of README.md, docs/setup.md, docs/manual.md name the Exa/DuckDuckGo search chain -- the desk-egress disclosure (DOC-003) appears to have been removed",
  );
});

/**
 * DOC-006 (2026-08-29 documentation audit): the repo root ships a second
 * product identity -- AGENTS.md opens "You are Grok Build... App Builder
 * Workspace" and AGENTS.project.md is a personal sandbox handoff runbook,
 * both unscoped, so a GitHub visitor who opens either meets an unrelated
 * product. Both files now carry a scope note saying they are build-tooling,
 * not TownReporter documentation. This guards against that note being lost
 * on a future edit to either file.
 */
test("AGENTS.md and AGENTS.project.md carry a scope note disclaiming product docs", () => {
  const offenders = [];
  for (const rel of ["AGENTS.md", "AGENTS.project.md"]) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (!/not\b[^.]{0,60}TownReporter[^.]{0,40}(documentation|product)/i.test(text)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these files are missing the scope note that keeps a GitHub reader from mistaking them for TownReporter's own docs: ${offenders.join(", ")}`,
  );
});
