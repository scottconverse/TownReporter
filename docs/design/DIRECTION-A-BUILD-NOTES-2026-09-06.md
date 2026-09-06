# Direction A — build notes (2026-09-06)

The design is the clickable prototype (`prototype/editors-desk-redesign.html` in the audit package; artboard `Main.dc.html`). Build that. This note covers only what the prototype does not show.

Auditor's verdict (2026-09-05): use this system; take from the Codex prototype only **more air in the queue** and a **Follow-ups list on the rail**. Nothing else changes hands.

## Stage plan

1. **Command Center** in direction A: masthead + nav as today; "Needs you" as a slim strip under the nav; composer at the top of the main column; the queue as the lead column; right rail = Dark Desk, then Follow-ups, then The wire. Airier queue rows. Follow-ups object.
2. **Story page** as in the prototype's story view: left aside (lead, sources, reporting notes with the claims-of-absence block), right work area. Mostly exists; align spacing and the notes pane to the prototype.
3. **Narrow layout** for both, per the rules below.
4. Other tabs unchanged this pass.

## Airier queue rows

- Row anatomy, top to bottom: headline (Fraunces 600, scale 15.5px) · why line (body) · meta line (topic · age · origin) · actions row (Open · Hold · Kill, plus The piece when it matches a printed story) · matches line when present. Chips (NEW / HELD / ≈ PRINTED / seen again) sit top-right; the score badge sits left, aligned to the headline's first line.
- Vertical rhythm: 18px above the headline, 6px headline→why, 8px why→meta, 10px meta→actions, 18px below. Rows separated by a 1px rule in `--line`. No boxes.
- Nothing is removed from the row. Air comes from rhythm, not from hiding.

## Follow-ups (new object, on the rail between Dark Desk and The wire)

Purpose: the people the editor has asked and what they owe. Today this lives only inside a story's reporting notes ("People who still need to respond"); it needs one place.

- Section title "Follow-ups · N" with a quiet link "All follow-ups" (a filterable list page at `/desk/follow-ups`, stage 1 may ship the rail block and a simple list page).
- Each item: **who** (e.g. "City Manager's office") · **for what** (one line, e.g. "cause report on the 15th Avenue explosion") · **due** ("due Tue Sep 9" / "due today" / "**Overdue 3 days**" — overdue is stated in words and set in `--warn`; never colour alone) · the story it belongs to, as a link.
- Actions per item: **Record reply** (opens a small form: what they said, date; saves to the story's reporting notes and marks the follow-up answered) · **Nudge** (marks a reminder sent, stamps the date) · **Drop**.
- Creation: from a story's reporting notes ("People who still need to respond" → "Add a follow-up": who, for what, due date), and from the Investigation "Seek a response" decision when that ships. Stage 1 seeds from existing notes where a due date can be inferred; otherwise items are created by the editor.
- Data: a `follow_ups` table (newsroom-scoped: id, newsroom_id, lead_id/article_id, who, what, due_on, status open|answered|dropped, nudged_at, answered_at, reply_text, created_at). Forward migration only. Guarded by the newsroom-scoped-inserts test.
- Empty state: "No one owes you an answer right now." with "Add a follow-up" (from a story).

## Narrow layout (laptop and below)

- ≥ 1180px: two columns as designed (main `minmax(0, 1fr)`, rail 360px, gap 40px).
- 900–1179px: rail narrows to 300px; queue row actions may wrap to two lines; nothing hides.
- < 900px: single column. Order: Needs you · composer · queue · Follow-ups · Dark Desk · The wire. The rail sections become full-width blocks with their titles; the nav folds behind the existing Menu button (≤720px rule stays).
- Story page: two columns ≥ 1024px; single column below, aside first, then the work area (the existing ≤720px `<details>` for notes stays, but at 721–1023px the aside is simply stacked above).
- Test at 1440, 1280, 1024, 900, 762, 390 wide. No horizontal scroll at any width. All buttons ≥ 44px tall; at ≤720px, small buttons ≥ 40px.

## Rules that bind every stage

- WCAG AA in both themes (`node scripts/contrast-audit.mjs` passes). Black on white in dark mode.
- Nothing informational under 14px at Normal (`scripts/desk-min-font.test.mjs` passes). Large scales everything the editor reads.
- One button family, one chip family, one notice. Reuse `.btn`, `.chip`, `Notice`, `.f`.
- Quiet styling never carries meaning alone.
- Every stage: PGLite tests green, CI 14/14, staged on real data, walked in dark + light and Normal + Large at 1280 and 900 wide, then the owner's go before promote.
