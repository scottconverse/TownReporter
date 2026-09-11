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

- Built-interface save/reload and actual selected-provider investigation are next.
- Deterministic fake search/capture tests are not real reporting acceptance.
- Compact summary is not an unlimited action archive; ordinary captures/search logs
  remain the underlying evidence. No new ledger service was added.
- Full repository test suite not rerun: this checkpoint uses the focused module
  tests in accordance with Scott's feature-first, single-heavy-lane instruction.
- No production settings, schedules, content, databases or running services changed.
- No new dependencies, authentication routes, browser rendering of model HTML,
  or defaults/fallback-order changes introduced.
