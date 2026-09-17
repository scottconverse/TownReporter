# Claims verification — commits `78e4bd4` and `6081385`

Independent check of every factual claim the two commit messages make about behaviour.
Verdicts are from running things, not from reading them, except where explicitly marked.

- Repo: `C:\Users\scott\Desktop\Code\townreporter-dev`
- Date of check: 2026-08-29 (evening)
- Build under test: `npm run build` at the tree as found, run against scratch databases
  `townreporter_verify` … `townreporter_verify5` on port 5433. Servers on ports 3600–3605.
- Production checkout `townreporter-web` and `https://townreporter.org` were never touched.

## Tally

| Verdict | Count |
|---|---|
| VERIFIED | 30 |
| FALSE | 1 |
| UNVERIFIABLE | 4 |

## Important context: the working tree changed under me, from outside this session

At the start of this check, `git status` showed four modified files
(`eslint.config.mjs`, `src/lib/auth/use-current-user.ts`, `src/lib/news/fetch-url.ts`,
`src/lib/news/ingest.ts`) — an ESLint auto-fix in progress.

Partway through, a **concurrent actor in this same checkout committed them** as
`cd9eea5 "ESLint was red with nine errors and had never run in CI."`, and at one point
left a transient `ops/status.ps1` mutation plus an `ops/status.ps1.mutbak0` backup file
that then disappeared. That commit also swept in two of my own probe scripts
(`artifacts/verify-2026-08-29/leave-desk-probe.mjs`, `ops-page-probe.mjs`).

So HEAD is no longer `6081385`. I did not create, amend, or move any commit. Every source
file I mutated for a test was restored byte-for-byte, confirmed by `git diff` (see
"Working tree state" at the end).

---

# Commit `78e4bd4` — "Two ways to lose the newsroom, and a privacy gauge that could only say 'fine'."

## QA-001 — giving up the desk

### 1. "'Leave as editor' sat in the header of every desk page" — now removed from the header
**VERIFIED.**
Playwright against the built server on `:3600`, signed in as the desk owner
(`artifacts/verify-2026-08-29/leave-desk-probe.mjs`):

```
page /desk:       header mentions leave? false | .leave-editor buttons on page = 0
page /desk/queue: header mentions leave? false | .leave-editor buttons on page = 0
page /desk/ops:   header mentions leave? false | .leave-editor buttons on page = 1
```
Header text on all three: `… View paper LIGHT DARK V Verify Editor Sign out DESK SOURCES SCAN QUEUE PUBLISHED OPINION SERVER DARK DESK`.
Source: the render was deleted from `src/components/desk-chrome.tsx` (mast block) in this commit.

### 2. "The control also moved to the bottom of the Server page"
**VERIFIED.** On `/desk/ops` the string "Give up the desk" appears at character 2665 of a
2774-character page — 96% of the way down, after the watchdog paragraph and the actions list
(`artifacts/verify-2026-08-29/ops-page-probe.mjs`). `src/routes/desk.ops.tsx:251` renders
`<GiveUpTheDesk />` as the last child of `DeskShell`.

### 3. "The RPC now refuses unless the caller sends the email address of the account it is signed in as, checked against the database"
**VERIFIED, at the RPC level, not just the UI.**
Method: real browser, real session, correct email typed so the client-side guard was
satisfied, then the outgoing `POST /_serverFn/a603894771…` body rewritten in a Playwright
route handler so the wire payload carried `attacker@example.com` while the session cookie
and bearer token stayed valid.

```
captured RPC body: {"t":{...,"v":[{"t":1,"s":"desk-owner@example.com"}, …bearerToken…]}}
tampered  RPC body: {"t":{...,"v":[{"t":1,"s":"attacker@example.com"}, …bearerToken…]}}
alerts after tampered submit:
  ["Type the email address you signed in with, exactly, to give up the desk."]
```
Database after the tampered call:
`select * from newsroom_members;` → 1 row, `role = owner` — the desk was **not** released.

The check is against the database, not a client claim:
`src/lib/news/claim.ts` — `select email from "user" where id = ${context.userId} limit 1`,
compared to the caller-supplied string, refusal branch before `leaveAsEditor()`.

### 4. The control still works for the real owner (not asserted in the message, checked anyway)
**VERIFIED.** Same page, correct email typed, no tampering: redirected to `/`,
`newsroom_members` count went 1 → 0, and `/login` went back to showing "Create the desk".
So the guard is a real gate, not a broken button.

