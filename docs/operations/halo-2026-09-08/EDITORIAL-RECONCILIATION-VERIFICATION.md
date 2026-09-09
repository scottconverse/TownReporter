# Editorial reconciliation and exact citation repair — 2026-09-08

DEV candidate only; commit history records its source identity. The earlier 1944-pass/47-skip aggregate predates these changes. The coordinator owns build, live comparison, review and promotion. No model, server, build, production database or publication operation was performed by the implementation worker.

## Scope

Four files: `src/lib/news/report.ts`, `report.test.ts`, `report.scope.test.ts`, `report.pipeline.test.ts`.

- Removed automatic organization-name-to-document links. Existing authored Markdown links remain unchanged. A shared hostname is not claim evidence.
- In the live reporting path, `preferStoryUrls` now orders only the actual cited/opened URLs; it receives no additional document candidates. An empty cited list is not replaced with all opened documents or seed URLs. The existing research memo retains the separate captured-document inventory.
- Reused the existing editing call, token limit and available-time check as a reconciliation pass, including ordinary drafts. No additional provider, model, verifier, dependency or gate was added. This can add one existing edit call on ordinary drafts that previously skipped it; it is a quality/latency tradeoff, not free work.
- The same evidence guidance is present in research, writing and editing: original prose is not invented facts; unsupported contrasts/rankings/counts are not findings; publication/event/capture dates are distinct; preserve the scope and direction of safety advice; link the exact supporting document.
- Editing no longer treats the draft as evidence. Its 7,000-character evidence allowance (formerly 3,000 announcing + 4,000 retrieved) uses the existing retriever against draft/claim queries and retains URL labels. Existing bounded draft input and token limits remain.
- Failed, unreadable, thrown-error or budget-skipped editing preserves the useful draft and adds an explicit reconciliation-not-completed note. It never calls that retained draft fact-verified.

## TDD and evidence

Baseline command:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/report.test.ts','src/lib/news/report.scope.test.ts','src/lib/news/report.pipeline.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/editorial-reconcile-baseline-20260908.log; exit $LASTEXITCODE
```
Baseline exit 0:
```text
ℹ tests 62
ℹ suites 19
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34107.4874
```

Focused RED/GREEN commands used the following command, first with `red`, then `green` in the redirect filename:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','src/lib/news/report.scope.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/editorial-reconcile-red-20260908.log; exit $LASTEXITCODE
```
RED exit 1:
```text
ℹ tests 10
ℹ suites 0
ℹ pass 5
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11468.1887
```
All five failures were assertions: automatic incorrect link, missing evidence instructions, and three ordinary drafts never entering reconciliation. Full errors/stacks are in the raw RED log.

GREEN exit 0:
```text
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11525.1682
```

Widening used the exact baseline command, with redirect names in order: `editorial-reconcile-widened-20260908.log`, `editorial-reconcile-final-20260908.log`, `editorial-reconcile-final-r2-20260908.log`, `editorial-reconcile-final-r3-20260908.log` (all under `artifacts/`). Failures were not concealed:

- First widening: 66 passed / 1 failed. An old test demanded automatic replacement of index citations with a fetched article and automatic linking. This behavior was explicitly removed. The test now requires the article remain in captured inventory, not be falsely cited, and the missing-original-citation question remain visible.
- First final rerun: two new test mistakes accessed `result.captured` instead of the existing `result.research_memo.captured`, raising `TypeError: Cannot read properties of undefined (reading 'some')`. Corrected test access, no application change.
- Second final rerun: 68 passed / 1 failed. The same old pipeline test still expected its citation warning suppressed; corrected to assert the warning survives. No application change.
- Third final rerun: see completion summary appended below.

`npm run typecheck *> artifacts/editorial-reconcile-typecheck-final-20260908.log; exit $LASTEXITCODE` exited 0 with only:
```text
> app-builder-workspace@0.6.34 typecheck
> tsc --noEmit
```

`git diff --check -- src/lib/news/report.ts src/lib/news/report.test.ts src/lib/news/report.scope.test.ts src/lib/news/report.pipeline.test.ts` exited 0. Only LF-to-CRLF conversion notices named those four files; no whitespace errors.

## Coverage and limits

Regressions cover wrong same-host link insertion, authored-link preservation, explicit dating/synthesis/safety instructions, ordinary-draft reconciliation with URL-labeled evidence, unsuccessful/unreadable/throwing edits, low-budget retention, and captured-versus-cited separation. Existing tests expecting automatic linking were deliberately updated for the newly authorized behavior, not silently weakened.

Mocked model tests prove data flow and deterministic citation behavior, not factual accuracy of the model. The edit is a model-assisted review, not an independent verifier. Existing authored links can still be wrong; this patch stops the app inventing new ones and gives the existing editing pass the proper evidence contract. Source retrieval still has finite coverage and budget. No source-specific facts were hardcoded into production.

No new authentication surface, secrets, dependency, unsafe rendering or eval. Existing model choice and access are unchanged. Parent performs native UI/live article comparison and aggregate docs/release review. This report is not a release receipt.

## Final completion summary

Third final rerun exited 0:
```text
ℹ tests 69
ℹ suites 19
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34331.816
```
Raw log: `artifacts/editorial-reconcile-final-r3-20260908.log`; SHA-256 `7A4942E211044966E270E5056F73A17ECBA0C8AFDEF1C7E136231EC897C2AE48`.

## Independent review correction — 18:29:39 MDT

The reviewer found a real defect: a successful edit returning `source_urls: []` restored the writer's previous citations because the code tested array length. Fixed by inspecting the existing parsed edit object: an explicit array, including empty, replaces citations; omission retains the writer's citations for compatibility. This application-source correction postdates the parent's r4 full-suite snapshot.

Two regression cases added to `report.scope.test.ts`: useful edited body with explicit empty citations, and useful body with omitted citation field. RED used the same focused command shown above with redirect `artifacts/editorial-reconcile-empty-citations-red-20260908.log`; GREEN changed it to `artifacts/editorial-reconcile-empty-citations-green-20260908.log`.

RED exit 1:
```text
ℹ tests 14
ℹ suites 0
ℹ pass 13
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11447.6106
```
Exact failure was an assertion expecting `[]` but receiving `['https://library.example/hours']`; full stack retained in raw log.

GREEN exit 0:
```text
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11404.9745
```
`npm run typecheck *> artifacts/editorial-reconcile-empty-citations-typecheck-20260908.log; exit $LASTEXITCODE` also exited 0, with only the same script header and no diagnostics. Source/tests held after this correction; parent owns aggregate rerun. No live factual-quality claim follows from these tests.

## Coordinator held-source verification

After the final correction, the same three-file guarded reporting command passed **71/71**, 19 suites, zero failures/skips, 34,946.2279 ms. Raw log `artifacts/editorial-reconcile-held-source-20260908.log`, SHA-256 `1B11DBC1D86BA8BD1EA62C6EE258D6661C889CFE09EACD4D654C0E263313DF5D`. Independent read-only review found no remaining blocker in explicit-empty versus omitted citation handling.

Build r5 exited 0 with database/environment overrides explicitly empty. `artifacts/halo-final-candidate-build-r5-20260908.log` SHA-256 `A2DEF5685BC2CC19D72C786D038FEFBEB5D6404DD53F0E321C4D0E8EEAFDDC5C`. Only the owned isolated server was restarted. Production was not rebuilt or promoted. The final real batch is a fresh scan's selected leads, not an identical three-story controlled comparison.
