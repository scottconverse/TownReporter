# Engineering Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-30
**Role:** Principal Engineer
**Scope audited:** Architecture, correctness, security (auth boundary, SSRF in link-fetching, secrets), performance (job drainer, hot paths), the two-lane job queue (`src/lib/news/jobs.ts`), the PGLite/Neon split (`src/lib/db.ts`), migrations, dependency/data provenance. Full scope, balanced posture.
**Auditor posture:** Balanced (adversarial security passes)

---

## TL;DR

This is a mature, unusually well-audited codebase. Prior waves (ENG-004/104/105/106/107/109, gate-2026-08-30) are real and their fixes are present in the source, not just promised. The auth boundary is clean: every mutating server function runs through `deskMiddleware`, identity is server-derived, and newsroom scope comes from the DB membership row rather than client input. The plain-`fetch` SSRF surface is hardened to a level most production apps never reach — connect-time DNS re-validation against private ranges, with a test that proves a loopback service is unreachable through the guarded fetch. Dependency surface is clean (`npm audit`: 0 vulnerabilities). The one genuinely fresh, defensible concern the wave missed is that this connect-time SSRF guard protects the `undici` path but **not** the Playwright/Chromium render path, which resolves and connects on its own — reopening DNS-rebinding on the exact pipeline (unattended, model-extracted URLs) the guard was written to close. Everything else is Minor: an operational job-reclaim gap on crash, one un-coalesced insert, and a test gap paired to the render finding.

## Severity roll-up (engineering)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 1 |
| Major | 1 |
| Minor | 3 |
| Nit | 1 |

## What's working

- **Auth boundary is enforced by construction.** `deskMiddleware` (`src/lib/news/desk-auth.ts:7-20`) composes `assertSameSiteRequest()` → `requireUserId(bearerToken)` → `requireEditor(userId)` and injects `{ userId, newsroomId, role }` into handler context. Every write in `desk.ts` (24 fns), `dark.ts` (21 fns), `opinion.ts` (11 fns), and `trash.ts` uses it. `newsroom_id` is never read from client `data` for a query filter — `owned(context)` (`desk.ts:50-51`) reads it from the membership-derived context. Verified across the whole server-fn surface.
- **Fail-closed auth defaults.** `requireUserId` (`verify.server.ts:84-97`) refuses to fall back to the shared dev user when `DATABASE_URL` is set but auth is disabled, rather than silently sharing one identity on a real DB.
- **SSRF connect-time guard on the fetch path.** `guardedLookup` (`fetch-url.ts:73-96`) welds a private-range rejection onto the connector's own DNS lookup, so the address approved is the address connected to — closing the rebinding window between `assertPublicHttpUrl`'s check and the socket. `ssrf-agent.test.ts:62-80` proves a live loopback service is unreachable through `resolveFetch()` even when the hostname check is bypassed.
- **Secrets discipline.** `BETTER_AUTH_SECRET` absent + `DATABASE_URL` present → hard refusal at boot with a copy-paste fix (`server.ts:83-107`, ENG-109), instead of minting a per-process secret that silently logs the operator out on every watchdog restart. The Claude Code provider never handles credentials and refuses to combine a private system-prompt file with network tools in one call (`ai-claude-code.server.ts:166-173`, ENG-107) — a real exfiltration-channel closure.
- **Two-lane job queue is correct.** Race-safety lives in the DB (partial unique index `desk_jobs_one_open_per_subject` + conditional claim update in `executeJob`, `jobs.ts:367-381`), not in the advisory `findOpenJob` check; the `claim_token` guard (`jobs.ts:392-419`) prevents a reclaimed-stale executor and the original from both writing results. Lane isolation (`drainLane`, `jobs.ts:315-354`) genuinely lets Scan/Draft drain while a 40-min editorial runs.
- **PGLite/Neon parity is thought through.** Type-OID normalization (`db.ts:76-97`) makes int8/date/interval return identical JSON-safe shapes on both backends; `ensureSchemaOnce` (`db.ts:314-347`) records the ensure-fact *in the database* keyed by a statement fingerprint, so a rebuilt/rescratch DB re-runs DDL rather than trusting a stale in-process boolean.
- **Rate-limiting and lockout are on by default, not by env** (`server.ts:310-318`, `accountSignInLockout`), correctly bucketed by `cf-connecting-ip` behind the tunnel with a per-account backstop that no header can rotate.

