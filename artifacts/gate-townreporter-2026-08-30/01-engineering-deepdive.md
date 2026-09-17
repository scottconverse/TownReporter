# Engineering Deep-Dive — TownReporter 0.5.1

**Gate date:** 2026-08-30
**Role:** Principal Engineer (architecture, correctness, security, performance, data provenance, dependencies)
**Commit audited:** `609effa` — *"Screens that spin forever, a wall between the desk and the reader, and five fixes finally walked."* (2026-08-30 10:00 -0600)
**Working copy:** my own git worktree at `C:\Users\scott\Desktop\Code\townreporter-dev\.claude\worktrees\wf_191e7625-b76-1`, verified byte-identical (modulo CRLF) to the audit root's working tree before I began.
**Prior round:** `artifacts/audit-townreporter-2026-08-29/01-engineering-deepdive.md` (23 findings). I re-checked every one against the current tree rather than assuming any of it still held; the disposition table is below.

---

## TL;DR

The engineering culture here is genuinely unusual: comments record *why* a fix exists, prior audit finding IDs are cited in the code that closed them, and several tests were upgraded from "the identifier is still in the file" to "evaluate the actual guard expression." Nine of the previous round's twenty-three findings are properly fixed, including the Blocker. 579 unit tests pass, the five Postgres-only integration tests pass on a real server (20/20), `tsc --noEmit` is clean, ESLint is now in CI and reports 0 errors, and `npm audit` finds 0 vulnerabilities across the whole tree.

The top finding is not in the code — it is in the file the README tells a new operator to copy. **`.env.example` ships with `HOST=127.0.0.1` commented out**, and its own comment says so plainly: "HOST defaults to every interface." The README's quick start is `cp .env.example .env`. I booted the built server exactly that way and it bound `0.0.0.0` and `[::]`; `/desk/ops` answered `200` on the LAN address, outside the tunnel entirely. The 0.5.1 changelog leads with *"The server binds `127.0.0.1` when `HOST` says so, and it does"* — the code half is true, the shipped default is not.

That surface then meets the second finding. The new sign-in throttle works — I measured 10 attempts then a wall of `429`s. But it buckets by a **client-supplied** `cf-connecting-ip` header, and rotating that header defeats it completely: **25 wrong passwords, 25 × `403`, zero `429`s.** The code comment asserts a LAN attacker "would be no worse off than before this existed." That is the one claim in this file that the code does not support — before the header was trusted, the limiter bucketed by socket address, which a LAN attacker cannot rotate. Trusting it made the LAN path strictly worse, and the shipped `HOST` default is what puts an attacker on that path.

Performance debt is concentrated in one place and I proved it load-bearing. `ensureDarkSchema()` replays **111 DDL statements** on every Dark Desk RPC. Measured against a real Postgres: **1.79 s of pure no-op DDL per call**, four such calls per page. I memoized it, rebuilt, and re-measured: `/desk/dark` went **1866 ms → 791 ms**, slowest RPC **1382 ms → 191 ms**. Then I reverted the patch. The working tree is clean.

## Severity roll-up (engineering)

| Severity | Count |
|---|---|
| Blocker | 1 |
| Critical | 2 |
| Major | 6 |
| Minor | 8 |
| Nit | 3 |
| **Total** | **20** |

---

## Environment attestation (this lane)

My lane is code and runtime behaviour, not onboarding. **First-run coverage for this lane: N/A by delegation** — the walkthrough lane owns the true first-run state, and I built on its 2026-08-29 attestation rather than redoing it. What follows attests the environment my *measurements* were taken in, because every performance and security number below depends on it.

| What | State used | How it was VERIFIED — not assumed |
|---|---|---|
| Source under test | commit `609effa`, own worktree | `git reset --hard refs/heads/main`; then a file-by-file content diff (CRLF-normalized) against the audit root's working tree returned **0 real differences**. My worktree had silently started two commits stale; I caught it because `migrations/0017` and `0018` were named by the prior report but absent from my checkout. |
| Node / npm | v25.9.0 / 11.12.1 | `node -v`, `npm -v` |
| Dependencies | `npm ci` from the committed lockfile, exit 0 | `eng-evidence-unit-tests.log` |
| Database | **own scratch DBs** `townreporter_gate_eng`, `townreporter_gate_eng2` on 127.0.0.1:5433 | created with `CREATE DATABASE`, migrated with the product's own `scripts/migrate.mjs` (18/18 applied), **both dropped at the end** (`DROP DATABASE` × 2 confirmed). The five protected databases were never connected to. |
| Ports | 3810, 3811, 3812 (from my assigned 3810–3829) | `netstat -ano` before and after; all three processes confirmed terminated by PID |
| Model provider | ABSENT — `TOWNREPORTER_CLAUDE_CODE=0` on every server I booted | no billed model call was made in this lane |
| Source mutation | one temporary probe in `src/lib/news/investigate.ts`, reverted | `git status --porcelain` returns **empty** at the end of this run |

**Evidence artifacts on disk, alongside this report:**
- `eng-evidence-unit-tests.log` — the full 579-test run (`npm test`), exit 0
- `eng-evidence-postgres-integration.log` — the five Postgres-only integration files against a real server, 20/20 pass, exit 0

Numbers I did **not** produce are labelled as such in the findings. Nothing below is reasoned-from-code and reported as measured.

---

## What's working

Specific, and earned by reading or running it.

