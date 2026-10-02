# TownReporter Design System

The visual and interaction rules for TownReporter: the public paper and the editor’s desk. Use this guide to make small fixes and additions that look like they were always there, without starting a new redesign.

Source: redesign approved 2026-09-26 (front page “Neighborhood Daily”, the article page, and a full editor’s desk). Repo: `github.com/scottconverse/townreporter`. Reference prototypes: `design_handoff_townreporter_v3/design/`.

---

## 1. What TownReporter is

A nonprofit civic newspaper for **one town**, Longmont, Colorado, with lighter coverage of nearby towns, Boulder County and the state. It’s run by **one human editor**. AI does the scanning, research, drafting, checking and follow-up; the editor decides what prints. The site shows its sources on every story.

The design has two jobs:
- **The paper** has to feel local, useful and trustworthy, like a neighborhood daily, not a national outlet.
- **The desk** has to let one person turn AI output into a paper in an hour or two a day, with no guessing about what the AI is doing.

## 2. Principles (use these to settle any small decision)

1. **Longmont first.** Geography runs Longmont, then Nearby, Boulder County and Colorado, in that order everywhere: pills, sections and rails. The town is never an afterthought.
2. **Useful before clever.** Dates, meetings and deadlines get as much room as headlines (This week, Dates in this story). When in doubt, show the thing a resident can act on.
3. **Show the record.** Sources, captured versions and corrections are first-class content, never footnotes.
4. **Structure from rules, not decoration.** Hierarchy comes from type weight and ruled grids. There are no shadows, gradients, rounded cards or illustrations.
5. **One loud color.** Yellow means “look here” or “do this next.” If everything is yellow, nothing is.
6. **Words carry meaning; color only reinforces it.** Every state is written out (“Could not check,” “Overdue 1 day”). Never rely on color or opacity alone.
7. **The editor is always in control.** Every AI output is editable, every AI action has a manual equivalent, and every destructive action asks, with a fast “no reason” path.
8. **Nothing is silent.** Anything that takes time shows what it’s doing, how long it has run and when it last did something. Failures give the real reason.
9. **Big enough to read tired.** Nothing informational under 14px, hit targets at least 44px, and WCAG AA in both themes.

## 3. Color

Everything is ink on cream, or bone on warm black, plus one yellow.

| Role | Light | Dark |
|---|---|---|
| Page `--bg` | Cream `#fffdf7` | Warm black `#1b1916` |
| Panel `--panel` | `#f6f2e7` | `#27231f` |
| Rule `--line` | `#d8d3c4` | `#3b3631` |
| Text `--ink` | `#111111` | `#e8e6e1` |
| Secondary text `--ink2` | `#3a3a3a` | `#bdbab3` |
| Heavy blocks `--block` (This week, footer) | `#111111` | `#27231f` |
| Accent `--yel` | `#ffd23f` | `#e6c35c` |
| OK / supported | `#1e6b34` | `#9fd4a8` |
| Needs attention | `#8a4b00` | `#f0b27a` |
| Danger / failed / could not check | `#b3261e` | `#f0998c` |

Rules:
- **Text on yellow is always `#111`**, in both themes.
- **Dark is warm black**, never pure `#000` on pure `#fff`. It’s easier on tired eyes and is the same paper at night.
- Light is the paper’s default and dark is the desk’s default. Both follow the system setting and a visible toggle.
- Use yellow for:
  - the primary action
  - the current step
  - section tags
  - the top bar
  - This week and date highlights
  - the Opinion block
  - “Changed” and “Found” states
- Don’t use yellow for decoration, body text or large backgrounds beyond those.
- State colors (OK, needs attention, danger) appear only as chip borders and text, left or top state bars, and the evidence meter. They are never page backgrounds.
- There’s no second accent. If a new need comes up, use ink weight or a rule, not a new hue.

## 4. Type

