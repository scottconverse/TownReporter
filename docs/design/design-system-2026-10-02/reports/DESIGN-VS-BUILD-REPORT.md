# Design vs. build: comparison report

- **Built app:** `main` at `881cbfe8` (0.6.82), the staging copy, signed in as owner. Captured 2026-10-02 by the HALO auditor.
- **Compared against:** the v4 design screenshots in `screens/`.
- **Side-by-side images:** `comparison/`. In each pair the design is on the left and the build on the right, unless the file name says otherwise.

## Summary

The build is close to the design. Colors, fonts, the paper, the Today screen, Server, Queue, Published and the desktop pop-ups all match the drawings in structure and style.

- **Horizontal overflow:** none in any of the 524 captures; every page measured 0px.
- **Accessibility (axe-core):** one moderate finding on 30 desk screens, `heading-order` on Models → Connections.

The real problems are in four places:

1. **Phone pop-ups.** The main button runs off the right edge.
2. **Story workbench typography.** The headline and story text use the wrong font and weight.
3. **The Opinion list.** Its rows are centered instead of laid out as a table.
4. **Lead rows.** On Today and Queue the title column is so narrow that rows grow two to three times taller than drawn.

Below are 3 blocking, 11 visible and 7 minor differences, followed by the captures that need redoing.

## Blocking

**B1. Phone pop-ups push the main button off-screen** (390px). Seen on Hold, Kill and Headline, and likely on every pop-up with three buttons. "Hold with this reason", "Kill with this reason" and "Use this headline" are cut off at the right edge. → `comparison/15-dialogs-phone-overflow.jpg`

*Fix:* let the dialog's button row wrap: `display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px`, with `max-width:100%` and no `nowrap` on the row. This is the same fix made to the v4 design (`design/Desk Dialogs.dc.html`).

**B2. The story workbench uses the wrong type** (`/desk/story/<id>`, every width).
- **Headline:** set at about weight 500. The design uses Bricolage Grotesque 800.
- **Story body:** set in Bricolage Grotesque. The design and the locked decisions use Literata for body text.
→ `04-story-headline-weight.jpg`, `05-story-body-font.jpg`

*Fix:* headline `font: 800 … 'Bricolage Grotesque'`. Story textarea and preview `font-family: 'Literata', serif`, 17–18px, line-height 1.6.

**B3. Opinion list rows are centered** (`/desk/opinion`). The title, meta line and buttons are centered in the row, and the status chip sits apart on the left. The design is a left-aligned row: chip, then title and meta, with actions on the right. → `08-opinion-centered-rows.jpg`

*Fix:* the row probably lost its grid template and is inheriting `text-align:center`. Use `grid-template-columns: auto minmax(0,1fr) auto; text-align:left`.

## Visible

**V1. Lead rows are too tall** (Today "New leads" and Queue, at 1440, 1024 and 900). The title and summary column is about 270px wide at 1440, compared with about 390px in the design, so each row wraps to 6–10 lines. In the Queue, "Start story" wraps onto two lines. → `01`, `06`, `18`

*Fix:* row grid `auto minmax(0,1fr) auto`. Give the text column all the free space, and keep the actions `white-space:nowrap` on one line, wrapping below the text under 1280px as drawn.

**V2. Raw section keys on the desk.** Today, Queue and Published show `health-human-services`, `arts-culture`, `county-region` and `misc` instead of "Health & human services", "Arts & culture" and so on. The public paper already shows display names. → `06`, `07`

*Fix:* use the section display name on desk rows, the same lookup the paper uses.

**V3. The Models assignment table** (`/desk/models`). The model and effort selects have no visible box; they read as plain text with a chevron. The last column shows "Default / Automatic" where the design shows a readiness chip ("✓ Ready", "! Slow", "Key rejected"). → `09-models-selects.jpg`

*Fix:* use bordered selects at a 44px minimum height, and show the resolved model's readiness chip in the last column.

**V4. Dark Desk opens on "No file open."** The design opens the top file in the workspace. On this data the left column is a long stack of 7 open files, 5 signals and 3 set aside, each with its own More button, and the right side stays empty. → `10-dark-desk-1440-light.jpg`

*Fix:* open the most recently touched file by default. Cap each left group at 5 with "Show all N".

**V5. The story page adds two blocks above the headline.**
- A red dashed "Draft saved — review required" banner, which repeats what the Checks tab and sticky bar already say.
- A "Story direction for AI" text box.

