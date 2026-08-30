# TownReporter 0.5.1 — Documentation Deep-Dive

Role: **Technical Writer** (README, architecture docs, manual, setup/self-hosting guides, landing page, marketing copy — accuracy, completeness, honesty). Read-only against `C:\Users\scott\Desktop\Code\townreporter-dev`. No product source modified.

## Method

Read in full: `README.md`, `SELF-HOSTING.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/setup.md`, `docs/manual.md` (Parts 1–2), `docs/editor.md` (opening sections), `docs/local-models.md` (opening), `docs/index.html`, `.env.example`, `AGENTS.project.md` pointer text in README. Cross-checked specific factual and numeric claims against the actual source (`vite.config.ts`, `src/lib/news/ai.ts`, `scripts/with-app-env.mjs`, `scripts/smoke-built-server.mjs`, `package.json`, `LICENSE`, `docs/images/`) and against two live runs of `npm test` on this checkout. Did not run `npm run dev`/`build` live end-to-end — this checkout's `.output` and port range are shared with three other concurrent audit roles, and the setup docs' claims about the dev server (fixed port 8080, `strictPort: true`) were verified directly in `vite.config.ts` instead, which carries equal evidentiary weight without risking the shared build artifact. This is a documentation-fidelity gap I am flagging, not a silent skip.

## Severity counts

- Blocker: 0
- Critical: 0
- Major: 2
- Minor: 3
- Nit: 1

## Findings

### DOC-1 (Major) — "540 tests in about fourteen seconds" is stale on both numbers, and the run is not provably deterministic

**Category:** accuracy
**Evidence:** `SELF-HOSTING.md:177`: *"`npm test` makes no model call and costs nothing — 540 tests in about fourteen seconds, with no provider contacted."* I ran `npm test` twice on this exact checkout (no code changes between runs):

- Run 1 (background, `test_run.log`): first suite (`scripts/**/*.test.mjs`) 199 tests / 197 pass / 0 fail / 13.0s. Second suite (`src/**/*.test.ts`, `--test-concurrency=1`) 336 tests / 306 pass / **27 fail** / 112.5s.
- Run 2 (clean, `test_run3.log`): first suite 199 tests / 197 pass / 0 fail / 4.3s. Second suite 579 tests / 561 pass / 0 fail / 147.6s.

Combined total is **778 tests**, not 540, and full wall time is **~150–160 seconds**, not "about fourteen." Fourteen seconds only covers the first `node --test` invocation in the combined script (`node --test "scripts/**/*.test.mjs" && node ... --test "src/**/*.test.ts"`); the second, larger suite is what the doc's number omits entirely.

More concerning: the two clean runs produced different pass/fail outcomes on identical code (0 failures vs. 27 failures, all 27 failing files timing out in ~13–17ms each — consistent with a resource-contention or startup-race failure, not a logic bug, since every one of the 27 files passes individually). `docs/setup.md` and `SELF-HOSTING.md` both describe the suite as **"Deterministic, offline and free by default."** A test run whose pass/fail count varies between back-to-back runs on unchanged code contradicts that claim as written, even if the underlying cause turns out to be environmental (my own concurrent shell activity on this shared box is a plausible confound, and I could not isolate the cause further without disrupting the other roles running on this same checkout).

**Why it matters:** The exact test count and runtime are the kind of specific, checkable numbers a GitHub reader uses to size up whether the project is being honestly maintained — a stale count by 44% and a runtime off by roughly 10x reads as either neglect or a claim nobody re-measured since a much earlier release. The determinism claim is a promise readers act on directly (deciding whether CI or a pre-merge hook can trust the suite).
**Impact scope:** every reader of `SELF-HOSTING.md` sizing up test coverage before trusting the "already shipped" claim in this release; anyone wiring `npm test` into their own gate expecting determinism.
**Fix path:** re-measure and update the sentence (`SELF-HOSTING.md:177`) with a current count and a realistic wall-clock range (e.g. "~780 tests in under three minutes"). Separately — this is a QA-adjacent finding but documentation cannot honestly claim "deterministic" until the flake in the 27-file batch is root-caused; either fix the race or soften the doc's determinism claim to something checkable (e.g. "no network calls, though the full run can take longer under load").

