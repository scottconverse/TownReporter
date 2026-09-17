# Dark brief falsifier truncation repair

Development only. The real investigation9/job15 stored a kills_it instruction ending
at exactly300characters, in the middle of `premis`. The parser, not the UI, cut it.
Historical output remains unchanged; the original discarded tail is unrecoverable.

The parser now preserves ordinary normalized instructions through10,000characters.
An exceptionally oversized instruction ends with `… [truncated]` within that bound.
This does not change the model prompt, verdict policy or synthesis selection. Other
brief fields still have their existing bounds; raw model output is not separately
stored by this path. Do not claim this fixes all possible brief truncation.

Files changed: src/lib/news/dark-brief.ts and dark-brief.test.ts. Existing pending
verdict-prompt changes were preserved, not introduced by this repair.

## Test-first evidence

Baseline command: `node --experimental-strip-types --test src/lib/news/dark-brief.test.ts`

```text
ℹ tests 12
ℹ suites 3
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 95.3245
```

Same command after adding the two regressions, before changing the parser:

```text
test at src\lib\news\dark-brief.test.ts:34:3
✖ keeps a complete multi-clause instruction for the record that would settle the file (0.6705ms)
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'Obtain the complete procurement file from the City Clerk, including the signed award memo, every scoring sheet, conflict disclosure, bid tabulation, evaluator note, amendment, and the email transmitting the recommendation; then compare the named evaluators, dates, amounts, and vendor ownership again'
- "Obtain the complete procurement file from the City Clerk, including the signed award memo, every scoring sheet, conflict disclosure, bid tabulation, evaluator note, amendment, and the email transmitting the recommendation; then compare the named evaluators, dates, amounts, and vendor ownership against the Secretary of State filings and the council's final vote before deciding whether the premise survives."
    at TestContext.<anonymous> (file:///C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/dark-brief.test.ts:43:12)
    at Test.runInAsyncScope (node:async_hooks:226:14)
    at Test.run (node:internal/test_runner/test:1201:25)
    at Suite.processPendingSubtests (node:internal/test_runner/test:831:18)
    at Test.postRun (node:internal/test_runner/test:1330:19)
    at Test.run (node:internal/test_runner/test:1258:12)
    at async Promise.all (index 0)
    at async Suite.run (node:internal/test_runner/test:1619:7)
    at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) { code: 'ERR_ASSERTION', operator: 'strictEqual', diff: 'simple' }

test at src\lib\news\dark-brief.test.ts:46:3
✖ marks a defensive truncation instead of silently ending mid-instruction (0.2343ms)
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /\[truncated\]$/. Input:
'Pull the named record and compare xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    at TestContext.<anonymous> (file:///C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/dark-brief.test.ts:49:12)
    at Test.runInAsyncScope (node:async_hooks:226:14)
    at Test.run (node:internal/test_runner/test:1201:25)
    at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
    at Test.postRun (node:internal/test_runner/test:1330:19)
    at Test.run (node:internal/test_runner/test:1258:12)
    at async Suite.processPendingSubtests (node:internal/test_runner/test:831:7) { code: 'ERR_ASSERTION', expected: /\[truncated\]$/, operator: 'match', diff: 'simple' }

ℹ tests 14
ℹ suites 3
ℹ pass 12
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 104.9853
```

Same command after the parser repair:

```text
ℹ tests 14
ℹ suites 3
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 109.3881
```

Parent widened run after source-diff review:

```text
node scripts/with-app-env.mjs node --experimental-strip-types --test src/lib/news/dark-brief.test.ts src/lib/news/dark-synthesis-scope.test.ts src/lib/news/dark-signal-hygiene.test.ts
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 23
ℹ suites 4
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11731.4793
```

No warnings/errors in these test runs. Separate git diff inspection emitted its
existing LF-to-CRLF warnings. Exact10k and10,001character boundary checks and numeric
input normalization passed. No new dependency, route, credential handling, unsafe
rendering, model invocation or production change. No rebuild/deployment claimed.
