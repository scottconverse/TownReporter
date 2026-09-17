# Fresh Nelson investigation: useful final recovery, faulty intermediate reads

## Run and assignment

Existing isolated staging server, built source 9a7a565, port 3471; database
`townreporter_stage_03efb7b_20260911`. Created file 10 through the ordinary Dark
Desk input and selected Codex Terra explicitly, with the existing three-hop
configuration. No special source URLs or expected answers were supplied:

> What is proposed at 8979 Nelson Road in Longmont, what decisions have actually
> been made, and what can residents still weigh in on? Read the primary
> documents and distinguish proposals from approved actions.

Job 119 started 2026-09-11 02:48:35.610038 MDT and completed
02:53:54.719692 MDT, stage Done, error null. No second model job was started.
Production was not changed; nothing was published or sent to the queue.

## What it found and missed

Capture 2473 / version 1599 contains the official February 17, 2026 active
development report, 52,747 characters:
https://longmontcolorado.gov/wp-content/uploads/2026/02/ADL20260217.pdf

The address begins at character 3,528. Its row describes Connection Church
Annexation Referral, DV-ANNREF-26-00001, approximately one acre at 8979 Nelson
Road, proposed Mixed-Use Employment zoning, and an existing religious-assembly
use proposed to remain unchanged. This is evidence of the February proposal,
not proof of present approval or a current hearing/comment deadline.

Despite capturing that report in hop one, the hop-two and hop-three summaries
continued to say no supplied record identified the proposal. Later reads
included historical-library records and failed guessed government routes.
The final brief recovered the address/application match and explicitly
contradicted the earlier note. It retained uncertainty about final action and
resident participation. Do not count the final recovery as effective
intermediate investigation: it did not use the application number to pursue
the current case record during its three rounds.

The final headline calls the referral active; the supporting record is dated
February. That wording needs temporal qualification before publication. No
publishable-current-story or daily-paper-target PASS is claimed.

## Reproduced selection defect

After the job was terminal, piped version 1599's actual captured document into
the current pure `retrieveRelevantChunks` function. Query:
`8979 Nelson Road proposal decisions residents primary documents approved actions`;
options `budgetChars: 1500, perDoc: 6`.

Result: `char:32000-34000`, score 10, `containsAddress: false`, beginning with
an unrelated building/access description involving 1660 South Fordham.
This is a focused helper reproduction, not a claim that its query/budget
exactly reconstruct every historical planner call.

Two launcher attempts failed before the successful reproduction: first the
test environment guard rejected missing safe-test environment; then a nested
PowerShell quote caused a parser error. The successful run initialized
`safeTestEnvironment`, loaded the guard, then imported the function. No test
database initialization or writes were needed. No guard was disabled.

Next repair: prioritize specific exact numeric query identifiers over generic
document vocabulary, without hardcoding this address or expanding context.
The unrelated repeat-context regressions still await the specific owner
approval. Their exact additions are preserved in
`PENDING-PRIOR-LEAD-CONTEXT.patch`, rather than leaving an unimplemented,
unapproved interface in the active test suite while independent work proceeds.
The original 98-test desk-copy file is unchanged. This is not a claim those
two pending regressions pass; their recorded RED result remains two failures.

## Curated tools disposition

### First repair review (not yet accepted)

Luna's first submission added exact numeric-identifier relevance and reported
72/72 focused tests passing. Lead replay against captured version 1599 selected
`char:2000-4000`, score 25, rather than the unrelated South Fordham chunk.
However, the returned excerpt was 2,000 characters for a 1,500-character budget.
The address appeared beyond its first 1,500 characters. This proves ranking
improved but does not prove the bounded model context receives the target.
The short synthetic fixture did not exercise that placement. The submission
was returned for a focused bounded-excerpt correction; no additional model
job or production change was made. This replay is a helper diagnostic, not
an exact reconstruction of the historical whole-section truncation.

