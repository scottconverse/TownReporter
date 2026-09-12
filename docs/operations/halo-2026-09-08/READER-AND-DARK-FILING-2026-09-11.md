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

## Manual page watch

Using Dark Desk > Watch a page / view watches, added the real official museum
category URL with name `STAGING ACCEPTANCE — Museum programme watch`.
Save watch and capture page completed without a model call. Monitor140 belongs
to the isolated database's newsroom1. Check1 saved capture2421 (first-capture);
the ordinary Check now button produced check2/capture2422 (unchanged).
Expanded the check and Read this captured text: September2026 events and the
Sunset Soiree description are present. The UI also exposes previous captured
text, complete-text downloads and the redirect trail.

Clicked Pause. UI confirmed history retained and automatic checks stopped;
database verifies watch_state=paused, enabled=false, last_outcome=unchanged.
No source change was fabricated. This proves creation, two real captures,
readable evidence, unchanged classification and pause persistence. It does not
prove a real changed-source event or failed-source recovery. No production
monitor or data was changed, and the acceptance watch is not left running.

## Real scanned packet through watch to draft — in progress

Added the public Ramsey July2024 council packet through the same real watch
form, not a database-seeded artifact. URL:
https://www.ramsey.gov.im/media/2262/agenda-papers-july-2024-public.pdf
Monitor141/check3 retained capture2423/version1560. Native Codex Terra read
12/44 pages, producing23,783 characters. Extraction is explicitly
`ocr-pages-partial:Codex:12/44`. The stored source content hash matches the
retained original:14e16cfd9584a413955f915ddd96c56cf31e7d02c8c330cd2f2c374f1add7c20.
The visible text starts with the July17 meeting agenda and July11 letter.
No claim that the action-tracker pages beyond12 were read in this capture.

Important observed operational distinction: this OCR path directly calls
probeCodex and invoked Codex despite TOWNREPORTER_CODEX=0 on the staging
server. The general drafting availability switch did not disable OCR. Actual
process command identified gpt-5.6-terra and trd-ocr page images. This was the
single authorized PDF workflow, not evidence that models remained inactive.
All its OCR processes exited before subsequent work.

Paused monitor141 through the UI; database confirms paused/enabled=false.
Created unverified Council lead138 through its captured-record control.
Stopped owned staging handle72145 after the lane was empty, restarted the
same build/database on3471 as handle43849 with Codex enabled and Claude off.
No rebuild or production restart occurred.

The supplied-only scope explicitly says Codex is unsupported; switched back
to supported Research public sources before submitting. Selected Codex Terra
explicitly, no fallback. Draft with AI created job114/lead138, observed
running at Opening source material. Do not restart/requeue it based on this
checkpoint; inspect that job and handle first. Draft quality and preservation
of partial-reading limitations remain unproved until its result is reviewed.

### Job114 result and development repair

Job114 is terminal: completed/Done, checkpointDraftId73. It did not produce
a usable article. Draft73 used version1561/capture2424 containing `timeout`
instead of the readable version1560/capture2423. Its unsupported framing of
"staging acceptance" as a council action is also not a factual result.
The original failed draft and both captures remain preserved in staging.

The repair carries the exact watch-check capture linked by the editor's
File as lead action into the shared individual/batch reporting pipeline.
It does not re-fetch that seed URL or re-label a newer URL snapshot as the
source used. Capture time and partial-OCR method are carried to the writer;
reading limits remain in reporting notes even when the model omits them.
Other public-source research remains available. No prompt contains an
answer key. This does not claim that all PDF pages or tables were read.

Luna diagnosed the handoff and supplied an integration test; the lead
implemented and accepted the repair. Luna's follow-up review caught the
ordinary `changed` capture classification, now included alongside fetched
and unchanged. Lead corrected the test's initial missing-schema setup to
use the existing Vite/PGLite fixture pattern. No real database test writes.

Focused verification (single execution lane; no full-suite rerun):
- Baseline report.test.ts: tests51/suites18/pass51/fail0/cancelled0/skipped0/todo0,
  duration11338.8365ms.
- New report regression RED: expected zero refetches, actual1. Second RED:
  partial-reading notes absent. Both assertions pass after the repair.
- Reporting suite plus first regression: tests52/suites18/pass52/fail0/
  cancelled0/skipped0/todo0, duration22587.2214ms.
- Existing draft-batch-worker tests: all9 passed during the integration run;
  that run initially failed the new test fixture (missing newsrooms table),
  not the application. Corrected fixture passed2/2.
- Changed-capture assertion RED: expected retained original, actual[].
- Final retained-source and report tests: tests3/suites0/pass3/fail0/
  cancelled0/skipped0/todo0, duration26525.4891ms.
- npm run typecheck: exit0.
- Final npm run build: exit0; DATABASE_URL explicitly empty, migration skipped.
  artifacts/pdf-handoff-build-final-20260911.log retains the output. Restricted
  build initially failed Windows readlink EPERM; normal authorized host build
  passed. Existing Node deprecation warning remains in build output.

