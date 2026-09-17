# Halo acceptance and automation activation — work in progress

**Correction:** the routine-check focused run reached the copied staging database through Vite `.env` loading. Earlier isolation statements below are superseded by [TEST-ISOLATION-INCIDENT.md](TEST-ISOLATION-INCIDENT.md). Production fixture-ID checks are clear; staging is contaminated and backed up. Do not treat that focused pass as PGLite or clean-staging acceptance.

Scott authorized Codex to manage test preparation, execution, evidence, diagnosis and engineering, and to activate the approved automation capabilities. His subsequent **Go** starts this work. This supersedes the prior status report's statement that activation authority was still awaited, not its observations of the database.

## Boundaries

- Production remains v0.6.34 at `b097d288d9237be225bc6ed56851078ad064d208` until a separately verified engineering candidate is promoted.
- Existing accepted sources and the six previously approved routine families only; no new paid provider or blanket source approvals.
- Ordinary reporting remains editor reviewed. No test publication on the live paper.
- Existing daily scheduler, durable jobs and routine-edition machinery are reused.

## Current evidence

- Remote main still matches the accepted release. Development began clean at documentation commit `7cecb9d4af07aa57ed67c038d341dadeda2156c3`.
- Live database read: 34 accepted sources; no configured daily scan or routine automation rows; no queued/running desk jobs at preflight.
- `npm test` baseline failed before source changes: script group 342 tests, 339 pass, 1 fail, 2 skipped. Windows readiness probe still held its log at deletion. Raw evidence: `artifacts/halo-acceptance-baseline-20260908.log`.
- Bounded installer teardown repair has targeted baseline, deterministic RED and repeated GREEN evidence in `artifacts/installer-repair-*-20260908.log`. These changes are not deployed.
- Legacy Halo paper settings have no stored timezone. A real PGLite reproduction confirmed that the scheduler's raw timezone differs from the UI's resolved setting. Null/blank/absent/invalid cases now have regressions; the development fix uses the same effective setting as the UI and isolates invalid-newsroom failures. These changes are not deployed.
- Full suite after these repairs completed with a separate fixture failure: source group 1,619 tests, 1,561 pass, 13 fail, 45 skipped, 924,508.8821 ms. All 13 failures were `routine-notice-checks.test.ts` attempting to insert into a missing `newsrooms` table. This is not a full-suite pass.
- The routine-check fixture mixed a direct Node database import with Vite-loaded server modules. Using the same transformed database module as the subject fixes the migration/instance mismatch without altering application code or assertions. Focused reproduction: 14 tests, 1 pass, 13 fail; after repair: 14/14, 17,318.8367 ms. Logs: `artifacts/routine-checks-isolation-{red,green}-20260908.log`.
- `npm run typecheck` passed before the subsequent editorial/evidence fixes. It must run again on the final candidate.

## Isolated live workflow

- Existing accepted-release development build started directly on `127.0.0.1:3460`, PID 50648 at 16:50 MDT. **In-memory PGLite**, explicit empty DATABASE_URL; neither production nor staging PostgreSQL is used.
- Disposable owner and newsroom named **TownReporter Acceptance — NOT PRODUCTION**; Longmont, America/Denver; one public events source.
- One normal Scan click using explicitly selected Codex Terra. No custom model prompt and no fallback. Completed: one source fetched, zero leads. It described the calendar as routine listings with no established new development. This is a functional scan, not useful-output acceptance.
- Server logs: `artifacts/halo-acceptance-server-20260908.out.log` and `.err.log`. Better Auth reports its shared rate-limit bucket fallback for missing client IP. This warning is not concealed as a clean log.

## Routine-source feasibility, not activation proof

`artifacts/halo-routine-source-probe-20260908.mjs` fetched four already accepted public URLs and used production parsers with explicitly synthetic probe provenance. It does not save captures or confer eligibility.

- Library URL redirects to `/library/`; no supported entries extracted.
- Longmont Public Media events: seven parseable records; remaining records lack required issuer metadata. Still requires genuine saved-capture preview and date/content review.
- Downtown calendar: no JSON-LD event records.
- PrimeGov portal is HTML, while this routine adapter expects JSON. No route substitution or source change performed.

The first probe accidentally used zero-valued fixture provenance and therefore failed validation before reaching event fields. It was corrected and rerun; that initial output is not evidence of a source defect.

## Remaining in this work package

Complete normal editorial workflow, saved evidence previews and usable-source activation; close evidence-review and owner UI gaps; verify unattended scheduling and restart behavior; preserve real failure and coverage limits; integrate fixes with tests, documentation and candidate-specific deployment evidence. Production activation has **not** happened yet.

