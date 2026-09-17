# Audit Lite — TownReporter 0.6.8

**Date:** 2026-09-03
**Scope:** `git diff a41b23c..f4e3110` (commit f4e3110, tag v0.6.8) — a durable `failover_note` column on `desk_jobs` (migration 0032), shown on the Story page as "Model note: …", plus the Automatic-picker help copy now saying it moves on a timeout too.
**Reviewer:** Claude (audit-lite)

## TL;DR

Ship. The change is small, well-scoped, and unusually well tested for a lite-sized diff — it even carries its own migration/schema drift-guard test (mirroring the pattern already used for `model_choice_source`). Every `desk_jobs` select list in `jobs.ts` was updated to include `failover_note`, the column is `not null default ''` so the frontend never has to special-case null, and the story page's render guard (`data.job?.failover_note ? … : null`) handles the empty/absent cases safely. Runtime boot smoke-tested clean against PGLite. One Major finding: the `failoverReasonPhrase` helper this release extracted specifically to stop the switch-reason wording from drifting is reused by only one of the three sites that build it (`desk.ts`), leaving `dark.ts` and `scan-model-run.ts` with their own hand-typed copies of the exact ternary it replaced.

## Severity rollup
- Blocker: 0
- Critical: 0
- Major: 1
- Minor: 0
- Nit: 0

## Findings

### FINDING-001 Major: `failoverReasonPhrase` extracted to stop wording drift, but two of three failover sites still hand-duplicate it
**Dimension:** Correctness
**Evidence:**
- `src/lib/news/automatic-failover.ts:104-121` — new `failoverReasonPhrase()` / `failoverNoteSentence()`, whose docblock states the goal explicitly: "Pulled out here, pure and hermetic, so 0.6.8's durable `failover_note` (desk.ts) can reuse the EXACT same wording instead of a second hand-typed copy that could drift."
- `src/lib/news/desk.ts:796` — `failOverAndRetry` correctly calls `failoverReasonPhrase(previousLabel, plan.reason)`.
- `src/lib/news/dark.ts:1272-1273` — still builds it inline: `plan.reason === "timeout" ? \`${previous} timed out\` : \`${previous} sign-in lapsed\`` — not the new helper.
- `src/lib/news/scan-model-run.ts:109` — same inline ternary, same duplication, also not the new helper.
**Why it matters:** The stated purpose of pulling this string-builder into `automatic-failover.ts` was to make drift impossible ("instead of a second hand-typed copy that could drift"). Today all three copies happen to read identically, but `dark.ts` and `scan-model-run.ts` weren't switched over to the shared function, so the single-source-of-truth guarantee the release's own commit message claims doesn't actually hold — a future wording tweak to `failoverReasonPhrase` (e.g. adjusted for a new `AutomaticFailoverReason`) will silently stop applying to Dark Desk rounds and Scan jobs, and nothing will flag the divergence (there's a schema-drift test for the migration/`ensureJobsSchema` pair, but no equivalent test asserting `dark.ts`/`scan-model-run.ts` call the shared phrase-builder).
**Fix path:** Replace the inline ternaries at `dark.ts:1272-1273` and `scan-model-run.ts:109` with calls to `failoverReasonPhrase(previous, plan.reason)` imported from `automatic-failover.ts`. Optionally add a same-shaped grep/text-equality test to `jobs.test.ts` or `automatic-failover.test.ts` (parallel to the existing "the failover_note column is declared the same in both places" test) asserting no file besides `automatic-failover.ts` contains the literal `"sign-in lapsed"` ternary pattern.

## Extra lens — robustness (migration/DB coupling)

