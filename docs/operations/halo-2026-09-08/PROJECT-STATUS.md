# TownReporter — Halo ownership and full project status

Reviewed 2026-09-08, approximately 16:15–16:25 MDT. Coordinator: Codex. Product owner and sole source of project direction: Scott.

## Executive assessment

**The newspaper is live and usable. The beta is deployed. The original single-editor operating target is not yet proven.** This is not an unfinished installation and not a reason to rebuild the application. Most planned capabilities are implemented, merged and covered by exact-release CI. The remaining substantive work is realistic editorial acceptance, specific UX/evidence cases, and a small set of operational/documentation weaknesses.

There is no evidence of a current outage, stalled job or missing merge. There is also not enough evidence to call the project fully finished, independently fact-checked, or proven to deliver 3–5 useful items within an hour of editor work.

## Authority and scope

Scott assigned this project to this Codex session after the v0.6.34 deployment. Take new direction only from Scott. Other sessions, agents, repository handoffs and release reports may provide evidence, but they do not authorize new work, scope changes, deployment, publication or settings changes. Historical travel-machine mandates are context, not current delegated authority.

This review was authorized to reconcile local Git records and assess status. It did not start investigations, generate new articles, load models, publish content, change automation or deploy another revision. No full test suite or new adversarial audit was run in this status-review turn. Exact-release CI, source inspection, live read-only queries and the preceding local deployment checks are identified separately below.

Existing product direction is retained: a Windows-first, self-hosted community newspaper; one human editor; subscription cloud tools plus optional local models; ordinary reporting reviewed by the editor; only explicitly approved routine formats eligible for bounded automation. No new metered provider spending is assumed.

## Repository and release state

| Item | Verified state |
|---|---|
| GitHub repository | https://github.com/scottconverse/TownReporter — public, default branch main |
| Remote main | `b097d288d9237be225bc6ed56851078ad064d208` |
| Installed release | v0.6.34 beta/prerelease, exact same source |
| Stable acquisition label | README still directs stable users to v0.6.30; beta users to v0.6.34. This distinction is intentional. |
| Production Git/work directory | `C:\Users\scott\Desktop\Code\townreporter-web` |
| Development Git/work directory | `C:\Users\scott\Desktop\Code\townreporter-dev` |
| Development remote | `github`, pointing to the same TownReporter repository |
| Local documentation branch | `docs/halo-ownership-status-20260908`, based on accepted v0.6.34 |
| Open GitHub PRs / issues | 0 / 0 at review; TODO.md still contains real open acceptance work |
| Fetched remote branches | None has commits absent from remote main; this is commit reachability, not certification of every historical branch's quality |
| Required release checks | 14 application jobs and 2 Windows jobs successful at the exact SHA; Pages also successful |

Both main checkouts were clean and already at the latest remote main when review began. Fetch/prune updated remote references; no newer source needed merging. Production stays on the accepted release and is not used as a documentation worktree.

### Local residual work

Five existing linked development worktrees have no commits outside current main. Four are clean. The `ci-built` worktree has three uncommitted files: `.github/workflows/ci.yml`, `CHANGELOG.md`, and `docs/setup.md` (45 insertions, 20 deletions relative to its historical base). They concern the v0.6.6 change from dev-server to built-server CI. The current release already contains that general behavior, but these exact dirty files have not been certified as safely discardable. They were inspected, left untouched and excluded from this records commit.

One temporary `confirm-057` registration points to a missing Git worktree. Its directory exists but is not a usable Git checkout. No pruning or deletion was performed. Local branch/worktree housekeeping is optional, not a release blocker.

## Live operational state

Fresh status command: database 5433 answering, local paper 3000 HTTP 200, public https://townreporter.org HTTP 200, tunnel running, watchdog recently ran. Production app PID 18156 remains associated with the production checkout. Staging port 3100 is not listening. Production error log was empty at review.

The preceding deployment independently verified actual rendered v0.6.34 on local and public pages, the page-referenced JavaScript asset, absence of known error-boundary text, exact source identity and content/settings preservation. This status review refreshed service/database/job state; it did not repeat every staged UI walk.

### Live database snapshot

