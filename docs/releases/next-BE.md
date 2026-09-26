# Next TownReporter patch — structured job progress (unit BE)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or any live-model result. **No model was loaded, unloaded or called to write it**, in code or in a test; every check in it ran against fakes — a fake clock, a fake provider, and PGLite or a throwaway cluster.

## What the desk shows while a job runs

A desk job used to show a spinner and one overwritten sentence (`desk_jobs.stage`, written by sixty call sites). There was no bar, no list of what the job would do, no way to tell a slow model from a dead worker, and no way to stop a twenty-minute call. Four changes, in the schema, the worker, the client and the two screens that already showed progress.

### 1. Schema — `migrations/0099_desk_job_progress.sql`

Additive and nullable-only except one default: `stages_json text` (the ordered labels, a JSON array as text, matching `result_json`'s existing convention on this table), `stage_index int`, `pct int`, `step_text text`, `beat_at timestamptz`, `cancel_requested boolean not null default false`, `result_href text`. `stage` stays, and stays the sentence an old row already shows. A partial index `desk_jobs_running_idx` covers the whole-newsroom list the Running panel reads.

Three deliberate choices, each argued in the file: columns rather than a side table (progress is a property of the running row every reader already selects, and a side table needs an answer for what happens when the job ends); `beat_at` separate from `updated_at` (which the reclaim window writes, so a queue tick would look like a heartbeat); `pct` nullable rather than 0, because null is the honest value for a stage whose length nobody knows and the client draws the indeterminate bar for it.

`ensureJobsSchema()` mirrors it for PGLite. That mirror is drift-tested: three `describe("… is declared the same in both places")` blocks in `src/lib/news/jobs.test.ts` compare the migration to the runtime DDL after normalizing whitespace and comments.

### 2. Worker — one reporter, and a ticker that also carries Cancel

`reportProgress(jobId, { stageIndex, pct, step })` is the one writer: it clamps `pct` to 0–100, leaves any field the caller did not name, and always bumps `beat_at`. Absent means `undefined`, not "key missing from the literal" — see the defect note below.

`JOB_STAGE_LISTS` holds the stage vocabulary for the two kinds whose chips a screen renders (`draft`, `reconcile`); `progressReporterFor(job)` turns a step sentence into the same sentence *plus* the index it implies, so none of the boundaries has to know its own position in a list. `stageIndexFor` leaves `stage_index` alone for a sentence that is not an arrival (a failover note, a per-packet line), which keeps the chip row on the last stage the job actually reached.

Every existing stage boundary of every kind now reports through it:

- **draft** — `src/lib/news/desk.ts:1496` (`progressReporterFor`, installed as the `setStage` dependency at `:843`/`:1497`), plus the model call wrapped at `:1949`.
- **reconcile** — `src/lib/news/draft-reconcile.server.ts:60` (`progressReporterFor(job)`), preflight at `:281`, model call at `:142`.
- **dark / editor brief** — `dark.ts:2315` (seam), `:2590` and `:3720` (`waitForModel`), `:2264`, `:2728`, `:2733`, `:2755`, `:2772`, `:2821`, `:3666`, `:3684`.
- **editorial** — `editorial.server.ts:156`, `:193`, `:303`, `:332`, `:693`, `:726`–`:727`.
- **scan and its preflights** — `model-request-commit.server.ts:161`, `:325`, `:560`.
- **pull** — `pull.server.ts:706` (`reportStage`), `:709` (cancel assertion).
- **audio-transcribe** — `textflowkit-transcribe.server.ts:242` (`waitForModel`).
- **artifact-ocr** and **routine-notice** — unchanged; see the exceptions below.

`waitForModel` is now where a Cancel reaches a call in flight. A twenty-minute model call has no stage boundary inside it, so before this the editor's Cancel did nothing until the model answered. The same 12 s tick (`JOB_TICK_MS`) that says `Waiting on <model label> · 42s` asks whether the editor has asked to stop, and if so abandons the wait with the existing `JobCancelledError`. The provider call is not killed — nothing here can kill a provider's socket — it is left to finish and its result discarded, with a `.catch` attached so the abandoned rejection cannot take the process down. `label` accepts a function so the scan and OCR paths, which fail over mid-call, never name the rung that already failed. Workers call the existing `throwIfJobCancelled` between steps; the failure is the existing `failed` row with `JOB_CANCELLED_REASON = "Cancelled by the editor"`. **The existing failover path is reused, not duplicated** — "Retry on next model" is the same `planFailover`/`automatic-failover` machinery that was already there.

### 3. Client — one card, one query

`src/components/JobCard.tsx` renders all four states from one component, full and compact: **running** (chip row with the current chip marked, determinate bar when `pct` is a number and an indeterminate one when it is null, `Now:` line, `Last activity m:ss ago`, Cancel), **stalled** (`now − beat_at >= 60 s`: the design's box, and Keep waiting / Retry on next model / Cancel all still offered, because a stall is not a failure), **done** (`Your draft is ready`, bar filled, every chip ticked, Open → the server's `result_href`), **failed** (the provider's own reason, Retry, Retry on another model). A job whose `beat_at` is null is never stalled: null is "no evidence", not "very quiet". Cancel requested but still running says `Cancelling — the worker stops at its next step.` and drops the Cancel button. A row the server says cannot be retried (`canRetry: false`) gets no Retry button.

`useDeskJobs()` polls every 2 s (`RUNNING_POLL_MS`) while anything is queued or running and backs off to 30 s (`IDLE_POLL_MS`) when nothing is. `now` is a prop, which is what makes the 59 s/60 s boundary testable at all.

### 4. Placement

Where a job already showed progress, and nowhere else — the brief's phase 3 is the card, not the layout (that is phase 2). `<ActiveStoryJobs>` on Today (`src/routes/desk.index.tsx:453`, Done and Failed, 10-minute recency window, max 4) and `<StoryJobProgress>` on the story page (`src/routes/desk.story.$leadId.tsx:1246`, inside the existing banner condition). The old progress *text* in those two places is replaced by the card. The wrapper class names `.story-running-banner` and `.desk-active-story` stay — the story page's redraft e2e locates the first — but they no longer draw a panel, because the card draws its own; `src/styles.css` now says that in a comment. The card's CSS lives in `src/desk-astra.css`; `trPulse` and `trSlide` are defined there locally (phase 0's motion keyframes are not on main), and the existing `@media (prefers-reduced-motion: reduce)` block turns all desk animation off.

## Targeted evidence

- `src/lib/news/job-progress.test.ts` — **pass, exit 0.** `reportProgress` bumps `beat_at`, clamps `pct` to 0–100, leaves unnamed fields alone, and — the assertion that found the defect below — treats `{ stageIndex: undefined }` as absent. Cancel between steps stops a worker with the exact reason. The stall rule at 59 s and at 60 s.
- `scripts/job-card-render.test.mjs` — **12/12, exit 0.** Every card state rendered from the real component with the server's own view shape and a frozen clock: the chip row and the current chip, 42% determinate vs. indeterminate, the stall box appearing at 60 s and not at 59 s, a null `beat_at` never stalling, cancel-requested, done (with the href the server chose), the verbatim 429 quota reason with both Retry buttons, `Cancelled by the editor`, `canRetry: false`, compact, and the state mapping.
- The quota half has a second, independent witness: `src/lib/news/automatic-failover.test.ts` asserts that a 429 quota error plans the next rung (`{ next: "claude-sonnet", label: "Claude Sonnet", reason: "quota" }`), which is what "Retry on another model" moves along.
- `src/lib/news/jobs.test.ts` (the drift blocks), `stalled-run.e2e.test.ts`, `job-reattach.postgres.test.ts` (skips without `TEST_POSTGRES_ADMIN_URL`), `jobs.module-identity.test.ts` — all still pass.
- `src/lib/news/daily-scan.execution.test.ts`, `draft-batch-compat.test.ts`, `draft-order.postgres.test.ts` apply `0099…` from disk (PROJECT-BRIEF rule 14: a hand-built copy of `desk_jobs` is a fixture that lies about the schema).

### A defect the unit test found

`reportProgress` tested presence with `"stageIndex" in progress`, but its own documented caller — `progressReporterFor` — builds `{ step, stageIndex: stageIndexFor(...) }`, which names the key with an `undefined` **value** for every sentence that is not a stage arrival. `in` called that "present" and cleared the chip row, so a job on stage 3 would have flashed back to "no stage list" twice a minute. Fixed to `!== undefined`; the test asserts it.

### Dead code removed

`setJobResultHref` (a helper nothing called — grep found only its own definition) is deleted. The two real writers of `result_href` are `src/lib/news/desk.ts:2208` and `src/lib/news/draft-reconcile.server.ts:221`.

### Two documented exceptions

1. Two guarded raw-SQL boundaries stay unconverted: `setOwnedStage` (`dark.ts:2440-2448`, artifact-ocr) and `persistDailyRuntimeSwitch` (`daily-scan.server.ts:452-467`). `reportProgress` guards only on `id`, and the legacy `stage` column is read by real screens, so converting them would change what those screens read for no gain — and neither can leave a job quiet past 60 s.
2. `JOB_STAGE_LISTS` covers `draft` and `reconcile` only. The other eight kinds write dynamic sentences (a filename, a batch counter) that no chip row can pre-name, and no screen renders their chips: `listStoryJobProgress` filters `kind in ('draft','reconcile')`.

## What is NOT verified

- No real model, provider, socket or API was called, loaded or unloaded. The cancellation path abandons an in-flight call — that a real provider behaves well when its socket is left to finish is **not** tested here.
- The stalled-state test uses a fake clock, not a real 60 s wait.
- `draft-order.postgres.test.ts` and `job-reattach.postgres.test.ts` skip without `TEST_POSTGRES_ADMIN_URL`; they were not run against real PostgreSQL in this session. Nothing here touched 127.0.0.1:5433.
- No browser was opened. The two placements are asserted by reading the routes, and the card by rendering it to static markup — not by looking at the screens. `scripts/redraft-scan-e2e.mjs` (which drives a real draft against a real model) was **not** run; it locates `.story-running-banner`, which is still the section the card sits in, and its `/Reading scanned-packet\.pdf: page N of 13/` assertion is unanchored, so the card's `Now: ` prefix does not break it — but that is a reading, not a run.
- One limit worth knowing: `StoryJobProgress` finds its row in the shared query, which returns the newsroom's 20 newest draft/reconcile jobs. A busy newsroom with more than 20 newer jobs would drop the story page's banner for a job that is still running. Today's strip already narrows by a 10-minute window, so the assumption is the same one; it is stated here rather than hidden.
