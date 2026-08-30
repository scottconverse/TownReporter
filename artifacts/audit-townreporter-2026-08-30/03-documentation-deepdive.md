# Documentation Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-30
**Role:** Technical Writer
**Scope audited:** README.md, SELF-HOSTING.md, docs/manual.md, docs/setup.md, docs/editor.md, docs/dark-desk-editor.md, docs/local-models.md, SECURITY.md, .env.example, ops/*.ps1 headers, CHANGELOG.md (for version-claim cross-check), spot-checked against source (`src/lib/news/editorial.server.ts`, `src/lib/news/investigate.ts`, `src/lib/multiplayer/p2p.ts`, `src/routes/*`, `ops/install-tasks.ps1`).
**Writer mode:** audit-only (no Blocker/Critical doc gap found; no drafts produced)
**Auditor posture:** Balanced

---

## TL;DR

This is, plainly, an unusually honest doc set for a self-hosted project. Every claim I pulled and checked against the running code held: `EDITORIAL_TIMEOUT_MS` is real and matches the 45-minute ceiling described in `editor.md`; `VITE_STUN_URLS` is read exactly where `.env.example` says; `ops/install-tasks.ps1` exists and its header explains the TW-004 audit finding it was written to close; the route table in README and manual.md matches `src/routes/`; the PORT/8080-vs-3000 split (dev hard-coded to 8080, built server honoring `PORT`, default `3000`) is stated consistently across README, setup.md, and SELF-HOSTING.md. A first-time non-technical self-hoster following README → `npm run dev` → create-editor would succeed. I found zero Blockers and zero Criticals. The one real gap is structural rather than a lie: there is no CONTRIBUTING.md despite the audit-team scope expecting one, and a couple of small drift risks (a hardcoded PORT in a manual.md diagram label, and Part 6 of manual.md being a non-exhaustive env-var table with no "see .env.example for the full list" pointer) are worth a light touch.

## Severity roll-up (documentation)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 0 |
| Major | 0 |
| Minor | 3 |
| Nit | 1 |

## What's working

- **The docs self-audit their own history.** `.env.example`'s `HOST` block, `docs/setup.md`'s migration-timing note, and `ops/*.ps1` headers all narrate the actual bug that made the doc/script necessary (e.g. `ops/lib-port.ps1`: "PORT is documented as configurable, and the ops scripts hard-coded 3000 while an architecture diagram said 8080 — three answers to one question, which an audit filed as TW-005"). This is rare and valuable — it means stale claims get caught by the next reader instead of silently rotting.
- **SECURITY.md is exceptionally honest for a solo-maintainer project.** It explicitly flags its own weak point at the bottom ("*The reporting address above is a placeholder... before this file is fully load-bearing*") rather than pretending the reporting channel is airtight. Scope/out-of-scope sections are concrete and code-path-anchored.
- **README's five-minute quick start is accurate end to end.** `npm install` → `npx playwright install chromium` → `cp .env.example .env` → `npm run dev` → `http://localhost:8080` all check out against `vite.config.ts`'s hard-coded `strictPort: true` on 8080 and the actual first-run flow (create editor, no setup token — confirmed removed in 0.5.1 per `.env.example` line 74-77).
- **The model-resolution table (README, setup.md, .env.example, manual.md) is consistent everywhere it appears** — same four-tier order (LLM_BASE_URL/LLM_API_KEY → ANTHROPIC_API_KEY → nothing/Claude Code login → XAI_API_KEY), same wording, no drift between docs.
- **`docs/local-models.md` and `docs/dark-desk-editor.md` cite exact source lines** (`investigate.ts` `max_tokens: 2200`, `DARK_PLANNER` in `dark-prompt.ts`) and both check out against the actual code.
- **The route reference (README "Layout" table and manual.md Part 6 "Routes")** matches `src/routes/` exactly, including the newer `/evidence/:versionId`, `/evidence/compare`, `/get-the-code`, and `/TownReporter.zip` routes.

## What couldn't be assessed

- **Live-site claims in SELF-HOSTING.md** (the actual `netstat` output, the "measured after the change" DNS/tunnel behavior, the Cloudflare Email Routing DNS records) describe the maintainer's production box (`townreporter.org`), which is outside this DEV checkout and cannot be independently verified from the repo alone. They read as first-person field notes rather than generic instructions, which is appropriate for that document's stated purpose ("how this is actually running"), so I did not treat unverifiable operational claims as findings — just noting the boundary.
- **CI behavior** (`.github/workflows/ci.yml`, cited by SECURITY.md and docs/setup.md as running a Playwright lifecycle test) was not independently re-run; only its existence and rough shape were sanity-checked against docs claims, not its actual pass/fail history.

---

## Doc asset inventory

| Asset | Exists? | Status | Finding(s) |
|---|---|---|---|
| README.md | Yes | Strong | — |
| ARCHITECTURE.md (standalone) | No — folded into docs/manual.md Part 5 | Adequate | — |
| User manual / guide | Yes (docs/manual.md, docs/editor.md) | Strong | — |
| API reference | N/A — no public API surface beyond `/api/cron/monitors`, documented inline in setup.md/manual.md | Adequate | — |
| FAQ | Yes (README "Frequently asked questions") | Strong | — |
| CHANGELOG.md | Yes | Strong, accurate for 0.5.1 head entry | — |
| CONTRIBUTING.md | **No** | Missing | DOC-001 |
| SECURITY.md | Yes | Strong | — |
| LICENSE | Yes (MIT) | Adequate | — |
| Landing / marketing page | Yes (docs/index.html, GitHub Pages) | Adequate | — |
| Dark Desk UI contract | Yes (docs/dark-desk-editor.md) | Strong | — |
| Local-models research note | Yes (docs/local-models.md) | Strong | — |

---

## Persona walk-through

### First-time user
README answers "what is this" in the first paragraph, states the audience (a self-hoster who wants to run a civic newsroom for their own city) immediately, and the Read-this-first caption block honestly sets expectations about AI-assisted drafts before anything else. The five-command quick start is accurate and produces a running app; "did it work" is answered by `/login` → create editor → owner account. No non-technical stall points found.

### Returning user
The FAQ block in README covers the actual recurring questions a self-hoster would have (cost, city-swap, second editor, privacy, GitHub Pages confusion). docs/setup.md's "What will bite you" section is a well-targeted troubleshooting index. Cross-doc navigation (README → setup.md / editor.md / manual.md / dark-desk-editor.md / local-models.md) is a clean, non-circular tree.

### New team member
docs/manual.md Part 4 ("How it is built") and Part 5 ("Architecture," with Mermaid diagrams) give a new contributor enough to orient without reading every source file — server functions, the desk boundary (`deskMiddleware`), job kinds, and data model shape are all covered with file pointers that check out (`src/lib/news/desk-auth.ts`, `src/lib/news/membership.ts`, confirmed to exist and match SECURITY.md's identical citations). The one gap: there's no CONTRIBUTING.md telling a new contributor how to submit a change, run tests before a PR, or what the review bar is — they'd have to infer it from AGENTS.md/AGENTS.project.md, which README explicitly says are *not* TownReporter documentation ("they are the build-tool contract and personal handoff notes from the App Builder sandbox").

---

## Findings

### [DOC-001] — Minor — Completeness — No CONTRIBUTING.md, and README explicitly disclaims the file a new contributor would reach for instead

**Evidence**
`ls` of repo root shows no `CONTRIBUTING.md`. README.md lines 230-236 tell the reader that `AGENTS.md`, `AGENTS.project.md`, and `.grok/` — the only other root-level process docs — are "not TownReporter documentation... the build-tool contract and personal handoff notes from the App Builder sandbox this repo was originally scaffolded with."

**Why this matters**
For the *new team member* persona: SECURITY.md says this is "maintained by one person," so a low-traffic contribution path is plausible and this may be a non-issue in practice. But if someone does show up with a PR, there is currently no doc telling them how to run tests before submitting (`npm test` is documented, but not "run this before you open a PR"), what commit/branch conventions to use, or where to file a bug vs. a security report (SECURITY.md only covers vulnerabilities). This is a completeness gap, not an accuracy one — nothing here is false.

**Blast radius**
- Adjacent code: none — pure doc gap.
- User-facing: none for readers/self-hosters; only affects a hypothetical external contributor.
- Migration: none.
- Tests to update: none.
- Related findings: none.

**Fix path**
A short `CONTRIBUTING.md` (10-20 lines) pointing to `npm test`, `npm run typecheck`, the CI workflow, and clarifying that `AGENTS.md`/`AGENTS.project.md` are tooling scaffolding, not contribution guidance, would close this. Given writer mode is audit-only and this is Minor (solo-maintainer project, no open contribution funnel currently advertised), I did not draft it — flagging for a future pass if the project starts accepting outside PRs.

---

### [DOC-002] — Minor — Accuracy — `docs/manual.md`'s Server-page watchdog diagram hardcodes `PORT (3000)` as a label, when the app's own docs (setup.md, .env.example) treat 3000 as a default, not a constant

**Evidence**
`docs/manual.md` line 637 (inside a Mermaid diagram in Part 5): `WD --> C1{"App answering<br/>on PORT (3000)?"}`. Compare `docs/setup.md` lines 27-28: "The built server... is the one that honours `PORT` (default `3000`)" — i.e., an operator can set `PORT` to anything, and `ops/lib-port.ps1`'s own header (confirmed read) exists specifically because a prior version of this exact confusion — "the ops scripts hard-coded 3000 while an architecture diagram said 8080" — was already an audit finding (TW-005) that got fixed in the *scripts*. The diagram label in manual.md still bakes in the literal default rather than saying `PORT` alone or `PORT (default 3000)`.

**Why this matters**
This is the same class of drift TW-005 already fixed once (in ops scripts), just recurring one layer up in a diagram caption. It won't strand a first-time user — the surrounding prose is correct — but it's exactly the kind of thing that goes stale silently if someone changes the default later, since a diagram label is easy to miss in review.

**Blast radius**
- Adjacent code: none.
- Shared state: the same `PORT`/`HOST` documentation surface as TW-005 (ops/lib-port.ps1 header, setup.md, SELF-HOSTING.md) — all of which now correctly say "default 3000" rather than a bare constant.
- User-facing: none currently; only a documentation-consistency risk if the default port ever changes.
- Migration: none.
- Tests to update: none known.
- Related findings: same root pattern as the historical TW-005 (three answers to one question) — this is the diagram not yet brought fully in line with the fixed prose.

**Fix path**
Change the Mermaid node label from `PORT (3000)` to `PORT (default 3000)` or just `PORT`, matching the phrasing already used in setup.md and .env.example.

---

### [DOC-003] — Minor — Completeness — `docs/manual.md` Part 6 "Environment" reference table is a curated subset with no pointer to `.env.example` for the full list

**Evidence**
`docs/manual.md` lines 725-738 list 9 environment variables. `.env.example` (confirmed read in full) documents at least 20 distinct variables actually consulted by the app, including `PORT`, `EDITORIAL_TIMEOUT_MS`, `VITE_STUN_URLS`, `TOWNREPORTER_PLANNER_MODEL`, `PUBLIC_SITE_URL`, `VITE_TOWNREPORTER_EDITOR_EMAIL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `RUN_LIVE_MODEL_TESTS`, `TEST_POSTGRES_ADMIN_URL`. `.env.example` itself notes it exists partly *because* "An audit found this file was not the inventory docs/setup.md claims it is (TW-006)" — so the project has already fixed one instance of an incomplete-inventory claim (in setup.md, by pointing explicitly to `.env.example` at the top of its own Environment section: "All of these are documented in `.env.example`"). Part 6 of manual.md does not carry that same disclaimer/pointer — it just presents nine rows under the header "Environment" with no scope statement.

**Why this matters**
This is genuinely low-risk because manual.md's table doesn't claim to be exhaustive (unlike the pre-TW-006 state of setup.md, which apparently did). A returning user skimming Part 6 for "what can I set" could still walk away thinking that's the full list, especially since it's titled simply "Environment" rather than "Environment (selected)" or similar.

**Blast radius**
- Adjacent code: none.
- Shared state: same TW-006 root cause class (env-var inventory drift) — .env.example is now the single source of truth per setup.md; manual.md's table is the one remaining unscoped list.
- User-facing: minor — a self-hoster looking for e.g. `PORT` or `EDITORIAL_TIMEOUT_MS` in manual.md's reference table won't find it there (though both are documented elsewhere: setup.md and editor.md respectively).
- Migration: none.
- Tests to update: none.
- Related findings: same class as DOC-001/TW-006 lineage — inventory-completeness claims are the recurring failure mode in this project's doc history (see .env.example's own note), and this table is the one spot that pattern hasn't fully reached yet.

**Fix path**
One-line addition above the table: "Selected variables — the full, current list the code reads is `.env.example`." Mirrors the language setup.md already uses.

---

### [DOC-004] — Nit — Hygiene — `docs/images/02-article.png` and `03-*.png` exist/are-absent inconsistently relative to numbering, with a gap at 03

**Evidence**
`docs/images/` contains `01-front-page.png`, `02-article.png`, `04-desk.png`...`12-published.png` — no `03-*.png`. `docs/editor.md`'s image references (grepped) use `01`, `04`–`12`, skipping `02` and `03` — i.e. `02-article.png` exists on disk but is never referenced anywhere in `docs/editor.md`.

**Why this matters**
Purely cosmetic — no broken links, no missing images for anything referenced. Just an unused asset and a numbering gap that might confuse someone maintaining the screenshot set later.

**Fix path**
Either reference `02-article.png` somewhere in editor.md (e.g., under the story workbench or published sections) or delete it if superseded. Not worth doing on its own.

---

## Drafts produced

Writer mode is audit-only; no drafts produced in this pass. No Blocker or Critical doc gap was found that would trigger a draft under the intake instructions.

## Marketing / honesty audit

README's hero section and the "Read this first" disclaimer block are the closest thing to marketing copy in scope, and both undersell rather than oversell: "Drafts are AI-assisted. Models invent facts, misattribute quotes, and mangle names... TownReporter does **not** fact-check for you... You are solely responsible for everything that appears on the paper." No overclaim, no vague value props, no unsubstantiated stats found. The "This release (0.5.1)" and "Earlier (0.5.0)" changelog summaries in README are specific and match CHANGELOG.md's corresponding entries (spot-checked the 0.5.1 head section) rather than being marketing-flavored rewrites.

## Patterns and systemic observations

- **The project has a working immune system for doc rot.** Every stale-doc failure mode I went looking for (port drift, missing ops scripts, incomplete env-var inventory, a dead setup-token reference) had already been caught by a prior audit pass (TW-002 through TW-009, referenced throughout `.env.example` and `ops/*.ps1` headers) and fixed with a citation back to the finding. DOC-002 and DOC-003 above are recurrences of that *exact* pattern (TW-005's port-drift, TW-006's env-inventory-completeness) surfacing in one layer of documentation that hasn't caught up yet — a diagram label and one un-scoped reference table. Worth a standing habit: when TW-005/TW-006-style fixes land, grep for the same claim shape (hardcoded defaults in diagrams, "Environment" tables without a completeness disclaimer) across *all* docs, not just the one that prompted the fix.
- **No tone drift.** All docs — README, setup.md, SELF-HOSTING.md, SECURITY.md, ops script headers — share the same plain, first-person, slightly wry voice and the same habit of narrating *why* a rule exists rather than just stating it. This is unusual consistency for a multi-document set and is worth explicitly preserving as a style convention if this project ever gets a second writer.

## Appendix: docs reviewed

- `README.md`
- `SELF-HOSTING.md`
- `SECURITY.md`
- `.env.example`
- `docs/setup.md`
- `docs/manual.md` (full pass on structure + spot reads of Parts 1, 3, 4, 5, 6)
- `docs/editor.md` (spot reads: sign-in, images, Dark Desk dials anchor, editorial timeout row)
- `docs/dark-desk-editor.md` (full)
- `docs/local-models.md` (full)
- `CHANGELOG.md` (head entry, version-claim cross-check)
- `ops/install-tasks.ps1`, `ops/lib-port.ps1`, `ops/cron-tick.ps1`, `ops/install-shortcut.ps1`, `ops/promote.ps1`, `ops/restart-app.ps1`, `ops/restart-tunnel.ps1`, `ops/rotate-logs.ps1`, `ops/run-tunnel.ps1`, `ops/start-townreporter.ps1`, `ops/status.ps1`, `ops/stop-townreporter.ps1`, `ops/watchdog.ps1` (headers)
- Cross-checked against: `package.json` (version), `src/lib/news/editorial.server.ts`, `src/lib/news/investigate.ts`, `src/lib/multiplayer/p2p.ts`, `src/routes/evidence.$versionId.tsx`, `src/routes/evidence.compare.tsx`, `src/routes/get-the-code.tsx`, `src/routes/TownReporter[.]zip.tsx`, `vite.config.ts`, `docs/images/*`
- `CONTRIBUTING.md` — confirmed **absent** (see DOC-001)
