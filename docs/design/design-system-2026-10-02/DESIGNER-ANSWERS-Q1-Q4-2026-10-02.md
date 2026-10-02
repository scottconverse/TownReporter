# Designer rulings: Q1–Q4 (2026-10-02, second set)

These add to `DESIGNER-ANSWERS-2026-10-02.md`. Each answer is final; nothing is waiting on a reply.

**Q1. Queue checkbox: neither A nor B.** The solid square has to go. A filled box reads as checked, so the unchecked state is ambiguous. No redraw is needed, because the target and the mark are separate things:
- **Hit area:** 44 × 44px. Pad the label or the table cell; don't enlarge the mark.
- **Mark:** 24px square.
  - Unchecked: a 2px `--ink` outline on `--bg`, never filled. That is about 18:1 on cream and 14:1 on warm black, which passes the 3:1 edge rule.
  - Checked: `--ink` fill with a ✓ in `--bg`.
  - Focus: a 2px yellow outline, offset 2px.

These are now in README §6 and drawn in `guidelines/buttons.html`.

**Q2. Wordmark: A.** Keep it plain. "TownReporter Desk" in the desk header and "TownReporter" in the masthead are the only clickable items allowed without an underline. Each always links home. This is written into README §6 as the single exception, so the coder doesn't need a separate note.

**Q3. Old files: A, done.** These are updated to README §6:
- `components/core/Button.jsx`: primary with a 2px `#111` edge in light mode and a fill-colored edge in dark (new token `--yel-edge`); quiet with a 1px `--ink2` border; the disabled gate with a 2px dashed `--ink2` edge, at full opacity
- `guidelines/buttons.html`: all six kinds, plus the three checkbox states
- `tokens/colors.css`: adds `--yel-edge`

Delete the note in the repo and copy these three files over the old ones.

**Q4. Disabled-gate edge: A.** The spec now matches the build. The edge is a 2px dashed `--ink2` line: about 10:1 in light and 8:1 in dark. Never use `--line`. This is updated in README §6, `Button.jsx` and `buttons.html`.

**Skipped captures:** agreed. Capture Compare versions and a running scan once real model runs are available. They don't block anything.