### Accepted bounded helper repair

The second submission bounds an oversized selected excerpt around its exact
identifier without increasing the configured character budget. Lead repeated
the same read-only replay against version 1599: `char:2000-4000`, score 25,
length 1500, `containsAddress: true`, `boundedContains: true`. The returned
passage includes the application number, annexation proposal, MU-E zoning and
unchanged religious-assembly use. The locator names the containing original
chunk, not the narrower excerpt's exact start and end.

Worker-reported focused verification command:

```powershell
$env:DATABASE_URL=''; $env:VERCEL=''; $env:VERCEL_ENV=''; $env:RUN_LIVE_MODEL_TESTS=''; $env:TOWNREPORTER_TEST_ENV_VERIFIED='1'; node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test --test-concurrency=1 src/lib/news/report.test.ts src/lib/news/report.scope.test.ts
```

```text
ℹ tests 72
ℹ pass 72
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22575.5907
```

Initial ranking regression was observed RED (52 tests, 51 pass, 1 fail).
The later long-preamble regression and bounded-excerpt repair were reported
together; a separate pre-fix test-run RED for that second fixture was not
provided. Lead's real-document replay supplied the before/after failure
evidence. Do not describe the entire correction as a fully recorded TDD loop.

Lead reviewed both source changes and independently executed the real-document
helper replay; the 72-test suite was executed by Luna, not independently rerun.
No source text was discarded from storage; no provider, prompt, database,
network endpoint, dependency, or production configuration changed. This is
accepted as a bounded DEV retrieval fix, not full Dark Desk acceptance.

Lead `npm run typecheck` completed with exit 0 (`tsc --noEmit`), no diagnostics.
Full-repository tests and a new application build were not run for this small
checkpoint; the served staging application is still the earlier build. The
owner's focused-verification/resource constraints remain in force. Publication
of this DEV commit is not a new release or production deployment.

Current source does retain search/read results across hops. The missing
capability is responsive model choice after each operation within a hop;
application queue order currently chooses reads between model decisions.
An independent Terra source review identified reusing the present search,
ingestion, capture and selected-provider path for bounded captured actions.
No new service or uncaptured native-browser substitution is required.

Curated direct tools remain OPEN. Fixing the demonstrated excerpt-selection
defect is useful regardless of that integration: a read tool returning the
same irrelevant excerpt would not solve the observed problem.

## Next implementation: responsive source choice (in progress)

The first integrated operation adds one model decision after successful search
results are persisted, before the app chooses the hop's reads. The selected
provider can prioritize returned sources using the actual results, rather than
guess fetch URLs before searching. Reads still use the existing ingestion,
capture/version, frontier and provenance paths. Existing search and four-read
limits are unchanged. Selector failure preserves ordinary queue execution and
is recorded rather than presented as a successful model decision.

This costs at most one additional planner call per productive hop, using the
same selected provider and timeout configuration. No background loop, new
service, paid provider or uncaptured native-browser substitution is introduced.
Tests inject the selector explicitly; an injected test planner must never
accidentally activate a real provider.

Luna owns the bounded DEV implementation and focused test lane. Completion
requires observing that a non-first search hit selected by the model is read
first and that receipts and limits survive. Integration and live application
acceptance are still pending. This first operation does not by itself close
objective 8: choosing follow-up actions after a read remains to be addressed.

### Source-choice integration checks

The source choice is implemented in DEV. Lead reviewed the final diff and
added the omitted selector-failure regression before accepting it. No claim
of test-first development is made for that additional coverage. Worker baseline
was 13/13; worker's reported initial RED was an incorrect expected fetch count,
not a valid behavioral RED. Preserve that limitation rather than calling it TDD.

