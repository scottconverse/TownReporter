# TownReporter — Session Handoff (2026-09-04)

You are picking up work on **TownReporter**, a self-hosted civic newspaper for Longmont, Colorado, live at https://townreporter.org. Read this whole file before acting. It is written to be self-contained **from the repo alone** — everything you need is committed here; do not assume any local disk, memory files, or Desktop notes.

---

## REMOTE / REPO-ONLY BOUNDARY — read first
If you are a remote session working **only from this GitHub repo** (no access to the owner's local Windows box):
- **You CAN:** read all code/docs/migrations/`scripts/`/`ops/`, understand the whole system, make changes, and `git push` to `main` — **CI runs on GitHub** (14 jobs, incl. a real-Postgres job that validates migrations + schema parity). You can also clone the owner's doctrine repos (`civic-scanner`, `civic-newsroom`, `civic-transparency-toolkit`, `CivicNewspaper`) for the Dark Desk "do it right" pass.
- **You CANNOT (these need the owner's local machine + live infra):** run `ops/stage.ps1` / `ops/promote.ps1` / the watchdog; touch the live Postgres (`townreporter` on 127.0.0.1:5433) or the prod checkout `townreporter-web`; read local DB backups; read the owner's local memory dir or `Desktop\TOWNREPORTER-TODO.md`. The `ops/*.ps1` scripts are in the repo so you can READ them, but they only run on the local box.
- **Therefore your job as a remote session:** land vetted, CI-green changes on `main` (delegate to subagents, keep it green), then tell the owner it is ready. **The owner is usually remote too and cannot run anything on the machine himself** — staging and promotion are done ONLY by a separate LOCAL Claude session on the owner's machine, at his direction. A change is not "live" until that local session stages on real data and promotes. Never claim something is live from a remote session; you can only claim "merged to main, CI green, ready to promote."
- Standing rules and gotchas below (§2, §3) are the full set — they are inlined here precisely because you can't read the local memory dir.

---

## 0. Your role & how to work
- **You coordinate; you do NOT hand-write feature code.** Delegate implementation to Sonnet subagents (Opus for hard/trust-boundary work, Haiku for cheap mechanical jobs). You brief, gate, review diffs, run CI, stage, tag, promote. This is a hard, repeated owner rule — burning premium (Fable) budget on grunt coding is the thing that most annoys the owner.
- **One heavy agent at a time** (protects the live box + budget). Subagents here have a habit of spawning a nested agent and pausing on their own background test run — when that happens, check the working tree and send them a message to "finish in the FOREGROUND: run the gate, commit, push."
- **Owner (Scott) preferences:** deliver decisions inline in chat (never modal pickers); every decision he must make gets its own labelled block with plain-English meaning, ≤2 options, your pick + why. Report outcomes, not process. Talk plainly (he uses an ELI5/plain-English output style). Don't passive-wait on background jobs — proactively check when they should be done (a promote is ~2-5 min; don't idle 30+ min for the notification).
- **Standing rules** are fully inlined in §2/§3 below (the owner's local memory dir has more, but a remote session can't reach it — you don't need it; §2/§3 are the binding set).
- **The open TODO** is §7 below (the owner also keeps a local `Desktop\TOWNREPORTER-TODO.md`, not in the repo).

## 1. Where everything lives
- **Dev repo (do all work here):** `C:\Users\scott\Desktop\Code\townreporter-dev` — git remote is named **`github`** → https://github.com/scottconverse/TownReporter.git
- **Production checkout (NEVER edit/build/kill directly):** `C:\Users\scott\Desktop\Code\townreporter-web` — remote **`origin`**, same repo. It runs the live site on port 3000. `ops/promote.ps1` lives here and promotes the install it lives in.
- **DB:** one PostgreSQL server on `127.0.0.1:5433`. **Prod DB = `townreporter`**, dev = `townreporter_dev`. Tests/PGLite: run everything with `DATABASE_URL=""` to use the embedded PGLite fallback.
- **Backups:** `C:\Users\scott\Desktop\Code\townreporter-backups\` (a dump is taken on every promote).
- Stack: TanStack Start (React) + Vite + Nitro built server; `npm start` = `node .output/server/index.mjs` (honors PORT/HOST). AI via local CLIs (`claude`, `codex`) + an OpenAI-compatible gateway (LLM_BASE_URL).

## 2. BINDING rules (do not violate)
- **Never touch `townreporter-web`, port 3000, port 5432, or Postgres port 5433's `townreporter` DB with builds/kills.** Stage on `townreporter_dev` (port 3100) or PGLite on spare ports.
- **UI/UX is co-equal with code (maybe more).** Working-but-invisible is a BUG. Every action needs clear feedback (success/pending/empty/error) and a link to where the result went. Do a real browser UX walk on anything you build. (This session's "Send to the queue did nothing" — it worked but gave no confirmation — is the failure to never repeat.)
- **Old-eyes readability:** WCAG AA both themes, nothing informational under 14px, no meaning by color alone, near-white body text in dark mode.
- **Stage before promote** (binding): restore latest prod backup into `townreporter_dev`, build, serve on 3100, walk the changed screens, THEN promote. `ops/stage.ps1` (creates a throwaway editor `staging@townreporter.test` / `staging-walk-2026`).
- **Never run `claude`/`codex` logout.** Kill processes only by PID after matching their cmdline — never by image name.
- **"anywhere an AI acts, the editor can pick the model"** (model picker + preflight + failover everywhere).
- **Redesign is ON HOLD** — do not restyle/re-layout the desk until Scott decides (he may bring a designer). Accessibility fixes are OK.
- **Claim discipline:** a negative/absence claim is a probe, not a conclusion; verify from a second source / the running system; never claim "done/works" beyond the user-visible evidence.

## 3. Operating gotchas (learned the hard way this session)
- **Shared Postgres caused a live outage:** prod + dev + all tests share the one 5433 server. Heavy DB test suites (schema-parity, leakguard) starved the live app → intermittent white-screen. **Never run DB-heavy suites against 5433 while prod is live; use PGLite.** Test tooling that defaulted to prod was fixed (pg-admin no longer defaults to 5433; smoke no longer defaults to port 3000) — keep it that way.
- **The public page white-screened** because a failed identity fetch made `<PaperProvider value={undefined}>`. Fixed (falls back to DEFAULT_PAPER_IDENTITY). `promote.ps1` now verifies real page CONTENT, not just HTTP 200 (a 200 error page slipped through before).
- **`npm version` lockfile trap:** on this Windows box it silently strips nitro's transitive `lru-cache` from `package-lock.json`, breaking `npm ci` on Linux CI. After any version bump / dep add, verify `grep -c lru-cache package-lock.json` still matches HEAD and restore the block if stripped.
- **Don't launch background server commands through `| Tee-Object`** — the detached server keeps the pipe open and the task chip shows "Running" forever (zombie). Use `*> logfile` / file redirection so the launcher exits.
- **`npm run build` runs `db:migrate` against 5433 by default** — always prefix with `DATABASE_URL=""` for dev/test builds.
- **Edit tool converts CRLF→LF silently** on this repo (autocrlf=true). Verify line endings after edits.

## 4. Release & ops workflow
1. Delegate the change to a subagent → it commits to `main` (usually no version bump).
2. Bump version (all guarded surfaces: `src/lib/version.ts`, `package.json`, README badge+bullet, `docs/setup.md`, `docs/editor.md`, `docs/manual.md`, `SELF-HOSTING.md`, `docs/index.html`, `CHANGELOG.md`). Guards: `scripts/versions-agree.test.mjs` + `scripts/editorial-delivery-docs.test.mjs`.
3. `git push github main` → watch CI: `gh run watch <id> --exit-status` (14 jobs; the `postgres-integration` job validates migrations + schema-parity against real Postgres, which local PGLite skips).
4. Stage: `powershell -ExecutionPolicy Bypass -File ops\stage.ps1` (serves 0.6.x on 3100). Walk the changed screens in a browser.
5. Promote (from the WEB checkout): `cd townreporter-web; git checkout -- src/routeTree.gen.ts` (generated file often dirties and blocks promote), then `powershell -ExecutionPolicy Bypass -File ops\promote.ps1 *> logfile`. It backs up the DB, stops, ff to origin/main, builds, restarts, verifies content. **Get Scott's "go" before promoting** (production).
6. Verify served bytes: `curl -s --compressed https://townreporter.org/ | grep -aoE '0\.6\.[0-9]+'` and confirm real content.

## 5. What shipped this session (0.6.6 → 0.6.16)
- **0.6.6** — CI browser walks run against the BUILT server (not flaky Vite dev).
- **0.6.7** — Automatic fails over to Codex on a TIMEOUT/zero-output, not only a sign-in lapse. **(live-bug fix)**
- **0.6.8** — durable "why the draft switched models" note on the story page.
- **0.6.9** — removed an invented "reader privacy / zero trackers" positioning (kept the useful self-contained-page CI check, renamed).
- **0.6.10** — Local model (llama.cpp / LM Studio / OpenAI-compatible) is a pickable writing model on every surface. **(Its Opul/Opinion routing Blocker + a paid-cloud-fallback risk were found by audit and fixed in 0.6.13.)**
- **0.6.11** — newsroom_id data-integrity (Dark Desk rebuild schema, migration/ensure parity + a parity test, ~33 scoped inserts). `source_monitors` still NOT newsroom-scoped (known follow-up).
- **0.6.12** — stale sign-in cancel can't taskkill an unowned PID; CI coverage for Scan & Sources.
- **0.6.13** — audit-fix + outage-hardening release (Opinion-local Blocker, cloud guard, test/ops no longer default to prod, public-page fallback, promote verifies content).
- **0.6.14** — **Stats tab** (editor-only): anonymous site + per-story view counts via a fail-safe beacon (`/api/view`, page render does zero stats work).
- **0.6.15** — **Dark Desk plumbing fix** (see §6). LIVE (commit 3b21bcc). Live pile had 247 poisoned/zombie rows retired (operator receipt: `artifacts/dark-desk-review-2026-09-03/RECEIPTS-2026-09-04.md`).
- **0.6.16** — LIVE (86b542f): Dark Desk actions confirm clearly (Send-to-queue links to the lead; visible feedback on every action). CI 14/14, promoted + verified.
- Also live (via prod DB edits, and in source for the next release): masthead deck/banner + welcome article now say **"non-profit"**. About-page "civic→non-profit" is source-pending.

## 6. Dark Desk — how it works, what was fixed, what's left
**What it is:** the investigative engine ("investigates, never prints"). An editor opens a file (paste URL/name/LLC/topic); the model proposes searches + URLs; the APP fetches them; it accumulates captures, writes signals/leads, and a brief. Also a 5-min cron (`ops/cron-tick.ps1` → `/api/cron/monitors`) re-checks due `source_monitors` (~daily cadence). Reddit tips via a "Check r/longmont" button.
**Guiding prompts (this IS Scott's doctrine, drifted):** `src/lib/news/dark-prompt.ts` (`DARK_SYSTEM`, `DARK_PLANNER`, `darkSystemFor`), `dark-brief.ts` (`BRIEF_SYSTEM`). The loop is in `dark.ts` + `investigate.ts`; tool-free fetching/search is `search-web.ts`.
**The bug that made it useless (fixed in 0.6.15):** the dig ran the local `claude` CLI as a live AGENT with `--allowed-tools ""` = a denied-but-visible tool surface. The model tried Bash/WebFetch/etc., got refused, and wrote sandbox-escape musings into the leads. Fixes:
- **F1** run the dig tool-free (`--tools ""`), model emits JSON queries/URLs, app fetches.
- **F2** real article extraction (`@mozilla/readability`+`linkedom`) — captures the article, not the nav menu.
- **F3** filter tool-refusal/self-referential junk from ALL model outputs (with a false-positive guard).
- **F4** dedupe leads by canonical URL + cap zombie dead-ends (migrations 0038/0039).
- **F5** fetch reddit via `.rss`/browser-UA with 8s pacing. Routing IS wired (independently confirmed: `investigate` → `ingestDocument` → `ingestRedditIfNeeded` → `fetchRedditDocument` → thread `.rss`). **KNOWN OPEN DEFECT — TR-001 (Major):** the shared pacer is NOT concurrency-safe (`src/lib/news/reddit.server.ts` ~45-49) — two waiters wake together and fire in parallel, breaking the ≥8s/never-parallel rule; a live thread fetch returned HTTP 429 in independent verification. Also `redd.it` short links aren't resolved by the old.reddit fallback. See RECEIPTS file for the reproduction. **Fix this first.**
- **F6** honest page (readable-vs-blocked counts, blocked-dig banner, evidence-graded findings, exclude failed captures from synthesis).
- **F7** retired 247 poisoned/zombie prod rows (status→exhausted, reversible).
- **Proof (qualified):** a staged dig on the budget topic captured the real 2027 Budget PDF ("$547.5M, 5.32%...") with deduped real leads and zero junk — recorded as an operator receipt in `RECEIPTS-2026-09-04.md` (not repo-reproducible). This proves the pipeline on one real topic on a staged copy; the Reddit leg was NOT proven (it showed "blocked" there and 429'd in independent review). Independent verification (2026-09-04) confirmed main is CI-green and 0.6.16 is served, but rated the "fully fixed" wording as overstated — treat Dark Desk as "core dig works; Reddit pacing has an open Major defect."
**"Do it right" pass (PARKED, Scott's call, needs testing first):** grant the dig a CURATED, SAFE tool set (guarded web search/fetch with SSRF + domain limits + cost caps — like his civic-scanner) so it investigates live; and restore his fuller doctrine (two-stage Black Desk→Dark Signal verification, mandatory adversarial gate, self-referential Gate 4, search minimums) — ONLY after testing whether the 6-month-old prompts still hold up. His originals: repos **civic-scanner** (mature Claude Code skill), **civic-newsroom**, **civic-transparency-toolkit**, **CivicNewspaper**.

## 7. Open queue (priority order, per the 2026-09-04 independent verification)
1. **TR-001 — fix the Reddit pacing concurrency defect** (§6, RECEIPTS). Serialize the request path with one shared queue/mutex, reserve the slot before awaiting, add a 3-concurrent-caller regression (strictly ≥8000 ms apart, max 1 in flight). Also resolve `redd.it` short links. Repo-only task; CI-verifiable.
2. **`source_monitors` newsroom-scoping** — still pinned to DEFAULT_NEWSROOM_ID (the honest STOP from 0.6.11). Do this BEFORE exposing manual watch controls.
3. **Manual "watch this page" for Dark Desk** — wire the existing `watchSource` to an editor button (after #2).
4. **Legal removal** — one-click legal takedown (immediate purge + audit trail + flag which on-disk backups still hold the item). Normal delete keeps a 30-day restorable copy AND stays in backups.
5. **About-page "civic→non-profit"** + a welcome-article seed migration (source; ride a release).
6. **Topics / sections** — expand beyond the current civic topic list (business, etc.). Needs Scott's section list. (Phase 8)
7. **The Dark Desk "do it right" pass** (§6) — parked; needs testing of the old prompts first.
- **Redesign** — on hold, Scott's decision.

## 8. Key files
- Dark Desk: `src/lib/news/dark-prompt.ts`, `dark-brief.ts`, `dark.ts`, `investigate.ts`, `search-web.ts`, `article-extract.ts`, `ingest.ts`, `html-text.ts`, `reddit.ts`/`reddit.server.ts`; route `src/routes/desk.dark.tsx`.
- Providers/models: `src/lib/news/provider-registry.ts`, `ai.ts`, `ai-claude-code.server.ts`, `ai-codex.server.ts`, `model-choice.ts`, `automatic-failover.ts`.
- Paper identity: `src/lib/paper.ts` (PAPER defaults), `paper-context.tsx`, `src/lib/news/paper-settings.ts`; root loader `src/routes/__root.tsx`.
- Stats: `src/lib/news/views.ts`, route `src/routes/api/view.ts`, `src/routes/desk.stats.tsx`.
- Ops: `townreporter-web/ops/promote.ps1`, `townreporter-dev/ops/stage.ps1`, `watchdog.ps1`, `start-townreporter.ps1`, `cron-tick.ps1`.
- Saved reviews: `artifacts/dark-desk-review-2026-09-03/` (incl. `RECEIPTS-2026-09-04.md` — the operator receipts for the staged-dig proof, the 247-row cleanup, and the promotes), `artifacts/audit-lite-2026-09-03/`, `artifacts/gate-townreporter-2026-09-02/`.

## 9. Immediate next steps
1. **Dark Desk core dig is shipped + live (0.6.16; CI 14/14; served version verified).** One open Major defect remains: **TR-001 Reddit pacing concurrency** (§6/§7 #1) — fix that first. Claims are qualified per the independent verification; receipts are in the RECEIPTS file.
2. Then work §7 in order (monitor scoping → manual-watch → legal removal …), confirming each with Scott. Redesign stays on hold.
3. GitHub issues filed with Anthropic this session (context, not action): Fable delegation, cross-session messaging, sticky Fable→Opus downgrade.
