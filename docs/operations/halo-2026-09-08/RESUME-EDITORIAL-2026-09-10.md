# Resumed editor acceptance — September 10, 2026

The new authorized 16-item list is the full objective, not the older board's
numbering. Production is now `fe53b6e` (0.6.35 plus the Utility Bill Analyzer
link). The old delivery board's undeployed statements are historical.

## Current execution

- Lead owns live acceptance and integration. Luna `/root/release_docs` owns
  README/CHANGELOG status corrections only; no worker processes or tests.
- One real individual draft started through the public signed-in UI for lead
  125, Safety and Justice Center parking. Explicit Codex Terra, normal Research
  public sources, no modified brief, no supplied answer, no publication.
- Browser tab 1225668954, `/desk/story/125`, must remain open while completing.
  The UI reports a dropped click and says it is pulling the finishing draft.
  Native Codex PID36516 was confirmed parented by production PID35288 at the
  observation. This is a live request, not a reason to launch another draft.
- Current queue showed NEW2, DRAFTED0, HELD0, KILLED60. Do not apply historical
  bulk reconciliation against this changed state.
- Live Stats saved/latest reports were invoked and all three opened: daily
  September9 =6 site loads; week August31–September6 =136; August month =0.
  Baseline live site loads183, today14, welcome-story total4/today0. One real
  welcome-story browser visit was then made for a beacon check; follow-up
  results still pending. These operator checks count as views, not readership.

## Observed results

- The original individual draft completed and the browser recovered it after
  the dropped connection, without a second generation request. The lead is
  now DRAFTED, with a four-paragraph practical parking story and two cited city
  sources. No publication occurred.
- Lead read captured versions1516 and1508 via the actual evidence controls.
  Garage dimensions,45-to87 spaces,December2026 schedule,Tuesday8:30–11 shuttle,
  entrances,free parking and overnight restrictions match. One wording issue:
  the draft's ADA spaces "are available" is stronger than source "will be
  available". Source pages contain substantially identical city copy, not
  independent corroboration. Irrelevant national justice-center pages also
  appear in captures; they were not used in this short draft.
- Started the ordinary Check draft against evidence control with Codex Terra;
  no prompt steering or manual correction preceded it. Follow this same job.
- Live welcome-story count moved total4→5/today0→1 after one actual browser
  visit. Site count moved183→184/today14→15. All three saved reports opened
  through owner controls. Home-only visit and retention re-open still pending.
- Luna returned README/CHANGELOG correction READY_FOR_REVIEW; lead inspected
  the diff. No code, build, deployment, or model change from that worker.

## Continuation: evidence-check result

Read-only database inspection confirmed jobs 104 (draft) and 105 (reconcile)
completed. The live story workbench says the checked saved draft is loaded.
The checked body still asserts ADA parking "is available" rather than the
captured source's "will be available". The check therefore succeeded as a
workflow but missed this factual-strength issue. No repeat generation or
publication was initiated. The original and checked draft must not be
represented as independently verified reporting.

Luna is inspecting the general reconciliation instructions read-only to
distinguish a missing instruction from a model miss. No production code,
database configuration, or services were changed for this investigation.

GitHub release inspection reconfirmed v0.6.35 is a published prerelease with
the Windows ZIP, JSON manifest and SHA256 assets. README/CHANGELOG corrections
are documentation updates, not a new release or deployment.

## Daily scan activation and saved editorial correction

Through the owner UI, saved and enabled a daily 06:00 America/Denver scan,
explicit Codex Terra, source cap 12. Read-only production query confirmed
enabled=true, paused=false, runtime=codex-terra and selected existing accepted
source IDs [7,8,9,79,83,85,178,181,183,184,185,1665]. No sources were added or
approved. The initial next-run display was September 10 at 22:03 MDT (the
overdue same-day catch-up); successful execution remains to be observed.
Routine notice publication permissions/settings were not changed.

After preserving the failed model-check result, corrected one sentence in
lead125 through the normal editor: "The city says additional ADA-accessible
parking will be available ...". Save and full page reload retained it and
the citations. This is an explicit human-style editorial correction by Codex,
not a model success. Nothing was published.

Luna's read-only source review located a missing explicit temporal-modality
rule in EVIDENCE_RECONCILIATION_RULES (report.ts); existing general date-role
rules do not say to preserve planned/conditional versus current status.
A small general prompt correction and focused prompt-contract test remain
to implement. Older Luna-cited artifact jobs are historical, not job105.
No new code tests/builds or native model calls ran during this continuation.

README, CHANGELOG and this receipt through the initial check result were
committed and pushed as 9c89911. Other historical untracked files were not
blindly included.