- **The reader-privacy Blocker was closed the right way, and the replacement is real behaviour.** The previous round's Blocker was six regexes carrying literal `0x08` bytes, so the "no outside requests" row could never fire. Rather than patch the regex, the row was **deleted**, with a 20-line comment in `src/lib/ops/health.server.ts:281-300` explaining that even a working version only saw hard-coded tags and was blind to a tracker injected by JavaScript. The check that replaced it — `checkReaderPrivacy()` in `scripts/smoke-built-server.mjs:118-138` — loads the front page in a real Chromium, listens on `page.on("request")`, and fails on any cross-origin host. That is a behavioural check, and it runs in **two** CI jobs. A repo-wide control-character sweep (`scripts/no-control-characters.test.mjs`) now guards the class; I re-ran the sweep myself across `*.ts/tsx/mjs/sql/md` and found none.
- **ESLint is in CI and the tree is clean of errors.** `.github/workflows/ci.yml` runs `npm run lint`, with a comment naming the exact defect it would have caught. `npx eslint .` reports **0 errors, 13 warnings** against a ceiling of 40.
- **CI grew from 3 jobs to 8, and every new one exists because something got past the old pipeline.** There is now a built-server smoke, a *dev-mode* browser smoke (which catches client externalization that a production build silently tolerates), a real-Postgres job for the three properties PGLite cannot express, a desk-flows walk, a delete/corrections walk, and a "a source on a lead reaches the reader" walk. `scripts/postgres-tests-are-covered.test.mjs` fails the build if a file capable of skipping into that job is dropped from its list — a guard against the skip becoming dishonest.
- **The sign-in throttle is real, on by default, and I measured it.** 25 wrong passwords from one bucket: `403` ×10 then `429` ×15. The reasoning in `src/lib/auth/server.ts:235-258` is correct about *why* it could not be left to `NODE_ENV` (a Windows scheduled task sets none). Its weakness is the bucket key, not the mechanism — see ENG-102.
- **Signup closes behind the first account, enforced at the database hook.** `databaseHooks.user.create.before` (`server.ts:274-288`) throws once `deskIsClaimed()`, so a stranger cannot mint an account on a claimed desk through *any* route — OAuth or email. The setup token was removed rather than hardened, and the reasoning (`membership.ts:1-19`) is sound: there is no secret to guess.
- **Giving up the desk now requires typing your own address back.** `leaveEditor` (`claim.ts:80-106`) compares the typed string to the signed-in account's email server-side and refuses otherwise. The docstring is honest that moving the button was the cosmetic half and the RPC check is the load-bearing one.
- **Authorization still has one chokepoint.** I enumerated all 70 `createServerFn` declarations mechanically. Eleven lack `.middleware()`; ten are the deliberately public paper/evidence reads and one is `deskClaimState`, which returns only `{claimed, tokenRequired:false}`. Every desk function goes through `deskMiddleware` → `assertSameSiteRequest` → `requireUserId` → `requireEditor`.
- **Public evidence is gated by publication, not obscurity.** `listPublicCaptureHistory` and `loadVersion` (`evidence.ts:258-260`, `297-298`) both refuse any URL absent from `publishedSourceUrls()`. There is now also a running-server test (`public-surfaces.no-leak.test.ts`) that walks eight public surfaces — front page, article, topic, search, corrections *after hydration*, RSS, sitemap, robots — asserting no editor-only field reaches a reader. All eight passed on my run.
- **The ops action surface is a genuine allowlist.** Six literal ids in `actions.ts`, each mapped in `actions.server.ts` to a fixed executable plus a fixed argument array. No caller input reaches a command line. `runOpsAction` validates against the allowlist *before* anything else touches the value, then rate-limits, then audits.
- **Concurrency was fixed at the database.** `enqueueJob` (`jobs.ts:138-193`) documents that check-then-act is an optimisation, not the guarantee, and leans on the partial unique index in `0017_one_open_job.sql` with `on conflict do nothing`. The claim-token heartbeat in `executeJob` closes the double-run window that the stale-reclaim guard opened.
- **Migration can no longer destroy data, and a test holds that shut.** `maybeFactoryReset` is gone from `scripts/migrate.mjs`, with the incident written into the comment at lines 77-92 (an ordinary `npm run build` ends in `db:migrate`, and it could have `TRUNCATE`d a restored backup). `scripts/no-destructive-migrate.test.mjs` fails the build if a destructive statement returns.
- **Some tests were upgraded from string-matching to evaluation.** `scripts/newsroom-security.test.mjs` now bracket-extracts the `shouldCommitFetchHashes` guard out of `desk.ts` and *evaluates the real expression* with the real imported predicate, with a comment explaining that the old identifier match stayed green when the guard was neutered to `false && ...`. That is the correct response to the failure mode this project has been burned by.
- **The search is index-backed and the claim is re-measured, not asserted.** Migration `0018` adds GIN trigram indexes; `scripts/search-index-proof.mjs` re-runs a 20,000-story benchmark from scratch in CI and fails if the index does not help. `SEARCH_MIN_INDEXED = 3` correctly refuses to sweep bodies for a query too short for a trigram.
- **Dependencies are clean.** `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities**. `tsc --noEmit`: no output.

---

## Disposition of the 2026-08-29 findings

Checked individually against `609effa`, not assumed.

| Prior | Status now |
|---|---|
| ENG-001 Blocker (dead privacy regex) | **Fixed** — row removed, browser check added, control-char sweep added |
| ENG-002 Critical (sign-in redirect timer) | **Fixed** — no `<h1>` string-match timer remains in `desk.tsx` |
| ENG-003 Critical (`NEWSROOM_SETUP_TOKEN` in docs, gone from code) | **Fixed** — mechanism and docs both removed |
| ENG-004 Major (`leaveAsEditor` deletes all members) | **Open, downgraded** → ENG-112 (latent: nothing creates a second member today) |
| ENG-005 Major (double schema, DDL per request) | **Open, now measured** → ENG-104 |
| ENG-006 Major (serial drainer) | **Open** → ENG-105 |
| ENG-007 Major (no security headers) | **Open, now measured on the built server** → ENG-103 |
| ENG-008 Major (Grok scaffolding) | **Mostly fixed** — `.grok/` reduced, P2P/connector code gone; the baked preview OAuth secret remains (ENG-119) |
| ENG-009 Major (16 MB PGLite in public assets) | **Open, now measured and confirmed unreferenced** → ENG-108 |
| ENG-010 Major (no body size cap) | **Partly fixed** — `body-limit.ts` exists with real tests, wired into one path → ENG-114 |
| ENG-011 Major (whole log files into memory) | Not re-verified this round — see "What couldn't be assessed" |
| ENG-012 Major (ESLint red, absent from CI) | **Fixed** — `npm run lint` in CI, 0 errors |
| ENG-013 Major (prompt trust boundary) | **Open, re-framed** → ENG-107 |
| ENG-014 Major (evidence full-scan) | **Open, now measured** → ENG-111 (honestly downgraded to Minor) |
| ENG-015 Minor (no compression) | **Open, confirmed on the wire** → ENG-110 |
| ENG-016 Minor (`desk_rate`/`audit_events` unbounded) | Not re-verified this round |
| ENG-017 Minor (ops layer Windows-only, no CI) | **Open** — `scripts/ops-scripts.test.mjs` is source-text only; CI is still Linux-only |
| ENG-018 Minor (`CRON_SECRET` non-constant-time) | **Open** → ENG-117 |
| ENG-019 Minor (unbounded child output) | Not re-verified this round |
| ENG-020 Minor (list queries select full bodies) | **Open** — `public.ts:38` still selects `body` for a 30-row list |
| ENG-021 Minor (package named `app-builder-workspace`) | **Open** → ENG-119 |
| ENG-022 Nit (unused imports) | **Open** — 13 lint warnings, 9 of them unused vars |
| ENG-023 Nit (no TLS config on the pool) | **Open** — `new Pool({ connectionString })`, `db.ts:115`, no `ssl`, no `max`, no `statement_timeout` |

---

## Findings

> **ID prefix:** `ENG-1xx` (new numbering, so a reader can never confuse these with the 2026-08-29 set)
> **Categories:** Architecture / Correctness / Security / Performance / Data provenance / Dependencies / Hygiene

---

### [ENG-101] — Blocker — Security — The shipped `.env.example` leaves the app on every interface, and the documented quick start copies it verbatim

**Evidence**

`.env.example:83-91`:

```
# ── Where it listens ─────────────────────────────────────────────────────────
# PORT defaults to 3000. HOST defaults to every interface, which means the app
# also answers on your local network. Set HOST when something else fronts it
# (a Cloudflare Tunnel, a reverse proxy) so that is the only way in.
...
# PORT=3000
# HOST=127.0.0.1
```

`HOST` is **commented out**. `README.md:54` and `docs/setup.md:63` both give the quick start as:

```
cp .env.example .env
```

Reproduction, on the real built server (`.output` from `npm run build` at `609effa`), against my own scratch database:

1. `PORT=3812 BETTER_AUTH_SECRET=… DATABASE_URL=… node .output/server/index.mjs` — i.e. every variable the shipped example sets, and **no `HOST`**, exactly as a `cp`-ed `.env` produces.
2. `netstat -ano | grep :3812`

   ```
   TCP    0.0.0.0:3812      0.0.0.0:0    LISTENING    39436
   TCP    [::]:3812         [::]:0       LISTENING    39436
   ```
3. From the machine's LAN address:

   ```
   LAN IP: 192.168.0.135
   LAN /login    -> HTTP 200
   LAN /desk/ops -> HTTP 200
   ```

Observed: the editor's desk, including the Server page whose buttons restart the machine, answers on the local network. Expected, per the release notes: the tunnel is the only way in.

`CHANGELOG.md:31-35` states: *"The server binds `127.0.0.1` when `HOST` says so, and it does. Without it the app answered on every interface, so anything fronting it — a tunnel, a proxy — was not the only way in. Measured after the change: `netstat` shows loopback and nothing else."* The measurement was taken on a machine whose `.env` already had `HOST` set. The code honours `HOST`; the artefact a new operator is told to copy does not set it.

**Why this matters**

This is the exact defect the release claims to have closed, surviving in the one file a new self-hoster is instructed to copy. The intended operator is a non-technical journalist who will follow the README literally. On her home Wi-Fi — or a café, or a shared office — every device on the segment can reach `/login` and `/desk/ops` without ever touching the Cloudflare Tunnel, and therefore without any of the protections the tunnel is assumed to provide.

On its own that is "an authenticated admin surface exposed to the LAN." Chained with **ENG-102** it becomes unlimited password guessing against a single account that has no password reset and no lockout, on a box the winner can then restart at will. That chain is why this is a Blocker and not a Critical: the two defects are individually arguable and jointly a path from "someone joined the Wi-Fi" to "someone owns the newsroom."

**Blast radius**
- *Adjacent code:* none — the server honours `HOST` correctly. This is entirely a shipped-default and documentation defect.
- *User-facing:* an operator who already set `HOST` in her live `.env` is unaffected. I could not read the live `.env` (out of bounds), so I cannot say whether the running paper is exposed — only that the shipped default is. **This must be checked on the live box as step zero.**
- *Migration:* none.
- *Tests to update:* none exist that assert the shipped default. A test that reads `.env.example`, applies it, boots, and asserts the listen address is the right shape — cheap, and it is the class of check `scripts/first-run-paths.test.mjs` already establishes a precedent for.
- *Cross-role:* the Technical Writer should treat `CHANGELOG.md:31` as an unsupported claim until this lands; QA should re-walk the quick start on a clean box.

**Fix path**

1. Uncomment `HOST=127.0.0.1` in `.env.example` and invert the comment: loopback is the default, and you *remove* the line only if you deliberately want LAN access. A self-hosted appliance behind a tunnel should fail safe.
2. Better: make the *code* default to `127.0.0.1` and require an explicit `HOST=0.0.0.0` to widen it. A commented-out line in an example file is not a security control.
3. Log the resolved bind address at boot, at warn level when it is not loopback — the operator has no other way to notice.
4. Add the boot-and-assert-listen-address test above to the `smoke-built` CI job.
5. Verify the live deployment's `.env` before anything else.

---

### [ENG-102] — Critical — Security — The sign-in throttle buckets by a client-supplied header, and rotating it defeats the throttle entirely

**Evidence**

`src/lib/auth/server.ts:316-318`:

```ts
ipAddress: {
  ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
},
```

Better Auth's rate limiter keys on the address resolved from those headers. Reproduction against the built server (same run as ENG-101), on an account that exists, with 25 wrong passwords each time:

| Run | Headers sent | Status codes |
|---|---|---|
| A | none | `403` ×10, then `429` ×15 |
| B | `cf-connecting-ip: 203.0.113.<i>`, incremented per request | **`403` ×25, `429` ×0** |

Raw sequence for B:

```
403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403 403
```

Observed: an attacker who can set one header gets unlimited guesses. Expected: 10 per five minutes, as `customRules["/sign-in/email"] = { window: 300, max: 10 }` intends.

The code comment at `server.ts:298-315` addresses this and gets it wrong:

> *"`cf-connecting-ip` is set by Cloudflare's edge and cannot be forged by a visitor coming through the tunnel; `x-forwarded-for` is the fallback for any other front end. **Something on the same LAN hitting the port directly could spoof either, and would be no worse off than before this existed.**"*

The last clause is false. Before the header was trusted, the limiter bucketed by the socket peer address, which a LAN attacker **cannot** rotate — they would have hit the same 10-per-5-minutes wall as run A. Trusting a client-supplied header made the direct-connection path strictly worse than the default it replaced. The first half of the comment is correct: through the real Cloudflare Tunnel, the edge overwrites `cf-connecting-ip`, so an internet attacker is still bucketed. It is the *direct* path that is open — and ENG-101 is what puts an attacker on it.

**Why this matters**

The desk is a single account, with no password reset and no lockout, that carries controls to restart services on the journalist's own machine. The throttle is the only thing standing between a LAN attacker and an offline-speed dictionary attack. It looks present, it tests present (`sign-in-throttle.test.ts` passes, and it is a real running-server test — but it never sends a rotating header), and it is not present for the caller who matters.

This also applies to any deployment fronted by something other than Cloudflare: the second entry, `x-forwarded-for`, is trusted from any client that reaches the port, and `docs/setup.md` contemplates reverse proxies.

**Blast radius**
- *Adjacent code:* the same resolved address is used for Better Auth's global 200/60s limit, so that ceiling is bypassable by the same trick.
- *Shared state:* rate-limit storage is in-memory (documented honestly at `server.ts:255-257`); a restart clears it, which compounds but is not the cause here.
- *User-facing:* none until exploited.
- *Migration:* none.
- *Tests to update:* `src/lib/auth/sign-in-throttle.test.ts` — add run B above. It already spawns a real server against a real Postgres, so the test is ~10 lines. This is precisely the test that would have caught it, and its absence is the coverage gap: it asserts the throttle fires, never that it cannot be stepped around.
- *Related:* ENG-101 supplies the reachable path.

**Fix path**

1. Only trust forwarding headers when the request arrives from a known front end. Gate on the socket peer being loopback (the tunnel case) *and* on an explicit opt-in variable naming the expected front end, e.g. `TRUSTED_PROXY=cloudflare`. Default: trust nothing, bucket by socket address.
2. Prefer `cf-connecting-ip` only; drop `x-forwarded-for` unless the operator opts in, since it is the easier of the two to forge and the least likely to be sanitised.
3. Add the rotating-header case to `sign-in-throttle.test.ts` and assert a `429` appears.
4. Correct the comment at `server.ts:313-315` — it currently tells the next reader that this case is fine.

---

### [ENG-103] — Critical — Security — No security response headers on any route, including the page that can restart the machine

**Evidence**

Measured on the built server, not inferred. `curl -sSD - -o /dev/null http://127.0.0.1:3810/desk/ops`:

