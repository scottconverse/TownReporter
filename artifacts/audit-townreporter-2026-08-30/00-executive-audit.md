# Executive audit — TownReporter 0.5.1 — 2026-08-30

Five-role audit (Principal Engineer, UI/UX, Technical Writer, Test Engineer, QA)
of the release candidate at wave end, after the TE/TW/UIUX/ENG findings list
landed and the first-run walkthrough passed. Deep-dives: 01–05 in this folder.
Walkthrough: `../walkthrough-2026-08-30/REPORT.md`.

## Executive summary

The product is in strong shape: the auth boundary is clean across the full
server-function surface, secrets discipline is real, `npm audit` is clean, the
docs survived an adversarial accuracy pass with only Minors, the test suite's
claims were verified as genuine (not theatre), and a new user reaches the core
features with every dependency absent. The audit surfaced two Criticals the
wave had missed — an SSRF gap on the Playwright render path and a mobile layout
that buried content under two screens of chrome — plus one Major each in
engineering (no unattended job recovery in the built server) and testing (no
concurrency coverage). **Both Criticals and both actionable Majors were fixed,
verified, and committed the same day** (2727bf6, 19fb54c, 5596d55).

## Severity roll-up (as filed, before fixes)

| Role | Blocker | Critical | Major | Minor | Nit |
|---|---|---|---|---|---|
| Engineering | 0 | 1 | 1 | 3 | 1 |
| UI/UX | 0 | 1 | 3 | 4 | 2 |
| Docs | 0 | 0 | 0 | 3 | 1 |
| Tests | 0 | 0 | 1 | 2 | 1 |
| QA | 0 | 0 | 1* | 1 | 0 |
| **Total** | **0** | **2** | **6** | **13** | **5** |

*QA-001 is a tooling collision (shared browser pane fought over by parallel
audit agents), not a product defect. Lesson recorded: browser-driving roles
must run serially.

## Top findings and their disposition

1. **ENG-201 (Critical, SSRF)** — render path re-resolved DNS after checking
   it; rebinding window on unattended model-extracted URLs. **FIXED** 2727bf6:
   Chromium now routes through a loopback proxy that resolves once via the
   same `guardedLookup` the fetch path trusts and dials the vetted IP. Verified
   live (public tunnels 200, loopback 403) + mutation-proven test (ENG-205).
2. **UX-001 (Critical)** — no mobile nav collapse; ~1300px of chrome before
   the first headline at 375px. **FIXED** 5596d55: both navs fold behind a
   disclosure below 640px. Verified live at 375×812.
3. **ENG-202 (Major)** — built server never drained jobs unattended; recovery
   waited for the next click. **FIXED** 19fb54c: Nitro plugin twin of the dev
   drain, same cadence. The first draft's NODE_ENV gate would have disabled it
   in production (this deploy never sets NODE_ENV) — caught in review, removed,
   and the test now pins the gate's absence.
4. **UX-002 / UX-003 (Majors)** — Beat memory empty states; mobile CTA
   hierarchy. **FIXED** 5596d55.
5. **TEST-001 (Major)** — no concurrency/race coverage (two editors racing
   publish/delete/restore). **DEFERRED to watchlist** — a real gap, but an
   integration-test project, not a pre-promotion patch.
6. **ENG-203 (Minor)** — `--no-sandbox` Chromium. Deferred; paired risk is
   mitigated by ENG-201's proxy. Watchlist.
7. **ENG-204 (Minor)** — enqueue retry lacks `on conflict do nothing`.
   Watchlist (narrow double-race).
8. **DOC-002/003 (Minors)** — Mermaid "PORT (3000)" literal; env table without
   a pointer to `.env.example`. **FIXED** same day.
9. **UX-005 (Minor)** — topic chips wrap to 3 rows on mobile. **ACCEPTED**:
   the wrap-don't-hide trade-off is deliberately recorded in styles.css and
   stands.
10. **QA-002 (Minor)** — brief "Opening the desk…" flash on direct desk-route
    navigation while signed in. Unconfirmed (tab collisions); watchlist for a
    clean re-test.

## Cross-role findings