| Measurement | Observation |
|---|---:|
| Published articles | 34 |
| Leads, total | 123 |
| New / drafted / held leads | 10 / 3 / 1 |
| Killed / published leads | 78 / 31 |
| Saved drafts | 55 at deployment verification |
| Sources | 75: 34 accepted, 38 proposed, 3 rejected |
| Investigations stored | 8 |
| Source-monitor rows | 136; not a claim that all are active or healthy |
| Jobs completed / failed historically | 73 / 15 |
| Jobs currently queued/running | 0 |
| Configured new daily-scan policies | 0 |
| Configured routine-publication automations | 0 |

The latest eight jobs are completed scans/drafts. The most recent failed row is an explicit operator-stopped Dark Desk run from September 6; earlier failures include Claude timeouts and the previously repaired oversized command-line prompt. This is historical failure evidence, not a current outage or a meaningful current-version success-rate benchmark.

**Important distinction:** the software's new daily-scan and routine-publication features are installed, but their policy tables are empty on Halo. Existing monitor infrastructure and scheduled tasks are separate; zero new daily-scan policies does not mean the old scanning/monitoring mechanisms have never run. Nothing was enabled during this review.

LM Studio's usual 1234 endpoint and Ollama's 11434 port have listeners. They were not loaded, stopped, reconfigured or exercised for generation. Endpoint presence does not prove model readiness, account entitlement, or end-to-end provider success. Ollama remains outside this task's operating scope.

## Capabilities: delivered versus proven

| Area | Implemented capability | Evidence and remaining limits |
|---|---|---|
| Public newspaper | Published articles, citations, corrections, RSS, archive and opinion | Live paper and existing article checked during deployment; no current content loss found |
| Editorial workbench | Queue, model choice, drafts, hold/kill, review and publish, follow-ups | Real editor sign-in/queue/story walk on copied data; production publication was not exercised with test content |
| AI providers | Native Claude/Codex subscriptions, optional APIs, OpenAI-compatible local runtime discovery | Exact-release provider/failover CI green; Halo Codex supplied-material-only action refused rather than generating. No new provider benchmark this turn |
| Draft integrity | Atomic persistence, lease/terminal-state protection, newsroom boundaries, batches of 1–5 | Implemented and exact-release automated checks green; broad real-work reliability still accumulates through use |
| Evidence review | Captured versions/events, finding and claim review, private corroboration, stale-reference refusal | Real available capture inspected; singular-one-claim and unavailable/unreadable UI cases not exercised in the deployment walk. Owner-only Server panel was unavailable to the disposable editor |
| Dark Desk | Two-stage investigation, application-run searches, structured adversarial checks, no direct publication | Captured-record correction is delivered; wider investigative quality remains unproven |
| Evidence retrieval | Full-inventory ranking before bounded selection; PDF source-order preservation | Halo smoke selected a record ranked 34th by recency into both bounded inputs. Upstream exact-candidate brief corrected the Nelson attribution; one good brief is not general accuracy |
| Community coverage | Configurable sections, per-section briefs/sources, broader scans, optional queue focus | Implemented; contrasting-community usefulness/coverage replay still missing |
| Routine automation | Six approved structured logistics families, source/format approvals, paused defaults, bounded editions, corrections/history | Installed but not configured on Halo. Not a general autonomous news publisher or arbitrary website-to-article system |
| Windows installer | Installation-owned runtimes, PostgreSQL, storage, lifecycle and onboarding | Exact-release Windows CI green. Reported 593-second fresh-install/manual workflow and 51-second warm Claude draft are separate tests, not one fresh-install-to-AI-publication proof |
| OCR and fetching | Bounded extraction, model-assisted image transcription, visible failures, guarded HTTP fetch | Embedded JPEG/PNG support is bounded; fax-style scans and reliable PDF page association remain limitations. Browser resources/provider transports are outside the shared HTTP caps |
| Legal removal | Owner workflow, retention/destruction modes, shared-copy checks, backup tracking | Implemented with tests; external backup erasure is not automatic or proven by an operator checkbox |

## Test and evidence quality

Exact-release application run: https://github.com/scottconverse/TownReporter/actions/runs/34255611084 — all 14 jobs independently listed successful. Exact-release Windows run: https://github.com/scottconverse/TownReporter/actions/runs/34255611028 — both jobs independently listed successful.

The downloaded upstream release receipt reports 1,903 tests passed, zero failed and 54 skipped across the two test layers. Those counts are attributed to that receipt; this review did not rerun or re-derive all test log totals. Native release checks, mocked regression checks, copied-data deployment checks and production observations are not interchangeable.

