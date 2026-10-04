# PostgreSQL integration tests

Run database-dependent tests only through `node scripts/run-postgres-integration.mjs` with `TOWNREPORTER_RUN_POSTGRES_INTEGRATION=1` and a local or CI `TEST_POSTGRES_ADMIN_URL` pointing at the `postgres` maintenance database. The runner discovers every database-capable test. Each test prints and creates its own uniquely named `townreporter_test_*` database, migrates it, and drops it after success or an ordinary failure. The normal `npm test` command never inherits the integration opt-in.

## Four parallel CI parts

The PR workflow runs `Real Postgres, part 1 of 4`, `Real Postgres, part 2 of 4`, `Real Postgres, part 3 of 4`, and `Real Postgres, part 4 of 4` independently. Each has its own PostgreSQL service, runs its files serially, and has a ten-minute job timeout. The existing workflow concurrency rule cancels superseded PR runs. `fail-fast: false` lets the other parts finish if one fails. Each part applies the migrations; part 1 also runs the search-index benchmark.

The runner discovers the same complete set as the former single lane, then assigns files by longest measured time first to the lightest part. `scripts/postgres-integration-weights.json` records seconds, not a test allowlist. A newly discovered file absent from the weights receives their median time and is assigned to exactly one part automatically. Neither a file's name nor its position in discovery determines whether it runs. Both part variables must be set together; positional subsets cannot be combined with part selection.

Run one part against a disposable UTF8 cluster, for example:

```powershell
$env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION = '1'
$env:TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL = 'postgres://postgres@127.0.0.1:5547/postgres'
$env:TOWNREPORTER_POSTGRES_PART = '1'
$env:TOWNREPORTER_POSTGRES_PARTS = '4'
node scripts/run-postgres-integration.mjs
```

Leave both part variables unset to run the entire lane. Do not use the live paper's port 5433.

Reproduce the coverage and new-file proof from the merged main commit with:

```powershell
node scripts/prove-postgres-parts.mjs c655f92f7269bd7b01abe5e9fe656f919c7d1b32 docs/pg-split-evidence
```

This loads the baseline discovery module directly from Git, writes the old file list and the sorted union separately, asserts equality and absence of duplicates, and records each part's files. It creates an unlisted database-capable throwaway test, runs discovery and all four selections, asserts exactly one assignment, removes the file, and checks the original discovery set is restored. The committed evidence is in [pg-split-evidence](pg-split-evidence/README.md). The weights affect balance only; updating them cannot remove coverage.

## Recovery after an interrupted test process

A killed process can leave its scratch database behind. Record the **exact database name** from the test output. Connect to the same local PostgreSQL instance through the `postgres` maintenance database and list databases and connections before acting:

```sql
SELECT datname FROM pg_database WHERE datname = 'townreporter_test_MEASURED_NAME';
SELECT pid, application_name, state FROM pg_stat_activity
 WHERE datname = 'townreporter_test_MEASURED_NAME';
```

Replace `townreporter_test_MEASURED_NAME` with the actual name; do not run a wildcard drop. If the name is absent, there is nothing to recover. If a test process still owns it, let that process finish. Once the test process is confirmed dead and the exact target is confirmed disposable, close only that database's remaining connections and drop only that database:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = 'townreporter_test_MEASURED_NAME' AND pid <> pg_backend_pid();
DROP DATABASE "townreporter_test_MEASURED_NAME";
```

Never substitute `townreporter`, `townreporter_dev`, `postgres`, or a database whose origin is uncertain. Keep the leftover and report its exact name if ownership cannot be established. CI's PostgreSQL service is ephemeral and needs no host cleanup.
