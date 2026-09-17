# UI/UX Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-30
**Role:** Senior UI/UX Designer
**Scope audited:** Public paper (`/`, `/about`, `/opinion`, `/corrections`, `/how-we-report`, article/evidence routes) and editor desk (`/desk`, `/desk/sources`, `/desk/scan`, `/desk/queue`, `/desk/opinion`, `/desk/published`, `/login`), driven live on an isolated instance (port 3196), plus source reading of `src/routes/**` and `src/styles.css`.
**Auditor posture:** Balanced

---

## TL;DR

TownReporter's UI is unusually accomplished for a self-hosted civic tool: a restrained editorial type system, AA-passing color contrast by construction, thoughtful copy voice ("we would rather look careful than look first"), and — confirmed live — the prior wave's fixes for ScreenError/retry, aria-live announcements, the heading-skip, and the Opinion-desk voice warning all hold. The weakest dimension is responsive/mobile IA: neither the public nav nor the desk nav collapses on small viewports, so a phone visitor scrolls past ~900px of stacked navigation before reaching content. The second weakest dimension is state completeness on a few secondary widgets (Beat memory has no populated/empty distinction). No Blockers found. One Critical (mobile nav) and a handful of Major/Minor findings round out a genuinely solid base.

## Severity roll-up (UX)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 1 |
| Major | 3 |
| Minor | 4 |
| Nit | 2 |

## What's working

