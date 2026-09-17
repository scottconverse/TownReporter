# Gate verification — can these tests actually fail?

**Date:** 2026-08-29
**Repo:** `C:\Users\scott\Desktop\Code\townreporter-dev` (branch `main`)
**Method:** for every test in the ten files in scope, read the test, work out the defect it
names, introduce that defect into the real code it guards, run the test, record red or green,
then restore the file byte-for-byte and re-run.

**Scope:** 51 named tests across 10 files. Every one was probed with at least one real defect.
A further 25 adversarial probes were run against the tests that search a window of text rather
than an anchored pattern, that read a hand-maintained list of files, or that assert on source
text rather than behaviour.

**Headline:** 45 of 51 tests CAUGHT the defect they name. 6 did not. Separately, 20 of the 25
adversarial probes slipped past a green test while the defect they carry was real — those are
listed as secondary findings because they show *how* the passing tests can be walked around,
not that the tests are useless.

**Harness:** every mutation was applied by a script that took a byte-exact backup first,
ran the test, restored the backup, and compared SHA-256 before and after. No "RESTORE
MISMATCH" was ever reported.

---

## Caveat on repository state (read this first)

Another process was editing this repository concurrently throughout this run. Between the
first and last command the working tree went from 4 modified files to 11, several files I
never touched changed on disk (`src/lib/news/extract.ts`, `storable-text.ts`,
`app-data/client.server.ts`, `preflight.ts`, and `scripts/ops-scripts.test.mjs` itself), and
those changes were then committed as `cd9eea5` "ESLint was red with nine errors…".

So "`git diff` is clean" here does **not** mean "the tree is as I found it" — the tree moved
underneath me. What I can state precisely:

- Each file I mutated was restored from a byte-exact backup and hash-verified.
- I searched all commits from the last four hours for sixteen distinct markers unique to my
  mutations (`resetDesk`, `wipeEverything`, `ARCHIVE_PAGE_LIMIT`, `someoneelse/SomeOtherProject`,
  `TRUNCATE articles`, `Stop-Process -Name node`, `Milliseconds 100`, and others). **Zero hits.**
  No mutation of mine was swept into anyone's commit.
- Final `git status --porcelain` shows one untracked file,
  `artifacts/verify-2026-08-29/leave-happy-path.mjs`, which pre-existed this run and is not mine.
- All ten test files exit 0 on the restored tree.

I also created and dropped two databases of my own (`townreporter_gateprobe`,
`townreporter_gateprobe2`). The protected databases were not touched.

---

# MISSED — a real, named defect that left the test GREEN

## 1. `newsroom-security.test.mjs` — "sanitizePublicUrls is the journalism URL gate, not an origin allowlist"

**Defect:** `src/lib/news/schema.ts`, inside `sanitizePublicUrls`:

```
-      const u = assertHttpUrl(raw.trim());
+      const u = new URL(raw.trim());
```

The URL gate is gone. Any scheme `new URL()` accepts — `javascript:`, `data:`, `file:` — now
passes straight through the function whose entire job is to reject them.

**Result: MISSED.** The test is `assert.match(src, /assertHttpUrl/)`, an unanchored search of
the whole file. Line 3 is `import { assertHttpUrl } from "./url-guard.ts";`, and that import
alone satisfies the assertion. The gate can be deleted from the body of the function it names
and the test never notices.

**Control:** removing the import line *as well* turned it red, confirming the import is the
only thing holding the assertion up.

**Fix:** anchor to the call inside the function, the way `leave-desk.test.ts` slices out
`leaveEditor` before asserting — e.g. take `src.slice(src.indexOf("export function sanitizePublicUrls"))`
and match `assertHttpUrl(` in that block.

---

## 2. `newsroom-security.test.mjs` — "scan does not stamp last_hash until the writing pass succeeds"

**Defect:** `src/lib/news/desk.ts`:

```
-    if (!shouldCommitFetchHashes({ aiOk: true, parseError: data.parseError })) {
+    if (false && !shouldCommitFetchHashes({ aiOk: true, parseError: data.parseError })) {
```

The guard is dead. `last_hash` is now stamped whether or not the writing pass succeeded, which
is exactly the defect the test's name describes: a failed scan marks the source as read, and
the next scan skips it.