- **Bricolage Grotesque** does the talking: mastheads, headlines, UI, labels and numbers. It uses weights 800 (display), 700 (heads, buttons) and 500 (meta), with tight tracking at display sizes (−0.02 to −0.035em).
- **Literata** does the reading: decks, story bodies, “why it matters” lines, notes and reporting text. It uses 400 regular, 400 italic (Opinion headlines), and 500/600 sparingly.
- Numbers use tabular numerals (`font-variant-numeric: tabular-nums`) wherever they update or line up.
- Kickers and section labels: 14–15px, weight 700, uppercase, +0.05em tracking.
- Headlines use `text-wrap: balance` and body text uses `text-wrap: pretty`.
- Text size has two steps, matching the app: Normal (1) and Large (1.2). It scales **headlines and body**, not just labels.

The scale:

| Use | Desktop | Phone |
|---|---|---|
| Masthead wordmark | 56 / 800 | 36 |
| Front lead headline | 50 / 800, lh 1.02 | 32 |
| Article headline | 56 / 800 | 34 |
| Dek | 20–22 Literata | 18–19 |
| Grid headline | 23 / 700 | 21 |
| Section head | 28 / 800 | 28 |
| Article body | 20 Literata, lh 1.65 | 18 |
| Desk page title | 40 / 800 | 28 |
| Desk section | 24 / 800 | 24 |
| Lead title (desk) | 19 / 700 | 19 |
| Buttons | 15 / 700–800 | 15 |
| Meta, floor | 14 | 14 |

## 5. Layout

- **Square corners, always.**
- **The paper is a ruled grid:**
  - 3px ink rules between major sections, and 1px rules inside them
  - story grids are drawn with `gap:1px` over an ink (light) or rule-color (dark) background, so the lines are the gaps
- **Paper widths:**
  - desktop reference 1240px with 40px gutters
  - lead + side column at `1.7fr 1fr`
  - story grid 3-up
  - article measure 680px, in a grid of `200px | 680px | 1fr`
- **Phone:** one column, with the lead first, then This week, then the stories. Navigation wraps (never a horizontal scroller). Gutters are 20px.
- **Desk:**
  - left nav 230px, main area, right rail 340px on Today
  - 32px gutters
  - panels are a `--panel` fill with a 1px `--line` border
  - an emphasis panel (the thing to act on now) gets a 2px yellow border
  - state cards get a 4px colored left or top edge
- Keep a minimum 14px gap between siblings. Use flex or grid with `gap`, never margins between siblings.
- **No horizontal scroll at any width** from 390 to 1440.

## 6. Components

### Buttons (one family)
| Kind | Look | Use |
|---|---|---|
| Primary | Yellow fill, `#111` text, 800 | The one next step. At most 1–2 per view. |
| Secondary | 2px ink border, ink text, 700 | Other real actions. |
| Quiet | 1px rule border, 700 | Minor or navigational actions (Open, More ▾, Edit). |
| Danger | 2px danger border and text | Kill, Stop, Cancel a job, Legal removal. The label says exactly what happens. |
| Disabled gate | 2px dashed rule, `--ink2` text, `not-allowed` | Publish before every check passes. The reason is printed beside it. |

- All buttons: at least 44px tall (48px for header primaries), 12–18px horizontal padding, 15px text, labels left-aligned in the button’s flow.
- Keyboard hints sit inside the button in a 14px bordered box (`S`, `H`, `X`, `⌘S`).
- Focus: a 2px outline in the text color with a 2px offset.
- Hover: underline on links. On buttons, keep the same shape and deepen the color slightly (fill −8% lightness, or the border becomes the fill for secondary).

### Pills and segmented filters
- **Geography pills:** 2px ink border; the current one is an ink fill with bg-colored text; 44px tall.
- **Segmented filter:** a 1px rule container with the selected segment in ink fill and a count in the label (“Open · 12”).

### Chips (states, always in words)
| State | Style |
|---|---|
| NEW, Changed, Found an answer | Yellow fill |
| ✓ Supported, ✓ No change, ✓ Ready | 1px OK border and text |
| Checked · not found (a verified absence) | Ink fill, bg text |
| Could not check, Could not open, Failed | 2px **dashed** danger |
| ! Needs review, ! Slow, Expires soon, Held | 2px attention border |
| ≈ Printed | 1px dashed `--ink2` |
| Waiting, Paused | 1px `--ink2` |

**“Checked, nothing changed” and “could not check” must never look alike**: one is solid green and the other is dashed red.