Focused tests used this isolated launcher (FILES replaced with the named files):
`node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1',FILES],{env:safeTestEnvironment(),stdio:'inherit',windowsHide:true}); process.exit(r.status??1);"`
An initial direct guard invocation refused to run before tests because the
verified-environment marker was absent; the supported safeTestEnvironment
launcher above supplied it without any production connection.

Staging was rebuilt only after its old jobs were terminal and its owned
server stopped. Production remains unchanged. Live retry acceptance follows;
passing focused tests is not a claim of publishable reporting.

### Retried PDF handoff: job116 completed

Code commit7917c10 is pushed to github/feat/utility-bill-analyzer-link.
Job115 failed before generation because the staging server was launched under
the restricted execution runner and could not write its Codex state folder.
Stopped that owned server; started the same build on3471 with normal Windows
permissions, Claude off and Codex on (owned handle3704). No app permission
configuration was altered. Original drafts73 (checkpoint) and74 (job114 final)
remain unchanged. The first report incorrectly inspected only checkpoint73;
the final74 was also unusable and cited the timeout version1561.

Clicked ordinary Redraft, explicitly Codex Terra/no fallback, with the same
lead, no pasted answer or model briefing changes. Job116 completed/Done and
created checkpoint75 and final draft76. The visible editor recovered the result
and re-enabled its controls. It shows the correct retained version1560 and
capture2423, with the newer timeout snapshot offered separately for review,
not substituted. No publication was attempted.

Read draft76 against retained OCR: July11 agenda date, July17 scheduled meeting
at7pm, printed tracker-page references11-15, the separate June19 minutes,
June13 tracker reference and Mooragh Park signage discussion all match the
captured text. No substantive factual correction was made to this final
historical synopsis. Its notes explicitly retain12/44 partial OCR and do not
claim to know July tracker contents, the meeting outcome or a Longmont link.
This is a successful captured-PDF-to-sourced-draft handoff, NOT a current
Longmont publication candidate or proof that the action tracker was read.
The earlier selected physical-page13 test remains a separate receipt.

Remaining PDF limits: source discovery still fetched irrelevant Longmont
follow-ups for this foreign historical record, and some additional scanned
PDFs logged JBig2 initialization warnings. No invented outcome or corrective
rerun was used to hide those limitations. Curated investigative tools remain
open; this evidence does not waive them. The full16-item goal remains active.

Terminal check: job116 elapsed153.23seconds; zero new original-URL capture
events after its start; zero queued/running staging jobs. Watches140/141 remain
paused and disabled. Staging server3704 remains available for the next workflow.

## Ordinary save and reload — later staging checkpoint

On the later staging build `284f0ea` at the same loopback address/database,
opened Queue > existing parking lead125. Changed only its headline from
“Parking limited at Longmont Safety and Justice Center during garage construction”
to “Parking limited at Longmont Safety and Justice Center while garage is under
construction”, then clicked Save edits. The interface reported Saved. A full
reload retained the exact edited headline.

The draft body still contains its City garage-project Markdown citation; Claims
and Sources still links the same City records. The recorded-claims inventory
retains exact captured-version controls, including versions1508 and1516. The
interface explicitly says the story changed after evidence was gathered and
keeps earlier reporting private pending review; publication remains disabled.
This was a real editor save through the UI, not a database patch. No model call,
publication, production mutation or additional test process was started.

This closes this draft's ordinary save/reload observation only. It does not
establish interrupted-save recovery, batch drafting, a successful evidence
recheck, or overall article quality. Existing failed drafts remain unchanged.

## Real batch drafting — two existing leads

On the same staging build/database, confirmed zero queued/running jobs, opened
Queue, explicitly selected Codex Terra, checked parking lead125 and school
certifications lead132, and clicked Draft selected. Batch1 started through the
ordinary editor controls. No altered prompt, forced source, publication or
production write was used.

The lead incorrectly described this as serialized beforehand: the app's existing
default job lane has concurrency2 (`jobs.ts`), and both jobs started together at
03:57:33 MDT. No other model/build/test work was started during this batch. This
was not a serial trial; future acceptance must account for that existing limit
before launching a batch, rather than promising serialization it cannot provide.

- Job123 / school132: completed104seconds, checkpoint79, final draft81.
- Job122 / parking125: completed142seconds, checkpoint80, final draft82.
- Both terminal results have `evidenceCheckIncomplete:false` and no job error.
- Editor batch results visibly changed to Saved draft81 and Saved draft82.
- Final staging query confirms zero queued/running jobs.

Read both complete final bodies and their integrity notes. School81 states the
679 certifications as a district-reported 2024–25 count, not 679 distinct students;
it retains uncertainty about credential counting and the undated homepage.
Parking82 contains Tuesday-only shuttle hours and attributes the December2026
schedule, but its reader body includes an already-past late-summer2026 expected
completion from the rehabilitation page. That needs editorial attention before
publication. No factual correction has yet been made to either new draft.

