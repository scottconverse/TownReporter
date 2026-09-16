# The Dark Desk

Dark Desk uses the city and state saved in Paper setup, plus its configured county. It does not inherit Longmont jurisdictions for another town. The Reddit check requires one unambiguous subreddit among this newsroom's accepted Sources; otherwise it is unavailable and links to Sources. No subreddit is guessed from a town name.

The Reddit check discovers posts through Reddit RSS, then asks a validated Redlib to read up to three selected discussions in full. It defaults to the editor's local Redlib at `127.0.0.1:18080`, keeps canonical `reddit.com` permalinks and labels posts as unverified tips. If Redlib is stopped, malformed, rate-limited or unable to reach a thread, the scan keeps the RSS result and tells the editor that only the excerpt was read. Set `REDDIT_REDLIB_BASE_URL=off` to disable the probe, or set another Redlib base address explicitly. TownReporter uses only the configured instance and does not rotate through public instances.

The Dark Desk is the part of TownReporter that goes looking for the things
nobody has written down yet. It does not publish. It hands the editor
questions, and the evidence it gathered while asking them.

It runs in **two stages**, and the split is the whole point.

Last full guide review: 0.6.27 (2026-09-07). This retained review baseline is separate from the [current release](../README.md).
This describes software behavior, not independent confirmation of a reporting
conclusion or the current production deployment. See [the takeover handoff](../HANDOFF-NEXT-AGENT.md).

## Where this came from

This desk is a restoration, not an invention. Its doctrine is the owner's own
earlier work, carried over more or less line by line:

- **CivicNewspaper** — `src-tauri/prompts/audit/03-black-desk.md` (the speculative radar) and
  `src-tauri/prompts/audit/04-dark-signal-desk.md` (the adversarial completeness protocol). The
  two stages, the confidence cap, the three postures and the four gates are all
  from these two files.
- **civic-scanner** — the Claude Code skill (v2.1), consulted for source and
  location-search techniques. Those techniques are implementation aids, not
  editorial gates and not a substitute for the owner's Dark Desk prompts.
- **civic-transparency-toolkit** — the real-world source list this kind of
  searching is aimed at.
- **CivicNewspaper** — the Tauri app whose Rust pipeline established the rule
  TownReporter follows: **the application does the fetching and searching, and
  hands evidence to the model.** The model never gets a tool.

By 0.6.22 this desk had drifted into a single pass with a soft
`counter_narrative` field, five postures instead of three, and no search
minimums at all. It was, in the owner's words, "much weaker" than the
originals. This document describes what it does now.

## Stage 1 — the Black Desk

Speculative by design. Fail-open. It exists to validate noise, not to confirm
facts, because suppressing anecdotes kills investigations before they begin.

Its product is a developed lead: the people, organizations, money, records,
missing names and connections worth following. Each material anomaly keeps two
live, falsifiable explanations: the investigative theory about what may be
happening underneath, and the strongest ordinary or benign explanation. The
desk searches for evidence that supports and contradicts both. It does not pick
a winner just because one search was empty.

- **Every signal is capped at 0.5 confidence.** Not as a request in the
  prompt — in code (`capSpeculativeConfidence`, `src/lib/news/dark-gates.ts`).
  A speculative pass that files at 0.9 has quietly become a verification pass
  that never verified anything.
- **High strength plus low confidence is a priority, not a problem.** A signal
  at strength 13 and confidence 0.2 means "this looks urgent and nobody has
  checked it". That should accelerate the digging.
- Nothing at this stage is a finding. On screen it reads
  **"Black Desk · speculative, ≤50%"**, with a sentence saying so.

### The three postures

There are exactly three. Two others ("Chorus that rhymes", "The web") had been
added along the way; they are gone, along with the rule that existed only to
constrain one of them.

1. **The dog that didn't bark** — absence measured against an expected
   cadence. Reports promised but missing, items withdrawn without explanation,
   portals that go dark, audits that disappear.
2. **The whisper in the crowd** — three or more independent reports inside
   seven days, from different people or different parts of town. Fewer than
   three, or all from one source, is a complaint, not a cluster.
