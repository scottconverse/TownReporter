# TownReporter delivery board — 2026-09-10

> Historical snapshot, not the current deployment or task inventory. Rechecked
> September 11: production checkout is fe53b6e (0.6.35 plus the Utility Bill
> Analyzer link), not the 0.6.34 checkout described below. Active development is
> feat/utility-bill-analyzer-link, PR43. Preserve the dated claims below as history;
> do not reopen completed work from this table. Current notice progress is in
> REGISTRATION-PDF-ACCEPTANCE.md and NOTICE-SOURCE-MAPPING-2026-09-10.md. The
> owner's authoritative 16-item scope remains the active goal attachment.

**Scope:** all 16 authorized areas remain in scope. This is an actionable
development board, not a completion claim. **PHASE:** `OPENAI_ONLY` ·
**MODE:** `OPEN_MULTI_AGENT` · **DELEGATION:** `VERIFIED`.

**Source of truth:** DEV branch `docs/halo-ownership-status-20260908`, current
implementation HEAD `7bc419f`, and [DELIVERY-CHECKS-2026-09-10.md](./DELIVERY-CHECKS-2026-09-10.md).
“Proven” below means a recorded development check, not production acceptance.
Production remains checkout `v0.6.34` at `b097d28`, and the running site has not
been refreshed.

| # | Area | DEV / proven / deployed state | Acceptance reference | Next concrete action |
|---:|---|---|---|---|
| 1 | Lead-to-published-story workflow | DEV workflow checks pass for manual copy; generated-story quality and full ordinary flow are not proven; not deployed. | Pinned built publishing workflow | Run the ordinary editor flow on the exact candidate, including edit, evidence review, publish, reader, and correction. |
| 2 | Trustworthy reporting | Source/publication boundary checks pass; factual quality remains unproven; not deployed. | Existing extraction/publication repairs | Review representative generated stories against captured sources and record corrections/uncertainty. |
| 3 | Repeat-lead handling | DEV commit `d947d1a`; focused checks pass; production queue has not been reclassified. | Queue delivery | Deploy the scoped repair, then reconcile existing duplicates recoverably. |
| 4 | Completed editor release | Several slices are pushed, but the tree/candidate is not yet clean or release-verified; production unchanged. | “What that means for push, merge, and tag” | Root stages dependency-complete commits, runs candidate checks, then verifies remote checks and release safeguards. |
| 5 | Daily scanning | Scheduler work exists in DEV; production schedule and restart behavior are not proven. | Daily scan activation | Configure the authorized production schedule and verify one persisted scheduled result and actionable failure. |
| 6 | Discovery breadth | Search fallback/Gateway fixtures pass; live provider interoperability and varied coverage are unproven. | Existing search integration consolidated | Run a bounded real-provider coverage check across configured sections and one contrasting community. |
| 7 | Automatic notices | Sources/categories are not fully activated or production-verified. | Authorized list item 7 | Finish the six approved source categories, resolve conflicts, and activate authorized automatic routine notices; ordinary reporting remains editor-reviewed. |
| 8 | Useful Dark Desk | Repaired source path is proven, but the fresh investigation failed before acceptance; not deployed. | One fresh Dark run — failed; Focused repair | Run one meaningful fresh investigation on the repaired candidate and inspect evidence, uncertainty, and filing. |
| 9 | Direct investigative tools | Decision remains open; no direct-tool acceptance claim. | Complete the direct investigative-tools requirement | Evaluate the affected investigation and either add curated tools or record evidence that they are unnecessary. |
| 10 | Deep PDF/scanned reporting | Page-reader controls and persistence checks pass in DEV; real transcription and provider support remain unproven. | Retained PDF page reader | Complete one real scanned-document read, including pages beyond 12, order, citations, and incomplete-reading messaging. |
| 11 | Deployed Stats/reports | DEV commit `0f19820`; 13/13 and 8/8 checks pass; production unchanged. | Stats consolidation | After release, verify anonymous views and daily/weekly/monthly report retrieval on the installed site. |
| 12 | Deployed custom AI connections | DEV commit `acf66da`; fake-endpoint UI and 46 focused checks pass; real provider and production use unproven. | Custom API delivery | Ship the guide with the candidate, then verify setup, discovery/manual model, test, edit/disable/delete, and explicit use in production. |
| 13 | Source/monitor/data obligations | Newsroom-scoped migration and isolated checks pass in DEV; migration not applied to production. | Previously approved source ownership repair | Apply and verify the migration in clean staging, preserving rows/approvals, before production promotion. |
| 14 | Existing editor product | Component/source checks cover selected capabilities; no complete preservation check against the candidate yet. | Preserve the full existing editor product | Run one concise functional pass covering sections, Opinion, model/fallback, claim review, corrections/trash/restore, links, and distribution. |
| 15 | Daily operating target | No credible 3–5 useful-item / roughly 60-minute evidence yet; not deployed. | Demonstrate the daily operating target | On a representative day, measure editor effort separately from model runtime and count only useful, supportable items. |
| 16 | Instructions and handoff | DEV guides and status records are being updated; installed controls and final release disposition are not yet complete. | Finish the editor instructions and handoff | Root folds the scoped guides into the final README/manual/release handoff and labels every capability accurately. |

## Coordination and verification ledger

- Root owns integration, serialization, candidate tests, evidence, and release
  decisions. Luna owns bounded documentation and read-only dependency review;
  those submissions are not production acceptance. Terra is currently idle.
- Job-lane module-identity check: parent-executed, **1 pass / 1 suite / 0
  fail / 0 skip**, `11063.2734 ms`; no production changes.
- Existing jobs regression: parent-executed, 37 passed / 8 suites / no failures
  or skips, 11358.1842 ms. Scoped implementation committed as `7bc419f`.
- Luna's original 40-line board submission required one substantive correction:
  automatic routine notices must not be narrowed to editor-reviewed notices.
  Lead corrected that row; this is acceptance after correction, not first-pass
  acceptance. Worker usage and measured elapsed time are unknown.
- The board intentionally preserves development-only, proven-but-not-deployed,
  and unproven distinctions. It does not mark the product complete.