Lead executed:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/investigate.loop.test.ts'],{env:safeTestEnvironment(),stdio:'inherit',windowsHide:true}); process.exit(r.status??1);"
```
```text
ℹ tests 15
ℹ suites 1
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11254.8215
```
No warnings or errors were emitted. This isolated test confirms the third
search result can be selected first; failed selection continues ordinary
fetching, records the error, leaves planner fallback counts unchanged, and
returns an editor-visible notice. It does not prove real-provider selection.
Lead `npm run typecheck` also exited 0 without diagnostics.

Owned staging server handle 77813 was stopped after confirming no queued or
running staging jobs. A new isolated build is in progress; production was not
stopped. Build log: `artifacts/post-search-selector-build-20260911.log`.

Build completed exit 0. Database migration reported `DATABASE_URL not set —
skipping`, as intended. Existing Node warning:
```text
(node:35848) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
```
Staging restarted on port 3471 with handle 93456 against the same isolated
acceptance database. New build contains the source selector and bounded
retrieval repair. HTTP readiness is not real-provider investigative acceptance;
that remains the next check. Full-repository tests were not run. No new release,
production promotion, source approval, or automatic publication was performed.

## Real continuation on the source-selector build

Candidate `f1cdcc0` is running in isolated staging. Through Chrome's ordinary
Dark Desk controls, opened existing investigation 10 and clicked Keep digging
with Codex Terra visibly selected. No new source URLs or expected answers were
supplied. Job 120 was created at 2026-09-11 03:20:58.529394 MDT and confirmed
running. The staging job queue was empty immediately before the click.

This is a continuation, not another fresh investigation. It deliberately uses
the prior saved findings and open questions. Acceptance must inspect the new
post-search selections, actual captures and final result; starting the job is
not a PASS. Browser tab 1225669178 is retained for this unfinished acceptance.

First-hop observation while job 120 remained running: searches now explicitly
include `DV-ANNREF-26-00001`. The persisted `post_search_selected` contains the
City's `ADL20260217.pdf`; `post_search_failure` is empty. The model's recorded
reason calls it the next productive primary-source read and explicitly states
that the annexation/zoning proposal does not establish approval or a remaining
comment deadline. Capture 2485 is that PDF, first in this continuation, version
1599. Subsequent captures are the waiver form, development-meetings page and
an unsuccessful assessor URL. This proves real-provider source choice reached
the existing capture path, not that new decision evidence was found.

### Job 120 terminal result

Started 03:20:58.547918 MDT; finished 03:28:54.961082 MDT, 476.413 seconds.
Status completed, stage Done, error empty. No queued/running staging jobs
remained after completion. Eight captures: four classified changed, three
not-found, one unchanged. These are engine outcomes, not eight new useful
documents. In particular the first PDF still resolves to version 1599.

Hop 2 selected the same PDF again; the run-level fetched-URL set prevented
another fetch. Hop 3 recorded an empty selection and no selector failure.
The new mechanism is live, but repeated source choice consumed a decision
without obtaining new evidence. Do not count it as an efficiency win.

Browser final headline:
> 8979 Nelson Road has a documented Longmont annexation-and-MU-E-zoning proposal, but the supplied file does not show a final decision or a remaining public-comment date.

The brief correctly identifies the approximate one-acre annexation/MU-E
proposal and unchanged religious use; it does not treat a generic waiver form
or general development-meeting guidance as an address-specific approval or
comment window. This improves the prior headline's present-tense 'active'
claim. The necessary later case-file decision remains unlocated. Nothing was
published or filed as a new queue item in this continuation.

The interface shows 21 records and 204 open follow-ups (previously 13 and 117).
It also retains earlier contradictory notes and an unproven Founders Block
association among hypotheses. This growth and stale context mean the result
does not establish dependable, efficient investigation or the daily-paper
target. Objective 8 remains partial; objective 7 remains partial. The next
engineering step must address responsive follow-through on already-read
evidence and avoid recommending the same read within one run, not start an
identical benchmark loop. The same candidate must be evaluated on useful
new evidence, not just another successful job status.