### Paper parts
- **Top bar:** yellow strip with the date line and utility links.
- **Masthead:** the wordmark plus a town tag (ink block, yellow text).
- **Section tag:** a yellow block label.
- **This week / Dates in this story:** a block panel with the day (14 yellow), the date number (24/800), what happens (Literata 16) and a note.
- **Story cell:** kicker, headline, date and read time; no dek on the front grid.
- **Region row:** a 150px place label and a Literata headline.
- **Opinion block:** yellow panel with an italic Literata headline.
- **Source card** (How we reported this): role, title, host and capture time, then links with a 3px yellow underline.
- **Footer:** ink block with the wordmark and the town in yellow.

### Desk parts
- **Nav item:** 44px, 16/700 with a count on the right. Active gets a bg fill and a 4px `--sel` inset (ink in light mode, gold in dark; yellow alone is too faint on cream).
- **Running box:** 2px yellow border with a pulsing square and one line per job.
- **Step strip:** 4 cells, each with a number square (yellow when current), a count and one button.
- **Score badge:** a 44px square; 14 or higher is a yellow fill, 10–13 a 2px ink border, below 10 a 1px rule.
- **Evidence meter:** 12px squares, filled ink for each record opened and a 2px danger outline for each one that couldn’t be opened, plus the words.
- **Lead row:**
  - score, then chips, title, why line (Literata), and meter + meta
  - actions: Start story (primary), Hold, Kill (danger)
  - once acted on: dimmed to 60% with the state word and Undo
- **Job card:** see §8.
- **Dialog:**
  - 820px, 2px ink border, the one place a shadow is allowed
  - title 28/800 with a subtitle
  - choice cards with an 18px square selector
  - footer: an explanation, then Cancel, an alternate action and the primary action
- **Sticky publish gate:** a 3px yellow top rule, gate chips, the reason, and the Publish button.

## 7. Copy and voice

- **Plain, specific, local.** For example: “Longmont Senior Center to begin free meal pickups Oct. 2.” Use names, dates, addresses and numbers from the record.
- **AP-style dates on the paper** (“Sept. 26,” “Oct. 1, 2026,” “6 p.m.”). The desk can use short forms (“Sep 26,” “8:14 a.m.”).
- **Say what the record says, and what it doesn’t.** For example: “The posted pages do not say whether…” Never overstate.
- **Buttons are verbs that name the result:** “Start story,” “Check draft against evidence,” “Publish in Housing,” “Kill, no reason.” Avoid “OK” and “Submit.”
- **Explain consequences in one line** under the action. For example: “Nothing prints until you press Publish.” “Cancel keeps the lead.”
- **Errors give the real reason and the next step.** For example: “Stopped: Codex quota reached. Nothing was lost.” followed by Retry.
- Write “you” to the editor. The paper speaks as “we” (“the records we used”).
- No emoji. The unicode marks used are ✓ ! ≈ → ↗ ▾ ✕ ·, only as shown here.
- Sentence case everywhere except kickers, which are uppercase.

## 8. Motion and progress

- Motion only means “working” or “changed.” Nothing bounces or slides in.
- **Job card anatomy:**
  - a status square that pulses at 1.2s while running
  - title, then model · effort, then elapsed m:ss
  - a stage list (✓ done, yellow current, dashed future)
  - an 8px bar: determinate with a 0.6s width transition, or an indeterminate 33% segment sliding over 1.4s
  - “Now: <current step>” and “Last activity m:ss ago”
  - Show activity, and Cancel (danger)
- **States:**
  - running (yellow)
  - **stalled**: 60s or more with no activity; orange, plain words, Keep waiting and Retry on next model
  - done (green, with the result and an Open button)
  - failed (red, with the reason, Retry and Retry on another model)
- Every long job appears in three places: in context, in Running now, and in the nav Running box.
- `prefers-reduced-motion`: no pulsing or sliding; the text alone carries the state.

## 9. Imagery and icons

- **The paper is type-led.** There’s no stock photography, no illustration and no drawn icons. If photos are added later, show them full width in the story column with a Literata caption and credit, in their true colors.
- Icons: avoid them. Words are clearer. If one is unavoidable, use `lucide-react` (already in the repo) at 16–20px, stroke 2, in `currentColor`, and always next to a text label.
- There’s no logo mark. The wordmark “TownReporter” set in Bricolage 800 is the brand, and the town tag sits beside it.

