# Runtime QA Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-30
**Role:** QA Engineer
**Scope audited:** Editor desk runtime flows (account creation, lead filing, story workbench, publish gating), input handling/XSS, RSS feed, error-route behavior. Frontend only (browser-driven); backend log inspection alongside.
**Environment:** Isolated throwaway build, `node .output/server/index.mjs`, `PORT=3195`, `DATABASE_URL` and `TOWNREPORTER_VOICE_FILE` unset (empty in-memory PGLite, no voice configured), `BETTER_AUTH_SECRET=audit-qa`. Chromium via Browser-pane MCP tooling. Viewport 1280x800 desktop (mobile viewport testing not completed — see below). Production `:3000` never touched (confirmed untouched throughout — separate PID, never dialed).
**Auditor posture:** Balanced (adversarial input testing where the tooling allowed it).

---

## TL;DR

The product behaved correctly on every flow this audit could reliably drive to completion: client-side guards correctly blocked an empty lead submission and a mismatched-password signup before any network call fired, and — the most safety-relevant check — a headline/dek filled with a raw `<script>alert('xss')</script>` and `<img src=x onerror=alert(1)>` payload rendered back as inert escaped text with no script execution and no console errors. Server logs show no 5xxs or crashes across the session. However, this audit's browser-driven adversarial pass (publish, delete/undo, restore-from-trash, corrections, paste-editorial, two-tab conflicts) is **materially incomplete**: the shared Browser-pane MCP tooling was repeatedly and involuntarily redirected mid-task to a second TownReporter instance on port 3196 (a different, concurrently-running session's tab), including inside a tab this audit created itself, and one tab was closed out from under the audit entirely. That is an environment/tooling defect, not a product defect, but it means the state-changing flows the audit was specifically asked to stress could not be verified end-to-end and are reported as unassessed rather than passing.

## Severity roll-up (QA)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 0 |
| Major | 1 |
| Minor | 1 |
| Nit | 0 |

## What's working

- **XSS payloads render inert.** `<script>alert('xss')</script>` and `<img src=x onerror=alert(1)>` typed into the lead Headline and Why-Now fields were stored and re-rendered as literal escaped text on the story workbench (confirmed by screenshot: no alert dialog, no console error, tags visible as text). This is the single most safety-critical check in this audit and it passed cleanly.
- **Empty-form submission is blocked client-side.** Clicking "File lead" with all fields empty produced no network call at all (verified against the network log) and no queue mutation — the UI didn't even round-trip to the server to reject it.
- **Password-mismatch on account creation is caught client-side.** Submitting "Create editor account" with non-matching password/confirm fields shows an inline "Passwords do not match." message with no server request; correcting the field and resubmitting succeeded normally and landed on the Command Center.
- **Publish is disabled until Body has content.** With Headline/Dek filled but Body empty, "Publish to the paper" rendered visibly disabled (grey, non-interactive) rather than allowing a click-through to an error state.
- **Server process stayed clean.** No 5xx responses and no uncaught exceptions appeared in the server log for the duration of the session; the only log lines were expected startup warnings about `BETTER_AUTH_SECRET` length/entropy and IP-based rate-limit fallback (both artifacts of the throwaway audit env, not product bugs).
- **RSS feed is reachable and well-formed at `/feed`** (not `/feed.xml` or `/rss.xml`, which both correctly 404) — served valid RSS 2.0 XML with an `atom:link self` and existing paper content.

## What couldn't be assessed

- **Publish, delete/undo, restore-from-trash, corrections lifecycle, paste-editorial, Dark Desk, two-tab conflicting edits, back/forward mid-form, mobile viewport, and the two-lane job drainer.** These were the audit's primary adversarial targets and could not be reliably exercised: the Browser-pane MCP tooling used for this audit is shared, and this session's tab was repeatedly and silently re-pointed mid-task to `http://127.0.0.1:3196` — a different TownReporter instance evidently under a concurrent session's control — including once inside a tab this audit itself created (`tabs_create`) and once via that tab being closed entirely out from under the audit. A publish attempt against the QA lead (`<script>alert('xss')</script> QA & "quotes" 'apos'`) was clicked, but the click landed on the wrong instance's DOM; a follow-up check of `/feed` and `/desk/published` on :3195 confirmed the story never actually published, so the publish path itself is unverified in either direction (neither confirmed working nor confirmed broken).
- **A recurring "Opening the desk… If this sits here, use Sign in." transient state** was observed on direct navigation to `/desk/queue` and `/desk/published` after being signed in, resolving after roughly 2–3 seconds without user action in every case observed. Because every occurrence coincided with the tab-hijacking interference above, it cannot be attributed with confidence to the product's own session-hydration timing versus an artifact of the interference; flagged as Minor pending a clean re-test.
- **Mobile viewport testing.** One screenshot incidentally rendered at a 375x812 mobile size, but that occurred on the hijacked :3196 instance under conditions this audit didn't control, so it isn't usable as a mobile-viewport finding for :3195.

