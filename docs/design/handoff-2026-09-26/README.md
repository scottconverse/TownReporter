# Handoff: TownReporter redesign (public paper + editor’s desk)

Repo: `github.com/scottconverse/townreporter` (main; read at v0.6.68, reconciled with 0.6.69–0.6.70 in v3). Prepared 2026-09-26.
Read `KICKOFF.md` first for scope, phasing and what already exists. This file is the design spec.

## Overview

A full visual and interaction redesign of TownReporter, a one-editor nonprofit civic newspaper for Longmont, Colorado:

1. **Public paper**: front page and article page in the locked “Neighborhood Daily” direction.
2. **Editor’s desk**: every desk screen reorganized around the daily run (pick leads → draft → check → publish). Real buttons everywhere, live progress on every long job, full editor control over every AI output, a per-job model assignment page, AI-driven follow-ups, and a much richer privacy-preserving Stats page.

The operating model the design assumes: **one human editor, everything else done by AI**. The editor is the gate between production and publication. No reporters, no one calling sources, no FOIA/CORA requests.

## About the design files

The files in `design/` are **design references built in HTML**. They are prototypes that show the intended look and behavior. They are not production code to copy. Recreate them in the existing TanStack Start / React 19 / Tailwind 4 codebase using its established patterns: `DeskShell`, `InkButton`, `Chip`, `Notice`, React Query polling, server functions, and so on.

How to open them: serve the `design/` folder with any static server (for example `npx serve design`) and open a `.dc.html` file. `support.js` is the small runtime they need. Start with:
- `Desk App.dc.html`: the **clickable desk prototype**. Everything in the side menu works, dialogs open, and simulated jobs run and finish.
- `Desk Directions.dc.html`: every desk screen side by side in dark and light, plus reference job states (running, stalled, failed).
- `Front Daily.dc.html` and `Article Daily.dc.html`: the public paper. Props in the file toggle `theme` (light/dark) and `phone`.

Sample content: story text on the front page and article page is real (townreporter.org, Sept. 26, 2026). Leads, drafts, follow-ups, regional headlines, stats numbers and model health states are **samples**.

**Model names in the prototype are illustrative.** The real list comes from `src/lib/news/provider-registry.ts` (Codex Astra/Sol/Terra/Luna, Claude Fable/Opus/Sonnet/Haiku, Local model, `custom:<uuid>` connections, Automatic with DeepSeek → Qwen → Codex Terra rungs). Grok is retired by owner instruction and must stay out of every picker.

## Fidelity

**High fidelity.** Colors, type, spacing, sizes, copy and states are final unless noted. Match them closely using the codebase’s components; retheme those components where they differ.

---

## Design tokens

### Color: public paper
| Token | Light | Dark |
|---|---|---|
| `--bg` page | `#fffdf7` (Cream) | `#1b1916` (Warm black) |
| `--ink` text / rules | `#111111` | `#e8e6e1` |
| `--ink2` secondary text | `#3a3a3a` | `#bdbab3` |
| `--grid` story-grid gap lines | `#111111` | `#3b3631` |
| `--soft` light rules | `#d8d3c4` | `#3b3631` |
| `--block` dark panels (This week, footer) | `#111111` | `#27231f` |
| `--blockInk` text on block | `#ffffff` | `#e8e6e1` |
| `--yel` accent | `#ffd23f` | `#e6c35c` |
| text on yellow | always `#111111` | always `#111111` |

### Color: desk (same family, plus states)
| Token | Light | Dark (default for the desk) |
|---|---|---|
| `--bg` | `#fffdf7` | `#1b1916` |
| `--panel` | `#f6f2e7` | `#27231f` |
| `--line` | `#d8d3c4` | `#3b3631` |
| `--ink` | `#111111` | `#e8e6e1` |
| `--ink2` | `#3a3a3a` | `#bdbab3` |
| `--yel` (primary action, current step) | `#ffd23f` | `#e6c35c` |
| `--ok` (supported / no change / ready) | `#1e6b34` | `#9fd4a8` |
| `--warn` (needs review / slow / expiring) | `#8a4b00` | `#f0b27a` |
| `--danger` (kill, could not check, failed) | `#b3261e` | `#f0998c` |
| `--dd` Dark Desk rail panel | `#111111` | `#0f0e0c` |

Owner decision: dark mode is warm black `#1b1916`, not pure black. This **overrides** the repo’s earlier “black background, white text” desk rule. Both the paper and the desk use it. Light is the default for the paper and dark for the desk. Both follow `prefers-color-scheme` plus the existing reader/editor toggle (`src/lib/appearance.ts`).

These tokens replace the current palettes in `src/desk-astra.css` (Astra cool grays `#182024`, etc.) and `src/reader-astra.css` / `src/styles.css`. Run `scripts/contrast-audit.mjs` against the new values; every pair above was chosen for WCAG AA.

### Typography
- **Bricolage Grotesque** (display, UI, desk): weights 500 / 700 / 800, optical size 12–96. Letter-spacing −0.02 to −0.035em on display sizes.
- **Literata** (body copy on the paper; story text and notes on the desk): 400 / 500 / 600 and italic 400, optical size 7–72.
- Self-host both in `public/fonts` and `src/fonts.css`, the way the current fonts are. The prototypes load them from Google Fonts.
- **Nothing informational below 14px** (`scripts/desk-min-font.test.mjs` must still pass).