```
HTTP/1.1 200
content-type: text/html; charset=utf-8
Date: Sun, 30 Aug 2026 16:18:26 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
```

And as Chromium saw it, from a signed-in session (`response.headers()`):

```json
{"connection":"keep-alive","date":"…","keep-alive":"timeout=5",
 "transfer-encoding":"chunked","content-type":"text/html; charset=utf-8"}
```

Identical on `/`, `/login`, and `/desk/ops`. Absent: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`. A grep of `server/middleware/`, `vite.config.ts` and `scripts/` for any of those names returns nothing — the only `setHeader` calls in the tree set `content-type`, `cache-control` and `content-length`.

**Why this matters**

With no `X-Frame-Options` and no CSP `frame-ancestors`, any page on the internet can iframe `https://<the paper>/desk/ops`. A click inside that frame is same-origin *to the framed document*, so `Sec-Fetch-Site: same-origin` is what the server sees and `assertSameSiteRequest()` (`isolation.server.ts:41`) lets it through. The isolation guard is correct for scripted cross-site requests; it is not a clickjacking defence, and nothing else in the tree is either. The targets are the six ops actions, two of which restart the machine or drop the tunnel. The double-confirm in the UI raises the number of clicks an attacker must farm; it does not change the class.

The missing `Referrer-Policy` also leaks desk URLs — including `/desk/story/<leadId>` and `/evidence/<versionId>` — to any outbound link an editor follows from the desk.

