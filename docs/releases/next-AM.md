# Next TownReporter patch — corrections (unreleased)

**State:** Candidate work in progress from unit AM (branch
`deepseek/0670-corrections`, 0.6.70 lane 1). This document does not assert a
release, tag, GitHub publication, production deployment, or live-model result.

The owner posted his first real correction on 2026-09-25 and said two things
about it: *"the correction box starts empty"* — he expected suggested wording —
and that a correction today is a public note above a story whose printed words
cannot be changed, while many newsrooms fix the text **and** append the
correction. Both are now on the desk.

## The box does not start empty

Opening a correction now shows two short lines above the note — **What was wrong**
and **What is right** — and two buttons that fill the box from them. The fact goes
in the two lines (*the fee was $4,200* / *the fee is $2,400*); the sentence is what
the desk is for.

- **Suggest wording** asks the story model, through the same Automatic provider
  ladder every other call site uses, for one correction note in the paper's voice,
  built only from those two lines and the story it can see, forbidden to add a
  fact of its own. The answer is read back with the same care as a headline
  suggestion: a fenced block, a "Correction:" label, quotes, a lead-in sentence
  and anything after the first line come off, and a list of options, a fragment,
  or a paragraph longer than the schema allows is refused rather than offered.
  The note goes **into the box**, not onto the paper. Nothing posts until the
  editor presses **Publish correction**, and the manual path is untouched.
- **Use a plain note** writes *An earlier version of this story said … In fact, …*
  on the desk, with no model and no network call. It is a second button on
  purpose: one button cannot both "leave the box exactly as you left it when the
  model is unreachable" and "fill the box with no model at all".

Every press says what happened: **Suggesting…** / **Writing…** while it works,
*Suggested below. Read it, change any of it, then post it.*, *Plain note written
from your two lines…* on success, and, when the model cannot be reached, *"The
story model could not be reached just now, so no wording was suggested. Your box
is exactly as you left it."* — with the box genuinely unchanged. Both buttons need
both lines, because a note built from half a fact reads finished and says nothing.

## The printed text can be changed, with its note

**Also fix the story text** is a second checkbox in the same form, **off unless the
editor turns it on** — the default stays exactly today's behaviour, note-only. On,
it opens the printed body in an editor that already holds the story as it printed,
so the editor changes the words they can see. One press of **Publish correction**
then does both halves in **one transaction**: the note is published, the body is
updated, and the old body is written to a new append-only table,
`article_body_history` (migration 0095, additive), with who, when and the
correction that justified it. The desk cannot reach a state where the text changed
without its note, or the note without the change it promises.

The slug never moves, so no link breaks. A fix that is unchanged (including
whitespace-only differences) or blank is refused in a sentence an editor can act
on, and a refused press writes neither half — no note, no text change, no history
row. The rules live in `correction-wording.ts`, which has no database in it, so
they are tested directly.

## What a reader sees

Nothing new. A note-only correction is exactly what it was: the note on the
article page and on `/corrections`. A correction that fixed the text shows the
corrected story plus the same note; the words the story used to carry are **not
printed anywhere**, which is the choice 0.6.67 already made for headline history —
`article_body_history` is desk-only, like `article_headline_history`. `docs/editor.md`
says all of this in the editor's words.

## Evidence

`npx tsc --noEmit` and `npm run typecheck:test` clean; ESLint clean on every
changed file; `correction-wording.test.ts` 14/14; `correction-fix-body.test.ts`
6/6 (against the fake DeepSeek endpoint, one measured `/chat/completions` call of
class `correction`, then a quota failure that leaves the box alone); the
CI-shaped scripts suite 517 tests, 514 pass, 0 fail, 3 skipped. The desk walk
`delete-corrections-e2e.mjs` gained the two new steps and was syntax-checked, but
**was not run here**: it needs `DATABASE_URL` and a served build on port 8080,
which this unit's rules put out of reach.
