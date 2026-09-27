# Next TownReporter patch — unreleased (Unit BJ, redesign phase 2c: the desk screens)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or a promoted candidate. Phase 2c restyles the **bodies** of five already-working screens — **Opinion**, **Dark Desk**, **Sources & scan**, **Published** and **Server & newsroom** — to the approved drawings. No migration, no new color, no new route, and no action is removed.

## What an editor sees change

### Every screen keeps its actions and gets the drawing's shape

Each of these screens already did its job; what changed is the arrangement on top of it. The five bodies now follow the drawings in `docs/design/handoff-2026-09-26/design/Desk Screens.dc.html` and the captures beside them: the same panels, the same row shapes, the same filter chips and the same primary/secondary button family the rest of the desk already uses.

- **Opinion** draws two doors side by side under the rule — a yellow "Have the AI write an editorial" on the left, "File one you wrote" on the right — and the editorials list below them under the heading the drawing uses, **Requests & editorials**.
- **Sources & scan** shows its four filters as chips with live counts — **On watch · 42**, **Suggested · 175**, **Rejected**, **Could not check · 2** — over a list of rows that each carry the source, the town, its state, and the two things you can do about it without leaving the row. The search box sits on the filter line, and the **Daily scan** panel keeps the sentence it must: *Scans file leads only. They never draft or publish.*
- **Published** shows the same four filters (**All · n**, This week, With corrections, Opinion) over the drawn columns — **Printed | Story | Views | Corrections | actions** — with each row's story, the line that printed, and a count of corrections against it.
- **Server & newsroom** keeps all twelve of its panels and lays them out two-across, with a jump strip along the top so an editor can reach a panel by name rather than scrolling for it.
- **Dark Desk** shows the drawn rail — the files that are open, the signals worth a look, and what has been set aside — beside the file you have open, and the drawn **Decide** panel with **Start an AI follow-up** as its primary button.

### What did not move

- **Dark Desk still prints nothing.** "Nothing here prints." is unchanged and still true: the desk's own sentence, under the Decide buttons, says that "Send to the queue" files a lead for you to review.
- **Opinion still cannot be published with an incomplete appendix.** A piece whose claims and sources appendix is not filled in carries the **Claims missing** chip on its row, and the appendix error is printed on the row itself, in the same words as before.
- **Follow-ups are still lane 2's.** The **Start an AI follow-up** button is drawn, and on this base there is no `add-follow-up` component to open, so it links to `/desk/follow-ups` — the screen that owns the work — rather than promising a dialog this phase does not build.

## What changed under it

**No migration.** Every screen here is the same route over the same tables it read before; phase 2c is markup, CSS and two module-level bits of shared copy:

- `src/lib/news/search-trail-words.ts` — the words the search trail and the Dark Desk Activity log both use to describe how a run ended, so the two cannot drift apart.
- `src/desk-astra.css` — the phase-0 tokens only. No new color was introduced; the panels, chips and row shapes are the ones phases 0, 3 and 5 landed.

Three browser walks had a selector moved because the redesign moved the control it named: the rejected tab on Sources is now found as `/^Rejected /` (it read `/^Dropped /`), in `scripts/sources-desk-e2e.mjs`, `scripts/scan-desk-e2e.mjs` and `scripts/sections-source-add-e2e.mjs`. Nothing about what those walks assert changed — each still adds, drops and restores a real source, or batches two real leads, through the real form.

## Limits

**Two headers keep their words rather than the drawing's.** Opinion and Published already match their drawings; **Sources** is drawn as "Sources & scan" and **Server & newsroom** as "Server". Both are unchanged. The rail in `desk-chrome.tsx` — another lane's file — still reads "Sources" and "Server", so retitling only the page heading would make the rail and the page disagree; and `scripts/desk-flows-e2e.mjs` waits on a level-1 heading named exactly "Server & newsroom". Both are listed in the phase-2c report rather than changed here.

**The drawn Server cards are summaries; the built ones are the working panels.** The drawing shows eleven compact cards; the README requires that `/desk/ops` keep everything it has today, so the panels keep their controls, notes and states and are balanced two-across instead of pairing into the drawing's short rows. Same for **More ▾** on Published: the row keeps reading, rewriting the headline, posting a correction and taking a story off the paper on the row itself, because those are the four things the screen is for, and files the two rare ones — legal removal and an open evidence review — under **More ▾** as drawn.

**The evidence was taken on an empty desk.** The browser pass for this phase ran against an in-memory database with no newsroom data, so the captures show each screen's zero states and its layout, not real rows: no editorials, no published stories, no scans, no open Dark Desk file. What is proven is the shape of every screen at 1280 in light and dark and at 390 in light, with no sideways overflow, nothing under the 14px floor and no button under 44px tall.

**`/desk/dark` has no honest light build.** The route passes the night flag, as it did before this phase, so its light capture and its dark capture are the same page. That is the desk's own rule — investigations print nothing and the screen is not themed for daylight — not a phase-2c change.
