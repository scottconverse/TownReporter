# Audit Lite — TownReporter 0.6.10 ("Local model" writing-model entry)
**Date:** 2026-09-03
**Scope:** `git -C townreporter-dev diff 5ec8517..3649d9d` — commit `2b1161e` (0.6.10: local model as a named pick on Story/Scan/Opinion/Dark Desk pickers) plus `3649d9d` (walk-fix: two Playwright picker option-count assertions widened from 4/2 to 5/3). Read the full diff and adjacent code: `provider-registry.ts`, `ai.ts` (`resolveProvider`/`explicitProvider`/`probeProvider`/`grokChat`), `model-choice.ts`, `model-picker.tsx`, `opinion-readiness.ts`, `model-request-commit.server.ts`.
**Reviewer:** Claude (audit-lite)
**Escalation:** see bottom — **recommend `audit-team`** (1 Blocker found).

## TL;DR
**Don't ship as-is.** The Story, Scan and Dark Desk surfaces got the local model correctly for free, exactly as the registry design promised — zero transport code changed, and the new tests for those paths are real and pass. But **Opinion's "Local model" option does not work**: a hand-rolled readiness function (`opinion-readiness.ts`) was never updated for the new third choice, so picking "Local model" for an editorial either (a) silently drafts on Claude Opus instead with no indication anything differed from the editor's choice, or (b) is refused with a "sign into Claude Code" error that has nothing to do with the model the editor actually picked. This is reproduced below against the real production code, not a hypothetical. It directly contradicts the "explicit choices never fall back" invariant stated repeatedly in this same diff's docs, and it is exactly the class of "hardcoded expectation the new picker entry broke" the walk-fix commit was already fixing elsewhere — just in a spot that fix didn't reach.

## Severity rollup
- Blocker: 1
- Critical: 0
- Major: 1
- Minor: 1
- Nit: 0

## Findings