Both retain inline public citations and captured-version provenance. School81
references versions1614/1451/1447; parking82 references1508/1515/763/765.
This proves the batch UI, saved checkpoints, final results and links. Comparing
these latest bodies against those exact captures remains the next quality step;
job completion and automated checking are not a human reporting-quality verdict.

### Exact-capture review of drafts81/82

Read full captured texts1447,1451,1614,1508,1515 and763, not current replacement
pages. School81's 679 credentials/2024–25, 70-plus programmes, approximately33000
students, 60 schools/programmes, 13 communities, 2012/2018 Innovation Center dates
and $59million since2018 all match these sources. No numeric correction needed.
The source does explicitly say certifications earned, so the private note's
suggestion that these might be attempts is unnecessarily broad. More importantly,
this is an undated homepage statistic about an old school year, not proof of a
new development. Do not count it as a fresh daily-paper item merely because the
draft is accurate. Further reporting is needed to establish a useful current angle.

Parking82's address, garage45-to87 spaces, December2026 schedule, Tuesday-only
8:30–11 shuttle, east-lot accessible parking, northwest entrance and court
request options match captured City material. Version1515 also retains an
August24–September8 closure and a late-summer expected completion; those are
not current-status proof on September11. In the ordinary editor, replaced the
bare late-summer sentence with an explicit statement that the captured material
does not confirm whether that work has finished. Clicked Save edits. Read-only
database verification confirms the clarification and its original citation
are saved in draft82. Checkpoint80 remains the pre-edit model output.

Editorial result: parking is a useful attributed service brief with one
substantive clarification; school is accurate background but needs a current
angle. Neither was published. No model retry or new code was used for this
review. Editor effort was not reliably timed, so this does not close the
60-minute daily-production target.

## Write a story — ordinary link submission

Confirmed the staging job lane empty, then used Desk > Write a story with only
the actual City Development Services hours notice URL (the existing captured
`beginning-sept-2-the-development-services-center-385-kimbark-st-will-be-closed-to-the-public-every-wed-8-11-am`
page). Explicitly selected Codex Terra; left public research scope unchanged.
The UI created lead140 and navigated to its workbench. Job124 began04:03:49 MDT,
completed112seconds later, no error. Only this job ran.

Draft83 is the initial empty form; draft84 is the saved writing checkpoint with
an incomplete-reconciliation note; draft85 is the final shortened story. The
terminal job result names checkpoint84, so that field alone is not the final
draft identifier. The editor visibly presents85 with Save edits, evidence-check
and publication controls available. No publication was attempted.

Read final85 against its exact retained primary version1511/capture2529. It
accurately states September2,2026; Wednesday11–5; the other four weekdays8–5;
planner hours9–noon/1–3 on those days and1–3 Wednesday;385Kimbark; and the listed
telephone/email contacts. No unsupported reason, appointments promise or
permit-processing consequence appears. Zero substantive corrections made.
The body has no inline Markdown links, while source_urls and provenance retain
the City schedule and development-applications page. Reader rendering of this
particular draft's source list has not been tested by publishing it.

This proves the separate Write entry point produces an editable, source-backed
service brief and retains the earlier checkpoint. It is not a new discovery:
the supplied URL was already known, and another queue lead covered the same
hours change. Do not count it twice toward daily output. Zero queued/running
staging jobs remained after the check. No production change or new code.

## Recoverable queue deletion and Undo

Used Queue > Delete on only staging lead140, then its Yes, delete confirmation.
The UI said “Deleted, and kept for 30 days” and offered Undo. Clicked Undo;
lead140 returned to the queue. Opened it through its restored Open link: the
final Development Services headline/body were present and editable. Read-only
database confirmation shows all three draft IDs83,84,85 restored under lead140,
with final85's two original source URLs retained. No model regeneration or
direct database repair was used. No production or permanent deletion occurred.
This proves immediate recoverable deletion/Undo for a drafted lead; it does
not claim legal erasure, backup purging, or interrupted-save recovery.

## Follow-up and manual Opinion walkthrough

On the same isolated staging server/database, added a reporting follow-up to
lead140: “Confirm whether the Wednesday counter hours remain in effect before
reusing this service brief.” Reload retained the unchecked YOURS entry and
PULL control. It was not falsely marked completed and no model was invoked.

Opinion > Paste a piece I wrote accepted an explicitly labelled isolated
acceptance editorial about making the posted counter hours clear. The UI
reported “Filed as a draft,” listed **Written by the editor**, and retained
draft86 after reload. The headline is “OPINION: Clear public hours help
residents plan.” Its original City source URL remains in the body; the
structured source_urls field is empty, so this is not evidence of automatic
source extraction. Nothing was published. A read-only staging query found
zero queued/running jobs afterward.

AI-written Opinion is not proved by this manual filing. This staging profile
reports no private-voice file and no available Claude writer. The UI explains
those limits and leaves manual filing available. No voice was imported, no
provider enabled, and no production content or settings changed. Other
functional-walkthrough requirements remain open; this is not a full sign-off.