### 5. "the confirmation says what is lost rather than how the mechanism works"
**VERIFIED.** Confirmation text read out of the live DOM:

> "This hands the newsroom to whoever opens the sign-in page next. They get the archive,
> the Dark Desk files, the notes, and the Server controls. You cannot take it back.
> Type your email address to confirm."

Mismatch alert: "That is not the address you signed in with." Submit button disabled until
the typed address matches.

### 6. `src/lib/news/leave-desk.test.ts` actually catches regressions
**VERIFIED by mutation, twice.**
- Replaced `typed !== mine` with `false` in `claim.ts` →
  `✖ refuses unless the caller types the address it is signed in as` (1 fail / 3).
- Re-inserted `<LeaveEditorControl email="x" />` into the masthead in `desk-chrome.tsx` →
  `✖ is not rendered in the chrome of every desk page` (1 fail / 3).
Both files restored; `git diff` empty afterwards.

## QA-003 — sign-in throttling

### 7. "`enabled` defaults to isProduction" in Better Auth
**VERIFIED.** In the built bundle,
`.output/server/_ssr/server-Da_f6oLX.mjs:7693`:
`enabled: options.rateLimit?.enabled ?? isProduction`.

### 8. "the Windows scheduled task sets no NODE_ENV"
**VERIFIED for this repo's own startup path.** `grep -rn NODE_ENV` across the repo
(excluding `node_modules`, `.output`, `.git`) returns six hits: one allowlist entry in
`scripts/newsroom-security.test.mjs:268`, one product use in
`src/lib/app-data/client.server.ts:69`, and four in prose/comments. `ops/*.ps1`,
`ops/*.cmd` and `ops/install-tasks.ps1` set none.
Instrument blind spot: I did not read the live scheduled task registered on this machine,
because it points at the production checkout, which is out of bounds.

### 9. "Now on unconditionally" — measured: fresh attacker IP 401×10 then 429; honest operator IP 200 during the attack
**VERIFIED, exactly as stated.** Against the running built server on `:3600`, no `NODE_ENV`
in the launching environment:

```
attacker (cf-connecting-ip: 203.0.113.5), 14 wrong passwords:
  401 401 401 401 401 401 401 401 401 401 429 429 429 429
honest operator (cf-connecting-ip: 198.51.100.7), correct password, during that attack:
  HTTP 200
```

### 10. "the protection existed and was off" — i.e. without the fix there is no throttle
**VERIFIED by mutation of the built artifact.** I copied `.output` to a scratch directory,
set `rateLimit.enabled` to `false` in the copied `server-Da_f6oLX.mjs`, and ran it on `:3605`
against a scratch database:

```
20 wrong passwords, one IP:
  401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401 401
```
No 429, no delay. The repo's own `.output` was never modified.

### 11. "That second line needed `ipAddressHeaders`… ten guesses from a stranger would have locked the journalist out"
**VERIFIED.** Same fixed server on `:3600`, sending **no** IP header (which is what arrives
through the tunnel — everything from 127.0.0.1):

```
11 wrong passwords, no header:            401 ×8, then 429 429 429
operator, correct password, no header:    429   ← locked out
operator, correct password, cf-connecting-ip: 192.0.2.50:  200
```
That is precisely the outage the commit says the header configuration prevents.
Config in build: `ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"]`.

### 12. "a slower rule for the patient attack"
**VERIFIED.** Baked into the build at `server-Da_f6oLX.mjs:8872`:
`rateLimit: { enabled: true, window: 60, max: 200, customRules: { "/sign-in/email": { window: 300, max: 10 }, … } }`.
Runtime behaviour in claim 9 matches `max: 10` over a 300-second window.

### 13. "the first throttle assertion passed with rate limiting switched OFF… It is anchored now."
**Second half VERIFIED; the historical half UNVERIFIABLE.**
Anchoring works: flipping `rateLimit.enabled` to `false` in `src/lib/auth/server.ts` makes
`node --experimental-strip-types --test src/lib/auth/sign-in-throttle.test.ts` report
`tests 3 / pass 2 / fail 1`, failing on
`✖ turns rate limiting on rather than inheriting the environment default`. File restored.
The earlier, weaker version of that assertion is not in git history (see UNVERIFIABLE list).

## ENG-001 — the "Reader privacy" row

