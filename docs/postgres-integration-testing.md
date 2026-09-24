# PostgreSQL integration tests

Run database-dependent tests only through `node scripts/run-postgres-integration.mjs` with `TOWNREPORTER_RUN_POSTGRES_INTEGRATION=1` and a local or CI `TEST_POSTGRES_ADMIN_URL` pointing at the `postgres` maintenance database. The runner discovers every database-capable test. Each test prints and creates its own uniquely named `townreporter_test_*` database, migrates it, and drops it after success or an ordinary failure. The normal `npm test` command never inherits the integration opt-in.

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
