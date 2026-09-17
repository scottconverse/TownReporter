# GauntletGate — Walkthrough lane — TownReporter v0.6.3

Run date: 2026-09-02. Repo: `C:\Users\scott\Desktop\Code\townreporter-dev` at `f9c2a1a` (v0.6.3).
Production (`townreporter.org`, `townreporter-web`) was never touched, built, run, or entered.
Ports 3000 / 5432 / 5433 were never written to; Postgres 5433 was read only via `ops\stage.ps1`,
which is restricted to the `townreporter_dev` scratch database.

⚠️ **PARTIAL CHECK — lane run: `walkthrough`.** This is **not** an advancement gate. Run
`gauntletgate all` (walkthrough + full) for a clear-to-advance decision.

---

## Verdict summary

- **First-run line:** reaches core feature ✅ (**guided**, not silent) — every core action tried
  with the writing-model dependency genuinely absent (Draft with AI, Scan, Dark Desk "Start
  digging", Opinion) surfaced an in-product explanation and a concrete next step (an install
  command, `CLAUDE_CLI_PATH`/`ANTHROPIC_API_KEY` alternatives, a "Sign in to Codex" button, or —
  for Opinion — a no-AI "Paste a piece I wrote" fallback). No dead end on the core feature was
  found. First-run coverage: **VALID** (attestation below, with linked artifacts).
- **Severity roll-up (this lane only):** 0 Blocker · 0 Critical · 1 Major · 2 Minor · 1 Nit.
- **What's working:** first-run editor creation, paper setup, the desk nav, the queue/lead
  workflow, the Automatic writing-model ladder's auth-lapse fail-over (Claude Opus → Codex
  Terra), the Server page's dependency probe, and the populated-data desk/public site against a
  real production backup, all confirmed by direct interaction, not just code reading.

---

## 1. Environment-provisioning attestation (verified)

| What | State used | How it was VERIFIED |
|---|---|---|
| Profile / `APPDATA` isolation | Absent row: `C:\tr-gate-scratch\absent-appdata` (empty scratch dir). Present row: `C:\tr-gate-scratch\present-appdata`. | Directory listed empty before and after the run (`ls` — no files); the real `claude`/`codex` npm shims live under the real `%APPDATA%\npm`, which is a different, untouched path — confirmed by `where claude`/`where codex` resolving to `C:\Users\scott\AppData\Roaming\npm\claude(.cmd)` before the run, and by stripping that literal path segment from `PATH` for the shell that launched the dev server (`grep -vi 'AppData/Roaming/npm'`). |
| CLI dependency: Claude Code | ABSENT (probed) / PRESENT (probed, faked) | Absent: `CLAUDE_CLI_PATH` pointed at `C:\tr-gate-scratch\absent-path\no-claude.exe`, a file that does not exist, with the real `claude` shim also removed from `PATH`. The desk's own Server page (`/desk/ops`, "Writing models") probe read back **"NOT INSTALLED — Claude Code was not found on this machine."** — the genuine not-found message, not the `TOWNREPORTER_CLAUDE_CODE=0` operator-off message the repo's committed `.env` produces by default (see Finding 3). Present: `CLAUDE_CLI_PATH` pointed at `scripts/fakes/fake-claude-cli.mjs` with `FAKE_CLAUDE_SIGNED_IN=1`; a real draft job was run against it end to end (Finding evidence below). |
| CLI dependency: Codex | ABSENT (probed) / PRESENT (probed, faked) | Same method as Claude Code. Server page read **"NOT INSTALLED — Codex is not installed. Install the Codex CLI, then sign in from Codex and try again."** in the absent row. |
| First-run flags | Unset (no owner account) | `/login` served **"Create the desk"** (0 editors) on first navigation to the fresh PGLite instance, confirming a truly empty desk rather than a pre-provisioned one. |
| Data store | Empty (absent + present rows) / **Populated with real production data** (staging row) | Absent/present rows: `DATABASE_URL=""` → PGLite in-memory; Server page's own Health panel read **"embedded (PGLite) — data is lost when the server stops · 1 published · 0 drafts · 0 leads · 0 sources"** right after first-run setup, before anything was added. Staging row: `ops\stage.ps1` restored the newest production backup (`townreporter_2026-09-02_1812.sql`) into `townreporter_dev` and reported **"stories with a publish date: 19"**; the desk and public site (`http://127.0.0.1:3100`) showed real Longmont, Colorado civic content (published articles, 42 watched sources, a live Dark Desk queue), not sample text. |
| Network | Online (real internet reachable; only the model-CLI dependency was faked/removed) | Documented and observed: even in the dependency-absent/-present rows, the research pass's web-search chain (`src/lib/news/search-web.ts`) is unconditional per `docs/setup.md` and the fail-over draft job's "Documents opened for this draft" list showed live external URLs (`morningstar.com`, `highcountryspotlight.com`, etc.) — see Finding 4. |