## Live acceptance update — approximately 17:10 MDT

### Owner controls and unattended daily scan

The disposable owner saved a daily scan at 06:00 America/Denver, Codex Terra, one explicitly selected source, cap 12. Without manually running the scheduled job, the owner panel subsequently showed **completed for 2026-09-08**, next run **September 9 at 06:00 MDT**, and zero running/queued/failed jobs. Pause then returned **Daily scan paused**, **Schedule: Paused — Paused by the owner**, and **Next run: Not scheduled**. This proves one built-server unattended run and its pause control. It does not prove restart persistence because this acceptance instance uses in-memory PGLite. Routine editions were never activated.

### Ordinary writing failure, preserved rather than published

Submitted through the normal Write box with Claude Opus and public research:

> Write a short local item about upcoming programs at Longmont Public Media, using https://longmontpublicmedia.org/events/.

The resulting draft is `/desk/story/1` in the isolated instance. It selected form **explainer**, topic **Council**, and became a long studio-pricing/fundraising piece rather than the requested short programs item. Its body asserts current matching donations while its reporting notes explicitly flag the matching banner's year and validity as unknown. No publication occurred.

Source diagnosis: the original request was preserved only as scratch/evidence; model-selected research angle/form displaced its editorial authority. The parser's government-only fallback selected Council and the writer was forced to preserve it. Assignment preservation and short-form honoring are under repair. Community section classification remains a separate open item. A prompt change will require live revalidation; it is not a factual-accuracy guarantee.

### Evidence-review failure and repair

The finding panel successfully opened audio-studio capture event/version 3 and displayed its saved text and URL ending in `/space/audio-production-studio` (no trailing slash). The claim panel hid that same record for a claim ending in `/space/audio-production-studio/`. Twelve of sixteen claims lacked usable capture controls; four homepage claims worked.

The capture writer applies `canonicalPublicUrl`; the claim reader used raw string equality. The development fix uses the same canonical identity for claim/provenance/capture comparisons while preserving exact IDs, ownership and genuinely different URL refusal. Baseline 25/25; RED 27 pass/2 fail; GREEN 29/29; widened display/peer suite 32/32. Full logs: `artifacts/claim-canonical-*-20260908.log`. Live serving of the fix remains pending.

### Source quality and UI limits

The genuine saved routine preview parsed seven items, refused seventeen and flagged six recurrence conflicts. Independent inspection of the same response found a six-hour disagreement between visible orientation times and JSON-LD. See [the exact source finding](ROUTINE-SOURCE-FINDING.md). This source is not approved for automatic publication by this test.

Accessibility controls and captured-text display worked. The in-app browser screenshot command returned `Unable to capture screenshot`; content export was also unsupported. Visual screenshot acceptance is therefore still open, not silently satisfied by the accessibility tree.

The available production browser is signed out. Scott has been asked only to sign in as owner so authorized configuration can use the existing owner UI. He is not being asked to test or configure the product. Unblocked engineering continues.

## Rebuilt candidate live result — approximately 17:24 MDT

The candidate build passed with DATABASE_URL explicitly empty; migration reported that it skipped connecting. Only the old disposable acceptance process (PID 50648, verified command line/start time) was stopped. The replacement candidate is PID 57484, started 17:16:41 MDT, loopback port 3460, again in-memory PGLite. Production remains the accepted v0.6.34 installation, not this candidate.

The same exact Write-box request above was submitted through the normal UI with Claude Opus and public research. It completed as **brief**, focused on upcoming programs, rather than the earlier pricing/fundraising explainer. The reporting notes explicitly flag the missing calendar year and unresolved fundraiser and exclude the stale matching deadline from the article. This is one live comparison, not general accuracy acceptance.

Remaining defects: the item is still classified **Council**; the headline says **Free tours** although the displayed body/captured reporting establishes registration rather than an explicit free price. The draft remains unpublished. Neither issue is masked by the passing assignment tests.

The repaired evidence inventory now exposes exact captured versions for all 14 returned claims. Clicking claim 6's audio-studio button opened the saved text at the canonical URL without the trailing slash, artifact version 2/capture event 2, captured at 17:19:16 MDT. This directly reproduces the formerly broken claim-to-capture path on the new built server. A readable capture does not establish factual support for every claim.

The complete candidate test suite is still running at this update; no full-suite PASS is claimed yet. The editorial workstream's fresh independent regression run passed 105/105 with raw-log hash and limitations in [EDITORIAL-ASSIGNMENT-VERIFICATION.md](EDITORIAL-ASSIGNMENT-VERIFICATION.md).