Paper scale (desktop / phone):
- masthead wordmark 56/36 (800)
- lead headline 50/32 (800, lh 1.02)
- lead dek 20/18 (Literata, lh 1.5)
- grid headline 23/21 (700, lh 1.15)
- section heads 28 (800)
- nav 16 (700)
- labels 14–15 (700, uppercase 0.05em on kickers)
- body 20/18 × text-size scale (Normal 1, Large 1.2; also scales headlines and deks), lh 1.65 on the article

Desk scale:
- page h1 40 (800, lh 1)
- section h2 24–26 (800)
- panel titles 18–22 (800)
- lead title 19 (700)
- body/why lines 16 (Literata)
- buttons 15 (700–800)
- meta 14

### Shape, spacing, elevation
- **Square corners everywhere.** No radius.
- Paper structure comes from ruled grids:
  - section dividers 3px `--ink`
  - inner rules 1px
  - the story grid is drawn with `gap:1px` over a `--grid` background
- Desk panels: 1px `--line` border on a `--panel` fill.
  - Emphasis panels (Tonight’s edition, Record/confirm forms, Daily scan) use a 2px `--yel` border.
  - State cards use a 4px colored left or top border.
- No drop shadows, except dialogs: `0 20px 50px rgba(0,0,0,.45)` over a `rgba(10,9,8,.62)` backdrop.
- Tap targets: every button at least 44px tall (48px for primary header actions); desktop gutters 40px on the paper and 32px on the desk; phone gutters 20px on the paper and 16px on the desk.

### Button family (one family, as the repo rules require)
All buttons are flex with `align-items:center`, min-height 44px, horizontal padding 12–18px and 15px text.
- **Primary** (“the next step”): `--yel` fill, `#111` text, weight 800. Only one or two per view.
- **Secondary**: 2px `--ink` border, `--ink` text, weight 700.
- **Quiet**: 1px `--line` border, weight 700.
- **Danger** (Kill, Stop, Cancel a job, Legal removal): 2px `--danger` border and text. It is never only colored text; the label says what happens.
- **Disabled publish**: 2px dashed `--line` border, `--ink2` text, `not-allowed` cursor, and the reason printed beside it (for example “Review 1 name to publish.”).
- **Segmented filters**: a 1px `--line` container; the selected segment is `--ink` fill with `--bg` text.
- **Key hints** inside buttons: a 14px/700 letter in a 1px bordered box (`S`, `H`, `X`, `N`, `⌘S`).
- Focus: 2px outline in the text color, 2px offset (keep the existing rule).

### Status chips (words always, color only reinforces)
| State | Style |
|---|---|
| `NEW` | yellow fill |
| `≈ PRINTED` | 1px dashed `--ink2` |
| `HELD` | 2px `--warn` |
| `✓ Supported` / `✓ No change` / `✓ Ready` | 1px `--ok` |
| `Changed` / `Found an answer` | yellow fill |
| `Checked · not found` (a claim that a record doesn’t exist, verified) | `--ink` fill, `--bg` text |
| `Could not check` | 2px dashed `--danger` |
| `! Needs review` / `! Slow` / `Expires in N days` | 2px `--warn` |
| `Paused` / `Waiting` | 1px `--ink2` |

“Checked, nothing changed” and “could not check” must never look alike. That was an existing repo rule, and the design now enforces it everywhere: the wire panel, Sources, evidence checks, follow-ups and model health.

### Score badge (leads)
A 44×44 square with the number at 19–20px/800 in tabular numerals.
- Score 14 or higher: yellow fill.
- 10–13: 2px `--ink` border.
- Below 10: 1px `--line` border.

The word “score” sits beneath it at 14px.

### Evidence meter (leads)
A row of 12×12 squares: a filled `--ink` square for each record opened and a 2px `--danger` outlined square for each record that could not be opened. Text beside it: “3 opened · 1 could not open.”

---

## Screens: public paper

### Front page: `design/Front Daily.dc.html` (locked)

Top to bottom, 1240px desktop reference:
1. **Top bar**
   - Yellow, 10px/40px padding, Bricolage 15/700, `#111`.
   - Left: “Today in Longmont · Sat, Sept. 26”.
   - Right: Search · Saved · Dark/Light mode · Editor’s desk.
2. **Masthead**
   - 24px padding with a 3px `--ink` bottom rule.
   - Wordmark “TownReporter” at 56/800, then a “Longmont” tag (18/700, `--ink` fill, yellow text in light; dark ground text in dark).
   - Right side: geography pills Longmont (filled) · Nearby · Boulder County · Colorado, each with a 2px `--ink` border and 44px minimum height.
3. **Section nav**
   - 12px/40px padding, 1px bottom rule, 16/700.
   - Council, Schools, Housing, Growth & planning, Utilities, Arts, Community, Opinion.
   - Sections come from `newsroom_sections` (visible, ordered); the ones listed are examples.
4. **Lead + This week**
   - Grid `1.7fr 1fr`, 1px gap on `--grid`, 3px bottom rule.
   - Lead: a yellow section tag, headline 50/800, dek 20 Literata, then date and read time.
   - This week: a `--block` panel titled “This week” (28/800, yellow), with rows showing the day of the week (14/700 yellow), the date number (24/800) and what’s happening (16 Literata). It ends with “Full calendar →”.
   - Dates come from dated items in recent stories and the meeting calendar.
5. **Story grid**
   - 3 columns × 2 rows with 1px `--grid` gaps and 26/32px cell padding.
   - Each cell: section kicker (14/700 uppercase), headline 23/700, then date and read time.
