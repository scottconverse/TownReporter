# Delivery checks — September 10, 2026

These are development checks, not deployment receipts. No production database,
settings, articles or services were changed.

## Pinned built publishing workflow

Build SHA-256: `fec0f3cb57e64b6ebb15e6401857b7b13779022905ec9904746a3902d5b7757c`.
Each command launched one fresh in-memory PGLite paper on loopback 3472, with
native model providers disabled and API keys empty. Three-minute outer deadline.

- `node artifacts/resume-publishing-check.mjs sources-reach-the-reader.mjs`
  Exit 0; result `ok: true`, 7 steps. Filed a lead, saved copy, confirmed evidence
  after editing, published, and inspected the reader's actual source link.
  Raw log: `artifacts/resume-sources-reach-the-reader.mjs-1789064453145.log`.
- `node artifacts/resume-publishing-check.mjs lifecycle-e2e.mjs`
  Exit 0; result `ok: true`. Published a manual story and verified its correction
  on the reader's page. Raw log:
  `artifacts/resume-lifecycle-e2e.mjs-1789064507859.log`.

Both logs retain Better Auth's missing trusted-client-IP warning and aborted
navigation `ECONNRESET` errors. No clean-server-log claim. These are manual-copy
workflow checks, not model factual-quality evidence.

Owned servers/children 29884/15164 and 26808/19092 were terminated after their
respective browser drivers completed. Subsequent process checks found the named
drivers and servers gone; port 3472 was free after the first run. No new workload
overlapped either browser check.

## Stats consolidation

Command:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 src/lib/news/stats-reports.server.test.ts src/lib/news/views.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 13
ℹ suites 6
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 23100.1642
```

Command:
`node scripts/with-app-env.mjs node --test --test-concurrency=1 scripts/stats-copy.test.mjs scripts/dark-desk-scheduler.test.mjs`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 133.6678
```

Both exit 0; no warnings in captured output. These rerun the existing Stats
implementation before committing it. Earlier built report-reader and actual
beacon evidence remain in the September 9 Stats acceptance documents; their
limitations have not changed. No claim of new TDD or production activation.

## Custom API delivery

The same pinned build passed `custom-api-ui-acceptance.mjs` at isolated port
3468, using fresh in-memory PGLite and a fake provider at 3471. Save, model
discovery, explicit connection test, a clear rejected-credential result, edit,
disable/re-enable, delete and mobile overflow checks passed. Exactly three
fake-provider requests occurred; save/edit invoked none. No paid provider call.
Raw log: `artifacts/resume-custom-api-ui-acceptance.mjs-1789064974434.log`.
Server 34176 and child 2956 were terminated; driver 32704 exited. A subsequent
process/listener check found these gone and ports 3468/3471/3472 unused.
The missing trusted-client-IP warning remained; it was not relabeled a product
failure or expanded into another repair campaign.