### 14. "six of its patterns carried a literal backspace byte (0x08) where a word boundary was meant"
**VERIFIED.** `git show 78e4bd4^:src/lib/ops/health.server.ts` contains **12** U+0008 bytes,
two in each of exactly **six** regexes: `<script`, `<link`, `<img`, `<iframe`, `<video`,
`<source` — each as `/<script\x08[^>]*\x08src="…"/gi`.

### 15. "so it reported 'no outside requests' unconditionally"
**VERIFIED.** Running two of those exact patterns against HTML containing a Google Fonts
`<link>` and a third-party `<script src>` returns **0 matches** each. No HTML can contain a
backspace byte, so the host set was always empty and the row always read `ok`.

### 16. "Removed rather than repaired" — the row is gone from the Server page
**VERIFIED at runtime.** `/desk/ops` rendered in a real browser as the signed-in owner:
`has "Reader privacy": false`, `has "no outside requests": false`. `checkThirdParty()` is
deleted from `src/lib/ops/health.server.ts` and dropped from `collectHealth()`.

### 17. "`npm run smoke` opens the front page in a real browser, counts every request, and fails if one leaves this origin"
**VERIFIED.** `SMOKE_BASE_URL=http://127.0.0.1:3600 node scripts/smoke-built-server.mjs`:

```
reader privacy:
  ok    front page made no outside requests
all smoke checks passed.
```
`scripts/smoke-built-server.mjs:118-137`: launches Chromium, subscribes to every
`page.on("request")`, collects any host whose origin differs from `BASE`, and calls `bad()`
(which sets a non-zero exit) if the set is non-empty.

## ENG-003 — the removed setup token

### 18. "README, .env.example and three docs still told operators to set NEWSROOM_SETUP_TOKEN" — now they do not
**VERIFIED.** `grep -rn NEWSROOM_SETUP_TOKEN` over all `*.md` and `*.example` in the repo
returns exactly two hits, both in exempt files:
`CHANGELOG.md:244` and `docs/archive/HANDOFF-0.4.3.md:64`.
README.md, .env.example, docs/setup.md, docs/editor.md, docs/manual.md: none.

### 19. "That code was removed in 0.5.1 and a test forbids it"
**VERIFIED (read).** `src/lib/news/membership.test.ts:86` —
`assert.doesNotMatch(code, /NEWSROOM_SETUP_TOKEN/, "the token must be gone from the code path")`.
It passes in the current suite.

### 20. "A gate now fails if any live doc says it again"
**VERIFIED by mutation.** Appended
`` Set `NEWSROOM_SETUP_TOKEN` to a long random string on a public host. `` to `docs/manual.md`
→ `node --test scripts/newsroom-security.test.mjs` reported
`✖ no live doc tells the operator to set the removed setup token`. Restored; suite back to
`tests 20 / pass 20 / fail 0`.

### 21. "the changelog and archive are exempt"
**VERIFIED.** The gate's file list is `README.md`, `SELF-HOSTING.md`, `.env.example` plus a
non-recursive `readdirSync("docs")` — so `CHANGELOG.md` and `docs/archive/**` are outside it
by construction, and the suite is green with both of those files still naming the variable.

## The control-character gate

### 22. "no source file may carry a raw control character… it reads untracked files too, proven by planting one"
**VERIFIED by planting one myself.** Created an **untracked** file
`src/lib/planted-control-char.ts` containing a literal 0x08 inside a regex:

```
?? src/lib/planted-control-char.ts
✖ no source file carries a raw control character
    src/lib/planted-control-char.ts:1 contains U+0008 ("export const re = /a\bb/;\n")
tests 1 / pass 0 / fail 1
```
File deleted; gate green again (`tests 1 / pass 1 / fail 0`).

## Housekeeping claims

### 23. "The five audit reports and the writer's doc drafts are included, at 408 KB"
**VERIFIED.** The commit adds exactly nine tracked files under
`artifacts/audit-townreporter-2026-08-29/` (five `NN-*-deepdive.md` reports, four
`doc-rewrites/` drafts). `du -k` over them totals **408 KiB** (402,445 raw bytes;
401,999 bytes as git blobs). The "408" figure matches the standard `du` measure.

### 24. "The 220 screenshots and capture scripts behind them are not [included]"
**VERIFIED, and the number is exact.** `git show --stat 78e4bd4` adds no image files at all.
On disk, `artifacts/audit-townreporter-2026-08-29/` holds **220** `.png` files across
`uiux-screens/` (14 MB) and `qa-evidence/` (16 MB), none of them tracked.

