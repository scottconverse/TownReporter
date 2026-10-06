# Daily scan and meeting coverage

Use this workflow for `daily-scan` and as the intake stage for `full-pipeline`. The source town, date window, civic beats, and registry must be explicit. Longmont uses `longmont-sources.md`; a different town needs its own registry or a clearly marked provisional source list. The scan covers developments affecting people in the town, regardless of whether the originating institution is city, county, regional, state, or nongovernment.

## 1. Inventory sources before ranking leads

Open each relevant registry entry separately. Cover the applicable beats: government and elections; schools and youth; housing and land use; business and jobs; public safety and health; transportation and utilities; environment; arts and culture; and neighborhood or nonprofit activity. Include council packets, minutes, recordings, boards and commissions, school districts, county and special districts, original documents from involved organizations, local reporting, and community signals. Check new and recently changed material within the date window. Note exact titles, dates, URLs, and access failures. For a subreddit in the registry, follow `reddit-intake.md`: inspect recent posts and targeted searches, keep direct links and dates for promising Tier C signals, and record thread-access gaps. Follow Tier B coverage and Tier C signals to original evidence before presenting a claim as verified.

Keep a **beat/source inventory** with each source's tier, beat, check date, access status, and whether it produced a lead. A registry with only government portals does not support a claim that the whole civic landscape was scanned. Mark uncovered beats and registry gaps explicitly; use `discover` to expand the registry instead of inventing coverage.

If a needed document is not already accessible, record the gap and continue with other published or firsthand evidence. Do not propose or make a formal records request or pay for retrieval.

For each relevant public meeting, create a **meeting record** with body, meeting date, agenda URL, minutes URL or status, recording URL or status, transcript URL or status, and a `coverage_status` of `complete`, `partial`, or `unavailable`. If the recording exists but the transcript cannot be retrieved, review the recording by time ranges if the host permits; otherwise mark the meeting partial and give the unreviewed range. This meeting ledger is one part of the citywide scan, not its entire scope.

## 2. Review the full meeting chronologically

Read the entire accessible transcript in ordered chunks; if token limits prevent one pass, split it into consecutive time or line ranges and track every range. Do not jump only to agenda headings, keyword hits, or likely story items. Search cues such as *move*, *second*, *all in favor*, *that carries*, *without objection*, *passes*, *fails*, *future agenda*, *direction to staff*, and *consent* to aid discovery, then read the surrounding discussion and remaining chunks. The optional `scripts/transcript-ledger.mjs` makes a chunk and cue scaffold; it does not certify coverage or replace semantic review.

For **every substantive motion and vote**, make an action row, even if it was not on the posted agenda, was procedural, received a low newsworthiness score, or only schedules future discussion. Include consent agenda actions and amendments where they alter substance. Routine approval of minutes, adjournment, and other purely administrative acts can be grouped as `routine`, but still account for them in the ledger.

Required action fields:

| Field | Meaning |
| --- | --- |
| `action_id` | Stable local identifier for this meeting and action |
| `timestamp` | Recording time or transcript line range; `unknown` only if explicitly unresolved |
| `agenda_item` | Posted item or `not on posted agenda` |
| `motion_or_action` | What was actually moved, directed, voted, or decided |
| `outcome` | Passed, failed, withdrawn, tabled, discussion only, or unresolved |
| `vote` | Verified tally or `unverified`; identify roll call if available |
| `policy_stage` | Scheduled, proposed, discussion directed, first reading, final adoption, etc. |
| `evidence` | Official URL plus page/section/time |
| `disposition` | Lead, watch, routine, duplicate, or unresolved, with reason |

Example: A 4–3 motion to place marijuana hospitality rules on a later agenda is an action row with `policy_stage: future discussion directed`; it is **not** a vote adopting hospitality rules. A dispensary annexation decision is a separate action. Neither may be silently merged into the other.

Record a **chunk ledger** for each transcript or recording range: start/end, whether the full range was reviewed, cue IDs, actions found, and any gap. A range is `reviewed` only after all its content, not merely a search snippet, was inspected. If the transcript has no timestamps, use line ranges and say so. If another assistant or human supplies a summary, label its provenance; do not mark the original range reviewed by you.

## 3. Reconcile sources and search for omissions

Compare each agenda item with the action ledger: scheduled with no action, changed, deferred, withdrawn, and added during the meeting. Compare minutes and subsequent city postings to the ledger. Search local reporting for mentioned votes or motions and trace each candidate back to Tier A. Run a second targeted pass over all `motion`, `vote`, `future agenda`, `direction`, and roll-call cues. Resolve each candidate as a distinct action, a duplicate, routine, or an explicit unresolved item. Treat missing or later posted minutes as a source status, not as proof that no vote occurred.

The scan completion gate is satisfied only when every source in the declared beat/source inventory has an access status, uncovered beats are named, every available relevant meeting range has a review status, every substantive action/cue has a disposition, and the agenda/recording/minutes comparison has no unexplained mismatch. If any gate fails, label the run `PARTIAL`, identify exact gaps, and avoid a claim of exhaustive coverage. A `COMPLETE` gate means the declared source inventory was fully reviewed for this date window; it is not a guarantee that every event in town was discovered.

## 4. Rank and deliver

For each verified lead from any civic beat, write 200–300 words of sourced reporting, a 1–5 score for each newsworthiness dimension, a concise why-it-matters note, and a 100–150 word plain-language summary for advance or watch items. These are substantial editor-facing leads; `full-pipeline` expands them into nearly finished drafts. Assign an editorial readiness tier separately from source tier and newsworthiness score. Tier B leads get a short note with the primary evidence needed and the AI's next accessible check. Tier C signals get a one-line investigation note; for Reddit, include the post date, canonical permalink, and next primary-source check. Do not describe either as verified. Do not quietly discard lower-tier potentials; the editor decides what deserves more digging.

Under each expanded lead, include its consequential claims and a compact source list with URLs and exact locators. Mark unresolved claims rather than silently dropping them. Carry this evidence into the full story packet if the lead advances.

When the user requests `full-pipeline`, carry the Tier B/C signals and unexplained anomalies forward to the Black Desk. Do not quietly convert them into verified leads or drop them solely because their initial score is low.

The briefing starts with:

```text
DAILY BRIEFING — {town} — {date window}
Run status: COMPLETE | PARTIAL
Source inventory: {checked / blocked / not posted}
Beat coverage: {covered beats / gaps}
Meetings: {recording URLs, coverage status, unreviewed ranges}
Action coverage: {substantive actions, routine groups, unresolved cues}
Agenda reconciliation: {matched, changed, unexplained}
```

Then give (1) a compact **all-actions ledger** with timestamps and dispositions; (2) scored story leads with editorial readiness tiers; (3) held/unverified leads and specific next AI checks; (4) upcoming meetings; (5) beat-memory changes if saved. Keep the all-actions ledger separate from the ranked leads so an important but low-scoring motion remains visible. The editor may edit, send a lead back for rewrite or more digging, order a Dark Signal Desk check, or kill it. Escalate a human reporting task only when a specific necessary question cannot be answered from accessible sources.