6. **Around the region + Opinion**
   - Grid `1.7fr 1fr`.
   - Region: “Around the region” (28/800) with a row per place (Nearby · Lyons, Boulder County, Colorado…) showing the place name (15/700, 150px wide) and the headline (18 Literata).
   - Opinion: a yellow panel titled “Opinion” with the headline in 22 Literata italic and “All opinion →”.
7. **Footer**
   - `--block` background with “TownReporter · Longmont” (the town name in yellow).
   - Links: About, How we report, Corrections, RSS, Editor’s desk.

Phone (`phone` prop, 374px):
- one column; the lead comes first, then This week, then the stories
- 4 story cells instead of 6
- region rows stack
- the nav wraps rather than scrolling horizontally
- headline 32, wordmark 36

**Must keep, from `docs/reader.md`:** the “Latest stories” infinite list with a Load more button, Search/archive, Saved bookmarks, reading preferences, RSS, and every existing route and URL. The prototype shows the top of the page; the latest-stories list continues below the region band in the same grid style.

### Article page: `design/Article Daily.dc.html`

1. The same top bar, plus a compact masthead (wordmark 40) with the section nav. The current section is underlined with a 4px yellow inset.
2. **Header** (max 1000px):
   - breadcrumb “Front page / [Housing]” (yellow tag)
   - headline 56/800 (phone 34)
   - dek 22 Literata in `--ink2`
3. **Byline bar** between 1px rules:
   - a 44×44 “TR” badge (ink fill, yellow text), “TownReporter”, and the date and read time
   - buttons Save · Share · Aa Text size (secondary style, 44px)
4. **Body grid**: `200px | minmax(0,680px) | 1fr`, 48px gap.
   - Left, “In this article” jump links (40px tall, each with a 4px left border, yellow on the current one): The story · Sources & records · Corrections · Read next.
   - Center, the story in Literata 20/1.65, scaled by text size. “Why it matters locally:” is set as a bold Bricolage lead-in. The AI disclosure paragraph closes the story above a 3px rule at 0.85em.
   - Right, a **“Dates in this story”** block panel in the same pattern as This week, with rows like “Thu Oct 1 · Funding hearing: Education agencies · 6 p.m. per posted packet”.
   - Phone: jump links become a wrapped row above the body, and the dates panel follows the body.
5. **How we reported this**:
   - a “Follow the evidence” yellow kicker
   - a 2-column grid of source cards (1 column on phone) with 1px gaps
   - each card: its role (Followed / Announcing source), title, host · captured time, and the links Current source · View captured version · Compare versions (when there is more than one capture). Links get a 3px yellow underline.
   - It closes with “Trust is verifiable. Check the official record before you act on a figure or a vote.”
6. **Corrections & accountability** (left, with a “File a correction →” ink button) next to **Share the reporting** (a yellow panel with “Copy credit & original link”).
7. **Keep reading**: a 3-up grid in the front-page cell style, then the footer.

The existing behaviors in `docs/reader.md` all stay:
- the claims appendix when present
- View captured version and Compare versions
- the correction form, prefilled
- Copy credit and link, with the clipboard fallback dialog

---

## Screens: editor’s desk

Shell for all desk screens:
- Left nav, 230px, `--panel` fill with a 1px right rule.
  - Wordmark (24/800) with an “Editor’s desk” yellow tag.
  - A **Running box**, shown only while jobs are running. It has a 2px yellow border, a pulsing 10px yellow square, “Running · N”, and each job’s title with elapsed time and current stage. Clicking it goes to Today.
  - Nav items (44px, 16/700, count at the right in `--ink2`): Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk, Sources & scan, Models, Server, Stats. The active item gets a `--bg` fill and a 4px yellow left inset.
  - Footer: “View the paper ↗”, Light/Dark, “Aa Large”, and “Press ? for keyboard shortcuts”.
  - Existing routes to keep reachable: `/desk/import` (New story intake), `/desk/memory` (Beat memory) and `/desk/legal-removals`.
- Phone: the nav collapses to a top bar with the wordmark, a “Desk” tag, “+ New” and “Menu”.

### 1. Today (Command Center): `Desk Command.dc.html` → `/desk`

- Grid `230px | 1fr | 340px` (nav, main, rail).
- Header:
  - “Saturday, Sept. 26 · Longmont” (15/700 `--ink2`)
  - h1 “Good morning. Here’s today’s paper.”
  - buttons “+ Add a lead” (secondary), “+ New story N” (primary), “+ Opinion” (secondary)
- **Four-step strip**: 4 equal cells with 1px `--line` gaps.
  - Each cell: a step number (a 30px square, yellow when it is the current step), the step name, a big count (40/800), a unit, and one button.
  - 1 Pick leads: “Review leads” (primary)
  - 2 Draft: “Watch progress”
  - 3 Check: “Check draft”
  - 4 Publish: “Tonight’s edition”
- **Running now**, shown only when jobs exist: a 3-up grid of compact Job cards (spec below).
- **Tonight’s edition**: a panel with a 2px yellow border.
  - One row per story ready or nearly ready: section, headline (Literata 17), check chips (`✓ Evidence checked`, `! Names: 1 needs review`, `✓ Section confirmed`, `✓ Preview viewed`, or `○ Not run` in dashed outline), then the one next-action button.
  - A story prints only when every chip is ✓.
