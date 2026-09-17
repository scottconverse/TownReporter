# Halo-local 0.6.35 editor-feature release

Status: release candidate preparation, not a published release or deployment receipt.

This release delivers the current editor improvements without claiming completion
of every research-quality or automation outcome. Scott has authorized the local
coordinator to manage staging, release and promotion. Preserve production data,
settings, approved sources and scheduled tasks during deployment. Subsequent
authorized automation activation is a separate, recorded operation.

## Resolve the candidate

Use only the reviewed 0.6.35 source. Require successful application and Windows
installation workflows for the exact commit, then bind the published `v0.6.35`
tag, Windows ZIP and its JSON/checksum manifest to that same source. Download the
tested CI package rather than packaging the development directory's untracked
files. A version bump, push or merge is not deployment evidence.

Read the existing [0.6.34 operator procedure](HALO-UPDATE-0.6.34.md) and its
referenced ownership, staging, promotion and recovery scripts in full. Retain
those safeguards, substituting the independently resolved 0.6.35 identity, with
the staging exception below. Do not execute that historical prompt's instruction
to reset development to 0.6.34.

## Preserve the incident evidence; use a new staging database

Do **not** run the current `ops/stage.ps1` restore against `townreporter_dev`.
That database preserves the documented test-isolation incident. Existing clean
staging and acceptance databases also contain evidence and must not be overwritten.

1. Verify the production checkout's explicit ownership configuration and current
   database identity without printing secrets. Record its SHA, current served
   version, published-story count and relevant settings/source snapshots.
2. Take a fresh custom-format production backup in the existing sibling backup
   directory. Require `pg_dump` exit 0, size over 1 MiB, SHA-256 and a readable
   archive listing. Separately preserve the production configuration securely;
   never put it or the dump in Git.
3. Choose a new, absent, explicitly named staging database. Restore with
   `pg_restore --exit-on-error --single-transaction`. Verify table/story/source
   counts and absence of incident fixture newsroom IDs before application use.
4. Only inside that verified new database, disable copied monitors and pause
   copied automation. Record those staging-only changes. Use the existing staging
   editor helper with its explicit database guard; do not replace the owner.
5. Apply the candidate migrations only to this copy and verify source rows and
   approvals remain unchanged. In particular, verify the newsroom-scoped source
   identity index from migration 0056. Build only while no process serves DEV's
   output, with an explicit isolated database environment.
6. Start one recorded, loopback-only staging process on a free nonproduction
   port. Check the ordinary editor workflow, existing copied queue, Stats and
   custom-connection controls. Reuse the already recorded isolated browser/PDF
   proof; do not rerun a broad research campaign as a deployment prerequisite.
   Stop this exact process tree and verify its port is free afterward.

## Promote and verify

Preserve the existing legacy ownership checks. Establish an exclusive release
window so `origin/main` stays at the accepted release commit through promotion;
the existing promote script follows main, not a `-Ref` argument. Recheck exact
identity immediately beforehand and refuse newer/unreviewed source. Require no
queued/running production desk jobs. Record the watchdog's state, disable it for
the owned promotion, then use the reviewed production installation's promotion
procedure. Leave the shared PostgreSQL cluster and other projects running.

Verify local and public rendered content, a referenced JavaScript asset, served
0.6.35 version, production source/PID/port, unchanged story count and preserved
settings/sources. Restore the watchdog's recorded state after the build and
promotion exit. Preserve both pre-stage and promotion backups and all results.

## Recovery and limits

Record the original production SHA and exact backup paths before promotion.
If promotion fails, determine whether migrations ran before choosing recovery.
Do not blindly restore a database or the whole checkout over newer content.
Code-only rollback requires checking compatibility with the applied schema;
database restoration is a separately reviewed recovery step that must account
for post-backup work. Never remove records just to make a check pass.

Return one receipt distinguishing backup, staging, source release, promotion,
served version, configuration preservation and rollback materials. Include the
remaining reporting-quality, routine-source and daily-editor-effort limits.
The real selected-page PDF result is partial evidence, not a complete-packet or
color/table-perfect transcription claim. Do not mark the full completion program
done merely because this release is deployed.