Live home-page-only visit moved site loads184 to185 and today15 to16 after
Stats reload. The previously saved daily report reopened in a fresh Stats
tab. Full daily/weekly/monthly controls remained listed after reload. Source
stats-reports.server.ts persists reports under the installation data root,
one file per completed period, and implements no automatic pruning. Thus
retention is indefinite until operator removal, not a promised finite window.

## Remaining scope

### Integrated focused verification

Repair checkpoint: local commit `7726ad3`; not yet pushed or deployed.
Then ran the complete scripts test group serially (the source test group is
still outstanding for release):
```powershell
$env:DATABASE_URL=''; $env:RUN_LIVE_MODEL_TESTS=''; $env:TOWNREPORTER_TEST_ENV_VERIFIED='1'; node --import ./scripts/test-environment-guard.mjs --test --test-concurrency=1 'scripts/**/*.test.mjs'
```
Process exited 0:
```text
ℹ tests 368
ℹ suites 0
ℹ pass 365
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 41703.1874
```
This is not an all-tests-passed claim: three checks skipped. Captured reasons
include unavailable authenticated GitHub CLI and Windows symlinks not permitted;
the initial tool output was truncated, so the third skip's reason was not retained
in this receipt. The deliberate staging-guard rejection tests printed refusals
for a production database name and unset DATABASE_URL. No production fixture
run was authorized. The test process exited; no next suite was left running.

Command (DEV, blank database and no live model calls):
```powershell
$env:DATABASE_URL=''; $env:RUN_LIVE_MODEL_TESTS=''; $env:TOWNREPORTER_TEST_ENV_VERIFIED='1'; node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test --test-concurrency=1 src/lib/news/desk-copy.test.ts src/lib/news/report.scope.test.ts
```
Result, process exited 0:
```text
ℹ tests 118
ℹ suites 16
ℹ pass 118
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22542.4176
```
These cover prompt construction and existing draft/evidence behavior, not a
live model's repeat-detection accuracy. The prior typecheck also passed after
the SQL delimiter correction. The js-yaml lock update is limited to 4.3.2;
an incidental npm removal of an unrelated optional lru-cache entry was undone.
Full release verification and deployment remain separate.

### Scheduled run and resumption — later September 10 continuation

The scheduled catch-up completed as reservation 1, scan 20, job 106 for
2026-09-10. Its two leads repeated published Development Services hours and
budget coverage; their missing/invalid ranking scores were retained as zero.
This proves execution, not useful discovery. The repeat-context repair and
ranking diagnosis remain unfinished.

The lead paused the schedule during a control check; saving settings did not
resume it. Later, the lead used the actual **Resume daily scan** button on the
signed-in production Server page. A fresh read-only database check returned
`1|t|f|06:00|codex-terra|5` for newsroom, enabled, paused, local time, runtime,
revision. Daily scanning is resumed; source selections and notice-publication
permissions were not changed.

Integration review found an extra backtick in the unpublished published-story
SQL template. `npm run typecheck` initially exited 1 with TypeScript
`Error: Debug Failure. False expression.` in `parseVariableDeclarationList`.
Removing that extra delimiter made the same command exit 0 with no diagnostics.
The earlier prompt-builder tests did not cover this SQL wiring. This syntax
repair is DEV only; no deployment, service restart, or public test publication
occurred during this continuation. The typecheck process exited.

All sixteen requirements remain tracked by the user attachment
`654d3aa3-6b3a-4da0-8a86-dcae7b6a0ceb/pasted-text-1.txt`. No broad reporting,
Dark Desk, automation, PDF, daily-target or complete Stats verdict is implied
by the checks above. No production publication, restart or model configuration
change occurred during this resumed acceptance.

## Library activation preparation and fresh failure (22:35 MDT)

Added the exact City library category through the signed-in Sources UI:
`https://longmontcolorado.gov/events/category/library/`, source 2875,
title `City of Longmont — Library events`. The accepted-source count changed
151 to 152. Saved only its `library-notice` permission (revision 1), with
issuer City of Longmont, locality Longmont, Colorado, branch Longmont Public
Library and the same public attribution URL. Saved inactive edition settings.
Automatic publication is still off; edition sections still need selection.

One fresh manual check produced **parsed 0 / refused 20 / conflicts 0**.
Production receipt 1 retains blob 628 and artifact version 1534. Read-only
inspection of those actual captured bytes found 20 calendar cards in 525,094
bytes. Their visible times now use nested spans and `10 a.m.` / `10:30 a.m.`;
the current `visibleClockMinutes` recognizes only undotted `am` / `pm`.
This is the reason the visible-card map is empty, not a demonstrated timezone
conflict. The narrow notation repair and regression remain pending here.
No source times were invented, and no notice or test article was published.

