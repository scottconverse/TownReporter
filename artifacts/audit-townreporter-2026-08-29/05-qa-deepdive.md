# Runtime QA Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-29
**Role:** QA Engineer
**Scope audited:** Public paper (`/`, `/articles/:slug`, `/about`, `/how-we-report`, `/corrections`, `/feed`, `/sitemap.xml`, `/robots.txt`, `/get-the-code`), private desk (`/desk` and all eight sub-pages, `/desk/story/:leadId`, `/evidence/*`), auth surface (`/login`, `/api/auth/*`), server-function transport (`/_serverFn/*`), the cron route (`/api/cron/monitors`), HTTP semantics and headers, the Postgres schema/migration state, and static review of `ops/` and `scripts/migrate.mjs`.
**Environment:** Built production bundle at `http://127.0.0.1:3400` (loopback-bound), Node 25.9.0, Windows 11 Pro 26200, PostgreSQL on 5433 / db `townreporter_audit_qa`, fresh database with an unclaimed desk. Playwright 1.62.1 driving Chromium 1234 headless-shell, Firefox and WebKit. Viewports 375×812, 768×1024, 1280×800, 1440×900. `TOWNREPORTER_CLAUDE_CODE=0` — no model provider configured, which the brief identifies (correctly) as a real first-run state.
**Auditor posture:** Balanced

---

## TL;DR

The paper half of this product is in genuinely good shape: it renders identically in Chromium, Firefox and WebKit, holds zero console errors across every page and viewport I drove, has no horizontal overflow anywhere, serves in ~5.6 ms at the origin, and the full editorial round trip — file a lead, publish, post a correction, see all three on the public paper, the RSS feed and the sitemap — works end to end. The desk's auth boundary is real: unauthenticated and cross-site scripted calls to server functions are rejected, the desk claims once and a second identity is refused, and the SSRF guard on the actual fetch path resolves DNS and pins the approved address at connect time.

