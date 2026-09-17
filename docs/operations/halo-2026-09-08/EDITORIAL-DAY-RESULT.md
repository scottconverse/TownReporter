# Real editorial workflow result — 2026-09-08

## Verdict so far

**The scanner and three-item drafting workflow work. Three publish-ready items in an hour is not yet proved.** This is the candidate on loopback 3460, not production. Nothing was published. Results were not edited to make acceptance pass.

Earlier failures are retained in ACCEPTANCE-IN-PROGRESS.md: zero-lead navigation reads, an overlong/off-subject Write-box draft, wrong section, inaccessible captured versions and the staging-test isolation incident. The later successful run follows actual product fixes. It is not an unmodified baseline comparison or proof that the entire afternoon fit inside an hour.

## Normal user actions

At approximately 18:03 MDT, a normal General Scan with explicitly selected Codex Terra fetched the already accepted `https://longmontcolorado.gov/news/`. It filed four leads and proposed three sources. It used no custom test prompt, hidden briefing or new source approval.

At approximately 18:07, the existing queue selected three leads and **Claude Code** in the batch runtime picker. The normal **Draft selected** action started all three. By the approximately 18:14 review, each showed **Completed · Done** and the queue showed three drafted leads. These approximate UI observation times are not per-model latency instrumentation.

The selected subjects were the Fox Creek Village driveway closure, cooling features at three city parks, and a blue-green algae notice. The clean-air recognition lead was not drafted. No local LLM was loaded for this exercise. The owner was not asked to perform testing.

## Output and independent spotchecks

### 1. Driveway closure

Draft headline: **Fox Creek Village's Pace Street driveways keep closing — southern entrance shut through Sept. 28**.

