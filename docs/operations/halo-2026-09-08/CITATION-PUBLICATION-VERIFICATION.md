# Explicit citation lists through publication — 2026-09-08

## Scope and defect

An independent source review found that the corrected draft persistence path still fed a legacy publication fallback: an empty citation list was replaced with lead discovery URLs. The new report-backed draft now stores `citationPolicy: "explicit"` in its existing research JSON. `mayInheritLeadSources` respects that marker. Legacy/manual drafts without the marker retain their previous inheritance behavior; supplied-only and manual evidence-removal exclusions remain intact.

Files read/changed: `src/lib/news/desk.ts`, `draft-evidence.ts`, `draft-evidence.test.ts`, and `draft-lease-boundary.test.ts`. Existing serialization tests and draft-order transaction/permission helpers were also read. No new schema, dependency, model call, network endpoint, publication permission, or gate was added. URL sanitization remains in place. No secrets or executable rendering were added.

The publication regression invokes the actual `performDraftWork` then `performPublish` against guarded ephemeral PGLite. It checks the resulting article has the exact citation list, including empty. A separate actual publication case checks legacy manual drafts still inherit. Tests retain stale-lease, withdrawn-permission, killed/published lead and rollback checks. The helper test checks the marker survives evidence saving.

The other lead/draft URL union in `desk.ts` is document discovery for reporting questions, not draft/publication citation persistence; it was not changed. Already stored unmarked historical drafts are not migrated: they keep legacy behavior. No production/staging database was changed, no content actually published, and no live factual certification is claimed.

## Exact test commands and evidence

Initial direct test command mistakenly omitted the safe-runner marker. The guard refused before tests loaded. `artifacts/citation-publish-baseline-20260908.log` preserves that error, including `TownReporter tests must run through scripts/run-tests-safe.mjs.` This is not RED evidence for the citation defect.

Corrected baseline used the following invocation with files `draft-evidence.test.ts`, `draft-input.test.ts`, `draft-evidence-serialization.test.ts`:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/draft-evidence.test.ts','src/lib/news/draft-input.test.ts','src/lib/news/draft-evidence-serialization.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/citation-publish-baseline-r2-20260908.log; exit $LASTEXITCODE
```

Baseline verbatim summary: tests 7; suites 0; pass 7; fail 0; cancelled 0; skipped 0; todo 0; duration_ms 17293.7942.

RED used the same safe invocation with `draft-lease-boundary.test.ts` instead of `draft-evidence-serialization.test.ts`, output `artifacts/citation-publish-red-20260908.log`. Verbatim summary: tests 15; suites 0; pass 13; fail 2; cancelled 0; skipped 0; todo 0; duration_ms 18104.8904. Failures were assertions: the inheritance helper returned true instead of false, and the actual article contained the lead dashboard/court URLs instead of `[]`. Full errors/stacks are retained in that raw log.

GREEN/final exact widened command:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/draft-evidence.test.ts','src/lib/news/draft-input.test.ts','src/lib/news/draft-lease-boundary.test.ts','src/lib/news/draft-evidence-serialization.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/citation-publish-final-20260908.log; exit $LASTEXITCODE
```

First widened GREEN (`citation-publish-green-20260908.log`) before adding the additional manual-publication compatibility case: tests 16; suites 0; pass 16; fail 0; cancelled 0; skipped 0; todo 0; duration_ms 34069.9849.

Typecheck command: `npm run typecheck *> artifacts/citation-publish-typecheck-20260908.log; exit $LASTEXITCODE` — exit 0. `git diff --check` exit 0; only Git LF-to-CRLF normalization notices, not whitespace errors.

Source/tests held before 18:52 MDT. Parent owns the final build/full-suite candidate binding; earlier r6 build predates this repair. No commit or deployment performed by this agent.

Final widened result (exit 0), including actual legacy manual publication:

```text
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33901.2445
```

Earlier summary values above are transcribed compactly; the files are the complete raw output, not reconstructed logs.
