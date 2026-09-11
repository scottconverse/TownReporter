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

Current source does retain search/read results across hops. The missing
capability is responsive model choice after each operation within a hop;
application queue order currently chooses reads between model decisions.
An independent Terra source review identified reusing the present search,
ingestion, capture and selected-provider path for bounded captured actions.
No new service or uncaptured native-browser substitution is required.

Curated direct tools remain OPEN. Fixing the demonstrated excerpt-selection
defect is useful regardless of that integration: a read tool returning the
same irrelevant excerpt would not solve the observed problem.