**Blast radius**
- *Adjacent code:* none — this is one middleware that does not exist.
- *Shared state:* a CSP will need care with the inline scripts TanStack Start emits for hydration; start with `frame-ancestors 'none'` plus the cheap headers and add `script-src` behind a nonce afterwards.
- *User-facing:* none, if scoped correctly.
- *Migration:* none.
- *Tests to update:* none exist. `scripts/smoke-built-server.mjs` already boots a real server and inspects responses; asserting the four headers there is a few lines and runs in two CI jobs.
- *Related:* ENG-101 — on a LAN-exposed instance a hostile page on the same network can frame it over plain HTTP too.

**Fix path**

1. Add `server/middleware/security-headers.ts` setting, on every HTML response: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Strict-Transport-Security` when the request arrived over HTTPS.
2. Then a CSP with `frame-ancestors 'none'`, `default-src 'self'`, `img-src 'self' data:`, `font-src 'self'` — the last two are already true, since fonts are self-hosted and the reader makes no outside requests. Ship it `Content-Security-Policy-Report-Only` for one release if you want a soft landing, but `frame-ancestors` should be enforcing from day one.
3. Assert all of them in `scripts/smoke-built-server.mjs`.

---

### [ENG-104] — Major — Performance — Every Dark Desk request replays 111 DDL statements; measured at 1.79 s each, and proven load-bearing

**Evidence**

`ensureDarkSchema()` (`src/lib/news/dark.ts:175-253`) runs 6 inline `create table/index if not exists` statements and then calls `ensureInvestigateSchema()` (`src/lib/news/investigate.ts:426-...`), which splits a 73-statement `SCHEMA_SQL` template and issues each one, then issues 32 more `alter table … add column if not exists`. Every error is swallowed. Nothing is memoized — there is no module-level cache in either file.

`ensureDarkSchema()` is the **first line of 20 desk RPC handlers** (`grep -n "ensureDarkSchema()" src/lib/news/dark.ts` → 20 call sites plus the definition), including `listDarkSignals`, `listDarkRuns`, `listDarkPromises` and `listInvestigations`.

*Measurement 1 — the DDL itself.* I extracted the exact statement list from the product source and replayed it against a migrated scratch Postgres:

```
statements replayed per ensureDarkSchema() call: 111
  dark.ts inline: 6 | investigate.ts SCHEMA_SQL: 73 | alter-table extras: 32
