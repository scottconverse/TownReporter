# TownReporter — current development handoff

Updated 2026-09-07. This supersedes operational assumptions and open-queue statements in older handoffs. Historical receipts remain evidence of what their authors observed at the time.

## Role and authority

**Engagement: continuous_development.** The owner authorized takeover, documentation cleanup, implementation of the remaining queue, and merging/tagging/publishing finished green work on GitHub on 2026-09-06. A green merge is a checkpoint; reconcile the queue and continue to the next authorized unit.

The owner reaffirmed the full original scope and prefers delegated execution: Astra owns planning, acceptance and integration review, while bounded implementation and verification work should go to suitable Sol, Terra or Luna workers. This preference does not authorize a Codex usage reset; obtain explicit owner authorization before consuming one.

The developer and owner are remote, on the travel machine. The production computer is **Halo in Longmont**, a different machine. This session has repo access and can create local development/test environments; it has no access to Halo's production checkout, database or backups. Do not run staging, promotion or ops scripts here. Only a Halo-local operator, directed by the owner, stages on real data and promotes. That operator is currently unavailable.

Deliverable language: **merged to main, CI green, ready for a local operator to promote**. GitHub publication is not production deployment. Attribute historical deployment claims to the operator who made them.

## Repository baseline and evidence

- Repository: https://github.com/scottconverse/TownReporter, branch `main`.
- Takeover baseline: `cd437a9`, package version **0.6.23**. Resolve current HEAD and CI again before every merge/release; this line records the takeover, not a moving release pointer.
- The prior Halo session reported v0.6.23 at tag commit `b52a3ae` promoted, served version checked, 30 stories preserved and a backup taken. That is an **operator report**, preserved in [the 2026-09-04 session handoff](HANDOFF-SESSION-2026-09-04.md#2026-09-06--0623-live-dark-desk-doctrine-restored), not independently verified production state here.
- Older context: [0.5.7 handoff archive](HANDOFF-2026-09-02-ARCHIVE.md), [Dark Desk receipts](artifacts/dark-desk-review-2026-09-03/RECEIPTS-2026-09-04.md), [changelog](CHANGELOG.md).
- [TODO.md](TODO.md) is the only canonical queue. Do not revive outdated tasks from a dated handoff.

## Locked product decisions

### Owner extension mandate — 2026-09-07

The owner explicitly asked the coordinator to manage completion of TownReporter as a single-editor community newspaper: own research, comparisons, planning, bounded delegation, implementation, verification, documentation and releases; continue unblocked work and bring only consequential choices back. Do not make the owner direct individual development steps. This remains continuous development, not a claim that the project is finished.

Confirmed operating targets:

- Hybrid **existing subscription-based cloud tools and local models**. The owner did not approve a new metered API budget. Preserve existing optional provider support, but do not enable paid API fallback or add paid services under this mandate. Local inference has no per-token charge; compute capacity and subscription limits still constrain throughput.
- Approximately **60 minutes of normal-day editor work**, with **3–5 useful items total** when evidence and newsworthiness warrant them. These are acceptance targets to measure, not output guarantees or a reason to manufacture filler. Investigations and interviews require separate time.
- Owner approved the recommended automatic-publication starting set on 2026-09-07: library notices, parks/recreation notices, verified community/arts events, routine registration deadlines, waste/recycling schedules and public-meeting logistics. These may feed Today in town, This weekend and Deadlines approaching. Each newspaper explicitly approves its sources for the eligible formats. Other reporting requires editor review. Existing released code still requires human publication; do not imply the future exception has shipped or use model confidence alone as publication permission.
- Fable Direction A, Windows-first installation, newsroom isolation, correction history, and the remote/Halo boundary remain in force.

Daily scans merged in [PR17](https://github.com/scottconverse/TownReporter/pull/17), merge `eb2d110`. Candidate `6c28d8f` passed all 14 application jobs and both Windows checks (1,732 tests passed, zero failed, 47 explicit skips); both merge-commit workflows also passed. This files leads only. Version 0.6.28 is already published and excludes daily scans; it contains correction ownership and the strict Reddit elapsed-time fix. GitHub publication is separate from Halo deployment.

Draft persistence merged in PR18 (`5dcbef1`), protecting claim/membership and atomic draft/lead/audit/job completion. Complete structured evidence merged in PR19 (`f6a28bf`). Their candidates passed all 14 application and both Windows jobs; PR19 recorded 1,739 tests passed, zero failed, 48 explicit skips. Neither is in published 0.6.28.

PR21 merged as `3e8ddb0`; its recorded-findings review pane is not exhaustive claim coverage or independent fact-checking. Exact candidate `33f9d9e` passed all 14 application and both Windows jobs (1,768 tests passed, zero failed, 48 explicit skips). It includes the corrected delayed-acknowledgement path, keeps reporting context/captures in the originating newsroom, restricts public evidence to the public edition, and rejects cross-room/cross-URL capture references. Root reproduced the old public leak in an anonymous disposable browser and independently falsified four guards; restored reporter/public checks passed 13/13. The combined built browser passed all 28 steps; anonymous public evidence remained readable for the same edition and refused foreign evidence and mixed-room comparisons. Build/typecheck passed, lint had zero errors and 12 baseline warnings, and tampercheck was clean. PR20 is merged as `5261f96`; its candidate passed all 14 application and both Windows jobs (1,742 passed, zero failed, 48 explicit skips). Editor-selected draft batches remain separate from 0.6.29: local focused, PostgreSQL mutation and full offline browser proof passed; exact-candidate CI is pending. Automatic publication, broader claim coverage/corroboration and measured daily operating targets remain unfinished. Preserve failed-run evidence and do not describe an earlier green candidate as proof of later corrections.

- A local non-profit newspaper one person can run; coverage includes community life, business, schools, housing, health and arts as well as government. Released behavior requires editor publication; the owner-approved future exception for selected low-risk formats is described above and is not implemented yet.
- **Fable Direction A** is the design foundation: queue main column, Dark Desk/Follow-ups/wire rail, newsroom vocabulary, scores, Open/Hold/Kill and matched-story context. Rust on cream; black background and white text on Dark Desk. No teal sidebar redesign or marketing banner on the editor's first screen.
- Nothing informational below 14px; Large scales headlines and reading panes; no meaning conveyed by quiet color alone; destructive actions must differ from Cancel. Every action needs pending/success/empty/error feedback and a path to its result.
- The editor selects a model wherever AI acts. Readiness, interrupted work and failover must be described honestly.
- Configurable sections are editor-owned, not blocked on a fixed list from the owner.
- Legal removal policy: sealed owner-only copy, automatic expiry after 12 months; explicit court-ordered destruction means keep nothing. Audit/backups must follow that exception. This feature is not built at the takeover baseline.

## Dark Desk: code contract, not folklore

Stage 1, Black Desk, files speculative signals with confidence clamped in code to **0.1–0.5**. Postures are **Dog That Didn't Bark**, **Whisper**, and **Fiscal Fray**; not “standard/paranoid/confirmation-seeking.”

Stage 2 runs application-owned adversarial searches. Persisted gate fields are **disproof_attempted**, **source_independence**, **missing_context**, and **self_referential**. The prompt numbers contestation, disproof, independence/context and self-reference; contestation is framing, not a separate stored answer. Newsworthiness and the story claims-of-absence publication guard are separate checks, not replacements for those fields.

At the takeover baseline, at most the six strongest newly filed signals receive Stage 2 per round; 90 days is a search preference. Missing gate answers/self-reference prevent the verified label. The queue offers an explicit unverified-tip path; it must preserve uncertainty. Nothing publishes from Dark Desk.

Read [the full Dark Desk guide and live acceptance exercise](docs/dark-desk.md), then trace `dark-gates.ts`, `dark-verify.ts`, `dark.ts`, `dark-prompt.ts`, `investigate.ts` under `src/lib/news/`. Review failed-search handling, actual evidence in the verification pack and newsroom-scoped writes before relying on the verified label. Structured completeness is not factual truth.

## How to work safely here

Delegate feature implementation; the coordinator briefs, reviews diffs and verifies. Keep one heavy local verification process at a time. Use bounded scopes so workers do not edit the same files.

Run local tests and builds with `DATABASE_URL=""` (PGLite); check the resolved database line. Never touch ports 3000/5432/5433 or production `.output`. Use spare local ports and mock model/search/fetch services for regression tests. No real Reddit calls in tests. Keep credentials, production dumps and private voice files out of the repo.

Preserve line endings (autocrlf is used). Use `npm run typecheck`, not a downloaded `npx tsc`. Avoid `npm version` lockfile damage: compare dependency changes and run the repo's version checks. Stop only a verified process PID you own, never by image name.

## Verification and release

For each unit: acceptance criteria → sensitive failing regression where applicable → implementation → relevant tests → focused review and editor-facing browser check. Broaden gates for named risks such as deletion, privacy, migrations or concurrency. Run the applicable full test/lint/typecheck/build gates before releasing. Real-Postgres CI is separate from local PGLite proof; inspect its result on the exact candidate.

Update current README/manual/editor/setup/landing/version/changelog together when releasing. Do not rewrite historical deployment receipts to the new version. Inspect all pushed branches and open PRs; merge only reviewed finished work with passing exact-commit checks. Publish the matching tag and release notes with the production boundary explicit. Do not delete branches with unique or uncommitted work merely to make the repository look clean.

## Next work and external dependency

### Active owner request: Windows installation, 2026-09-07

Fix the findings from the travel-machine runtime exercise and deliver a Windows-first installation package that a new user can run in under an hour. Mac/Linux source setup remains supported; native installers for those platforms are outside this release. Track acceptance in TODO.md. The active work covers instance-owned maintenance, private persistent PostgreSQL and prerequisites, build identity/readiness, supplied-material drafting and evidence review, and the manual-watch slash-redirect false alarm. Do not revive the historical implementation queue below as unfinished work.

The 0.6.27 Windows-installation change addresses this request. Local runtime checks have exercised a real Claude supplied-material draft, body/evidence review and publication, manual page captures, owner sign-in, and installation-owned restart. Newcomer testing also found and corrected fixed Longmont instructions, an unchanged/changed card collision and misleading maintenance copy. Resolve the matching release for final exact-source CI, package checksum and timed Windows evidence; these local checks alone do not certify a fresh-machine installation time. Fresh Windows CI exercises installation and a manual editorial workflow with AI disabled. Separate local packaged testing verified a real Claude supplied-material draft in 51 seconds using an already available provider. These are distinct checks; they do not establish fresh-machine AI setup or real source-scan coverage.

The owner authorized a persistent, isolated PostgreSQL testing newsroom on this machine. Ordinary tests and builds still use empty DATABASE_URL. The already-running local copy is separate from the implementation worktree; never build over a served .output. Fresh-package Windows CI and a timed local exercise must record their environment and provider assumptions. A warm development-machine pass is not proof of an arbitrary new user's installation time.

The 0.6.24 corrective implementation closes reproduced failed-search verification,
missing evidence context, false saved-result counts, investigative newsroom leaks,
and PDF/OCR provenance defects. It also adds bounded HTTP responses and usable
search/refusal feedback. [PR #7](https://github.com/scottconverse/TownReporter/pull/7)
records exact candidate checks; use the matching GitHub release for publication
identity. Historical records incorrectly assigned to
newsroom 1, or carrying invented OCR page references, are not automatically repaired:
an operator must review or re-ingest them. Migration 0044 adds the newsroom to
entity-alias/match uniqueness so the same editor can retain identical names in
different newsrooms without overwriting or silently dropping the other record.
It preserves existing rows and does not infer historical ownership.

The ordered units are in [TODO.md](TODO.md): review/fix the restored engine, fetch caps, sections, manual watching, legal removal and investigative settings. Five live runs and real-data staging require Halo-local execution; their absence cannot be turned into a passing result. Local mocked checks may proceed independently.

## 0.6.25 implementation checkpoint (historical)

Sections and manual investigative watches are implemented together; resolve the release tag and exact CI before calling the candidate published. Migration0045 preserves permanent section keys and story URLs while explicit retirement maps late filing through replacement aliases. Scan runs store immutable section guidance/source snapshots. Migration0046 extends existing monitors/captures with daily manual watches, history, lease fencing and idempotent file/lead actions. Readiness checks fail closed when required objects are missing.

Current Command Center and Dark Desk screenshots use disposable local fixtures. Older public-paper and other tour screenshots remain attributed historical examples. The first-owner concurrency defect found during0.6.24 verification was corrected in PR#8; no timeout or assertion was weakened.

Legal removal and investigative settings are the next in-progress units. Legal inventory includes ambiguous historical editorial drafts and beat-memory/audit copies: no fuzzy auto-deletion or universal-erasure claim is permitted. Explicitly review shared references; owner-only retained payloads expire after12 calendar months, while destruction must never store removed text. External backup attestations cannot prove cleanup by themselves. Settings must snapshot once per round and show deferred signals in the denominator. Five Halo investigations and promotion remain external.

## 0.6.26 implementation checkpoint

Legal removal and investigative settings are implemented. Resolve the matching release tag and exact CI before treating this candidate as published; a version field alone is not release evidence. Sections and page watching were merged through PR #9, including a sensitive fix for shared source hashes truncating evidence for a different section. The overall 48,000-character scan budget remains unchanged.

Legal removal is a separate owner-only Published workflow, with impact preview, explicit historical selections, retention/destruction policy and a case destination. It retains an access-controlled database payload for twelve calendar months, not an encrypted archive. Expired text cannot be opened; the existing scheduler sweeps it before unrelated watch work. Explicit destruction never inserts a retained payload. Known structured search/capture copies cause refusal; foreign-room incoming references cannot be silently cascaded away. URL aliases, late writes and ordinary restoration are guarded. Matching watches pause and sources leave scanning, while evidence review remains explicit. External backup cleanup is only an operator attestation, never a remote erasure claim. See the [owner workflow](docs/editor.md#legal-removal-owner-workflow).

Investigative preferences live in How hard to dig. Defaults are 90 inclusive UTC calendar days and six signals; an explicit date range and a limit of 1–24 are supported. One immutable per-round snapshot controls discovery, synthesis, verification and failover. Full eligible/attempted/verified/unverified/failed/deferred counts prevent an attempted subset from masquerading as complete verification. Date operators are search hints, not factual-date or completeness guarantees. Preference read errors do not become defaults. Existing four-gate and publication rules remain intact.

Migration 0047 supplies removal metadata and guards; 0048 supplies investigative snapshots/counts. The source release requires the applicable full suite, typecheck/lint/build, independent review, built UI and real-Postgres checks on its exact candidate. Resolve [the 0.6.26 release](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.26) for the published SHA and final gate results rather than copying older counts. Historical design documents now carry explicit status notices; their superseded sections/retention proposals are not alternate instructions.

The local implementation queue is complete; source publication is established only by the release evidence above. Five real investigations (including three still-to-be-selected topics), real-data staging/promotion, historical-record cleanup and further owner design feedback remain external. Do not invent completed investigations or restart a redesign to fill that gap.