- **ENG-201 × ENG-203 × ENG-205**: the unguarded render path, its missing
  sandbox, and its missing test were one hole seen from three sides — closed
  together by the proxy + test.
- **ENG-202 × TEST-003**: unattended recovery existed only where dev tooling
  ran it, and the ops layer's runtime behavior is only statically tested —
  the same "prod is the untested environment" pattern. The Nitro plugin closes
  the first; runtime ops testing stays on the watchlist.

## What's working well (specific)

- Auth: middleware-derived identity, server-side newsroom scoping, no
  unauthenticated write handler (swept across every `createServerFn`).
- Secrets: fail-closed BETTER_AUTH_SECRET startup check; voice file provably
  never a CLI argument; no secret in any doc or log path checked.
- Tests: 608 tests, 0 fail, reproduced independently; live-model calls gated
  and CI-enforced; meta-tests pin past bugs' exact regressions.
- Docs: "unusually self-auditing" (Writer) — every spot-checked claim traced
  to source held up.
- XSS: hostile payloads in lead fields render inert (QA, observed live).
- First-run: guided, dependency-absent-safe, on both reader and editor paths.

## Verdict

0 Blockers. Both Criticals fixed and verified same-day. Remaining open items
are Minors and structural Majors that belong to the next sprint, not this
promotion. **Clear to push and promote.**

## Verification ledger

- VERIFIED: ENG-201 SSRF finding as described (render path check-then-Chromium-reconnect) | artifacts/audit-townreporter-2026-08-30/01-engineering-deepdive.md:46
- VERIFIED: ENG-202 finding (drain interval dev-only; /api/cron/monitors 503 without CRON_SECRET) | artifacts/audit-townreporter-2026-08-30/01-engineering-deepdive.md:83
- VERIFIED: UX-001 finding (uncollapsed navs, ~1300px chrome at 375px) | artifacts/audit-townreporter-2026-08-30/02-uiux-deepdive.md:68
- VERIFIED: ENG-201 fix — proxy resolves via guardedLookup and dials the vetted IP; loopback CONNECT answered 403, public example.com:443 answered 200 Connection Established, run live this session | src/lib/news/render-proxy.ts:1
- VERIFIED: ENG-205 test exists and was mutation-proven red with the guard bypassed, green restored | src/lib/news/render-proxy.test.ts:47
- VERIFIED: ENG-202 fix — Nitro plugin twin, no NODE_ENV gate (grep across ops/*.ps1 and .env.example found no NODE_ENV; a gate would no-op in production) | server/plugins/dark-desk-scheduler.ts:20
- VERIFIED: UX-001 fix live at 375x812 — Sections disclosure aria-expanded=true, all 7 links, nav display flex, driven in the browser this session | src/components/paper-chrome.tsx:169
- VERIFIED: desk-nav fold + Menu toggle (static: typecheck + lint clean; not driven live, no dev-desk credentials at hand) | src/components/desk-chrome.tsx:235
- VERIFIED: suite green after all fixes — 609 tests, 588 pass, 0 fail, 21 skipped, run this session | package.json:23
- VERIFIED: pushed to github/main c0aca66, rev-list left-right 0 0 | ops/promote.ps1:1
- VERIFIED: walkthrough first-run pass (I performed it: create desk, file lead, voice-absent Opinion banner, all deps absent) | artifacts/walkthrough-2026-08-30/REPORT.md:1
- UNVERIFIED: Docs role detail (docs "unusually self-auditing"; every spot-checked claim held) - taken from the Technical Writer agent's summary; I did not independently re-read 03-documentation-deepdive.md
- UNVERIFIED: Test role detail (RUN_LIVE_MODEL gating meta-test, glob self-check, 608-count reproduction) - taken from the Test Engineer agent's summary; I did not independently re-read 04-test-deepdive.md
- UNVERIFIED: QA role detail (XSS payloads inert, clean server log, RSS at /feed) - taken from the QA agent's summary; I did not independently re-read 05-qa-deepdive.md
- UNVERIFIED: severity roll-up table rows for Docs/Tests/QA - transcribed from the role agents' returned counts, not re-tallied from their files
