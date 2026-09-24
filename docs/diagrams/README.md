# Architecture diagrams

Rendered SVGs for every Mermaid diagram in the project, with the Mermaid source
next to each one. GitHub renders the Markdown versions inline in
[docs/manual.md](../manual.md) and [scan-architecture.md](scan-architecture.md);
these files are the standalone exports.

Regenerate everything with:

```bash
bash docs/diagrams/render.sh
```

## System shape

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| System context | [system-context.svg](system-context.svg) | [.mmd](system-context.mmd) | What the newsroom talks to: the public web, one machine you own, and whichever model you point it at |
| Data model | [data-model.svg](data-model.svg) | [.mmd](data-model.mmd) | The database shape — newsrooms, sources, snapshots, anomalies, leads, drafts, articles, corrections, investigations |
| Keeping it online | [keeping-it-online.svg](keeping-it-online.svg) | [.mmd](keeping-it-online.mmd) | Tunnel, watchdog, and what keeps a deployment answering |

## Work flow

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| Pipeline: source to printed page | [pipeline-source-to-page.svg](pipeline-source-to-page.svg) | [.mmd](pipeline-source-to-page.mmd) | Watch list to lead to draft to editor to paper — the red box is the only way to print |
| A job, end to end | [job-end-to-end.svg](job-end-to-end.svg) | [.mmd](job-end-to-end.mmd) | Lease, claim, work, checkpoint, finish |
| Choosing a provider at call time | [provider-at-call-time.svg](provider-at-call-time.svg) | [.mmd](provider-at-call-time.mmd) | First choice, technical failover, terminal refusal |
| Dark Desk, one round | [dark-desk-one-round.svg](dark-desk-one-round.svg) | [.mmd](dark-desk-one-round.mmd) | Competing hypotheses, the whole tape, trails that reopen |
| The Opinion desk and its voice handoff | [opinion-voice-handoff.svg](opinion-voice-handoff.svg) | [.mmd](opinion-voice-handoff.mmd) | How the publication voice reaches the writer |
| How a meeting becomes a story | [meeting-to-story.svg](meeting-to-story.svg) | [.mmd](meeting-to-story.mmd) | A recording to a lead to a bounded draft to the publication gate — and the one editor review if the recording is revised after publication |

## Scan (v0.6.54)

Full write-up: [scan-architecture.md](scan-architecture.md)

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| Scan overview | [scan-overview.svg](scan-overview.svg) | [.mmd](scan-overview.mmd) | Scope, run snapshot, fetch, bounded batch analysis, coverage accounting |
| How a run reports itself | [scan-run-reporting.svg](scan-run-reporting.svg) | [.mmd](scan-run-reporting.mmd) | Partial vs failure vs success-with-leads vs success-with-zero-leads |
| Scan history paging | [scan-history-paging.svg](scan-history-paging.svg) | [.mmd](scan-history-paging.mmd) | Real offset paging and when Show more disappears |