**Isolation verified?** YES. **First-run coverage: VALID.**

**Evidence artifacts** (under `artifacts/gate-townreporter-2026-09-02/artifacts/walkthrough/`):
- `01-server-page-note.txt`, `01-server-page-dependency-absent.html` — env recipe and excerpted DOM state proving the genuine "not found on this machine" copy on both provider rows.
- `02-dependency-present-failover-draft.txt` — full transcript of the dependency-present Draft-with-AI run, including the earlier non-fail-over attempt kept as evidence for Finding 1.
- In-conversation screenshots (not re-saved as files, but captured and inspected at each step): create-editor screen (0 editors), paper-setup form, command-center after setup, Server page (both provider rows NOT INSTALLED), queue/lead filing, Draft-with-AI guided error (Scan/Dark Desk/Opinion), populated-data command center, Sources (42 on watch), Published (3 real Longmont stories), public front page, and a 375px mobile render of the public front page.

---

## 2. Provisioning matrix — cells covered

| | Dependency ABSENT | Dependency PRESENT (faked) |
|---|---|---|
| **First-run, empty data** | ✅ covered — port 3321. Create-editor → paper setup → tried Draft with AI, Scan, Dark Desk "Start digging", Opinion, all with nothing installed. | ✅ covered — port 3322. Create-editor → paper setup → filed a lead → Draft with AI (Automatic), confirmed job completion and provider fail-over. |
| **Returning, populated data** | Not separately constructed (would require removing the CLI from the *staging* environment, which the brief scopes to a read-only walk instead). | ✅ covered — port 3100, real production backup via `ops\stage.ps1`. Walked Desk, Sources, Published, public site, mobile viewport, signed in as `staging@townreporter.test`. Did **not** click Sign in/Test on Writing models, Run scan, Draft, Give up the desk, or Delete, per the brief. |
| **Offline (network egress blocked)** | Not constructed — the model CLIs were made absent/faked, but the search chain and page fetches were left reachable, per the brief's env spec (no instruction to sever egress) and consistent with `docs/setup.md`'s statement that the search chain is unconditional. Flagged as a documented limit, not a gap in this pass (Finding 4). | — |

Cells covered: **first-run × dependency-absent**, **first-run × dependency-present**, **returning × populated-data × online**. Not covered: **offline** (any row), **returning × empty-data** (no owner-but-no-content state was separately constructed; first-run-with-nothing-set-up is the practical equivalent covered above).

---

## 3. Numbered findings