Useful content: dates, alternative access, business access, project context, bus/cyclist/pedestrian impacts and contact information. The closure and alternative-access essentials match the [City's southern-driveway notice](https://longmontcolorado.gov/news/southern-entrance-pace-fox-creek-village-closed-sept-4-28/) and [project page](https://longmontcolorado.gov/projects/pace-street-improvements/).

Corrections needed: the draft presents four changes since August 10 as a sourced count without defining what counts. The supplied notices establish three closure phases; reopening or revised forecasts could be additional transitions but should be explicitly enumerated. It also calls the [earlier notice](https://longmontcolorado.gov/news/northern-driveway-exit-pace-fox-creek-village-closed-aug-10-24/) an August 10 advisory when August 10 is the event start and the notice was published August 6. The difference between its forecast and the [later entrance notice](https://longmontcolorado.gov/news/northern-driveway-entrance-from-pace-fox-creek-village-closed/) is real, but announced dates are not by themselves proof of exact implementation dates.

These are bounded primary-source spotchecks by the independent acceptance subagent, not certification of every paragraph.

### 2. Parks cooling features

Draft headline: **Longmont opens mist, shade and gathering spaces at three heat-mapped parks; Kensington splash pad sign says spring 2027**.

Useful content: the ribbon-cutting time/location, installed amenities and project context. The [City announcement](https://longmontcolorado.gov/news/new-cooling-features-at-three-city-parks-celebrated-at-lanyon-park/) supports September 12, 11 a.m.–noon at Lanyon Park, 1900 Collyer St., and the listed amenities.

Corrections needed: the draft says selection used temperature data *rather than requests* and describes households as most exposed. The [project page](https://longmontcolorado.gov/projects/resilient-together-project-neighborhood-cooling-and-community-building/) names community engagement **and** heat mapping; it does not establish either exclusion or a household exposure ranking. The draft's funding credit links City of Longmont to an unrelated [jobs announcement](https://longmontcolorado.gov/news/city-of-longmont-job-alerts-9-2-2026/), although the actual cooling announcement supports City participation.

Source diagnosis found that `linkOutletInBody` can add a same-host link to a bare organization name after generation, while `preferStoryUrls` includes fetched candidates. The wrong link therefore must not automatically be blamed on the model. The exact pre-postprocessing body was not retained in this live UI receipt, so that particular insertion remains a source-supported causal possibility, not proven provenance for the individual link.

### 3. Algae notice

Draft headline: **Longmont tells residents to stay out of untested water — one reservoir gets the testing**.

The draft includes source links and distinguishes routine monitoring from possible response to reports. But its dek/body turn a general avoidance instruction into an assertion that residents must assess risk visually. That is not what the [September 1 notice](https://longmontcolorado.gov/news/stay-out-of-water-not-meant-for-play-a-seasonal-reminder-about-blue-green-algae/) says: it advises avoiding undesignated water and notes hazards may not be visible. The [background guidance](https://longmontcolorado.gov/public-information/algae-blooms-in-lakes-and-ponds/) is context, not a basis for reversing the current notice's practical direction. The main agent directly checked the two primary pages. This is an editorial accuracy finding, not medical advice or a full source-by-source certification.

## Resulting engineering scope

The next bounded correction reuses the existing reporting/editing pipeline. Remove guessed inline attribution based only on organization/domain; distinguish evidence from assertions already present in a draft; retain original wording without inventing contrasts, rankings, counts or changed guidance; keep publication/event/capture dates separate. Use existing evidence retrieval and bounded editing rather than introducing a new verifier or claiming automated factual certification.

A further unchanged-workflow live run is required after that correction. Deterministic prompt/input tests alone cannot establish improved article accuracy. The three drafts remain unpublished and are not counted as three accepted finished items.

## Separate checks already demonstrated

- Explicit short Write-box assignment returned a 348-word brief in the selected Community section. It retained calendar-year uncertainty; it still needed reporting, and is not included in the three-item batch.
- Exact captured claim records are reachable after canonical URL matching; a matching capture does not prove the claim.
- Daily policy and authenticated owner session survive a restart on a separate persistent acceptance database. The test policy was paused afterward. See PERSISTENCE-VERIFICATION.md.
- Full ordinary suite r3: scripts 341 pass / 0 fail / 2 skip; source tests 1603 pass / 0 fail / 45 skip. Total **1944 pass / 0 fail / 47 skip**. The last generic-text correction occurred during this sweep and has its own 32/32 focused receipt. Do not call this a frozen-source certification or current CI. Log SHA-256: `781AEE77B97D123CF327C0D092203A5038F56C9A98F82F35AFB783B1E36B9474`.

## Fresh persistent batch — completed 18:41 MDT

The final-source r5 candidate used the persistent acceptance database, normal General Scan (Codex Terra), then the queue's three-lead suggested focus (Claude Code). Scan job 1: 18:27:06.673979–18:27:52.110890 MDT, **45.437 seconds**, one fetched source, three leads, two proposed sources. Draft jobs 2–4 began at 18:35:48.818560, 18:35:48.826479 and 18:35:56.403011; completed at 18:39:57.694390, 18:40:47.126977 and 18:41:08.883146. Batch elapsed **320.065 seconds (5m20s)**. The UI independently showed all three Completed/Done and three drafted leads after reload. There were no custom test briefs, edited outputs, provider substitutions or publication actions.

This scan returned different subjects from the first batch; it is not a controlled same-input model comparison. It demonstrates the operational scan-to-three-drafts path, not three publication-ready articles or a measured 60-minute editor day. Overall elapsed work included diagnosis, software changes and repeated checks and is not the editing-time benchmark.

1. **King Soopers' Pace Street driveway closed through Sept. 28 for city street project.** The reconciliation notes removed unsupported closure counts, unsupported “actual overspending” language and date-discrepancy claims absent from its evidence slice. Independent spotchecks support the resident detours and March 24 amendment of $871,500 ($89,527 + $781,973) in the [City CIP compilation, page 4](https://longmontcolorado.gov/wp-content/uploads/2026/07/2026-CIP-Amendment-Timeline_0726.pdf). A small date error remains: “May advisory” is the [April 29 notice](https://longmontcolorado.gov/news/pace-street-rough-ready-trail-improvements-begin-may-4/), whose event starts May 4. A URL path alone does not establish the PDF's publication date. Useful draft, still editor-reviewed.
2. **Court building's front lot is now a garage site; visitors enter at the northwest door.** The [garage project](https://longmontcolorado.gov/projects/safety-justice-center-parking-garage/) supports the 45-to-87 spaces, anticipated December 2026 completion and Tuesday 8:30–11 shuttle. The draft preserves an uncertain closure year and asks about reopening, but its opening still reads as current access guidance. Official [court](https://longmontcolorado.gov/judicial-department/municipal-court/) and [facility](https://longmontcolorado.gov/facility/safety-and-justice-center/) notices give differing closure dates. The stored court capture contains parking text but not the live page's conflicting date notice. The finite evidence slice therefore did not settle the real conflict. Not cleared for publication as written.
3. **Longmont's dashboard puts renewable power at 31% for 2025, and blames credit sales for the drop.** The result distinguishes reported delivered energy from total generation and removes unsupported board-minutes details. However, the source list lost its substantive [Indicators dashboard](https://indicators.longmontcolorado.gov/) while body, claims and provenance retained it. Investigation proved an application persistence bug: `desk.ts` applies the discovery-only `dropListingUrls` filter to already-cited documents. It removes the dashboard because it is a root URL, and similarly removes the Municipal Court citation because that URL is watched. This is not missing capture (Indicators artifact 32 contains 4,505 characters, event 41) or a trailing-slash mismatch. A bounded regression repair is underway; the saved output is preserved unchanged as failure evidence.

The full persistent acceptance database was backed up after these drafts completed, before any attempted repair of their saved citations: `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter_acceptance_20260908_1805-final-1844.dump`, SHA-256 `FC6B84BC19300540F5298BB6B09D31C98709A4D4875948AC3D3593E496F0CF29`. It contains three drafts and the automatic onboarding About article; none of the three generated drafts was published. The database dump is local evidence, not committed credentials or repository source.

## Final automated regression sweep (before persistence repair)

Full ordinary suite r4 exited 0: scripts **341 passed / 0 failed / 2 skipped**; source tests **1612 passed / 0 failed / 45 skipped**. Combined: **1953 passed, zero failed, 47 skipped** out of 2000. Source duration 942,415.0515 ms. Raw log `artifacts/halo-final-isolated-full-tests-r4-20260908.log`, SHA-256 `4ACF62EEDD9093CF2E3225C49F271909F7494DC4E9C099047882E72EB03DBC89`.

This sweep started before the last reporting correction. The held-source three-file reporting rerun independently passed **71/71** after that correction, with build r5 and typecheck green; see the reconciliation receipt. Do not describe the sweep alone as an immutable final-source CI result. The skipped cases include opt-in live-model and PostgreSQL integration cases; the ordinary green suite does not prove those skipped paths.

## Production remains separate (latest boundary)

The persistence and publication regressions described above are now repaired with 43/43 and 17/17 guarded tests, final typecheck/build and loopback HTTP smoke. See [citation persistence](CITATION-PERSISTENCE-VERIFICATION.md) and [publication semantics](CITATION-PUBLICATION-VERIFICATION.md). The live batch predates those last changes and remains untouched; no second generated batch or general factual pass is claimed. All acceptance-server processes are stopped and the test policy is paused. No current test/model generation is running from this work.

A fresh public check returned HTTP 200 and rendered 0.6.34. Production Git HEAD remains `b097d288d9237be225bc6ed56851078ad064d208`. Its database has zero new daily policies, zero routine automations, zero active jobs and zero incident fixture IDs 98001–98015. No candidate was promoted or pushed. Owner sign-in is still needed to operate the authorized production controls; routine source date/time conflicts additionally block honest automatic-publication acceptance.