**Result: MISSED.** All five assertions are `assert.match` on identifier names —
`pendingHashes`, `shouldCommitFetchHashes`, `previousScanNeedsReread`, `parseScanResult` — plus
one `doesNotMatch` on an old SQL string. Every identifier is still present in the file. The
test asserts that the vocabulary exists, not that the branch runs.

**Fix:** this one is behavioural and cannot honestly be done by grep. Call the exported
`shouldCommitFetchHashes` directly with `{ aiOk: false, parseError: true }` and assert it
returns false, and cover the stamping path in the lifecycle walk.

---

## 3. `newsroom-security.test.mjs` — "CI builds, boots and smoke-tests in a browser"

**Defect:** `.github/workflows/ci.yml`, the `smoke-built` job:

```
-      - run: npm run build
+      - run: echo skipping the build
```

This is the only `npm run build` step in the entire workflow. CI no longer builds, and the
built-server smoke that follows it now runs against a stale or absent `.output`.

**Result: MISSED.** `assert.match(ci, /npm run build/)` searches the whole file, and line 62
is a *comment* on this very subject: ``# dev`. It never ran `npm run build`, never booted
`.output`, and never``. The prose written to explain the historical failure is what keeps the
test green when the failure returns.

**Control:** removing the build step *and* rewording that comment turned the test red — proving
the comment was the sole match.

**Fix:** assert on a step, not a substring: match `/^\s*- run: npm run build\s*$/m`, or parse
jobs the way `ci-jobs.test.mjs` does and require the step inside the `smoke-built` job.

---

## 4. `leave-desk.test.ts` — "refuses unless the caller types the address it is signed in as"

**Defect:** `src/lib/news/claim.ts`, `leaveEditor`:

```
       if (!mine || !typed || typed !== mine) {
-        return {
-          ok: false as const,
-          error:
-            "Type the email address you signed in with, exactly, to give up the desk.",
-        };
+        console.warn("leaveEditor: email mismatch, proceeding anyway");
       }
       await leaveAsEditor(context.userId);
```

The mismatch branch still exists but no longer refuses. Anyone who can reach the RPC gives up
the newsroom with any string at all — the exact outcome the file's header comment says three
properties are holding shut.