The serious problems cluster in three places. First, **`Leave as editor` is a two-click button in the header of every desk page that hands the entire newsroom to whoever signs up next** — I performed it and a brand-new anonymous account became owner of the published archive, the leads, the Dark Desk files and the Server page (which restarts services on the journalist's machine); the original owner is now permanently locked out with no in-product recovery. Second, **on a no-provider install the two AI paths that lack a preflight — `Draft with AI` and Dark Desk — fail silently**: Dark Desk reported `completed`, crawled 21 pages of which 12 were LinkedIn company profiles, filed 12 empty "WORTH A LOOK" cards, and told the editor the stop was normal, while the real cause ("AI is not available") sat unread in `dark_runs.error`. Third, **this instance advertises somebody else's domain**: every page it serves declares `<link rel="canonical" href="https://townreporter.org/...">`, and `robots.txt` unconditionally points crawlers at `https://townreporter.org/sitemap.xml`.

Security surfaces found while running: sign-in has no rate limiting (80 failed attempts in 6.3 s, all 401, correct password still accepted afterward), and the app emits no security headers of any kind on any response.

## Severity roll-up (QA)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 4 |
| Major | 9 |
| Minor | 9 |
| Nit | 3 |

Total: 25

## What's working

- **Cross-browser parity is clean.** Chromium, Firefox and WebKit each loaded `/`, `/articles/welcome-to-townreporter`, `/about` and `/login`, all 200, all with the correct `<h1>`, and **zero console errors in all three engines**. Evidence: `qa-evidence/xb-*.png`, script `qa-evidence/_scripts/qa23.mjs`.
- **Console and network health is spotless.** Across 8 desk pages × 2 viewports and 5 public pages × 3 viewports, I recorded no console errors, no page errors, and no 4xx/5xx beyond the deliberate `/nope` probe. Evidence: `qa-evidence/_scripts/qa22.mjs`, `qa37.mjs` output.
- **The auth boundary holds where it counts.** `GET /_serverFn/<id>` with no cookie → 403; with `Sec-Fetch-Site: cross-site` → 403; `/desk` unauthenticated → redirect to `/login`; a second identity attempting to claim an owned desk → 401 with honest copy ("This desk already has an editor"). `Sign out` revokes the session server-side — a saved storage state stopped working immediately afterwards, which is exactly right. Evidence: `qa-evidence/serverfn-unauth.txt`, `second-01..03.png`, `signout-10..12.png`.
- **The SSRF defence on the fetch path is properly built.** `src/lib/news/fetch-url.ts` resolves the host, rejects private/link-local/loopback/CGNAT/multicast ranges including IPv4-mapped IPv6 forms, installs a guarded `dns.lookup` on the undici connect path so the approved address is the address connected to (defeating rebinding), and handles redirects manually with a hop budget. This is better than most production code I audit.
- **Performance is well inside benchmark.** TTFB 179 ms, FCP 296 ms, CLS 0.014, load 348 ms, 25 requests / 814 KB. Origin p50: `/` 5.6 ms, `/articles/:slug` 5.6 ms, `/feed` 2.7 ms, `/sitemap.xml` 2.5 ms.
- **The full editorial round trip works.** Filed a lead → opened it → filled headline/dek/body → published → the story appeared on `/`, in `/feed` and in `/sitemap.xml` within the same request cycle; posted a correction → it appeared on `/corrections` and beneath the story. Evidence: `publish-01..02.png`, `corr-06/07*.png`, `feed.xml`, `sitemap.xml`.
- **The dangerous buttons that *do* have guards have excellent guards.** Delete's confirmation states the consequences plainly ("Its URL becomes a 404, the feed and the sitemap drop it… Its corrections go too. Consider a correction instead"). `Publish to the paper` is correctly disabled while the body is empty. The ops action list is a hard-coded allow-list with no free-text parameter reaching a shell (`src/lib/ops/actions.ts`). Evidence: `delete-01-confirm.png`.
- **Scan and Opinion both preflight the model provider properly.** With no provider, `Run scan` refuses in under 5 s with "The desk cannot scan yet" and setup guidance, and creates no job; the Opinion desk warns up front and hard-disables `Write an editorial` even with a subject filled. Nothing was spent. The code comment at `src/lib/news/desk.ts:340` shows this was a deliberate fix for a previously-reported Blocker — it landed correctly. Evidence: `scan-run.txt`, `opinion-02-filled.png`.
- **Responsive layout is defect-free.** Zero horizontal overflow on 13 page/viewport combinations from 375 px to 1440 px, including every desk page.
- **The migration runner is sound and the schema is current.** Transactional per file, idempotent via a `_migrations` table, non-recursive read so the opt-in auth schema isn't force-applied. 18 of 18 migrations applied on this database.
- **XSS resisted.** A `<script>alert("xss-headline")</script>` payload in a lead headline round-tripped through the desk, the story page, the public article page and the sitemap as inert escaped text; no dialog fired at any point.
- **URL fuzzing is clean.** `../../etc/passwd`, `%2e%2e%2f`, a trailing quote, a `%00` suffix and a 2000-character slug all returned 404, not 500.

## What couldn't be assessed

- **Anything requiring a model provider to succeed.** With `TOWNREPORTER_CLAUDE_CODE=0` I could observe how the desk *fails* without a model but not how scan/draft/Dark Desk/Opinion behave when one is present. Quality of generated copy, lead scoring, entity extraction, and the "21% confidence" Dark Desk threshold are all unverified.
- **The `ops/` PowerShell layer at runtime.** The hard boundary forbids running anything that starts, stops or restarts a scheduled task or service, which covers `watchdog`, `restart-app`, `restart-tunnel`, `install-tasks`. I read them but ran none. `Run health check now` is described as "Repairs anything that is down", so I did not click it either.
- **Sign-in over plain HTTP on a non-loopback address.** My instance is bound to loopback (`http://192.168.0.135:3400` did not answer), so I could not run the LAN-address sign-in case in a browser. QA-012 is reasoned from the observed `Set-Cookie` (Secure) plus the hardcoded `secure: true` in `src/lib/auth/server.ts:264`; the runtime step is explicitly unverified.
- **Cloudflare Tunnel behaviour.** No tunnel fronts this instance, so header rewriting, caching and TLS termination in the real deployment path are untested. QA-008's exposure could be partially mitigated by whatever the tunnel adds; I could not check.
- **Load and concurrency.** Single-user testing only. No sustained-load, connection-pool-exhaustion, or multi-editor concurrency testing (the product is explicitly single-editor).
- **Email delivery.** Nothing in the product sends mail; there is no signup verification or reset mail to test.

---

## Product shape

TownReporter is a self-hosted, single-operator civic newspaper: a public reader-facing paper served with SSR, plus a private editor's desk behind email/password sign-in that ingests civic sources, runs model-assisted scans and investigations, and publishes stories with corrections. The intended operator is one non-technical local journalist on a Windows box, reaching the internet through a Cloudflare Tunnel. So I weighted QA toward the dimensions that bite that person: does the first-run state (no model provider) behave honestly, can the single editor lose access to their own newsroom, does the public paper present itself correctly to readers and crawlers, and is the internet-exposed sign-in defensible. I did a full user-journey pass on the desk, a contract/status-code pass on the HTTP surface, an SSR/SEO pass on the paper, and adversarial passes on auth, input and URL handling.

## Flows exercised

| Flow | Result | Findings |
|---|---|---|
| First-run: unclaimed desk → create editor account → land on desk | Pass | — |
| Public paper walk (`/`, `/about`, `/how-we-report`, `/corrections`, article, 404) | Pass | QA-009 (SSR gap on `/corrections`) |
| Feed + sitemap + robots correctness | Partial | QA-005, QA-017 |
| Page metadata / canonical / Open Graph | **Fail** | QA-004 |
| Desk walk, all 8 sub-pages + story page + evidence pages | Pass | QA-015 |
| Run scan with no model provider | Pass (refuses cleanly) | QA-019 |
| Draft a story with AI, no model provider | **Fail** (silent) | QA-006 |
| Dark Desk investigation, no model provider | **Fail** (false success) | QA-002 |
| Opinion editorial, no model provider | Pass (preflights) | — |
| File a lead → open → edit → publish → verify on paper/feed/sitemap | Pass | QA-014 |
| Post a correction → verify on `/corrections` and on the story | Pass | — |
| Delete a published story (confirmation reached, not completed) | Partial | — |
| Sign out → back button → session revoked | Pass | — |
| Second identity attempts to claim an owned desk | Pass (refused) | — |
| `Leave as editor` → stranger claims the desk | **Fail** (by design, harmful) | QA-001 |
| Original owner attempts to regain the desk | **Fail** (no path) | QA-007, QA-018 |
| Cross-browser: Chromium / Firefox / WebKit | Pass | — |
| Responsive: 375 / 768 / 1280 / 1440 | Pass | — |

## Adversarial scenarios exercised

| Scenario | Outcome | Findings |
|---|---|---|
| `GET /_serverFn/<id>` with no session cookie | 403 Forbidden | — |
| Same, with same-origin headers and no session | **500 `{"status":500,"unhandled":true,"message":"HTTPError"}`** | QA-011 |
| Same, with `Sec-Fetch-Site: cross-site` (sibling-tenant simulation) | 403 | — |
| Script tag + HTML entities + unicode in lead headline and dek | Escaped, rendered as text, no dialog | — |
| `file://`, `javascript:`, `169.254.169.254`, `10.0.0.1`, `[::1]`, `localhost` as a watched source | All rejected | — |
| `http://127.0.0.1.nip.io:3400/desk` (DNS rebinding name) as a watched source | **Accepted into the watch list** (fetch path would still block it) | QA-016 |
| `https://probe/` (no TLD) as a watched source | **Accepted** | QA-016 |
| 80 failed sign-ins as fast as possible | 80× 401 in 6.3 s, no throttle, no lockout, correct password still works | QA-003 |
| Sign in with the correct editor email and a wrong password | "No editor with that email. This desk is already claimed." | QA-007 |
| Session cleared mid-task, then reload a desk page | Redirects to `/login` cleanly | — |
| Back button after sign-out (×2) | Lands on `/login`, no cached desk content | — |
| Two tabs on the desk, ownership relinquished in one | Second tab keeps rendering stale desk chrome until reload | QA-018 (related) |
| `POST` / `PUT` / `DELETE` / `PATCH` on `/api/cron/monitors` | **200 `text/html`** (the SPA shell) | QA-010 |
| `GET /api/cron/monitors` with a bogus `?secret=` | 503 (fail closed — correct) | — |
| Path traversal, null byte, 2000-char slug on `/articles/:slug` | 404 in every case | — |
| `/evidence/999999` (nonexistent capture) | **200** with a "not in this edition" page | QA-020 |

---

## Findings

> **Finding ID prefix:** `QA-`
> **Categories:** Flow / API / Security / Performance / Browser / Mobile / Console / Protocol / Install / Auth / SEO

### [QA-001] — Critical — Auth — Two clicks in the desk header hand the entire newsroom to the next stranger, irreversibly

**Evidence**

1. Sign in as the owning editor (`qa-auditor@example.com`) and open any desk page — e.g. `http://127.0.0.1:3400/desk`.
2. In the persistent header, next to "EDITOR'S DESK — LONGMONT", click **Leave as editor**. (`qa-evidence/leave-01-confirm.png`)
3. An inline one-line confirm appears: *"Really leave? The paper stays. Anyone can Create editor and own the desk."* with **Leave** / **Stay**. There is no re-authentication, no typed confirmation, no second step.
4. Click **Leave**. The session is signed out and the browser lands on `/`. (`qa-evidence/leave-02-after.png`)
5. In a clean browser context with no cookies, open `/login`. It now reads **"Create the desk — First person in owns the newsroom."** (`qa-evidence/leave-03-stranger-login.png`)
6. Create an account with an arbitrary address (`stranger@example.com`). It lands directly on `/desk`, in possession of the published archive, the lead queue, the Dark Desk files (12 cards + 1 open file, 21 captured artifacts), the 24-entry watch list, beat memory, and the **Server** page. (`qa-evidence/leave-04-stranger-desk.png`)
7. Database confirms the transfer:
   `select nm.role, u.email from newsroom_members nm join "user" u on u.id = nm.user_id;`
   → `owner | stranger@example.com` (single row).
8. Sign back in as the original owner. Authentication succeeds (lands on `/desk`) but the desk is gone: *"This desk already has an editor. Sign in if that's you."* — with no form and no way forward. (`qa-evidence/leave-05-original-lockedout.png`, `leave-06-original-desk.png`)

Observed: a persistent, always-visible header control transfers ownership of the newsroom to any anonymous visitor, and the previous owner cannot get it back from inside the product.
Expected: an ownership-relinquishing action should require re-authentication or a typed confirmation, should not live in the chrome of every page, and should leave the departing owner a documented way back.

Source: `src/components/desk-chrome.tsx:150-195` (`leaveEditor()` → `signOut()` → navigate to `/`), copy at `src/lib/news/desk-copy.ts:579-589`.

**Why this matters**

The intended operator is one non-technical journalist. The desk is designed to be reachable from the internet through a Cloudflare Tunnel (`ops/run-tunnel.ps1`, `.env` HOST guidance). A misclick, a curious hand on a shared laptop, or a moment's misreading of "Leave as editor" as "log out" — the button sits two positions from `Sign out`, which is what most people will assume it means — permanently surrenders the newsroom to the first person on the internet who loads `/login`. That person inherits the published archive, the confidential Dark Desk investigation files and reporting notes, and the Server page's ability to restart the app and the Cloudflare tunnel on the journalist's own Windows machine. There is no password reset (QA-007), so the original owner has no route back short of hand-editing Postgres.

**Blast radius**

- Adjacent code: `src/components/desk-chrome.tsx` (renders on every `/desk/*` route via `desk.tsx`), `src/lib/news/membership.ts` (`requireEditor`, `DEFAULT_NEWSROOM_ID`), the claim path used by `/login` when `newsroom_members` is empty, and `NEWSROOM_SETUP_TOKEN` handling — the token gates the *first* claim but, on the evidence here, not a re-claim after a leave.
- Shared state: the `newsroom_members` table is the single authority for desk access; `newsroom_id` scopes leads, drafts, sources, dark runs and desk jobs, all of which follow ownership wholesale.
- User-facing: after a fix, `Leave as editor` stops being reachable in one click; a departing owner gets an explicit, deliberate path instead.
- Migration: none for the guard itself. If a "previous owners" or re-claim-token record is added, that is a new table or column.
- Tests to update: `src/lib/news/desk-copy.test.ts:467` asserts the current label; `scripts/newsroom-security.test.mjs` should gain a case for the leave→re-claim sequence, which nothing currently covers.
- Related findings: QA-007 (no password reset compounds the lockout), QA-018 (the locked-out owner's dead-end screen), QA-003 (an internet-exposed desk with no sign-in throttle widens the window in which a stranger can be the one who claims).

**Fix path**

Move `Leave as editor` off the global header and into a deliberate location (a "Danger" block at the bottom of the Server page). Require the operator to re-enter their password, or to type the newsroom name, before the action fires. Gate re-claiming a previously-owned desk behind `NEWSROOM_SETUP_TOKEN` so that leaving does not reopen the desk to anonymous claim — if the token is unset, refuse the leave and say so. Independently, document in `SELF-HOSTING.md` the exact SQL to restore ownership (`delete from newsroom_members;` then re-claim), so a locked-out journalist has a route that does not require reading source.

---

### [QA-002] — Critical — Flow — Dark Desk reports a successful, "normal" run with no model configured, and files 12 empty cards sourced from LinkedIn

**Evidence**

1. On a build with `TOWNREPORTER_CLAUDE_CODE=0` and no API key or gateway, sign in and open `/desk/dark`.
2. The page carries **no warning that the model is missing** — I searched the rendered text for `model`, `not set up`, `ANTHROPIC`, `AI is not available`: zero matches. (Contrast `/desk/opinion`, which warns and disables its button.)
3. Enter a subject — I used `Front Range Civic Partners LLC water contract` — and click **Start digging** (enabled).
4. The run proceeds for ~17 s and reports: *"Why it stopped: Dark Desk opened a batch of records, then stopped so it would not run all night. It still has 214 pages, names, or documents it has not opened yet. That is normal."* Along the way it shows *"Capture failed (999) — not the article"*.
5. The "To look at" pile fills with **12 cards** titled `Datum Engineers — Linkedin`, `American Constructors — Linkedin`, `Mep Engineering Inc. — Linkedin`, `Guest Controls — Linkedin` and similar. Each card's body reads, verbatim: *"linked from / Why it matters — linked from / What changed — linked from / First question: What public record would confirm or contradict this?"* — the fields are empty placeholders. (`qa-evidence/dark-04-final.png`, `dark-final.txt`)
6. What the crawler actually fetched:
   `select substring(url from 'https?://([^/]+)') as host, count(*) from artifacts group by 1 order by 2 desc;`
   → `linkedin.com | 12`, `timescall.com | 6`, `bizwest.com | 2`, `(null) | 1`. **Zero fetches from any Longmont government or official source**, while the same page's settings panel states "Looking at: Longmont only."
7. The real cause is recorded in the database and never shown:
   `select summary, error from dark_runs;` →
   `summary: "Heuristic hop: 3 searches, 4 fetches, 14 frontier items. / Planner fell back on 5 of 5 hops: AI is not available… / Hops 5 of 5. Artifacts 21. Open frontier 214. / Synthesis: AI is not available…"`
   `error: "AI is not available. Set ANTHROPIC_API_KEY…"`
8. Yet `select id, kind, status, error from desk_jobs;` shows the Dark Desk job as **`status = completed`, `error = NULL`**.
9. Reload `/desk/dark`. The "why it stopped" panel is gone; only the 12 junk cards remain, with no indication anything went wrong.

Observed: a flagship capability runs to green, produces 12 meaningless investigative cards from a source class the product says it never cites, and tells the editor the outcome was normal.
Expected: either a preflight refusal like Scan's, or a run that terminates with "no model configured" surfaced in the UI and persisted, and that files nothing.

**Why this matters**

Dark Desk is described in the product's own copy as the recursive investigative lane and appears on the desk's command center. A non-technical journalist on day one — the exact documented first-run state — will click it, wait, and receive a desk full of "WORTH A LOOK" cards pointing at LinkedIn company profiles with blank reasoning. The card framing ("Worth a look", "First question: what public record would confirm this?") reads as editorial judgement when no judgement occurred. That is worse than an error: it manufactures the appearance of investigative output. The `completed` job status also means any future monitoring built on `desk_jobs` will report the newsroom as healthy.

**Blast radius**

- Adjacent code: `src/lib/news/dark.ts` (the run loop), `src/lib/news/pull-plan.ts` (`isOnSubject`, `docCandidateHosts`, `siteOwnDocLinks` — the relevance filter that silently no-ops without a model), `src/lib/news/jobs.ts` (job completion semantics), `src/routes/desk.dark.tsx` (no preflight, no persisted failure display), `src/lib/news/search-web.ts`.
- Shared state: `dark_runs.error` is populated but no consumer reads it; `desk_jobs.status` is the field the UI and the Server page trust, and the two disagree. `dark_signals` stayed empty (0 rows) while `artifacts` grew to 21 — the write path partially succeeded, which is why nothing looked broken.
- User-facing: after a fix, clicking `Start digging` with no provider refuses immediately the way `Run scan` does, and no cards are filed.
- Migration: none for the guard. Existing junk cards from a no-provider run would need a cleanup path or an operator-visible "these were filed without a model" marker.
- Tests to update: `src/lib/news/preflight.test.ts` covers the scan preflight only — extend it to the dark and draft paths. No test currently exercises a dark run with the provider absent.
- Related findings: QA-006 (`Draft with AI` has the identical gap), QA-019 (Scan and Opinion get this right, so the fix is a copy of an existing pattern), QA-013 (a second place where a green signal does not describe reality).

**Fix path**

Reuse `scanPreflight` from `src/lib/news/preflight.ts` at the entry to `startDark` (and every `Start digging` / `Pick one for me` / `Check r/longmont` button), refusing before any fetch and rendering the same "The desk cannot dig yet" notice the Scan page uses. Separately, decouple job status from job outcome: when the planner falls back on every hop, finish the job as `failed` (or a new `degraded`) with `dark_runs.error` copied into `desk_jobs.error`, and render that state on `/desk/dark` on load — not only in the transient mutation result. Finally, when the planner is unavailable, do not file frontier items as cards at all; an empty pile is honest, twelve blank LinkedIn cards are not.

---

### [QA-003] — Critical — Security — Sign-in accepts unlimited password guesses with no throttle, lockout or backoff

**Evidence**

1. With the desk claimed by `qa-auditor@example.com`, issue failed sign-ins as fast as the client can:
   `POST http://127.0.0.1:3400/api/auth/sign-in/email` with `{"email":"qa-auditor@example.com","password":"guess<N>"}` and `Origin: http://127.0.0.1:3400`.
2. 80 consecutive wrong-password attempts completed in **6.3 seconds — 12.7 attempts/second — returning `401` every time**. No `429`, no `Retry-After`, no increasing delay, no captcha, no lockout.
3. Immediately afterwards, the correct password returned **200** and a valid session. The account was never locked or slowed.
4. Repeated at a lower rate earlier in the audit (12 attempts) with the same result: `401,401,401,…`.
5. Configuration check: `src/lib/auth/server.ts:236` sets `emailAndPassword: { enabled: true }` with no `rateLimit` block; grep for `rateLimit` across `src/lib/auth/` returns nothing.
6. Password policy observed on the signup form: *"At least 8 characters."* No complexity, no breach check.

Script: `qa-evidence/_scripts/qa19.mjs`.

Observed: an unbounded online password-guessing channel against the only account that controls the newsroom.
Expected: exponential backoff or a lockout after a small number of failures, and a `429` with `Retry-After`.

**Why this matters**

The documented deployment puts this desk on the public internet through a Cloudflare Tunnel. There is exactly one account and it owns everything: the archive, the investigation files, and the Server page's ability to restart processes on the journalist's Windows machine. An 8-character minimum with no throttle means a single attacker on a home connection can attempt millions of candidates against a memorable password. Nothing in the product would show the operator it was happening — there is no failed-login counter on the Server page and no alert.

**Blast radius**

- Adjacent code: `src/lib/auth/server.ts` (Better Auth config), every `/api/auth/*` route the catch-all in `src/routes/api/auth/$.ts` serves — sign-in, sign-up and session endpoints are all equally unthrottled.
- Shared state: the `session` and `account` tables; a rate limiter typically needs its own store (Better Auth supports a database-backed limiter, which suits a self-host with Postgres already present).
- User-facing: legitimate operators see no change until they mistype repeatedly, at which point they should get a clear "too many attempts, wait N seconds" rather than a generic failure — coordinate the copy with QA-007.
- Migration: a database-backed rate limiter needs a new table; add it as migration `0019_*`.
- Tests to update: `scripts/newsroom-security.test.mjs` has no rate-limit case. Add one that asserts the Nth rapid failure returns 429.
- Related findings: QA-001 (a compromised or relinquished desk yields machine-level ops actions), QA-007 (no reset flow means the operator's password is long-lived), QA-008 (no security headers on the same surface).

**Fix path**

Enable Better Auth's rate limiter with a database store and a strict window on `/sign-in/email` (for example 5 attempts per 15 minutes per email and per IP, then 429 with `Retry-After`). Raise the minimum password length to 12 for a single-account, internet-exposed desk and say so on the form. Surface a "failed sign-ins in the last 24 h" row on the Server page so the operator can see an attack in progress. If the tunnel is the only intended route in, also document a Cloudflare Access or WAF rate rule in `SELF-HOSTING.md` as defence in depth — but do not rely on it, since the app also answers directly on the LAN by default.

---

### [QA-004] — Critical — SEO — Every page this instance serves declares a canonical URL on a different website

**Evidence**

1. Publish a story on this instance (I published `council-raises-water-rates-12-percent` at `http://127.0.0.1:3400`).
2. `curl -s http://127.0.0.1:3400/articles/council-raises-water-rates-12-percent` and read the head:
   - `<link rel="canonical" href="https://townreporter.org/articles/council-raises-water-rates-12-percent"/>`
   - `<meta property="og:url" content="https://townreporter.org/articles/council-raises-water-rates-12-percent"/>`
   - `<meta property="og:image" content="https://townreporter.org/og.jpg"/>`
   - `<meta name="twitter:image" content="https://townreporter.org/og.jpg"/>`
   Saved at `qa-evidence/pub-article.html`; the same tags appear on the front page (`qa-evidence/home.html`, `article-head.txt`).
3. Meanwhile `/feed` and `/sitemap.xml` on the same instance correctly use the request origin: `<loc>http://127.0.0.1:3400/articles/council-raises-water-rates-12-percent</loc>`. Two code paths, two different answers about what this site's address is.
4. Root cause: `src/lib/paper.ts:211-222` — `siteUrl()` resolves `process.env.PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL || ""`. `PUBLIC_SITE_URL` is commented out in the shipped `.env` (line 25: `# PUBLIC_SITE_URL=https://your-domain.com`) while `BETTER_AUTH_URL=https://townreporter.org` is set (line 16). The same fallback also ships in `.env.e2e`.

Observed: a self-hosted instance tells search engines that its own articles are duplicates of pages on `townreporter.org` — URLs which do not exist there.
Expected: canonical and `og:url` reflect the origin this paper is actually served from, or are omitted when unknown.

**Why this matters**

`rel="canonical"` is an instruction to search engines, not a hint. A self-hoster who copies the shipped env — the path `SELF-HOSTING.md` sets out — publishes a paper whose every page tells Google "index the other site instead". Their stories will not rank, and the canonical targets 404 on the other domain, so the pages may simply be dropped. The `og:image` has the same shape: every link the journalist shares on social media pulls its preview card from `townreporter.org`, which is both wrong and a live dependency on someone else's server. The doc comment in `siteUrl()` reasons carefully about *not* emitting a localhost canonical; the case it misses is emitting a *confidently wrong* one, which is worse than either.

**Blast radius**

- Adjacent code: `src/lib/paper.ts` (`siteUrl`), `src/routes/__root.tsx:30-31` (og/twitter image), the article route's canonical/og:url, `src/routes/feed.ts:34` and the sitemap route (which use the same fallback plus proxy headers — resolve all four through one helper), `src/lib/ops/health.server.ts:248` and `:296` (QA-013 is the same fallback in the health checks).
- Shared state: `PUBLIC_SITE_URL` and `BETTER_AUTH_URL` are being made to do one job with two meanings — auth origin vs. reader-facing origin. They diverge for anyone behind a proxy or on a second domain.
- User-facing: after the fix, shared links show the operator's own preview image and search engines index the operator's own pages.
- Migration: none in the database. Anyone who already published under a wrong canonical needs the pages recrawled after the fix; note that in the release notes.
- Tests to update: `src/lib/paper.test.ts` — add cases asserting `siteUrl()` never returns a host different from the request host when `PUBLIC_SITE_URL` is unset.
- Related findings: QA-005 (`robots.txt` hardcodes the same foreign domain, unconditionally), QA-013 (health checks probe the same foreign domain), QA-021 (no structured data, compounding the SEO position).

**Fix path**

Stop falling back to `BETTER_AUTH_URL` for reader-facing URLs. Resolve the public origin as: `PUBLIC_SITE_URL` if set → otherwise the current request's origin (via forwarded-proto/host, which `feed.ts` already knows how to read) → otherwise omit canonical/`og:url` entirely and use a relative `og:image`. Make `PUBLIC_SITE_URL` the single documented knob, and have the Server page show a red row when it is unset while the instance is reachable on a public hostname. Ship `.env.example` and `.env` with `BETTER_AUTH_URL` blank or set to `http://localhost:3000`, never to a live third-party domain.

---

### [QA-005] — Major — SEO — `robots.txt` unconditionally points every crawler at `https://townreporter.org/sitemap.xml`

**Evidence**

1. `curl -s http://127.0.0.1:3400/robots.txt` — the last line reads, verbatim:
   `Sitemap: https://townreporter.org/sitemap.xml`
2. The file is a static asset (`public/robots.txt:25`, copied verbatim to `.output/public/robots.txt`). No environment variable, no template, no request-time substitution — every self-hosted instance serves this exact line.
3. The instance's own working sitemap is at `http://127.0.0.1:3400/sitemap.xml` and lists 6 URLs correctly.

Observed: the robots file directs crawlers to a sitemap on a domain the operator does not control.
Expected: the `Sitemap:` directive points at this instance's own sitemap, or is omitted.

**Why this matters**

Unlike QA-004, this one is not fixable by configuration — it affects every self-hoster regardless of what they put in `.env`. Crawlers that read `robots.txt` for the sitemap (the normal discovery path) will fetch `townreporter.org`'s sitemap and never see the operator's archive; the front page lists only the newest stories, so the file's own comment — "without this the archive is reachable only by following links" — describes exactly the failure it causes. It also sends every self-hoster's crawl budget at a third party's server.

**Blast radius**

- Adjacent code: `public/robots.txt` and the build step `scripts/copy-runtime-assets.mjs` that copies it. The `Disallow: /newsletter/confirm` line in the same file refers to a route that does not exist in `src/routes/` — the file has drifted from the app generally.
- Shared state: shares the "what is this paper's address" problem with QA-004; both should be fixed by the same origin helper.
- User-facing: a self-hoster's archive becomes discoverable.
- Migration: none.
- Tests to update: none exist for `robots.txt`. Add a served-response assertion that the `Sitemap:` host matches the request host.
- Related findings: QA-004 (same root: a hardcoded/misresolved public origin), QA-009 (`/corrections` invisible to crawlers).

**Fix path**

Convert `robots.txt` from a static file to a server route alongside `sitemap[.]xml.ts`, emitting `Sitemap: ${origin}/sitemap.xml` from the same resolved-origin helper as QA-004's fix. Drop the stale `Disallow: /newsletter/confirm` line, or add the route it names.

---

### [QA-006] — Major — Flow — `Draft with AI` starts a job with no provider preflight and leaves no trace when it fails

**Evidence**

1. With no model provider configured, open a filed lead at `/desk/story/1`.
2. Click **Draft with AI**. The button becomes `Drafting…` and the page shows *"Reporting first — following the trail, then drafting. Stay on this page."*
3. Stay on the page. At ~18 s the button returns to `Draft with AI` and a notice appears: *"The writing model is not set up on this machine. Nothing you click will fix it — that is an operator job."* — good copy, correctly stated.
4. **Reload the page.** The notice is gone. The lead looks untouched: no draft, no error, no marker. I searched the fully-loaded page text for `model`, `not set up`, `fail`, `error` — nothing. (`qa-evidence/story-06-fresh-after-failed-draft.png`)
5. The failure is in the database the whole time:
   `select id, kind, status, error from desk_jobs where kind='draft';` → three rows, all `status = failed`, all `error = "AI is not available. Set ANTHROPIC_API_KEY…"`.
6. By contrast, `Run scan` refuses in under 5 s before creating any job, and the Opinion desk disables its button outright.

Observed: the drafting path enqueues work that cannot succeed, and the only explanation the editor gets is destroyed by a page refresh.
Expected: refuse at the click (like Scan), or persist the failure on the story until the editor dismisses it.

**Why this matters**

An editor who clicks Draft, switches tabs to read the source document, and comes back sees a lead that simply did not draft — no error, no reason, no guidance. The natural response is to click again, which enqueues another job that will fail identically; I produced three such rows without trying. On a machine where the model *is* configured, the same pattern hides genuine transient failures (timeouts, rate limits) behind an apparently idle button.

**Blast radius**

- Adjacent code: `src/routes/desk.story.$leadId.tsx` (renders failures only from the mutation result, not from job state), `src/lib/news/jobs.ts` (`latestJob` already exposes the failed row — it just isn't read on load), `src/lib/news/report.ts`, and every other button that enqueues a job the same way (`Redraft`, `Keep digging`).
- Shared state: `desk_jobs.status` / `desk_jobs.error` are written correctly and read incompletely — this is a display gap, not a data gap, which makes it cheap to fix.
- User-facing: after the fix, a lead whose last draft attempt failed says so until the editor acts.
- Migration: none.
- Tests to update: `src/lib/news/preflight.test.ts` covers the scan path only; extend to draft. No test asserts that a failed job is visible after reload.
- Related findings: QA-002 (identical gap in Dark Desk, and the same "failure lives in the DB but not the UI" root cause), QA-019.

**Fix path**

Call `scanPreflight(await probeProvider())` at the top of the draft server function and return the same `{ ok: false, guidance, detail }` shape the scan path uses, so `Draft with AI` refuses instantly and enqueues nothing. Independently, have the story route's loader read `latestJob({ kind: 'draft', subjectId })` and render a persistent notice whenever the most recent job for that lead is `failed`, with a dismiss control. Apply the same read to `/desk/dark` and `/desk/queue`.

---

### [QA-007] — Major — Auth — A wrong password on the correct editor email reports "No editor with that email", and there is no password reset anywhere

**Evidence**

1. Desk claimed by `qa-auditor@example.com`. Open `/login`.
2. Enter the **correct** email and a **wrong** password (`WrongPassword!99`). Submit.
   Result: *"No editor with that email. This desk is already claimed — read the paper without an account."*
3. Enter a **nonexistent** email (`nobody@example.com`) with the same wrong password.
   Result: **the identical message**.
4. Source: `src/lib/news/desk-copy.ts:573-575` — `unknownEmail` is the only failure string the sign-in form has; it is shown for every 401.
5. Recovery search: grep for `forgetPassword|forgot|resetPassword|reset-password|sendResetPassword` across `src/`, `ops/`, `docs/`, `SELF-HOSTING.md`, `README.md` returns no match other than an unrelated comment in `desk.ops.tsx`. Grep for `locked out|forgot your password|recover|reset the desk` across the same set returns only Postgres crash-recovery comments in `ops/*.ps1`.

Observed: the single intended user, having mistyped their password, is told their editor account does not exist — and has no way to reset it.
Expected: "That password is not right" for a bad password (the enumeration argument is moot on a single-account desk where the email is the operator's own), plus a documented recovery path.

**Why this matters**

This is the failure mode a solo non-technical journalist will actually hit, and the message actively misleads them: it says the account is gone and invites them to stop trying ("read the paper without an account"). Combined with the absence of any reset flow, a forgotten or mistyped password is an unrecoverable loss of the newsroom from inside the product. The user-enumeration protection the shared message provides is worth very little here — the desk is single-account and the login page already announces "This desk already has an editor."

**Blast radius**

- Adjacent code: `src/routes/login.tsx` (error mapping), `src/lib/news/desk-copy.ts:568-577` (`deskTakenLoginCopy`), `src/lib/auth/server.ts` (a reset flow needs a mail transport or an out-of-band token).
- Shared state: the `account` table holds the password hash; a CLI or ops-script reset would write there.
- User-facing: distinct, accurate messages for wrong-password vs. unknown-email; a visible "Forgot your password?" affordance.
- Migration: none if recovery is an ops script; a token table if an in-app reset is added.
- Tests to update: `src/lib/news/desk-copy.test.ts` asserts the current single string — it will need the new pair.
- Related findings: QA-001 (lockout after `Leave as editor` has the same "no way back" character), QA-018 (the locked-out screen), QA-003 (a throttle changes what the right failure copy should say).

**Fix path**

Split the copy: on a 401 where the email exists, say "That password is not right." — and once QA-003's limiter lands, add "Too many attempts — try again in N minutes." For recovery, the lightest thing that actually helps a self-hoster is an ops script (`ops/reset-editor-password.ps1`) that takes an email and a new password and writes the hash directly, plus a "Forgot your password?" link on `/login` that explains where that script lives. Document both in `SELF-HOSTING.md`.

---

### [QA-008] — Major — Security — No security headers on any response, and no `Cache-Control: no-store` on the desk or the sign-in page

**Evidence**

1. `curl -s -D - -o /dev/null http://127.0.0.1:3400/` — full response headers are: `content-type`, `Date`, `Connection`, `Keep-Alive`, `Transfer-Encoding`. Nothing else.
2. Same for `/desk`, `/login`, and `/articles/:slug`.
3. Absent on every route: `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / `frame-ancestors`, `Strict-Transport-Security`, `Permissions-Policy`.
4. Absent on the authenticated surfaces: `Cache-Control` of any kind on `/desk` and `/login`. (For contrast, `/feed` correctly sends `cache-control: public, max-age=300` and `/sitemap.xml` `max-age=600`, so the app does set the header where it has decided to.)
5. Session cookies themselves are well-formed — `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=604800` — so this finding is about transport headers, not cookie flags.

Observed: an application intended to be published to the internet ships with no defence-in-depth headers and no caching directive on pages that render an editor's private work.
Expected: at minimum `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `frame-ancestors` policy, and `Cache-Control: private, no-store` on `/desk/*` and `/login`.

**Why this matters**

With no `frame-ancestors`, the desk can be framed for clickjacking — and QA-001 establishes that a single well-placed click (`Leave as editor` → `Leave`) has catastrophic effect, which turns a generic hardening gap into a specific one. With no `no-store` on `/desk`, a shared or corporate-proxied connection, or a browser's own heuristic caching, may retain rendered pages containing unpublished drafts and Dark Desk reporting notes. With no CSP, any future injected content has a free hand. None of this is exploitable today on a loopback instance, which is why it is Major rather than Critical — but the documented deployment is the public internet.

**Blast radius**

- Adjacent code: the Nitro/TanStack server entry (`.output/server/index.mjs`, generated from the app config) — a single response hook can set these globally; per-route overrides for the desk.
- Shared state: a CSP interacts with the inline hydration scripts TanStack Start emits (`$_TSR` bootstrap in every page) — expect to need a nonce or hash, so land `nosniff`/`Referrer-Policy`/`frame-ancestors` first and CSP as a follow-up.
- User-facing: no visible change for legitimate readers or the editor.
- Migration: none.
- Tests to update: none exist. Add a served-response test asserting the header set, so it cannot silently regress.
- Related findings: QA-001 (clickjacking a two-click destructive control), QA-003 (same internet-exposed surface, unthrottled).

**Fix path**

Add a global response hook setting `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (plus `Content-Security-Policy: frame-ancestors 'none'`), and `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Add `Cache-Control: private, no-store` on `/desk/*`, `/login` and `/_serverFn/*`. Add `Strict-Transport-Security` only when the resolved public origin is `https:`, so a LAN/HTTP self-host is not bricked. Then build a real CSP with a per-request nonce for the hydration scripts.

---

### [QA-009] — Major — SEO — `/corrections` is not server-rendered; the paper's public accountability record is invisible to any non-JS client

**Evidence**

1. Post a correction from the desk and confirm it renders in a browser at `/corrections` (it does — `qa-evidence/corr-07_corrections.png`).
2. `curl -s http://127.0.0.1:3400/corrections` and strip scripts and tags. The SSR body is **636 characters** and contains the page's intro copy and the footer — and **nothing else**. No corrections, no "THE RECORD" heading, not even the "No corrections posted" empty state. (`qa-evidence/corrections-ssr.html`)
3. Grep the raw response for `An earlier version said` or the story headline: no match.
4. By contrast, `/about` SSRs 1404 characters of real content, `/` SSRs the story list, and `/articles/:slug` SSRs the full body **and** the correction note (`grep -ao "An earlier version said"` matches there). So the app SSRs correctly everywhere except this one page.

Observed: the entire corrections list is client-only.
Expected: the corrections record is in the initial HTML, like every other public page.

**Why this matters**

`/corrections` is the page that carries the product's central promise — "If we got it wrong, it lives here in the open — not buried in a rewrite nobody sees." A correction that is invisible to Google, to Bing, to the Internet Archive's basic fetcher, to text browsers, to social preview crawlers and to anyone with JavaScript off is, for those purposes, buried. It is also the page most likely to be cited or archived by a third party checking the paper's record. `robots.txt` explicitly allows it and the sitemap lists it, so crawlers will fetch it and find an empty shell.

**Blast radius**

- Adjacent code: `src/routes/corrections.tsx` — its data is presumably fetched client-side (react-query) rather than in a route loader, unlike `index.tsx` and `articles.$slug.tsx` which SSR correctly. `src/lib/news/public.ts` holds the query.
- Shared state: the `corrections` table and the public read path shared with the article route (which does SSR the correction). One loader can serve both.
- User-facing: crawlers, archives and no-JS readers begin seeing the record.
- Migration: none.
- Tests to update: none exist for SSR content. Add a test that fetches each public route and asserts a substantive body length / expected substring — this class of regression is invisible in a browser-only test.
- Related findings: QA-005 (`robots.txt` sends crawlers elsewhere anyway), QA-021 (no structured data), QA-004 (canonical points off-site) — together the public paper's machine-readable presentation is the weakest area of an otherwise strong front end.

**Fix path**

Move the corrections query into the route's `loader` so it is resolved during SSR, matching the pattern already used by `index.tsx`. Add the empty state to the server-rendered output too, so a paper with no corrections still says so.

---

### [QA-010] — Major — API — Unhandled methods on `/api/cron/monitors` return `200 text/html` instead of `405`, so a POST-based cron reports success while nothing runs

**Evidence**

1. `GET /api/cron/monitors` with no `Authorization` → **503** `cron disabled` (correct: `CRON_SECRET` is unset, and the route fails closed). With a bogus `?secret=` → still 503. Good.
2. `POST /api/cron/monitors` → **200**, `content-type: text/html`, body is the full SPA shell (`<!DOCTYPE html>…TownReporter — Longmont, Colorado…`).
3. `PUT`, `DELETE`, `PATCH`, `OPTIONS` → all **200 text/html**. Only `HEAD` correctly returns 503.
4. The route (`src/routes/api/cron.monitors.ts`) declares a `GET` handler only; anything else falls through to the SPA catch-all rather than a 405.

Observed: an API endpoint answers `200 OK` with an HTML page for four methods it does not implement.
Expected: `405 Method Not Allowed` with an `Allow: GET` header.

**Why this matters**

The shipped `ops/cron-tick.ps1` uses `GET` with a Bearer header, so the bundled path is fine. But `POST` is the reflex for a "trigger this job" endpoint: a self-hoster wiring this to systemd timers, cron + curl, a NAS scheduler, or an uptime monitor will very plausibly POST. They will get `200 OK`, every health check will read green, and **the monitors will never tick** — silently, indefinitely. Since background monitoring is the product's "keeps digging when something changes" promise, a silent no-op that reports success is a meaningful failure mode. It also makes the endpoint useless for any generic monitoring tool that treats 200 as proof of life.

**Blast radius**

- Adjacent code: every route under `src/routes/api/` that declares a partial handler set — `src/routes/api/auth/$.ts` is a catch-all so it is unaffected, but any future API route inherits this behaviour from the framework's fall-through.
- Shared state: `CRON_SECRET` gating; the `monitors` tick path in `src/lib/news/monitors-cron.ts`.
- User-facing: an operator's external scheduler starts failing loudly instead of silently.
- Migration: none.
- Tests to update: `scripts/ops-scripts.test.mjs` covers the PowerShell side; nothing asserts HTTP method semantics. Add a served-response test for 405.
- Related findings: QA-011 (the other place where the wrong status code is returned for a well-defined condition), QA-013 (a third place where a green signal does not mean what it says).

**Fix path**

Add explicit `POST`/`PUT`/`DELETE`/`PATCH` handlers to the cron route that return `405` with `Allow: GET`, or — better — accept `POST` as an alias for `GET` since that is what schedulers will send, keeping the same Bearer check. Then add a catch-all 405 for `/api/*` so no future API route can fall through to the HTML shell.

---

### [QA-011] — Major — API — An unauthenticated same-origin server-function call returns `500 "HTTPError"` instead of `401`

**Evidence**

1. Capture a real server-function URL from the desk (`/_serverFn/3ae2ced4…?payload=…`).
2. Replay it with no session cookie and no browser fetch-metadata headers → **403** `Forbidden` (plain text).
3. Replay it with the headers a real browser sends — `Origin: http://127.0.0.1:3400`, `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`, `Referer: …/desk` — and still no session:
   → **`HTTP/1.1 500 Internal Server Error`**, body `{"status":500,"unhandled":true,"message":"HTTPError"}`.
4. This contradicts the documented contract: `src/lib/auth/verify.server.ts` defines `UnauthorizedError` with `readonly status = 401` and comments that *"the message is a stable contract — match `err.message === "Unauthorized"` client-side to send the visitor to sign-in."* Neither the status nor the message survives to the wire.

Observed: a well-defined client-side condition (no session) is reported as an unhandled server fault.
Expected: `401` with a stable, machine-readable body.

**Why this matters**

The user-visible redirect to `/login` still works — the desk routes have their own guard, which I verified — so this is not a broken flow today. It matters for three reasons. Any server-side log or uptime monitor will count ordinary session expiry as a 5xx error rate, which trains the operator to ignore real 500s. `"unhandled": true` in the payload asserts something untrue about the server's state. And the client-side contract the code documents is not the one the server honours, so the next person to rely on it will write a handler that never fires. The dual behaviour (403 without fetch-metadata, 500 with) also means the two code paths disagree about the same request.

**Blast radius**

- Adjacent code: `src/lib/auth/middleware.ts` and `src/lib/news/desk-auth.ts` (both throw `UnauthorizedError` / `CrossSiteRequestError` with `status` properties that the transport discards), `src/lib/auth/verify.server.ts`, `src/lib/news/membership.ts` (`requireEditor`'s 403 path is likely flattened the same way), and the TanStack Start server-function error serializer.
- Shared state: the error shape is the contract between every `.middleware([...])` server function and the client's react-query error handlers.
- User-facing: no visible change for a signed-in editor; a signed-out one gets the same redirect, but faster and without a logged fault.
- Migration: none.
- Tests to update: `scripts/check-auth-invariant.mjs` asserts middleware is applied but not what the wire response is. Add a served-response test for 401 on an unauthenticated server function and 403 on a cross-site one.
- Related findings: QA-010 (status-code correctness), QA-006 / QA-002 (failures that reach the database but not the surface that should report them).

**Fix path**

Add an error handler at the server-function boundary that maps thrown errors carrying a numeric `status` onto that status, with a stable JSON body (`{"error":"Unauthorized"}` / `{"error":"Forbidden"}`), and only falls back to 500 for genuinely unclassified errors. Keep `"unhandled": true` for that residual case only.

---

### [QA-012] — Major — Install — Session cookies are hardcoded `Secure`, so sign-in cannot work over plain HTTP on the LAN address the default config exposes

**Evidence**

1. Observed on the wire: `POST /api/auth/sign-in/email` returns
   `set-cookie: __Host-grok-auth.session_token=…; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`
2. Source: `src/lib/auth/server.ts:263-266` sets `advanced.defaultCookieAttributes = { secure: true, … }` unconditionally, with the comment *"Browsers allow Secure cookies on `http://localhost`, so local dev still works."* — which is true for `localhost`/`127.0.0.1` and **not** for a LAN IP or a hostname.
3. `.env.example` documents the default: *"HOST defaults to every interface, which means the app also answers on your local network."* So the shipped default deliberately serves an address where the cookie will be refused.
4. **Could not verify at runtime**: my instance is bound to loopback — `curl http://192.168.0.135:3400/` did not answer — so I could not perform a browser sign-in over a LAN address. The mechanism is verified in code and in the observed `Set-Cookie`; the end-to-end failure is inferred, not observed.

Observed (inferred): opening the desk at `http://<lan-ip>:3400/login`, submitting correct credentials, the server responds 200 and sets a cookie the browser silently discards — the user is bounced back to the sign-in page with no error to explain it.
Expected: sign-in works over plain HTTP on a private address, or the product tells the operator plainly that the desk requires HTTPS.

**Why this matters**

The most likely first-run shape for a non-technical operator is: start the app, open it from the same or another machine on the home network, sign in. If that silently loops, there is nothing in the UI to diagnose it — the sign-in POST succeeds, so no error is raised; the session simply does not exist on the next request. That is a hard stop with an invisible cause, which is the worst class of first-run failure. It also compounds QA-007: the user will conclude their password is wrong and be told their account does not exist.

**Blast radius**

- Adjacent code: `src/lib/auth/server.ts` (`advanced.defaultCookieAttributes`, the `__Host-` cookie names — note `__Host-` *requires* `Secure`, so relaxing one means renaming the cookies), `src/lib/auth/verify.server.ts`, and the trusted-origins construction at `:139`.
- Shared state: cookie names are referenced by `SESSION_TOKEN_COOKIE` and `readSessionToken()`; changing prefixes on a running install invalidates existing sessions (acceptable — users re-sign-in once).
- User-facing: LAN self-hosters can sign in; nothing changes for HTTPS deployments.
- Migration: none in the database. Existing sessions are dropped if cookie names change.
- Tests to update: `scripts/sign-out-plan.test.mjs` and `check-auth-invariant.mjs` reference cookie handling; a new test should assert the attribute set adapts to the resolved scheme.
- Related findings: QA-007 (the failure will be misread as a bad password), QA-008 (the same headers layer decides HSTS).

**Fix path**

Resolve the scheme at request time (forwarded-proto aware). When it is `https:` keep `__Host-` + `Secure` exactly as today. When it is plain `http:` on a non-`localhost` host, fall back to un-prefixed cookie names without `Secure`, and render a visible banner on the Server page: "This desk is being served over plain HTTP. Sessions work, but anyone on this network can read them — put it behind HTTPS." If the team would rather not relax it, then detect the condition at sign-in and show an explicit error ("The desk needs https:// or localhost to sign in") instead of failing silently — a wrong-but-explained result beats a silent loop.

---

### [QA-013] — Major — Flow — The Server page's "Public site" and "Reader privacy" checks measure a different website, and reported green for a site this instance does not serve

**Evidence**

1. Open `/desk/ops` on this instance (`http://127.0.0.1:3400`, database `townreporter_audit_qa`, one published story).
2. The dashboard reports:
   - `PUBLIC SITE — https://townreporter.org answered 200 in 270ms — OK`
   - `READER PRIVACY — no outside requests — OK`
   - `CLOUDFLARE TUNNEL — running (2 processes) — OK`
   (`qa-evidence/desk-_desk_ops.png`, `after-failures_desk_ops.png`)
3. Source: `src/lib/ops/health.server.ts:248` and `:296` both resolve the target as `process.env.PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL` and `fetch()` it — the same fallback as QA-004. With `PUBLIC_SITE_URL` unset and `BETTER_AUTH_URL=https://townreporter.org`, both checks left the machine and measured a third-party site.
4. The "Reader privacy" check parses *that* site's HTML for third-party `script`/`link`/`img` sources and reports "no outside requests" about it — printed on a page that had just made an outside request to obtain it.
5. The watchdog runs this every five minutes (`WATCHDOG — ran 4m ago — next run in 55s`), so the outbound probes are continuous, not one-off.

Observed: the operator's health dashboard reports OK about a site other than the one it is running, and its privacy verdict describes that other site's HTML.
Expected: the checks measure this instance, or say "no public address configured" (a branch the code already has, at `:250` and `:301`).

**Why this matters**

This is a false-green on the one screen designed to tell a non-technical operator whether their paper is up. If `BETTER_AUTH_URL` names any address that answers 200 — a stale domain, a parked page, a colleague's site — the dashboard says the paper is fine while the operator's readers see nothing. The page's own note ("Checked from this machine, so it proves the tunnel is routing") is careful about the *inference* but not about the *subject*: it does not tell the operator which URL was checked beyond printing it, and it never checks the origin it is actually serving. The privacy verdict is the sharper problem — "no outside requests" is a strong claim about reader tracking, and here it was computed from someone else's markup. Note also that in this configuration the instance made repeated unsolicited outbound requests to a production site it has no relationship with.

**Blast radius**

- Adjacent code: `src/lib/ops/health.server.ts` (`checkPublic`, `checkThirdParty`), `src/lib/ops/dashboard.ts`, `ops/watchdog.ps1` (which runs the same class of check on a schedule), and `src/lib/paper.ts` (`siteUrl`) — QA-004 and this finding share one root.
- Shared state: `PUBLIC_SITE_URL` / `BETTER_AUTH_URL` overloading, again.
- User-facing: the Server page starts telling the truth about this instance; a mis-set public address becomes a visible warning rather than a false OK.
- Migration: none.
- Tests to update: `src/lib/ops/ops.test.ts` — add cases where the configured public origin differs from the serving origin and assert the check degrades to a warning rather than reporting OK.
- Related findings: QA-004 (same fallback, reader-facing consequence), QA-010 (a second false-green), QA-002 (a third).

**Fix path**

Split the two questions the check is conflating. Always probe *this* server on its own bound address first and report that as "This machine". Probe the configured public URL as a separate row labelled with the URL and marked `unknown` — not `ok` — whenever it cannot be shown to resolve back to this instance (a one-time nonce echoed on a `/__health` route proves identity cheaply). Run "Reader privacy" against the local origin always, since that is the HTML this server actually emits. Refuse to probe a public URL at all when `PUBLIC_SITE_URL` is unset, rather than borrowing `BETTER_AUTH_URL`.

---

### [QA-014] — Minor — Flow — `Publish to the paper` fires with no confirmation, while `Delete` and every ops action confirm

**Evidence**

1. On `/desk/story/1`, fill headline, dek and body. `Publish to the paper` becomes enabled (correctly — it is disabled while the body is empty).
2. Click it once. The story is live immediately: the page changes to *"On the paper. See it under Published · Read it on the paper"*, and within the same second it appears on `/`, in `/feed` and in `/sitemap.xml`. No dialog, no second step. (`qa-evidence/publish-01-filled.png`, `publish-02-confirm.png`)
3. For contrast, `Delete` on the same content requires a confirm with a paragraph of consequences, and the ops actions marked `INTERRUPTS` "ask twice".

The desk's own copy states a published piece is never edited and that a fix runs as a dated correction — so publishing is the least reversible content action in the product, and the only one with no confirm. Given that the editor is the sole reviewer and there is no draft-preview step between the textarea and the public paper, one stray click puts unfinished copy on a public civic newspaper under a masthead that promises human review.

**Fix path:** add a one-line inline confirm matching the Delete pattern — "Publish to the paper now? It goes live immediately and is corrected, never edited." with Publish / Not yet.

---

### [QA-015] — Minor — Flow — A never-drafted lead shows "This draft was written before notes were kept"

**Evidence**

1. File a brand-new lead and open it at `/desk/story/1`. It has no draft and has never been drafted.
2. Under **REPORTING NOTES** the page reads: *"This draft was written before notes were kept. Redraft fills them; lines you add stay."* (`qa-evidence/story-01.png`)
3. The message persists across the failed draft attempts and after reload.

The empty state is a legacy-migration message being used as the general "no notes" case. It tells the editor a draft exists when none does, and implies a history the record does not have — on a product whose credibility rests on the desk describing its own state accurately.

**Fix path:** branch the empty state on whether a draft row exists. With no draft: "No reporting notes yet — they fill in when the desk drafts, and anything you add here stays."

---

### [QA-016] — Minor — Flow — The Add-source form accepts URLs the fetcher will always refuse

**Evidence**

1. On `/desk/sources`, add `http://127.0.0.1.nip.io:3400/desk`. It is **accepted** into the watch list (`qa-evidence/ssrf-02-rebind.png`). `nslookup 127.0.0.1.nip.io` → `127.0.0.1`.
2. Earlier, a stray probe added `https://probe/` — a hostname with no dot and no TLD — which also sits in the `sources` table as `accepted`.
3. Add-time validation is `assertHttpUrl` (`src/lib/news/url-guard.ts:53`), which blocks IP *literals* and `localhost`/`.local`/`.internal` names but does no DNS resolution. Fetch-time validation (`src/lib/news/fetch-url.ts`) resolves the host, rejects private addresses, and pins the approved address through a guarded `dns.lookup` on the connect path.

**This is not an SSRF hole** — I want to be explicit, because it looks like one. The fetch path is correctly defended and a rebinding name will be rejected when the scanner actually tries to read it. The defect is that the two guards disagree, so junk and unfetchable entries land on the watch list and fail later, quietly, as source-health noise; and the operator gets no feedback at the moment they could still fix the URL.

**Fix path:** run the fetch-path guard (resolve + private-range check) at add time as well, and reject with the reason inline. Also reject hostnames with no dot.

---

### [QA-017] — Minor — SEO — Sitemap `lastmod` and feed `pubDate` are a day ahead of the paper's own dateline

**Evidence**

1. A story published on the evening of Aug 29 local time (MDT) renders on the paper as `COUNCIL · SATURDAY, AUGUST 29, 2026`, and the masthead reads `SATURDAY, AUGUST 29, 2026`.
2. The same story in `/sitemap.xml`: `<lastmod>2026-08-30</lastmod>`.
3. The same story in `/feed`: `<pubDate>Sun, 30 Aug 2026 00:52:45 GMT</pubDate>`.

`pubDate` in GMT is formally correct RSS. `lastmod` as a bare `2026-08-30` is not — it is a date with no zone, and it disagrees with the date the paper prints. For a local civic newspaper, "which day did the council vote get reported" is load-bearing: readers, aggregators and archives will see one date, the page will show another, and anything sorting by feed date will place evening stories on the following day.

**Fix path:** derive `lastmod` (and the sitemap's date grouping generally) in the paper's configured local timezone, so it matches the dateline the article renders. Keep `pubDate` in RFC-822 with a real offset (`-0600`) rather than GMT, so clients render the local day.

---

### [QA-018] — Minor — Auth — A signed-in user who is not the editor gets a dead-end panel with no form

**Evidence**

1. After the ownership transfer in QA-001, sign in as the original owner. Authentication **succeeds** (session cookie issued, `/desk` reached).
2. The page renders: `EDITOR DESK` / *"Editor sign-in — This desk already has an editor. Sign in if that's you. Anyone can read the paper without an account."* / `Back to the paper` / `Sign out`. (`qa-evidence/leave-06-original-desk.png`)
3. There is no email field, no password field, and no submit — the user is being asked to sign in while already signed in, with no way to comply.
4. Related: a second browser tab left open on `/desk/queue` continued rendering desk chrome (nav, "Leave as editor", the user's initial) after ownership changed in the first tab, until it was reloaded.

**Fix path:** detect "authenticated but not a member" as its own state and say so: "You're signed in as qa-auditor@example.com, but this desk belongs to another editor." with `Sign out` and `Read the paper`. On the multi-tab case, invalidate the desk-claim query on window focus so a stale tab corrects itself.

---

### [QA-019] — Minor — Console — The Scan block notice stacks a second, developer-flavoured line that contradicts the first

**Evidence**

Clicking `Run scan` with no provider renders two stacked messages:

> **The desk cannot scan yet.**
> No model is set up yet. Either sign in to Claude Code on this machine, or set ANTHROPIC_API_KEY, or point LLM_BASE_URL at any OpenAI-compatible endpoint — a local model counts. See docs/setup.md. Nothing is spent until one of those answers.
> *AI is not available. Set ANTHROPIC_API_KEY for Claude (default), or XAI_API_KEY for Grok, or LLM_BASE_URL for any OpenAI-compatible gateway (LiteLLM, Bifrost, Helicone, MLflow, Kong, Ollama).*

The second line is `blocked.detail` (`src/routes/desk.scan.tsx:112-119`), styled as meta but shown at full length. It restates the first, drops the "sign in to Claude Code" option the first line leads with, and adds `XAI_API_KEY` plus five gateway product names to a message aimed at a non-technical journalist. The two together read as if the desk is uncertain what it needs.

The refusal itself is correct and fast, which is why this is Minor — it is the last 10% of an otherwise well-executed error state.

**Fix path:** collapse `detail` behind a "Technical details" disclosure, or drop it here entirely (it is already recorded in `desk_jobs.error` for diagnosis).

---

### [QA-020] — Minor — API — `/evidence/:id` returns 200 for captures that do not exist

**Evidence**

1. `GET /evidence/999999` → **200**, rendering "That capture is not in this edition."
2. `GET /evidence/compare` with nothing to compare → **200**, rendering "Nothing to compare."
3. For contrast, `/articles/does-not-exist` correctly returns **404**, and `/nope` returns **404** — so the app knows how to do this and does it right elsewhere.

Soft-404s let crawlers index unlimited nonexistent evidence URLs and make link-checking tools report a healthy site with dead links. The copy on both pages is good; only the status code is wrong.

**Fix path:** return 404 from the evidence route's loader when the capture is absent, keeping the same rendered page — as `articles.$slug.tsx` already does.

---

### [QA-021] — Minor — SEO — Article pages carry no structured data

**Evidence**

`curl -s http://127.0.0.1:3400/articles/welcome-to-townreporter | grep 'application/ld+json'` → no match. The pages have good `og:` and `twitter:` tags and a `description`, but no `NewsArticle` / `Organization` JSON-LD: no `datePublished`, no `dateModified`, no publisher, no `correction` linkage.

For a news product this is the machine-readable layer that Google News, Top Stories and most aggregators read. It also happens to be where a `correction` relationship could be expressed formally, which fits this paper's stated values better than most.

**Fix path:** emit a `NewsArticle` JSON-LD block on `/articles/:slug` with `headline`, `datePublished`, `dateModified`, `articleSection` (the topic), `publisher`, `mainEntityOfPage` and, where corrections exist, `correction`. Emit `NewsMediaOrganization` on the front page. Coordinate the URL fields with QA-004's origin fix.

---

### [QA-022] — Minor — Performance — The PGLite WebAssembly runtime ships in the public asset bundle on a Postgres deployment

**Evidence**

`.output/public/assets` totals **17 MB**, and the three largest files are `pglite-*.wasm`, `pglite-*.data` and `initdb-*.wasm`. The front page itself loads only 814 KB across 25 requests, so these are not fetched by readers — but they are built, copied and served by every self-hosted install, including the documented `DATABASE_URL` (Postgres) one where the PGLite fallback can never be used.

**Fix path:** make the PGLite import conditional on the absence of `DATABASE_URL` at build time, or move it behind a dynamic import excluded from the client build when a database is configured. This also shrinks the release zip a self-hoster downloads.

---

### [QA-023] — Nit — Auth — Session cookies are named `__Host-grok-auth.*`

The three session cookies a self-hosted TownReporter sets are `__Host-grok-auth.session_token`, `__Host-grok-auth.session_data`, `__Host-grok-auth.account_data` (`src/lib/auth/server.ts:266-270`). Harmless, and the `__Host-` prefix is the right call — but any operator who opens dev-tools sees another product's name in their own paper's cookies. Worth renaming to `__Host-townreporter.*` at the next release that can tolerate invalidating sessions.

---

### [QA-024] — Nit — SEO — `/login` uses the generic site title

`<title>` on `/login` is `TownReporter — Longmont, Colorado`, identical to the front page, while `/about`, `/how-we-report` and `/corrections` all have specific titles. Minor tab-and-history ambiguity. Suggest `Editor sign-in — TownReporter`.

---

### [QA-025] — Nit — Flow — An unreproducible `/desk/queue` → `/desk` drift, recorded for completeness

Early in the audit, two separate navigations to `/desk/queue` ended on `/desk` (the command center) after load. I could not reproduce it: 12 fresh-context navigations across `/desk/queue`, `/desk/sources`, `/desk/scan` and `/desk/published` all stayed put, and 5 repeats of the exact original script all stayed put. Both original occurrences were within the first minutes after the desk was claimed, so a first-bootstrap redirect is a plausible explanation, but I have not demonstrated it.

I am recording this as an observation, not a finding: I saw it twice and could not make it happen again, and the honest statement is that I do not know what it was. If the team knows of a bootstrap-time redirect on the desk index, this is probably it; if not, it is worth a look at `desk.index.tsx:43-91` where a `navigate({ to: "/desk/dark" })` fires conditionally.

---

## Performance snapshot

| Metric | Observed | Benchmark | Verdict |
|---|---|---|---|
| TTFB (`/`) | 179 ms | <600 ms | pass |
| FCP (first contentful paint) | 296 ms | <1.8 s | pass |
| LCP | not captured — the observer returned no entry on this text-first page | <2.5 s | unmeasured |
| CLS | 0.014 | <0.1 | pass |
| INP | not measured (no scripted interaction timing) | <200 ms | unmeasured |
| `load` event | 348 ms | — | pass |
| Origin latency p50 — `/` | 5.6 ms | — | pass |
| Origin latency p50 — `/articles/:slug` | 5.6 ms | — | pass |
| Origin latency p50 — `/feed` | 2.7 ms | — | pass |
| Origin latency p50 — `/sitemap.xml` | 2.5 ms | — | pass |
| Front-page transfer | 814 KB over 25 requests (516 KB JS, 237 KB woff2, 80 KB CSS) | <1 MB | pass |
| Built public assets on disk | 17 MB (PGLite wasm/data dominant) | — | see QA-022 |
| Cold first request after idle | 17.8 s | — | first-hit only; every subsequent request was single-digit ms |

Two notes. The 17.8 s figure is the very first request I made to the process and never recurred; I did not isolate whether it is JIT warm-up, a lazy database connection, or process start, so I am reporting it rather than diagnosing it. And 516 KB of JavaScript on the reader-facing front page is on the heavy side for a text newspaper — not a finding at this size, but the number worth watching as the desk grows, since the desk and paper share a bundle graph.

## Security / privacy snapshot

**Held up under testing**
- Unauthenticated and cross-site scripted access to server functions: rejected (403).
- Desk claim-once: a second identity is refused while the desk is owned.
- Sign-out revokes the session server-side.
- Session cookies: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
- XSS: script payloads in lead headline/dek round-tripped as inert escaped text through desk, story, public article and sitemap.
- SSRF at the fetch layer: DNS-resolving, private-range-rejecting, rebinding-resistant via a guarded connect lookup, manual redirect handling with a hop budget.
- Path traversal, null bytes and oversized slugs: 404, no 500.
- The cron route fails closed when `CRON_SECRET` is unset (503, on the method it implements).
- The ops action surface is a hard-coded allow-list with no free-text parameter reaching a shell.

**Open**
- **QA-003** — unlimited sign-in attempts, no throttle or lockout, on an internet-exposed desk with an 8-character password floor.
- **QA-001** — a two-click header control transfers the newsroom (and machine-level ops actions) to any anonymous visitor, irreversibly.
- **QA-008** — no CSP, no `nosniff`, no `Referrer-Policy`, no frame-ancestors policy, no HSTS; no `no-store` on `/desk` or `/login`.
- **QA-012** — `Secure`-only cookies against a default that binds every network interface over plain HTTP.
- **QA-013** — the "Reader privacy — no outside requests" verdict was computed from a third party's HTML, and the instance made repeated unsolicited outbound requests to a domain it does not serve.

## Console and log observations

Browser console health is excellent and I want to be specific about the coverage, because a clean console is often a clean *sample*. Across 8 desk pages at 375 px and 1440 px, 5 public pages at 375/768/1440 px, and 4 pages in each of Chromium, Firefox and WebKit — plus the scan, draft, publish, correction, delete-confirm, Dark Desk and sign-out flows — I recorded **zero console errors, zero uncaught page errors, and zero unexpected 4xx/5xx responses**. The only console error in the entire audit was the deliberate `/nope` 404 probe. No React key warnings, no hydration mismatches, no deprecation notices.

Server-side, the picture is the inverse and is the subject of QA-002 and QA-006: the app records failures faithfully in `desk_jobs.error` and `dark_runs.error` and then does not read them back. Three failed draft jobs and one model-starved Dark Desk run were all invisible on the pages that caused them after a reload. The Server page's Work Queue row deserves credit here — it *did* update to `0 running · 0 queued · 3 failed · CHECK` — so one surface tells the truth. The desk command center, which is where the editor actually lives, does not.

## Patterns and systemic observations

**Pattern 1 — Failures are recorded but not surfaced (QA-002, QA-006, QA-011; QA-013 is the mirror image).** Three findings share one root: the application knows exactly what went wrong, writes it to the right place, and then renders a page that does not read it. The draft failure lives in `desk_jobs.error`, the Dark Desk failure in `dark_runs.error`, the auth failure in a typed error with a `status` property — and in each case the surface the user sees shows either nothing or something reassuring. QA-013 is the same defect pointed the other way: a check that reports OK about a subject it did not measure. For a product whose entire editorial premise is "show your work", this is the most important pattern in the audit, and it is cheap to fix — the data already exists. **Recommendation: one coordinated change that (a) makes every job-launching page read the latest job's terminal state on load, and (b) makes every health row state what it measured, not just its verdict.**

**Pattern 2 — Preflight is implemented twice and missing twice (QA-002, QA-006 vs. the Scan and Opinion credits).** `scanPreflight` exists, works, and was clearly written in response to a previous audit's Blocker — the comment at `src/lib/news/desk.ts:340` says so. Opinion independently does the right thing by disabling its button. But Draft and Dark Desk, the two longest and most expensive paths, never call it. The fix is not design work; it is applying an existing, tested function at two more call sites. **Recommendation: make provider preflight a shared middleware on every server function that will reach the model, so a new AI-touching feature cannot ship without it.**

**Pattern 3 — "What is this paper's address?" is answered four different ways (QA-004, QA-005, QA-013, and correctly in QA's feed/sitemap credit).** `siteUrl()` falls back to `BETTER_AUTH_URL`; `feed.ts` prefers proxy headers; `sitemap.xml` follows the feed; `robots.txt` is a hardcoded literal; the ops health checks reuse the `siteUrl` fallback. On this instance those four produced two different answers simultaneously — `http://127.0.0.1:3400` in the feed and sitemap, `https://townreporter.org` in canonical, og and the health dashboard. **Recommendation: one `publicOrigin(request)` helper, one env var (`PUBLIC_SITE_URL`), request-origin fallback, and a Server-page row that shows the resolved value so an operator can see it. That single change closes QA-004, QA-005 and QA-013.**

**Pattern 4 — Guardrails are excellent where they exist and absent where they matter most (QA-001, QA-014 vs. the Delete and ops-action credits).** The Delete confirmation is one of the best-written destructive-action dialogs I have read this year, and the ops action list refuses to let a caller near a shell. Yet the two actions with the largest blast radius in the product — publishing to a public newspaper, and handing the newsroom to a stranger — have, respectively, no confirmation and a one-line inline one. The team clearly knows how to do this; the guardrails are just distributed by how dangerous each action *feels* rather than how dangerous it *is*. **Recommendation: rank every mutating action by reversibility and require confirmation strength to match, with re-authentication reserved for the irreversible ones.**

**A note on the shape of this report.** The distribution — 0 Blockers, 4 Criticals, and a public front end I could not break with a browser — reflects what I actually found. The reader-facing paper is well built and I tested it hard. Every Critical lives on the operator's side of the sign-in, in the seam between "the desk did something" and "the desk told the truth about what it did." That is a narrower and more fixable problem than the count suggests.

## Appendix: environments and artifacts

**Environment**

| Item | Value |
|---|---|
| Instance | `http://127.0.0.1:3400`, built production bundle, loopback-bound |
| Version | TownReporter 0.5.1 (rendered in the paper footer and on `/desk/ops`) |
| Runtime | Node 25.9.0, Windows 11 Pro 10.0.26200 |
| Database | PostgreSQL on `127.0.0.1:5433`, db `townreporter_audit_qa`, 18/18 migrations applied, 11 MB |
| Model provider | none (`TOWNREPORTER_CLAUDE_CODE=0`, no API key, no gateway) |
| Public origin resolution | `PUBLIC_SITE_URL` unset; `BETTER_AUTH_URL=https://townreporter.org` |
| Desk state at start | unclaimed; claimed during the audit by `qa-auditor@example.com` |
| Desk state at end | owned by `stranger@example.com` as a result of the QA-001 takeover test; original account is locked out. The instance is left in this state deliberately as evidence — restore with `delete from newsroom_members;` then re-claim at `/login`. |

**Tools**

Playwright 1.62.1 (Chromium headless-shell 1234, Firefox, WebKit), curl 8.21.0, psql 5433, `node --test` not run (that is the Test Engineer's scope).

**Browsers and viewports covered**

Chromium at 375×812, 768×1024, 1280×800, 1440×900; Firefox at 1280×800; WebKit at 1280×800.

**Evidence directory:** `C:\Users\scott\Desktop\Code\townreporter-dev\artifacts\audit-townreporter-2026-08-29\qa-evidence\` — 131 files.

| Artifact | What it shows |
|---|---|
| `_scripts/qa1.mjs` … `qa40.mjs`, `relogin.mjs` | Every Playwright run in this audit, re-runnable |
| `http-sweep-1.txt` | Status/latency/size for 11 routes |
| `home.html`, `article.html`, `pub-article.html`, `article-head.txt` | Raw SSR HTML and extracted head tags — evidence for QA-004 |
| `corrections-ssr.html` | The 636-character SSR body — evidence for QA-009 |
| `feed.xml`, `sitemap.xml`, `feed-headers.txt`, `sitemap-headers.txt` | Feed/sitemap content and cache headers — QA-005, QA-017 |
| `serverfn-unauth.txt` | 403/500 responses to unauthenticated server-function calls — QA-011 |
| `scan-run.txt` | The no-provider scan refusal timeline (credit + QA-019) |
| `desk-walk.txt`, `after-failures.txt` | Full desk page text before and after the failed jobs — QA-013 |
| `dark-final.txt`, `dark-01..04*.png` | The 12 empty LinkedIn cards and the "that is normal" panel — QA-002 |
| `story-01..06*.png` | The draft-with-no-provider sequence and its disappearance on reload — QA-006, QA-015 |
| `leave-01..06*.png`, `leave-test.txt` | The full ownership-takeover sequence — QA-001 |
| `second-01..03.png` | A second identity refused while the desk is owned (credit) |
| `signout-10..12.png` | Sign-out and back-button behaviour (credit) |
| `publish-01..02.png`, `corr-01..07*.png`, `delete-01..02.png` | The editorial round trip and the confirmation dialogs (credit + QA-014) |
| `ssrf-01.png`, `ssrf-02-rebind.png` | Source-add rejection set and the accepted rebinding name — QA-016 |
| `xb-{chromium,firefox,webkit}-*.png` | Cross-browser parity (credit) |
| `vp-{mobile-375,tablet-768,desktop-1440}-*.png`, `desk-{mobile-375,1440}_*.png` | Responsive coverage, 13 combinations (credit) |

**Not executed, deliberately:** any `ops/*.ps1` that starts, stops or restarts a task or service; any ops dashboard action (`watchdog`, `restart-app`, `restart-tunnel`, `migrate`, `refresh-fonts`, `rotate-logs`); any request to `https://townreporter.org` (the outbound probes recorded in QA-013 were made by the application itself during a normal page load, not by me); anything touching `townreporter-web` or the other auditors' databases; any git operation.
