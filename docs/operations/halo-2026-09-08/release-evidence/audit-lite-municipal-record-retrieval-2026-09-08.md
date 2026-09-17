# Audit Lite — Dark Desk captured-record selection

Date: 2026-09-08
Candidate: f48047b87dca796fdc2c6ebb426b47cc6cd5d434
Scope: synthesis and brief evidence selection, related regressions, affected documentation.
Reviewer: root; Terra implementation; Sol runtime verification.
Lane: Standard.

## Verdict

PASS for the scoped source correction and local application acceptance. Release identity and CI are recorded separately in the final release receipt. No unresolved blocker, critical or major finding remains in this focused review.

## Confirmed defect and corrections

The original investigation captured the official City PDF as artifact149/version40. Its 52,747-character text contains Connection Church Annexation Referral, DV-ANNREF-26-00001, at 8979 Nelson Road. Newest-12 selection omitted the record from synthesis; a first-1,600-character excerpt would also miss the entry. The final brief previously received document titles and URLs without captured passages. Search itself had returned the correct PDF.

The corrected selector ranks the full eligible inventory in SQL, deduplicates captured versions before the eight-record limit, and transfers full bodies only for selected records. Empty-focus requests retain readable evidence. Capture/version/hash and genuine page locators remain attached. Existing 28,000-character synthesis and 22,000-character brief input limits remain unchanged.

Runtime review caught a second material defect before merge: reordered and overlapping PDF fragments caused Founders Block, LLC from the preceding Coffman row to be attributed to Connection Church. Adding the applicant continuation and a prompt instruction alone did not fix the generated answer. The final formatter preserves complete relevant stored PDF pages in source order when they fit, otherwise a contiguous matching neighborhood, and suppresses duplicate generated fragments when persisted context is available.

## Evidence

- Regression failures were observed for older/deep evidence omission, empty-focus loss, and missing row-heading/duplicate-fragment context. The final focused suite passed 14/14.
- Typecheck, scoped lint, diff check and tampercheck passed. No assertion was weakened to obtain a pass; the previous neighboring-name exclusion was replaced with source-heading/order and single-copy assertions.
- Actual preserved-data packs: synthesis 23,077/28,000 characters; brief 20,303/22,000. Both contain the complete relevant page context once, including the correct applicant tail and original capture provenance.
- Exact-candidate local build passed. One final Terra/no-fallback rewrite, job17, completed in 19.157 seconds. Root independently inspected the populated Read-this-first screenshot. The brief names Doug / Connection Church Longmont, retains project ID/address/approximately one acre/MU-E/unchanged religious use, and explicitly leaves service and tax effects unestablished. Founders Block and Mark Sullivan are absent.
- The earlier job16 failure and a mistaken automated empty-state interpretation remain corrected and attributed in the municipal-record receipt. Job16 generated a brief; its failure was incorrect attribution, not an empty result.
- Owned local app and PostgreSQL processes stopped; ports4393/15436 were free. Persistent evidence remains. No handoff, publication or Halo operation occurred.

## Minors and limits

Bounded selection does not establish exhaustive coverage or universal model accuracy. Large-investigation SQL performance has not received a separate benchmark; full-body transfer is bounded and no new benchmark machinery was added. The underlying annexation application and project-specific fiscal/service terms remain outstanding reporting evidence. Other investigations and the historical daily replay were not rerun for this fix.

No broader audit is recommended for this scoped correction.
