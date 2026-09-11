# Candidate 03efb7b clean staging

Candidate: `03efb7be24a948287e0796851f40b0496283c59f`, PR #43.

The interrupted build was not restarted. Its existing log
`logs/stage-03efb7b-build.log` ends with runtime asset copying and migrations
reporting up to date against `townreporter_stage_03efb7b_20260911`.
A subsequent elevated process scan found no matching DEV build process.
The original command exit status was lost across compaction; this is not a
claim to have recovered that exit code.

The fresh copied database's provenance is backup
`C:\Users\scott\Desktop\Code\townreporter-backups\townreporter-before-03efb7b-20260911.dump`,
recorded SHA256 `9AC3362B043F7217DED0CD71A383369AF4DF446E2D1F7B8361C6B5F615D7D36B`.
Previous preparation disabled its copied schedules and monitors. The old
contaminated database was not reused or removed.

After checking `current_database()` equals the exact new staging name, an
explicit transaction used the existing `upsertStagingEditor` export to create
the disposable editor. No production account was changed. The stock helper's
CLI restriction was not weakened.

The built candidate started on loopback port 3471. Database, auth URL/secret,
and data root were explicitly isolated; tunnel and native Claude/Codex
generation were disabled for this first check. Browser sign-in through the
normal email/password form succeeded and rendered the desk, Sources and Server.
The copied queue visibly linked the Development Services hours item to its
previously killed story. This proves rendering of the relationship, not full
repeat-handling acceptance.

Owner-only notice controls were correctly unavailable to this disposable
editor. A real repaired calendar check and repaired model briefing remain
outstanding. No publication or production promotion occurred.

CI snapshot for this exact SHA: fourteen successful checks; source test and
fresh Windows ZIP installation checks still running. This is not release green.

Luna's read-only historical-window review found an existing explicit date-range
control (`dark-dials-panel.tsx`) and saved preference snapshotting. Run 12's
90-day window reflects its saved setting, not a demonstrated date-engine bug.
Use the existing historical range for the next historical investigation;
do not add an unrelated date-control rewrite.