---

## Product shape

TownReporter 0.5.1 is a self-hosted civic newspaper: a public paper (SSR'd article pages, RSS, evidence pages, corrections) plus an authenticated editor desk (React/TanStack Router SPA over server functions and a Postgres/PGLite-backed queue) for filing leads, drafting, and publishing. QA focused on the desk's state-changing runtime flows and adversarial input handling per the assignment, using a real running build against an isolated, empty database.

## Flows exercised

| Flow | Result | Findings |
|---|---|---|
| First-run desk creation (mismatched password) | Pass | — |
| First-run desk creation (matching password) | Pass | — |
| File a lead — empty submit | Pass (client-blocked) | — |
| File a lead — XSS payload in Headline/Why Now | Pass (escaped, inert) | — |
| Story workbench — Publish with empty Body | Pass (button disabled) | — |
| Story workbench — Publish with content | Unverified | QA-001 |
| RSS feed (`/feed`) | Pass | — |
| Delete / restore-from-trash / corrections / Dark Desk / two-lane drainer | Not exercised | QA-001 |

## Adversarial scenarios exercised

| Scenario | Outcome | Findings |
|---|---|---|
| Signup with mismatched confirm-password | Inline validation, no request sent | — |
| Empty lead form submit | No request sent, queue stayed at 0 | — |
| `<script>`/`onerror` payload in lead Headline + Why Now | Rendered as literal text, no execution | — |
| Rapid triple-click on Publish | Inconclusive — tab hijacked mid-sequence | QA-001 |
| Direct URL navigation to `/desk/queue`, `/desk/published` while signed in | Transient "Opening the desk" screen, self-resolves ~2-3s | QA-002 |

---

## Findings

### [QA-001] — Major — Flow — Adversarial testing of publish/delete/restore/corrections could not be completed due to shared-tooling interference

**Evidence**
1. Filed a lead on the isolated :3195 instance with an XSS-payload headline, added Body text, and clicked "Publish to the paper."
2. A follow-up screenshot taken in the same turn showed the active tab rendering a different TownReporter session (Command Center, user "editor" not "QA Editor", queue count 0, 375×812 mobile viewport) at origin `http://127.0.0.1:3196` — a second, independently-running instance this audit did not start.
3. `tabs_context` at that point confirmed only one tab existed in this session's group, and its `origin` had changed from `3195` to `3196` without this audit navigating there.
4. A brand-new tab created via `tabs_create` specifically to escape the interference (`tab-1`) also drifted to `:3196` within two tool calls, then was reported closed ("Preview tab tab-1 is no longer open") on the next call.
5. Checked ground truth directly: `curl http://127.0.0.1:3195/feed` and the `/desk/published` page both show only the pre-existing "about" item — the QA lead was never actually published on :3195, confirming the publish click did not land where intended.
6. Environment: Chromium via Browser-pane MCP, Windows 11, isolated audit instance on port 3195; the interfering instance was on port 3196, PID 13636 (confirmed separately running, not this audit's own process).

**Why this matters**
The audit's assigned scope — publish, delete + undo, restore from trash, corrections, paste-editorial, repeated submits, back/forward, two-tab conflicts — is exactly the set of state-changing flows most likely to hide real bugs, and none of it could be verified end-to-end this session. This is not evidence the product is broken; it is evidence the audit is incomplete on its highest-value targets. Whoever picks this finding up should either get exclusive control of a Browser-pane session (no concurrent audits sharing the same MCP tab pool) or re-run with a scripted Playwright/Puppeteer harness pointed only at :3195, which would sidestep shared-tab interference entirely.

**Blast radius**
- Adjacent code: none — this is a test-environment/tooling gap, not a code defect.
- User-facing: none directly; indirectly, any real bug in publish/delete/restore/corrections remains unverified by this audit and could reach users unnoticed by this pass.
- Migration: none.
- Tests to update: none in-repo; recommend the next QA pass use an isolated, non-shared browser automation session (e.g., a dedicated Playwright context) rather than a pooled Browser-pane MCP tab.
- Related findings: QA-002 (its "resolves after ~2-3s" timing could not be cleanly isolated from this same interference).

**Fix path**
Not a code fix. Re-run the adversarial QA pass (publish, delete/undo, restore, corrections, paste-editorial, two-tab conflicts, mobile viewport, back/forward) with a browser automation session guaranteed not to be shared with another concurrent agent/session — either serialize audit runs against this port, or drive the isolated instance with a standalone Playwright/curl-based harness instead of the shared Browser-pane MCP pool.

---

### [QA-002] — Minor — Flow — Transient "Opening the desk… If this sits here, use Sign in." screen on direct navigation to a signed-in desk sub-route

**Evidence**
1. While signed in, navigated directly (not via in-app link) to `http://127.0.0.1:3195/desk/queue`.
2. Page initially rendered only: "EDITOR DESK — Opening the desk — If this sits here, use Sign in. [Sign in]" with no queue content.
3. Waiting ~2-3 seconds without any user action, the page then rendered the real Queue view correctly (leads list, filters, "File a lead yourself").
4. Same behavior observed on direct navigation to `/desk/published`.
5. Every occurrence observed coincided with the QA-001 shared-tab interference window, so a confound cannot be ruled out; this needs a clean re-test in an uncontested browser session before being treated as fully confirmed product behavior.

**Why this matters**
If this is genuine (not a tooling artifact), a user who bookmarks a desk sub-route, refreshes mid-session, or opens a link from Slack/email lands on a screen that reads like a failure state ("If this sits here, use Sign in") for a couple of seconds before self-resolving. That's a plausible source of "is this broken?" reports even though it recovers on its own. It is Minor rather than Major because it does self-resolve without any user action and did not require an actual sign-in in any observed case.

**Blast radius**
- Adjacent code: likely the desk-auth/session-hydration guard shared across all `/desk/*` sub-routes (the same "desk-auth" chunk appeared in network logs for every desk route hit directly).
- User-facing: any direct/refreshed navigation into `/desk/queue`, `/desk/published`, `/desk/opinion`, etc. — worth checking whether all desk sub-routes show the same transient state or just the ones tested.
- Migration: none.
- Tests to update: none known; recommend an e2e assertion that a signed-in direct navigation to each `/desk/*` route resolves to real content within a bounded time (e.g. under 500ms) rather than showing the "Opening the desk" copy.
- Related findings: QA-001 (same session, interference confound not fully ruled out).

**Fix path**
Re-verify in an uncontested browser session: time how long the "Opening the desk" state is visible on a cold direct navigation to each `/desk/*` route while already signed in. If it reproduces cleanly and consistently takes multiple seconds, look at whether the desk-auth guard is doing a blocking round-trip (e.g. `/api/auth/get-session`) before rendering instead of optimistically rendering from a cached session, and consider a lighter-weight loading state that doesn't read as a failure ("If this sits here, use Sign in" implies something is wrong).

---

## Performance snapshot

Not meaningfully collectable this session — the shared-tooling interference (QA-001) made timing measurements unreliable (multiple page loads observed were for the wrong instance). Cold-start of the isolated server process itself: `Listening on http://localhost:3195/` appeared within ~3 seconds of process launch, no errors.

## Security / privacy snapshot

- XSS: raw `<script>` and `onerror`-attribute payloads in lead Headline/Why-Now fields rendered as inert escaped text — no injection observed. This is the strongest signal from this audit and should be read as a genuine pass, not a "couldn't test" item, since it was directly observed via screenshot with no confounding interference at the moment of observation.
- Auth: could not test authorization boundaries (e.g., a second account attempting to see the first account's leads) or session-expiry behavior this session — no second account was created, and the shared-tab interference made even single-account flows unreliable past the early steps.
- CORS/mixed-content: not assessed.

## Console and log observations

Browser console was clean (no errors) across every check performed on the correct :3195 instance. Server-side log (`.output` process on :3195) showed only two expected startup warnings (`BETTER_AUTH_SECRET` length/entropy — an artifact of the audit's throwaway secret, not a product default) and one rate-limiting fallback warning (expected given no reverse-proxy IP headers in this isolated launch) — no 5xx responses, no stack traces, no crash, for the full session including up to process termination by PID.

## Patterns and systemic observations

The one systemic pattern worth flagging to engineering isn't in the product at all: this was the second audit-related session observed running concurrently against a TownReporter instance on an adjacent port (3196) during this session, sharing the same Browser-pane MCP tab pool as this audit's session. If audits/gates are going to run in parallel against this app going forward, each should get an isolated browser automation context (separate Playwright process, or a Browser-pane session verified not to share tabs) — pooled/shared tabs make any concurrent adversarial QA pass unreliable through no fault of the product.

## Appendix: environments and artifacts

- Browser: Chromium via Browser-pane MCP tooling (`mcp__Claude_Browser__*`), viewports 1280x800 (intended) and one incidental 375x812 (on the interfering :3196 instance, not usable as a mobile-viewport TownReporter finding).
- OS: Windows 11 Pro.
- Server under test: `node .output/server/index.mjs`, `PORT=3195`, `DATABASE_URL` unset, `TOWNREPORTER_VOICE_FILE` unset, `BETTER_AUTH_SECRET=audit-qa`, PID 32136, terminated by PID at end of session.
- Interfering instance observed (not under this audit's control): `http://127.0.0.1:3196`, PID 13636 — left running, not touched.
- Production `:3000` (PID 5756) and `:5432`/`:5433` were never contacted by this audit.
- Prior artifact reviewed: `artifacts/walkthrough-2026-08-30/REPORT.md` (first-run walkthrough — read-the-paper, create-desk, file-a-lead, voice-absent — not repeated here).
