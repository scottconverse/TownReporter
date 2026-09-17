# Responsive research — development checkpoint, 11 September 2026

Scope: full-list item 8, with item 7 live acceptance still outstanding. This is
not a production deployment or a claim that Dark Desk reporting quality is solved.

## Implemented

Sol implemented typed search/read/follow/finish decisions in the existing research
loop, reusing application search, capture and investigation persistence. The next
decision receives operation results. Search does not silently fetch a result;
read/follow performs one selected fetch. Follow uses captured-page links.
The editor-selected provider remains the chooser. Findings use existing claim
provenance handling. A compact action trail is included in the investigation summary.

Root added Research method and Maximum research decisions controls to the existing
How hard to dig panel. Batch remains the default; responsive is explicitly selected.
The saved JSON preferences and round snapshot carry the method and decision limit
(1–24, default 6), without a schema migration. Both new and continued investigations
receive these options. Other dials and verification limits remain present.

## Verification

Root baseline command:
`node --experimental-strip-types --test src/lib/news/dark-preferences.test.ts`

```text
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 79.8032
```

Same command after adding the preference test, before implementation:
```text
ℹ tests 5
ℹ suites 0
ℹ pass 4
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 88.674
```
The failing assertion was `validateResearchPreferences({}).executionMode`:
actual `undefined`, expected `batch` (ERR_ASSERTION). After implementation:
```text
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 87.3293
```

Root integrated regression command, using isolated in-memory PGLite:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/investigate.loop.test.ts','src/lib/news/investigate.responsive.test.ts','src/lib/news/research-actions.test.ts','src/lib/news/dark-preferences.test.ts'],{env:safeTestEnvironment(),stdio:'inherit',windowsHide:true}); process.exit(r.status??1);"
```
```text
ℹ tests 24
ℹ suites 3
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22659.3004
```
No test warnings/errors. These cover the existing batch path, responsive sequence,
404 feedback, explicit cap, action parser and preference validation. Sol separately
reported a meaningful 0/2 integration RED before implementing the responsive runner;
root's integrated run above was independently executed.

`npm run typecheck`: exit 0, `tsc --noEmit`, no diagnostics.
`git diff --check`: exit 0; Git emitted only LF-to-CRLF working-copy notices.

## Remaining acceptance and limits

- Source checkpoint `284f0ea` committed and pushed to `feat/utility-bill-analyzer-link`.
- Built-interface save/reload passed in staging: the saved method remained responsive
  after reload and displayed six decisions. Actual selected-provider investigation finished;
  it did not obtain primary evidence (see the terminal receipt below).
- Deterministic fake search/capture tests are not real reporting acceptance.
- Compact summary is not an unlimited action archive; ordinary captures/search logs
  remain the underlying evidence. No new ledger service was added.
- Full repository test suite not rerun: this checkpoint uses the focused module
  tests in accordance with Scott's feature-first, single-heavy-lane instruction.
- No production settings, schedules, content, databases or running services changed.
- No new dependencies, authentication routes, browser rendering of model HTML,
  or defaults/fallback-order changes introduced.

## Built staging and live run in progress

Build command: `$env:DATABASE_URL=''; npm run build` (output saved to
`artifacts/responsive-research-build-20260911.log`). Initial restricted execution
failed with `EPERM: operation not permitted, readlink 'C:\Users\scott'` from
`nitro:externals`. Same build retried with host permission: exit 0. Migration
reported DATABASE_URL not set and skipped. Existing build warning:
```text
(node:21964) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
```

Old owned staging handle 93456 was stopped only after its queue was confirmed empty.
Replacement staging handle 94373 serves port 3471, database
`townreporter_stage_03efb7b_20260911`, data root `artifacts/stage-03efb7b-data`.
Production was not restarted or rebuilt.

Via the normal editor form, started fresh job **121**, dark run **15**, at
**2026-09-11 03:45:08 MDT** with Codex Terra and this question only:

> What is proposed at 8979 Nelson Road in Longmont, what decisions have actually been made, and what can residents still weigh in on? Read the primary documents and distinguish proposals from approved actions.

The database confirms the run snapshot: responsive, actionLimit 6, dig 3, nerve 8,
county, 90-day lookback, verificationLimit 6. At this checkpoint the job is running,
not passed. Poll job 121 and the owned staging handle; do not start a duplicate.

## Terminal result and search diagnosis

Job 121 completed at **03:46:47.251214 MDT**, duration **98.871899 seconds**,
status completed / Done, no job error. Investigation 11 made five search actions
then finished on its sixth decision. Its only capture was the initial
`editor://paste` (version 1598), not a read web source. No primary document was read.
The final summary explicitly said no relevant captured pages were obtained and
that the proposal, decisions and resident participation could not be determined.
This is **not a research acceptance pass**.

Recorded searches included the exact address and City domain. Actual Bing results
were unrelated hospitals, Halloween recipes, basketball, YouTube help and cinemas.
A single direct diagnostic call through the same application function:
```powershell
node --experimental-strip-types --input-type=module -e "const {searchWithFallback}=await import('./src/lib/news/search-web.ts'); const r=await searchWithFallback('8979 Nelson Road Longmont',undefined,{officialDomains:['longmontcolorado.gov'],localityStopwords:['Longmont','Colorado']}); console.log(JSON.stringify({state:r.state,provider:r.provider,relevance:r.relevance,lineage:r.lineage?.map(x=>({provider:x.provider,state:x.state,error:x.error,hits:x.hits.length})),hits:r.hits.slice(0,3)},null,2));"
```
returned Exa `SEARCH_BLOCKED`, **HTTP 429**; DDG HTML/Lite blocked; Bing eight
irrelevant results; Brave blocked; Wikipedia zero. Aggregate relevance was
`degraded`, with the explicit reason that none matched enough question terms.
This diagnostic proves provider state at check time, not the exact historical
Exa response for each job query (individual lineage is not stored in search_log).

The responsive receipt omitted this available relevance/provider context and
said only `SEARCH_SUCCESS_RESULTS 8 result(s) discovered; none read`. A bounded
correction now preserves that context in the next-decision prompt and
visible action summary. No ranking/provider replacement or forced reading is
part of that correction. Do not repeat live searches until a usable provider
is available; preserve this failed trial unchanged.

Root reviewed Sol's two-file patch and independently ran the responsive test
file through the safe-test-environment wrapper above: **3/3 passed**, zero failures,
11,269.3376 ms. `npm run typecheck` also exited 0 with no diagnostics. The new
regression verifies the degraded result, relevance reason, Exa 429 and blocked
DuckDuckGo context reach the next decision and saved summary. This is a focused
behavioral check, not a new real-provider acceptance pass. The running staging
build still predates this narrow correction; production is unchanged.
