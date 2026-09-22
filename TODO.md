# TownReporter — TODO (canonical, in-repo)

## Current release work — 2026-09-21

The current release is [0.6.60](docs/releases/0.6.60.md): meeting capture. The paper watches the configured city YouTube channels, captures captions first, keeps the transcript as a local artifact with provenance, aligns it to agenda items, reads votes from the structured record rather than inferring them, and runs on the unattended clock. It also fixes three defects found while proving it — a citation that never named its agenda item, a daily scan that stopped silently when its configuring account lost the owner role, and a revision writer that discarded a draft's transcript citations. Publication fields are recorded in the release note after the tag, GitHub release, and Windows assets are published.

The following acceptance work remains EXPLICITLY OPEN and is not closed by this release: fresh-machine human acceptance of the Windows install; the live provider matrix (configured-provider behaviour across the full provider set); five useful Dark Desk outcomes plus the September 3–8 replay; and the post-crash detached-child limitation. Production deployment and live-model proof are not asserted here.

Meeting capture specifically does not yet include: a provisional-to-revision cycle observed against a real capture (the re-check runs, but nothing inserts a link row, so it finds nothing to look at), and any path from a transcript to a story. Section 5 produces chunks, alignments and structured votes and deliberately does not draft.

Tag boundaries: `v0.6.60` is cut from the merged 0.6.60 release commit; `v0.6.56` remains published at `86b66e1b5310730a01a2f1e6f35eb3d993afed42`; `v0.6.55` remains published at peeled commit `ce9db0344afc8dff63f57aceed763d9b0fe7864b`; `v0.6.54` remains published at `c9402d794552556519710c8ee347d6d581a91c6a`; `v0.6.53` at `baa6566`; `v0.6.52` at `9834e81`.
