# Open questions for the designer (2026-10-02)
1. Buttons (README section 6): Quiet edge is 1.4:1 and Primary has no edge (1.3:1 on cream). Owner reports actions that look like text. Build uses 1px ink-grey Quiet (about 10:1 light, 8:1 dark) and a 2px ink edge on Primary. Update the button spec to these, or give another way to reach 3:1?
2. Public "Around the region" block (drawn): no data source exists. What should it show and where do items come from?
3. Extra "Scan the wire" nav item under Sources & scan: keep or remove (not drawn)?
4. Server cards: drawing pairs cards in rows; build uses two columns. Which one?
5. "Ready to check" chip: no drawn style. Which?
6. Dark Desk extras not drawn (Watched pages, "How hard to dig"): where do they go?
7. Release dialog: not drawn in the sheets we got; Compare versions not reachable in build. Confirm the design.
Pack to give the designer: (local file)
Findings: (local file)
8. (added 9:20 AM) README section 6 draws the Disabled gate (e.g. Publish before checks pass) with a plain dashed --line edge (about 1.4:1). The build uses the darker --fg2 dashed edge so it clears 3:1. Update the spec to --fg2?
9. (added 10:05 AM) `design-system/components/core/Button.jsx` and `design-system/guidelines/buttons.html` still draw Primary with no edge and Quiet with a `--line` edge. Please send updated versions that match README section 6, since SKILL.md tells people to copy these files.
