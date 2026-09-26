# Review log (2026-09-26)

What was checked before handoff, and what was fixed.

## Checks run
- **React components (15):** all compile, and all render in a browser test harness. 24 cases covered every variant and state: button variants and the gated state, every chip kind, the dark panel, the score thresholds, the evidence meter, lead rows (selected and killed), job cards (running, stalled, done, failed and compact), the dialog with its choice card, the nav with the Running box, and every paper component. **0 errors.**
- **Prototype wiring (`design/Desk App.dc.html`):**
  - every side-nav item was clicked and loaded the correct screen: Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk, Sources & scan, Models, Server, Stats
  - each dialog was opened and exercised:
    - Add a lead (open, ✕ close, submit starts a job)
    - New story (3 tabs; Write it myself shows its fields; Save draft)
    - Hold (reason dialog, “Hold, no reason” marks the row Held)
    - Kill (the same, then Undo appears)
    - Start story (the job appears under Running now) and Run scan now (a scan job)
    - on the story page: Suggest 3 headlines (with the write-your-own field), Check draft against evidence (a live job card), Redraft, Add to story, Compare versions
    - More ▾ on a published story, then Legal removal (the type-REMOVE confirmation)
    - Add a source, then Paste a list (preview table)
    - Start a Dark Desk file, then Open the file (starts a job)
    - New AI follow-up
    - on Models: the job selects, Add a connection and the Connections tab
  - the Light/Dark toggle works
- **Other prototypes:** Front Daily, Article Daily and Desk Directions load with no console errors or warnings.
- **Documents:** every file path named in START-HERE, KICKOFF, README, DECISIONS, RESEARCH and the design-system README was checked against the package. All exist.
- **Package sync:** the `design/` and `design-system/` copies match the latest source files.

## Fixed during review
- `Panel` read `document` at render time, which would crash server-side rendering in TanStack Start. It now uses the `--block-ink` token.
- `Dialog`: Escape now closes it (the production version should still use Radix).
- `LeadRow`: clicks on action buttons no longer also select the row; the actions wrap on narrow widths.
- Added `tokens/base.css` with the focus-visible ring, link and body defaults, and selection color, and imported it from `styles.css`.
- Prototype dialogs: an empty footer no longer logs a runtime warning.
- `START-HERE.md`: corrected the prototype count (12 plus runtime), updated caveat 3 to the real test status, and added “Not drawn: how to handle them” (desk phone layouts, secondary pages, loading/empty/error states, shortcut sheet, toasts).

## Found after the first download
- The repo’s `.gitignore` ignores every `screenshots/` folder, so a commit left out all 52 captures. The folder is renamed `screen-captures/`, all 57 links in the docs are updated, and a file-count check (137) is now in START-HERE.

## Second full review (after the owner asked for a line-by-line recheck)
- **Inventory:** 137 files (52 PNG, 65 design-system, 13 design, 7 docs). No empty files. Every copy in `design/` and `design-system/` is byte-identical to the source.
- **Repo `.gitignore` checked line by line:** only `screenshots/` (renamed to `screen-captures/`) and `artifacts/**` (everything except `.md`) affect this package. START-HERE now says to commit it under `docs/design/handoff-2026-09-26/`.
- **Contradictions with owner decisions, fixed in the prototypes and re-captured:**
  - Today’s rail showed a *human* follow-up list (Record reply / Nudge). It now shows AI follow-ups with their state, result and actions (desk-01, 02, 03).
  - The story Reporting tab showed “People who still need to respond.” It now shows the story’s AI follow-ups and “+ New AI follow-up” (desk-05).
  - Grok appeared as a selectable model on Models, Server and Add a connection. It is now removed from every picker and shown as “Retired” in Connections only (desk-21, 22, 27, dialog-16).
  - The Desk Directions canvas text for Follow-ups described the old human workflow. Rewritten.
- **Component notes:** all 15 `.prompt.md` files now start with a one-line what-and-when, then usage, then props and rules. 8 of them previously started with a code block.
- **Tokens:** `--soft` was used by the paper prototypes and the README but not defined in the design-system tokens. Added.
- **Docs:** README “Files in this bundle” was missing START-HERE.md and REVIEW.md. Added. Every link to `screen-captures/` resolves. No TODO, FIXME or placeholder text remains.
- **Wiring re-run on the packaged copy** (`design/Desk App.dc.html`, opened from inside the package): every nav item works; there are no Grok options; Retired is shown on Connections; Today’s AI follow-ups rail appears with no human reply buttons; Add a lead opens and its job starts. No console errors.
- **Removed from the project:** the old v1 folder, so only v2 exists.

## v3
See `CHANGELOG-v3.md` for every item from the developer review (REVIEW-v2b) and how it was resolved.

## Not verified here (the developer must)
- Running inside the real app: SSR, routing, the real data and the real job API.
- The contrast audit script and the min-font test against the new tokens in the repo’s CI.
- The backend work in KICKOFF A, D and E, which is proposed schema, not yet checked against the latest migrations.