### DOC-2 (Major) — `SECURITY.md` ships with a literal placeholder in the one field a real reporter needs

**Category:** completeness / honesty
**Evidence:** `SECURITY.md:29`: *"Backup / if that flow is not available: `<security contact address — maintainer to fill in>`."* And the file's own closing footnote (`SECURITY.md:127-129`): *"The reporting address above is a placeholder: the maintainer needs to fill it in, or confirm GitHub's private vulnerability reporting is enabled for this repository, before this file is fully load-bearing."*
**Why it matters:** This project is described in its own audit root brief as "now running in production... a release candidate that has already shipped," publicly reachable at `townreporter.org`. A security policy that self-certifies it is *not yet load-bearing* is, for the one document whose entire purpose is "how do I privately reach you with a vulnerability," a genuine gap on a live, internet-facing product. A researcher who doesn't have or check GitHub's private-reporting toggle has no working fallback channel today.
**Impact scope:** anyone attempting responsible disclosure against the live site who lands on the backup path; reflects on the project's stated seriousness about "coordinated disclosure matters more than usual for this project" (same file, line 6-8) while leaving the actual channel unfilled.
**Fix path:** either confirm GitHub private vulnerability reporting is enabled for this repo and delete the backup-address branch entirely, or fill in a real monitored address and remove the self-flagged placeholder + footnote.

### DOC-3 (Minor) — `package.json` has no `license` field, despite README/LICENSE both stating MIT

**Category:** consistency
**Evidence:** `package.json` (`"private": true`, no `"license"` key) vs. `README.md` closing section ("MIT licensed") and `LICENSE` (MIT, Copyright (c) 2026 Scott Converse). Not user-facing since the package is `private: true` and never published to npm, but any tooling (license scanners, `npm ls`) or a contributor skimming `package.json` alone sees no license declared.
**Fix path:** add `"license": "MIT"` to `package.json` for consistency with the two docs that assert it.

### DOC-4 (Minor) — `npm run check:auth` is an undocumented script

**Category:** completeness
**Evidence:** `package.json` scripts list includes `check:auth` (`node scripts/check-auth-invariant.mjs`); it is not mentioned in README, SELF-HOSTING.md, SECURITY.md, or docs/setup.md's Tests section, unlike every other test-related script (`test`, `test:lifecycle`, `test:flows`, `test:sources`, `test:paste`, `test:live-model`, `smoke`, `proof:search`, all of which appear somewhere in the docs).
**Fix path:** one line in `docs/setup.md`'s Tests section, or fold it into `npm test`'s description if it already runs as part of that suite (it does not appear to, based on the `test` script definition in `package.json`).

### DOC-5 (Minor) — First-run instructions correctly describe a fixed dev port, but the operator brief's assumption of a configurable port is easy to trip over