### 25. ".gitignore now excludes audit evidence directories"
**VERIFIED by planting.** Created `artifacts/audit-test-x/{uiux-screens/a.png,qa-evidence/b.png,report.md}`:

```
.gitignore:34:artifacts/audit-*/uiux-screens/   artifacts/audit-test-x/uiux-screens/a.png
.gitignore:35:artifacts/audit-*/qa-evidence/    artifacts/audit-test-x/qa-evidence/b.png
report.md  -> not ignored   (correct: reports stay tracked)
```
Directory removed afterwards.

### 26. "540 tests, typecheck clean, and all three browser walks green"
**FALSE as to the test count; true as to the rest — and commit `6081385` retracts it itself.**
`npm test` runs two groups. Measured:

```
node --test "scripts/**/*.test.mjs"                        → tests 185, pass 183, skipped 2
node --experimental-strip-types --test "src/**/*.test.ts"  → tests 540, pass 537, skipped 3
```
540 is the **src group only**. The suite is 725. `npm run typecheck` exits 0. The three walks
named (smoke, desk flows, file→publish→correct) all ran green here — see claim 34.
Recorded as FALSE rather than softened because the sentence presents 540 as the suite;
`6081385` says so in as many words.

---

# Commit `6081385` — "A story published with no sources, on a paper that promises 'Sources shown.'"

## UX-005 — the dropped source URL

### 27. "the draft insert carries the lead's URLs, and publishing falls back to the lead when the draft has none" — the value reaches the reader
**VERIFIED end to end, in a browser, against three database tables.**
`SOURCES_BASE_URL=http://127.0.0.1:3601 node scripts/sources-reach-the-reader.mjs` on a
freshly-migrated empty database:

```
ok  owns the desk
ok  filed a lead carrying a source URL
ok  wrote and saved the story by hand
ok  published it
ok  the reader sees the source that was attached to the lead
ok  the source is a link the reader can follow
{"ok": true, "steps": 6}
```
Database `townreporter_verify2` afterwards:

| table | source_urls |
|---|---|
| `leads.id=1` | `["https://longmont.primegov.com/public/portal"]` |
| `drafts.id=1` (lead_id 1) | `["https://longmont.primegov.com/public/portal"]` |
| `articles.id=2` | `["https://longmont.primegov.com/public/portal"]` |

The value flows lead → draft → article.

### 28. "the reader is told the evidence is there, and it is not" — the defect was real
**VERIFIED by putting the defect back.** In a scratch copy of `.output` I reverted both
halves (the draft `insert` back to the six-column form, and the publish-time fallback to
`if (false)`), ran it on `:3604` against empty database `townreporter_verify5`, and repeated
the same walk:

| table | source_urls |
|---|---|
| `leads.id=1` | `["https://longmont.primegov.com/public/portal"]` |
| `drafts.id=1` | `[]` |
| `articles.id=2` | `[]` |

The published article had **no** "How we reported this" section at all (0 occurrences in the
served HTML), on a front page that promises "Sources shown."

### 29. The walk is "red on the defect, green on the fix"
**VERIFIED — both directions run.** Same script, same command:
- fixed build (`:3601`) → `{"ok": true, "steps": 6}`
- defect build (`:3604`) → `{"ok": false, …"has no \"How we reported this\" section"…}`,
  completed list stops after "published it", `process.exitCode = 1`.

## TEST-001

### 30. "running after lifecycle-e2e had claimed that server's desk… it died at step zero every time, on a page with no sign-up form. It could never have gone green."
**VERIFIED by reproducing the old arrangement.** I ran `lifecycle-e2e.mjs` against the server
on `:3603` (it passed), then ran `desk-flows-e2e.mjs` against that same server:

```
{
  "ok": false,
  "error": "locator.fill: Timeout 45000ms exceeded … waiting for getByLabel('Name')",
  "url": "http://127.0.0.1:3603/login",
  "text": "TOWNREPORTER  Editor sign-in  This desk already has an editor. Sign in if that's you. …",
  "completed": []
}
exit code 1
```
Empty completed list, step zero, no sign-up form. Exactly as described.
With its own server and its own empty database it passes all 17 steps.

