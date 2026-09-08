# TownReporter — current development handoff

Updated 2026-09-08. This supersedes operational assumptions and open-queue statements in older handoffs. Historical receipts remain evidence of what their authors observed at the time.

## Role and authority

**Engagement: finite program through feature-complete beta release.** The owner authorized takeover, documentation cleanup, implementation of the remaining queue, and merging/tagging/publishing finished green work on GitHub. The latest request is to finish deferred cleanup, then resume the remaining TownReporter features through completion and beta release. The broader completion mandate remains unfinished until that beta endpoint is reached.

The owner reaffirmed the full original scope and prefers delegated execution: Astra owns planning, acceptance and integration review, while bounded implementation and verification work should go to suitable Sol, Terra or Luna workers. This preference does not authorize a Codex usage reset; obtain explicit owner authorization before consuming one.

The developer and owner are remote, on the travel machine. The production computer is **Halo in Longmont**, a different machine. This session has repo access and can create local development/test environments; it has no access to Halo's production checkout, database or backups. Do not run staging, promotion or ops scripts here. Only a Halo-local operator, directed by the owner through the release-specific prompt, stages on real data and promotes. No remote session may substitute for that local handoff.

Deliverable language: **merged to main, CI green, ready for a local operator to promote**. GitHub publication is not production deployment. Attribute historical deployment claims to the operator who made them.

## Repository baseline and evidence