**Category:** completeness
**Evidence:** `docs/setup.md` states plainly: *"`npm run dev` always serves on `0.0.0.0:8080` — that port is hard-coded in `vite.config.ts` (`strictPort: true`)... and it does **not** read `PORT`."* Verified directly: `vite.config.ts:255-256` (`port: 8080, strictPort: true`) and a comment at line 249 confirming this is intentional. This is documented accurately and is **not** itself a defect — noting it here only because it is the kind of claim other reviewers on this same shared checkout could misread as configurable if they only skim the top-level README quickstart (which doesn't repeat the "hard-coded, ignores PORT" caveat and just says `npm run dev # http://localhost:8080`).
**Fix path:** none required in setup.md; consider a one-line pointer in the README quickstart itself ("dev always uses :8080 regardless of `PORT`; see setup.md") so a reader who only reads the README doesn't later fight `PORT=3000 npm run dev` silently doing nothing.

### DOC-6 (Nit) — Landing page screenshot claim is accurate but unverifiable by a reader without cloning

**Category:** honesty
**Evidence:** `docs/index.html`: *"These are screenshots of the running Longmont edition, not mockups."* All five images the page actually references (`01-front-page.png`, `04-desk.png`, `07-story-editor.png`, `08-dark-desk.png`, `11-server.png`) exist in `docs/images/` and render plausibly as real app screens (checked file presence, not pixel content). Filed as a Nit only because there is no independent way for a reader to confirm authenticity from the page itself — a minor trust gap common to every screenshot-based landing page, not specific to this project.

## What's working

- **The model-resolution documentation is exactly right.** README, `docs/setup.md`, `.env.example`, and `docs/index.html` all state the same four-tier precedence (custom `LLM_BASE_URL`/`LLM_API_KEY` → `ANTHROPIC_API_KEY` → Claude Code CLI with no key → `XAI_API_KEY`). I read `src/lib/news/ai.ts`'s `resolveProvider()` directly (lines 125-135) and the order matches the docs precisely, including the "custom gateway wins over everything" framing.
- **The "what leaves this machine" section (`docs/setup.md`, mirrored in README FAQ) is unusually candid** for a project's own docs — it names the exact unconditional search-provider chain (Exa → DuckDuckGo → Bing → Brave → Wikipedia) and the file it lives in (`src/lib/news/search-web.ts`), and explicitly separates "reader privacy" (verified: zero outside requests) from "desk privacy" (verified: several categories of real egress), rather than blurring the two into one blanket privacy claim. That's a higher bar than most self-hosted project docs hold themselves to.
- **The CHANGELOG's per-release entries read as genuine engineering history, not marketing copy** — several entries describe real defects found and fixed with specifics (e.g. "the setup token... was removed in 0.5.1, because a one-person newsroom that could not re-issue the token had a lock with no locksmith"; "the schema was applied 'on boot', which was true of the build and false of `npm run dev`"), and I did not find a case where a CHANGELOG claim contradicted what the current code does.
- **The self-hosting document's cross-references check out mechanically.** All images `docs/index.html` links to exist on disk; the `AGENTS.md`/`AGENTS.project.md`/`.grok/` disclaimer in the README ("not TownReporter documentation... some of it is still load-bearing for `npm run dev`/`build`") is accurate — `.grok/app-env.json` exists and `scripts/with-app-env.mjs` genuinely reads and merges it before every `dev`/`build`/`preview` invocation, exactly as described.
- **The doc's own test-count claim aside (DOC-1), the test suite itself is real and substantial**: two independent full runs on this checkout produced 778 total tests exercising PrimeGov catalog matching, YouTube meeting joins, Dark Desk job races, auth invariants, and more — this is not a thin or decorative suite, the documentation is simply behind the current number.

## Could not assess

- **Live end-to-end doc-vs-app walkthrough** (actually clicking through `/`, `/desk`, `/desk/ops`, etc. against a running instance on this checkout) was not performed, to avoid disturbing `.output` and the shared port range while three other roles work the same checkout concurrently. Verification here was code-level (reading the exact functions/config the docs cite) rather than browser-level; I'm flagging this as a genuine gap rather than implying it's equivalent coverage — a UX or QA role driving the real running app is better positioned to catch doc/UI drift that only shows up on screen (e.g. copy that doesn't match what a button actually says).
- **`docs/local-models.md`'s specific benchmark numbers** (median items/wall-clock/cost per model) were read for internal consistency with the CHANGELOG's summary claim ("about half as many leads... 26 against 50") but not independently re-run — they describe a hardware- and LM-Studio-state-dependent measurement on the production machine, not something reproducible from this dev checkout.
- **`docs/editor.md`, `docs/dark-desk-editor.md` beyond their opening sections, and `docs/manual.md` Parts 3-6** (architecture, reference) were skimmed for structure but not line-by-line fact-checked against code within this pass's time budget; no defects found in what was read, but this is a coverage gap I'm naming rather than implying a clean pass on the unread portions.
