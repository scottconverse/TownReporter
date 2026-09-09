# Editorial assignment verification — 2026-09-08

Implementation is development-only and uncommitted at this report's preparation. No live model, production database, build or deployment was performed by this workstream. The parent coordinates those separately.

## Evidence provenance

The baseline, initial RED/GREEN, changed-requirement RED/GREEN and first widened summaries below were recovered from this agent's actual command-tool outputs. They were **not originally saved as raw log files**. These are a transcription of observed output, not a claim of retained raw logs. Per-test PASS lines are omitted; failures and summary lines are retained.

A fresh widened run is separately retained at `artifacts/editorial-assignment-widened-20260908.log`. That raw log is Git-ignored under existing policy. Its exact summary and hash are appended after completion.

## Scope

Explicit opening Write-box commands are captured separately from pasted evidence in existing notes JSON. Assignment subject/form and the current as-of date reach research, writing and editing. Explicit brief requests bypass automatic promotion. One bounded editing attempt may shorten an overlong brief; if it remains overlong, the useful draft is retained with a length warning and an honest `reported` form. No model capabilities are narrowed. Council topic guessing is unchanged. Temporal instructions are not a mechanical fact verifier.

Source files: `write-story.ts`, `notes.ts`, `model-request-commit.server.ts`, `desk.ts`, `report.ts` under `src/lib/news`. Tests: `write-story.test.ts`, `write-story-commit.test.ts`, `report.scope.test.ts`.

## Baseline and initial TDD

Exact command, used for baseline, initial RED and initial GREEN:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/write-story.test.ts','src/lib/news/write-story-commit.test.ts','src/lib/news/report.scope.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);"
```

Baseline (exit 0):

```text
ℹ tests 17
ℹ suites 2
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22672.0651
```

Initial RED (exit 1):

```text
ℹ tests 21
ℹ suites 2
ℹ pass 18
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22826.6424

✖ failing tests:

test at src\lib\news\report.scope.test.ts:13:1
✖ honors an explicit short assignment over the research angle and carries dating constraints through editing (12.0172ms)
  AssertionError [ERR_ASSERTION]: overlong brief must receive one bounded shortening pass
  
  2 !== 3
  
      at TestContext.<anonymous> (file:///C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/report.scope.test.ts:30:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 2,
    expected: 3,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src\lib\news\write-story-commit.test.ts:62:3
✖ persists the authenticated Write box assignment independently of its scratch evidence (1017.0566ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + undefined
  - {
  -   origin: 'write-box',
  -   requestedForm: 'brief',
  -   text: 'Write a short local item about upcoming library programs.'
  - }
  
      at TestContext.<anonymous> (file:///C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/write-story-commit.test.ts:72:12)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: { origin: 'write-box', text: 'Write a short local item about upcoming library programs.', requestedForm: 'brief' },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at src\lib\news\write-story.test.ts:7:3
✖ keeps an explicit opening assignment separate from pasted evidence and through notes serialization (1.7938ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + undefined
  - {
  -   origin: 'write-box',
  -   requestedForm: 'brief',
  -   text: 'Write a short local item about upcoming programs using https://example.org/events/.'
  - }
  
      at TestContext.<anonymous> (file:///C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/write-story.test.ts:12:12)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.start (node:internal/test_runner/test:1096:17)
      at node:internal/test_runner/test:1617:71
      at node:internal/per_context/primordials:466:82
      at new Promise (<anonymous>)
      at new SafePromise (node:internal/per_context/primordials:435:3)
      at node:internal/per_context/primordials:466:9
      at Array.map (<anonymous>) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: { origin: 'write-box', text: 'Write a short local item about upcoming programs using https://example.org/events/.', requestedForm: 'brief' },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

Initial GREEN (exit 0):

```text
ℹ tests 21
ℹ suites 2
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22835.7252
```

## Correction: preserve an overlong useful draft

The initial implementation rejected an overlong requested brief after editing. Parent review correctly identified this as an unnecessary lockout. The corrected behavior retains the draft and warns. This correction was separately RED/GREEN tested.

Exact command:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/report.scope.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);"
```

RED (exit 1):

```text
ℹ tests 5
ℹ suites 0
ℹ pass 4
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11411.6807

✖ failing tests:

test at src\lib\news\report.scope.test.ts:40:1
✖ keeps a useful overlong draft with an honest form and visible length warning after one edit (3.3732ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
  
    assert.ok(!("error" in result))
  
      at TestContext.<anonymous> (file:///C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/report.scope.test.ts:51:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '=='
  }
```

GREEN (exit 0):

```text
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11366.8658
```

## Typecheck

Exact command: `npm run typecheck`.

First run exited 1 on an introduced optional-string-array inference error:

```text
> app-builder-workspace@0.6.34 typecheck
> tsc --noEmit

src/lib/news/report.ts(1344,34): error TS2345: Argument of type '(string | undefined)[]' is not assignable to parameter of type 'string[]'.
  Type 'string | undefined' is not assignable to type 'string'.
    Type 'undefined' is not assignable to type 'string'.
```

The retrieval-query filter was given an explicit type predicate. Same command then exited 0 with no diagnostics beyond its script header. This is a corrected introduced error, not a pre-existing failure.

## Widened verification and raw-log rerun

Exact widened command:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/write-story.test.ts','src/lib/news/write-story-commit.test.ts','src/lib/news/report.scope.test.ts','src/lib/news/report.test.ts','src/lib/news/report.pipeline.test.ts','src/lib/news/notes.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);"
```

Last pre-archive run, exit 0:

```text
ℹ tests 105
ℹ suites 25
ℹ pass 105
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 45723.4721
```

Fresh raw-log rerun uses the identical command followed by `*> artifacts/editorial-assignment-widened-20260908.log`, then `exit $LASTEXITCODE`. No source edits are being made during the parent candidate build.

The fresh raw log completed on 2026-09-08 with:

```text
ℹ tests 105
ℹ suites 25
ℹ pass 105
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 45932.2136
```

Raw log: `artifacts/editorial-assignment-widened-20260908.log`.
SHA-256: `87C1208D3E18D326A33284B33DC6E6B398E32A0C0EA572C7463EE0E4D1FF58FB`.
This is a newly captured raw rerun, not a reconstruction of the earlier RED/GREEN outputs.

## Honest limits

- These tests inject model responses and use the safe isolated test environment. They prove plumbing, persistence, form steering, bounded editing and warning behavior, not live factual quality.
- Legacy scratch is deliberately not promoted into an assignment; only new explicit opening commands from Write a story acquire the separate field.
- Short-request recognition is deliberately narrow, not a general natural-language parser. Topic/category guessing remains separate follow-up work.
- No temporal contradiction classifier was added. As-of/date instructions must still be evaluated against live output before claiming the stale fundraising assertion is fixed.
- `git diff --check` passed. Git emitted LF-to-CRLF conversion warnings for the eight touched source/test files; these were line-ending notices, not failing checks.