cold (creates the objects): 4310 ms
warm no-op runs (ms): 1472, 1680, 1792, 1826, 1985 | median 1792
```

Every warm run is a complete no-op: every object already exists. The cost is 111 round-trips, paid per RPC.

*Measurement 2 — end to end, in a real browser, signed in.* Built server, real Postgres, Playwright, timing `networkidle`:

```
/desk        1866 ms   slowest RPC 1943 ms
/desk/dark   1866 ms   RPCs 1259 / 1211 / 1152 /  995 ms
/desk/dark   1951 ms   RPCs 1382 / 1348 / 1348 / 1229 ms   (warm — no faster)
/desk/queue   685 ms   no request over 100 ms
/desk/ops    2003 ms   slowest RPC 1427 ms
```

`/desk/queue` is the control: it is the one desk page that does not call `ensureDarkSchema()`, and it is the one page with no slow request.

*Measurement 3 — proving causation.* I added a one-shot promise cache to `ensureInvestigateSchema` (the 105-statement half only; I left the 6 inline `dark.ts` statements alone), rebuilt, and re-ran the identical script against a fresh scratch database:

| Page | before | after | slowest RPC before → after |
|---|---|---|---|
| `/desk/dark` | 1866 ms | **791 ms** | 1259 → **191 ms** |
| `/desk/dark` (warm) | 1951 ms | **755 ms** | 1382 → **177 ms** |
| `/desk` | 1866 ms | 1796 ms | 1943 → **1027 ms** |
| `/desk/ops` | 2003 ms | **1271 ms** | 1427 → **635 ms** |
| `/desk/queue` | 685 ms | 646 ms | (unchanged — control) |

The patch has been reverted; `git status --porcelain` is empty.

**Why this matters**

This is the editor's daily experience: the Dark Desk takes ~1.9 s to settle and the desk landing page ~1.9 s, on a **local** database with an **empty** table set. Every number above is a floor. It is also the only architectural finding with a compounding shape: `pg`'s default pool is 10 connections (`db.ts:115` — `new Pool({ connectionString })`, no `max`), and four concurrent Dark Desk RPCs each hold one for ~1.8 s while doing no work.

The deeper problem is that schema is declared **twice**: 18 migration files that CI applies and verifies, and ~115 inline DDL statements across `src/` that re-run forever and swallow every error. The two can silently disagree, and the swallow means nobody finds out. `migrations/0018_search_index.sql` already produced one first-run outage from exactly this seam (documented in `scripts/first-run-paths.test.mjs`).

**Blast radius**
- *Adjacent code:* the same pattern, smaller, in `ensureNewsroomSchema` (3), `ensureJobsSchema` (2), `ensureEditorialSchema` (2), `ops.ts` (2). The `/desk` page's remaining ~1 s after my partial patch is these plus the 6 un-memoized `dark.ts` statements.
- *Shared state:* memoizing must be per-connection-target, not per-process, or a test that swaps databases mid-process sees a schema that was ensured elsewhere. Key the cache on the resolved `DATABASE_URL`.
- *User-facing:* strictly an improvement.
- *Migration:* the real fix is to move all of it into numbered migrations, which needs one migration that is a no-op on any database where the inline DDL already ran (everything is `if not exists`, so this is straightforward).
- *Tests to update:* none break. Add one that asserts `ensureInvestigateSchema()` issues zero statements on its second call in a process.
- *Related:* ENG-105 (the same pool contention shows up behind the serial drainer).

**Fix path**

1. **Now, cheap:** memoize each `ensure*Schema` with a promise keyed on the resolved database URL. My probe shows this alone is worth ~60 % of Dark Desk page time.
2. **Next:** move the 111 statements into a numbered migration and delete the runtime path. Keep `if not exists` so it is a no-op on existing installs.
3. **Then:** stop swallowing DDL errors. A failed `alter table` today is invisible; it should be loud at boot, once.
4. Set `max` and `statement_timeout` on the pool while you are in `db.ts`.

---

### [ENG-105] — Major — Architecture — One serial in-process drainer, so a 40-minute editorial starves every other job

**Evidence**

`drainQueuedJobs()` (`src/lib/news/jobs.ts:212-243`) is guarded by a module-level `draining` boolean, takes **one** job at a time (`limit 1`), and `await`s `executeJob(next[0])` before looking for the next — up to 8 per drain pass. `kickJobs()` (`jobs.ts:196-200`) schedules the same function. There is exactly one drainer per process, and it is serial.

The Opinion desk's own timeout is measured in tens of minutes: `docs/manual.md` and `CHANGELOG.md:75-79` say an editorial "takes ten to forty minutes", and `editorialTimeoutMs()` backs a per-writer budget. `enqueueJob` is how the desk schedules Scan, Draft and editorial work alike.

Consequence, from the code: while one editorial job is executing, `draining` is `true` and the loop is inside `await executeJob`. A Scan or Draft queued in that window does not start until the editorial returns — up to forty minutes later. Nothing in `desk_jobs` expresses a priority or a class, so there is no way for a short job to jump it.

I did **not** run a 40-minute editorial (no model provider was configured in this lane), so this is a code-reading finding about a control-flow property, not a stopwatch measurement. The property itself — one serial loop, one boolean — is unambiguous in the source.

**Why this matters**

The queue depth is on the Server page, so the operator can see work piling up; nothing tells her *why*, or that the pile is a consequence of the Opinion piece she started rather than a fault. For a one-person newsroom the practical effect is that filing an editorial takes the rest of the desk offline for the afternoon.

**Blast radius**
- *Adjacent code:* `STALE_RUNNING_SECONDS` and the claim-token heartbeat interact with this — the heartbeat exists precisely because long jobs used to be re-claimed and run twice. Any change to concurrency must preserve the heartbeat contract.
- *Shared state:* concurrent jobs will contend for the same `pg` pool; see ENG-104 on pool sizing.
- *User-facing:* the desk should say "waiting on the editorial" rather than "Queued".
- *Migration:* none for a simple lane split; `desk_jobs` would gain a `lane` column for the tidier version.
- *Tests to update:* `src/lib/news/jobs.test.ts` — add a test that a long-running job of one kind does not delay a job of another.
- *Cross-role:* UI/UX should look at what the queue says while it is blocked.

**Fix path**

1. Give the drainer two lanes: `editorial` (concurrency 1, it is expensive and singular) and everything else (concurrency 1–2). A `lane` column on `desk_jobs` plus one `draining` flag per lane is a small change.
2. Until then, at minimum make the queue UI say *why* a job is waiting.
3. `setJobStage` exists and is called; surface the running job's kind next to the queue depth on `/desk/ops`.

---

### [ENG-106] — Major — Data provenance — The thirty-day trash window only expires if somebody opens the Trash list

**Evidence**

`purgeOld()` (`src/lib/news/trash.ts:51-58`) deletes rows older than `TRASH_DAYS`. It has exactly one caller: `listTrash` (`trash.ts:63`), the RPC behind the Trash section of `/desk/ops`. A repository-wide grep for `purgeOld|purge` finds no scheduled task, no cron tick, and no boot-time sweep — `src/lib/news/monitors-cron.ts` ticks monitors and nothing else.

The docstring states the design intent honestly:

> *"Lazy on purpose: called when the list is read, so there is no scheduled task to forget and no way for the purge to run against a database nobody is looking at."*

`CHANGELOG.md` describes the feature as: *"Delete kept nothing back. Now it keeps a copy for thirty days."*

Observed behaviour, from the code: if the operator never opens the Trash panel, nothing is ever deleted. The retention window is not thirty days; it is *unbounded, with a thirty-day floor that only applies retroactively at the moment someone looks.*

**Why this matters**

This is a data-provenance and privacy defect, not a disk-space one. A local newspaper deletes things for reasons: a source's name that should not have been published, a name in a draft that a correction removed, material a subject asked to have taken down. The product tells the operator that copy is kept for thirty days. In practice a full copy of every deleted lead, draft and article sits in `deleted_items` indefinitely — and lands in every database backup taken thereafter, including the ones `ops/promote.ps1` makes.

The intent behind laziness is sound (a scheduled task is a thing to forget). The implementation ties expiry to an action the operator has no reason to perform, which is the one trigger that guarantees it does not happen.

**Blast radius**
- *Adjacent code:* `trash-store.ts`'s `snapshotArticle/snapshotDraft/snapshotLead` write the payloads; the restore path reads them. Neither changes.
- *Shared state:* backups taken before a fix will still carry the rows; the fix is forward-looking only, and the operator should be told that.
- *User-facing:* none — the Trash list shows the same thing either way.
- *Migration:* none.
- *Tests to update:* `src/lib/news/delete.test.ts` — assert that expiry happens on a trigger that does not require reading the list.
- *Cross-role:* the Technical Writer should check that "thirty days" is stated as a maximum, not a guarantee, until this lands.

**Fix path**

1. Call `purgeOld()` from a trigger that fires without an operator: the existing `drainQueuedJobs` pass, or the monitors cron tick, or once at boot. Boot alone is enough on a box the watchdog restarts.
2. Keep the lazy call too — belt and braces, and it costs nothing.
3. Make the sweep newsroom-independent (it currently takes a `newsroomId`), or a second newsroom's rows never expire at all.

---

### [ENG-107] — Major — Security — The Opinion writer runs with `WebFetch` on attacker-controlled pages while the private editorial voice is in its context

**Evidence**

`EDITORIAL_TOOLS = ["WebSearch", "WebFetch"]` (`src/lib/news/editorial.ts:226`), passed to the CLI at `editorial.server.ts:140` and rendered as `--allowed-tools WebSearch,WebFetch` (`ai-claude-code.server.ts:172-173`).

The same call sets `systemPromptFile: found.voice.path` (`editorial.server.ts:135`) — the paper's editorial voice, which the project deliberately treats as a secret. `CHANGELOG.md:82-85`: *"The editorial voice is a file on disk, named by path in the environment. Only the path ever reaches a command line, and the file is never read into the app's memory. It is not in this repository and cannot be."*

`buildEditorialPack()` (`editorial.ts:191-223`) puts editor-typed URLs into the prompt under `DOCUMENT POINTERS FROM THE DESK (unverified leads, **open them yourself**)`. The model then fetches those pages itself, with `WebFetch`, and their content enters the same context as the voice file.

The gap: "never read into the app's memory" is true of the *app*. The CLI reads the file and it is in the model's context throughout. A page the model is told to open — chosen from an unverified pointer — can carry instructions, and the model has a network egress tool. That is a complete exfiltration channel for the one asset the product names as confidential, plus whatever the editor typed.

I did **not** demonstrate an exploit: no model provider was configured in this lane (`TOWNREPORTER_CLAUDE_CODE=0` on every server I booted) and I made no billed model calls. This is a reachable-by-construction finding from the code, and I am labelling it as such rather than claiming a demonstrated attack.

**Why this matters**

The threat model here is not hypothetical for an investigative desk: pointing the Opinion writer at a document held by the subject of the piece is the *normal use of the feature*. The prompt hygiene elsewhere on this path is genuinely careful — `--setting-sources ""`, prompt over stdin rather than argv, `assertNotAnArgument` making that a refusal rather than a habit — which makes the untreated boundary stand out. The care went into what the *operating system* can see and none into what the *model* can be told.

**Blast radius**
- *Adjacent code:* the Dark Desk investigate loop ingests scraped text into prompts too, but without `WebFetch` in the tool set, so it lacks the egress half. Opinion is the one path with both.
- *Shared state:* the voice file is the operator's own writing, not recoverable if disclosed.
- *User-facing:* a mitigation will make some legitimate fetches fail; that needs to surface as a visible refusal, not a silent gap in the receipts.
- *Migration:* none.
- *Tests to update:* none exist for the tool boundary. A test asserting `EDITORIAL_TOOLS` never grows without a matching allowlist is cheap.
- *Related:* ENG-114 — the same fetches have no size ceiling.

**Fix path**

1. Constrain `WebFetch` to a host allowlist derived from the editor's own pointers plus the newsroom's configured sources. The CLI supports scoping; if it cannot express it, proxy the fetch through the app's own `fetchPublicHttp` (which already carries the SSRF guard) and hand the model text instead of a tool.
2. Do not put the voice file in the same context as fetched content: have the model draft with the voice and no tools, and run retrieval as a separate, tool-enabled pass whose output is plain text.
3. Correct the claim in `CHANGELOG.md:82-85` — "never read into the app's memory" is accurate and incomplete; it should say what the model can and cannot do with it.

---

### [ENG-108] — Major — Performance — 16.4 MB of PGLite WASM is published to the reader-facing asset directory and referenced by nothing

**Evidence**

After `npm run build`, `.output/public` is 18 MB, of which:

```
10,087,563  .output/public/assets/pglite-Dvh6EH3w.wasm
 6,293,225  .output/public/assets/pglite-CY5zdaUl.data
   395,059  .output/public/assets/initdb-D0MRRSih.wasm
   287,399  .output/public/assets/index-D5tR_8vM.js   ← the actual entry bundle