- **In progress**: 3 draft cards with a 4px top border (line/ink/yellow by stage), stage label, headline, meta, the next action and Open. Subtitle: “Nothing here prints until you press Publish.”
- **New leads**:
  - Header with a 3px bottom rule and filters Open · N / Held · N.
  - Keyboard legend bar: J/K next/previous · S start story · H hold · X kill · U undo · Enter open lead.
  - Rows use a grid `52px | 1fr | auto`: score badge, then chips, title 19/700, why line (Literata 16), and evidence meter + meta; actions at the right are **Start story S** (primary), **Hold H**, **Kill X** (danger).
  - The selected row gets a `--panel` fill and a 4px `--sel` inset (ink in light, gold in dark).
  - Once held or killed, the row dims to 60% and shows “Held” or “Killed” with **Undo**.
- **Rail**:
  - **Follow-ups**: the latest AI follow-up results.
  - **Dark Desk**: a `--dd` panel with “Never prints on its own” and the three piles with counts.
  - **The wire**: per-source state chips (Changed / ✓ No change / Could not check with the reason), the writing model’s status, and Run scan now · All sources.

### 2. Story workbench: `Desk Story.dc.html` → `/desk/story/$leadId` and `/desk/story/draft/$draftId`

- Top bar: “← Today”, context (“Story from lead · Housing · score 14”), and a stage stepper: ✓ Lead · ✓ Draft · 3 Check (yellow, current) · 4 Publish.
- Two columns, `420px | 1fr`.
  - Left panel (`--panel`) with tabs **Checks · Sources · Reporting**, 48px tall, the active tab marked with a 4px yellow underline.
  - **Checks**:
    - the evidence-check summary (when it ran, which model, how many captures)
    - one row per finding: a state chip, what was checked, the explanation, and an action where relevant (“Retry capture”, “Confirm spelling”, “Open record”)
    - a “Compare checked vs. previous version” button
    - a **Style** group below names: the code-measured style check from 0.6.70, with **Fix these with the model**
  - **Sources**: each record with Opened / Could not open, host, capture time, “Captured version” and “Original ↗”, and “+ Add a document or URL”.
  - **Reporting**:
    - the existing reporting notes: The news · Why it matters · Angle · Still to pull · Verify before print (including claims of absence) · Documents opened
    - AI follow-ups attached to this story
  - Right, the writing surface:
    - Writer row: model select + effort select + “● Ready” + “Last draft: <model>, <time>”.
    - **Headline**: an editable textarea (Bricolage 30/800, 2px `--ink` border) labeled “Headline · yours” and “A redraft will not replace it”. Below it: “Type directly in the box to edit.”, Suggest 3 headlines, Use the lead’s headline.
    - **Summary**: an editable textarea.
    - **Story**: an editable textarea (Literata 18/1.65, max 760px) with “Saved 8:20 a.m.”
    - Actions: **Save ⌘S** · **Check draft against evidence** · **+ Add to story** · **Redraft…** · Preview as reader.
    - When a check or redraft runs, a full Job card appears directly under the actions.
- **Sticky publish bar** at the bottom: `--panel` with a 3px yellow top rule.
  - Gate chips: ✓ Saved · ✓ Evidence checked · ! 1 name to review · ✓ Preview viewed.
  - Then the reason text, and **Publish in Housing**, which stays disabled until every gate chip is ✓.
  - This keeps the existing 0.6.67 rule that the section is confirmed within the same press.

### 3. Queue: `Desk Screens.dc.html` (screen = queue) → `/desk/queue`

- Filters: Open · 12 / Held · 3 / Killed / ≈ Printed / All. Also search, Sort: Best first, and Section: All.
- **Bulk bar** (a yellow strip, shown when rows are selected): “2 selected”, Start 2 stories (ink fill), Hold, Kill, Clear.
- Table columns `44px checkbox | 52px score | 1fr lead | 180px evidence | 150px filed | actions`.
  - The main action is Start story; a held lead shows Release instead.
  - “More ▾” opens the lead menu.

### 4. Drafts (new list): screen = drafts

Everything not yet printed, with filters All / Running / Needs you / Yours / Failed. Each row: a state chip, section · origin (AI / Written by you / Reprint), headline, meta, the next action and More ▾. A running draft shows its compact Job card inline.

States:
- Writing · m:ss
- Checking · m:ss
- ! 1 name to review
- Ready to publish
- Your draft
- Reprint · not checked
- Draft failed (with the reason and Retry)

### 5. Opinion: screen = opinion → `/desk/opinion`

- Two entry cards: “Have the AI write an editorial →” (yellow border) and “File one you wrote →”.
- A request list with these states: Writing (with its live Job), ! Claims missing (Repair claims), Failed · quota (Restore saved material, which exists today), and Published.
- The Claims and sources appendix still blocks publishing.

### 6. Follow-ups, reworked as AI agents: screen = follow → `/desk/follow-ups`

Each item is a question an agent keeps working on.

- Filters: Active / Found something / Could not check / Stopped.
- Card: a 4px left border by state, a state chip, the method (“Re-check pages · every 2 hours” / “Search public records · daily” / “Watch for next agenda · Tue & Fri”), the question (18/800), the latest result (Literata 16), the linked story and the schedule.
- Actions by state:
  - Found: Review finding (primary), Add to story, Mark done.
  - Running: Pause, Edit, Stop, with a live Job inline.
  - Waiting: Run now, Edit, Stop.
  - Could not check: Retry now (primary), Edit, Stop.
- Findings are written to the story’s reporting notes. Follow-ups never publish.

### 7. Dark Desk: screen = dark → `/desk/dark`

