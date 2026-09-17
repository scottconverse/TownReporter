# Citation persistence repair — 2026-09-08

Development candidate only. No production publication or saved acceptance-draft rewriting.

## Reproduced live defect

The ordinary three-item batch preserved the Indicators dashboard in its body, research inventory, claims and provenance (artifact 32, 4,505 characters, capture event 41), but saved only Scientific American in `source_urls`. Municipal Court similarly disappeared from the court draft's source list.

`performDraftWork` in `desk.ts` applied `dropListingUrls` to already-cited documents. The function deliberately removes root/listing and watched URLs for discovery. That policy is not valid for substantive primary citations. Its fallback also repopulated an explicitly empty reporter citation list from lead seeds.

The narrow fix persists `sanitizePublicUrls(reported.source_urls)` directly. It neither adds uncited sources nor removes discovery filtering elsewhere. Ownership, job lease and transaction fences remain unchanged.

## Actual persistence regression

`draft-lease-boundary.test.ts` uses guarded isolated PGLite and the actual `performDraftWork` persistence path. Two additions assert that a root dashboard, an external article and a watched substantive court page all survive, and that explicit `[]` remains empty despite nonempty lead sources.

- Baseline: 6/6.
- Genuine RED: 6 passed / 2 failed (external-only instead of all three citations; inherited lead URLs instead of empty).
- Widened GREEN: 43/43, 10 suites, zero skipped/failed, 29,247.7424 ms. Includes lease/permission/rollback, discovery filtering and report-level empty/omitted semantics.

Guarded command:

```powershell
node --input-type=module -e "import{spawnSync}from'node:child_process';import{safeTestEnvironment}from'./scripts/test-environment.mjs';const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/draft-lease-boundary.test.ts','src/lib/news/report.scope.test.ts','src/lib/news/extract.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'});process.exit(r.status??1);"
```

Raw logs in `artifacts/`:

| File | SHA-256 |
|---|---|
| citation-persist-baseline-20260908.log | E90DE70BAEF0D0EBC7BCD6D90AE8B4758C378A9C1BD2DAF4D2B0AB6851D6BAA5 |
| citation-persist-red-20260908.log | 6A3D1E13C6B4985CEAE0893B5A9D972172597BF57444BAB54D03841A20E8DF76 |
| citation-persist-green-20260908.log | 7C512506FDBE4C21A15A29EE0DB41651915254644C58EA0B95D9D58E46DA7CCF |

## Independent downstream review

Read-only review confirmed draft persistence and its fences, but found that `publishLead` could still inherit lead seeds when an ordinary public-research draft had explicit empty citations. The existing `mayInheritLeadSources` only recognized supplied-only and manual-removal cases. That publication path is being corrected separately while preserving legacy/manual compatibility; the 43/43 receipt alone does not prove publication semantics.

The original live drafts remain untouched in the backed-up acceptance database. No post-fix live model batch or real publication is implied by the deterministic tests. This repair preserves citation identity; it does not establish that every cited source supports every assertion.

## Downstream correction completed

The publication path now respects `citationPolicy: "explicit"` stored in the existing research JSON for new report-backed drafts. Legacy/manual inheritance remains. Actual guarded PGLite tests run `performDraftWork` through `performPublish`; final **17/17**, zero failed/skipped. [Publication receipt](CITATION-PUBLICATION-VERIFICATION.md) preserves RED/GREEN and limits. Historical unmarked drafts are not migrated.

Final application build r7 and typecheck passed. Build log `artifacts/halo-final-candidate-build-r7-20260908.log`, SHA-256 `EFFC1AA71E27D21E7131A5E808E27E559B8B37465ECA9F1CB25992629B0BC351`. Database overrides were explicitly empty during build. A final smoke process, PID 22792 started 18:53:31 MDT on loopback 3461, returned HTTP 200 with the acceptance-paper label. It was identity-checked and stopped with its owned child. Three acceptance drafts remain, zero active jobs, daily policy paused. The earlier r4 suite predates these last corrections; use the focused 43/43 and 17/17 receipts alongside it, not a claim that r4 alone tested final source.
