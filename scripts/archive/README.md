# scripts/archive

Scripts that are kept, not run.

Every file here was moved out of `scripts/` by Unit U5 (2026-09-30) because
nothing ran it: not a CI job, not `npm test` (which discovers only
`scripts/**/*.test.mjs` and `src/**/*.test.ts`), not another script. Several had
been cited in comments and docs as if they were guards -- one CSS comment named
`contrast-audit.mjs` as the thing that "rejects" a low-contrast pair while that
file had not executed since it was written and two of its nine assertions had
gone stale against the product.

Nothing was deleted. `git log --follow scripts/archive/<file>` has the history.

`scripts/orphan-walks-are-run-or-archived.test.mjs` fails the build if a
`scripts/*e2e*.mjs`, `*walk*.mjs` or `*-audit.mjs` file exists in `scripts/`
that a CI job does not run and that is not in this directory, so a new walk
cannot quietly join this pile.

## Read this before reusing one

These live outside `scripts/`, so they are NOT discovered by
`scripts/integration-ports-are-unique.test.mjs` (which scans `*.mjs` in
`scripts/` only) and are NOT covered by the orphan test above. A file moved
back into `scripts/` must be wired into a CI job in the same change.

The proofs and reports under `docs/` and `artifacts/` that name these paths
still name them as they were when they were written. They are records of what
was done, so they have not been rewritten to point here.

## Index

| File | Why it is here |
| --- | --- |
| `audit-038.mjs` | One-off 0.3.8 Longmont edition audit by an agent. Writes screenshots to `/workspace/screenshots/audit-038`, a path that exists in no checkout or runner here, and asserts nothing that is still a product claim. |
| `bn2-brace-check.mjs` | Hand tool for unit BN2: counts braces in a stylesheet named on the command line, ignoring comments and strings. Asserts nothing about the product and nothing invokes it. |
| `bn2-probe.mjs` | Unit BN2's hit-test probe. Its own header cites `questions/BN.md § 1`; there is no `questions/` directory in this tree. |
| `codex-reporting-boundary-proof.mjs` | Makes exactly ONE signed-in Codex model call, on purpose ("a CLI failure is a failed proof, never a pass"). A live paid call cannot run in CI. |
| `desk-route-regression.mjs` | Needs `DESK_ROUTE_STATE_FILE`, a signed-in editor storage state produced by `scripts/dark-live-signin.mjs`, which is not in this tree. |
| `file-editorial-from-json.mjs` | One-off recovery tool: takes a CLI-output JSON path and a userId and files that piece onto the Opinion desk. A tool for one incident, not a guard. |
| `golden-score.mjs` | CLI that scores a story TEXT FILE you supply against a golden fixture. Needs `--text-file`, which nothing produces; the scoring itself is unit-tested in `src/lib/news/golden-facts.test.ts`. |
| `meeting-activity-e2e.mjs` | Unit N-3's proof, run against the operator's own database: it asserts a specific artifact SHA-256, a 6-1 council tally and a named council member, none of which anything in the tree seeds. Also writes `work/n3-rendered.txt` -- `work/` does not exist. |
| `meeting-manual-run-e2e.mjs` | Unit N-2's proof. Presses "Run meetings now", which performs a REAL YouTube capture (it reads back stored caption hashes for real video ids) with 600-second waits, and defaults its storage root to `C:/Users/.../townreporter-reliability-0651/work/n2-storage`. |
| `model-picker-fit-e2e.mjs` | Unit P item 7's measurement of whether option text fits its select. Needs a server you started and writes to `../model-picker-fit` outside the checkout. |
| `preview-thumbnail.mjs` | A capture tool for the external `SandboxInternal.CapturePreviewThumbnail` service, which invokes it by path. **If that harness is still live, update its path to `scripts/archive/preview-thumbnail.mjs`.** Nothing in this tree calls it. |
| `pull-progress-e2e.mjs` | Pull's real editor path, which is a REAL public web search: it asserts on "Mechanical web search and document extraction" results and on source URLs saved into Pulled notes. A walk that depends on the live web is not a CI guard. |
| `readability-0.6.2-e2e.mjs` | The 0.6.2 readability pass's before/after screenshots. `READABILITY_LABEL` names the output and the "before" run is a separate invocation against pre-fix source via git stash. Its subject -- the desk's token pairs, including `.chip.st-killed` -- is now guarded in CI by `scripts/contrast-audit.mjs`, and its rendered-state claim by `publish-blockers-walk.mjs`. |
| `stage-03efb7b-calendar-check.mjs` | Asserts `DATABASE_URL` is exactly the copied staging database `townreporter_stage_03efb7b_20260911`, then WRITES to it (unpauses a policy). A one-off check against a named staging copy; by construction it can run nowhere else. |
| `story-model-controls-e2e.mjs` | Requires a REAL local OpenAI-compatible model: it selects "local-model", presses "Draft with AI" and waits up to 12 minutes for a 200+ character draft. Its own comment says it is "a real model run ... not a mocked mutation". |
| `sweep-claims.mjs` | A one-off data migration over existing `claims` rows (`--dry` / `--apply`), run by hand through `with-app-env`. It mutates a real database and asserts nothing about the product. |
