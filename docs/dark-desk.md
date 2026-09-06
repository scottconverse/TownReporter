# The Dark Desk

The Dark Desk is the part of TownReporter that goes looking for the things
nobody has written down yet. It does not publish. It hands the editor
questions, and the evidence it gathered while asking them.

It runs in **two stages**, and the split is the whole point.

## Where this came from

This desk is a restoration, not an invention. Its doctrine is the owner's own
earlier work, carried over more or less line by line:

- **civic-newsroom** — `prompts/03-black-desk.md` (the speculative radar) and
  `prompts/04-dark-signal-desk.md` (the mandatory verification protocol). The
  two stages, the confidence cap, the three postures and the four gates are all
  from these two files.
- **civic-scanner** — the Claude Code skill (v2.1). The source tiers, the
  search minimums, the location scoping and the newsworthiness gate come from
  here.
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

Before any signal may be shown as verified or sent to the queue as a finding,
**the application runs the adversarial searches itself** and the model answers
four gates.

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

### The four gates

1. **What was tried to disprove it** (`disproof_attempted`) — the boring
   explanation first, then the searches and what they returned.
2. **Whether the sources are independent** (`source_independence`) — which of
   them trace back to a single origin, and which genuinely do not.
3. **What context is missing** (`missing_context`) — what a reader would need
   that this signal does not have.
4. **The self-referential check** (`self_referential`) — is this about AI,
   journalism, information integrity, media, or this tool? If yes it is
   **never** finalized. These topics create blind spots, and this is the gate
   that catches the desk narrating its own sandbox at the editor (the 0.6.14
   regression).

A signal with **any** gate unanswered stays **unverified**, and the desk says
which gate is missing, in words. A one-word shrug counts as unanswered.

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
- **A 90-day preference** unless the trail is explicitly historical.
- The tier that answered is recorded on every search.

## The newsworthiness gate

Before a signal becomes a story lead, three questions:

- Does anyone's life change?
- Is it new?
- Is there a record anyone could check?

**No to all three keeps it in the file as a watch item, not a lead.** The
answers are stored on the lead's notes when it does advance.

## What the gates never do

They never stop the digging. This is the non-gating rule that has been in this
desk since v0.1.0 and stays: no provenance, classification, confidence,
verification or evidence-quality state may prevent creating or pursuing a
research lead. Unknown, weak, contradictory and unverified states are recorded
accurately and the investigation continues. Frontier items stay open. Files
stay open. Signals are never deleted for failing a gate.

What the gates decide is narrower and specific: what may be **called
verified**, and what may go to the working queue **as a finding**. An editor
who wants a speculative signal on the queue anyway can tick **"send
unverified, as a tip"** — and the lead then carries the words "sent
unverified" in its own notes rather than pretending otherwise.

## Where this lives in the code

| Piece | File |
| --- | --- |
| The doctrine: cap, postures, tiers, gates, newsworthiness | `src/lib/news/dark-gates.ts` |
| Stage 2, the adversarial searches and the gate answers | `src/lib/news/dark-verify.ts` |
| Stage 1 synthesis, the run loop, the queue gates | `src/lib/news/dark.ts` |
| The prompts | `src/lib/news/dark-prompt.ts` |
| The dig loop, search minimums, tier recording | `src/lib/news/investigate.ts` |
| The screen | `src/routes/desk.dark.tsx` |
| Schema | `migrations/0043_dark_gates.sql` |