- Grid `320px | 1fr`.
- Left: three piles (Open files · Signals to review · Waiting on an AI follow-up) with file rows (the selected one gets a yellow inset), and “Check r/longmont for signals”.
- Right, the open file:
  - The question (26/800) and the ordinary explanation to rule out.
  - A boundaries strip (Scope · Depth · Limit).
  - A 2-column **Activity** log (time + event; failures in `--danger` bold, findings bold) next to the **Case file** (Findings, Contradictions, Unanswered, AI follow-ups running), with Challenge the case.
  - **Decide**: Keep investigating · Start an AI follow-up (primary: an agent watches for a public statement or record) · Wait and watch · Send to the queue · Close: no finding. Beneath them: “Nothing here prints.”

### 8. Sources & scan: screen = sources → `/desk/sources` and `/desk/scan`

- Filters: On watch · 42 / Suggested · 175 / Rejected / Could not check · 2.
- Source rows: name, URL · kind, a state chip + note (“403 blocked · 3 days running”), Check now / Retry (primary when failed), and Pause / Remove.
- Right column:
  - **Daily scan**: a yellow-bordered panel showing Runs / Files up to / Model, the note “Scans file leads only. They never draft or publish.”, and Run scan now.
  - **Previous scans**, each with its result chip.
- “+ Add a source” opens the add-source dialog, which includes bulk import.

### 9. Published: screen = published → `/desk/published`

- Filters: All / This week / With corrections / Opinion.
- Columns: Printed | Story | Views | Corrections | actions (View, Edit headline, More ▾).
- A correction request pending review shows in `--warn`.

### 10. Models: `Desk Models.dc.html` → new tab, or a section of `/desk/ops`

Two tabs:
- **Who does what**: one row per job.
  - Jobs: Daily scan & lead filing, Lead scoring & duplicates, Story drafting, Opinion writing, Evidence check, Headline suggestions, Dark Desk research, AI follow-ups, Document reading & OCR, Video & meeting transcripts.
  - Columns: First choice (model select + an **effort select whose options come from that model**), Fallback 1, Fallback 2, and a live status chip (✓ Ready / ! Slow / Sign-in expired).
  - A footer bar shows the unsaved-changes count, Reset and Save assignments.
  - Copy: “The desk tries the first choice, then Fallback 1, then Fallback 2, and records which one actually ran. A content refusal is final and never falls back.”
- **Connections**, in three groups:
  - **Frontier · API key**
  - **Subscription sign-ins (OAuth)**
  - **Local & self-hosted**: LM Studio and Ollama on this machine, Ollama Cloud, and remote servers
  - Each connection card shows its status chip, how it is connected, and a list of its models (with context, speed, loaded or not, and effort-level chips), plus Test / Replace key / Sign in again / Open LM Studio ↗ / Open Ollama ↗ / Settings / Remove.
  - The owner rule stands: the paper never loads or unloads a local model. There are no Load or Pull buttons: “Open LM Studio ↗” and “Open Ollama ↗” hand off to those apps.

### 11. Server: screen = server → `/desk/ops`

- A Writing models summary with “Assign models to jobs →” (to Models).
- Health: Database, Disk, Last backup, Errors in 24 h, with View logs and Restart workers.
- Paper setup, including Invite an editor.
- Recently deleted: Open trash (drafts only; killed leads stay under Killed). Plus panels for Sections, Daily scan, Meeting capture, YouTube (API key), Routine notices, Named outlets, Editors & access and Time budgets, which gives all 12 of the app’s Server panels.
- Keep everything `/desk/ops` has today: provider time budgets, sign-ins, custom connections, daily scan settings, meeting capture settings, named outlets, routine-notice automation, and “Give up the desk”.

### 12. Stats: `Desk Stats.dc.html` → `/desk/stats`

The privacy rule is non-negotiable: **aggregate only, never per person.** No cookies, no storage in the browser, no IP stored, no fingerprinting and no identifier that lasts past a day.

- Header: range filter Today / 7 days / 30 days / 12 months, and Export CSV.
- **Reading right now**, a panel with a 2px yellow border:
  - a pulse and the live reader count (72/800), plus the change from 30 minutes ago
  - a 30-bar sparkline of the last 30 minutes
  - a table of the pages being read now: readers (number + yellow bar) and **average time on page so far**
- Beside it:
  - **Arriving from, right now** (bars)
  - **Right now, readers are on**: phone / computer / tablet as a stacked bar
  - **What we never collect**: a dashed box, including the “How it’s counted” paragraph
- **Summary row** (6 cells):
  - Visits: arrivals from outside the site
  - Page loads: today’s counter
  - Avg reading time: active time only
  - Total reading hours
  - Read another story: the share that opened a second story
  - Left without reading: under 10 seconds
  - Each cell shows the change from the prior period with ▲/▼ and words.
- **Visits and reading time, last 30 days**: a bar chart, with yellow marks on days over 1,000 visits.
- **Stories by how much they were read**: visits, average read time, a read-through bar group (25/50/75/100%, the last bar yellow) with the share that reached the end, and the share that read another story.
- Three bar panels:
  - where visits come from: Search, Email/apps/texts (shared privately), Facebook, Direct, Reddit, other local sites, RSS
  - where readers are: city or county level only
  - sections ranked by reading time
- **When people read**: an hour × day heatmap with yellow opacity, and a one-line takeaway.
- **Trust signals**:
  - captured versions opened
  - source links followed
  - “How we reported this” reached
  - corrections filed
  - credit copied
  - RSS fetches per day
  - dark mode and larger text chosen
