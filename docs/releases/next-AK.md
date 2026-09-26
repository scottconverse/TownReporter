# Next TownReporter patch — lead matching (unreleased)

**State:** Candidate work in progress from unit AK (branch `deepseek/0669-news`,
0.6.69 lane 1). This document does not assert a release, tag, GitHub publication,
production deployment, or live-model result.

The owner asked two questions about the Queue: *"Do I miss the real 2nd story?"* and
why a lead could sit at NEW under a cryptic "≈ PRINTED" badge whose "POSSIBLE
DUPLICATE · COMPARE" link opened a page that only said *"This lead was killed.
Nothing to draft."* Both were real. What follows is what an editor sees now.

## Nothing is silently thrown away

A second finding of the same story no longer disappears. When the scanner finds a
story it already has, there are three cases instead of two:

- **The same story twice in one scan run** becomes **one** lead. The two source
  URLs are merged onto that lead. This is the case that produced leads 207 and 212
  on 2026-09-25 — the same headline, city page and second, filed twice, one of them
  printed as article 73 while the other sat at NEW.
- **A strong match against a live lead** behaves as before: the lead is held as a
  possible duplicate and its "came back" count goes up.
- **A strong match against a KILLED lead now depends on the facts.** If the new
  finding carries a concrete fact the killed lead did not have — a **date**, a
  **dollar amount** or a **number** in its why or its evidence — it is filed
  **HELD**, labelled *"Developing: new facts on a story you killed"*, linked to the
  old lead, and it shows the old kill reason. A *reworded* why is not a new fact:
  the scan rewords its own why nearly every time it re-finds a story, so counting
  new words refiled almost every killed repeat — the opposite of what was asked. A
  lead whose headline recurs and whose concrete facts are the same is still folded
  into the old one, and the scan summary says so in those words.

**An index or section page is not a shared source.** A crime list, `/news/`, a
`/category/…` page, a site root or an RSS feed has no article slug, so it no longer
counts as "the same URL" when the scanner decides two findings are the same story.
This is the case behind leads 218 and 209, which both cited the Daily Camera crime
index rather than an article.

## The Queue says what it means

- The NEW row no longer shows "≈ PRINTED". It says **"Looks already printed:
  \<headline\>"** and links to the article, with a one-press **Kill as duplicate**
  that records the reason ("Duplicate of \<headline\>") and a link to the piece it
  was killed against. Saving, saved and failed each say so on the page.
- The **Held** tab carries a count badge, so held work is not hidden behind a tab.
- A killed lead that has come back shows **"Came back N times"** on its row.

## Compare is a comparison

**Compare** opens a side-by-side view of both leads on the page you are already
on: headline, why, sources, filed date, status and kill record for each. Three
presses, each of which gives visible feedback:

- **Not a duplicate — move to New**
- **Same story — kill this one**
- **Newer facts — reopen the old one**

A press the desk refuses says so in a sentence, in the editor's words rather than
the server's. Reopening is offered only for a killed lead and explains itself when
it is not applicable.

## A killed lead still shows what it was

A killed lead's page replaces *"This lead was killed. Nothing to draft."* with the
lead itself — headline, why, sources, when it was filed — plus when and why it was
killed and a **Reopen** button. After a reopen the record stays and says the kill
was undone, because a page that silently forgets a kill is the same hidden state
this unit is about.

## Evidence

Focused tests: `npx tsc --noEmit`, `npm run typecheck:test`, ESLint, the lead rules
(one-story-twice, killed-plus-new-facts, killed-plus-same-facts, index pages),
133 copy tests, 33 render tests, and the CI-shaped scripts suite
(517 tests, 514 pass, 0 fail, 3 skipped). The browser walks in the desk workflows
were not run for this note, and no desk walk needed a change.
