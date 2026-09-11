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