3. **The fiscal fray** — money moving without a narrative. Administrative
   transfers, franchise-fee diversions, reserve draw-downs.

## Stage 2 — the Dark Signal Desk

For the strongest new signals, **the application runs adversarial searches
itself** and the model answers four review questions. This adds a visible
research-completeness record. It does not decide whether the lead may exist,
continue, or move to the working queue.

Stage 2 defaults to the **six strongest new signals per round**; the editor can choose 1–24 in **How hard to dig → Change**. The round summary uses every eligible signal as its denominator, separately showing attempted, protocol-complete, protocol-incomplete (including failures) and saved for later review. Signals not reviewed in this round remain visible and speculative. The separate triage answers help rank work; the editor controls lead handoff and publication remains a separate human action.

### The searches the app runs

At least four queries per signal, aimed at at least three different kinds of
source:

| Query | What it looks for | Tier |
| --- | --- | --- |
| the ordinary explanation | routine, scheduled, administrative reasons — written and searched **first** | official |
| the official record | agendas, minutes, staff reports, resolutions | official |
| local press | what anyone else already reported | local press |
| the opposing account | disputed, denied, responded, community reaction | community |

Every one of them is written to the run record with its query, the tier that
answered, the URL and the outcome — including the ones that came back with
nothing. The open file shows this as "Searches this round", so the editor can
see the sniffing rather than be told it happened.

Failed, blocked and timed-out searches do not count as completed attempts. A
successful search returning zero results does count as trying its intended
source category, and its empty result stays in the record. Requiring a hit in
every category would turn "look there" into "find something there."
The verification model receives bounded result titles and snippets plus signal
context, not fetched full document text. The editor still needs to open and
read the originals. If the search trail or signal result cannot be saved, the
run must not report a successfully persisted verified result.

### The four gates

These are the four stored answers. The prompt's numbered headings instead
introduce contestation, disproof, independence plus missing context, and
self-reference. There is no separate persisted contestation answer. Do not
substitute newsworthiness, claims-of-absence or city-data validation for this
list: those are different checks.

1. **What was tried to disprove it** (`disproof_attempted`) — the boring
   explanation first, then the searches and what they returned.
2. **Whether the sources are independent** (`source_independence`) — which of
   them trace back to a single origin, and which genuinely do not.
3. **What context is missing** (`missing_context`) — what a reader would need
   that this signal does not have.
4. **The self-referential check** (`self_referential`) — is this about AI,
   journalism, information integrity, media, or this tool? A yes adds explicit
   editor scrutiny. It does not hide or veto a legitimate lead. Operational
   model narration is filtered separately when output is parsed.

A signal with **any blank answer** stays **protocol-incomplete**, and the desk
says which answer is missing. There is no invented character minimum. The code
does not prove the answer true; the editor must read the records and challenge
the reasoning. The interface therefore says **Protocol complete · four gates**
rather than claiming that a fact has been verified.

The file also preserves the limits of negative evidence. **Not established in
this file** or **not found in these searches** never becomes **does not exist**
unless a complete authoritative inventory supports that claim. It does not
invent a date window. A promise is recorded only when a named person or
organization made an explicit, sourced commitment; if there is no such
commitment, the promises list stays empty.

## Models, checkpoints and the whole-run limit

The shared picker offers Codex Astra, Sol, Terra and Luna; Claude Fable, Opus,
Sonnet and Haiku; Local model; Automatic; and saved custom connections. An
explicit choice remains the requested first runtime. A recognized technical
failure can move only the unfinished model call, with requested and actual
model and effort retained; a content refusal is terminal. Dark Desk Automatic uses a configured
gateway when present; otherwise it starts synthesis on Codex Terra and can
retry an unfinished synthesis stage on Claude Sonnet. It does not choose Opus or
Astra automatically. Claude planning uses Haiku; Codex Astra and Luna planning
uses Luna; Codex Sol and Terra planning uses Terra.