### Two-source scan and further bounded repairs

Added only an already accepted production source URL, `https://longmontcolorado.gov/news/`, to the disposable newsroom alongside LPM events. A normal General Scan with explicitly selected Codex Terra (no fallback/custom prompt) at 17:28 fetched two sources and filed zero leads. It reported navigation-only city content and events outside its configured reporting categories. Useful-output acceptance remains unmet.

Independent extraction from the current city news HTTP 200 response returned `readability`, 258 characters: filters, Email Signup, `3018 results found`, Sort news by, and `Loading more news &amp; alerts...`. Initial suspicion of missing AJAX content was disproved: raw HTML already contains dated news cards. Reader mode discarded the cards; the fallback then removed the semantic MAIN because a header-spacing utility class matched its boilerplate regex. The bounded extractor fix recovers 1059 characters and dated cards without rendering. No renderer policy or host list was changed.

Custom newsroom sections already exist. The Write box cannot select one and falls back to Council; a development-only optional section selector is being added using existing section configuration and validation. First test edit was 17:27:31, first implementation edit 17:28:58, held for review at 17:29:58. Therefore the test sweep begun around 17:16 must not be described as an immutable final-candidate run: some files ran before these later edits. Focused final-source checks and a rebuilt UI are required separately.

## Integration and visual checks — 17:39–17:55 MDT

The current disposable built server is PID 34392, started 17:39:50 MDT, port 3460, in-memory PGLite. Earlier acceptance processes were individually identity-checked and stopped; production was not restarted. Edge screenshots were successfully inspected on desktop and at 390×844 mobile resolution. The Write box and section control were readable, keyboard reachable, and showed no horizontal page overflow (375 CSS-pixel document width in the 390-pixel viewport). The viewport was restored. These screenshots are in the tool transcript, not falsely claimed as saved artifact files. Four browser connection errors were observed and not attributed to the application or extensions without evidence.

The owner UI created a disposable Community section through its normal review/confirmation flow. The identical short LPM prompt was filed using Community and Claude Opus. The story editor shows Community while its draft is still running. Final draft retention/output acceptance remains pending at this timestamp.

The city scan at 17:44 still filed no leads. Investigation found that `performScanWork` uses `ingestUrl`, whose HTML branch still stripped the whole page before a 14K cap; the earlier extractor fix reached the research/document path but not this scanner path. The actual scanner HTML branch now reuses `extractArticleText`, retaining site notices separately. A stub-HTTP test through `ingestUrl` genuinely failed on navigation-heavy input before the change and passes afterward. Combined extractor/ingest/render tests: 27/27. PDF/RSS/YouTube/PrimeGov behavior was not changed. This integration has not yet been served for a live scan.

The full isolated sweep `halo-final-isolated-full-tests-r2-20260908.log` began before the final ingest integration. Its result must therefore be paired with the later focused 27/27 run, not represented as an immutable full-suite run of every final file. Final typecheck passed after integration. The first isolated sweep stopped on a newly introduced `text-xs` helper in the section control; it was corrected to `text-sm` before the running rerun. See the separate test-isolation incident and repair reports for the earlier staging mutation.

### Community draft completed — approximately 17:58 MDT

The ordinary Write-box pass completed as `brief`, retained `Community` on both lead and draft, and produced 348 whitespace-counted body words. Headline: **Two required orientations gate studio time on Longmont Public Media's September calendar**. Dek: **The 457 4th Ave. makerspace lists tours, DaVinci Resolve classes, an open member meeting and two ticketed concerts — but the listings carry no year.** The final body says that September 2026 is not established and prices/capacity/non-member admission are unstated. No edits or publication were made by the acceptance driver.

This closes this one live section/form-retention check, not factual acceptance. Earlier research notes still say "free-to-attend" and "this month" while later verification/body retain uncertainty. One recorded finding has a captured-version button but no verbatim excerpt; zero draft-pass claims were returned. Those are the visible evidence states, not a claim of a complete claim inventory. The resulting story still needs reporting and is not counted toward the useful-item target.

The r2 full sweep completed: scripts 343 total / 341 pass / 0 fail / 2 skipped; sources 1642 total / 1592 pass / 5 fail / 45 skipped. The five failures were a new regression in the scanner integration: plain-text responses entered the HTML extractor. Explicit plain-text dispatch repaired it without changing the five existing cache assertions. A guarded isolated rerun of scanner cache, ingestion, extraction and renderer tests passed 33/33. A further full sweep (`halo-final-isolated-full-tests-r3-20260908.log`) is running; no full-suite PASS yet.

