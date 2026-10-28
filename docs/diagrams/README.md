# Architecture diagrams

Rendered SVGs for every Mermaid diagram in the project, with the Mermaid source
next to each one. GitHub renders the Markdown versions inline in
[docs/manual.md](../manual.md) and [scan-architecture.md](scan-architecture.md);
these files are the standalone exports. The manual's diagrams are in Part 5;
the Mermaid blocks in [docs/manual.md](../manual.md) are the source of truth
and `render.sh` extracts them, so a `.mmd` file is never edited by hand.

Regenerate everything with:

```bash
bash docs/diagrams/render.sh
```

## System shape

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| System context | [system-context.svg](system-context.svg) | [.mmd](system-context.mmd) | What the newsroom talks to: the public web, an optional newsletter mailbox, one machine you own (including the in-process meaning model), and whichever model you point it at |
| Data model | [data-model.svg](data-model.svg) | [.mmd](data-model.mmd) | The database shape — newsrooms, sources and their yield, snapshots, anomalies, leads, drafts, articles, corrections, investigations, newsletters, routine editions, the two vector tables |
| Keeping it online | [keeping-it-online.svg](keeping-it-online.svg) | [.mmd](keeping-it-online.mmd) | Postgres first, the 600-second start guard, two probes before a restart, the tunnel, and the nightly backup rule |

## Work flow

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| Pipeline: source to printed page | [pipeline-source-to-page.svg](pipeline-source-to-page.svg) | [.mmd](pipeline-source-to-page.mmd) | Watch list to lead to draft to editor to paper — the red box is the only way to print |
| A job, end to end | [job-end-to-end.svg](job-end-to-end.svg) | [.mmd](job-end-to-end.mmd) | Resolve the model, queue in a lane, claim, heartbeat, work, fail over, finish with a receipt |
| Choosing a provider at call time | [provider-at-call-time.svg](provider-at-call-time.svg) | [.mmd](provider-at-call-time.mmd) | The Automatic ladder (DeepSeek, Local model, Codex Sol 6.1, Claude Sonnet 5.5), named picks, technical failover, terminal refusal, the run receipt |
| Dark Desk, one round | [dark-desk-one-round.svg](dark-desk-one-round.svg) | [.mmd](dark-desk-one-round.mmd) | Competing hypotheses, the whole tape, trails that reopen |
| The Opinion desk and its voice handoff | [opinion-voice-handoff.svg](opinion-voice-handoff.svg) | [.mmd](opinion-voice-handoff.mmd) | How the publication voice reaches the Claude and Codex writers, and the DeepSeek, Local and custom writers |
| How a meeting becomes a story | [meeting-to-story.svg](meeting-to-story.svg) | [.mmd](meeting-to-story.mmd) | A recording to a lead to a bounded draft to the publish check (a warning, not a block) — and the one editor review if the recording is revised after publication |
| Routine editions | [routine-edition-flow.svg](routine-edition-flow.svg) | [.mmd](routine-edition-flow.mmd) | Owner-approved sources to fixed templates to Today in town, This weekend and Deadlines approaching, with the editor-review exits |
| Search by meaning: the index | [meaning-search-index.svg](meaning-search-index.svg) | [.mmd](meaning-search-index.mmd) | The background fill, the two vector tables (no text, no URL), and the desk-only query |
| Promote and rollback | [promote-and-rollback.svg](promote-and-rollback.svg) | [.mmd](promote-and-rollback.mmd) | `ops/promote.ps1`: backup, pre-rollout database copy, build, verify, and the automatic and by-hand rollbacks |

## Scan (v0.6.54, coverage updated for v0.6.84)

Full write-up: [scan-architecture.md](scan-architecture.md)

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| Scan overview | [scan-overview.svg](scan-overview.svg) | [.mmd](scan-overview.mmd) | Scope (including the daily scan policy), run snapshot, fetch, bounded batch analysis, coverage accounting and per-source coverage |
| How a run reports itself | [scan-run-reporting.svg](scan-run-reporting.svg) | [.mmd](scan-run-reporting.mmd) | Partial vs failure vs success-with-leads vs success-with-zero-leads |
| Scan history paging | [scan-history-paging.svg](scan-history-paging.svg) | [.mmd](scan-history-paging.mmd) | Real offset paging and when Show more disappears |

## Rendering notes

`render.sh` expects exactly **twelve** Mermaid blocks in `docs/manual.md`, in
this order: system-context, pipeline-source-to-page, job-end-to-end,
dark-desk-one-round, opinion-voice-handoff, keeping-it-online, data-model,
provider-at-call-time, meeting-to-story, routine-edition-flow,
meaning-search-index, promote-and-rollback; and exactly three in
`scan-architecture.md`: scan-overview, scan-run-reporting, scan-history-paging.
If you add or reorder a block, update the `names` lists in `render.sh` to match,
or it stops with a count error. Rendering needs Node and, through
`@mermaid-js/mermaid-cli`, a Chromium; the SVGs are committed so a reader needs
neither.