- Repository: https://github.com/scottconverse/TownReporter, branch `main`.
- Takeover baseline: `cd437a9`, package version **0.6.23**. Resolve current HEAD and CI again before every merge/release; this line records the takeover, not a moving release pointer. Published v0.6.30 is exact source `5e4e1d8cd9a73eb1d25393947ec434752ca56105`; CI `34191990951` passed 14/14, Windows CI `34191990919` passed 2/2, and published installation verification `34193266163` succeeded.
- The prior Halo session reported v0.6.23 at tag commit `b52a3ae` promoted, served version checked, 30 stories preserved and a backup taken. That is an **operator report**, preserved in [the 2026-09-04 session handoff](HANDOFF-SESSION-2026-09-04.md#2026-09-06--0623-live-dark-desk-doctrine-restored), not independently verified production state here.
- Older context: [0.5.7 handoff archive](HANDOFF-2026-09-02-ARCHIVE.md), [Dark Desk receipts](artifacts/dark-desk-review-2026-09-03/RECEIPTS-2026-09-04.md), [changelog](CHANGELOG.md).
- [TODO.md](TODO.md) is the only canonical queue. Do not revive outdated tasks from a dated handoff.
- Published v0.6.31 beta is immutable at exact source `58f5760704d45dce972814976ab07c6f7f76d6d8`; its accepted Windows package SHA-256 was `3171479a4cd7b5d9325518ad6a27d2550e559b87c17e48fcaebd764a03899c81`. Local acceptance covered one editor-reviewed local-model story and restart persistence, not the full operating target. PR37 evidence-display and release-label polish merged as `4f9c6cf` for 0.6.32; resolve the 0.6.32 GitHub release for exact-source validation and publication evidence.

## Locked product decisions

### Owner extension mandate — 2026-09-07

The owner explicitly asked the coordinator to manage completion of TownReporter as a single-editor community newspaper: own research, comparisons, planning, bounded delegation, implementation, verification, documentation and releases; continue unblocked work and bring only consequential choices back. Do not make the owner direct individual development steps. This is a bounded program ending at feature-complete beta release, not a claim that the project is finished today.

Confirmed operating targets:

- Hybrid **existing subscription-based cloud tools and local models**. The owner did not approve a new metered API budget. Preserve existing optional provider support, but do not enable paid API fallback or add paid services under this mandate. Local inference has no per-token charge; compute capacity and subscription limits still constrain throughput.
- Approximately **60 minutes of normal-day editor work**, with **3–5 useful items total** when evidence and newsworthiness warrant them. These are acceptance targets to measure, not output guarantees or a reason to manufacture filler. Investigations and interviews require separate time.
- Owner approved the recommended automatic-publication starting set on 2026-09-07: library notices, parks/recreation notices, verified community/arts events, routine registration deadlines, waste/recycling schedules and public-meeting logistics. The merged beta implementation adds these as paused-by-default, deterministic logistics-only editions after explicit source approval; other reporting requires editor review. Do not use model confidence as publication permission. The daily scheduler is not a continuous source watch; an approved source change can correct an automation-owned edition on a same-day rerun.
- Fable Direction A, Windows-first installation, newsroom isolation, correction history, and the remote/Halo boundary remain in force.

Daily scans merged in [PR17](https://github.com/scottconverse/TownReporter/pull/17), merge `eb2d110`. Candidate `6c28d8f` passed all 14 application jobs and both Windows checks (1,732 tests passed, zero failed, 47 explicit skips); both merge-commit workflows also passed. This files leads only. [Version 0.6.29](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.29) is published from exact source `af6e78e9862f82b3ba84b8c7b5520ba101da128c` and includes daily scans; GitHub publication is separate from Halo deployment.

Draft persistence merged in PR18 (`5dcbef1`), protecting claim/membership and atomic draft/lead/audit/job completion. Complete structured evidence merged in PR19 (`f6a28bf`). Their candidates passed all 14 application and both Windows jobs; PR19 recorded 1,739 tests passed, zero failed, 48 explicit skips. Both are included in published 0.6.29.

PR21 merged as `3e8ddb0` and is included in [0.6.29](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.29) at exact source `af6e78e9862f82b3ba84b8c7b5520ba101da128c`; its recorded-findings review pane is not exhaustive claim coverage or independent fact-checking. Exact candidate `33f9d9e` passed all 14 application and both Windows jobs (1,768 tests passed, zero failed, 48 explicit skips). It includes the corrected delayed-acknowledgement path, keeps reporting context/captures in the originating newsroom, restricts public evidence to the public edition, and rejects cross-room/cross-URL capture references. Root reproduced the old public leak in an anonymous disposable browser and independently falsified four guards; restored reporter/public checks passed 13/13. The combined built browser passed all 28 steps; anonymous public evidence remained readable for the same edition and refused foreign evidence and mixed-room comparisons. Build/typecheck passed, lint had zero errors and 12 baseline warnings, and tampercheck was clean. PR20 is merged as `5261f96`; its candidate passed all 14 application and both Windows jobs (1,742 passed, zero failed, 48 explicit skips).

Editor-selected draft batches merged in [PR23](https://github.com/scottconverse/TownReporter/pull/23) as `653e091`; the published 0.6.30 receipt records its exact checks. Community focus merged in [PR32](https://github.com/scottconverse/TownReporter/pull/32) as `f06b04e`; claim review in [PR33](https://github.com/scottconverse/TownReporter/pull/33) as `4129630`; private manual corroboration in [PR34](https://github.com/scottconverse/TownReporter/pull/34) as `0d074bb`; and routine editions in [PR35](https://github.com/scottconverse/TownReporter/pull/35), source `9326cdb`, merged as `68d1c5a` after 16/16 checks. No beta publication or performance proof is implied.

The published 0.6.30 manual routine-notice check remains a guarded, owner-triggered review path. PR35 source `9326cdb`, merged as `68d1c5a` after 16/16 checks, extends the checked pathways to all six approved structured families and adds separate paused-by-default automatic editions with deterministic logistics-only eligibility, evidence/authority fences, idempotent ordinary-article publication, correction/review handling and visible run history. Arbitrary website extraction and semantic verification remain unfinished.

Owner-authorized cleanup is complete: seven prototype scripts and 467 cumulative text/script artifacts, all 110 identified legacy PNGs (24,116,915 bytes), and the abandoned prerequisite-only directory (209,719,376 bytes) were removed after path/process checks. The successful beta installation, unique work and release evidence were preserved. Only empty screenshot directories remain because their removal was blocked before execution. Cleanup is separate from product and release claims.
- A local non-profit newspaper one person can run; coverage includes community life, business, schools, housing, health and arts as well as government. Ordinary reporting requires editor review and publication; the owner-approved low-risk routine exception is bounded as described above.
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

Legal removal and investigative settings are the next in-progress units. Legal inventory includes ambiguous historical editorial drafts and beat-memory/audit copies: no fuzzy auto-deletion or universal-erasure claim is permitted. Explicitly review shared references; owner-only retained payloads expire after12 calendar months, while destruction must never store removed text. External backup attestations cannot prove cleanup by themselves. Settings must snapshot once per round and show deferred signals in the denominator. Five isolated travel-machine investigations and a September 3–8 historical replay are owner-authorized but incomplete. They must not touch Halo data or services. Halo staging and promotion remain external operator work.

## 0.6.26 implementation checkpoint

Legal removal and investigative settings are implemented. Resolve the matching release tag and exact CI before treating this candidate as published; a version field alone is not release evidence. Sections and page watching were merged through PR #9, including a sensitive fix for shared source hashes truncating evidence for a different section. The overall 48,000-character scan budget remains unchanged.

Legal removal is a separate owner-only Published workflow, with impact preview, explicit historical selections, retention/destruction policy and a case destination. It retains an access-controlled database payload for twelve calendar months, not an encrypted archive. Expired text cannot be opened; the existing scheduler sweeps it before unrelated watch work. Explicit destruction never inserts a retained payload. Known structured search/capture copies cause refusal; foreign-room incoming references cannot be silently cascaded away. URL aliases, late writes and ordinary restoration are guarded. Matching watches pause and sources leave scanning, while evidence review remains explicit. External backup cleanup is only an operator attestation, never a remote erasure claim. See the [owner workflow](docs/editor.md#legal-removal-owner-workflow).

Investigative preferences live in How hard to dig. Defaults are 90 inclusive UTC calendar days and six signals; an explicit date range and a limit of 1–24 are supported. One immutable per-round snapshot controls discovery, synthesis, verification and failover. Full eligible/attempted/verified/unverified/failed/deferred counts prevent an attempted subset from masquerading as complete verification. Date operators are search hints, not factual-date or completeness guarantees. Preference read errors do not become defaults. Existing four-gate and publication rules remain intact.

Migration 0047 supplies removal metadata and guards; 0048 supplies investigative snapshots/counts. The source release requires the applicable full suite, typecheck/lint/build, independent review, built UI and real-Postgres checks on its exact candidate. Resolve [the 0.6.26 release](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.26) for the published SHA and final gate results rather than copying older counts. Historical design documents now carry explicit status notices; their superseded sections/retention proposals are not alternate instructions.

The local implementation queue is complete; source publication is established only by the release evidence above. The owner authorized five isolated travel-machine investigations and a September 3–8 historical replay, but neither is complete; record the final topics and results without forcing findings. Real-data staging/promotion and production historical-record cleanup remain Halo-local. Do not invent completed investigations or restart a redesign to fill that gap.