### FINDING-001 Blocker: Opinion silently discards (or blocks) the explicit "Local model" pick
**Dimension:** Correctness
**Evidence:**
- `src/lib/news/provider-registry.ts:373` — the new `local-model` entry sets `offeredFor: EVERY_SURFACE`, so `opinion: true`.
- `src/lib/news/model-choice.ts:67-69` — `OPINION_MODEL_CHOICES` correctly includes it (also confirmed by `provider-registry.test.ts` and `model-choice.test.ts`, both passing).
- `src/lib/news/opinion-readiness.ts:50` — `const candidates = ["claude-frontier"] as const;` with the stale comment "Opinion is Claude-only... Automatic and the explicit choice probe the same single rung." This is no longer true as of this diff — Opinion has three choices now — but the function still only ever probes Claude.
- `src/lib/news/opinion-readiness.ts:66-71` — `effectiveChoice` is computed as `selected?.ok && selected.choice !== "configured" ? opinionModelChoice(selected.choice) : choice`. Because `selected.choice` only ever comes from the hardcoded `candidates` array, a successful Claude probe overwrites *any* explicit choice with `"claude-frontier"`.
- `src/lib/news/model-request-commit.server.ts:246-248, 302, 313` — `commitOpinionForAuthenticatedEditor` takes `readiness.effectiveChoice` (not the editor's `input.modelChoice`) and both persists it to `editorial_requests.model_choice` and passes it to `enqueueJob`. The wrong provider is not just displayed wrong — it is the provider that actually runs and gets recorded.
- **Reproduced live** against the unmodified source (`node --experimental-strip-types`, calling `checkOpinionReadiness` directly, no mocks on the function under test):
  ```
  choice sent: local-model
  result: {"ready":true,"why":"","problems":[],"effectiveChoice":"claude-frontier"}
  FAIL: explicit "local-model" choice was silently replaced with "claude-frontier"

  result2 (Claude signed out, Local model chosen):
  {"ready":false,"why":"Claude Code is unavailable. Open Claude Code on this machine, sign in, then try again.","effectiveChoice":"local-model"}
  ```
  (First call stubs `probeCandidate` to always succeed for whatever candidate it's asked to probe — i.e. "Claude Code is signed in," a very ordinary state since Claude Code is the desk's default brain. Second call stubs it to always fail — i.e. "Claude Code is not signed in.")
- Existing test coverage confirms the gap rather than closing it: `src/lib/news/opinion-readiness.test.ts:46` is literally titled *"Automatic probes Claude and only Claude -- Opinion has one provider"* and no test in that file, or in `model-request-commit.test.ts`, ever calls either function with `"local-model"`. Ran the full non-DB unit suite for the touched area (`provider-registry.test.ts`, `model-choice.test.ts`, `opinion-readiness.test.ts` — 39 tests) and all pass, because none of them exercise this path.

**Why it matters:** This is the headline claim of the release for Opinion — README, `editor.md`, `manual.md`, `SELF-HOSTING.md`, `docs/index.html` and `docs/local-models.md` were all updated in this same diff to say "Opinion offers Claude and the local model." As shipped, that sentence is false for the enqueue path: an editor who deliberately picks Local model for an editorial (e.g. to avoid sending a subject to Anthropic, or because Claude Code isn't installed on that box) either gets Claude Opus anyway with zero indication their choice was overridden, or is told to sign into a provider that has nothing to do with what they picked. Either way, the one new capability this release adds to Opinion does not function.

**Fix path:** In `opinion-readiness.ts`, stop hardcoding `candidates = ["claude-frontier"]`. Derive the candidate(s) from the registry the same way Story/Scan/Dark already do generically via `probeProvider(input.modelChoice)` in `model-request-commit.server.ts` (lines ~55, ~141) — when `choice !== "auto"`, probe only the chosen provider and never substitute a different provider's id into `effectiveChoice`. For `"auto"`, probe `providersFor("opinion")` filtered to ladder-eligible entries (today still just Claude, since `local-model` has no `ladderRank` — correctly). Add cases to `opinion-readiness.test.ts` and `model-request-commit.test.ts` for `checkOpinionReadiness("local-model", ...)` in both a ready and not-ready state before calling this done.

**Blast radius:**
- **Adjacent code:** `commitOpinionForAuthenticatedEditor` (`model-request-commit.server.ts:229-314`) persists and enqueues the wrong provider end to end; `opinion.ts:52` (the page's own pre-submit readiness probe) shows the editor the same wrong verdict before they even click submit, so there's no UI signal either.
- **Shared state:** `editorial_requests.model_choice` and the enqueued job's `model_choice` are wrong in the database for every Opinion request submitted as "Local model" while Claude Code is also signed in — a data-integrity issue for the audit trail ("which model wrote this editorial"), not just a UX glitch.
- **User-facing change:** none visible — that's the danger. No error, no toast, no different-provider notice; the draft simply comes back written by Claude Opus.
- **Migration concern:** none (no schema change).
- **Tests to update:** `src/lib/news/opinion-readiness.test.ts`, `src/lib/news/model-request-commit.test.ts`.

### FINDING-002 Major: "Local model" can silently resolve to OpenAI's real cloud API, not a local server, under a plausible partial config
**Dimension:** Correctness (the requested robustness lens: what happens when Local model is picked without full config)
**Evidence:**
- `src/lib/news/provider-registry.ts:290-292` — `local-model.enabled()` is `notSwitchedOff("TOWNREPORTER_LOCAL") && Boolean(env("LLM_BASE_URL") || (env("LLM_API_KEY") && env("LLM_MODEL")))`. An `LLM_API_KEY` + `LLM_MODEL` pair alone (no `LLM_BASE_URL`) is treated as sufficient.
- `src/lib/news/ai.ts:91-102` — `customGateway()`: `baseUrl: trimSlash(customBase || "https://api.openai.com/v1")`. When `LLM_BASE_URL` is unset, the endpoint silently defaults to OpenAI's real cloud API.
- `src/lib/news/ai.ts:205-208` — the `local`/`openai` branch of `explicitProvider` calls `customGateway()` directly (not the entry's own `baseUrl`/`envOverrides`), so this default applies to the `local-model` pick exactly as it does to the unnamed `configured` gateway.
- `docs/setup.md`'s new picker table row (added in this diff) says the prerequisite is *"`LLM_BASE_URL` set (plus `LLM_MODEL`, and `LLM_API_KEY` if the server wants one)"* — i.e. the docs treat `LLM_BASE_URL` as the load-bearing variable, which the `enabled()` check does not enforce.
**Why it matters:** The picker now shows this choice under the label **"Local model — llama.cpp, LM Studio, or another OpenAI-compatible server."** An operator who sets `LLM_API_KEY` and `LLM_MODEL` (e.g. copying a snippet meant for a different purpose, or mid-troubleshooting) without also setting `LLM_BASE_URL` gets an option labeled "Local model" that actually posts an editorial subject, a story draft, or Dark Desk research to `api.openai.com`. This ambiguity predates 0.6.10 (it was always true of the unnamed `configured` gateway), but this diff is what puts a user-facing, local-implying name on it and exposes it on four pickers instead of zero.
**Fix path:** Either require `LLM_BASE_URL` specifically for `local-model.enabled()` (leaving the key+model-only path to the still-unnamed `configured` entry, which makes no locality claim), or have the OpenAI-compatible resolver refuse to fall back to `api.openai.com` when the resolved identity is `local-model`.

### FINDING-003 Minor: `live-pipeline-proof.mjs`'s label map wasn't updated for the new id — same regression class as the walk-fix, in a script it didn't reach
**Dimension:** Correctness / Tests
**Evidence:** `scripts/live-pipeline-proof.mjs:83-87` —
```js
const MODEL_LABELS = {
  auto: "Automatic",
  "codex-balanced": "Codex Terra",
  "codex-frontier": "Codex Sol",
  "claude-frontier": "Claude Opus",
};
```
No `"local-model"` entry; `labelFor()` (line 88) falls back to `choice ?? "unknown"`, used in the log/report lines at 247, 251, 324, 328.
**Why it matters:** Cosmetic only — a nightly proof run that lands on the local model would log/report the raw id `"local-model"` instead of `"Local model"`. Not wired into any workflow file found in this repo, so no CI break. Flagged specifically because it is the same "hardcoded list forgot the new entry" pattern the `3649d9d` walk-fix commit exists to fix, in a file that fix didn't touch — worth a sweep for others like it before calling the picker-widening done.
**Fix path:** add `"local-model": "Local model"` to `MODEL_LABELS`.

## Dimension-by-dimension

- **Correctness & Security:** Blocker + Major above. Story/Scan/Dark Desk are correct: `explicitProvider`/`resolveProvider`/`probeProvider`/`grokChat` in `ai.ts` needed zero changes (confirmed by reading them and by the new `ai.test.ts` cases at lines 631-729, which pass), because those three surfaces already routed choice generically. Opinion has its own hand-rolled path and that's exactly where it broke.
- **UX:** Downstream of Finding 1 — an editor gets either a wrong-but-silent result or an irrelevant error message; no separate UX defect beyond that. The `model-picker.tsx` setup instructions for local models (new copy at lines 102-114) are clear and consistent with the docs.
- **Docs:** Broad and consistent update across `CHANGELOG.md`, `README.md`, `SELF-HOSTING.md`, `docs/editor.md`, `docs/manual.md`, `docs/setup.md`, `docs/local-models.md`, `docs/index.html` — good hygiene, one voice. The one problem is that "Opinion offers Claude and the local model" is not true as shipped (Finding 1); once that's fixed the docs need no further change.
- **Tests:** Genuinely good new coverage for the registry/transport layer — `provider-registry.test.ts` (6 new cases), `model-choice.test.ts`, `ai.test.ts` (explicit-resolve + preflight/draft round-trip against a fake OpenAI-compatible server) all pass and are meaningful, not rubber-stamped. The gap is precisely the untested seam: `opinion-readiness.ts` was never given a `local-model` case, which is what let Finding 1 ship. Per the standing rule that a fix isn't done without a regression test, Finding 1's fix must land with the `opinion-readiness.test.ts` case that would have caught it.
- **Runtime:** Ran the non-DB unit suite for every touched module (`node --test provider-registry.test.ts model-choice.test.ts opinion-readiness.test.ts` — 39/39 pass) and a standalone reproduction script calling the real, unmodified `checkOpinionReadiness` to demonstrate Finding 1 concretely (output above). Did not stand up the dev server / PGLite instance for a full browser walk of the Opinion page — the bug is conclusively demonstrated at the unit layer and a UI walk would show the identical silent-swap with no additional information, so it wasn't necessary to spend the time under this audit's static-first mandate. If desired, a PGLite smoke on a spare port (>=3434) could additionally confirm the persisted `editorial_requests.model_choice` row, per Finding 1's blast radius.

## Extra lens (robustness) — direct answers
- **Local model picked, `LLM_BASE_URL` not configured at all:** Degrades gracefully on Story/Scan/Dark Desk — `explicitProvider` returns `null`, `resolveProvider` returns `null`, `probeProvider`/`grokChat` return the existing `GROK_UNAVAILABLE` message, which already mentions `LLM_BASE_URL`. No crash, no silent misrouting. On Opinion it's worse than "not configured" — see Finding 1, which fires even when Local model *is* configured and ready.
- **Local model picked, only `LLM_API_KEY`+`LLM_MODEL` set (no `LLM_BASE_URL`):** Not graceful — silently resolves to OpenAI's real cloud endpoint. See Finding 2.
- **Fail-over participation:** Correct. `local-model` has no `ladderRank`, so `automaticLadder()` never includes it (asserted by `provider-registry.test.ts` and confirmed by reading `automaticLadder()` in `provider-registry.ts:357-362`) — Automatic will not silently drop into it, and the mid-run failover in `automatic-failover.ts` only walks rungs strictly after the ladder's own start, so it can't reach `local-model` either. This is exactly the documented intent ("the `configured` gateway already pins Automatic to the same server when `LLM_BASE_URL` is set").
- **Other hardcoded-expectation breakage from the new 5th/3rd picker option:** Checked every `option`/count-style assertion and hardcoded provider-name list in `src/` and `scripts/`. `model-picker-render.test.mjs` derives its expected option list from the registry itself (not hardcoded), so it's fine. `scan-desk-e2e.mjs` only asserts `optionCount < 2`, so it's insensitive to the count either way. Found two more instances of the same class the walk-fix was already treating: Finding 3 above, and a stale doc-comment at `scripts/scan-model-picker.test.mjs:10` ("exactly Automatic, Codex Terra, Codex Sol, and Claude Opus") that doesn't assert anything itself (it just references the registry-driven test) but is misleading to a future reader — worth a one-line comment fix, not filed as a separate finding since it has no behavioral effect.

## What's working
- The core registry design paid for itself exactly as advertised: adding `local-model` to `PROVIDER_REGISTRY` required **zero changes** to `ai.ts`'s transport code for Story, Scan, and Dark Desk — verified by reading `explicitProvider`/`resolveProvider`/`probeProvider`/`grokChat` end to end and confirming the new `ai.test.ts` cases (explicit resolve, preflight against `/models`, draft round-trip against `/chat/completions`) pass against the real functions.
- `TOWNREPORTER_LOCAL=0` off-switch and `enabled()` gating are correctly wired and tested (`provider-registry.test.ts`).
- `KIND_BUDGETS.local` (10 min/call) is reused correctly with no regression to the other kinds' budgets.
- The `3649d9d` walk-fix itself is a good, narrowly-scoped follow-up: it correctly widened exactly the two Playwright option-count assertions (Dark Desk 4→5, Story/Queue 4→5, Opinion 2→3) that the new entry would otherwise have broken in CI.
- `package.json` and `src/lib/version.ts` were bumped together, staying in the lockstep the codebase's own comment requires.
- Documentation breadth and consistency across 8 files in one commit is genuinely good practice, once Finding 1 is fixed and they become true again.

## Watch items
- The `local-model` entry's env resolution intentionally reuses `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` rather than inventing `LOCAL_*` variables (a deliberate, documented decision) — worth remembering next time a provider-specific override is proposed for this entry, since it would split one server's config for no reason, exactly as the code comment argues.
- `scripts/scan-model-picker.test.mjs:10`'s comment is stale (says "exactly ... four" providers) even though the test itself doesn't hardcode the count. Cheap to fix in passing.
- No test currently proves the `commitOpinionForAuthenticatedEditor` DB write records the *correct* `model_choice` for a non-Claude explicit Opinion pick — once Finding 1 is fixed, add that assertion so a future picker addition can't silently reintroduce the same class of bug for Opinion specifically.

## Escalation recommendation
**Recommend running `audit-team`.** One Blocker was found (per the stated rule: 1+ Blocker → escalate), and it sits at the intersection of correctness, docs, and tests for a feature the release's own changelog calls out as a headline addition ("Opinion now offers the local model too"). A fuller pass would be useful to confirm there is no sibling issue in the Story/Scan/Dark Desk commit-and-persist paths beyond what was checked here (they were read and look correct, but audit-lite's time-boxed scope means a second, independent look at `model-request-commit.server.ts`'s Story/Scan branches is worth the full team's QA-engineer pass before this ships).
