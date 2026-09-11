# Daily scan activation preparation — 2026-09-09

## Superseding live check — September 11

The September9 snapshot below is historical, not the current activation state.
Read-only inspection of production on September11 confirms daily scanning is
enabled and not paused, local_time06:00, runtimecodex-terra, cap12, revision5.
Selected source IDs:7,8,9,79,83,85,178,181,183,184,185,1665. Policy update time:
September10 at22:17:55MDT. No settings were changed during this check.

Daily reservation1 completed under earlier policy revision2 on September10:
scan20/job106,22:05:01–22:05:41MDT. The scan's execution_origin is scheduled;
12sources fetched,2leads created,3sources proposed. Its retained summary says
Development Services hours and a proposed2027budget were filed; the latter still
needed primary corroboration. Both leads had missing/invalid model scores and
were retained at0/20. This proves an actual scheduled scan, not the usefulness
of the next06:00 run or reliable ranking. Do not rerun merely to repeat proof.

Automatic notices remain enabled=false. Production checkout remains
`fe53b6ea2c217a760c55e6844cb1f74b0f10acac`; development-only notice repairs are
not silently deployed by changing activation. Separate those release needs from
daily scanning, which is already on.

Read-only inspection of the configured production checkout/database. No
settings, sources, monitors, jobs, publications, or credentials were changed.

## Resolved production state

- Checkout: `C:\Users\scott\Desktop\Code\townreporter-web`
- Database target from its `.env` (credentials withheld): `127.0.0.1:5433/townreporter`
- Newsroom: `1`
- `daily_scan_policies`: no row exists for newsroom 1. Daily scanning is not
  currently configured or enabled in the database.
- Accepted sources: 34 rows. IDs and URLs were read without modification.
- Exact duplicate accepted URLs: none.
- Duplicate check after lower-casing and removing one trailing slash: none.
  Similar coverage is therefore not an exact duplicate finding and should not
  be resolved by deleting source rows.
- `source_monitors`: 136 total; 136 enabled and `watch_state='active'`; 0 paused.
- `desk_jobs`: 0 queued or running.
- Published articles: 34 (read-only count).
- The deployed schema uses `routine_notice_policies`,
  `routine_notice_automations`, `routine_notice_automation_sources`, and
  related tables. All of those tables have zero rows for newsroom 1 in this
  snapshot, so no routine-publication automation is configured or active.

## Smallest supported activation

Use the owner-only Server daily-scan control, not a direct SQL insert. Select
one or more existing accepted source IDs (maximum 12), choose a local time in
the paper's configured timezone, choose one explicit supported runtime, and
save while disabled. Review the returned policy and runtime readiness before
enabling the already-authorized daily scan. Codex owns preparation and verification;
do not turn these operational inputs into another blanket authorization request. The existing
code validates source ownership/status, unique IDs, the 1–12 cap, and runtime
readiness before enabling (`src/lib/news/daily-scan.ts` and
`src/lib/news/daily-scan.server.ts`).

The daily scan creates leads only. It does not draft, publish, or send
digests. Routine publication is separately authorized for the approved families,
but source qualification remains unfinished. Do not activate an unresolved
calendar merely because daily discovery is enabled.

## Activation inputs to apply

The owner has already authorized daily scanning in the canonical handoff. The
remaining operational inputs are the approved source subset, local scan time
and timezone, and explicit runtime; this note does not treat that authorization
as pending. The database contains no saved subset/time/runtime to activate.

The conflicting automatic-publication calendar is an engineering/source-verification
problem for Codex, not a pending request for Scott to test or choose a time offset.
Keep unresolved mappings inactive until an authoritative representation is
verified. Other approved families can proceed independently when their mappings
pass. Daily scanning is independent and files leads only.

The editor guide states that daily scanning starts disabled, accepts up to 12
accepted sources, uses one explicit runtime, and files leads only:
`docs/editor.md` sections “The daily scan controls on Server” and “Automatic
routine editions”.
