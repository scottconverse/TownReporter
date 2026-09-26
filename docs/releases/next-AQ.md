# Next TownReporter patch — style audit (unit AQ)

**State:** Candidate work in progress on `deepseek/0671-draft-audit`. This
document does not assert a release, tag, GitHub publication, production
deployment, or a live-provider result. Every model call described here was made
against a fake provider.

## Style check on a news draft

A news draft is now measured by code, and the model is asked to repair only what
the code found. Code measures first; the model rewrites second; code measures
again. A model never decides what counts as a fault.

`src/lib/news/draft-audit.ts` is pure — no I/O, no database, no provider — and
takes the text as it is on the page:

```ts
auditDraft({ headline, dek, body, form })
```

It returns findings (`severity`, `code`, `paragraph`, `sentence`, `message`,
`snippet`) beside the measurements they came from. The checks are unnamed
attribution, importance-only sentences, participle tails, dressed-up verbs,
filler words, synonym cycling, paste artifacts, tracking parameters and URL
redirects, paragraphs over the form's cap, sentence-length variation, a missing
short-next-to-long beat, and six-word repeats. Thresholds are named constants in
`DRAFT_AUDIT_LIMITS`, marked in the file as starting values rather than findings
of fact.

**Quoted text is never a finding.** Quotations are the source's words; the
audit reads past them, and the repair is refused if it alters one.

## The bounded repair loop

`src/lib/news/draft-audit-repair.ts`. The audit runs; if anything is severity
`fix`, **one** model call receives only the findings — paragraph, sentence,
message — and returns the corrected body; the audit runs again. At most **2**
rounds. A repair is **rejected**, and the previous text kept, when it flattens
the sentence rhythm below the threshold or changes any quotation, number, name
or URL. The repair may not add facts.

## Where the results are kept

Findings and the before/after measurements are stored with the draft in
`drafts.research_json` (never `provenance_json`); the completion receipt carries
the summary. A draft that still has `fix` findings gains the review reason
`style-audit-open`. **No migration was added** — `research_json` already exists
and 0098 was not needed.

The story page shows a plain **Style check** list — *"3 things to fix:"*, each
finding's location, its sentence and the words it came from — with review
findings under a fold. It reuses the existing panels, adds no layout, and blocks
nothing. The audit runs there on the editor's own text, and again when the
editor saves.

**Fix these with the model** runs one repair round on demand. Nothing
auto-publishes; the editor may ignore every finding. The result is saved as an
ordinary draft revision and the desk says so.

## Targeted evidence

Pure suites, plain `node --experimental-strip-types --test`, all exit 0:

- `draft-audit.test.ts` 52/52, `draft-audit-repair.test.ts` 32/32,
  `draft-audit-record.test.ts` 21/21, `draft-audit.server.test.ts` 12/12.

Suites touched by the wiring, all exit 0: `draft-edit.test.ts` 2/2,
`draft-completion.test.ts` 9/9, `finding-evidence-review.test.ts` 29/29,
`name-check.test.ts` 23/23, `request-input.test.ts` 17/17,
`request-input-sweep.test.ts` 107/107.

The sweep was **red** on this unit's own new validator before it was fixed:

```
✖ desk.ts has no cast-only validator left
  AssertionError: desk.ts:2448 is still a cast:
  .validator((input: unknown) => draftStyleFixInput.parse(input))
```

The call was the right shape and always was; the sweep's list of known schemas
had not heard of the name. Adding it admits one schema call and nothing else — a
bare cast still fails the same assertion.

`npx tsc --noEmit` exit 0. ESLint exit 0 on every changed file.

## Limits

- **No live model call was made.** The loop is proved against a fake provider:
  accept, reject on a changed number, name, quotation or URL, reject on a
  flattened rhythm, stop after two rounds, and provider failure leaving the draft
  untouched with a plain message.
- The thresholds are starting values. They were chosen by reading local-news
  sentences, not fitted to a corpus; a real desk will want to move them, and the
  file says so where they are defined.
- The audit judges whether a draft *reads*, not whether it is true. Truthfulness
  is the evidence check's job and is unchanged here.
- Opinion pieces have their own path and were not touched.

## Not asserted by this document

No release, tag, GitHub publication, production deployment, or promoted
candidate is asserted. No real model call, and no result from one, is asserted.