The sole source-suite session 74959 remains live and advancing, with raw output
at `logs/source-tests-20260910-repair.log`. No replacement suite was started.
Earlier worker-test setup failed with EPERM while unlinking the DEV Vite cache;
after DEV write permission was granted, that focused worker test passed
1/1 and exited. That setup failure was not treated as a product defect.

OpenAI workflow: Luna `/root/scan_score_diagnosis` performed a read-only
diagnosis while the lead operated the notice UI. No worker tests or edits.
It confirmed malformed/missing scores deliberately become zero and warned
that the raw model output is needed before selecting a ranking repair.
Published context is advisory and deliberately permits genuine developments;
this source inspection does not prove duplicate suppression in real use.

### Source-suite cancellation failure and owned-child cleanup

The same source suite reported:
```text
  ✖ the happy path still kills the real child this process holds (2089.7094ms)
✖ ENG-06: never taskkill a PID this process does not still hold (2116.1397ms)
```
The runner was PID7860; the failing test was PID45204, executing
`src/lib/news/provider-login.test.ts`. Fresh process inspection identified two
children, PID3264 and PID27440, both running this repository's
`scripts/fakes/fake-codex-cli.mjs login --device-auth`. Neither was a real
provider login. PowerShell Stop-Process failed with
`Object reference not set to an instance of an object.` Freshly reverified
PID-scoped Windows taskkill then successfully terminated exactly those two
children. The existing suite resumed and advanced into later files. This
manual cleanup does not turn the failed cancellation assertion into a pass.

Luna's follow-up source review found that provider-login's killTree handles
taskkill spawn errors but ignores nonzero process exits. The existing Claude
adapter already has an exit-code fallback pattern. The live test does not
establish why termination failed in this permission environment; retain the
failure and verify that distinction before selecting a repair. No production
process was killed or application code changed for this diagnosis.

Prepared the dotted-time regression in
`scripts/routine-city-library-category-extractor.test.mjs`, using the existing
versioned City-category fixture rather than requiring an ignored artifact.
It has not run yet, and the production/parser fix has not been applied.
The single source suite must finish before the next test is launched.

## Objective 10 disposition — live Stats/report verification complete

The recorded live browser observations above satisfy the requested narrow
Stats outcome: an individual story visit incremented its count once, a separate
home-only visit incremented site loads, and installed daily/weekly/monthly saved
reports all opened. The daily report also reopened in a fresh tab. The persisted
report implementation retains completed-period files without automatic pruning.
Counts remain page loads, not unique people or proof of reading. No new tracker,
recipient subscription, or externally delivered report was requested by item 10.
This closes that item only; it does not certify editorial quality or the daily
paper target, and it does not require another Stats testing campaign.

## Completed serial verification and library repair

The original full source command (same guard/environment as above, with
`--experimental-strip-types --test --test-concurrency=1 'src/**/*.test.ts'`)
finished with exit 1. Full output, including PDF warnings and all skip reasons:
`logs/source-tests-20260910-repair.log`.
```text
ℹ tests 1839
ℹ suites 385
ℹ pass 1793
ℹ fail 1
ℹ cancelled 0
ℹ skipped 45
ℹ todo 0
ℹ duration_ms 1170227.6883
```
The sole failure was the recorded owned-child cancellation assertion:
`AssertionError [ERR_ASSERTION]: cancelling the happy path must actually kill the real child`,
`true !== false`, at `provider-login.test.ts:535:14`. It is not erased.

Re-ran only that file with host process-termination permission, no source changes,
blank DATABASE_URL, no live models, and the test environment guard:
`node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test src/lib/news/provider-login.test.ts`.
Exit 0; `logs/provider-login-host-permission-check.log`:
```text
ℹ tests 30
ℹ suites 7
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11185.1243
```
This establishes permission-sensitive behavior for this run, not a repaired
application lifecycle. No lifecycle code was changed. A final process census
found no matching source-suite or fake-login processes.

Calendar repair: two lines in `visibleClockMinutes` now accept dotted and
undotted periods. The saved-source comparison still rejects conflicting times.
Added the regression to the existing tracked `routine-notice-checks.test.ts`.
The exploratory untracked script was restored to its previous content. Its first
attempt and the first source-test mutation incorrectly injected markup into JSON;
their `parsed 0/refused 1` failures are not valid bug reproductions. The corrected
fixture mutation touches only visible time spans and reproduces the live failure:
`parsed 0/refused 20`, versus required `parsed 19/refused 1`.