Focused source checks ran serially:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 src/lib/news/custom-ai-connections.test.ts src/lib/news/custom-ai-settings.test.ts src/lib/news/model-choice.test.ts src/lib/news/opinion-readiness.test.ts src/lib/news/perform-scan-failover.test.ts`

```text
ℹ tests 46
ℹ suites 8
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11558.4905
```

These ran against the integrated working tree, not a clean checkout of the API
commit alone. One model-choice check also covers separately uncommitted Dark
hydration. No real-provider interoperability claim is inferred from the fake
endpoint. Terra independently reviewed caller propagation; Luna wrote the
operator guide. The guide was corrected to say Responses API is *not tested*,
not an observed capability of the Test connection action.

Pushed development commits: `0f19820` (Stats) and `acf66da` (custom API).
Production remains unchanged by this delivery pass.

## Queue delivery

Focused repeat-lead tests: 10 passed, no failures/skips, 3088.6018 ms.
`lead-badge-render.test.mjs`: 15 passed, no failures/skips, 492.4163 ms.
The existing implementation preserves a killed exact repeat, holds an ambiguous
repeat of a killed lead, and returns the prior headline/status to the queue.
The checkbox now reads **Include in batch draft** below the headline; Draft
remains visible and the model controls remain available under **change**.
These checks used in-memory data and rendered components, not the live queue.
Existing production duplicates have not been retrospectively reclassified.

## One fresh Dark run — failed, not accepted

The retained election question was entered through the normal UI without an
answer or source URLs. Dedicated database:
`townreporter_dark_acceptance_20260909`; investigation 10, job 16.
Started 2026-09-10T18:34:09.542Z; failed 2026-09-10T18:39:23.417Z.
Failure: `invalid byte sequence for encoding "UTF8": 0x00`.
Three rounds were recorded before failure; the file remains paused. Its summary
mentions certified results and follow-ups, but that is not an accepted finished
investigation. Source diagnosis is underway. No retry job was created.

The old browser driver needed three setup/monitoring corrections: disregard a
paused scan policy, skip a disabled Save when settings already match, and read
`last_model_choice` rather than nonexistent `model_choice` on investigations.
These are test-driver defects, not three product failures. The first two
attempts started no investigation. The third created exactly investigation 10;
subsequent observation created no work. Raw browser receipts contain isolated
test-session credentials and remain local ignored artifacts, not public commits.
Server log: `artifacts/dark-r22-server-2026-09-10T18-31-26-482Z.log`.
The owned server 32784 and child 10260 were stopped after the job failed.
Subsequent process scan found only the existing TownReporter production pair
23012/22152 among matching server commands.

### Focused repair

Individual `PdfPage.text` values bypassed the existing combined-text cleanup
before insertion into `artifact_chunks`. The repair applies existing
`storableText` to copied page text for persistence; raw bytes remain unchanged.
One database-backed regression stores a page-14 chunk containing a NUL.
With repair: 1 passed, 0 failed/skipped, 13675.7815 ms.
With only the chunk call temporarily reverted to unsanitized pages: 1 failed,
0 passed/skipped, 11372.0816 ms, reproducing PostgreSQL error 22021 and the exact
`invalid byte sequence for encoding "UTF8": 0x00` error at `artifact_chunks`.
The repaired call was restored immediately afterward. This is a reproduced
source-path fix, not yet a new built-server or fresh investigation pass.

## Previously approved source ownership repair

The development migration changes source uniqueness from `(user_id, url)` to
`(user_id, newsroom_id, url)`. It does not remove existing source rows or rewrite
their approvals. Manual additions, seeding and discovered proposals use the
matching newsroom-aware paths. Rejected sources are not re-approved by seeding
or discovery. This is the repair Scott explicitly authorized earlier.

One isolated run of `source-identity-migration.test.ts` and `sections.test.ts`:
10 passed, no failures/skips, 12574.4862 ms. The migration test applies twice
and checks all historical rows remain while the same editor can add the same
URL to a second newsroom. No production migration was run.

## Draft recovery and batch delivery

One serialized run of `draft-checkpoint.test.ts`, `draft-reconcile.test.ts`,
`draft-batch-worker.test.ts`, and `draft-batch.test.ts`: 33 passed, 2 suites,
0 failures/cancelled/skipped, 58997.5262 ms. The environment wrapper explicitly
reported `DATABASE_URL unset -- PGLite in-memory`; provider transports were
stubbed. No production database or real model was used.

The run proves writer output is retained when a later pass fails, a newer editor
draft is preserved, reconciliation queues the saved draft, and batch results
retain their selected runtime and saved-draft identity. It does not establish
the factual quality of generated stories. Tests ran against the integrated
development working tree, not a separately built staged commit.

Luna independently checked dependency closure for this delivery slice and found
no missing import/export or ordinary-flow integration blocker. Source changes
and the editor guide are development-only; no production deployment occurred.

## Retained PDF page reader

Scott explicitly approved the editor-clicked page reader after disclosure that
selected pages go to the shown provider, cloud use may incur normal charges,
and transcripts are saved alongside—not over—the original capture. This action
requires a named model; it does not change Automatic for other workflows.

The renderer's requested-pages regression passed: pages 13–14, exact page
numbers, stubbed provider, 1 passed, 442.2639 ms. The first persistence test
failed because its fixture attempted a second job before completing the first
(`desk_jobs_one_open_per_subject`). The test now models the queue's existing
completion step; no product constraint was weakened. Rerun: 1 passed,
14886.4989 ms. It verifies the selected provider/range, page-13 transcript and
receipt, unchanged original PDF and version text, cleaned NUL text, and no
duplicate chunk for identical repeated output. All data was in-memory PGLite;
no real model, remote PDF transfer, or production database was used.

Integrated TypeScript initially rejected the OCR status response's `unknown`
result. Giving it the actual serializable receipt type resolved the error;
`tsc --noEmit` subsequently exited 0. One bounded integrated build exited 0;
its migration step explicitly skipped because `DATABASE_URL` was empty.
Build log: `artifacts/delivery-build-1789067074743.log`.
Built entry SHA-256:
`005FC96714B43FCE7D57913201C5BCCC317DCF5AE1AF52364F76B1D41F13AC8B`.
The build retains Node's DEP0190 shell-spawn deprecation warning. It used the
integrated development tree, including other not-yet-committed feature work;
it is not a clean release-candidate or production acceptance claim.

### Built desktop UI check

Terra checked the same built SHA using a fresh in-memory PGLite fixture at
`http://127.0.0.1:3491`. The captured PDF opened; requested range 13–13 and the
named-model requirement were visible; Automatic disabled submission, while an
explicit Local selection enabled it and showed the provider. A completed
page-numbered transcript displayed correctly and was explicitly labeled
`UI fixture — no OCR provider called`, not a real transcription success.
No OCR request was submitted in this UI check. The worker persistence proof
above is a separate test, not this fixture display.

