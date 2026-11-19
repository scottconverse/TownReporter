# Registry change detection

Decision, Nov 5 2026 (Scott approved Community Navigator Phase 1 on this date).

Registry change detection uses TownReporter's own hash and diff (Option B).
Wigolo watch/diff (Option A) is not used.

## What that means in practice

TownReporter already fetches a source, stores its content hash, and keeps the
page capture in `snapshots`. When the hash changes, the changed page goes
through the same bounded scan pipeline the newsroom already runs. For a source
that carries a registry role, the scan is asked for proposed registry changes
as well as story leads, and each proposal lands in `resource_changes` with the
capture it rests on.

Nothing is published from a change proposal by itself. An editor accepts or rejects it.
**Accept and apply** also puts the proposed value on the entry.

## Why not Wigolo

Wigolo is a local-first web intelligence tool with its own watch and diff
engine. Its licence is AGPL, which is a poor fit for this repository, and its
change model would duplicate a hash-and-diff path TownReporter already runs
every day. Section 10.5 of the rewrite spec and Phase 4 of section 24 both
leave Option A open to revisit only if Option B proves to be the bottleneck
once the review lane and the hash detector are in real use.

## Scope note

An HSDS file import (Phase 2) makes proposals in the same table. When the file
says something different from a stored row, the stored row stays and the
difference becomes one pending row in `resource_changes`. The same pending
proposal is not added twice. The desk lists these under **Detected changes**.
An editor accepts or rejects each one. See [hsds-import.md](hsds-import.md#review-a-proposal).

Phase 1 covers the registry tables and the HSDS import. Change detection here
is the stored design and the review-lane table; the scan pipeline that fills
it is Phase 2.