**Result: MISSED.** The test asserts `body` matches `/typed !== mine/` ("there must be a
mismatch branch that refuses"), then checks only that `indexOf("typed !== mine")` comes *before*
`indexOf("await leaveAsEditor(")`. Both remain true. The test verifies a branch is present and
positioned, never that it returns.

**Control:** deleting the branch entirely — text and all — turned it red, so the test only
fires on removal, not on neutering.

**Fix:** this is the one property the file itself says "would survive someone rebuilding the
interface", so it deserves a behavioural test. Export the comparison, or assert that the block
between `typed !== mine` and `leaveAsEditor` contains a `return`.

---

## 5. `voice-boundary.test.ts` — "the voice file is not in this repository and cannot be"

**Defect:** `src/lib/news/voice.server.ts` — the relative-path refusal branch deleted outright:

```
-  if (!isAbsolute(raw)) {
-    return {
-      ok: false,
-      error: `${VOICE_ENV} must be an absolute path outside this repository. Got a relative path.`,
-    };
-  }
```

A relative `TOWNREPORTER_VOICE_FILE` now resolves against `process.cwd()` — inside the public
repository — and is accepted, which is precisely what the assertion message calls out
("a relative path must be refused").

**Result: MISSED.** `assert.match(voice, /isAbsolute/)` still matches the import and the
surviving `const path = isAbsolute(raw) ? raw : resolve(process.cwd(), raw)` on the line above
the deleted branch. A separate probe showed the assertion is looser still: renaming every
`isAbsolute` to `isAbsolutePath` also keeps it green, because it is a substring match.

**Also missed on the same test:** neutering the in-repo containment check —
`const inRepo = false && rel !== "" && ...` — leaves both `isAbsolute` and `process.cwd`
in the file and stays green, while a symlinked path back into the public repo is now accepted.

**Fix:** call `findVoiceFile()` with `TOWNREPORTER_VOICE_FILE` set to a relative path and to an
in-repo path, and assert `ok === false` both times. The function never throws and never reads
the file, so this is a cheap, fully hermetic behavioural test.

---

## 6. `search-index.test.ts` — "the index can serve the operator the search actually uses"

**Defect attempted:** rewriting the search so the index cannot serve it. The test's own comment
states its purpose: *"If the search is ever rewritten as a regex or wrapped in lower(), the
rewritten operator will not be in this list and the index becomes decorative while every other
test stays green."*

**Result: MISSED — and this test cannot fail for any application-side change at all.**

The assertion is:

```sql
select o.oprname from pg_amop ao
  join pg_opfamily f on f.oid = ao.amopfamily
  join pg_operator o on o.oid = ao.amopopr
 where f.opfname = 'gin_trgm_ops'
```

…followed by `assert.ok(ops.includes("~~*"))`. This reads the operator set that the **pg_trgm
extension** ships. It never opens `public.ts` and never learns which operator the search uses.
Whether the app runs `ilike`, `~*`, or `lower(x) like`, `gin_trgm_ops` still supports `~~*`, so
the assertion holds.

Its only conceivable failure mode is pg_trgm being absent or different — and that case is
pre-empted by the `skip` guard above it. I confirmed this on a scratch database: with
`DROP EXTENSION pg_trgm CASCADE` the two DB tests report `﹣ skipped`, and the file exits 0.

Because the default `npm test` runs against PGLite with no `DATABASE_URL`, this test **skips in
the default suite** and **cannot go red in the CI `search-index` job either**. It is a green
row that reports nothing about this codebase.

Demonstrating the gap directly: with the search rewritten as

```
-        or (${wide} and body ilike ${like})
+        or (${wide} and (body ilike ${like} or body ~* ${q}))
```

every published row is scanned by the regex arm on every anonymous request — the exact ENG-008
behaviour the migration was written to end — and all three tests in the file stayed green.

**Fix:** read the operator out of `public.ts` (the SQL is right there) and assert it is in the
supported list, rather than asserting a property of Postgres.

---

# Secondary findings — adversarial probes that stayed green

These tests CAUGHT the straightforward defect but were walked around by a variant that is just
as real. Grouped by the weakness they share.

## A. Assertion satisfied by a comment or an import on another line

| Test | Defect kept green by |
| --- | --- |
| `ci-jobs` — "every job that runs a desk-claiming walk starts its own server" | Server start replaced with `true # was: npm run dev > /tmp/flows.log 2>&1 &`. The job starts nothing; the words survive in the comment. |
| `newsroom-security` — "CI walks the 0.5.1 desk flows in a browser" | The `Undo` step commented out. `walk.includes("Undo")` still true. |
| `newsroom-security` — "scan never auto-promotes model URLs" | `'discovered', 'unclassified', 'proposed')` kept, an `on conflict do nothing` clause appended — any following promotion is invisible to the test. |
| `sign-in-throttle` — "turns rate limiting on rather than inheriting the environment default" | Live config set to `enabled: false`, with the original `rateLimit: { enabled: true,` preserved above it inside a `/* previously: */` comment. **Password-guess throttling fully off, test green.** The test's own comment says it was "anchored to `rateLimit: {` itself, not to a window of characters" — the anchor still matches the commented-out copy. |
| `voice-boundary` — "refuses to inline anything long enough to be a voice file" | `assertNotAnArgument(...)` call replaced with `// assertNotAnArgument( disabled`. |
| `search-index` — "the query still says published…" | `where status = 'published'` dropped, kept as `-- was: where status = 'published'`. **Drafts become searchable from the public paper, test green.** |

## B. Window search rather than anchored pattern

| Test | Defect kept green by |
| --- | --- |
| `voice-boundary` — "the CLI adapter passes a path, never the prompt text" | The regex is `/usingFile[\s\S]{0,200}--system-prompt-file/`. Replacing the branch with `...(usingFile ? ["--system-prompt", readFileSync(opts.systemPromptFile!, "utf8")] : ...)` — i.e. reading the 98 KB voice file and putting it on the command line, the single failure the whole file exists to prevent — stays green, because a comment mentioning `--system-prompt-file` sits within the 200-character window. |
| `search-index` — "still refuses a two-character scan" | `const wide = q.length >= SEARCH_MIN_INDEXED \|\| true;` — the asserted expression is intact, the floor is bypassed. |
| `newsroom-security` — "Dark Desk … does not cap confidence" | Cap re-expressed as `raw > 0.5 ? 0.5 : raw` instead of `Math.min(0.5,`. |
| `newsroom-security` — "ingest follows documents across origins" | Cross-origin refusal written as `abs.host !== new URL(baseUrl).host` instead of `abs.origin !== base.origin`. |
| `ops-scripts` — "nothing stops a process by image name alone" | Two ways past the per-line `/Stop-Process\s+-Name/i`: (a) `Get-Process -Name node \| Stop-Process -Force`; (b) `Stop-Process` + backtick continuation + `-Name node` on the next line. Both are blanket kills by image name — the mistake that once took down a live MCP server on this machine. |
| `ops-scripts` — "both start paths wait long enough for a cold Postgres" | The loop still counts to 180, but `Start-Sleep -Seconds 1` becomes `-Milliseconds 100` (18 s of wall clock, not 180) or gains a `break` (1 s). The measured 53-second cold boot is lost either way. |

## C. What is NOT in the list the test reads

| Test | Blind spot |
| --- | --- |
| `no-control-characters` | Extension filter is `ts,tsx,mjs,js,sql,ps1,cmd,vbs,css,json` under `src, scripts, migrations, ops` only. A raw backspace in `.github/workflows/ci.yml`, in root `package.json`, or in `scripts/grok-pwa-shared.d.mts` (`.mts`) all stayed green. Root-level configs and every `.yml`/`.yaml`/`.mts` file are outside the sweep. |
| `no-destructive-migrate` | Guards `scripts/migrate.mjs` and top-level `migrations/*.sql` by text only. Green with: the wipe moved to `scripts/reset-desk.mjs`, imported and called by `migrate.mjs`; the TRUNCATE built as `["TRUN","CATE …"].join("")`; the statement read at runtime from `ops/reset.sql`; a destructive statement added to the PGLite applier `src/lib/db.ts`. Test 2's existence check is hard-coded to the filename `factory-reset.mjs` — any other name passes. |
| `newsroom-security` — "every desk and dark mutation is gated by deskMiddleware" | Reads `desk.ts` and `dark.ts` only. A new ungated `createServerFn` mutation in `src/lib/news/trash.ts` stayed green — and `claim.ts`, `evidence.ts`, `opinion.ts`, `ops/dashboard.ts` are equally unread. Also, the discovery regex is `export const (\w+) = createServerFn`, so a line-wrapped `export const publishLead =\n  createServerFn(...)` is never discovered and its missing middleware is never reported. |
| `newsroom-security` — "no test … can reach a live model unasked" | Scans `src/lib/news` only. The same ungated `grokChat()` test in `src/lib/auth/` stayed green. |
| `newsroom-security` — ".env.example lists every setting the code reads" | Matches `process.env.NAME` and `env("NAME")` under `src/` only. Green with `process.env["ARCHIVE_PAGE_LIMIT"]` (bracket syntax) and with a new setting read from `scripts/migrate.mjs`. |
| `ci-jobs` | `CLAIMERS` is a hand-written list of three paths, matched literally. Adding `npm run test:flows` to the lifecycle job runs a second desk-claiming walk on an already-claimed server — the precise blocker this file was written for — and stayed green, because the literal path string never appears in that job. A fourth desk-claiming script would also be invisible until someone remembers to add it. |
| `ops-scripts` — "PowerShell ops scripts stay ASCII" | `.ps1` only. Em dashes in `ops/run-hidden.vbs` and `ops/TownReporter Control.cmd` stayed green. |
| `ops-scripts` — "every ops script the docs promise actually exists" | `REQUIRED` omits `lib-port.ps1`, `install-shortcut.ps1`, `write-tunnel-config.mjs`. Deleting `ops/lib-port.ps1` stayed green in both file tests. |
| `newsroom-security` — "keeps Node-only imports out of the browser bundle" | Direct imports only. Green with `node:crypto` reaching the client transitively through a new `src/lib/news/token-hash.ts` that `public.ts` imports — which is the shape of the blocker that actually shipped. |
| `source-zip-url` — "matches APP_VERSION" | `SOURCE_ZIP_URL.includes("/tags/v0.5.1.zip")` does not constrain the host or repository. Repointing the URL at `https://github.com/someoneelse/SomeOtherProject/...` stayed green. |
| `ops-scripts` — "no doc references an ops script that is not there" | Reference pattern covers `ps1\|vbs\|cmd\|mjs`. A doc reference to `ops/does-not-exist.psm1` stayed green. (Minor — no `.psm1` is used today.) |

---

# Full per-test results

## `scripts/no-control-characters.test.mjs`

| Test | Defect introduced | Result |
| --- | --- | --- |
| no source file carries a raw control character | `src/lib/news/claim-hygiene.ts`: `/\bhops?` → `/<0x08>hops?` (word-boundary escape reaching disk as a raw backspace) | **CAUGHT** |
| ″ (adversarial) | same byte in `.github/workflows/ci.yml` | MISSED |
| ″ (adversarial) | same byte in root `package.json` | MISSED |
| ″ (adversarial) | same byte in `scripts/grok-pwa-shared.d.mts` | MISSED |

## `scripts/ci-jobs.test.mjs`

| Test | Defect introduced | Result |
| --- | --- | --- |
| each desk-claiming walk exists and is referenced by CI | `node scripts/desk-flows-e2e.mjs` → `echo skipped` | **CAUGHT** |
| no CI job runs two walks that both claim the desk | `node scripts/desk-flows-e2e.mjs` appended to the lifecycle job | **CAUGHT** |
| ″ (adversarial) | `npm run test:flows` appended to the lifecycle job instead | MISSED |
| every job that runs a desk-claiming walk starts its own server | `npm run dev > /tmp/flows.log 2>&1 &` → `true` | **CAUGHT** |
| ″ (adversarial) | → `true # was: npm run dev > /tmp/flows.log 2>&1 &` | MISSED |

## `scripts/ops-scripts.test.mjs`

| Test | Defect introduced | Result |
| --- | --- | --- |
| every ops script the docs promise actually exists | `ops/status.ps1` deleted | **CAUGHT** |
| ″ (adversarial) | `ops/lib-port.ps1` deleted | MISSED |
| no doc references an ops script that is not there | `README.md` gains `See ops/does-not-exist.ps1 for details.` | **CAUGHT** |
| ″ (adversarial) | `docs/manual.md` gains `Run ops/does-not-exist.psm1 first.` | MISSED |
| PowerShell ops scripts stay ASCII | em dash into a `Write-Log` string in `ops/watchdog.ps1` | **CAUGHT** |
| ″ (adversarial) | em dash into `ops/run-hidden.vbs` | MISSED |
| ″ (adversarial) | em dash into `ops/TownReporter Control.cmd` | MISSED |
| nothing stops a process by image name alone | `restart-app.ps1`: `Stop-Process -Id $_.ProcessId -Force` → `Stop-Process -Name node -Force` | **CAUGHT** |
| ″ (adversarial) | → `Get-Process -Name node \| Stop-Process -Force` | MISSED |
| ″ (adversarial) | → `Stop-Process` + backtick newline + `-Name node -Force` | MISSED |
| CIM queries that are counted are wrapped in @() | `watchdog.ps1`: `$tunnelProcs = @(Get-CimInstance …)` → unwrapped | **CAUGHT** |
| PowerShell ops scripts parse | unclosed `if ($true) {` appended to `ops/status.ps1` | **CAUGHT** |
| both start paths wait long enough for a cold Postgres | `start-townreporter.ps1`: `$i -lt 180` → `$i -lt 30` | **CAUGHT** |
| ″ (adversarial) | `Start-Sleep -Seconds 1` → `-Milliseconds 100` in both scripts | MISSED |
| ″ (adversarial) | `; break` added inside the 180-turn loop | MISSED |

## `scripts/newsroom-security.test.mjs`

| Test | Defect introduced | Result |
| --- | --- | --- |
| sanitizePublicUrls is the journalism URL gate | `assertHttpUrl(raw.trim())` → `new URL(raw.trim())` | **MISSED** |
| ″ (control) | …and the import line removed too | CAUGHT |
| every desk and dark mutation is gated by deskMiddleware | `publishLead` loses `.middleware([deskMiddleware])` | **CAUGHT** |
| ″ (adversarial) | ungated `publishLead` with a line-wrapped `export const … =\n createServerFn(` | MISSED |
| ″ (adversarial) | new ungated `wipeEverything` mutation added to `src/lib/news/trash.ts` | MISSED |
| membership rejects a second identity | `throw new ForbiddenError` → `return null` | **CAUGHT** |
| public paper SQL is a single LIMIT and has no desk middleware | `deskMiddleware` imported into `public.ts` | **CAUGHT** |
| public module keeps Node-only imports out of the browser bundle | `import { createHash } from "node:crypto"` added to `public.ts` | **CAUGHT** |
| ″ (adversarial) | `node:crypto` reached transitively via a new `token-hash.ts` that `public.ts` imports | MISSED |
| the newsletter RPC … stays gone | `const COL = "confirm_token";` added to `public.ts` | **CAUGHT** |
| SSRF: fetch follows redirects manually and re-asserts each hop | `redirect: "manual"` → `redirect: "follow"` | **CAUGHT** |
| ″ (adversarial) | `redirect: "manual"` kept, per-hop `await assertPublicHttpUrl(u.toString())` commented out | MISSED |
| scan does not stamp last_hash until the writing pass succeeds | `if (!shouldCommitFetchHashes(…))` → `if (false && !shouldCommitFetchHashes(…))` | **MISSED** |
| scan never auto-promotes model URLs to official or Tier A | `'discovered', 'unclassified', 'proposed'` → `'official', 'A', 'accepted'` | **CAUGHT** |
| ″ (adversarial) | literal kept, `on conflict do nothing` appended after it | MISSED |
| scan includes Tier C and never prunes snapshot history | `const TIER_FILTER = "tier <> 'C'";` added to `desk.ts` | **CAUGHT** |
| Dark Desk digs, does not auto-publish, does not cap confidence | `Math.min(1, …)` → `Math.min(0.5, …)` | **CAUGHT** |
| ″ (adversarial) | cap re-expressed as `raw > 0.5 ? 0.5 : raw` | MISSED |
| ingest follows documents across origins | `if (abs.origin !== base.origin) continue;` added | **CAUGHT** |
| ″ (adversarial) | same refusal written with `.host` | MISSED |
| no test in the default suite can reach a live model unasked | ungated `grokChat()` test added at `src/lib/news/live-probe.test.ts` | **CAUGHT** |
| ″ (adversarial) | same file placed at `src/lib/auth/live-probe.test.ts` | MISSED |
| every test file on disk is discovered by npm test | `npm test` rewritten to name `src/lib/db.test.ts` | **CAUGHT** |
| CI builds, boots and smoke-tests in a browser | `- run: npm run build` → `- run: echo skipping the build` | **MISSED** |
| ″ (control) | …and the comment mentioning `npm run build` reworded | CAUGHT |
| the smoke script actually opens a browser | `from "playwright"` → `from "node:http"` | **CAUGHT** |
| CI walks the 0.5.1 desk flows in a browser | every `Undo` → `Redo` in `desk-flows-e2e.mjs` | **CAUGHT** |
| ″ (adversarial) | the step commented out, the word retained | MISSED |
| .env.example lists every setting the code reads | `process.env.ARCHIVE_PAGE_LIMIT` read in `public.ts` | **CAUGHT** |
| ″ (adversarial) | read as `process.env["ARCHIVE_PAGE_LIMIT"]` | MISSED |
| ″ (adversarial) | `process.env.MIGRATE_POOL_MAX` read in `scripts/migrate.mjs` | MISSED |
| no live doc tells the operator to set the removed setup token | README gains "On a public host, set NEWSROOM_SETUP_TOKEN before first run." | **CAUGHT** |
| no live doc claims the ordinary test suite spends money | SELF-HOSTING.md gains "Running `npm test` makes one real Claude call and is billed…" | **CAUGHT** |

## `scripts/no-destructive-migrate.test.mjs`

| Test | Defect introduced | Result |
| --- | --- | --- |
| the migration runner issues no destructive statement | `await client.query("TRUNCATE articles RESTART IDENTITY CASCADE")` in `migrate.mjs` | **CAUGHT** |
| ″ (adversarial) | `client.query(["TRUN","CATE articles …"].join(""))` | MISSED |
| ″ (adversarial) | statement read at runtime from a new `ops/reset.sql` | MISSED |
| the migration runner imports nothing that could wipe the database | `scripts/factory-reset.mjs` recreated and imported | **CAUGHT** |
| ″ (adversarial) | identical wipe in `scripts/reset-desk.mjs`, imported and called | MISSED |
| no migration file empties a table | `TRUNCATE articles RESTART IDENTITY CASCADE;` added to `migrations/0018_search_index.sql` | **CAUGHT** |
| ″ (adversarial) | `DELETE FROM articles;` added to `migrations/auth/0001_auth.sql` | MISSED (out of the apply path by design — noted, not a defect) |
| ″ (adversarial) | destructive SQL constant added to the PGLite applier `src/lib/db.ts` | MISSED |

## `src/lib/auth/sign-in-throttle.test.ts`

| Test | Defect introduced | Result |
| --- | --- | --- |
| turns rate limiting on rather than inheriting the environment default | `rateLimit: { enabled: true` → `enabled: false` | **CAUGHT** |
| ″ (adversarial) | live block set to `enabled: false`, original preserved in a `/* previously: */` comment above | MISSED |
| keeps a slow-guessing rule on the sign-in path | `{ window: 300, max: 10 }` → `{ window: 10, max: 10 }` | **CAUGHT** |
| ″ | → `{ window: 300, max: 100 }` | **CAUGHT** |
| reads the visitor's real address | `"cf-connecting-ip"` removed from `ipAddressHeaders` | **CAUGHT** |

## `src/lib/news/leave-desk.test.ts`

| Test | Defect introduced | Result |
| --- | --- | --- |
| refuses unless the caller types the address it is signed in as | mismatch branch keeps its condition but returns nothing and falls through to `leaveAsEditor` | **MISSED** |
| ″ (control) | whole mismatch branch deleted | CAUGHT |
| ″ (adversarial) | `.validator(…)` removed from `leaveEditor`, other `.validator(` calls left in `claim.ts` | CAUGHT |
| is not rendered in the chrome of every desk page | `<LeaveEditorControl email="" />` rendered in `desk-chrome.tsx` | **CAUGHT** |
| ″ (adversarial) | rendered in the persistent route layout `src/routes/desk.tsx` instead | MISSED |
| the confirmation names what is lost | "the archive," → "the stored items," in `desk-copy.ts` | **CAUGHT** |

## `src/lib/news/search-index.test.ts`

Run against a purpose-made `townreporter_gateprobe` database on 5433 with real `pg_trgm`
(created, migrated, and dropped afterwards).

| Test | Defect introduced | Result |
| --- | --- | --- |
| carries a partial trigram index on every column | `DROP INDEX articles_body_trgm` | **CAUGHT** |
| ″ | index recreated without `WHERE status = 'published'` | **CAUGHT** |
| ″ | index recreated as a btree instead of a trigram GIN | **CAUGHT** |
| the index can serve the operator the search actually uses | search rewritten with a regex arm; separately, pg_trgm dropped | **MISSED — cannot fail** (see finding 6) |
| the query still says published, and still refuses a two-character scan | `body ilike` → `lower(body) like lower(…)` | **CAUGHT** |
| ″ | `SEARCH_MIN_INDEXED = 3` → `= 1` | **CAUGHT** |
| ″ (adversarial) | `or body ~* ${q}` ORed in alongside `body ilike` | MISSED |
| ″ (adversarial) | status predicate dropped, kept as a comment | MISSED |
| ″ (adversarial) | `const wide = q.length >= SEARCH_MIN_INDEXED \|\| true;` | MISSED |

## `src/lib/source-zip-url.test.ts`

| Test | Defect introduced | Result |
| --- | --- | --- |
| matches APP_VERSION | `SOURCE_ZIP_TAG` hand-written back to `"v0.5.0"` | **CAUGHT** |
| matches package.json, so a version bump cannot leave it behind | `APP_VERSION` bumped to `0.5.2` | **CAUGHT** |
| keeps a fallback that exists even before the tag is cut | `refs/heads/main.zip` → `refs/heads/master.zip` | **CAUGHT** |
| ″ (adversarial) | URL repointed at `github.com/someoneelse/SomeOtherProject` | MISSED |

## `src/lib/news/voice-boundary.test.ts`

| Test | Defect introduced | Result |
| --- | --- | --- |
| voice.server never returns file contents | `findVoiceFile` reads the file and returns the text as `voice.path` | **CAUGHT** |
| the CLI adapter passes a path, never the prompt text | file branch replaced by `["--system-prompt", opts.system]` | **CAUGHT** |
| ″ (adversarial) | `usingFile` branch changed to `["--system-prompt", readFileSync(opts.systemPromptFile!, "utf8")]`, with `--system-prompt-file` surviving in an adjacent comment | MISSED |
| refuses to inline anything long enough to be a voice file | `assertNotAnArgument(...)` call removed | **CAUGHT** |
| ″ (adversarial) | call replaced by `// assertNotAnArgument( disabled` | MISSED |
| the editorial writer hands over a path and never the text | `systemPromptFile:` renamed to `systemPromptFileX:` | **CAUGHT** |
| the voice file is not in this repository and cannot be | relative-path refusal branch deleted | **MISSED** |
| ″ (adversarial) | `const inRepo = false && …` | MISSED |
| ″ (adversarial) | every `isAbsolute` renamed to `isAbsolutePath` | MISSED |

---

# Verification ledger

**VERIFIED** — read end to end in this session, and mutated and re-run as described:

- `scripts/no-control-characters.test.mjs`, `scripts/ci-jobs.test.mjs`,
  `scripts/ops-scripts.test.mjs`, `scripts/newsroom-security.test.mjs`,
  `scripts/no-destructive-migrate.test.mjs`
- `src/lib/auth/sign-in-throttle.test.ts`, `src/lib/news/leave-desk.test.ts`,
  `src/lib/news/search-index.test.ts`, `src/lib/source-zip-url.test.ts`,
  `src/lib/news/voice-boundary.test.ts`
- `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, `migrations/0018_search_index.sql`,
  `.github/workflows/ci.yml`, `src/lib/source-zip-url.ts`, `src/lib/news/voice.server.ts`
- Baseline: all 10 files green before any mutation. Final: all 10 files green after restoration
  (exit code 0 each).
- Final `git status --porcelain`: one untracked file, `artifacts/verify-2026-08-29/leave-happy-path.mjs`,
  which pre-existed this run.
- Sixteen mutation-marker searches across all commits from the last four hours: zero hits.
- Databases created and dropped: `townreporter_gateprobe`, `townreporter_gateprobe2`. The
  protected databases (`townreporter`, `townreporter_e2e`, `townreporter_audit_ux`,
  `townreporter_audit_qa`) were not touched. `townreporter_dev` was read via the default `.env`
  during the baseline run only.

**UNVERIFIED / partial:**

- Portions of `src/lib/news/desk.ts`, `dark.ts`, `public.ts`, `schema.ts`, `membership.ts`,
  `claim.ts`, `ingest.ts`, `fetch-url.ts` and `src/lib/auth/server.ts` were read by targeted
  grep around the anchors I mutated, not end to end. Conclusions about those files are scoped to
  the specific assertions probed.
- Every MISSED verdict is a measured result for the specific edit quoted. It is evidence that
  the assertion does not fire on that edit; it is not a claim that the test is worthless.
- No claim is made about behaviour under CI on Linux; all runs were on this Windows box.
- The "cannot fail" claim for the search-index operator test is bounded to application-side
  changes: it was checked by rewriting the query and, separately, by dropping `pg_trgm`
  (which produced a skip, not a failure). I did not attempt to build a Postgres with a
  modified `gin_trgm_ops`.
