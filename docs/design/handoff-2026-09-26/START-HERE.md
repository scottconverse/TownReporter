# START HERE: TownReporter redesign handoff (v3, 2026-09-26)

Everything needed to implement the TownReporter redesign in `github.com/scottconverse/townreporter` (React 19 · TanStack Start · Tailwind 4 · TypeScript).

Read in this order:
1. **`KICKOFF.md`**: the developer brief. It covers the operating model (one editor, AI does the work), the rules that stay binding, what already exists in the repo, what’s new and how to build it, the phases, acceptance checks and open questions.
2. **`design-system/README.md`**: the TownReporter style guide. It covers the principles, colors, type, layout, component rules, copy voice, motion, privacy, and a **small-fix checklist (§11)** so later fixes don’t need a redesign.
3. **`DECISIONS.md`**: what the owner locked, and what was rejected.
4. **`README.md`**: the screen-by-screen spec with exact values, plus the screenshot index.
5. **`design/Desk App.dc.html`**: the clickable desk prototype. Serve the folder statically (`npx serve design`) and open it.
6. **`RESEARCH.md`**: why the choices were made, with sources.
7. **`CHANGELOG-v3.md`**: every item from the developer review (A1–C7), with what changed and where.
8. **`REVIEW.md`**: what was tested before handoff, what was fixed, and what you still need to verify.

What’s in the box:

| Folder or file | What it is |
|---|---|
| `design-system/tokens/*.css` | Colors (light and warm-black dark), type scale, spacing, rules, motion keyframes and base rules (focus ring, links) as CSS custom properties. `styles.css` imports them all. |
| `design-system/components/` | **15 React components** (`.jsx` + typed `.d.ts` + usage `.prompt.md`): Button, Chip, SegmentedFilter, Panel, ScoreBadge, EvidenceMeter, LeadRow, JobCard, Dialog + ChoiceCard, DeskNav, SectionTag, GeoPills, DatesPanel, StoryCell + StoryGrid, SourceCard. They are dependency-free and styled only by tokens. Port them to TypeScript in `src/components/`, and restyle the existing `InkButton` and `Chip` rather than duplicating them. |
| `design-system/guidelines/` | Specimen cards for color, type, buttons, chips and progress. |
| `design-system/SKILL.md` | Lets Claude Code load the style guide as a skill. |
| `design/` | 12 high-fidelity prototypes (plus `support.js`, their runtime): paper front, article, and every desk screen and dialog. Reference only, not production code. |
| `screen-captures/` | 52 full-length PNGs of every screen (light and dark, desktop and phone), every dialog, and every job state. |
| `_research-notes.md` | Raw notes from the repo read: routes, tables, the provider registry, job infrastructure. |

Changes in v3: see `CHANGELOG-v3.md`.

Changes in v2:
- React component library added.
- Style guide expanded (§13 Components).
- Motion tokens added.
- Dialog footer and headline-box display fixes in the prototypes and screenshots.

## Where to put this in the repo
Commit the whole folder under `docs/design/handoff-2026-09-26/`.
- **Not under `artifacts/`:** the repo’s `.gitignore` ignores everything there except `.md` files, which would drop every HTML, CSS, JSX, JS and PNG file.
- **Not in any folder named `screenshots/`:** the `.gitignore` ignores those too.
- No other rule in the current `.gitignore` (checked 2026-09-26) matches a file in this package.

## File count check
The package has **138 files**:
- 52 PNGs in `screen-captures/`
- 65 in `design-system/`
- 13 in `design/`
- 8 documents at the top level

The screenshot folder is named `screen-captures/`, not `screenshots/`, because the repo’s `.gitignore` ignores every `screenshots/` folder. After committing, check that `git ls-files <handoff folder> | wc -l` returns 138.

## Known caveats: read before building

1. **The components are reference implementations, not drop-in production code.** They are plain `.jsx` with inline styles driven by the tokens. Port them to TypeScript in `src/components/` using the repo’s conventions (Tailwind classes or the existing CSS files; `InkButton`, `Chip`, `Notice`, `DeskShell`). Restyle the existing parts instead of adding parallel ones.
2. **Build `Dialog` on Radix Dialog** (`@radix-ui/react-dialog`, already a dependency) for focus trapping, Escape to close, scroll locking and returning focus to the trigger. The reference version only draws the look.
3. **The components were tested in a browser, not in the app.** All 15 compiled, and they rendered in a test page (24 cases covering every variant and state, 0 errors). They have not been run inside TanStack Start with server-side rendering. Check each one visually after porting.
4. **The preview cards in `design-system/components/*/*.card.html` render only inside a design-system project** (they load a generated `_ds_bundle.js`). Opened on their own they show blank. Use `design/` and `screen-captures/` instead.
5. **Model names in the prototypes and in `Desk Models` are illustrative.** The real list must come from `src/lib/news/provider-registry.ts` (plus `custom:<uuid>` connections). Keep Grok out of every picker.
6. **Sample content:** leads, drafts, follow-ups, regional headlines, stats numbers and model health states are made up. The front-page and article story text is real (Sept. 26, 2026).
7. **`JobCard` and `DeskNav` need the keyframes** in `design-system/tokens/motion.css` (`trPulse`, `trSlide`). Include it, or add equivalent Tailwind animations, and keep the reduced-motion rule.
8. **Fonts load from Google Fonts in the prototypes.** Production must self-host Bricolage Grotesque and Literata in `public/fonts` via `src/fonts.css`, like the current fonts.
9. **Stats, AI follow-ups and structured job progress need new backend work** (schema plus workers). `KICKOFF.md` sections A, D and E describe the proposed tables; confirm them against the current migrations before writing new ones.
10. **The desk dark-mode rule changed.** Older repo docs say pure black and white; the owner’s decision is warm black `#1b1916`. Update `docs/design/*` and `docs/dark-desk*.md` when you change the theme.

## Not drawn: how to handle them

These screens and states aren't in the prototypes. Build them from the style guide (`design-system/README.md`) and the existing repo structure. Don’t invent new patterns.

| Missing | How to build it |
|---|---|
| Phone layouts for desk screens other than Today | Follow the repo’s narrow-layout rules (`docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md`). Below 900px go to one column: the main content first, then rail blocks as full-width panels. The nav collapses to the top bar shown on Today’s phone view. Tables become stacked rows. No horizontal scroll. Every button at least 44px. |
| `/login`, `/desk/setup`, `/desk/import` (full page), `/desk/memory` (Beat memory), `/about`, `/how-we-report`, `/corrections`, `/evidence/*`, archive and search, Saved | Keep their current structure. Apply the tokens, fonts, button, chip and panel styles, and the paper header and footer (public) or the desk shell (desk). |
| Loading, empty and error states | Restyle the existing `ListSkeleton`, `EmptyState`, `ScreenError` and `ScreenPending` (`src/components/states.tsx`) with the tokens. Empty states say what would appear and offer the one next action (for example, “No one owes you an answer right now.”). Errors state the real reason and offer Retry. |
| The “?” keyboard-shortcut sheet | A `Dialog` listing the shortcuts from README “Interactions & behavior”: two columns (key and action), 16px text. |
| Toast styling | Sonner with a yellow background, `#111` text, 15px/800 and square corners. Keep `announceToDesk` for screen readers. |

Where files and the spec disagree, the order of authority is **`DECISIONS.md` › `design-system/README.md` › prototypes in `design/` › screenshots**.