Terra observed the desktop screenshot. Mobile was not tested because its browser
surface had no viewport override. Owned fixture server PID 3260 was stopped;
the lead independently found neither PID 3260 nor a listener on port 3491.
No production database or saved data was used. The fixture helper is local,
ignored `artifacts/pdf-page-reader-ui-fixture.mjs`, not a production endpoint.

## Existing extraction and publication repairs consolidated

The pending generic-CMS extraction repair retains meaningful council accordion
panels previously mistaken for navigation. The publication repair limits both
displayed and serialized citation metadata to the editor's public source list;
it does not expose unrelated saved research as a public citation.

One isolated run of `article-extract.test.ts`, `evidence.public.test.ts`, and
`public-evidence-boundary.test.ts`: 22 passed, 5 suites, no failures/skips,
22688.4498 ms. These are existing repairs being consolidated, not a new
edge-case expansion. The integrated build above already included these files.

## Existing search integration consolidated

The optional configured-localhost Gateway search adapter and existing public
fallback chain remain one TownReporter search path. An unset Gateway leaves
the default chain unchanged. Relevance-aware research can continue past
nonempty off-question results instead of treating any result as an answer;
provider failures and partial coverage remain distinguishable from zero hits.

`halo-search.test.ts` and `search-web.test.ts`: 43 passed, 11 suites, no
failures/skips, 359.4696 ms. Fetches/provider replies were injected fixtures;
this was not a live Gateway or external search-provider availability check.
No Gateway service, settings, or installation was changed.

## Shared in-process job lane — consolidation

The existing pending repair shares drainer flags across bundled background and
SSR module identities using `Symbol.for`. It does not add a scheduler or change
the existing lane limits, and does not claim coordination across processes.
Luna independently reviewed the diff and dependency closure; no ordinary-flow
blocker was identified. The lead ran both checks serially on Windows:

`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/jobs.module-identity.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 1
ℹ suites 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11063.2734
```

`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/jobs.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 37
ℹ suites 8
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11358.1842
```

Both commands exited 0, with no captured warnings or errors. These verify the
pre-existing pending implementation; this turn added no runtime logic and is
not a new TDD claim. No real provider, saved database, or production mutation.

## Research-loop consolidation check

`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/investigate.loop.test.ts src/lib/news/investigate.search-relevance.test.ts src/lib/news/absence-gate.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 51
ℹ suites 8
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 23355.1639
```

Lead-executed once on the integrated pending development source, exit 0;
no captured warnings or errors. Injected planner/search/fetch fixtures exercise
real isolated persistence. Relevant evidence stays within the planner boundary,
new search discoveries receive a fetch slot, failed startup without a source
action stops rather than spending empty hops, and abbreviated document requests
remain intact. No real investigation, source-provider availability, or model
quality acceptance is claimed. The saved failed election investigation remains
failed; these tests do not rewrite its verdict.

## Dark editor controls and ranking consolidation