### 31. "`scripts/ci-jobs.test.mjs` fails if any job runs two desk-claiming walks or runs one without starting a server"
**VERIFIED by mutation, both branches.**
- Added `node scripts/sources-reach-the-reader.mjs` into the `desk-flows` job →
  `✖ no CI job runs two walks that both claim the desk` —
  `job "desk-flows" runs 2: scripts/desk-flows-e2e.mjs, scripts/sources-reach-the-reader.mjs`.
- Removed the `npm run dev …` line from the `sources-reach-the-reader` job →
  `✖ every job that runs a desk-claiming walk starts its own server` —
  `job "sources-reach-the-reader" runs a desk walk but never starts a server`.
`ci.yml` restored from backup both times; `tests 3 / pass 3 / fail 0` afterwards.

### 32. "The guard it replaces passed because a filename appeared somewhere in ci.yml."
**VERIFIED.** `git grep -n desk-flows-e2e 6081385^ -- scripts` shows
`scripts/newsroom-security.test.mjs:243: assert.match(ci, /desk-flows-e2e\.mjs/, "CI must run the desk flows walk")`
— a substring match over the whole workflow file, which the broken arrangement satisfied.
(That assertion is still present at line 243 today, alongside the new stronger gate.)

## UX-001

### 33. "`/evidence/NaN` … A non-integer id is not a capture that exists, so it takes the not-in-this-edition path."
**VERIFIED at runtime.** Against the built server on `:3600`:

| URL | HTTP | `invalid input syntax` in body | "not in this edition" |
|---|---|---|---|
| `/evidence/NaN` | 200 | 0 | yes |
| `/evidence/abc` | 200 | 0 | yes |
| `/evidence/0` | 200 | 0 | yes |
| `/evidence/-1` | 200 | 0 | yes |
| `/evidence/999999` | 200 | 0 | yes |

The route does `Number(params.versionId)` (`src/routes/evidence.$versionId.tsx:10`), so `NaN`
genuinely reaches the loader; the new guard in `src/lib/news/evidence.ts:345`
(`if (!Number.isInteger(id) || id <= 0) return null;`) is what stops it before Postgres.

## Counts and walks

### 34. "All four browser walks green against a freshly built server, each on its own empty database"
**VERIFIED — I ran all four, each on its own freshly-migrated database and its own port.**

| walk | server | database | result |
|---|---|---|---|
| `smoke-built-server.mjs` | :3600 | `townreporter_verify` | all smoke checks passed |
| `sources-reach-the-reader.mjs` | :3601 | `townreporter_verify2` | ok, 6 steps |
| `desk-flows-e2e.mjs` | :3602 | `townreporter_verify3` | ok, 17 steps |
| `lifecycle-e2e.mjs` | :3603 | `townreporter_verify4` | ok |

### 35. "The real total is 725 — 185 in scripts, 540 in src — 720 passing, 0 failing, 5 skipped. Typecheck clean."
**VERIFIED, exactly.**

```
scripts group: tests 185  pass 183  fail 0  skipped 2
src group:     tests 540  pass 537  fail 0  skipped 3
               ----------------------------------------
               725        720       0       5
npm run typecheck → exit 0
```

## QA-004

### 36. "Dev and e2e instances inherited BETTER_AUTH_URL from production… They point at themselves now."
**Second half VERIFIED; the first half UNVERIFIABLE.**
Current state:

| file | PORT | BETTER_AUTH_URL | PUBLIC_SITE_URL |
|---|---|---|---|
| `.env` | 3100 | `http://127.0.0.1:3100` | `http://127.0.0.1:3100` |
| `.env.e2e` | 3200 | `http://127.0.0.1:3200` | `http://127.0.0.1:3200` |

Both point at themselves; neither names `townreporter.org` as its own URL (it appears only in
`BETTER_AUTH_TRUSTED_ORIGINS`). The prior contents are unverifiable: `.env*` is gitignored, so
there is no history to compare against.

## DOC-001 / DOC-002

### 37. "`docs/setup.md` still required an xAI key under 'What you need' — the provider is the Claude Code CLI"
**VERIFIED.** `docs/setup.md:16` now reads
`| **A model** | The [Claude Code CLI](https://claude.com/claude-code), signed in. …`.
(`XAI_API_KEY` still appears further down at lines 71 and 108–113, but as one of four
optional providers in the resolution table — not as a requirement. Not a defect.)

