# Is the built TownReporter close to the designer's v4 drawings? (build main 881cbfe8, dev copy, owner login, live-data copy)
Production untouched (live on 881cbfe8). Read-only comparison. Method: 151 desk/paper side-by-side sheets + 41 dialog sheets + undrawn contact sheet, 7 independent image reviewers, every slice read. Percents are rough, by eye.

## Answer: partly. Not close enough to call matched.
| Area | Desktop | Phone |
|---|---|---|
| Today + Queue | ~72% (Queue 85, Today 65) | ~62% |
| Lists (Drafts, Published, Opinion, Follow-ups) | ~70% | ~65% |
| Story tabs (Checks, Sources, Reporting) | ~55% (light only) | ~45% |
| Dark Desk, Sources, Models | ~45% | ~40% |
| Server + Stats | ~70% | ~55% |
| Public paper (front, article) | ~68% (front 55-60, article 80) | ~62% |
| Pop-ups | ~55% | - |
| First-time pages (sign-in, setup, scan, import...) | ~30% | - |
Overall: about 55-60% match. The frame (nav, header, chips, tokens, yellow primary) matches. Missing content is what hurts.

## Blocking (26)
Today: A1 no "Running now" section / empty state.
Lists: C14 phone Published rows lose "views" / "Corrections" labels; C18 Opinion rows centred in a card.
Public: F1 "Around the region" block missing.
Story: B1 dark desktop not captured (re-shoot); B2 phone tab panel at page bottom; B3 Sources tab = one raw URL (no record rows, chips, Captured/Original, Add); B4 Checks rail lacks meta line + Compare button; B19 Reporting tab missing drawn sections + AI follow-ups.
Dark Desk/Models: D1 no case file (always "No file open"); D2 rail ~2800px; D3 extra blocks, "Waiting" group missing; D20 Models table unusable at 390; D21 selects look like plain text; (D22 Reset/Save look disabled).
Server/Stats: E16 privacy wall of text; E17 "Where readers are" empty-state prose; E32 phone stories table not reflowed (2 columns lost).
Pop-ups/pages: G1 phone footer buttons cut off; G2 Correction not a dialog; G3 Legal removal not a dialog; G4 Compare/Release not reached; G14 sign-in stub, light only; G15 setup unreachable; G20 Legal removals no case list; G24 empty/error states not captured.

## Pattern behind many Visible items (ties to the owner's complaint)
Text that acts as a button but looks like text: "What is in the piles", "More from the wire", "+ Add a claim", "change", "Review now", "Story details", "Set up a writing model", two "Back to the paper" lines. Faint dark-mode outlines on quiet buttons (Hold, All sources, More). "Run scan now" yellow when drawn secondary. Same product-wide: bare hamburger + "Desk" chip on phone instead of labelled "Menu". Overlong lists and prose with no cap (Dark Desk rail, model lists, Saved reports ~27 rows with ISO dates, Stats prose). Chips ALL CAPS vs drawn sentence case.

## Could not judge
Job-card states (no running/failed jobs), follow-up rows, Compare versions, Release, setup flow, error/empty/unsaved states, exact font px (measure in browser), whether story headlines on Stats are links, 1440-dark of story tabs (signed-out capture).

## Drawing flaws not to copy
Clipped "Story: ... last ru" line (Follow-ups, 390); clipped counts on Stats 390; Reset/Save stacked quirk (Models).

## Per-report files (same folder)
report-A-today-queue.md, report-B-story-tabs.md, report-C-lists.md, report-D-dark-sources-models.md, report-E-server-stats.md, report-F-public-paper.md, report-G-dialogs-undrawn.md
