# v3 change log, keyed to REVIEW-v2b-for-designer-2026-09-26

Every item in the developer review, with what changed and where. The prototypes in `design/`, the components in `design-system/` and all 52 captures in `screen-captures/` were updated and retaken.

## A. Owner decisions

| # | Fixed | Where |
|---|---|---|
| A1 | The human “Seek a response” step is gone. Decide row: **Start an AI follow-up** (an agent watches for a public statement or record). The pile is renamed **Waiting on an AI follow-up** (“AI watching for a public notice”), and the case-file row is **AI follow-ups running**. The Today rail pile, the canvas text and the README spec match. | `Desk Screens` (Decide row, piles, case file), `Desk Command` (rail), `Desk Directions` (Screen 5), README §7. Captures desk-01/02/03/15/16 |
| A2 | Legal removal now makes the editor pick the text rule **before** confirming: **Keep a sealed copy for 12 months (default)**, owner-only and deleted automatically, or **Keep nothing: a court order requires destruction**. The footer explains the restricted record. DECISIONS and KICKOFF (open question 4 is answered) are updated. | `Desk Dialogs` (legal), DECISIONS “Added in v3”, KICKOFF open questions. Capture dialog-15 |
| A3 | **Load a model** and **Pull a model** are removed. They are now **Open LM Studio ↗** and **Open Ollama ↗**, which hand off to those apps; the paper never loads a model. | `Desk Models`, README §10. Capture desk-27 |
| A4 | The third Redraft choice is **Start fresh from the records · Your headline is kept**. | `Desk Dialogs` (redraft), README dialogs table. Capture dialog-04 |
| A5 | Stats now ends with **Section chosen by hand** (a count and an explanation) and **Saved reports** (Save latest reports, then daily/weekly/monthly rows with Read report). | `Desk Stats`, README §12. Captures desk-25/26 |
| A6 | **Remove permanently** uses the danger style (red outline), not yellow. | `Desk Dialogs` (`danger: true` → primaryStyle). Capture dialog-15 |

## B. App parity (answers to your questions)

| # | Answer and change |
|---|---|
| B1 | **Yes.** Kill (dialog and toast) says “Moves to Killed. The reason stays with it, with the time and any link.” The footer and README match. Server “Recently deleted” now lists drafts only, and notes that killed leads stay under Killed. |
| B2 | **Yes.** The 4 presets are **quick fills** into **Reason in your words**, plus an optional **Link** field. |
| B3 | **Yes, keep the app’s behavior.** The dialog has **What was wrong / What is right**, a story-text choice (**Leave the story text as is (default)** / **Also fix the story text**), **Suggest wording (AI)** as the alternate button, and **Post as a plain note** as the primary. |
| B4 | **Name: Suggested sources.** The filter reads “Suggested · 175”, and Ask-AI results land in Suggested sources with why and who found each. The review list isn’t drawn; build it from the style guide (list rows like Sources, with Accept/Reject as secondary buttons and the reason in Literata). |
| B5 | **Keep all 12 panels in the same grid.** Added Sections, Daily scan, Meeting capture, YouTube (API key), Routine notices, Named outlets, Editors & access and Time budgets. |
| B6 | **Yes.** A **Style** row under Checks, below names: “! Style: 3 issues”, measured in code, with **Fix these with the model**. |
| B7 | **Two sizes: Normal and Large.** Large (1.2×) scales headlines, deks and body. This covers `tokens/typography.css`, the article prototype (`textSize: normal/large`) and the style guide. Capture paper-08 shows the larger headline. |
| B8 | **Later ideas, hidden for now.** Hourly and weekly source checks are removed (sources are checked in every daily scan). The Hold reason now says “You release it when the record arrives.” KICKOFF lists both as later ideas that aren’t built. |

## C. Defects

| # | Fixed |
|---|---|
| C1 | Every listed control is now at least 44px (the story-page stage stepper stays 40px: it is a status display, not a control): the `JobCard` component, `Desk Job` (5 controls), the Queue bulk bar, the article jump links, and the paper top-bar links (now a 44px flex). |
| C2 | desk-23/24 retaken. The selects now show the real per-job defaults **and** effort levels (the prototype had shown the first option in every box). |
| C3 | The story context line wraps instead of being cut off. ▾ no longer wraps (Writer, Effort, Sort, Section). The bulk bar has space above it, so Section isn’t hidden. Published columns have fixed widths, so the headings line up. The article **TR** badge is yellow with `#111` text in both themes. The Dates panel day column is wider and doesn’t wrap “Oct 8”. The compare time is 8:31, after the 8:20 save. The headline footer reads “Claude Haiku · high”, matching the Effort box. |
| C4 | A new `--sel` token is the selection marker: **ink in light, gold in dark**. It’s used by the nav active item, the selected lead row, the story tabs and the Dark Desk file list, in the prototypes and in the `LeadRow` / `DeskNav` components. |
| C5 | **Intended.** Choice cards stay square (the system has no round shapes). They are single-choice, and `ChoiceCard` already renders `role="radio"` with `aria-checked`; build them as radio groups. |
| C6 | The design-system README points to `design_handoff_townreporter_v3/`. |
| C7 | `Front Daily` sets `--soft` from the dark ground, so the region rules use warm `#3b3631`. `--soft` is also now a design-system token. |

## D. For the owner
KICKOFF open questions 1, 2, 3, 5 and 6 remain the owner’s. Question 4 is answered (A2).

## Verified after the changes
- All 12 prototypes load with no console errors. `Desk App` wiring was re-run: nav, Add a lead, Hold, Kill, the story actions, legal removal, Models.
- All 52 captures were retaken from the updated prototypes and stitched full length. Spot-checked: dialog-15 (rule choice, red Remove), desk-23/24 (real model and effort defaults), desk-01 (AI follow-ups rail).
- The 15 components still render in the browser test page.
