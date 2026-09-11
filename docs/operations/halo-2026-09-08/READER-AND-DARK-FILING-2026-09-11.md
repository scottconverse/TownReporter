# Reader correction and Dark Desk filing acceptance

Candidate served: bec6379; source/evidence HEAD2396aab before this record.
Built staging only: http://127.0.0.1:3471 using
`townreporter_stage_03efb7b_20260911`. No production writes, model calls,
builds or test processes were started for this acceptance.

## Reader correction

Used Published > Post correction on article45, explicitly titled STAGING
ACCEPTANCE, slug `acceptance-readable-edition-4bf11b2`. Copied the actual
run2 weekend update with an explicit staging prefix into the correction form.
Clicked Publish correction; UI confirmed Correction is public (on this
isolated loopback paper only). Opened its reader page and visually inspected
it. Original body remains, correction appears below it, date and Museum/
Library source URLs survive. Database confirms one correction on article45.

This proves editor submission, persistence and reader visibility. It does not
claim the fixture was naturally scheduled in public newsroom1: automatic
run2 belongs to isolated newsroom98911. Presentation limitation retained:
correction text collapses into one paragraph and source URLs are plain text,
not linked citations. No redesign or polishing loop was opened.

## Filing the existing completed Dark investigation

Reused investigation9's existing repaired brief (job111), rather than running
another model investigation. Latest brief evidence is in
`CANDIDATE-03efb7b-STAGING.md`; older job17 records are not the newest run.

Opened Dark Desk's file about the 2025 mayoral vote-splitting question.
The brief correctly showed certified totals and distinguished those from
unproved affiliation/causal voter transfer. Clicked Send to the queue.
UI confirmed On the queue and Dark Desk did not publish. Opened lead137.
Its page preserves the explicit unverified warning, the polling/affiliation
follow-up, the non-causal file summary and official source links including
City certificate Document2840869. Follow-up text is explicitly shortened with
an instruction to open the investigation for all follow-ups, not silently
presented as complete. Database confirms lead137, newsroom1, status=new.

This is the isolated database's newsroom1, not production. It is not an
article publication, a new discovery-quality pass or resolution of all
curated-tool/watch/PDF obligations. No draft generation was requested.
Staging queued/running job count is zero after these UI actions.
