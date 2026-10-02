# TownReporter design system (2026-10-02)

The owner's reference for all visual work on the paper and the desk. Start with `design-system/README.md`.

- Source: "TownReporter redesign directions (9)" zip from the designer, 2026-10-02. Files are unchanged.
- Rules in short: nothing informational under 14px; targets 44px or more; one yellow, with #111 text; no shadows, gradients or rounded cards; every state written in words; dark `#1b1916`, cream `#fffdf7`.
- Fonts: Bricolage Grotesque and Literata (woff2, in `design-system/fonts/`).
- Order of authority: the owner's instructions, then `docs/design/handoff-2026-09-26/DECISIONS.md`, then this folder, then the drawings.
- Reference screens: the designer's `design-system/README.md` names `design_handoff_townreporter_v3/design/*.dc.html` and `screen-captures/`. Those paths are the designer's; in this repository the same material is at `docs/design/handoff-2026-09-26/design/*.dc.html` and `docs/design/handoff-2026-09-26/screen-captures/`.
- This folder is reference only. The app does not import it.

## Read this before copying components

- `design-system/README.md` section 6 (Buttons) governs. It was updated on 2026-10-02: Primary has a 2px `#111` edge in light mode, Quiet has a 1px `--ink2` border, and the Disabled gate edge should clear 3:1.
- `design-system/components/core/Button.jsx` and `design-system/guidelines/buttons.html` still draw the older buttons (Primary with no edge, Quiet with a `--line` edge). They predate section 6. Do not copy those two files into production as they are. The designer has been asked for updated versions (see question 9 in `reports/QUESTIONS-FOR-DESIGNER-2026-10-02.md`).
- The compare-versions drawing lives at `docs/design/handoff-2026-09-26/screen-captures/dialog-12-compare.png` (source `docs/design/handoff-2026-09-26/design/Desk Dialogs.dc.html`).

## Reports (the fix list)

`reports/` holds the comparison of the built desk against these drawings, from 2026-10-02:
- `BUILD-VS-DESIGN-CONSOLIDATED.md`: the auditor's list of 26 blocking gaps.
- `DESIGN-VS-BUILD-REPORT.md` and `RECAPTURE-ADDENDUM-2026-10-02.md`: the designer's reports.
- `QUESTIONS-FOR-DESIGNER-2026-10-02.md`: the open questions. The designer's answers are in `DESIGNER-ANSWERS-2026-10-02.md`.
