# 0.6.35 release preparation — September 10

Production was not deployed, restarted or reconfigured in this preparation.
Its tracked checkout was clean at `b097d288d9237be225bc6ed56851078ad064d208`.
The read-only live database check at18:58 MDT returned39 published articles,
76 source rows and0 queued/running desk jobs. These fresh counts supersede the
older34/75 snapshot for this deployment; they are not an unexplained loss/gain test.

## Candidate and checks

Development source before the version-only preparation was
`42e738cc3d8dc63e25c4500a64ffc9064eadb698`, pushed on PR41.
All browser jobs, real-Postgres job and package creation passed at the observed
checkpoint. Main test and fresh Windows install were still pending; final results
must be resolved before release. Workflow URLs:

- https://github.com/scottconverse/TownReporter/actions/runs/34548274227
- https://github.com/scottconverse/TownReporter/actions/runs/34548274328

Luna prepared current-version fields and candidate labels; the lead owns the
operator guide, staging and release acceptance. This is not a release tag or a
production receipt. The subsequent version commit needs its own exact-source CI.

## Fresh backup and clean migration staging

- Backup: `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter-pre-0635-20260910-1900.dump`.
- Created18:59 MDT; custom format;94,198,196 bytes; `pg_dump` exit0;
  archive listing readable,614 table-of-contents entries.
- SHA-256: `F8D4D0C2469E6749A5AA2121C226430F75F89C25DB9B5C138710165BE64A97EC`.
- Source: `127.0.0.1:5433/townreporter`.
- New destination: `townreporter_stage_0635_20260910`, confirmed absent immediately
  before creation; owned by existing role `townreporter`.
- Restore: `pg_restore --exit-on-error --single-transaction`, exit0.
- Restored counts:39 published articles,76 sources,0 incident fixture newsrooms
  (IDs98001–98015),0 queued/running jobs.
- Before any application launch, a database-name-checked transaction disabled139
  copied monitors. Daily policies, routine policies and routine automations each
  had0 rows to pause/disable. Production settings were not changed.
- Direct candidate `scripts/migrate.mjs` used an explicit destination URL and
  applied only0055_custom_ai_connections.sql and0056_newsroom_source_identity.sql,
  exit0. No application build or model generation ran alongside the restore.
- Post-migration whole-row source digest matches production:
  `eb5b2df68758b6f1fdb2ab05f71258c0` (MD5 of ordered JSON rows, comparison only).
  Both have76 rows. The new unique index exists only in staging, with columns
  `(user_id, newsroom_id, url)`.

The old contaminated `townreporter_dev`, earlier clean copies, acceptance drafts
and incident evidence remain intact. No staging server has yet been started for
this new copy. Final-version built UI, compatible rollback, merge/tag/release,
promotion and served-version verification remain outstanding.

Seven TownReporter scheduled tasks were observed Ready, including Nightly Proof.
No task was changed. Production ownership settings still identify the web
checkout, loopback port3000, and the explicit PostgreSQL18.6-1 tools/data directory.
