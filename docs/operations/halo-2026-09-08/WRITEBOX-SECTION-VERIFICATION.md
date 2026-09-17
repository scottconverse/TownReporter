# Writebox configured-section selection — DEV verification, 2026-09-08

Source changes began **17:28:58 MDT**, after test-only changes at **17:27:31 MDT**. Last source edit **17:29:58 MDT**. These changes are not part of the earlier live candidate or full-suite snapshot. No build, deployment, model invocation, production section changes or commit was performed by this worker.

## Behavior and files

The Desk Write box now has **Section (optional)**, populated by the existing authenticated newsroom section configuration. Choose Community life (or any configured reporting section) to file there. Leaving the selector at its current-default option preserves the existing text-based guess, including its Council fallback; omission is not relabeled an explicit editor choice.

- `src/routes/desk.index.tsx`: accessible labeled native selector, loading/error copy, no required extra operator step, selected key sent with the existing request. A section-loading failure leaves ordinary writing available. The select remains usable after a load error so a stale selection can be cleared.
- `src/lib/news/desk.ts`: passes the optional key through the existing authenticated route.
- `src/lib/news/model-request-commit.server.ts`: reads that newsroom's section configuration and uses existing `resolvedSectionKey` before filing. Rejects absent/foreign keys, retired keys, About/Opinion and malformed inputs. It does not impose the scan-only accepted-source requirement on a supplied story.
- `src/lib/news/write-story-commit.test.ts`: accepted custom key, hidden key, omission, foreign key, retired key, reserved keys, malformed string and non-string tests.

Hidden is not disabled in this product: visibility controls newspaper navigation. Hidden active reporting sections remain valid. Retired sections cannot be selected for a new Writebox assignment; existing database alias/retirement safeguards remain unchanged. No taxonomy, dependency, migration, model restriction or automatic classifier was added.

## Raw evidence and exact commands

All test runs use the existing safe test environment and isolated PGLite. Raw logs retain full output, including failures. Baseline, initial RED, assertion RED and GREEN used this exact command with their respective output paths listed below:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/write-story-commit.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/writebox-section-baseline-20260908.log; exit $LASTEXITCODE
```

The next invocations changed only the redirect filename, in order, to `artifacts/writebox-section-red-20260908.log`, `artifacts/writebox-section-red-assertions-20260908.log`, and `artifacts/writebox-section-green-20260908.log`.

Baseline, exit 0:
```text
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11138.1908
```

Initial RED included an intentionally throwing `getSql` stub (`Error: Must validate before filing`). That was corrected into ordinary isolated inserts plus assertions, before implementation, so invalid-input cases prove behavior rather than throw from test instrumentation. The initial raw log is preserved, not counted as the valid RED for those cases.

Assertion RED, exit 1: two accepted custom/hidden cases actually filed `council` instead; eight invalid/reserved cases returned true instead of false. Every failure is an `AssertionError`; full stacks are preserved in the raw assertion log.
```text
ℹ tests 17
ℹ suites 1
ℹ pass 7
ℹ fail 10
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11278.154
```

GREEN, exit 0:
```text
ℹ tests 17
ℹ suites 1
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11232.7562
```

Widened command, exit 0:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/write-story-commit.test.ts','src/lib/news/sections.test.ts','src/lib/news/report.scope.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/writebox-section-widened-20260908.log; exit $LASTEXITCODE
```
```text
ℹ tests 29
ℹ suites 1
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33940.8024
```

Typecheck command: `npm run typecheck *> artifacts/writebox-section-typecheck-20260908.log; exit $LASTEXITCODE`, exit 0, no diagnostics:
```text
> app-builder-workspace@0.6.34 typecheck
> tsc --noEmit
```

`git diff --check -- src/routes/desk.index.tsx src/lib/news/write-story-commit.test.ts src/lib/news/model-request-commit.server.ts src/lib/news/desk.ts` exited 0. Its only warnings were `LF will be replaced by CRLF the next time Git touches it`, naming each of these four files; no whitespace errors.

## SHA-256 manifest for raw logs

All paths relative to repository `artifacts/`:

| File | SHA-256 |
|---|---|
| writebox-section-baseline-20260908.log | 8F7FFC1B4B207FF388A6E2EA01821DAA255BDB04D45B5242CBCA539FA228997F |
| writebox-section-red-20260908.log | CF7CC5163A8A10ADEB033AF113BD333A7CDAA704F0B6147E36F09BB206C5BB27 |
| writebox-section-red-assertions-20260908.log | 43FBC504ADB7D7BEC0F6D68F6503ABC7671B564BD86191BADFC0D9F1FA5DBC99 |
| writebox-section-green-20260908.log | DE68BF8C91BED1645A5891E835B7B0F30474EDEF774D74BBF4F4AAE29283B529 |
| writebox-section-widened-20260908.log | 03201F160C4A1AB4BEDB9C1A392BB114B5943B862BF6A3786798C039628011EB |
| writebox-section-typecheck-20260908.log | 40148F68DF4B7BB088819268236EDE5A35507D065E533B725D78EF1715BB4652 |

## Limits and handoff

- Native UI desktop/mobile/loading/error/console acceptance is pending the parent candidate rebuild. Source wiring and typecheck are not a claim of browser acceptance.
- Commit tests inject a section census while exercising the real resolver; the widened existing sections suite exercises the real configuration/database path. No production database was queried or changed for this implementation.
- No automatic topic classification was added. An unchanged unselected request can still receive Council; users can now choose an existing community section before generating.
- Topic retention in the reporting pass already protects the selected lead topic. The existing report tests remain green.
- Existing authenticated editor boundary is retained; only owner's existing section configuration determines eligible keys. No secrets, unsafe rendering, eval or new dependencies are introduced.
- Parent maintains aggregate changelog/manual and independent review. This report is not a release receipt.
