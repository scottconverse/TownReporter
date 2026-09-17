# TownReporter owner work report — 2026-09-08

## Bottom line

**Production is up at v0.6.34. The development repairs are implemented and tested; automation activation and the complete editorial-day acceptance target are not finished.** Nothing from this candidate was silently deployed, pushed or published. Scott remains sole direction authority.

Public `https://townreporter.org/` returned HTTP 200 and rendered 0.6.34; production checkout remains `b097d288d9237be225bc6ed56851078ad064d208`. Its new daily-policy and routine-automation tables remain empty. Fresh production reads found zero queued/running jobs and zero test fixture newsroom IDs 98001–98015.

## The authorized four-item work list

| Item | Actual outcome |
|---|---|
| Focused acceptance gaps | Exercised normal owner controls, native-provider drafting, claim-to-capture navigation, desktop/mobile UI and policy/login restart persistence. Fixed canonical URL matching. Screenshots were visually inspected in the tool transcript, not misrepresented as saved PNG artifacts. This is not an exhaustive UI acceptance claim. |
| Ordinary editorial/community workflow | Fixed Write-box instruction and section retention. Same short request returned a 348-word Community brief. Fixed scanner extraction on the actual ingestion path; ordinary scans now yielded real leads and three-item batches completed. Some generated assertions still need editing. |
| 60-minute / 3–5 useful-item measurement | Latest scan: 45.437 seconds. Latest three-draft batch: 320.065 seconds, native Claude Code. This proves throughput to drafts, not three publication-ready items or a measured hour of editorial work. Contrasting-community coverage and the historical replay remain unproved. |
| Narrow resulting engineering | Implemented regression-tested installer cleanup, scheduler timezone, capture identity, assignment/section, scanner extraction, reconciliation and citation save/publication repairs. Source committed locally in scoped commits; latest application-source commit `8f2e1e6`. |

The latest batch was a fresh scan's selected leads, not identical inputs to the first batch. I did not secretly brief the model, manually polish the test outputs or call a completed job a factual-quality pass. The first batch's unsupported counts, contrasts and inverted guidance are preserved in [the editorial result](EDITORIAL-DAY-RESULT.md). The later batch improved but retained a misdated advisory, unresolved court-access clarity and a citation-persistence defect. The last defect has deterministic end-to-end regression proof after repair; the original saved drafts are unchanged.

## Test and runtime evidence

- Full ordinary suite r4: **1,953 passed / 0 failed / 47 skipped**. It began before the last incremental corrections; it is not an immutable final-source CI certificate.
- Held reporting source: **71/71**. Citation persistence/discovery/lease coverage: **43/43**. Actual isolated draft-to-publication and legacy-compatibility regression: **17/17**.
- Final typecheck, build r7 and loopback HTTP smoke passed. Those checks do not establish release CI or production deployment.
- Daily scanning ran unattended in an isolated instance and could be paused. A separate persistent instance preserved owner login and saved daily policy through restart. The test policy is now paused.
- All owned acceptance servers and their child workers are stopped. No test generation is running. Production, Ollama, LM Studio, DSH, CivicCast and TownLight were not shut down or reconfigured by this final cleanup.

## Automation: authorized, not yet activated

Scott authorized activation; I am not asking for that authority again. The accessible production browser lands on the existing editor sign-in form, and no other exposed browser has a production owner session. Owner sign-in is the one immediate operator action needed to use the existing production controls; I handle the configuration and testing afterward. No password extraction, owner impersonation or direct policy-table bypass was used.

Automatic routine publication has a separate source-fitness problem: the tested LPM calendar emits conflicting visible and structured times and ambiguous occurrence identity. Its preview yielded seven parsed, seventeen refused and six conflicts. Do not enable it by adding six hours or suppressing the conflicts. Ordinary discovery/review remains available. Other approved source/format mappings still need actual eligibility proof; approved family names alone do not create a trustworthy feed. See [the source finding](ROUTINE-SOURCE-FINDING.md).

Daily scans and routine publication are separate. Existing lifecycle/monitor infrastructure is not newly created by this work. No paid provider was added, approved sources expanded or production test content published.

## My test-isolation failure

An early Vite environment reload reached the copied staging database `townreporter_dev` and created fifteen fixture newsrooms. I backed it up, preserved the rows, corrected the environment boundary and proved the affected fixtures now use isolated PGLite. Production had none of those IDs. **Staging remains contaminated and must not be called a clean production clone.** [Incident and backup](TEST-ISOLATION-INCIDENT.md), [regression repair](TEST-ENV-RELOAD-REPAIR.md).

Later runtime tests used a new named acceptance database, not that staging copy. Its complete post-batch backup is `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter_acceptance_20260908_1805-final-1844.dump`, SHA-256 `FC6B84BC19300540F5298BB6B09D31C98709A4D4875948AC3D3593E496F0CF29`. The backup contains three generated drafts and the automatic onboarding About article; no generated draft was published. No historical unmarked drafts were migrated by the citation repair.

## Remaining work, in product-value order

1. Complete the exact-candidate release checks and an explicit pinned promotion before expecting these DEV repairs on the live site. Do not substitute a later main revision or describe local checks as GitHub CI.
2. Once the owner session is available, configure and verify the authorized daily scanning schedule through its existing controls, including pause/history. Routine publication additionally needs valid approved source/format mappings; leave ordinary reporting human-reviewed.
3. Finish the measured editorial-day target and contrasting-community coverage. Judge actual claims, useful output and intervention time; do not count all generated drafts as accepted items.
4. Address remaining evidence coverage/date-attribution failures from real receipts without turning another prompt change into a factual guarantee. The finite edit evidence slice can omit a captured conflicting notice; preserve this limitation.
5. Reconcile the contaminated staging clone from a protected production backup before another real-data promotion proof. Preserve the incident backup and unrelated development work.

## Records

Canonical repo: `C:\Users\scott\Desktop\Code\townreporter-dev`, branch `docs/halo-ownership-status-20260908`. Application work is preserved in eight scoped commits after `7cecb9d`: `f7a5481`, `ec2f78b`, `5706e72`, `bf5577a`, `ed11231`, `0bd7ed5`, `d658e28`, `8f2e1e6`; documentation consolidation follows separately. No push or new tag.

This directory contains chronological acceptance, source conflicts, UI/assignment tests, restart proof, original editorial failures and final citation tests. Raw logs are under the repo's ignored `artifacts/` directory with hashes recorded in reports. Copies belong in `C:\Users\scott\Desktop\Halo Stack Research`. The historical dirty `.claude/worktrees/ci-built` files and the content-identical generated route-tree status are not folded into the source commits.