### Actual scanner integration passes — 18:03–18:04 MDT

Final candidate build r3 exited 0; migrations explicitly skipped with empty DATABASE_URL. The prior disposable process 34392 was stopped only after its draft completed and child Claude processes exited. Its replacement PID 14156 started 17:59:55 MDT at loopback 3460, with fresh in-memory PGLite.

Through normal owner setup, the fixture selected the already-approved city news URL. General Scan, explicitly Codex Terra with no fallback or custom prompt, returned **1 fetched / 4 leads / 3 proposed sources**. The UI summary names a Sept. 4–28 Fox Creek Village driveway closure, cooling features at three parks, Sept. 8 clean-air recognition, and a blue-green algae reminder. It explicitly says underlying details were missing for the latter items. Earlier nav-only zero-lead runs are preserved above. This proves this real scanner path now receives useful source content; it does not prove four publishable items or the 60-minute editorial target.

An additional incremental regression after r3 started covered missing Content-Type and accepted non-HTML text; HTML detection happens before extraction, not by falling back to navigation after a failed HTML parse. Ingest/extractor/render tests passed 32/32. Existing unsupported text/markdown refusal stayed intact. The full r3 result must be labeled together with this incremental check; it is not a frozen-source certification by itself.

For restart acceptance a new, empty database **townreporter_acceptance_20260908_1805** was created and migrated on the owned local PostgreSQL port 5433. Production and townreporter_dev were not migration targets. A second loopback-only candidate PID 46796, started 18:04:11 MDT on 3461, uses this named acceptance DB. It is not exposed by the production tunnel. Policy persistence checks are pending.

## Later results and current candidate — 18:38 MDT

The startup above initially refused for missing stable authentication secret; it was retried with a disposable test secret. The owner login and daily-scan policy subsequently survived an owned-process restart. The policy was paused using the owner UI afterward. [Persistence receipt](PERSISTENCE-VERIFICATION.md) contains exact before/after hashes and supersedes the pending statement above.

The first three-item live batch completed, but review found unsupported counts, contrasts and inverted safety guidance. [Editorial-day result](EDITORIAL-DAY-RESULT.md) preserves these failures; no item was published or silently corrected by the acceptance driver. The application also contained an automatic organization-name link insertion that could attach unrelated same-host evidence. Bounded reporting/citation corrections and independent review are recorded in [the reconciliation receipt](EDITORIAL-RECONCILIATION-VERIFICATION.md), committed locally as `d658e28`. The final held-source focused reporting suite passed 71/71; build r5 passed with no database migration connection.

Current isolated process: PID 56148, started 18:34:16 MDT, port 3461, persistent acceptance database `townreporter_acceptance_20260908_1805`. The old process 61788 was identity-checked and stopped after its scan finished, with no drafting children. Production was not stopped or rebuilt.

The fresh scan ran 18:27:06.673979–18:27:52.110890 MDT and returned 1 fetched / 3 leads / 2 proposed sources. Its leads differ from the earlier batch: driveway closure, Municipal Court access and midyear progress. At 18:35:48 the normal queue's three-item suggested focus was submitted with Claude Code. This is a fresh real-work flow, not a same-input controlled comparison. The three draft jobs are still running at this update. The daily test policy remains paused. Full suite r4 is also still running; its start predates the final citation correction and must be paired with the 71/71 held-source reporting run.

## Closing state — 18:55 MDT

All three drafts completed by 18:41:08.883146; batch time 320.065 seconds. The final ordinary suite r4 passed 1953 tests, failed zero and skipped 47. Later citation persistence/publication changes have separate actual PGLite regressions (43/43 and 17/17), typecheck, final build r7 and a final HTTP 200 smoke. The sweep alone predates those incremental corrections; no final-source CI claim.

The live batch's original failures, remaining editorial limits and database backup are in [EDITORIAL-DAY-RESULT.md](EDITORIAL-DAY-RESULT.md). No generated story was published or rewritten to make the test pass. The final smoke process 22792 and earlier acceptance process 56148 were identity-checked and stopped with their owned descendants. Ports 3460/3461 have no owned acceptance server left, no queued/running test jobs remain, and the test daily policy is paused. Production remains v0.6.34, with zero configured new daily policies/routine automations and zero incident fixture IDs. Production browser access still requires owner sign-in.

The [owner work report](OWNER-WORK-REPORT.md) is the current concise status. Eight scoped local implementation commits preserve the fixes; production was not advanced. The staging incident remains documented and the contaminated copy remains preserved.