- **Keep from today’s page, drawn at the bottom of Stats:** “Section chosen by hand” (a count and an explanation) and **Saved reports** (Save latest reports, then daily/weekly/monthly rows, each with Read report).

“Returning readers” can’t be measured under this rule, and the page says so rather than estimating it.

---

## Shared patterns

### Job card: `Desk Job.dc.html` (used on Today, the story page, Drafts, Opinion, Follow-ups, Sources and the nav Running box)

Fields: title, model · effort, elapsed time (m:ss, tabular), a stage list (✓ done in `--ok`, the current stage yellow-filled, future stages dashed), a progress bar, the current step (“Now: Reading packet 2 of 3 (41 pages)”), and “Last activity m:ss ago”.

Bar:
- 8px tall, with a `--line` track.
- Determinate: its width is the percentage, with a 0.6s width transition.
- Indeterminate when no percentage is known: a 33% segment sliding (`translateX(-100%→300%)`, 1.4s linear, infinite).
- A pulsing 12px status square: opacity 1 → 0.25 → 1, 1.2s.
- Respect `prefers-reduced-motion`: no sliding or pulsing, show the text only.

States:
- **Running**: yellow. Actions: Show activity (reveals the last 4 log lines with times) and Cancel (danger).
- **Stalled**: running with no activity for **60s or more**, in orange. A box explains: “No activity for 1:14. The model may be slow, or it may have stalled.” It offers Keep waiting and Retry on next model.
- **Done**: green, “Done m:ss”, with the result text and a primary Open button (“Open draft”, “Review leads”, “See results”…).
- **Failed**: red, “Stopped m:ss”, with the real reason (“Codex quota reached. Nothing was lost.”), Retry, and Retry on another model.

Compact variant: no stage list, 12px padding.

### Dialogs: `Desk Dialogs.dc.html`

Built with Radix Dialog.
- Panel: 820px, `--bg` fill, 2px `--ink` border.
- Header: title 28/800, subtitle 15 in `--ink2`, and a ✕ at 44×44.
- Footer: an explanation on the left; on the right, Cancel (quiet), an optional alternate action (secondary) and the primary action (yellow, 48px).
- Choice cards: the selected card gets a 2px `--ink` border and a `--panel` fill, with an 18px square indicator filled yellow.
- The dialog opens in view, near the trigger; the Radix default of centering in the viewport is fine.

The full set:

| Dialog | Content |
|---|---|
| **New story** (3 tabs) | (a) *AI drafts from material*: a drop zone (20 files, 100 MB each; PDF, Word, text, images with OCR, subtitles), Links, Source text, Assignment, model + effort, then “Start drafting”. This is the existing `/desk/import` intake. (b) *Write it myself*: Headline, Summary, Story, Sources, then “Save draft” or “Save & check against evidence”. (c) *Paste a finished story*: Original link, Credit line, Story text, and “What should the AI do?” (nothing / clean up formatting and suggest a headline / check against sources). |
| **Add a lead** | Link or tip, Why it might matter, and Then: research and score it / research and draft now / just file it as-is. |
| **Add sources** (4 tabs) | One link (name, what to watch for; checked in every daily scan) · Paste a list · Upload CSV / OPML / sitemap · Ask AI to find sources (a topic plus scope; results land in **Suggested sources**, with why and who found each). The list and file tabs show a **preview table** (✓ new / already watched) before anything is added. “Add N sources” runs a first check immediately. |
| **Redraft** | What should change, then Keep: my headline and edits / my headline only / start fresh from the records (**your headline is kept**). Model + effort. The current draft is kept and the two are compared before choosing. |
| **Add to story** | Drop documents or paste new material, then How: the AI weaves it in / add as a timed update at the top / paste as-is at the end (no AI). Shows exactly what changed before saving. |
| **Start a Dark Desk file** | The question, the tip or starting point, the ordinary explanation, and Limits: Quick (10 records, 20 min) / Standard (30 records, 2 h or $3) / Deep (100 records, 8 h or $15). Model. |
| **New AI follow-up** | What to find out, Where to look, and How: re-check pages on a schedule / search the web and public records / watch for the next agenda. |
| **Hold** | Why (optional): waiting on a record or date (you release it) / waiting on an AI follow-up / not now; plus a note. Buttons: “Hold with this reason” and “Hold, no reason”. |
| **Kill** | Quick fills (not news / already printed / outside our area / bad source or unreadable) drop text into **Reason in your words**, plus an optional **Link**. Buttons: “Kill with this reason” and “Kill, no reason”. **The Kill button and the X key both open this.** Cancel keeps the lead. The lead **moves to Killed** with its reason, time and link (app behavior, migration 0094), and Undo stays on the row. |
| **More ▾ (lead)** | Edit the lead · Hold with a reason · Merge with a printed story · Send to Dark Desk · Start an AI follow-up · Kill with a reason. |
| **Headline** | Choose one: Keep mine (shows the current headline) / 3 suggestions, each with its angle note. Then **Or write a new one** (a blank field), Suggest 3 more, and Use this headline. |
| **Compare versions** | Two columns (saved vs. checked), with added text highlighted at 35% yellow and removed text struck through. Buttons: Restore previous and Keep checked version. |
| **More ▾ (published)** | Edit the story (republishes with an “Updated” time) · Add a correction · Add an update · Unpublish (recoverable) · Legal removal… |
| **Correction** | **What was wrong** / **What is right**. The story text: **Leave it as is (default)** or **Also fix the story text** (off by default, as in 0.6.70). Buttons: **Suggest wording (AI)** and **Post as a plain note** (no AI). Links to the reader’s request when there is one. Posts to the story and the public corrections log. |
| **Legal removal** | A checklist of what gets removed and what doesn’t (public page → 410 Gone, captures, search and RSS, **backups needing operator review**), a required reason, and typing REMOVE to confirm. Before confirming, the editor sees and picks the rule for the text: **keep a sealed, owner-only copy, deleted automatically after 12 months** (default) or **keep nothing** (court-ordered destruction). The record keeps who, when, why and what. The final button uses the danger style. This builds on the existing `/desk/legal-removals`. |
| **Add a model connection** | Frontier API key · Subscription sign-in · LM Studio · Ollama (local, remote or Cloud) · any OpenAI-compatible server. |

