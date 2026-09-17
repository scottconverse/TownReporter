# Acceptance-only daily scan persistence — 2026-09-08

## Boundary

This is a built-candidate test on loopback port 3461 and new database `townreporter_acceptance_20260908_1805` on the TownReporter-owned PostgreSQL port 5433. It is not production `townreporter`, not staging `townreporter_dev`, and not publicly tunneled. All 54 migrations applied to the empty database. No existing database was restored, erased or used as a fixture.

The initial process (PID 46796, 18:04:11 MDT) correctly refused startup because a persistent database requires a stable BETTER_AUTH_SECRET. The retry used a disposable, test-only secret, not production credentials. PID 24732 started 18:06:05. Account creation and owner setup used the normal authentication and setup paths; the browser used the disposable Halo Persistence Editor account.

## Saved through owner UI

- Paper: TownReporter Persistence — NOT PRODUCTION; Longmont, Colorado; America/Denver.
- Exact source: `https://longmontcolorado.gov/news/`, already approved in production but independently entered into this disposable newsroom.
- Daily scan enabled; 23:59 local; Codex Terra subscription; source cap 12; one selected source.
- UI displayed `Daily scan settings saved`, `Schedule: Enabled`, `Next run: Sep 8, 2026, 11:59 PM MDT`.

The future time deliberately avoided launching additional model work. This is persistence proof, not another unattended-execution claim. The earlier separate in-memory instance demonstrated one unattended run and pause; see ACCEPTANCE-IN-PROGRESS.md.

## Restart and recheck

Before stopping, exact PID, executable, command line and start time were checked. Only PID 24732 was stopped. Restart PID 22060 began 18:11:09 MDT with the same candidate, acceptance database and test secret.

Reloading the owner page remained signed in as Halo Persistence Editor. The same enabled policy, 23:59 time, Codex Terra runtime and next-run timestamp remained visible. Read-only database receipts before/after were byte-identical:

`newsroom_id=1, enabled=true, paused=false, local_time=23:59, runtime=codex-terra, source_cap=12, selected_source_ids=[1], revision=1`; reservations=0.

The existing **Pause daily scan** button was then clicked. Fresh database proof: `enabled=true, paused=true, pause_reason=Paused by the owner., revision=2`; reservations=0. The future test schedule is therefore paused, not left enabled to consume resources tonight.

## Raw evidence

Paths relative to `artifacts/`:

| Receipt | SHA-256 |
|---|---|
| halo-persistence-before-20260908.log | AC5BF0E24A574792E5CB65D8640FBE9F335280C5F9F52D491E12DA4C082B1900 |
| halo-persistence-after-20260908.log | AC5BF0E24A574792E5CB65D8640FBE9F335280C5F9F52D491E12DA4C082B1900 |
| halo-persistence-paused-20260908.log | EDE3F3414722BAF57EB409C57A66EC7BFFA0337AF89B1038A375E6022D88EEFB |

Migration and server logs use `halo-acceptance-persistent-migrate-20260908.log` and `halo-persistent-server*.log`. Browser observations are in this session's tool transcript. No publication, Windows reboot, service installation, production policy change or production deployment was part of this proof.
