# TownReporter — TODO (canonical, in-repo)

## Current release work — 2026-09-25

The current software version is [0.6.64](docs/releases/0.6.64.md): the daily scan on Automatic. The scheduled ordinary scan on Server can be left on Automatic instead of naming one provider before it can be saved, and it walks the writing ladder already used for stories, scans and Dark Desk — DeepSeek v4.1 Flash, then Qwen 3.6 35B on this computer when it is loaded, then Codex Terra. A schedule saved before this release keeps the model it names; nothing rewrites a stored choice, and the owner switches it on Scan settings. A scan that fetched no source text now reports that, and names the first source that failed, instead of blaming the writing pass for returning nothing. The release guide keeps source, package, GitHub publication, and production deployment as separate facts.

This change adds no migration: `daily_scan_policies.runtime` is a plain text column (`migrations/0050_daily_scan.sql:7`), so it already holds the value the policy now stores.

The following acceptance work remains EXPLICITLY OPEN and is not closed by this release: fresh-machine human acceptance of the Windows install; the live provider matrix (configured-provider behaviour across the full provider set); five useful Dark Desk outcomes plus the September 3–8 replay; and the post-crash detached-child limitation. Production deployment and live-model proof are not asserted here. Nothing in this release was run against a real AI model, and no screenshot here was taken against the live paper.

Meeting capture specifically does not yet include: a provisional-to-revision cycle observed against a real capture (the re-check runs, but nothing inserts a link row, so it finds nothing to look at), and any path from a transcript to a story. Section 5 produces chunks, alignments and structured votes and deliberately does not draft.

Tag boundaries: `v0.6.64` is the expected tag for this software version; its existence and target are verified from GitHub rather than predicted in this file. `v0.6.63`, the previous version's expected tag, is verified from GitHub the same way and is not asserted here. `v0.6.60` remains published at `e97db885364a09db6914371e53a7c3a961cd9c23`; `v0.6.56` remains published at `86b66e1b5310730a01a2f1e6f35eb3d993afed42`; `v0.6.55` remains published at peeled commit `ce9db0344afc8dff63f57aceed763d9b0fe7864b`; `v0.6.54` remains published at `c9402d794552556519710c8ee347d6d581a91c6a`; `v0.6.53` at `baa6566`; `v0.6.52` at `9834e81`.
