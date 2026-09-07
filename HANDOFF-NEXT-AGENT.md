# TownReporter — current development handoff

Updated 2026-09-07. This supersedes operational assumptions and open-queue statements in older handoffs. Historical receipts remain evidence of what their authors observed at the time.

## Role and authority

**Engagement: continuous_development.** The owner authorized takeover, documentation cleanup, implementation of the remaining queue, and merging/tagging/publishing finished green work on GitHub on 2026-09-06. A green merge is a checkpoint; reconcile the queue and continue to the next authorized unit.

The developer and owner are remote, on the travel machine. The production computer is **Halo in Longmont**, a different machine. This session has repo access and can create local development/test environments; it has no access to Halo's production checkout, database or backups. Do not run staging, promotion or ops scripts here. Only a Halo-local operator, directed by the owner, stages on real data and promotes. That operator is currently unavailable.

Deliverable language: **merged to main, CI green, ready for a local operator to promote**. GitHub publication is not production deployment. Attribute historical deployment claims to the operator who made them.

## Repository baseline and evidence

- Repository: https://github.com/scottconverse/TownReporter, branch `main`.
- Takeover baseline: `cd437a9`, package version **0.6.23**. Resolve current HEAD and CI again before every merge/release; this line records the takeover, not a moving release pointer.
- The prior Halo session reported v0.6.23 at tag commit `b52a3ae` promoted, served version checked, 30 stories preserved and a backup taken. That is an **operator report**, preserved in [the 2026-09-04 session handoff](HANDOFF-SESSION-2026-09-04.md#2026-09-06--0623-live-dark-desk-doctrine-restored), not independently verified production state here.
- Older context: [0.5.7 handoff archive](HANDOFF-2026-09-02-ARCHIVE.md), [Dark Desk receipts](artifacts/dark-desk-review-2026-09-03/RECEIPTS-2026-09-04.md), [changelog](CHANGELOG.md).
- [TODO.md](TODO.md) is the only canonical queue. Do not revive outdated tasks from a dated handoff.

## Locked product decisions

- A local non-profit newspaper one person can run; coverage includes community life, business, schools, housing, health and arts as well as government. AI assists; an editor decides what prints.
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

The 0.6.24 corrective candidate closes reproduced failed-search verification,
missing evidence context, false saved-result counts, investigative newsroom leaks,
and PDF/OCR provenance defects. It also adds bounded HTTP responses and usable
search/refusal feedback. Exact candidate CI and publication receipts must be recorded
before calling this release ready. Historical records incorrectly assigned to
newsroom 1, or carrying invented OCR page references, are not automatically repaired:
an operator must review or re-ingest them. Entity-alias/match uniqueness still uses
older user-based keys; a same-user cross-newsroom collision is refused rather than
overwriting the other newsroom's metadata.

The ordered units are in [TODO.md](TODO.md): review/fix the restored engine, fetch caps, sections, manual watching, legal removal and investigative settings. Five live runs and real-data staging require Halo-local execution; their absence cannot be turned into a passing result. Local mocked checks may proceed independently.
