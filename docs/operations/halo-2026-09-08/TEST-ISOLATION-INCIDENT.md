# Test isolation incident — 2026-09-08

## What happened

The routine-check test's direct Node/Vite database-module mismatch was repaired by using Vite's database module. The ordinary test wrapper removed DATABASE_URL before starting the process, but Vite subsequently loaded the development `.env`. That selected **townreporter_dev on 127.0.0.1:5433**, the copied staging database, not in-memory PGLite.

The focused 14/14 run therefore was **not isolated PGLite evidence**. It created fixture newsrooms 98001–98015 at 17:09:32–17:09:33 MDT. The later full sweep failed on their duplicate primary keys. I previously said staging had not been touched; that statement was wrong.

Production `.env` was not used. Fresh queries show none of these IDs in production `townreporter`, and all fifteen in staging `townreporter_dev`. Source/test inspection and the resolved development DATABASE_URL identify staging as the reached database. No fixture cleanup has been performed. No production publication or automation activation was performed.

## Retained evidence

- `artifacts/routine-checks-isolation-green-20260908.log`: 14/14 result, now reclassified as a staging mutation, not isolation proof.
- `artifacts/halo-candidate-full-tests-20260908.log`: script layer 342 total / 340 pass / 0 fail / 2 skip; source layer 1640 total / 1582 pass / 13 fail / 45 skip, 907715.6105 ms. All thirteen failures are duplicate `newsrooms_pkey` entries in this fixture.
- Staging backup before any cleanup: `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter_dev-isolation-incident-20260908-1735.dump`.
- Backup SHA-256: `2CE7B740E2BAC64666C5B131B015FD60F5506672021DDB64BC929E039C3C339D`.
- Staging query: fifteen rooms named `Routine checks`, IDs 98001–98015. Fourteen remaining fixture source rows; the last test deletes its own source.

## Response

Further database/Vite testing is paused until the environment boundary is repaired and proved without dialing a real database. Pure parsing tests may continue. No manual deletion or blanket database restoration is authorized by this record. The copied staging database is marked contaminated for acceptance purposes; do not present it as a clean production copy.

The repair must prevent `.env` reintroduction after the initial guard, not merely make fixed fixture IDs unique or remove duplicate rows. Rerun the affected fixture in independently verified in-memory storage before running broader tests. This incident remains open at this document's creation.

## Containment repair verified — 17:39 MDT

The ordinary test environment and preload guard now retain explicit empty overrides rather than deleting database/provider environment variables. A regression invokes the actual installed TanStack environment loader with a sentinel `.env` and forbids socket connections. Genuine RED and 4/4 GREEN are preserved in [TEST-ENV-RELOAD-REPAIR.md](TEST-ENV-RELOAD-REPAIR.md).

The affected routine fixture now asserts `getDbSource() === "pglite"` before queries; its independent rerun passed 14/14. Read-only staging counts before and after both remained fifteen. The full isolated suite was restarted after this proof. This closes the demonstrated environment-reload defect, not the staging contamination: the fifteen fixture rooms remain preserved, and staging must still not be described as a clean production copy.
