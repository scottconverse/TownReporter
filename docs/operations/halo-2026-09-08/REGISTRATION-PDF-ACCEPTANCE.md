# Registration PDF adapter — development acceptance

Base: 21becc6. Luna implemented the pure page-aware adapter and parser tests.
Lead integrated first-check and replay extraction and the saved-check regression.
An independent Luna reviewer accepted the four-file implementation without
running another test lane. This is not production activation or deployment.

The adapter is deliberately limited to the official Fall 2026 sports brochure:
https://longmontcolorado.gov/wp-content/uploads/2026/07/f26_sports.pdf
It derives the explicit basketball registration deadline, year, eligibility and
registration link from page text. It does not substitute the program start or
registration opening. Original PDF bytes remain the evidence; both initial
checking and reopening use existing extractPdfBetter(bytes, null), without OCR
or model fallback. The other HTML/ICS adapters remain unchanged.

## Focused verification

All Node test commands below used DATABASE_URL='', RUN_LIVE_MODEL_TESTS='',
TOWNREPORTER_TEST_ENV_VERIFIED='1' and this exact prefix:
`node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000`.

Lead baseline target: `src/lib/news/routine-notice-checks.test.ts`, exit0:
```text
ℹ tests 19
ℹ suites 1
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17937.3231
```

New target `src/lib/news/routine-notice-registration-check.test.ts`, before
integration, exit1:
```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17053.8588
```
AssertionError ERR_ASSERTION: actual 'refused', expected 'parsed', at
routine-notice-registration-check.test.ts:51:12. The original assertion/stack
is retained in the task's tool output. No import/setup failure was counted as RED.
After integration, same target exit0: tests1/suites0/pass1/fail0/cancelled0/
skipped0/todo0/duration_ms16748.6376.

Integrated targets, same prefix:
`src/lib/news/routine-notice-registration.test.ts src/lib/news/routine-notice-registration-check.test.ts src/lib/news/routine-notice-checks.test.ts src/lib/news/routine-notice-feeds.test.ts`.
Exit0:
```text
ℹ tests 29
ℹ suites 1
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 35164.4917
```
Vite printed its dependency re-optimization notice; no test warnings/errors in
the green run. `node node_modules/typescript/bin/tsc --noEmit` exited0 without
diagnostics. All local command handles terminated; no overlapping local tests.

## Real saved-source check

Command: `node artifacts/notice-real-source-check.mjs --registration`, with
DATABASE_URL='', TOWNREPORTER_CODEX=0 and TOWNREPORTER_CLAUDE_CODE=0. Exit0.
The existing manual acceptance helper used a fresh in-memory PGLite database,
one public fetch, and the normal saved-check function with that fetched document
injected as ingestion input. This is backend acceptance, not a browser walkthrough.

Receipt: `artifacts/notice-real-source-check/receipt-2026-09-11T05-56-38.147Z.json`.
HTTP200, 1309620 bytes; PDF extraction unpdf, five pages, needsOcr=false.
Original SHA256:
`74e2e4c65d2569e6f7e56f5711f23c4f7178543b2c86bb3c2911cb1bb89364a6`.
Saved/reopened result: parsed1/refused0/conflicts0. Page2 supplies Youth Basketball
League, Grades3–12, December13,2026 and https://bit.ly/recreationregistration.
Raw blob/version hashes and original bytes matched; automation stayed disabled.

## Built browser acceptance — 2026-09-11

Built source f9554fa9fdec2e384f3d7e0f93cb31d0c8ffc882 with `npm run build`,
exit 0. Log: `logs/stage-f9554fa-build.log`. Migration output confirms the exact
database `townreporter_stage_03efb7b_20260911`, up to date. The existing owned
staging process serves the build at http://127.0.0.1:3471; both native model
providers are disabled. No production restart or deployment occurred.

The staging editor could view Server but correctly could not configure owner
notice permissions. For this exercise only, its membership was moved from
editor/room 1 to owner of a new empty room 98911, `Isolated notice UI acceptance`.
The copied real owner's membership was not changed. Database identity, original
membership, empty fixture ID and no queued/running jobs were checked first.

Through Chrome's actual interface, the lead added the official brochure on
Sources, selected only its registration-deadline permission, saved it, and clicked
`Check captured notices`. At approximately 00:09 America/Denver the page showed:

- Parsed structurally: 1 parsed, 0 refused, 0 conflicts.
- Deadline 2026-12-13; eligibility Grades 3-12; Youth Basketball League.
- City of Longmont attribution and https://bit.ly/recreationregistration.
- Page-2 locators and the `Read captured text` control.
- Automatic routine editions remained unchecked. No publication was performed.

Afterward a guarded transaction restored `staging-editor` to editor/room 1.
Verification returned zero enabled fixture automations and zero active desk
jobs. Room 98911 and its source/check evidence are retained as explicitly named
acceptance data in this staging copy. They are not production data; this copy
now contains this declared fixture and must not be represented as fixture-free.
The older contaminated `townreporter_dev` database was not touched.

GitHub checks inspected during the walkthrough showed 14 passing checks and
two pending (main tests and fresh Windows install). This is not a full-CI pass.

## Remaining scope

Production owner source setup and activation remain; built UI verification for
this source is complete above. This is one
real brochure mapping, not all registration programs or future brochure layouts.
Waste bulletin saved acceptance already exists at
`artifacts/notice-real-source-check/receipt-2026-09-10T22-19-53.448Z.json`:
two parsed collection windows, no conflicts. Do not rerun that completed check
just because an older source-mapping paragraph calls it pending.
