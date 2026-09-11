# Watch controls: stopped history and newsroom isolation

Checked through Chrome on the existing isolated staging server at port 3471,
running the built 9a7a565 source. Database:
`townreporter_stage_03efb7b_20260911`. No production mutations, builds, model
calls, or test-server launches were involved.

## Observed behavior

1. Dark Desk listed the two previously created Longmont acceptance watches:
   museum programme 140 and Ramsey packet 141, both paused.
2. Opened watch 140 and clicked **Stop watching**. The app displayed
   “Watch state saved. Capture history is retained.” State became stopped.
3. Opened its original capture after stopping. The saved museum text remained
   readable, with extraction method `readability`, redirect trail, download,
   lead-filing and investigation-attachment controls still present. Those
   latter controls were inspected, not all executed again.
4. Temporarily moved only `staging-editor` from newsroom 1 to existing
   Burlington acceptance newsroom 98912, retaining role editor. Reloaded the
   same Dark Desk page: Burlington identity and **Watched pages · 0**. Neither
   Longmont watch appeared.
5. Restored the test membership to newsroom 1, role editor. Reloaded:
   TownReporter identity and **Watched pages · 2** returned.

Final database check:

```text
newsroom membership: 1 | staging-editor | editor
monitor 140: newsroom 1 | stopped | enabled false
monitor 141: newsroom 1 | paused  | enabled false
queued/running desk_jobs: zero rows
```

The changed staging watch state is intentional; the museum watch is stopped,
not deleted. Its captures remain available. The test editor is restored.

## Scope and remaining work

This proves the basic rendered watch-list scoping across these two newsrooms,
stop behavior and retained readable history. It complements the prior normal
save/check/unchanged and watch-to-draft observations in
`READER-AND-DARK-FILING-2026-09-11.md`.

It does not prove failed-source recovery, a real changed-source event, every
authorization route, or database rollback preserving later editorial work.
Those are not relabeled complete. No additional audit or unrelated repair was
started from this check.

The museum repeat-context implementation remains independently pending the
specific owner approval requested for sending earlier unpublished lead facts
to the selected scan provider. Its two RED regression tests remain uncommitted
in `src/lib/news/desk-copy.test.ts`; no implementation or such transmission has
occurred. This documentation commit does not claim the working tree tests are
green or that a release is ready.