A round checkpoints research before synthesis. If synthesis times out, the
completed searches and document reads stay complete and only synthesis is
retried. One run meter caps elapsed time, model calls, searches and document
reads across research, synthesis, signal verification and the editor brief.
The open file shows the current stage and the live counts. The run record keeps
each model call's stage, provider, model, duration, result and timeout status;
provider-reported token counts are stored when available and remain unknown
when the provider does not report them.

Research can pause with unresolved items, but a low-yield or repeated-source
stop does not override a high-value open trail. New follow-up items are cleaned,
equivalent labels are merged, and only a bounded high-value working set stays
active at once. Lower-priority items are saved as deferred work, shown to the
editor, and resumed at the start of the next **Keep digging** run after the
active set drains. An empty search or unread record cannot by itself close a
trail. Repeated model assertions that
a hypothesis is a dead end are not evidence exhaustion; the path closes only
after its tracked search strategies are exhausted, and later evidence can
reopen it.

## Search minimums

Applied to the dig itself, not just to verification, and enforced by the app
where the planner falls short:

- **At least three distinct query variations per hypothesis.** A zero-result
  query is one failed tactic, not an answer.
- **At least three kinds of source**, in order: the paper's own official
  domains (`.gov` and whatever the watch list marks official), then local
  press, then community.
- **Location-scoped by default** — the city, and the county where the record
  is actually held. An unscoped query returns a national explainer.
- **A 90-day search preference by default.** The editor can choose 1–3650 UTC calendar days of lookback, including the current UTC date, or an inclusive calendar range. The lookback changes at UTC midnight; the paper's display timezone does not change that boundary. The same resolved date hints reach discovery and adversarial queries and their model packs. A provider may ignore date operators; returned records still need their dates checked.
- The tier that answered is recorded on every search.

## Editor triage

Three questions help the editor rank a signal:

- Does anyone's life change?
- Is it new?
- Is there a record anyone could check?

**No to all three suggests a watch item.** It does not block a lead handoff.
The answers are stored in the lead notes so the working desk can see the state.

## What the gates never do

They never stop the digging. This is the non-gating rule that has been in this
desk since v0.1.0 and stays: no provenance, classification, confidence,
verification or evidence-quality state may prevent creating or pursuing a
research lead. Unknown, weak, contradictory and unverified states are recorded
accurately and the investigation continues. Frontier items stay open. Files
stay open. Signals are never deleted for failing a gate.

The four answers describe research completeness; they do not arbitrate truth or
control the queue. The editor may hand off any signal or whole file. Its notes
carry the protocol status, opposing account, missing context and next steps so
the working desk cannot mistake a hypothesis for a factual finding.

## Watching a specific page