- **Migration applies cleanly and idempotently:** Yes. `migrations/0032_job_failover_note.sql:7-8` is `alter table desk_jobs add column if not exists failover_note text not null default ''` — safe to re-run, and matches `not null default ''` so no backfill/null-handling step is needed. `src/lib/news/jobs.ts:139-142` carries the identical statement for the embedded-PGLite-in-unit-tests path (confirmed via `src/lib/db.ts:166-176`: `import.meta.glob` for `/migrations/*.sql` throws under plain Node `node:test` runs, so that path is real, not redundant). A dedicated test (`jobs.test.ts` — "the failover_note column is declared the same in both places") normalizes and diffs the migration file against `jobs.ts`'s source text, so the two declarations cannot silently diverge. This is the same pattern already proven for `model_choice_source`.
- **`failover_note` added to every select list:** Verified all four `desk_jobs` select statements in `jobs.ts` (`latestJob` line 213, `findOpenJob` lines 233 and 244, `drainLane`'s poll at line 414) plus both `returning` clauses in `enqueueJob` (lines 297, 317) include `failover_note`. The one other `desk_jobs` query in the diff's blast radius, `src/lib/ops/health.server.ts:138-143`, is an aggregate `count(*)` grouped by lane/status/kind and correctly has no reason to select it.
- **Null/undefined handling:** Column is `not null default ''`; `DeskJob.failover_note` is typed `string`, never `string | null`, so there is no null case to mishandle. The frontend's `data.job?.failover_note` guards against `job` itself being absent (no job yet), which is the only nullable link in the chain.
- **Story page renders safely when `failover_note` is empty:** `src/routes/desk.story.$leadId.tsx:565-567` — `{data.job?.failover_note ? (<p className="meta">Model note: {data.job.failover_note}</p>) : null}`. Empty string is falsy in JS, so the default `''` renders nothing; no crash, no stray "Model note:" label with blank text.

## Runtime smoke test

Built an isolated `git worktree` at f4e3110 (kept the main `townreporter-dev` checkout untouched), reused its `node_modules` via a directory junction (no reinstall — `package.json`/`package-lock.json` are identical between f4e3110 and current HEAD except the version bump), and started `vite dev` with `DATABASE_URL=""` (forcing the in-memory PGLite fallback, confirmed by the `[with-app-env] DATABASE_URL unset -- PGLite in-memory` log line) on port **3433** — clear of 3000/5432/5433 and the ≥3432 floor. Server booted clean in ~3s, home page loaded (`TownReporter — Not yet set up`, the expected first-run state for a fresh PGLite instance) with zero console errors. This exercises `ensureJobsSchema()`'s new `alter table … add column if not exists failover_note` statement on a live PGLite instance — no schema errors on boot confirms it applies cleanly. Did not proceed to a full onboarding → lead → draft → failover walkthrough (out of scope for a lite pass and unnecessary given the strong existing unit + e2e coverage below). Server process and all children were killed by PID (verified via `Get-CimInstance`/`Get-NetTCPConnection`, not by image name — an earlier stray `npx` install attempt was individually identified and killed by PID before it could hold a file lock), and the worktree + junction were removed afterward.

## Dimension notes

- **Correctness & Security:** Covered above — one Major (FINDING-001). No security exposure: `failover_note` carries only a static, code-generated sentence naming a model label, never user input.
- **UX:** New copy is a quiet, consistent addition (`className="meta"`, same pattern as the adjacent `Form ·` line). Automatic-picker help text update (`model-choice.ts:157`) accurately reflects 0.6.7's already-shipped timeout-failover behavior, which the help text had lagged.
- **Docs:** `CHANGELOG.md`, `README.md`, `SELF-HOSTING.md`, `docs/editor.md`, `docs/manual.md`, `docs/setup.md` all bumped 0.6.7 → 0.6.8 consistently, with `CHANGELOG.md` accurately describing both changes.
- **Tests:** Strong. `automatic-failover.test.ts` unit-tests both new pure functions for both reasons (timeout/auth). `jobs.test.ts` adds a persistence round-trip test through `setJobFailoverNote` → `findOpenJob`/`latestJob`, plus the migration/`ensureJobsSchema` text-equality drift guard. `scripts/failover-e2e.mjs` was extended to assert the note survives to the *finished* job's `getLead` snapshot specifically (not just mid-run), which is the exact regression this feature exists to prevent.
- **Runtime:** See smoke test above.

## What's working
- The `failover_note` column rollout (migration + PGLite fallback + select-list updates) is textbook: every write path and read path was updated together, and a dedicated test makes the two schema declarations impossible to silently diverge.
- `scripts/failover-e2e.mjs`'s new assertion specifically targets the *finished*-job read, not the mid-run one — that's the one place a regression could hide (a note that shows up while running but vanishes once `stage` flips to "Done"), and it's exactly what's tested.
- The empty-string default plus a falsy-check render guard means there is no null-handling code anywhere in this feature — the simplest possible design for "durable, always-present, sometimes-empty" data.
- Copy and version bumps landed in every doc surface in the same commit; nothing was left saying 0.6.7.

## Escalation recommendation
No escalation needed. One Major finding, no Blocker or Critical, and it's a latent drift risk rather than a live defect — appropriate for a normal follow-up ticket, not a full `audit-team` pass.