- **The "First person in owns the newsroom" login copy** (`src/routes/login.tsx`) — honest, specific, and tells a fresh operator exactly what will happen. Far better than a generic "Sign up."
- **The login stall-timeout fix holds.** Verified live: `claim` query has a 10s timeout (`waitedTooLong`) that flips to "The desk did not answer" with a Try again button, rather than an infinite "Opening…" — confirms the UIUX-02 fix is real, not just present in one component.
- **Opinion desk's up-front voice warning holds.** Verified live at `/desk/opinion`: "This desk cannot write yet. No editorial voice is configured…" renders above the form before the user invests any typing — confirms UIUX-05.
- **Desk heading fixed to h2 holds.** `/desk/published` renders "Published" then "Beat memory" as sibling headings without a skipped level, matching the UIUX-04 fix description.
- **Corrections empty state** (`/corrections`) — "No corrections posted… we would rather look careful than look first" is a genuinely delightful, on-voice empty state, not a placeholder.
- **404 page** — "No page here" with plain-language body and two clear paths back (Open the paper / Editor desk). No dead end.
- **Color system**: sampled `--color-muted` (#6b5e52) on `--color-paper` (#f6f1e7) computes to ~5.6:1, and `--color-rust` (#9b2915) links compute to ~7:1 — both clear AA for normal text. Dark mode (`.desk-ltr` dark variant) is a fully separate, coherent token set, not an inverted filter.
- **Native HTML5 validation used deliberately** on the queue's "File a lead" form (`required` on Headline/Topic) — verified live, produces the browser's built-in inline "Please fill out this field" rather than a custom jittery validator.
- **A global `:focus-visible { outline: 2px solid var(--color-rust) }` rule exists** (`src/styles.css:77-80`) as a baseline, and desk form inputs additionally swap border color on focus — a considered baseline even where individual components could be more assertive (see UX-004).

## What couldn't be assessed

- The browser pane used for this audit intermittently and silently landed on a second, unrelated TownReporter instance running on port 3195 under a different account ("QA Editor") — apparently a leftover process from a different concurrent session sharing the same browser profile, not a redirect caused by this app's code (no hardcoded port found in `src/`). This cost several screenshot attempts and is called out here so the gap is legible rather than silently patched over; it does not affect the findings below, all of which were re-verified on port 3196 or confirmed from source.
- Populated states for Queue/Dark Desk/Published could not be walked end-to-end (fresh in-memory DB with zero leads/scans/sources beyond the seeded watch list), so lead-scoring display, the drafted-story editor (`desk.story.$leadId`, `desk.story.draft.$draftId`), and evidence-compare views were read from source only, not exercised live.
- Screen-reader software (NVDA/VoiceOver) was not run; ARIA structure was assessed by reading the DOM/accessibility tree and source, not by listening to actual announcements.

---

## First impressions

The front page reads as a real newspaper, not a dashboard: serif display type, a one-line thesis ("The public record is only the beginning"), and section chips that establish scope before any story is shown. Within five seconds it's legible that this is Longmont civic reporting, human-edited. The "Editor desk" affordance is deliberately secondary (a dark pill, right-aligned) on desktop — correct hierarchy for a site whose primary audience is readers, not editors. On mobile, that hierarchy inverts by accident: the "Create Editor" pill becomes a full-width high-contrast black button competing directly with the masthead for the very first thing a thumb meets (see UX-001).

## Journey walkthroughs

### Journey: First-run editor claims the desk → lands on a working command center

1. `/desk` while signed out → clean redirect to `/login`, heading "Create the desk," copy explains first-person-owns-it plainly.
2. Filled name/email/password/confirm, submitted → landed directly on `/desk` "The desk," Command center, with populated widgets: The queue (empty, with two clear CTAs), Dark Desk (empty, on-voice), The wire (Run scan CTA, source health, on-paper summary, beat memory).
3. No confirmation email, no forced tour, no blank dashboard — the "Needs you" banner pattern (visible once there's real work) is a strong touch for a returning editor, though unverifiable with an empty DB today.

Friction found: the Beat memory widget on this screen and its full-page counterpart both render with a bare heading and no rows when empty — no explanatory line, unlike every sibling widget on the same screen (UX-002).

### Journey: Editor opens Opinion desk with no configured voice

Loads `/desk/opinion` → warning banner is the first thing under the header, before the form — the fix holds and is genuinely well-sequenced (warn, then let them see the disabled-looking form, rather than let them type first and fail on submit).

---

## Findings

> **Finding ID prefix:** `UX-`

### [UX-001] — Critical — Responsive — No mobile-collapsed navigation on either surface; nav consumes the first screen

**Evidence**
`/` and `/desk` at 375×812 (iPhone-class viewport). On the public paper, the masthead is followed by a full, uncollapsed primary nav row (THE PAPER / OPINION / ABOUT / HOW WE REPORT / CORRECTIONS / CITY COUNCIL VOTES / RSS), a search bar, an EDITOR DESK button, and then a two-row bank of 9 topic filter chips (ALL/COUNCIL/BUDGET/…/OPINION) — all before the first story headline is visible, roughly 1300px of scroll on a 812px-tall viewport. On `/desk`, the same pattern repeats: masthead, theme toggle, account row, then an 8-item desk nav (DESK/SOURCES/SCAN/QUEUE/PUBLISHED/OPINION/SERVER/DARK DESK) wrapping to two rows, before "The desk" heading appears.

**Why this matters**
A phone reader — very plausibly the majority of visits to a local-news site — has to scroll past nearly two full screens of chrome before reaching any content. This reads as a desktop layout that was shrunk rather than redesigned for mobile; current best-in-class local-news and dashboard patterns collapse this into a hamburger/overflow menu or a horizontally-scrolling single-row tab strip. On the desk side, an editor triaging from a phone (a realistic scenario for a one-person newsroom checking on a scan result) faces the same tax on every navigation.

**Blast radius**
- Adjacent code: the public nav lives once in a shared header component used by every public route (`about.tsx`, `corrections.tsx`, `articles.$slug.tsx`, etc. all inherit it); the desk nav is shared chrome in `desk-chrome.tsx` used by every `/desk/*` route. Fixing each pattern once fixes it everywhere.
- User-facing: every route on both surfaces at viewport <768px.
- Migration: none — presentation-only change.
- Tests to update: none known (no responsive nav test found).
- Related findings: UX-005 (topic filter chips also consume disproportionate mobile space; likely the same fix — collapse into a "Filter" disclosure).

**Fix path**
Collapse both nav bars behind a hamburger/menu affordance below ~640px, or convert to a horizontally-scrolling single-row tab strip (snap-scroll, no wrap) with an overflow indicator. Move the topic-filter chips into a single-row scroller or a "Filter" disclosure button that expands on tap, matching the disclosure pattern already used well elsewhere in the desk (e.g., "File a lead yourself").

---

### [UX-002] — Major — State — "Beat memory" has no empty-state message, unlike every sibling widget

**Evidence**
`/desk` (home): the "Beat memory · what we already covered" section renders its heading and nothing else when there is no data — no fallback paragraph. Contrast with the three sibling widgets on the same screen: "Source health" falls back to "All quiet.", "On the paper" falls back to "Empty until you publish.", and the queue falls back to a full sentence with two CTAs. In `src/routes/desk.index.tsx` the memory list is rendered as `{(memory.data ?? []).slice(0, 4).map(...)}` with no `.length === 0` branch.

The same gap is worse on the dedicated page: `/desk/published` renders a full table — headers ENTITY / LAST ANGLE / UPDATED — with zero body rows and no "No beat memory yet" caption underneath, verified live. A bare table with headers and no rows and no caption reads as a possible loading/error state rather than a confirmed-empty one.

**Why this matters**
Per the audit methodology, every data view needs a designed empty state — inconsistency here is what makes a product feel unfinished in patches even when most of it (correctly) treats "empty" as a first-class, well-copywritten state. A new editor seeing a bare table on `/desk/published` may reasonably wonder whether beat memory failed to load rather than "hasn't accumulated any entries yet."

**Blast radius**
- Adjacent code: `src/routes/desk.index.tsx` (home widget) and `src/routes/desk.published.tsx` (full table) share the same underlying `listMemory()` query and both lack a zero-state branch — one fix pattern, two call sites.
- User-facing: every editor's first weeks on a fresh newsroom, until enough stories accumulate beat history.
- Migration: none.
- Tests to update: none known.
- Related findings: none directly, but part of the same "most states are designed, a few aren't" pattern also visible in UX-001's chrome.

**Fix path**
Add a zero-length branch to both renders. Suggested copy for the home widget: *"No beat memory yet — it builds as you publish."* For the `/desk/published` table, replace the bare header-only table with a single row spanning all columns: *"Nothing tracked yet. Beat memory fills in once a story publishes and mentions an entity."*

---

### [UX-003] — Major — Journey/Pattern — Public-facing "Create Editor" CTA competes with the masthead as the first thing a mobile visitor sees

**Evidence**
`/` at 375×812: the header row is "INDEPENDENT CIVIC REPORTING · LONGMONT" (small caption) directly followed by a full-width, high-contrast black "CREATE EDITOR" button — visually the single strongest element on the entire first screen, ahead of the "TownReporter" wordmark itself which sits below it.

**Why this matters**
This is a reader-facing civic news site; its primary visitor is someone looking for local reporting, not someone about to claim the newsroom. On desktop the same button ("Editor desk") is a small secondary pill, correctly subordinate — the mobile layout's font/width scaling has accidentally promoted it to the most prominent element on the page. A first-time mobile reader's eye goes to "Create Editor," not to the paper.

**Blast radius**
- Adjacent code: shared public header component (same component flagged in UX-001), so this is one CSS/layout fix, not per-page.
- User-facing: every mobile visit to any public route.
- Migration: none.
- Tests to update: none known.
- Related findings: UX-001 (same header, same viewport range).

**Fix path**
On mobile, demote this control to match its desktop treatment — a smaller, secondary-weight button (or fold it into the collapsed nav from UX-001) rather than a full-width black CTA. Reserve full-width black buttons on mobile for the actual primary action of a screen (e.g., "File lead," "Run scan" inside the desk).

---

### [UX-004] — Minor — Accessibility — Focus indicator on plain-text topbar links is hard to confirm visually at default zoom

**Evidence**
`src/styles.css:77-80` defines a global `:focus-visible { outline: 2px solid var(--color-rust); outline-offset: 2px; }`, which is a correct baseline. Tabbing through the desk topbar ("editor" account link, "Sign out") via keyboard in the live instance did not produce a visually obvious ring in a standard screenshot at 800×450 — the 2px rust outline against the cream background may be present but is thin relative to typical link tap/click targets, and several form inputs override with `outline: none` in favor of a border-color-only change (`src/styles.css:656, 711`), which is a subtler cue than an outline.

**Why this matters**
This is not confirmed as a Blocker-level "invisible focus" — the CSS rule exists and is themed sensibly — but it is exactly the kind of thing worth a deliberate look rather than an assumption, especially on the desk inputs where focus is communicated only by border color (a ~1px shift), which is a weaker signal than an outline for users tracking focus by peripheral vision.

**Blast radius**
- Adjacent code: all `.desk-ltr` form inputs (`src/styles.css:654-656`, `:710-711`) share the outline-none-plus-border-color pattern.
- User-facing: any keyboard-only user navigating desk forms.
- Tests to update: none known — no automated focus-visibility test found.

**Fix path**
Keep the border-color change but retain (don't suppress) the outline on desk inputs, or thicken/offset it further for that specific dark-on-cream context; verify with a real screen magnifier or axe DevTools focus-order overlay rather than a scaled screenshot before deciding this is resolved either way.

---

### [UX-005] — Minor — Responsive — Topic filter chips wrap to a dense 3-row block on mobile before content

**Evidence**
`/` at 375×812: nine topic-filter chips (ALL/COUNCIL/BUDGET/HOUSING/UTILITIES/SCHOOLS/PLANNING/INFRASTRUCTURE/ELECTIONS/OPINION) wrap across 3 rows immediately above the first story. Each chip is comfortably ≥44px tall (good touch target), but the block itself is a wall of low-signal boxes a reader must scroll past.

**Blast radius**
- Adjacent code: same header/filter component as UX-001; likely a single combined fix.
- Related findings: UX-001 (same fix, same component family).

**Fix path**
Convert to a single-row horizontally-scrollable chip strip on narrow viewports (common in modern content-filter UIs), or collapse behind a "Filter" toggle.

---

### [UX-006] — Minor — Copy — Sign-in error message quietly assumes the reader knows what "Grok" refers to

**Evidence**
`src/routes/login.tsx:147`: `"No editor account with that email yet. Use Create editor account — this is not your Grok password."` This string is otherwise strong (specific, actionable), but the parenthetical reference to "Grok" will read as a non-sequitur to any operator of this self-hosted paper who isn't already aware of the platform's own naming/branding context baked into this template.

**Why this matters**
Confuses rather than clarifies for the exact audience (a newly self-hosted editor) this message is trying to help.

**Fix path**
Drop the Grok-specific clause unless this build is deliberately deployed on that platform: *"No editor account with that email yet. Use Create editor account to set one up."*

---

### [UX-007] — Minor — Copy — "server" desk nav item is the only non-obvious, jargon-flavored label in either nav

**Evidence**
`/desk` primary nav: DESK / SOURCES / SCAN / QUEUE / PUBLISHED / OPINION / **SERVER** / DARK DESK. Every other label maps directly to a reporting concept a newsroom editor would recognize; "Server" (verified as `desk.ops.tsx` in the route list) breaks that pattern and reads as an engineering label that leaked into editorial chrome.

**Fix path**
Rename to something in the newsroom's own voice consistent with the rest of the nav — e.g., "Ops" or "Health" — reserving "Server" for a sub-heading inside the page if the underlying content is genuinely infrastructure-facing.

---

### [UX-008] — Nit — Pattern — Dark Desk's night-panel accent color choice

The `.nightpanel` dark, near-black card inside an otherwise light desk home is a nice bit of "this lane behaves differently" signaling (investigates, never prints) — flagged here only as a nit because the accent could be pushed further (e.g., a distinct type treatment) to make the "this is a different mode" read even faster at a glance; not a defect as-is.

### [UX-009] — Nit — Copy — "Editorials run unsigned…in the headline and the receipts at the end" — dense single sentence

`/desk/opinion` intro sentence packs three separate facts (unsigned, drafts are editable, published pieces aren't) into one long clause. Splitting into two short sentences would read faster without losing any of the good, specific detail.

---

## States audit matrix

| Component / page | Default | Loading | Empty | Error | Partial | Notes |
|---|---|---|---|---|---|---|
| `/desk` home — Queue | ✓ | ✓ (skeleton) | ✓ | ✓ (ScreenError, verified) | — | UIUX-02 fix confirmed live |
| `/desk` home — Dark Desk | ✓ | — | ✓ | — | — | On-voice empty copy |
| `/desk` home — Wire/scan | ✓ | ✓ (Busy label) | ✓ | ✓ (inline warn) | ✓ | Handles zero-leads-filed distinctly from failure |
| `/desk` home — Beat memory | ✓ | — | ✗ | — | — | UX-002 |
| `/desk/published` — Beat memory table | ✓ | — | ✗ | — | — | UX-002 (worse: bare table) |
| `/desk/scan` | ✓ | ✓ | ✓ | not observed (no failing source in fresh DB) | — | |
| `/desk/queue` — lead form | ✓ | ✓ (disabled during submit) | ✓ | native validation only | — | |
| `/desk/opinion` | ✓ (voice-warning gated) | — | n/a | not observed | — | UIUX-05 fix confirmed live |
| `/login` | ✓ | ✓ | n/a | ✓ (10s timeout → retry) | — | UIUX-02 fix confirmed live |
| `/corrections` (public) | ✓ | not observed | ✓ (delightful) | not observed | — | |
| 404 | ✓ | n/a | n/a | n/a | n/a | Clear, two recovery paths |

## Accessibility snapshot

- **Keyboard navigation:** Reachable via Tab in the flows tested (login form, desk topbar, queue form). Full tab-order audit of the Dark Desk investigation UI was not completed (empty DB, complex nested UI not exercised).
- **Focus visibility:** A themed global `:focus-visible` rule exists (`--color-rust` outline) but reads faintly in screenshots at default scale on plain-text topbar links; desk form inputs substitute a border-color change for the outline entirely. See UX-004 — flagged for a closer look, not confirmed broken.
- **Color contrast:** Sampled `--color-muted` on `--color-paper` (~5.6:1) and `--color-rust` on `--color-paper` (~7:1) — both pass WCAG AA for normal text. Full palette (dark mode variant, `--warn`/danger red) was not independently measured.
- **Screen reader labeling:** Not tested with actual assistive tech this pass; the aria-live `#desk-announcer` region from UIUX-03 was not re-verified with a screen reader running, only structurally present per the audit brief's account of the prior fix.
- **Reduced motion:** Not assessed — `prefers-reduced-motion` handling was not found or ruled out via a narrow grep and needs a dedicated look; not claiming absence.
- **Touch target size:** Filter chips and nav items measured comfortably above 44×44px on mobile; the cramped element is the *aggregate* screen space they consume (UX-001, UX-005), not individual target size.

## Patterns and systemic observations

The product's strongest pattern is **state-aware copy that explains itself** — "Queue is empty — run the first scan or file a lead," "No corrections posted… we would rather look careful than look first," the 10-second login stall handling. That pattern is applied almost everywhere. The two gaps found (UX-002 Beat memory, and by inference anything else not walked live) suggest the fix is not "learn the pattern" but "apply the pattern that's already used correctly elsewhere to the last couple of widgets that were missed."

The second systemic issue is that **responsive design appears to have been treated as "does it not break" rather than "was it designed for."** Nothing clips or overflows destructively at 375px — everything remains readable — but the information architecture (full desktop nav, un-collapsed) was carried down rather than rethought, which is the "stale convention" flavor of finding the methodology asks to name explicitly (UX-001, UX-003, UX-005 are one root cause wearing three faces).

## Appendix: surfaces reviewed

- Live, isolated instance at `http://127.0.0.1:3196` (fresh in-memory DB): `/`, `/login`, `/desk`, `/desk/sources`, `/desk/scan`, `/desk/queue` (+ lead form disclosure, empty-field validation), `/desk/opinion`, `/desk/published`, `/corrections`, unmatched-route 404. Viewports: desktop (~800×450 pane) and mobile (375×812).
- Source read in full: `src/routes/desk.tsx`, `src/routes/desk.index.tsx`, `src/routes/login.tsx`, `src/styles.css` (focus, color tokens, `.desk-ltr` component styles).
- Route inventory reviewed but not walked live: `desk.dark.tsx`, `desk.memory.tsx`, `desk.ops.tsx`, `desk.story.$leadId.tsx`, `desk.story.draft.$draftId.tsx`, `evidence.$versionId.tsx`, `evidence.compare.tsx`, `articles.$slug.tsx` (empty DB had no populated instances to exercise).