The **Watched pages** panel can start a daily investigative watch without opening a dig. It keeps dated captures and compares each readable result with the last readable one; blocked or failed checks remain distinct from unchanged text. A capture becomes a lead only through an explicit **Create unverified lead** action, or can be attached to an investigation. See [the editor workflow](editor.md#watch-a-specific-page-in-dark-desk) for OCR choice, downloads, history, pause and stop. These watches do not accept ordinary scanning sources or implement legal removal.

When an investigation has many captures, Dark Desk selects relevant records across the complete captured inventory before shared selection builds separately bounded inputs for stage-one signal synthesis and the final brief. When an applicable complete stored PDF page fits the existing budget, Dark Desk retains it in source order; otherwise it keeps a contiguous neighborhood around the matching passage. Persisted page context travels with its source provenance and is used without adding duplicate generated fragments. Final-brief instructions require each detail to remain paired with the record it describes rather than an adjacent row. These safeguards preserve context and state the attribution rule; they do not guarantee model accuracy. A record absent from a bounded input means the selector did not include it; it does not prove that the source lacks the record or that the record was never captured.

When a site redirects only to add or remove a trailing slash on the same address, the watch compares the captured text normally instead of reporting **Page moved**. The full redirect trail stays in capture history. A different host, protocol, port, path or query still reports a move; blocked destinations remain blocked by the fetch safeguards.

## Where this lives in the code

| Piece | File |
| --- | --- |
| The doctrine: cap, postures and adversarial review | `src/lib/news/dark-gates.ts` |
| Stage 2, the adversarial searches and the gate answers | `src/lib/news/dark-verify.ts` |
| Stage 1 synthesis, the run loop, editor-controlled handoff | `src/lib/news/dark.ts` |
| The prompts | `src/lib/news/dark-prompt.ts` |
| The dig loop, search minimums, tier recording | `src/lib/news/investigate.ts` |
| The screen | `src/routes/desk.dark.tsx` |
| Schema | `migrations/0043_dark_gates.sql` |

## Five live investigations — acceptance exercise

**Owner-authorized travel-local execution, still pending.** This plan is not a report that the runs happened. Run five investigations in an isolated travel-machine environment, without Halo data or services, and separately replay the September 3–8 historical interval. Halo real-data staging and promotion remain a distinct local-operator exercise. Do not publish automatically or manufacture a queue item to make a run appear successful.

The first two topics are the owner's wording and hypotheses, not established
facts:

1. “Did a second Democrat in the 2025 mayoral race split the vote against
   Shakeel Dalal?” Check candidate identities, affiliations and certified
   results first; numerical vote arithmetic alone does not establish how
   voters would have behaved in a different field. Record the historical
   window rather than treating 90-day search preference as sufficient.
2. “What is the city not telling us about the 2027 budget?” Establish what
   budget documents exist, their dates and publication schedule before
   treating an absent document as concealment. Seek routine explanations and
   responses, including evidence against the premise.
3. A specific local business or employment change, selected before the run.
4. A specific school, housing or health/service question, selected before the run.
5. A community, nonprofit or arts question, selected before the run.

Topics 3–5 are proposed coverage categories, not invented owner assignments.
The operator records the exact question and owner selection before starting.
Include at least one case where “no finding / watch / still unknown” is a
reasonable result. Do not deliberately break or interrupt production to test
failure recovery; use local fixtures for those states.

For each run, fill this record:

| Field | Required evidence |
| --- | --- |
| Identity | Run/file identifier, exact repo SHA, served version, operator and timestamp |
| Question and scope | Exact question, city/county, historical interval if relevant, model and settings |
| Stage reached | Speculative signals filed, number eligible/selected for verification, completed or interrupted state |
| Searches | Every query and kind, intended tier versus returned tier, provider, outcome, exact returned URLs; distinguish failed search from successful zero results |
| Reading | Captured documents with dates and source links, unread/blocked records, OCR method and partial-read status |
| Gates | Each stored answer, missing reasons, contrary evidence, ordinary explanation and independence assessment |
| Editor triage | Life changes / new / checkable record, with rationale; watch is a valid suggestion |
| Handoff | What reached the queue and a lead link; protocol status and uncertainty retained |
| Editor experience | Pending/success/error feedback, readable result destination, what required manual work |
| Verdict | Pass / defect / inconclusive with supporting record; what remains unknown and the next reporting action |

Pass requires honest states, traceable evidence and preserved uncertainty,
not a minimum number of findings. A failed search shown as successful, an
unsupported factual conclusion, an unlabelled speculative queue handoff, a
cross-newsroom record or unread OCR called complete is a defect. Provider
unavailability may make reporting inconclusive while still proving correct
failure handling. Aggregate the five records, list defects separately from
editorial unknowns, and retain the operator's observations as attributed
evidence. Mocked local tests cannot replace these records.

## Saved investigative preferences

**How hard to dig → Change** keeps search dates and the verification count independent of dig, nerve and map. Presets change only the original dials. Save applies the whole visible configuration; validation errors leave it unsaved, and an unconfirmed response tells the editor to reload rather than promising which write reached the server. A failed settings read shows a retry state and never substitutes defaults for a saved configuration.

Migration0048 stores per-newsroom preferences and a snapshot on each round. The snapshot is recorded before research begins and is reused through planning, synthesis, verification and automatic model failover. Editing settings during a round changes later rounds only. Search dates express a preference, not a factual date filter or completeness claim. Verification counts are saved on the round; failed searches, invalid model replies and failed signal-result writes stay unverified.