## 10. Privacy (it’s part of the brand)

Reader stats are aggregate only: no cookies, no browser storage, no stored IPs, no fingerprinting and no identifier that lasts past a day. Any new metric has to pass the rule “could this follow one person?” If it could, it doesn’t ship. The desk says so in plain words where the numbers appear.

## 11. Making a small fix without a redesign

Before adding anything, check:
1. **Is there already a part for this?** Reuse the button family, the chip table, the panel or the job card. Don’t add a new style.
2. **Is the next step obvious?** There should be exactly one primary (yellow) action. If you added a second, demote one.
3. **Is the state in words?** If you used color, add the word.
4. **Is it big enough?** Text at least 14px, hit target at least 44px, AA contrast in light *and* dark.
5. **Does it follow the geography order** (Longmont → Nearby → Boulder County → Colorado)?
6. **Can the editor undo or override it?** Destructive actions ask, and offer a “no reason” path.
7. **If it takes time, is it visible?** Use the job card.
8. **Is it square, ruled and flat?** No radius, no shadow (except dialogs), no gradient.

If a change breaks one of these, it’s a design decision, not a fix. Ask the owner.

## 12. Do / Don’t

**Do**
- Use ink rules and weight for hierarchy.
- Put dates, meetings and sources where readers can see them.
- Name states in words.
- Keep yellow for the next step.
- Show progress on anything slow.

**Don’t**
- Round corners, add shadows to cards, or use gradients or tinted backgrounds.
- Add a second accent color.
- Use pure black or white in dark mode.
- Make destructive actions keyboard-only or hide them without a confirmation.
- Show “could not check” in a way that resembles “no change.”
- Track individual readers.

## 13. Components (React)

All components live in `components/`. Each is a self-contained React file (`.jsx`) with typed props (`.d.ts`) and usage notes (`.prompt.md`). They use only the CSS custom properties in `tokens/` and have no other dependencies. They mirror the prototypes one to one.

| Group | Components | Maps to repo |
|---|---|---|
| core | `Button`, `Chip`, `SegmentedFilter`, `Panel` | `InkButton`, `Chip` in `desk-chrome.tsx`; `.seg`/`.seg-opt`; `Notice` / rail blocks |
| desk | `ScoreBadge`, `EvidenceMeter`, `LeadRow`, `JobCard`, `Dialog` + `ChoiceCard`, `DeskNav` | `desk-leads.tsx`, job progress cards, the dialogs that replace inline confirms, and the `DeskShell` nav |
| paper | `SectionTag`, `GeoPills`, `DatesPanel`, `StoryCell` + `StoryGrid`, `SourceCard` | `paper-chrome.tsx`, `index.tsx` front page, `provenance.tsx` sources |

Caveats: these are reference implementations. All 15 were rendered in a browser test page (24 cases covering every variant and state, 0 errors), but not yet inside the real app. The preview cards render only inside a design-system project. In production, port these into `src/components/` as TypeScript, restyle the existing `InkButton` and `Chip` to match rather than adding parallel ones, and build `Dialog` on Radix Dialog for focus handling. `tokens/motion.css` holds the keyframes `JobCard` needs.

## 14. Files

- `styles.css`: the entry point (imports the tokens).
- `tokens/colors.css`: base and semantic colors for light and dark (`[data-appearance="dark"]` or `.tr-dark`).
- `tokens/typography.css`: font stacks, the size scale, line heights and tracking.
- `tokens/spacing.css`: rules, gutters, tap sizes, measures, the dialog shadow and motion.
- `tokens/fonts.css`: web-font import for prototypes (production self-hosts).
- `tokens/motion.css`: the pulse and slide keyframes, with reduced-motion handling.
- `tokens/base.css`: box-sizing, body defaults, link colors, the `:focus-visible` ring (2px text-color outline, 2px offset) and selection color.
- `components/`: React components (see §13), with one preview card per group.
- `guidelines/*.html`: specimen cards for color, type, buttons, chips and progress.
- `SKILL.md`: for using this guide with Claude Code.
- Reference screens: `design_handoff_townreporter_v3/design/*.dc.html` and `screen-captures/`.