Together they push the headline below the fold at 1440. → `03`

*Fix:* drop the banner and let the sticky bar carry it. Move "Story direction for AI" into the Redraft dialog or under "Story details ▸".

**V6. The sign-in page is barely styled** (`/login`).
- Labels sit beside small inputs instead of above them.
- There is no masthead.
- The form sits in an empty page.
- The first-owner panel is missing.

→ `19-login-built.jpg`; the design is U1 in `design/Undrawn Pages.dc.html`.

**V7. Legal removals is a 126-row checklist.** The page lists every published article as a checkbox, with no search, before you get to the case controls. → `20-legal-removals-built.jpg`

*Fix:* follow U7. Show the case list first, and start a new case from a story (Published → More → Legal removal) or a search box, not the full list.

**V8. Scan history is a wall of text** (`/desk/scan`). Each past run prints a dense multi-field block, so the page runs to many screens. → `21-undrawn-built-a.jpg`

*Fix:* one row per run (time · scope · fetched · leads filed · status chip), with details behind "Open", as in U3.

**V9. The front page has no "Around the region" section.** Opinion runs as a full-width yellow band instead of sitting beside it. If the section is hidden because there are no nearby stories, that is correct. Otherwise restore it. → `16-paper-1440-light.jpg`

**V10. A "This week" fragment remains.** "Brighton event for 3C and 3D" still shows on the front page. The name rule in `src/lib/story-dates.ts` should fall back to the story headline. → `17-front-top-built.jpg`

**V11. Desk on phones: the step strip is one card per row.** The design is a 2×2 grid, and the single column doubles the height of the top of Today. → `13-phone-today-queue-story.jpg`

## Minor

1. **Server, Opinion, Sources and Models** add an explanatory sentence under every heading. The design has none (the restraint rule). Keep at most one line per page.
2. **At 1440 on the paper,** the masthead and nav are inset 100px while the body content is inset 40px. Use one gutter.
3. **Every Sources row** adds the line "N killed from this source, none for a bad source." Show it only when the count is above 0.
4. **Truncated labels:** "Effort…" on the story Writer bar, and the Queue search placeholder ("Search leads, plac").
5. **Lead titles carry machine text:** `(2026-10-02T11:55:43Z)` and a `[discovery]` prefix. Strip these at filing.
6. **"Skip to desk" shows** mid-page in the phone pop-up captures. The skip link should stay hidden unless it has keyboard focus.
7. **Models → Connections:** heading-order (axe, moderate). Fix the heading levels.

## Matches the design

- **Tokens and fonts:** color tokens in both themes, the yellow accent and text on yellow, and the self-hosted fonts.
- **Today:** the step strip, Tonight's edition chips, the In progress grid and the right rail. The Running now section is missing only because no job was running.
- **Desk screens:** Server (all 12 cards), the Queue table and filters, the Published table, and Stats (privacy wording instead of location bars is correct).
- **Desktop pop-ups:** Hold, Kill, New story, Start an AI follow-up and Headline.
- **Public paper:** the front page (masthead, pills, lead, This week, story grid, Latest stories, footer) and the article (Dates in this story, How we reported this, Corrections & accountability, Keep reading).
- **No horizontal scroll** anywhere, and no axe contrast or target-size failures.

## Captures to redo

Without these, the comparison is incomplete for those screens.

1. **78 captures landed on the sign-in page** after the session expired. That covers story screens 02–04 at 1024, 1280 and 1440, and every desk screen at 1024 in dark. Re-sign in and recapture any file where `landedAt` is `/login` in `manifest.json` or `manifest-recapture.json`.
2. **The Redraft pop-up** (`dialogs/05-redraft`) shows the story page, not the pop-up.
3. **Not captured at all:**
   - the job card states: running, stalled, failed, cancelled and done
   - the Compare versions and Release pop-ups
   - Follow-ups with active items
   - a running scan

   Set up one of each, as listed in `REQUEST-FOR-BUILD-SCREENSHOTS.md`.
4. **A story with blockers.** Lead 326 has no open blockers, so the Checks tab, with its own button per blocker, wasn't exercised. Use a draft with at least two.

## Order of fixes

1. B1, B2, B3
2. V1, V2
3. V3, V5, V4
4. V6–V8
5. The minor items, together in one pass

Recapture the affected screens after each group.
