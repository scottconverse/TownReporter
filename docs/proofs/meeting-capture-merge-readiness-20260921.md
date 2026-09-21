# Meeting capture: merge readiness, 2026-09-21

**Branch:** `feat/meeting-capture-continue-20260921`
**State:** Ready to merge. Not pushed, not merged, not tagged, not deployed.

The gates below were run at `dc726ff`. The only commits after it add this proof
and a link to it from the release note; no source file changed, so the results
still describe the branch head.

This records what was verified, on what, and what is deliberately left open. It
does not assert a merge, a release, a tag or a deployment.

## Gates, all re-run at this head

| Gate | Result |
|---|---|
| Meeting feature tests | 103 tests, 40 suites, 0 fail |
| Full suite | 2,246 tests, 2,198 pass, 0 fail, 48 skipped |
| Database-gated tests, real PostgreSQL | 20 tests, 0 fail |
| `npm run typecheck` | pass |
| `npx eslint . --ignore-pattern "work/**"` | 0 errors, 38 pre-existing warnings |
| Docs guards (`docs-links`, `docs-routes`) | 3 tests, 0 fail |
| Merge against `origin/main` | 12 ahead, 0 behind, no conflicts |

## Live results the branch rests on

- 21 meetings found, 19 captured across both Longmont channels.
- 18 transcript artifacts, 45,177 timestamped segments, each with SHA-256 and an
  `info.json` sidecar.
- No re-capture: a second pass left all 18 pre-existing captures byte-identical,
  including `caption_captured_at`.
- Audio fallback on a real meeting with no caption track: a 266,021,584-byte opus
  file whose size and SHA-256 were re-checked on disk after the run.
- 11 structured votes extracted, all correctly `not established`.
- 16 meetings recorded a named alignment failure rather than inventing items.
- A citation resolves to item + timestamp + excerpt + hash + path (item 8 at
  18,448s; item 5 at 1,258s; null between chunks).
- Scan run 37 reserved by the built server's own clock with
  `execution_origin = scheduled`, 12 of 12 sources analysed, 21 meetings found.

## Defects found and fixed while proving this

Each carries a regression test that was checked to **fail against the previous
code**, not merely to pass against the fix.

1. `meeting_transcript_segments.item` is never written, so every citation
   returned `item: null` on all 47,592 rows. Resolved at read time from
   `meeting_agenda_chunks`.
2. `tickDailyScans` skipped in silence when the configuring account lost the
   owner role, while every neighbouring check pauses with an actionable reason.
3. The revision writer discarded a draft's citations (`transcriptCitations: []`)
   after parsing the same list to decide which claims were affected.

## Test defects found and corrected

Three assertions were asserting a shape rather than the behaviour, and two of
them could not fail:

- The citation test passed `segment_indexes` as an array while the column is TEXT
  holding JSON, so it exercised a branch production never takes.
- Its first falsification compared the fix against itself, because
  `git checkout --` restores the committed fix.
- `meeting-revision.integration.test.ts` asserted only that the written JSON
  contains the string `transcriptCitations`, which an empty array satisfies.

## Deliberately open

- **No provisional-to-revision cycle has been observed.** Two independent
  reasons: no governance meeting has posted inside the 24-hour window during
  this work, and `meeting_draft_transcript_links` holds 0 rows because nothing
  inserts into it. The second is the substantive one -- the re-check would find
  nothing to look at even once a meeting lands inside the window.
- **No meeting transcript has produced a story.** Section 5 produces chunks,
  alignments and structured votes and deliberately does not draft. The citation
  resolver, the link table, its snapshot and the revision detection are built and
  unconnected. This is missing feature work, not a test gap, and it is the
  honest remaining distance on the spec's section 9 bar.
- The captured set is Longmont only, from two channels, on one machine and one
  local PostgreSQL.
- **Deployment is unperformed.** Production serves 0.6.54 at `c9402d7`. Its
  `_migrations` ledger ends at `0066_scan_source_packs.sql`, so deploying this
  work applies eleven migrations (`0067` through `0077`). All eleven were
  dry-run against a `pg_dump`/`pg_restore` copy of production: applied, exit 0,
  86 to 96 tables, ten new `meeting_*` tables, ledger to `0077`, and existing
  data unchanged (sources 286, articles 61, leads 199, scans 46, members 1 --
  identical before and after and identical to live). The scratch database and
  dump were removed. Production was read and never written.

## What a merge would ship

Meeting capture that watches the configured channels, captures captions with
provenance, refuses to infer votes, fails alignment honestly, names the agenda
item in a citation, and runs on the unattended clock -- with no path from a
transcript to a story, stated in the release note.