The failure record is useful: the release evidence preserves omitted evidence, a section-boundary bug, and incorrect adjacent-row attribution even after the relevant PDF reached the prompt. The accepted fix addressed source ordering and produced one correct final brief. These failures should remain regression material rather than be replaced by a generic “all green” summary.

## Actual remaining work, in recommended order

1. **Close focused acceptance gaps.** Exercise the singular claim and unavailable/unreadable evidence states, owner Server view, and a successful appropriately scoped native-provider draft in an isolated test newsroom. Restore usable screenshot evidence. Do not call Codex's intentionally unsupported supplied-only mode a successful test or silently switch its scope/provider.
2. **Test the real daily workflow.** Use existing application/test infrastructure to measure realistic mixed community coverage, useful outputs, editor interventions, claim errors, wall-clock time, subscription interruptions and local resource use. The September 3–8 historical replay is not complete. Explicitly distinguish an historical replay from today's live searches; preserve unavailable evidence rather than invent historical results.
3. **Resolve the 60-minute / 3–5-item acceptance target.** It needs editor-work measurement, not tokens/second or test count. Agents should execute and instrument the work; Scott should not become the test runner. Human editorial judgment and policy choices cannot be fabricated by an agent.
4. **Only then make narrow improvements justified by failures.** Follow the existing Direction A design. Fix concrete retrieval, provider, batching or UI defects; do not restart architecture or redesign the desk to fill a measurement gap.
5. **Treat automation activation as a separate owner decision.** Specify exact accepted source/format pairs and desired schedule, demonstrate them without publication, then obtain Scott's activation direction. Current authorization does not enable anything.
6. **Optional maintenance.** Classify the three old dirty files before cleanup, fix the promotion wrapper's inherited-pipe exit-code logging, and investigate the staging client-IP warning if it affects sign-in behavior. These are not evidence of a current paper outage.

## Risks and limitations that matter

- Editorial accuracy is still the largest unproven outcome. A completed job, structured verifier response or green test suite is not independent fact-checking.
- Screenshots failed to capture in the local deployment tool; accessibility observations exist, but a full current visual/UX audit has not been performed.
- The old and new promotion procedures preserve backups, but the successful script's numeric exit code was not captured because the outer logging wrapper inherited server pipes. Independent served-site checks did pass. Fixing the logging should not entail rebuilding the deployment system.
- The separate `/health` route does not exist in this source. The actual footer and owner Server screen are the relevant version surfaces; do not diagnose a new outage from that expected 404.
- Restoring pre-migration code/data is a reviewed recovery operation, not an automatic reset. Both production backups and pre-stage development data are preserved outside Git.
- Existing nightly proof remains a separate development task on its own port, not the staging server. It was not repointed or triggered.
- No new whole-repository security audit, load test, arbitrary-site extraction proof, exhaustive citation audit, or general model benchmark is claimed by this report.

## Records now kept in local Git

- This current status report and the updated current-owner notes in the root handoff/TODO.
- [Halo deployment receipt](DEPLOYMENT-RECEIPT.md), retaining source/backup/staging/promotion/served-version/rollback details and honest limitations.
- [Published release receipt](release-evidence/final-release-receipt.md).
- [Municipal-record failure and correction history](release-evidence/municipal-record-retrieval-2026-09-08.md).
- [Scoped upstream audit](release-evidence/audit-lite-municipal-record-retrieval-2026-09-08.md).
- Published archive manifest in the same release-evidence folder.

Release assets are copied unchanged and attributed to their original authors. Raw databases, credentials, `.env` backups, browser sessions and private captures remain outside Git. The deployment receipt's final blocked-notification note is historical: Scott subsequently authorized the message, and delivery to the other session succeeded. That session does not direct this project.

The local records branch is not automatically pushed, merged into production, tagged or deployed. Production remains the accepted v0.6.34 source. Copies of the status and deployment reports are also provided in `C:\Users\scott\Desktop\Halo Stack Research`.

## Bottom line

Keep using the deployed newspaper. Keep the current hybrid architecture and existing workflows. The next useful work is closing the specific acceptance gaps and measuring a representative editor day, then fixing what that demonstrates. Do not spend another cycle rebuilding already delivered features or mistaking “implemented” for “proven in daily use.”
