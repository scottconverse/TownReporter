# TownReporter — Session Handoff (2026-09-04)

You are picking up work on **TownReporter**, a self-hosted civic newspaper for Longmont, Colorado, live at https://townreporter.org. Read this whole file before acting. It is written to be self-contained **from the repo alone** — everything you need is committed here; do not assume any local disk, memory files, or Desktop notes.

---

## TR-001 repository implementation update

The Reddit pacing/routing fix is implemented in this repository; see [the implementation receipt](artifacts/dark-desk-review-2026-09-03/TR001-IMPLEMENTATION.md) for local gates and independent proof. It includes shared cooldown, body-complete serialization, paced guarded redirects, and redd.it-to-RSS resolution. The older open-defect wording below records the pre-fix state. Confirm CI on the exact current commit before handing it to the Halo-local Claude session for owner-directed staging and promotion. No deployment or live Reddit success is claimed here. The next development priority after this handoff is newsroom-scoping the monitor path.

## REMOTE / REPO-ONLY BOUNDARY — read first
If you are a remote session working **only from this GitHub repo** (no access to the owner's local Windows box):
- **You CAN:** read all code/docs/migrations/`scripts/`/`ops/`, understand the whole system, make changes, and `git push` to `main` — **CI runs on GitHub** (14 jobs, incl. a real-Postgres job that validates migrations + schema parity). You can also clone the owner's doctrine repos (`civic-scanner`, `civic-newsroom`, `civic-transparency-toolkit`, `CivicNewspaper`) for the Dark Desk "do it right" pass.
- **You CANNOT (these need the owner's local machine + live infra):** run `ops/stage.ps1` / `ops/promote.ps1` / the watchdog; touch the live Postgres (`townreporter` on 127.0.0.1:5433) or the prod checkout `townreporter-web`; read local DB backups; read the owner's local memory dir or `Desktop\TOWNREPORTER-TODO.md`. The `ops/*.ps1` scripts are in the repo so you can READ them, but they only run on the local box.
- **Therefore your job as a remote session:** land vetted, CI-green changes on `main` (delegate to subagents, keep it green), then tell the owner it is ready. **The owner is usually remote too and cannot run anything on the machine himself** — staging and promotion are done ONLY by a separate LOCAL Claude session on the owner's machine, at his direction. A change is not "live" until that local session stages on real data and promotes. Never claim something is live from a remote session; you can only claim "merged to main, CI green, ready to promote."
- Standing rules and gotchas below (§2, §3) are the full set — they are inlined here precisely because you can't read the local memory dir.

---

## Update 2026-09-05 — 0.6.18 and 0.6.19 are live

**What shipped:** 0.6.18 (2026-09-05, LIVE) fixed the interrupted-draft UI contradiction, added a promote job guard to refuse promotion when drafts are running, newsroom-scoped the monitors list, added a PRINTED chip that names and links to the matched story, marked non-profit in the copy, and wired reddit listings via .rss feeds. 0.6.19 (2026-09-05, LIVE, tag v0.6.19 at 25bc882) added four major features: claims-of-absence editorial gate (no tool-talk in drafts; gate source at `src/lib/news/absence-gate.ts`), targeted city-site pulls for the memo's actual asks (`article-extract.ts`), site-notice integration (`report.ts` pulls), and server-side publish refusal when claims are invalid (`desk.ts` performPublish); local model discovery for LM Studio (127.0.0.1:1234) and Ollama (127.0.0.1:11434) with per-model picker in every picker, thinking turned off, per-newsroom override (discovery in `src/lib/news/local-models.ts`, `provider-availability.ts`, settings in `provider-settings.ts`, docs in `docs/local-models.md`); dark desk styling (black background, white text); and Check r/longmont progress with a result panel showing near misses and File-as-tip.

**The incident that drove the gate:** a draft claimed "no city survey page was obtained" while the city page existed in the fetches; the owner's outside audit caught it before publish. Replayed on staging with 0.6.19 → the paper pulled the survey page correctly, the launch release itself landed the story with correct claims, no tool-talk, and the gate had nothing to block. The absence-gate `src/lib/news/absence-gate.ts` lines 32–67 check claims against opened documents, and `desk.ts` `performPublish` lines 211–220 refuse publish when claims fail.

**Local model facts:** LM Studio runs on `127.0.0.1:1234` with 20 chat models loaded, none active on startup; Ollama runs on `127.0.0.1:11434` with `gemma4:12b`, `gemma4:e4b`, and `translategemma:4b` loaded. Thinking models no longer require `reasoning_effort` (now automatic). Default when nothing is loaded = first chat model listed (currently a coder model); editors should pick a writing model in the picker or load one in LM Studio.

**Owner rules added today:** dark mode uses black background and white text (not gray). Every AI surface reads one provider registry, so a local entry is config-only and sits alongside cloud providers (no double registry). UI/UX is co-equal with code quality.

**Redesign state:** a clickable prototype canvas exists as a Claude Design artifact (direction A "Front page", dark by default, story view two-column with the claims-of-absence block visible). The owner has not yet given a verdict. Static sketches B and C sit beside it. No redesign work starts until the owner walks direction A and decides.

**What's next (from TODO.md open queue):** Redesign phase 2 (owner verdict), then work through #2 (monitor scoping before manual watch), #3 (manual "watch this page" button), #4 (legal removal), #5 (About-page non-profit + welcome seed), and #6 (Topics / sections, pending Scott's list). Always confirm each with Scott. Verify each on real staged data before promoting.

**Verify/CI state:** Staged on real data. Incident replay proved the gate. CI 14/14 green. All promotes checked OK. 26 stories intact.

### 2026-09-06 — 0.6.20 and 0.6.21 live; direction A stage 1 shipped

**VERIFIED by the local session 2026-09-06.**

0.6.20 shipped the five desk rule defects from the design audit (14px floor, Large text scales headlines/panes, one button family + destructive buttons styled, Held/set-aside chips) with guard test scripts added. The release was staged on real data (29 stories intact), promoted successfully, and the served version now reads 0.6.20.

The design audit verdict from 2026-09-05 (quoted): "Fable is better for this paper. Codex looks more finished. Fable is the design that still belongs to TownReporter: newsroom words, black desk, scores and Hold/Kill, rust on cream, no marketing banner on the editor's first screen. Use Fable's system. Take only two things from Codex: more air in the queue, and a Follow-ups list on the rail. Don't take the teal sidebar product." Agreed plan: (1) the five rule defects shipped first (0.6.20, done); (2) the redesign build uses direction A (queue as the lead column; Dark Desk + the wire in a right rail), more air in queue rows (headline first, why line under it, actions on their own line, nothing hidden), a Follow-ups object on the rail (who was asked, for what, due when, "overdue" stated in words), and a real narrow-window layout; nothing from the Codex chrome (no sidebar, teal, tiles, banner).

**0.6.21 (2026-09-06, LIVE, tag v0.6.21 at 08eef0a) shipped direction A stage 1 complete:** the redesigned Command Center with queue as the lead column, Follow-ups and Dark Desk tabs alongside it, the wire rail on the right, airier queue rows (headline first, why-line below, actions on their own row), and a Follow-ups object tracking who was asked, for what, and due when. The Follow-ups code lives in `src/lib/news/follow-ups.ts`, `src/components/follow-up-item.tsx`, and `src/routes/desk.follow-ups.tsx`; migration 0042 adds the schema. The spec is in `docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md` and the prototype in `docs/design/prototype/Main.dc.html`. Responsive layout was measured clean at six widths (1440, 1280, 1024, 900, 762, 390 px), with guard tests in `scripts/desk-cc-grid-min-width.test.mjs` and `scripts/desk-min-font.test.mjs`. Next stages are stage 2 (story page aligned to the prototype's two-column view) and stage 3 (narrow story layout); other tabs remain as they are.

**Owner decisions still open:** section list; legal-removal retain policy; whether the old Dark Desk methods are adopted.

### 2026-09-06 — 0.6.22 live; direction A complete

**VERIFIED by the local session 2026-09-06.**

0.6.22 (tag v0.6.22 at 2508cdc) shipped direction A stage 2, aligning the story page to the prototype: 380px lead column with a right sidebar (read story/drafting pane), a second column layout at viewports ≥1024px with single-column layout below, wrapped source URLs, and headline scaling with Large text. A plain local model row was added as a second display row. The release was staged on real data (26 stories intact), promoted successfully, and the served version now reads 0.6.22. Direction A is now complete for the two Command Center screens that the editor uses most; other tabs (Sources, Scan, Published, Opinion, Server, Stats) remain unchanged by design.

### 2026-09-06 — 0.6.23 live; Dark Desk doctrine restored

**VERIFIED by the local session 2026-09-06.**

0.6.23 (tag v0.6.23 at b52a3ae) shipped the owner's restored Dark Desk doctrine with full implementation: two-stage verification (Black Desk → Dark Signal), four mandatory gates (newsworthiness, claims-of-absence, city-data validation, self-referential), adversarial search postures (three modes: standard, paranoid, confirmation-seeking), and search minimums. The absence gate now searches a four-rung ladder (official domains, city-wide, document-word synonyms, local press) before asking the editor to confirm when all rungs return empty. Reddit community-life search was extended to eight rotating groups (govt/infra/business/schools/housing/health-safety/community/arts) with change-signal scoring (closing/opening, laid off, sold, etc.). Scanned PDF documents now extract embedded page images and ask the picked model to transcribe them, with honest OCR-needs reasons shown in words on Dark Desk's "What to read" list and the story page's "Documents opened" (vision capability is labeled per-model). llama.cpp discovery was added alongside LM Studio and Ollama with zero-config auto-detection on 127.0.0.1:8080. Opinion desk and Paper setup each gained a Copy button and County field (which had a read-only column that was never written until now). The last newsroom-1 default was fixed on both read and write sides of capture_events (migration 0043).

**Dark Desk doctrine source:** the guiding prompts and doctrine originate from the owner's own repos: `civic-scanner`, `civic-newsroom`, `civic-transparency-toolkit`, and `CivicNewspaper`. Implementation gate sources: `src/lib/news/dark-gates.ts` (gate orchestration), `src/lib/news/dark-verify.ts` (verification logic and search ladder), `docs/dark-desk.md` (operator documentation).

**Absence gate ladder:** (1) official domains (registered city, library, school sites); (2) city-wide search (all pages at the registered domain root); (3) document-word synonyms (parsed article content + AI-generated alternatives + local context); (4) local press (other newsroom sites, community blogs, social media).

**Legal removal policy (owner decision, 2026-09-06):** when a published story is removed by legal order, the removal record keeps a SEALED, owner-only copy of the removed text that auto-deletes after 12 months. When the reason is an explicit court order to destroy, keep nothing.

**Next verification step:** five live Dark Desk runs on the LIVE paper. Owner topics: (1) did a second Democrat in the 2025 mayoral race split the vote against Shakeel Dalal; (2) what is the city not telling us about the 2027 budget. Report per run: stage reached, gates passed/missed, the searches run with tiers and outcomes, newsworthiness verdicts, what reached the queue.

**Verify/CI state:** CI 14/14 green. Staged on real data (30 published stories intact). Promote checks OK. Served version reads 0.6.23. Backup townreporter_2026-09-06_1435.sql taken on promote.

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