Existing pending changes expose queued/running/failed job state, retain the
editor's model selection while a file opens, refresh the lists on job completion,
and distinguish cumulative rounds from per-run limits. Worth-a-Look no longer
turns an internal evidence gap into a purported monitored-record event. Scan
score diagnostics retain a valid lead at zero instead of inventing a rank.
Luna independently reviewed the Dark dependency group; no ordinary-flow blocker
was found. A question about successful synthesis after failed new research
remains for real-output review, not a demonstrated defect requiring a new gate.

`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/dark-round-failover.test.ts src/lib/news/model-choice.test.ts src/lib/news/desk-copy.test.ts src/lib/news/worth-a-look.test.ts src/lib/news/schema.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 150
ℹ suites 26
ℹ pass 150
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 23088.0114
```

`node scripts/with-app-env.mjs node --test --test-concurrency=1 --test-timeout=60000 scripts/dark-picker-hydration.test.mjs`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 71.0691
```

Both parent-executed commands exited 0 without captured warnings or errors.
These are existing-source consolidation checks, not a new TDD claim. The two
picker checks inspect source, not a browser. Final built-interface acceptance
and real investigative quality remain separate outstanding work.

## Native provider guidance, Opinion readiness, and follow-ups

The pending native adapter adds opt-in duration/byte-count diagnostics without
logging prompts or responses, and separates state-folder startup problems from
expired login guidance. Unset reasoning preserves the native setting; the
optional app override currently accepts only the previously verified `high`.
Opinion readiness now receives the authenticated newsroom so explicitly chosen
custom connections resolve in the correct newsroom. Generated follow-up tasks
deduplicate spacing and final-period differences without changing human tasks.

`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/ai-codex.test.ts src/lib/news/forced-runtime.test.ts src/lib/news/opinion-readiness.test.ts src/lib/news/notes.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 61
ℹ suites 7
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12742.4237
```

Parent-executed, exit 0; no captured warnings/errors. Native process tests used
fake child executables/Node and injected transports, not real Codex or Claude
generations. No paid API, local model, or production database was used. These
checks consolidate existing changes; no new test-first implementation claimed.

## Reporting checkpoint and discovery regression consolidation

Parent ran `node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/report.stage.test.ts src/lib/news/report.discovery-query.test.ts`.
Result: 4 tests, 1 suite, 4 passed, 0 failed/cancelled/skipped/todo,
22951.8158 ms, exit 0. Wrapper confirmed empty DATABASE_URL and in-memory
PGLite. Injected model/source responses check retained writer checkpoints,
truthful progress phases, and exclusion of an unrelated search result; they
do not establish real reporting quality. These previously untracked tests
belong with the already committed reporting implementation.

Development commit `5f66df6` was pushed successfully to the existing GitHub
development branch. No production promotion was performed.

## Integrated editor build checkpoint

Parent ran `node artifacts/build-delivery-candidate.mjs` against HEAD `6061201`
plus the preserved pending runtime changes. Exit 0. Raw log:
`artifacts/delivery-build-1789072683045.log`. Build wrapper PID 16200 exited;
the following process check found only the unchanged production server pair
23012/22152 among TownReporter/test/build matches. Saved DATABASE_URL was
cleared, migration explicitly skipped, and model providers disabled for build.
One recorded warning: Node DEP0190 (shell argument concatenation); no build
error. Entry file SHA-256:
`EAF1318570C639CC4D580FDAC7F89D93AED971A6BC2017D80D4D243BF31255B4`.
This is an integrated development build, not a clean-commit release or browser
acceptance claim. Production remains unchanged.

`node node_modules/typescript/bin/tsc --noEmit` then exited 0 with no output.
Parent next ran `node artifacts/resume-publishing-check.mjs sources-reach-the-reader.mjs`
with that exact build hash. Seven browser steps passed: first-run editor setup,
lead with source, manual story/save, evidence review, publication, reader source,
and source link. Raw log `artifacts/resume-sources-reach-the-reader.mjs-1789072790794.log`.
Fresh in-memory PGLite, providers disabled, no production content or settings
changed. Owned server PID 28272 and child 35700 were stopped successfully;
driver 34912 exited. Server log includes aborted-request ECONNRESET errors and
a Better Auth client-IP warning. The functional flow passed, not a clean-log
or generated-reporting-quality claim.
