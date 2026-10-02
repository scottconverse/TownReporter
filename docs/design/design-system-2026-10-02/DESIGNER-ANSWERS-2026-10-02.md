# Designer's answers (2026-10-02)

These reply to `QUESTIONS-FOR-DESIGNER-2026-10-02.md` and `BUILD-VS-DESIGN-CONSOLIDATED.md`. Each answer is a decision. Build to it unless the owner overrules it.

## On the consolidated findings

**Your figure of 55–60% is the right one.** My report (`DESIGN-VS-BUILD-REPORT.md`) was too generous: I reviewed sample screens, while you read every one. Treat your 26 blocking items as the list to fix, plus my B2, the story workbench typography: the headline is at about weight 500 instead of 800, and the story text is in Bricolage instead of Literata. Your list doesn't include that one.

Rulings on your list:

- **Text that acts as a button.** Your pattern finding is correct, and the design is partly to blame. The rule from now on:
  - **If it does something, it's a button.** That means one of the four button styles.
  - **If it goes somewhere, it's an underlined link.**
  - **Never plain text.**

  Convert every case you listed: "What is in the piles", "More from the wire", "+ Add a claim", "change", "Review now", "Story details", "Set up a writing model" and "Back to the paper". The button spec is updated in `design-system/README.md` §6.
- **Phone menu:** a labelled **Menu** button (Quiet style, 44px), not a bare hamburger with a "Desk" chip.
- **Chips:** sentence case, as drawn. No ALL CAPS.
- **"Run scan now"** on Today's rail: Secondary. The page's Primary is "Review leads".
- **Long lists:** cap every list and rail group at 5 rows (25 on the four main list pages), with "Show all N". That covers the Dark Desk rail, model lists and saved reports. Dates in lists read "Oct. 2, 6:43 a.m.", never ISO.
- **Prose walls (Stats privacy text, "Where readers are"):** one sentence, then a "How we count ▸" disclosure. For an unmeasured metric, a single line: "Not measured: we don't look up locations."
- **Correction and Legal removal:** both are pop-ups, as drawn. Legal removal must be a pop-up because it needs the typed REMOVE and the choice of what to keep. Correction stays a pop-up so the reader preview has room.
- **Story Sources tab:** build it as drawn. One row per record, showing the chip (Opened / Could not open / Changed), "Captured" and "Original" links, and "+ Add a source". A raw URL list is not acceptable.
- **Story Reporting tab:** build it as drawn, including the AI follow-ups block. On phones the tab panel sits directly under the tab bar, not at the bottom of the page.
- **Phone tables** (Published, Stats stories, Models): below 700px each row becomes a stacked card, keeping every column as a labelled line ("Views 412 · Corrections none"). Don't drop columns.
- **Drawing flaws not to copy:** agreed on all three. I'll fix them in the drawings:
  - the clipped "Story: … last ru" line on Follow-ups at 390
  - the clipped counts on Stats at 390
  - the stacked Reset/Save on Models

## Your seven questions

**1. Buttons.** Yes, adopt the build's values. They are now the spec:
- **Quiet:** a 1px border in `--ink2` (`#3a3a3a` light, about 10:1; `#bdbab3` dark, about 8:1).
- **Primary:** a 2px `#111` edge in light mode. In dark mode the edge matches the fill, since yellow on warm black is already above 3:1.
- **Never** use the `--line` rule color as a button edge.

**2. "Around the region."** Fill it from our own published stories only, not outside feeds:
- **What qualifies:** stories tagged with the same geography the pills filter on, Nearby, Boulder County or Colorado, so never Longmont.
- **What shows:** the latest 4, one per row: place tag, headline, date.
- **Fewer than 2 qualifying stories:** hide the block and let Opinion take the full width. This is what the build does now, so with no data the current build is correct.

**3. "Scan the wire" in the rail.** Remove it from the rail. Scanning lives on Sources & scan. Put a Quiet button, **"Scan history →"**, in the Sources & scan header, opening `/desk/scan`.

**4. Server cards.** A two-column CSS grid, with cards placed left to right in rows in the drawn order and aligned to the top. No masonry, no independent columns, because the editor reads the cards in pairs. One column below 1100px.

**5. The "Ready to check" chip.** Use the neutral state chip: a 1px `--ink2` border, ink text, sentence case, reading **"Ready to check"**. It is not yellow; the row's Check button carries the yellow. Use the same chip for "Ready to edit" and "Ready to print".

**6. Dark Desk extras.**
- **Placement:** add a Quiet **"Settings"** button in the Dark Desk header. It opens a panel at the top of the work area with two sections:
  - **How hard to dig:** the defaults for new files.
  - **Watched pages:** the list, plus "Watch a page".
- **When a file is open,** its own depth shows in the Scope · Depth · Limit strip, as drawn.
- **Default view:** open the most recently touched file, never "No file open" while any file exists.
- **Rail:** keep the drawn order, Open files, Signals to review, Waiting on an AI follow-up, Set aside, each capped at 5. "Waiting" must be there.

**7. Release and Compare versions.**
- **Release has no pop-up, by design.** On a Held row, Release moves the lead straight back to Open, and a toast offers "Released · Undo". The hold reason is already on record. If the build shows no Release button on a held row, that's a bug: every Held row needs Release, plus More ▾.
- **Compare versions is drawn.** See `screens/dialogs/12-compare/`. Open it from Published → More ▾ → Compare versions, and from the story's Checks tab ("Compare checked vs. previous version"). It needs a story with at least 2 captured versions. When there's only one, show the item disabled with the reason "Only one version so far".

## Still needed from you

Recapture these:
- every file that landed on `/login`
- the Redraft pop-up
- each job card state
- Follow-ups with items
- a running scan
- Compare versions, once a story has 2 versions
