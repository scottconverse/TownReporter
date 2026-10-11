# Editor overrides outside Publish

Base: `origin/main` at `cb5b437c`. Branch: `feat/editor-override-desk`.

Policy refusals return `{ ok: false, warning: { key, sentence } }`. The shared desk consent dialog uses the existing Dialog and ActionButton. Approval repeats the captured request with the approved keys; cancellation does not repeat it. Overrides write `audit_events` with action `override`, editor, timestamp, warning key, and target. Sequential warnings retain earlier approvals.

## Audit coverage

| Audit item | Behavior and principal behavioral tests |
| --- | --- |
| 1 | Setup guidance keeps controls enabled, including invited editors. Server warnings allow explicit approval. `paper-setup-gate-wiring.test.ts`, `model-request-override.test.ts`, `paper-setup-gate-hook.test.mjs`. |
| 2 | Killed leads can draft or rewrite after approval; the queued receipt authorizes the worker. `model-request-override.test.ts`, `remaining-policy-override.test.ts`. |
| 3, 4 | Short nonempty headlines, missing news reason, and editing killed/published leads warn, then save with audit. Empty headline remains hard. `lead-edit-override.test.ts`, `desk-policy-actions.test.ts`. |
| 5, 6 | Hold/kill and reopen preserve saved drafts and published stories after approval. A missing earlier lead remains hard. `lead-lifecycle-override.test.ts`. |
| 22, 23 | About/Opinion filing preserves the approved section. Transcript overrides queue the exact owned artifact; conflicting runs cancel the old lease before replacement. `model-request-override.test.ts`. |
| 24 | Story, scan, batch, Dark, brief, and evidence reconciliation offer explicit stop/restart when the model changes. Identical running work is retained. `model-request-override.test.ts`, `remaining-policy-override.test.ts`, `dark-override.test.ts`, `draft-reconcile.test.ts`. |
| 25 | All five scoped hourly caps warn without consuming a run. Approved enqueues consume runs; failed enqueues do not. Reddit remains hard. `ops.test.ts`, `model-request-override.test.ts`, `dark-override.test.ts`. |
| 26, 27 | Cooldown and paused-source checks warn, then check once without changing the saved source status. `desk-policy-actions.test.ts`, `ops.test.ts`. |
| 29 | Nonaccepted source scan preferences can be saved after warning while preserving source status. `source-preference-override.test.ts`. |
| 31 | An approved source cap above 12 is saved and used by the planner. Migration 0145 removes the database cap constraint. `remaining-policy-override.test.ts`, `daily-scan.test.ts`. |
| 32 | Batch sizes outside 1-5 warn; approved six-lead and empty batches proceed. Queue selection retains saved lifecycle states. `remaining-policy-override.test.ts`, `queue-batch-picker.test.mjs`. |
| 33, 34 | Missing follow-up links and short Pull queries warn, then proceed with audit. `follow-up-override.test.ts`, `desk-policy-actions.test.ts`. |
| 36 | An owner can run disabled meeting capture once without enabling the saved schedule; the actual capture engine honors that one-run flag. Editor role and already-running checks stay hard. `remaining-policy-override.test.ts`. |

Queue rendering also verifies that killed and published rows retain Edit, Hold, Kill, and Draft controls: `lead-badge-render.test.mjs`.

## Validation

- Red: executing the new model, Dark, daily/batch, and actual meeting-engine regressions against the base implementation produced 13 failures out of 14 tests. Implementation files were restored in `finally`. The new reconciliation restart test and Queue rendering test also failed before their fixes.
- Green: the combined focused regression run passed 268/268 tests across 36 source test files. Later edits were verified with focused reruns of the affected tests. Three UI/script test files passed 42/42 tests.
- Source tests ran with `safeTestEnvironment()` and the existing environment guard, model seal, and PGlite migration preload. No application database or model service was used.
- Checks: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, and `git diff --check`.
- Production compilation: direct Vite client/SSR/Nitro build under the safe test environment. The full `npm run build` deployment command was not run because it includes database migration. No application services were started or restarted.
- Boundary check: `publish-blockers.ts`, `performPublish`, `publishLead`, and the story Publish bar match the base after normalizing line endings. The original checkout retains its two pre-existing untracked files; all edits are in this worktree.

KEEP behavior remains covered by the existing URL guard, legal/evidence takedown, owner-only sections/outlets, and deletion tests, plus missing-record, empty-headline, identical-running-job, and hard Reddit tests. `opinion.ts` is unchanged, including its refusal to discard a request with a saved piece.