Exact RED/GREEN command (same guarded blank-database environment):
`node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test src/lib/news/routine-notice-checks.test.ts`.
Valid RED, exit 1, `logs/library-dotted-time-red-valid.log`:
```text
ℹ tests 19
ℹ suites 1
ℹ pass 18
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18607.3057
```
GREEN, exit 0, `logs/library-dotted-time-green.log`:
```text
ℹ tests 19
ℹ suites 1
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18262.742
```
`npm run typecheck` subsequently exited 0, no diagnostics. Review: existing
hour/minute bounds and JSON-LD matching remain intact; no new route, credential,
dependency, rendering, or permission change. This is DEV verification only.
The installed parser still needs deployment and a fresh live source check.

## Fresh Dark Desk run: investigation 9, job 109 (in progress)

Started through the installed owner UI at 23:01:34 MDT, September 10. Exact
assignment: "Did a second Democrat in the 2025 Longmont mayoral race split the
vote against Shakeel Dalal?" Explicit Codex Terra (`codex-balanced`), no fallback,
no supplied links, candidate facts, desired answer, or prompt modifications.
The prior unsubmitted browser tab had closed; this is one actual submission,
not a restarted investigation. No publication or second model lane was started.

Run 12's persisted settings are dig=3, nerve=8, county scope, 90-day lookback,
verificationLimit=6. The saved date preference resolves June14–September11,2026;
the emitted searches use June13/September12 exclusive boundaries. That window
is poorly suited to this historical question and is an acceptance limitation,
not evidence that 2025 records were exhaustively searched.

At 23:05 MDT the same job remained running with a current heartbeat. Captures
include the City certificate (artifact532, 17,041 characters), candidate list
(536), County certification announcement (537), and results page (538).
Persisted model claims correctly use the City certificate's combined Boulder
and Weld totals: Hidalgo-Fahring12,501; Dalal7,799; Crist6,593; Levison5,090.
They explicitly distinguish those facts from unproved affiliation and causal
vote-transfer allegations. This proves useful document capture and use during
the run, not completed investigative acceptance. Final brief still pending.

Luna `dark_run_settings` performed a read-only source diagnosis: the workspace
"up to5" is the hard-coded legacy `investigations.budget`, whereas execution
uses `budgetFor` on the run's saved dials (3 hops). No UI repair was attempted
during acceptance. Actual completed-run summary must settle the hop count.

Candidate PR43 is open at `209b0ddeedf89b5b78a6846fee503ae81322f740`.
Fourteen hosted checks are successful; source test and Windows installation
remain running at this checkpoint. Nothing from PR43 has been deployed.

### Finished run and substantive failure

Job109 completed at 23:06:19.814751 MDT, 285.802931 seconds after start,
error=null. Run12 records Hops3of3,13 artifacts,179 open frontier entries,
verification eligible0/attempted0. The captured finance article is artifact542.
The final brief says unknown and correctly distinguishes totals from the
unproved causal claim. However, its connections field falsely says the City
certificate puts Crist ahead of Dalal, despite its own accurate totals
6,593 versus7,799. It also invents a disagreement with the finance article.
This fails clean reporting acceptance; successful capture is not sufficient.
The original brief remains unchanged in production. No public article exists.

Luna's read-only follow-up found the missing general comparison instruction in
BRIEF_SYSTEM; the pack already supplies the captured evidence. Added a general
numeric-comparison paragraph, with no election names, numbers or expected
answer. Scope: compare aligned values, not row order; do not call agreeing
records contradictory; check consistency across JSON fields. No extra model
call, validator framework, routes, permissions, dependencies or UI changes.

The existing module's baseline command, in guarded blank-DATABASE_URL/no-live-
model environment, was:
`node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test src/lib/news/dark-brief.test.ts`.
Exit0:
```text
ℹ tests 14
ℹ suites 3
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 91.2017
```
Same command with the new prompt-contract test before implementation: exit1,
`logs/dark-brief-comparison-red.log`, full assertion preserved there:
```text
ℹ tests 15
ℹ suites 3
ℹ pass 14
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 97.4971
```
Failure: AssertionError ERR_ASSERTION, input did not match
`/compare the actual numeric values/i`. After implementation, same command,
exit0, `logs/dark-brief-comparison-green.log`:
```text
ℹ tests 15
ℹ suites 3
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 106.4315
```
These tests establish prompt-contract presence and unchanged parsing/packing,
NOT reliable model arithmetic. A real brief through the repaired application
is still required. Curated investigative tools remain unresolved: this run
shows the existing loop can find/read decisive records, but its historical
date limitation and brief error do not justify waiving the entire requirement.

`npm run typecheck` exited0 with no diagnostics after the prompt change. Luna
reviewed the actual two-file code/test diff and found no material regressions,
no election-specific steering, and no new tool restriction. This was independent
source review, not an independently rerun model trial. The production checkout
remains clean at fe53b6e. Before the next push,15 of16 existing candidate checks
are green (including Windows installation); the hosted full test job is still
running. The new prompt requires its own candidate CI and live acceptance.
