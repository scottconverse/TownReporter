# Real-Postgres three-part proof

Baseline: merged `origin/main`, commit `c655f92f7269bd7b01abe5e9fe656f919c7d1b32`.
The local `main` ref is older (`7cff3d6cb85b7c2e25087b7a90e021af511694e2`), but both refs have the identical discovery blob `214fb608755d00c024ca2b5780946275c0159436`.
Both old runners select `postgresTestFiles(root)` when no positional paths are provided.

- [old-lane.txt](old-lane.txt) lists all 160 files returned by that committed discovery implementation, loaded directly from Git.
- [three-part-union.txt](three-part-union.txt) lists the sorted union of all three current selections.
- [parts.json](parts.json) records the baseline commit and the exact assignments: 53 / 54 / 53 files.
- [new-file-probe.json](new-file-probe.json) records the real unlisted throwaway file, its assignment to part 1, and its removal.
- [local-runs.json](local-runs.json) records local timing and test results.

The old list and union are byte-for-byte equal. The union has 160 entries and 160 unique paths: no dropped file and no duplicate assignment. The temporary file had no entry in the weights. After adding it, discovery found 161 files, the selectors assigned all 161 exactly once, and the new file appeared in one part. After removal, discovery returned the original 160 files again. Median-weight automatic assignment is the default for unmeasured files; the weights are not an allowlist.

Reproduce the lists and temporary-file probe:

```powershell
node scripts/prove-postgres-parts.mjs c655f92f7269bd7b01abe5e9fe656f919c7d1b32 docs/pg-split-evidence
```

Local runs use Scoop PostgreSQL 18.6 binaries from `C:\Users\scott\scoop\apps\postgresql\current\bin`, a fresh cluster under `%TEMP%`, UTF8 encoding and loopback port **5547**. Parts run one at a time locally to avoid sharing build and fixture state concurrently. CI runs them independently on three machines, each with its own PostgreSQL service. Wall times cover runner discovery and all selected files, including any build done by a test; dependency installation and service startup are not included. The part 1 migration and search-index steps were also run against the temporary cluster and their additional time is recorded separately.

| Job | Files | Tests passed | Runner wall time |
| --- | ---: | ---: | ---: |
| Real Postgres, part 1 of 3 | 53 | 689 | 9m22.47s (562.4744712 s) |
| Real Postgres, part 2 of 3 | 54 | 418 | 9m21.41s (561.410186 s) |
| Real Postgres, part 3 of 3 | 53 | 590 | 8m40.12s (520.1161263 s) |

All 1,697 tests passed with zero skips and zero todos. The recorded execution paths, not just the selections, equal the 160-file old lane exactly once. The migration and search-index steps passed in an additional 12.3418018 seconds. The index reduced measured buffers from 666 to 34 on the 20,000-story fixture. Raw logs remain at the paths recorded in `local-runs.json`; the temporary cluster is stopped and its data directory removed after verification.

Cleanup observation: the existing `public-surfaces.no-leak.test.ts` passed but left `townreporter_test_leakguard_7492_1791071919753` in this temporary cluster. Its teardown catches and suppresses connection/termination/drop errors, so the run does not expose which cleanup operation failed. This test was not edited. The database was removed with the entire task-owned temporary cluster; no shared database was involved.

Part 1 completed before the discovery cache optimization was in use by its launcher; its recorded wall time includes the original roughly 40-second discovery pass. The baseline proof verifies that caching parsed modules leaves the file set unchanged. The other parts use the optimized discovery. No test assertion was relaxed and no error tolerance was widened.

The behavior checks for the launcher, partitioning, discovery and actual workflow matrix pass. The new subprocess check initially exposed inherited `NODE_TEST_CONTEXT`, which causes Node to suppress a nested test-runner invocation. Clearing that internal variable in the launcher fixed execution; the test's assertions were retained. Test files for the Postgres lane itself were not edited.

Required check names to configure later in the GitHub ruleset:

1. `Real Postgres, part 1 of 3`
2. `Real Postgres, part 2 of 3`
3. `Real Postgres, part 3 of 3`

The workflow retains its existing PR cancellation/concurrency rules. No push, ruleset edit or branch-protection change is part of this work. GitHub timing remains unmeasured until the branch is pushed and CI runs.