```

Three files are 93 % of the public asset directory. No client JavaScript references them — `grep -l pglite .output/public/assets/*.js` returns nothing, and grepping the entry bundle for any `pglite*` token returns nothing. PGLite is the server-side fallback database (`db.ts`), used only when `DATABASE_URL` is unset; it has no business in the browser bundle.

They are nonetheless served, anonymously:

```
$ curl -sSD - -o /dev/null http://127.0.0.1:3810/assets/pglite-Dvh6EH3w.wasm
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
content-length: 10087563
content-type: application/wasm
```

**Why this matters**

Two distinct costs. First, build and deploy weight: an 18 MB public directory that should be about 1.5 MB, on a product distributed as a source zip the reader can download. Second — and this is the one that matters for this deployment — a 10 MB unauthenticated download reachable from the public internet, on a paper served from a journalist's home broadband line. Cloudflare's cache absorbs repeats of the *same* URL (the `immutable` header is correct), so this is not a trivial amplification; but the files are pure waste and every rebuild mints new hashed names, so a cache-busting attacker gets fresh origin pulls after each deploy.

**Blast radius**
- *Adjacent code:* the fix is a Vite/Rollup config change (mark `@electric-sql/pglite` external for the client build, or move the import behind a server-only boundary). `src/lib/auth/pglite-dialect.ts` and `db.ts` are the importers to check.
- *Shared state:* the PGLite fallback must keep working for `npm run dev` with no `DATABASE_URL` — that is the documented zero-config quick start, and `scripts/first-run-paths.test.mjs` guards it.
- *User-facing:* none.
- *Migration:* none.
- *Tests to update:* add a build assertion — no file in `.output/public/assets` over ~1 MB, or specifically no `pglite*` there. This is a one-line check in the `smoke-built` job and it fails loudly the day the import creeps back.

**Fix path**

1. Ensure the PGLite import is reached only from server-only modules (a `.server.ts` boundary, as `isolation.server.ts` documents for `AsyncLocalStorage`), so Vite never emits it into the client graph.
2. Add the asset-size assertion to CI.
3. Re-measure `.output/public` after: it should land near 1.5 MB.

---

### [ENG-109] — Major — Correctness — A missing `BETTER_AUTH_SECRET` silently mints a per-process secret, so every restart signs the operator out

**Evidence**

`src/lib/auth/server.ts:201`:

```ts
secret: env("BETTER_AUTH_SECRET") ?? previewAuthSecret(),
```

`previewAuthSecret()` (`server.ts:61-64`) returns `randomBytes(32).toString("hex")`, cached on `globalThis` for the process lifetime only. In `.env.example:69` the variable is **commented out**:

```
# BETTER_AUTH_SECRET=generate-a-long-random-string
```

and the documented quick start is `cp .env.example .env`. `docs/setup.md:254` uses soft language: *"should be a long random string in any hosted environment."*

No warning fires. `verify.server.ts:21-27` does warn for the adjacent misconfiguration (`DATABASE_URL` set + auth disabled), which shows the pattern is understood — the *more* dangerous combination, `DATABASE_URL` set + no `BETTER_AUTH_SECRET`, is silent. A grep for `BETTER_AUTH_SECRET` across `src/`, `scripts/`, `ops/` finds the one read and nothing else.

Consequence: a self-hoster who follows the quick start runs a real Postgres deployment whose session-signing secret changes on every process start. The watchdog restarts the app on failure and both start triggers are at logon, so restarts are routine and expected. Every one of them invalidates all sessions.

**Why this matters**

The failure presents as "I keep getting signed out" — which, on a desk with no password reset, reads to a non-technical operator as a broken account rather than a missing environment variable. It also means session tokens are not durable across the one event the product's own availability design makes common.

**Blast radius**
- *Adjacent code:* the preview fallback is legitimate for the sandbox live preview, where the database is ephemeral anyway. The defect is applying it silently when a *real* database is configured.
- *Shared state:* setting the variable on an existing install invalidates the current session once, then stops.
- *User-facing:* fewer surprise sign-outs.
- *Migration:* none.
- *Tests to update:* none exist. A boot-time assertion is better than a test here.
- *Related:* ENG-101 — same file, same class of defect: the shipped example does not configure the thing the product needs configured.

**Fix path**

1. Uncomment `BETTER_AUTH_SECRET` in `.env.example` with a generated placeholder and a one-line "generate your own" note.
2. When `DATABASE_URL` is set and `BETTER_AUTH_SECRET` is not, either refuse to boot or log a loud warning naming the consequence — mirroring the shape of the existing `verify.server.ts:21` warning.
3. Better: generate one on first boot and persist it next to the database, so the operator never has to think about it. This is a one-person appliance; asking for entropy is asking for a support call.

---

### [ENG-110] — Minor — Performance — Nothing is compressed

**Evidence**

`curl -H "Accept-Encoding: gzip, br" http://127.0.0.1:3810/` returns no `content-encoding` header; the HTML arrives as 15,602 bytes of `Transfer-Encoding: chunked`. Same for `/login` and `/desk/ops`. The 287 KB entry bundle and the 80 KB stylesheet are served uncompressed too.

**Why this matters**

The paper is served from a home connection through a tunnel, to readers who may be on phones. HTML and JS compress 4–6×. Cloudflare will compress at its edge for the public site, which limits real-world impact for readers — but not for the operator's own LAN/loopback use, and not for anything that bypasses the edge.

**Fix path**

Enable Nitro's compression, or pre-compress assets at build time (`compressPublicAssets`), and assert a `content-encoding` in the built-server smoke.

---

### [ENG-111] — Minor — Performance — Every anonymous evidence request reads and JSON-parses every published article

**Evidence**

`publishedSourceUrls()` (`src/lib/news/evidence.ts:141-155`) runs `select provenance_json, source_urls from articles where status = 'published'` with no limit, then `JSON.parse`s two columns per row into a `Set`. It is called by `listPublicCaptureHistory` (`:259`) and `loadVersion` (`:297`), both reachable through unauthenticated server functions (`getPublicEvidence`, `listPublicHistory`, `listPublicVersionsForUrl`, `comparePublicEvidence` — `evidence.ts:414-426`, no middleware, correctly so).

Measured on a scratch Postgres seeded with 20,000 published stories (the same scale the project's own `search-index-proof.mjs` uses):

```
Bitmap Heap Scan on articles ... rows=20001
  Heap Blocks: exact=3334   Buffers: shared hit=3351
Execution Time: 10.891 ms
query + JSON.parse of every published row, ms: 37, 37, 46, 55, 64 | median 46
```

**Why I am not rating this higher.** The prior round called this Major. At 20,000 stories it costs 46 ms and ~26 MB of buffer touches per request — real, unauthenticated and unbounded, but 20,000 stories is roughly fifty years of a daily paper. At a realistic archive of a few hundred it is single-digit milliseconds. The exposure is high and the impact today is low, so Minor is the honest call; it becomes Major past a few thousand stories, and the shape is O(archive) per request either way.

**Fix path**

Cache the set for 30–60 s (publication is rare and operator-driven), or replace it with an indexed `exists` against a normalised `published_source_urls` view keyed on the URL being asked for — which turns an O(archive) scan into a lookup.

---

### [ENG-112] — Minor — Correctness — `leaveAsEditor` deletes every member of the newsroom, not the caller

**Evidence**

`src/lib/news/membership.ts:136-146`. After confirming the caller is an owner *or an editor*, it runs:

```sql
delete from newsroom_members where newsroom_id = ${mine[0].newsroom_id}
```

— every row, not `where user_id = …`.

**Why this is Minor and not Major.** I checked whether a second member can exist: a repo-wide grep for writes of the `'editor'` role finds none. `requireEditor` and `claimOwner` only ever insert `'owner'`, and both refuse once any member row exists. So today the newsroom has exactly one member and the mass delete is indistinguishable from a targeted one — which is why the docstring ("Owner/editor drops the desk. Paper stays. Next sign-in owns it.") reads as correct.

It is latent, not live. The day a second editor can be added — and the `EditorRole = "owner" | "editor"` type and the `role !== "editor"` checks say that is the intended direction — a non-owner editor pressing *Give up the desk* silently unclaims the whole newsroom, evicting the owner, and the next sign-in owns the archive.

**Fix path**

Scope the delete to `user_id`. If unclaiming the desk entirely is the deliberate behaviour for an owner, make that an explicit owner-only branch with its own confirmation copy, rather than a side effect of the `where` clause.

---

### [ENG-113] — Minor — Hygiene — `fetchSourceText` is dead code

**Evidence**

`src/lib/news/fetch-url.ts:183-232` exports `fetchSourceText`. A search across `src`, `server`, `scripts`, `ops` and `docs` for the identifier returns only its own definition — no caller, no test, no dynamic import, no string reference. Its siblings `fetchPublicHttp` / `fetchPublicHttpTracked` have twenty-plus callers.

It is ~50 lines carrying its own content-type policy, its own 14,000-character truncation, and its own rendered-page fallback — a second, divergent copy of ingest logic that a future reader would reasonably assume is live. It is also the one place a reviewer would look for a body cap and not find one (ENG-114).

**Fix path**

Delete it. If the rendered-fallback logic inside it is wanted, it already exists in `ingest.ts`.

---

### [ENG-114] — Minor — Security — The body-size cap is wired into one of roughly fifteen response reads

**Evidence**

`src/lib/news/body-limit.ts` is good work: two ceilings (5 MB HTML / 25 MB PDF), a cheap refusal on an oversized `content-length` before opening the tap, a mid-stream abort for chunked bodies with no declared length, and six real behavioural tests including "caps an error response too" and "survives a body that is already gone."

It has exactly one importer: `src/lib/news/ingest.ts:8`. Meanwhile these read whole bodies with no ceiling:

```
search-web.ts:205,231,252,284,398,419,462   await res.text()   (6 search backends + Wayback)
youtube.ts:90,275,299,447,613               await res.text()
youtube.ts:350                              await res.json()
reddit.server.ts:110                        await res.text()
primegov.ts:161                             return res.json()
render-fetch.ts:204                         await res.text()
fetch-url.ts:207                            await res.text()   (dead — ENG-113)
```

The module's own docstring says *"Both ingest paths called `res.arrayBuffer()` with no ceiling"* — accurate about what was fixed, and it reads as if that were the whole surface.

**Why this is Minor.** Most of these hosts are fixed and reputable (the search chain, YouTube, Reddit). The exposed ones are `primegov.ts` (an operator-configured civic portal) and `render-fetch.ts` (arbitrary discovered URLs, through Playwright). A hostile or merely broken response from those can exhaust the worker and, per ENG-105, take every queued job with it. Reachability requires an editor session or a model-discovered URL, which is why it is not higher.

**Fix path**

Route every one of these through `readBodyCapped(res, limitFor(url, ctype))`. It is a mechanical change and the helper already returns a typed refusal the desk can display as a fetch outcome rather than a generic failure.

---

### [ENG-115] — Minor — Correctness — The shared build lock is not namespaced by checkout, so two checkouts on one machine can corrupt each other's test run

**Evidence**

`src/lib/test-support/pg-admin.ts:144-145`:

```ts
const LOCK_DIR = join(tmpdir(), "townreporter-dev-build.lock");
const DONE_MARKER = join(tmpdir(), "townreporter-dev-build.done");
```

Both are fixed paths in the OS temp directory, shared by every process on the machine. `ensureBuilt(repoRoot)` takes `repoRoot` as an argument but does not use it in either path.

The docstring at `:176-198` works through, in detail, how a *stale* marker from a previous run caused "server never came up" failures, and fixes that by clearing the marker before building. The remaining hole is different: two **different checkouts** — a worktree and the main checkout, which is exactly the situation this gate runs in, with five roles on one machine — collide on the same lock. Checkout A takes the lock and builds its own `.output`; checkout B's `waitForBuildDone` sees A's marker, concludes the build is done, and boots **B's** `.output`, which may be absent or stale.

This did not bite me — my run was serial and passed 20/20 — so I am reporting the code property, not an observed failure.

**Fix path**

Hash `repoRoot` into both path names. One line, and it makes the guard correct for the multi-checkout case the docstring already shows the team cares about.

---

### [ENG-116] — Minor — Hygiene — Two documents still describe a Server page row that was deliberately removed

**Evidence**

The Reader-privacy row was removed in this release, with a careful comment explaining why (`health.server.ts:281-300`), and `docs/manual.md:451-457` documents the removal correctly. But:

- `docs/manual.md:219-221` — the list of what the Server page shows still ends: *"…the last watchdog run, free disk, **and whether the reader made any outside request**."* The same file contradicts itself 230 lines later.
- `docs/index.html:369` — figcaption: *"The Server page. The paper watches itself, restarts what falls over, **and reports whether a reader made any outside request**."*

**Why this matters**

It is small, but it is the exact class this project has been burned by — prose the code does not support — and it is describing the surface where the original Blocker lived. An operator reading `manual.md:221` will look for a row that is not there and reasonably conclude something is broken.

**Fix path**

Delete the clause from both, and add "reader privacy" to whatever sweep `scripts/sweep-claims.mjs` performs.

---

### [ENG-117] — Minor — Security — `CRON_SECRET` is compared non-constant-time with no rate limit

**Evidence**

`src/routes/api/cron.monitors.ts:12-15`:

```ts
const hdr = request.headers.get("authorization") ?? "";
if (hdr !== `Bearer ${secret}`) return new Response("forbidden", { status: 403 });
```

Plain `!==`, and the route carries no rate limiting. It does fail closed when the variable is unset (503), which is the right default and is worth crediting.

The practical risk from JS string-comparison timing across a network is low. The missing rate limit is the more real half: the endpoint is unauthenticated until the header matches, and a brute-forcer gets unlimited attempts.

**Fix path**

`crypto.timingSafeEqual` on equal-length buffers, plus a small per-IP limit — with the same caveat as ENG-102 about which address you trust.

---

### [ENG-118] — Nit — Hygiene — `npm run build` rewrites `src/routeTree.gen.ts` line endings, leaving the tree permanently dirty on Windows

**Evidence**

After `npm run build` on Windows, `git status --porcelain` reports `M src/routeTree.gen.ts`. `git diff` shows **no content change** — only `warning: LF will be replaced by CRLF`. The generator writes LF; the file is committed with CRLF.

Minor, but it trains the operator (and any agent) to ignore a dirty working tree, which is how a real change gets committed unnoticed.

**Fix path**

Add `src/routeTree.gen.ts text eol=lf` to a `.gitattributes`, or have the generator match the platform.

---

### [ENG-119] — Nit — Dependencies — Three carried-over platform artefacts

**Evidence**

1. `src/lib/auth/preview.ts:20-21` still carries a literal OAuth client secret in the repository (`PREVIEW_CLIENT_SECRET = "8bcdb7fc…"`), and `server.ts:81` falls back to it when `GROK_AUTH_CLIENT_SECRET` is unset. Its scope is genuinely narrow — the broker only accepts it for `*.grok-sandbox.com` callbacks, and the file documents that — but a committed secret in a product distributed as a downloadable source zip should be gone, not annotated.
2. `package.json` still names the project `app-builder-workspace`, and `nitro` is pinned to `3.0.260610-beta` — a beta build tool in a shipped product.
3. `playwright` sits in `dependencies`, not `devDependencies`. That is *correct* (`render-fetch.ts` uses it at runtime for JS-rendered pages) but it means a production install pulls a browser automation framework; worth a comment in `package.json` so the next person does not "fix" it.

**Fix path**

Require `GROK_AUTH_CLIENT_SECRET` explicitly rather than falling back to the baked constant, and delete `preview.ts` from the self-hosted product; rename the package; pin Nitro to a release when one exists; comment the Playwright placement.

---

### [ENG-120] — Nit — Hygiene — The SSRF test is still a string match, though the behaviour is covered elsewhere

**Evidence**

`scripts/newsroom-security.test.mjs:361-369` asserts the *source text* of `fetch-url.ts` contains `redirect: "manual"`, `assertPublicHttpUrl`, `isBlockedAddress`, and so on. None of that checks what the code does.

It is a Nit rather than a finding because the same properties **are** covered behaviourally: `src/lib/news/fetch-url.test.ts:82-140` drives `fetchPublicHttp` through a redirect to a blocked address and asserts it throws, and `ssrf-agent.test.ts` covers the connector. So the property is genuinely tested; this file just adds a green light that carries no information — the same shape as the `shouldCommitFetchHashes` assertions the team already replaced with real evaluation four tests below it.

**Fix path**

Delete the string assertions, or convert them the way the guard test was converted. Leave a comment pointing at `fetch-url.test.ts` so the next reader knows where the real coverage is.

---

## What couldn't be assessed, and why

- **The live deployment's actual `.env`.** Out of bounds by instruction. ENG-101 and ENG-109 are statements about the *shipped defaults*, proven on a build of this commit. Whether the running paper at `townreporter.org` has `HOST` and `BETTER_AUTH_SECRET` set, I cannot say, and I did not contact it. Checking that file is step zero on the punch list.
- **Any live-model path.** No provider was configured (`TOWNREPORTER_CLAUDE_CODE=0` everywhere) and I made no billed calls. Scan, Draft, Dark Desk hops and Opinion were reviewed as code. ENG-107 is a code-reading finding about a reachable channel, not a demonstrated exploit, and ENG-105's forty-minute starvation is a control-flow property, not a stopwatch measurement.
- **The Windows ops layer under real conditions.** `ops/*.ps1`, the scheduled tasks, the watchdog and `run-hidden.vbs` were read, not exercised — running them would have touched the live install's tasks. `scripts/ops-scripts.test.mjs` is source-text assertions, and CI is Linux-only, so this layer still has no behavioural coverage anywhere. That is the largest untested surface in the product and it is the one that restarts the machine.
- **Non-Windows and Vercel deployment.** `NITRO_PRESET=vercel` is documented; I exercised only the Windows self-hosted build.
- **Prior findings ENG-011, ENG-016 and ENG-019** (log files read whole into memory; `desk_rate`/`audit_events` growing unbounded; unbounded child-process output). I ran out of budget before re-verifying these three and am recording them as *not re-checked* rather than as fixed or open. Do not read their absence from my findings list as a pass.
- **Real traffic and real load.** Every performance number above was taken on this machine against a local Postgres with a near-empty database. They are floors, not projections.
- **`townreporter-web` and `townreporter.org`** were not read or contacted, per the brief.

---

## Punch list for this sprint

1. **ENG-101** — set `HOST` in `.env.example` (and verify the live `.env`). Blocker.
2. **ENG-102** — stop trusting client-supplied forwarding headers by default; add the rotating-header case to `sign-in-throttle.test.ts`. Critical.
3. **ENG-103** — one security-headers middleware; assert it in the built-server smoke. Critical.
4. **ENG-109** — warn or refuse when `DATABASE_URL` is set and `BETTER_AUTH_SECRET` is not.
5. **ENG-104** — memoize the `ensure*Schema` calls (measured: 60 % of Dark Desk page time), then migrate the DDL properly.
6. **ENG-106** — purge the trash from a trigger that does not require an operator to look at it.

## Watchlist for next sprint

ENG-105 (job lanes) · ENG-107 (model tool boundary) · ENG-108 (16 MB of dead WASM) · ENG-110 (compression) · ENG-111 (cache `publishedSourceUrls`) · ENG-112 (scope the member delete before a second editor exists) · ENG-114 (finish wiring the body cap) · ENG-115 (namespace the build lock) · the un-re-verified ENG-011 / ENG-016 / ENG-019 · and behavioural coverage for the Windows ops layer, which remains the product's largest untested surface.