### Finding 1 — Major: Automatic writing-model ladder does not fail over on a malformed-but-"successful" first-rung response
- **Route:** `/desk/queue/{lead}` (Story workbench), Automatic writing model, "Draft with AI."
- **Expected:** Per the picker's own copy — "Uses your configured gateway when set; otherwise tries Claude Opus, then Codex Terra. If the first one's login has lapsed, the draft moves to the next" — any failure of the first rung should hand off to the next.
- **Actual:** With Claude Code CLI reachable and reporting `loggedIn:true`, but returning a plain non-JSON `"ok"`-style response to the actual drafting call (a shape a live CLI can plausibly emit — a chat reply instead of the expected JSON draft envelope, not just an auth failure), the desk does **not** fail over to Codex. It surfaces: *"The draft came back in a form the desk could not read. Click Draft with AI again."* and stops. Re-clicking Draft with AI, or picking Codex Terra explicitly from the model dropdown, does work.
- **Evidence:** `artifacts/walkthrough/02-dependency-present-failover-draft.txt` (the "earlier attempt" section) and in-conversation screenshot at that step.
- **Likely cause:** `src/lib/news/ai.ts` / the report-drafting flow (`src/lib/news/report.ts`) appears to fail over on a recognized auth-lapse envelope (`is_error: true`, 401 — confirmed working, see below) but not on a successful exit with content the JSON-envelope parser (`coerceDraft`/`parseJsonBlock`) cannot extract fields from.
- **Suggested fix:** Treat "ladder rung ran, but produced no parseable draft" the same as "ladder rung's login lapsed" for fail-over purposes — move to the next configured rung instead of surfacing a manual-retry message, at least for the Automatic picker (an explicit single-provider choice can reasonably still show the read error).
- **Suggested test:** A drafting-flow unit/integration test where the first rung's CLI returns exit 0 with non-JSON content, asserting the ladder advances to the second rung rather than terminating.
- **Contrast (working correctly):** the actual documented lapsed-login scenario — Claude Code CLI returning the real 401 envelope (`FAKE_CLAUDE_FAIL_PROMPTS=1`, matching the fake's own docstring for "what a lapsed login mid-draft actually looks like") — **did** fail over correctly to Codex Terra and completed the draft end to end, with the resulting draft's own body text narrating the fail-over and the headline crediting Codex Terra. Confirmed via direct interaction (see `02-dependency-present-failover-draft.txt`).

### Finding 2 — Minor: repo-committed `.env` masks the genuine CLI-absent probe unless explicitly overridden
- **Route:** `/desk/ops` (Server → Writing models).
- **Expected:** With `CLAUDE_CLI_PATH` pointed at a nonexistent file and the real CLI removed from `PATH`, the Server page should read the CLI as genuinely not found.
- **Actual:** On the first attempt (shell env only, no override of `TOWNREPORTER_CLAUDE_CODE`), the Server page instead reported **"NOT INSTALLED — Disabled by operator — Turned off with TOWNREPORTER_CLAUDE_CODE=0."** — because the dev-convenience `.env` committed at the repo root (`townreporter-dev/.env`) already sets `TOWNREPORTER_CLAUDE_CODE=0` with the comment *"GauntletGate dependency-absent pass: make the model provider ABSENT."* `dotenv`-style loading does not override an already-exported shell variable, so exporting `TOWNREPORTER_CLAUDE_CODE=1` before launch was required to reach the real not-found probe path (used for all first-run findings above).
- **Why it matters:** A gate run (or any new contributor) that does not know to override this env var will silently exercise the "operator turned it off" code path instead of the "CLI genuinely absent" code path — two different UI branches with different copy, and only one of them is the true first-run new-user experience.
- **Suggested fix:** Either keep the off-switch out of the committed `.env` (move it to a `.env.gate-absent` invoked explicitly), or have the walkthrough tooling/docs call out that this override is required.
- **Suggested test:** N/A (process/config hygiene, not app behavior).

### Finding 3 — Minor: create-editor screen can be bypassed by an old signed cookie after a database reset
- **Route:** `/login` → `/desk/ops` (Set up the paper).
- **Expected:** A fresh, ownerless database should always present "Create the desk" first.
- **Actual:** When the dev server was restarted with the **same** `BETTER_AUTH_SECRET` against a fresh in-memory PGLite database (the second dependency-absent run, and again for the dependency-present run), navigating to `/login` skipped "Create the desk" and went straight to "Set up the paper" with the desk nav already visible — the browser's still-valid signed session cookie from the prior run was accepted even though the underlying editor record no longer existed in the new database.
- **Why it matters:** In this walkthrough it was harmless (same operator, same intent) and is very unlikely to matter for a real single-operator deployment, since the secret and the database are normally restored/rotated together. Flagged because it means an *editor session* was accepted with no matching database row, which is worth a second look if session validation is ever expected to be strictly DB-backed.
- **Suggested fix / test:** Confirm the session lookup path always round-trips through the current DB rather than trusting the signature alone; add a test that a valid-signature cookie for a since-deleted/reset owner is rejected.

### Finding 4 — Nit: "dependency-absent" cannot be made fully network-isolated for Draft/Scan/Dark Desk
- **Route:** Draft with AI, Scan, Dark Desk "Start digging" (research pass).
- **Observation:** Even with both model CLIs absent (and, in the present row, faked), the research pass's web-search chain (Exa → DuckDuckGo → Bing → Brave → Wikipedia) made real outbound requests — visible directly in the fail-over draft's "Documents opened for this draft" list of live third-party URLs. This matches `docs/setup.md`'s own disclosure ("no setting to keep a search on this machine — the chain is unconditional") — it is documented behavior, not a defect — but it means a byte-for-byte "offline" cell of the provisioning matrix is not achievable for these three features without blocking egress at the OS/firewall level, which was out of scope for this pass.
- **Suggested fix:** None required; consider noting in `docs/setup.md`'s first-run section (not just the "what leaves this machine" table) that Scan/Draft/Dark Desk reach the internet even with no writing-model CLI configured.

---

## 4. Readiness by area

| Area | Status | Basis |
|---|---|---|
| First-run onboarding (create editor → paper setup) | **Working** | Walked end to end twice (absent + present rows); zero-editor state, form validation, and welcome-article rewrite all observed. |
| Core loop with dependency absent (Draft/Scan/Dark Desk/Opinion) | **Working, degraded-guided** | No dead end; every surface named the missing dependency and a concrete remedy. Opinion additionally offers a fully-offline "Paste a piece I wrote" path. |
| Automatic writing-model ladder fail-over | **Partially wired** | Works correctly for an auth-lapse (401) response (Finding 1 contrast); does not fail over for a same-exit-code unparseable response from the first rung (Finding 1). |
| Server page dependency probe | **Working** | Both provider rows correctly read "not installed" against a genuinely absent CLI, once the repo's own `.env` off-switch is overridden (Finding 2). |
| Populated-data desk (real backup) | **Working** | Command center, Sources (42), Published (19 stories, 3 inspected), public site, and mobile viewport all rendered real Longmont, CO content with no console errors observed. |
| Public site / reader-facing pages | **Working** | Welcome article on first-run empty desk; real published articles and section filters on the populated-data instance; clean 375px mobile layout. |

---

## 5. What's working

- Zero-editor detection and the "Create the desk" gate genuinely require an in-product first account — no setup token, matching `docs/setup.md`.
- First-run "Set up the paper" correctly rewrites the masthead, welcome article, and nav from the submitted paper name/city/state/timezone.
- Every core-feature entry point (Draft, Scan, Dark Desk, Opinion) degrades to a guided, actionable message rather than a silent failure or disabled control when its writing-model dependency is absent — this is the behavior the shared-backbone first-run rule exists to demand, and it is present here.
- The Automatic ladder's documented auth-lapse fail-over (Claude Opus → Codex Terra) was proven working end to end with real client/server code driving fake CLI processes, including a resilience banner ("The click dropped… this page is pulling the draft in") that kept the UI honest while the background job continued.
- `ops\stage.ps1` cleanly stages and tears down a real-data walk against `townreporter_dev` without touching production, the live port, or the live database — verified by its own printed checks and by the port being free after `-Stop`.
- No first-run coverage gap: the environment-provisioning attestation is fully verified with linked artifacts, per the shared backbone's requirement.