### Toasts
Use `sonner`: a yellow bar with `#111` text, for example “Drafting started from the lead. Watch it under Running now.” Keep `announceToDesk` for screen readers.

## Interactions & behavior

- **Keyboard triage** on Today and in the Queue: J/K move the selection, S starts a story, H opens Hold, X opens Kill, U undoes, Enter opens the lead, N starts a new story, ⌘S saves in the story workbench, and ? shows the shortcut list. Keys are ignored while typing in an input.
- **Every long job is visible**: scan, lead research, drafting, redraft, evidence check, add-to-story, headline suggestions, source first-check, find sources, Dark Desk runs, AI follow-ups, model tests and document OCR. It appears in three places: in context (under the action that started it), in Running now on Today, and in the nav Running box.
- **Polling**: keep React Query polling. Use 2s while a job the editor is watching is running, 5s for the Today lists, and stop when idle. Server-sent events are optional later.
- **Stall rule**: the UI treats a job as stalled when its heartbeat or last activity is 60s old or more. The server must update the activity timestamp at least every 15s while working, even during a long model call (for example “waiting on model, 42s”).
- **Editor control, always**:
  - Every AI output (headline, summary, body, notes, sections, lead titles) is directly editable.
  - Every AI action has a manual equivalent (write, paste, add, file).
  - Every destructive action asks, with a “no reason” path so it stays fast.
  - Nothing publishes without the editor pressing Publish.