## What couldn't be assessed

- **Live model-provider behavior** (the 10–40 min editorial pass) was not executed — no provider is configured in this checkout and a real run costs money; correctness was assessed by reading, consistent with the codebase's own test seam (`__setJobWorkForTest`).
- **Production runtime telemetry** (:3000) was out of bounds by audit constraint; no isolated throwaway boot was required to reach the findings below (all are code-evident). Static reasoning only for load/throughput claims.
- **`migrations/auth/`** contents were noted as intentionally out of the PGLite glob scope but not line-audited (Better Auth's own schema).

---

## Findings

> **Finding ID prefix:** `ENG-` (this wave uses the `ENG-2xx` band to avoid collision with prior-wave IDs referenced in source comments.)

### [ENG-201] — Critical — Security — DNS-rebinding SSRF is closed on the `fetch` path but open on the Playwright render path

**Evidence**
The hardened path re-validates the resolved address at connect time via a custom connector lookup:

- `src/lib/news/fetch-url.ts:73-96` (`guardedLookup`) and `:113-132` (`buildGuardedFetch`) build an `undici.Agent({ connect: { lookup: guardedLookup } })`. The header comment (`:61-72`) states the reason exactly: "A hostile authoritative server can answer those two lookups differently and land the connection on a private address. That is DNS rebinding."

The render path does **not** use that connector. Chromium resolves DNS and opens sockets itself:

- `src/lib/news/render-fetch.ts:84-87` launches Chromium with `args: ["--no-sandbox", ...]` and **no** `--host-resolver-rules`, proxy, or custom resolver.
- `render-fetch.ts:116-128` intercepts requests with `page.route("**/*")` and calls `await assertPublicHttpUrl(u)` — but `assertPublicHttpUrl` (`fetch-url.ts:6-26`) does its **own** `dns.lookup`, then `route.continue()` hands the URL back to Chromium, which resolves **again** and connects. Two lookups, attacker-controlled TTL between them.
- Same shape on the top navigation: `render-fetch.ts:101` `assertPublicHttpUrl(raw)` then `:129` `page.goto(start.toString())` and `:135` `assertPublicHttpUrl(page.url())` — all check-then-Chromium-connect.

Reachability is unattended and adversarial: `fetchSourceText` (`fetch-url.ts:211-219`) calls `fetchRenderedPage` when `needsRenderedFetch(url, text, html)` is true (JS civic shells — Municode/PrimeGov), on URLs the model extracted from source text during a Scan. An attacker who controls a source page links to a host they own that (a) serves an app-shell so `needsRenderedFetch` fires and (b) rebinds its hostname to `169.254.169.254`, `127.0.0.1`, or a LAN address between the guard lookup and Chromium's connection.

**Why this matters**
The rendered path is the one that drives a real browser with `javaScriptEnabled: true` at an attacker-influenced origin, so it is both the most capable SSRF sink and the one left unguarded. On this deployment the app also exposes host-control ops actions (`runOpsAction`, restarts services) on localhost; internal-LAN reach is the concrete risk even though a home box has no cloud metadata endpoint. `--no-sandbox` (`render-fetch.ts:86`) additionally removes Chromium's own process sandbox, widening the blast radius of any renderer compromise from hostile content. The `undici` path proves the team knows this attack; the render path is the gap the wave missed.

**Blast radius**
- Adjacent code: `render-fetch.ts` `fetchRenderedPage` and `scrapeYoutubeShowTranscript` (both drive Chromium the same way); every caller reachable from `fetchSourceText` (`fetch-url.ts:183`) — Scan (`desk.ts`), Dark Desk, ingest.
- Shared state: the module-level cached `browser` handle and `withSlot` semaphore (`render-fetch.ts:37-52`); the SSRF guard helpers in `url-guard.ts`/`fetch-url.ts`.
- User-facing: no change to legitimate rendering; malicious internal reach closes.
- Migration: none — additive enforcement.
- Tests to update: `render-fetch.test.ts` currently tests only the detection heuristic (`grep`: 3 `it()` blocks, all `needsRenderedFetch`), **no** connect-time block test exists for the render path — see ENG-205.
- Related findings: ENG-203 (`--no-sandbox`), ENG-205 (test gap).

**Fix path**
Pin Chromium's resolution to the pre-approved address rather than re-resolving. Concrete options: (1) resolve the host once via `guardedLookup`, then launch/goto with `--host-resolver-rules="MAP <host> <approved-ip>"` (per-context is awkward in Playwright, so prefer a per-launch context keyed to the target), or (2) route the browser through a loopback proxy whose `connect` uses `guardedLookup` — the same connector the `undici` path already trusts — so Chromium never performs its own DNS. Minimum bar: block `--no-sandbox` from also carrying `--disable-web-security`-class flags and add a `MAP` pin so the checked address is the connected address. Add the connect-time test (ENG-205).

---

### [ENG-202] — Major — Correctness/Architecture — Orphaned/stale jobs are only reclaimed by a new enqueue or an externally-configured cron

**Evidence**
- The in-process job-drain interval lives only in the **dev** Vite plugin: `vite.config.ts:161-222` (`darkDeskMonitorPlugin`, `apply: "serve"`) sets `setInterval(tickJobs, 20_000)`. It does not run in the built `node-server` output.
- In production, drains are triggered by `kickJobs()` (`jobs.ts:286-290`, a `setTimeout(0)` in the same process, fired on enqueue) and by `GET /api/cron/monitors` → `tickAllDueMonitors` → `drainQueuedJobs` (`monitors-cron.ts:33-38`).
- `/api/cron/monitors` is **disabled unless `CRON_SECRET` is set** (`src/routes/api/cron.monitors.ts:8-10` returns 503 when unset).

So on a self-hosted deploy that does not configure `CRON_SECRET` and an external scheduler, if the process crashes/restarts mid-run (the header comment in `jobs.ts:450-476` explicitly anticipates "the machine rebooting, the app being restarted, an OOM kill"), a `queued` or stale-`running` job is reclaimed only when the *next* `enqueueJob` happens to `kickJobs()` — which drains the whole lane, so it does get picked up, but only on the next user action, which for an unattended desk may be hours/days.

**Why this matters**
The heartbeat/`STALE_RUNNING_SECONDS` machinery (`jobs.ts:126-130`) is built to make dead jobs *reclaimable*, but nothing unattended actually *triggers* the reclaim in a default self-hosted install. A Scan or editorial that died mid-run shows the run as open (`runLooksStalled` will report it), but recovery waits on the next enqueue. This partially undercuts ENG-105/106's intent (unattended progress).

**Blast radius**
- Adjacent code: `monitors-cron.ts` (also drives due-monitor recheck and trash purge on the same tick — all three share the missing unattended trigger), `jobs.ts` `drainQueuedJobs`.
- Shared state: `desk_jobs`, `scan_runs`/`dark_runs`/`editorial_requests` run records.
- User-facing: stalled Scan/Opinion/Dark runs stay "in progress" until a later action nudges the drainer.
- Migration: none.
- Tests to update: none known (would need an integration test asserting an unattended reclaim path exists).
- Related findings: none.

**Fix path**
Ship an in-process interval in the production server too (a `node-server` Nitro plugin / server-middleware analogue of `darkDeskMonitorPlugin`), independent of `CRON_SECRET`, so the built server self-drains on the same cadence dev does. Keep `/api/cron/monitors` as the external belt-and-suspenders. Document that `CRON_SECRET` is only required for *external* scheduling, not for baseline recovery. Confirm the README's "kept for thirty days" / unattended-progress promises against whichever trigger ships.

---

### [ENG-203] — Minor — Security — Chromium renders attacker-influenced pages with `--no-sandbox`

**Evidence**
`src/lib/news/render-fetch.ts:84-87`: `chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] })`. The pages it renders (`fetchRenderedPage`) are civic-portal URLs extracted from source text, i.e. not fully trusted.

**Why this matters**
`--no-sandbox` disables Chromium's OS-level renderer sandbox, so a renderer-exploit in hostile page content executes with the server process's privileges. On a single-box appliance that holds session secrets and host-control ops actions, that is a meaningful amplifier of ENG-201. It is common to set `--no-sandbox` because the server runs as root / in a minimal container where the sandbox won't initialize — but that is a reason to fix the run environment, not to accept it silently.

**Blast radius**
- Adjacent code: `scrapeYoutubeShowTranscript` (same launch), any future Chromium caller.
- User-facing: none.
- Related findings: ENG-201.

**Fix path**
Prefer running the render worker as a non-root user so the sandbox initializes and `--no-sandbox` can be dropped; if the deploy target genuinely cannot (some container bases), document the accepted risk and pair it with the ENG-201 host-resolver pin so hostile origins can at least not reach internal addresses.

---

### [ENG-204] — Minor — Correctness — `enqueueJob` retry insert lacks `on conflict do nothing`

**Evidence**
`src/lib/news/jobs.ts:270-281`: the rare "lost the race and the winner already finished" branch does a plain insert:
```
const retry = await sql<DeskJob>`
  insert into desk_jobs (...) values (...)
  returning ...
`;
```
Unlike the primary insert (`:260-266`) which uses `on conflict do nothing`, this retry has no conflict clause. If a concurrent caller inserts an open row for the same `(newsroom_id, kind, subject_id)` between this branch's `findOpenJob` miss and its insert, the partial unique index `desk_jobs_one_open_per_subject` raises and this `enqueueJob` rejects instead of coalescing onto the existing job.

**Why this matters**
This is a narrow double-race (winner finished *and* a third caller re-opened, all within one window), so exposure is low — but the whole point of the ENG-004 design is that concurrent enqueues *coalesce* rather than error. This branch can surface a 500 to a user clicking "Scan" under contention where every other path returns the shared job.

**Blast radius**
- Adjacent code: `enqueueJob` callers (Scan/Draft/Dark/Opinion enqueue sites).
- Tests to update: `jobs.test.ts` coalescing tests could add this window.
- Related findings: none.

**Fix path**
Mirror the primary path: `insert ... on conflict do nothing returning ...` and, on empty result, `findOpenJob` once more and return that row; only throw if still nothing.

---

### [ENG-205] — Minor — Correctness (test gap) — No test exercises the render-path SSRF guard

**Evidence**
`src/lib/news/render-fetch.test.ts` contains only three `it()` blocks, all asserting the `needsRenderedFetch` *detection heuristic* (Municode/IE9-shell/static-page). There is no test that a private/rebinding target is refused on the render path, whereas the `undici` path has exactly that proof (`ssrf-agent.test.ts:62-80`). The asymmetry is how ENG-201 stayed invisible.

**Why this matters**
The safest fix for ENG-201 is only durable if a test fails when the render path can reach a loopback/private address. Without it, a future refactor can silently re-open the gap.

**Blast radius**
- Related findings: ENG-201 (same root).

**Fix path**
Add a render-path test that stands up a loopback HTTP server and asserts `fetchRenderedPage`/the `page.route` guard refuses it (mock the browser seam the way `jobs.test.ts` mocks work, or gate behind a Playwright-available check). Land it with the ENG-201 fix so it fails first.

---

### [ENG-206] — Nit — Architecture — Multi-newsroom scoping code coexists with hardcoded single-tenant claim logic

**Evidence**
Queries scope by `newsroom_id = ${owned(context)}` throughout `desk.ts`, and `DeskJob.newsroom_id` is a first-class column — code written as if multiple newsrooms exist. But `DEFAULT_NEWSROOM_ID = 1` (`membership.ts:24`) is hardcoded, `requireEditor` only ever counts/creates against newsroom 1 (`membership.ts:96-116`), and `leaveAsEditor` deletes *all* members of the newsroom (`membership.ts:145`) — correct for "unclaim the appliance," surprising if read as multi-tenant.

**Why this matters**
Not a bug — the single-tenant appliance model is documented (`membership.ts:1-19`). Flagging only so the team decides deliberately whether to (a) commit to single-tenant and simplify the scoping ceremony, or (b) keep the seams and make claim logic newsroom-parameterized. Left as-is, it invites a future contributor to assume multi-tenancy that the claim path does not support.

**Fix path**
Add a one-line ADR/comment at the `owned()` seam stating single-tenant-by-design, or parameterize `requireEditor`/`claimOwner` if multi-newsroom is on the roadmap.

---

## Patterns and systemic observations

- **The team's audit muscle is real and the highest-leverage asset here.** Nearly every non-obvious decision carries a comment naming the failure it prevents and the finding ID. This is why the fresh finding count is low: the obvious classes are already closed. The one systemic lesson from ENG-201/205 is that **a hardening applied on one code path must be paired with a test that also asserts it on every *sibling* path with the same sink** (undici fetch vs. Chromium fetch). The guard was correct; its coverage was partial, and no test named the second path.
- **"Guard at the boundary, re-check at the sink" is applied unevenly.** `fetch-url.ts` does it perfectly for `undici`; `render-fetch.ts` guards the boundary (`assertPublicHttpUrl`) but the sink (Chromium's own resolver) is unguarded. Any future outbound-capable component (a new headless tool, an image fetcher) should inherit the connector, not re-derive the boundary check.
- **Unattended execution depends on a trigger that dev has and prod lacks (ENG-202).** The recovery *mechanism* is well-built; the recovery *trigger* is the weak link. Worth a single durable in-process scheduler in the built server so all three unattended promises (monitors, job reclaim, trash purge) ride one clock.

## Dependency snapshot

`npm audit --omit=dev`: **0 vulnerabilities.** Versions are current (React 19.2, TanStack Start 1.168+, better-auth ~1.6.30, undici ^8.10, pg ^8.16). No abandoned or CVE-bearing runtime deps reached by code.

| Dependency | Version | Concern |
|---|---|---|
| `nitro` | 3.0.260610-beta | Beta build tooling pinned to a dated pre-release; fine for self-host but worth tracking to a stable line before wider distribution. |
| `playwright` | ^1.62.0 (runtime dep) | Heavy; correctly stubbed out of the client bundle (`vite.config.ts:243-272`) and disabled on Vercel. No issue, noted for bundle awareness. |
| `@electric-sql/pglite` | ^0.5.4 | 16.4 MB wasm/data; correctly kept out of public assets (`vite.config.ts` comment). Pre-1.0 — pin deliberately. |

Otherwise the dependency surface is clean.

## Appendix: artifacts reviewed

- `package.json`, `vite.config.ts`
- `src/lib/db.ts`
- `src/lib/news/jobs.ts`, `monitors-cron.ts`, `membership.ts`, `desk-auth.ts`
- `src/lib/news/url-guard.ts`, `fetch-url.ts`, `render-fetch.ts`, `ssrf-agent.test.ts`, `render-fetch.test.ts`
- `src/lib/news/ai-claude-code.server.ts`
- `src/lib/auth/server.ts`, `verify.server.ts`
- `src/routes/api/cron.monitors.ts`, `src/routes/__root.tsx`
- `migrations/` (file listing; 0017/0019 cross-checked against `jobs.ts` embedded DDL)
- Sub-agent sweep of all `createServerFn` handlers across `src/` for auth/authz enforcement (desk.ts, dark.ts, opinion.ts, trash.ts, ops/dashboard.ts, claim.ts, public.ts, evidence.ts)
- `npm audit --omit=dev`