### 38. "`SELF-HOSTING.md` still said `npm test` makes one real Claude call and offered a variable to skip it" — corrected
**VERIFIED.** `SELF-HOSTING.md:177` now reads
"`npm test` makes no model call and costs nothing", and the `TOWNREPORTER_CLAUDE_CODE=0 npm test`
snippet is replaced with `npm run test:live-model`. `package.json` carries that script.

### 39. "A gate now fails if any live doc prices the suite wrongly again"
**VERIFIED by mutation.** Appended
`` Note: `npm test` makes one real Claude call (~28s) and spends quota. `` to `SELF-HOSTING.md`
→ `✖ no live doc claims the ordinary test suite spends money`. Restored; green again.

---

# UNVERIFIABLE

These are claims about states that no longer exist anywhere I can reach.

1. **`78e4bd4`: "it happened twice more while fixing it. Once in this commit's own throttle test, in a regex about the bug."**
   The only earlier version of this work in the object database is `42a7018` (reset away, per
   `git reflog`), and its `src/lib/auth/sign-in-throttle.test.ts` contains **zero** control
   characters. The intermediate defective state was never committed.

2. **`78e4bd4`: "Its first version read only tracked files and passed over a brand new file carrying the exact defect."**
   `42a7018:scripts/no-control-characters.test.mjs` already has the
   `--cached --others --exclude-standard` form. The tracked-only version is not in history.
   (The *property* claimed — that it now reads untracked files — is VERIFIED, claim 22.)

3. **`78e4bd4`: "Eighty wrong passwords in 6.3 seconds, all 401, no throttle."**
   I reproduced the *behaviour* (20 × 401 with rate limiting off, claim 10) but cannot
   verify the auditor's original run, its count, or its timing.

4. **`6081385`: "Its first assertion searched the whole page for the host and PASSED against a build with the defect deliberately restored. The host appears elsewhere on the page."**
   Neither earlier version of `sources-reach-the-reader.mjs` is in git history. One data point
   sits against the narrative as told: on my defect build, the served **article** page contains
   `longmont.primegov.com` **zero** times — so if the loose assertion passed, it was because
   Playwright was still reading the desk's markup (the failure mode described as lie #2), not
   because the host appears on the article page. The two lies as narrated may be one.
   The current test's two properties are both VERIFIED: it is scoped to the
   `section:has(h2:text-is("How we reported this"))` block, and it navigates with
   `page.goto(articleUrl, { waitUntil: "networkidle" })` rather than waiting on a URL change.

---

# Observations outside the claims (not verdicts)

- **`SELF-HOSTING.md:177` still says "540 tests in about fourteen seconds" for `npm test`.**
  `6081385` fixed the *cost* claim on that line and, in its own message, identified 540 as the
  wrong number — but left the wrong number in the doc it was editing. `npm test` runs 725.
  The new doc gate only checks cost wording, so nothing catches this.
- The old weak CI guard (`assert.match(ci, /desk-flows-e2e\.mjs/)`) is still present at
  `scripts/newsroom-security.test.mjs:243`. Harmless, but the commit's word "replaces" reads
  as though it were removed.
- `rateLimit` storage is in memory, as the source comment says: restarting the server clears
  the counters. I hit this myself mid-check. The commit documents it rather than hiding it.

---

# Working tree state

```
$ git diff --stat
(empty)

$ git status --porcelain -uall
?? artifacts/verify-2026-08-29/leave-happy-path.mjs
?? artifacts/verify-2026-08-29/claims-verification.md   (this report)

$ git log --oneline -1
cd9eea5 ESLint was red with nine errors and had never run in CI.
```

Every tracked file I mutated for a mutation test — `src/lib/auth/server.ts`,
`src/lib/news/claim.ts`, `src/components/desk-chrome.tsx`, `docs/manual.md`,
`SELF-HOSTING.md`, `.github/workflows/ci.yml` — was restored from a byte copy and confirmed
clean by `git diff`. Planted files (`src/lib/planted-control-char.ts`,
`artifacts/audit-test-x/`) were deleted. `.output` in the repo was never modified; the
defect builds ran from a copy in the session scratchpad. Scratch databases
`townreporter_verify` … `townreporter_verify5` were dropped at the end; `townreporter`,
`townreporter_dev`, `townreporter_e2e`, `townreporter_audit_ux` and `townreporter_audit_qa`
were never opened for writing.

**Caveat I cannot clear:** HEAD moved from `6081385` to `cd9eea5` during this session, and
the four uncommitted files that were in scope when I started were committed by that other
actor, not by me. The tree is clean, but it is not the tree I found.