- **Redraft never replaces the editor’s headline or marked edits**, per the existing 0.6.67 behavior and `0093_editor_headline_control`.
- Destructive-action confirmations stay two-step, as the existing drop and delete confirmations are.
- The paper’s text size (Normal / Large) must scale headlines and body, not just labels (this was known problem #8 in the Sept. 5 audit).

## State (desk, client side)

- The theme (existing appearance context), and the text scale.
- The selected lead index and per-lead pending status (optimistic Held/Killed with Undo until the server confirms).
- The open dialog and its tab and choice.
- Jobs, from polling: `{id, kind, subject, title, model, effort, stages[], stage, pct|null, now, startedAt, beatAt, state: running|done|failed, result, error, openHref}`.
- Unsaved Models assignment edits.

## Files in this bundle

- `START-HERE.md`: reading order, contents, known caveats, what isn’t drawn, and the file-count check.
- `CHANGELOG-v3.md`: v3 changes keyed to the developer review.
- `REVIEW.md`: what was tested before handoff, what was fixed, and what the developer still needs to verify.

- `design/Front Daily.dc.html`: the locked front page (props: `theme`, `phone`, `palette`, `ground`, `darkGround`; defaults are the locked values).
- `design/Article Daily.dc.html`: the article page (props: `theme`, `phone`, `textSize`).
- `design/Desk App.dc.html`: the **interactive desk**, wiring every screen below.
- `design/Desk Nav.dc.html`, `Desk Command.dc.html`, `Desk Story.dc.html`, `Desk Screens.dc.html` (queue/drafts/opinion/follow/dark/sources/published/server), `Desk Models.dc.html`, `Desk Stats.dc.html`, `Desk Dialogs.dc.html`, `Desk Job.dc.html`.
- `design/Desk Directions.dc.html`: a review canvas with every screen in dark and light, plus reference job states.
- `design/support.js`: the prototype runtime. Not for production.
- `screen-captures/`: full-length PNGs of every screen, dialog and job state (see Screenshots).
- `design-system/components/`: **15 React reference components** that match these specs one to one (see the design-system README §13).
- `design-system/`: **the TownReporter design system and style guide** (principles, tokens as CSS, component rules, copy voice, and a small-fix checklist). Use it for any follow-up fix without a redesign.
- `DECISIONS.md`: every locked owner decision, plus what was rejected.
- `RESEARCH.md`: the research behind the choices (desk-software landscape, dark mode, privacy-first analytics), with sources.
- `KICKOFF.md`: the developer brief (what exists, what’s new, phases, acceptance).
- `_research-notes.md`: raw notes from the repo read.

## Screenshots

Full-length captures of every screen in `screen-captures/`, taken from the prototypes on 2026-09-26. Desktop shots are 1440px wide; phone shots are 390px; dialogs are cropped to the dialog area over the dimmed desk. They are a fixed record of the approved design. If a screenshot and a prototype file ever disagree, **the prototype file wins**. Sample content, model names and numbers are illustrative (see “About the design files”).

Map to the spec above:
- paper-01…04 → Front page (desktop light and dark, phone light and dark)
- paper-05…08 → Article page (08 shows dark mode at Large text on a phone)
- desk-01…03 → Today (desk-03 is the phone triage view)
- desk-04…06 → Story workbench (Checks with Publish disabled · everything checked with Publish live · evidence check running under the Sources tab)
- desk-07…22 → Queue, Drafts, Opinion, Follow-ups (AI agents), Dark Desk, Sources & scan, Published, Server, each in dark and light
- desk-23, 24, 27 → Models (Who does what in dark and light; Connections)
- desk-25, 26 → Stats
- dialog-01…16 → every dialog in the Dialogs table, in order
- job-states-dark → Job card states: running, stalled (60s or more quiet), done, failed

### Public paper
- [`paper-01-front-light.png`](screen-captures/paper-01-front-light.png)
- [`paper-02-front-dark.png`](screen-captures/paper-02-front-dark.png)
- [`paper-03-front-phone-light.png`](screen-captures/paper-03-front-phone-light.png)
- [`paper-04-front-phone-dark.png`](screen-captures/paper-04-front-phone-dark.png)
- [`paper-05-article-light.png`](screen-captures/paper-05-article-light.png)
- [`paper-06-article-dark.png`](screen-captures/paper-06-article-dark.png)
- [`paper-07-article-phone-light.png`](screen-captures/paper-07-article-phone-light.png)
- [`paper-08-article-phone-dark-large-text.png`](screen-captures/paper-08-article-phone-dark-large-text.png)

### Editor’s desk
- [`desk-01-today-dark.png`](screen-captures/desk-01-today-dark.png)
- [`desk-02-today-light.png`](screen-captures/desk-02-today-light.png)
- [`desk-03-today-phone-dark.png`](screen-captures/desk-03-today-phone-dark.png)
- [`desk-04-story-checks-dark.png`](screen-captures/desk-04-story-checks-dark.png)
- [`desk-05-story-ready-reporting-light.png`](screen-captures/desk-05-story-ready-reporting-light.png)
- [`desk-06-story-checking-sources-dark.png`](screen-captures/desk-06-story-checking-sources-dark.png)
- [`desk-07-queue-dark.png`](screen-captures/desk-07-queue-dark.png)
- [`desk-08-queue-light.png`](screen-captures/desk-08-queue-light.png)
- [`desk-09-drafts-dark.png`](screen-captures/desk-09-drafts-dark.png)
- [`desk-10-drafts-light.png`](screen-captures/desk-10-drafts-light.png)
- [`desk-11-opinion-dark.png`](screen-captures/desk-11-opinion-dark.png)
- [`desk-12-opinion-light.png`](screen-captures/desk-12-opinion-light.png)
- [`desk-13-follow-dark.png`](screen-captures/desk-13-follow-dark.png)
- [`desk-14-follow-light.png`](screen-captures/desk-14-follow-light.png)
- [`desk-15-dark-dark.png`](screen-captures/desk-15-dark-dark.png)
- [`desk-16-dark-light.png`](screen-captures/desk-16-dark-light.png)
- [`desk-17-sources-dark.png`](screen-captures/desk-17-sources-dark.png)
- [`desk-18-sources-light.png`](screen-captures/desk-18-sources-light.png)
- [`desk-19-published-dark.png`](screen-captures/desk-19-published-dark.png)
- [`desk-20-published-light.png`](screen-captures/desk-20-published-light.png)
- [`desk-21-server-dark.png`](screen-captures/desk-21-server-dark.png)
- [`desk-22-server-light.png`](screen-captures/desk-22-server-light.png)
- [`desk-23-models-assign-dark.png`](screen-captures/desk-23-models-assign-dark.png)
- [`desk-24-models-assign-light.png`](screen-captures/desk-24-models-assign-light.png)
- [`desk-25-stats-dark.png`](screen-captures/desk-25-stats-dark.png)
- [`desk-26-stats-light.png`](screen-captures/desk-26-stats-light.png)
- [`desk-27-models-connections-dark.png`](screen-captures/desk-27-models-connections-dark.png)

### Dialogs
- [`dialog-01-new-story.png`](screen-captures/dialog-01-new-story.png)
- [`dialog-02-add-lead.png`](screen-captures/dialog-02-add-lead.png)
- [`dialog-03-add-source.png`](screen-captures/dialog-03-add-source.png)
- [`dialog-04-redraft.png`](screen-captures/dialog-04-redraft.png)
- [`dialog-05-add-to.png`](screen-captures/dialog-05-add-to.png)
- [`dialog-06-dark-file.png`](screen-captures/dialog-06-dark-file.png)
- [`dialog-07-follow-up.png`](screen-captures/dialog-07-follow-up.png)
- [`dialog-08-hold.png`](screen-captures/dialog-08-hold.png)
- [`dialog-09-kill.png`](screen-captures/dialog-09-kill.png)
- [`dialog-10-more-lead.png`](screen-captures/dialog-10-more-lead.png)
- [`dialog-11-headlines.png`](screen-captures/dialog-11-headlines.png)
- [`dialog-12-compare.png`](screen-captures/dialog-12-compare.png)
- [`dialog-13-more-published.png`](screen-captures/dialog-13-more-published.png)
- [`dialog-14-correction.png`](screen-captures/dialog-14-correction.png)
- [`dialog-15-legal.png`](screen-captures/dialog-15-legal.png)
- [`dialog-16-add-connection.png`](screen-captures/dialog-16-add-connection.png)

### Job states
- [`job-states-dark.png`](screen-captures/job-states-dark.png)

## Assets
There is no photography or illustration; the paper is type-led. The fonts are Google Fonts (Bricolage Grotesque and Literata) and should be self-hosted. Icons, if any are added, come from `lucide-react`, which is already a dependency. The favicon and `public/og.jpg` are unchanged, though the OG image should be regenerated in the new palette.
