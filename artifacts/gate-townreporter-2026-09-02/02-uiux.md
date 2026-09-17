# 02-uiux — UI/UX Designer deep-dive — TownReporter v0.6.3

Role: UI/UX Designer (GauntletGate Full lane). Builds on the Walkthrough lane's report
(`00-walkthrough.md`) — its findings are referenced by number, not re-walked. Own dev server
run on port 3324 only (PGLite, fake CLIs, `TOWNREPORTER_CLAUDE_CODE=1`), stopped by PID
(50756) when done; production and the shared ports (3000/5432/5433) were never touched.

**Severity counts:** 0 Blocker · 0 Critical · 2 Major · 2 Minor · 1 Nit.

---

## Findings

### UIU-01 — Major — The "Large" text-size accessibility control breaks the shared masthead layout at 1280px
- **Category:** Interaction states / responsive layout / accessibility self-defeat
- **Route:** Every desk page (shared masthead), observed on `/desk/ops` (Server) at 1280×900, matching the brief's flagged-known area.
- **Evidence:** in-conversation screenshots at 1280×900 (not saved as files — see "What I could not assess"): baseline (single-line header) vs. after clicking "Large" (header reflows). Confirmed via computed styles: `--ts` goes from `1` to `1.125` (`.desk-ltr.large`, `src/styles.css:476`); `.mast-row` is `display:flex;align-items:baseline;gap:24px;flex-wrap:wrap` (`src/styles.css:549`) and `.mast-date` is `flex:1;text-align:center` (`src/styles.css:569`) with no `min-width`/`flex-basis` guard.
  - **Observed:** at Normal scale the masthead ("TownReporter · Editor's desk · Thursday, September 3, 2026 · View paper · Light/Dark · Text: Normal/Large · avatar · Sign out") renders on one line. Clicking "Large" (the text-size control meant for exactly this "old eyes" persona) grows every `--ts`-scaled string, and the centered `mast-date` cell — squeezed between the fixed-width left brand group and the fixed-width right tools group — reflows onto **three** stacked lines ("Thursday, / September / 3, 2026"), which taller-than-its-neighbors cell then pushes the whole `.mast-row` height up and breaks the baseline alignment the other cells were set with.
  - **Expected:** the row that exists specifically to host the accessibility text-size toggle should not itself degrade when that toggle is used.
- **Why it matters:** this is the shared chrome on every authenticated page, so the defect is systemic, not page-local — and it fires specifically when a user reaches for the app's own low-vision accommodation, which is a worse failure mode than an ordinary responsive bug.
- **Impact scope:** all desk routes (Desk, Sources, Scan, Queue, Published, Opinion, Server, Dark Desk) at the operator's stated 1280px reference width, any time Large text is active — which, per this app's persisted "Text: Normal/Large" toggle (confirmed sticky across navigation in this session), is durable, not a one-off click.
- **Fix path:** give `.mast-date` a `flex: 0 1 auto` with `white-space: nowrap` (or a fixed-width reservation sized off the longest formatted date string at `--ts: 1.125`), or drop it out of the centered-flex slot entirely at the two-line breakpoint rather than letting it compress. Add a Playwright viewport test at 1280×900 that toggles Large and asserts `.mast-row` stays single-line (`getBoundingClientRect().height` below a threshold, or count of distinct `top` values among mast-row children === 1).
- **Suggested test:** `tests/` visual/layout assertion described above, run in both themes.

### UIU-02 — Major — Text-input borders use a contrast pair the app's own audit marks "decorative, not asserted" — 1.56:1 (light) / 1.54:1 (dark), on the first screen a new user sees
- **Category:** Accessibility (WCAG 1.4.11 non-text contrast) / visual hierarchy
- **Route:** `/login` → "Create the desk" (first-run account form) — same token is reused wherever the app's default bordered `<input>` styling applies.
- **Evidence:** in-conversation screenshots of `/login` "Create the desk" at 1280×900 (not saved as files — see "What I could not assess"): full page (the four form fields are effectively invisible against the page background at normal viewing distance) and a closer inspection of the same region (confirming the fields exist and are just very low-contrast). Computed style, verified live: `getComputedStyle(document.querySelector('input[type=email]'))` → `borderColor: rgb(207, 194, 172)` (`#cfc2ac`) on `background-color: rgb(246, 241, 231)` (`#f6f1e7`) — exactly the "hairline borders (`.rule1`, chip border, `.sechead`)" pairing that `scripts/contrast-audit.mjs` itself computes at **1.56:1 light / 1.54:1 dark** and explicitly labels `kind: decorative` / `verdict: N/A — decorative dividers, not asserted`.
  - **Observed:** the audit's own comment scopes that token to decorative dividers, but the shared `<input>` border in the app's global CSS draws on the same token, so it is *also* the boundary of a functional form control — the Name/Email/Password/Confirm-password fields on the very first screen an operator sees.
  - **Expected:** WCAG 2.1 SC 1.4.11 requires 3:1 for the visual boundary of an interactive UI component; a decorative-dividers exemption does not cover an `<input>` border.
- **Why it matters:** a low-vision user (exactly the "old eyes" persona named in the brief) cannot see where the text-entry boxes are without zooming or relying on placeholder text alone — on the one screen where getting the account-creation fields right matters most (typo in email/password here means a locked-out first account).
- **Impact scope:** every `<input>`/`<textarea>` styled with the default border token across the app (login, create-editor, paper-setup, and any plain form field that doesn't opt into a stronger `.desk-ltr` border color) — not isolated to one page.
- **Fix path:** give form-control borders their own token (reuse the `.meta`/`text-ink-2` foreground-family pair already proven ≥5:1 by the audit, or `--fg2`) distinct from the decorative-hairline token, and add that pairing to `scripts/contrast-audit.mjs`'s asserted table (not the `N/A` list) so a future change can't silently regress it.
- **Suggested test:** extend `scripts/contrast-audit.mjs` with an explicit "form control border" row asserted at the 3:1 UI-component floor, sourced from the actual `input`/`textarea` border rule rather than the decorative-divider rule.

### UIU-03 — Minor — Masthead "leave the desk" mini-flow hardcodes 12px text, falling under the app's own accessibility scaling and the operator's 14px floor
- **Category:** Copy/typography consistency, accessibility
- **Route:** Masthead → editor menu → "leave the desk" confirm (`.leave-editor`, `.leave-ask`, `.leave-yes`, `.leave-no`).
- **Evidence:** `src/styles.css:553-566` — `.desk-ltr .leave-editor { ... font-size:12px; ... }`, `.desk-ltr .leave-ask { ... font-size:12px; ... }`, `.desk-ltr .leave-yes, .desk-ltr .leave-no { ... font-size:12px; ... }`. Every sibling masthead rule in the same block (`.brand-sub`, `.mast-date`, `.mast-link`, `.mast-user`, `.mast-ver`, lines 551-575) instead uses `font-size:calc(<rem> * var(--ts))`, so those DO grow when "Large" text is selected; these three do not.
- **Why it matters:** this is both a below-floor size (12px, under the operator's explicit "nothing informational under 14px" rule) at Normal scale, and an accessibility-control miss — the one masthead control that doesn't respond when the user turns Large text on, in an already-terse confirm flow ("leave the desk?") that a user should be able to read clearly before confirming.
- **Impact scope:** the leave-the-desk confirm control only (three small, related rules) — narrow, not systemic like UIU-01.
- **Fix path:** switch the three rules to the same `calc(0.875rem * var(--ts))` (or `0.8125rem` to match the app's own already-established 13px-floor pattern, see cross-role note below) pattern used by their siblings in the same CSS block.
- **Suggested test:** extend `scripts/contrast-audit.mjs` (or a small companion assertion) to grep `src/styles.css` for `.desk-ltr` rules with a literal `px` font-size below `--ts`-scaled floor, so a hardcoded regression like this fails CI instead of requiring visual re-discovery.

### UIU-04 — Minor — Mobile responsive-table row-label prefixes render at 10px, muted, unscaled — the smallest and lowest-contrast text in the app, specifically on the 375px layout
- **Category:** Accessibility, mobile layout
- **Route:** Any `.ltable` rendered under the mobile breakpoint (e.g. `/desk/sources`, `/desk/queue` list views at 375px — the "old eyes" and mobile checks named in the brief).
- **Evidence:** `src/styles.css:963-970`:
  ```
  .desk-ltr .ltable td[data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--mut);
    margin-bottom: 2px;
  }
  ```
  This is the CSS-generated field-name label ("SOURCE", "STATUS", etc.) that mobile responsive tables show in place of the (hidden) `<thead>` — informational text, muted color, at 10px, with no `--ts` scaling.
- **Why it matters:** this is the single smallest, lowest-emphasis text token found anywhere in the codebase during this pass, and it lands specifically on the mobile viewport the operator called out and on informational (not decorative) content — a per-row field label a reader needs to parse the table at all on a narrow screen.
- **Impact scope:** every responsive `.ltable` instance at mobile widths — narrow but recurring across list-style desk pages.
- **Fix path:** raise to at least `calc(0.75rem * var(--ts))` (12px floor, matching the app's already-established below-`text-sm` pattern) and consider a non-muted or higher-contrast color given the small size compounds the contrast risk.
- **Suggested test:** same CSS-lint style check suggested in UIU-03, extended to catch pseudo-element `font-size` declarations too.

### UIU-05 — Nit — The already-fixed `text-xs`/`text-[11px]` accessibility floor lands at 13px, one pixel under the operator's stated 14px floor
- **Category:** Typography consistency
- **Evidence:** `src/styles.css:505-520` — a documented, deliberate remediation (own code comment: *"Same story for the arbitrary-value / scale text-size utilities those pages use below the 14px floor (`text-[11px]`, `text-xs` etc.) — fixed via selector here... `text-sm` (14px) is already at the floor and left alone."*) overrides `.desk-ltr .text-xs` and `.desk-ltr .text-\[11px\]` to `calc(0.8125rem * var(--ts))` — 13px at Normal scale, 14.625px at Large (verified live: computed `font-size` on the Server page's "Installed"/"Not installed" status label read `14.625px` with `--ts: 1.125`).
- **Why it matters:** this is credited work (see What's Working) that correctly makes the smallest Tailwind utility text scale with the accessibility control and reads at a healthy size once Large is on — it just stops one pixel short of the 14px floor the same comment names, at the default (Normal) scale, on informational text including the page's most important status word ("Installed"/"Not installed").
- **Fix path:** bump the override from `0.8125rem` (13px) to `0.875rem` (14px) to match `text-sm`'s already-correct floor. One-line change, no layout risk expected given the pattern is already proven elsewhere in the same file.
- Not counted as Major/Minor because the gap is 1px, on text that is otherwise legible, and the surrounding engineering discipline (a documented, --ts-aware, centrally-patched fix) is exactly the right shape of remediation — this is a "finish the job" nit, not a defect.

---

## Cross-role notes

- **UIU-01 and UIU-03/04** are pure CSS defects with no existing automated coverage — `scripts/contrast-audit.mjs` proves color pairings are asserted and machine-checked, but there is no equivalent for font-size floors or masthead layout at the Large-text scale. Recommend a Test Engineer follow-up: a small `node:test` (mirroring `contrast-audit.mjs`'s own pattern of parsing `src/styles.css` rather than hardcoding) that fails if any `.desk-ltr` rule sets a literal-px `font-size` below the `--ts`-scaled 14px-equivalent floor. This would have caught UIU-03 and UIU-04 automatically and prevented UIU-05 from drifting further.
- **UIU-02** is a docs/process gap as much as a code one: `scripts/contrast-audit.mjs`'s own comment scopes the failing pairing to "decorative dividers, not asserted" — the audit is accurate about what it checks, but the CSS it's auditing reuses that same token for a non-decorative purpose (input borders) that the audit doesn't know to check. Recommend adding the form-control-border pairing as a new asserted row (see fix path above) rather than only fixing the CSS — otherwise a future refactor can silently reintroduce this exact gap and the audit will keep reporting green.
- **First-run relevance:** UIU-02 sits directly on the walkthrough's verified first-run path (`00-walkthrough.md` §1, "Create the desk") — it does not block the flow (the walkthrough correctly found no dead end; fields work once found, and placeholder text plus label text still orient a sighted user), so it does not upgrade to a first-run Blocker per the shared backbone's definition, but it is the first thing a low-vision new user's eyes fail to find.

---

## What's working

- **Focus visibility is real and consistent.** Tabbing through the Server page in a live browser showed a solid `2px` dark outline (`outline: solid 2px rgb(28, 20, 16)`) on every interactive element checked (skip link, brand link, view-paper link, theme/text-size buttons) — no `outline: none` traps found in this pass.
- **A "Skip to desk" skip-link exists and is the first tab stop** — correct pattern, not just a token effort.
- **Live regions are genuinely wired, not decorative:** `desk.ops.tsx:385` and `desk-chrome.tsx:206` carry `role="status" aria-live="polite"` announcers, and `components/states.tsx` has a deliberate, commented distinction between `role="status"`/`aria-live="polite"` (routine) and `aria-live="assertive"` (errors) — this is the kind of state-change accessibility work that's easy to skip and wasn't skipped here.
- **`scripts/contrast-audit.mjs` is a strong, self-updating asset**, not a one-time screenshot check: it parses the desk's actual CSS custom properties out of `src/styles.css` rather than hardcoding hex values, so a token color change is re-audited automatically. Running it live: **every asserted text-color pairing it defines passes WCAG AA in both light and dark theme** (12 pairings checked, 12 pass) — the false-color "Killed tab" regression this script's own docstring says it was built to catch (small, fixed light-mode-brown-on-dark-background text as low as 1.4:1) is fixed and is now guarded by CI.
- **The `text-xs`/`text-[11px]` remediation** (`src/styles.css:505-520`, see UIU-05) shows real engineering discipline: a documented root-cause fix, centrally patched via selector rather than touching every owning file across sibling worktrees, that correctly participates in the `--ts` accessibility scale.
- **The mobile (375px) layout of the Server page stacks cleanly** with large touch targets and no overlap — confirmed live, not just from the walkthrough's screenshot, including with the "Large" text-size setting active and correctly persisted across navigation.
- **The dependency-absent guided-error copy** (Draft/Scan/Dark Desk/Opinion, per Walkthrough Finding set) reads as genuinely helpful UX writing, not boilerplate — specific next steps per surface, plus a fully-offline fallback on Opinion. Credited here as the copy/UX half of that first-run rule the shared backbone exists to demand.

## What I could not assess and why

- **Full keyboard-only task completion** (tab through an entire real workflow — e.g., file a lead → draft → publish — using only the keyboard, no mouse) was not attempted end to end; only spot-check focus-visibility and tab order on two pages (Server, Create-the-desk) were verified live. A full keyboard-only pass across Queue/Scan/Opinion would need its own timeboxed session.
- **Screen-reader output** (NVDA/VoiceOver) was not run — aria/role/live-region wiring was verified by reading the DOM and computed accessibility tree, which is a reasonable proxy but not the same as an actual screen-reader pass.
- **Dark-theme visual inspection of UIU-01 and UIU-02** was not captured as a separate screenshot (the underlying CSS/computed-style evidence for dark mode was pulled from `contrast-audit.mjs`'s own dark-theme rows, which is why UIU-02 cites both the 1.56:1 light and 1.54:1 dark ratios, but no dark-mode screenshot was saved).
- **Screenshots for UIU-01 and UIU-02 were inspected live in-session (browser screenshot + zoom + computed-style JS) but not exported to on-disk files** — this session's browser tooling did not provide a save-to-disk path for them, so `artifacts/02-uiux/` has no image files for this pass. The computed-style values quoted in both findings (border/background RGB, `--ts`, font-size) were pulled directly from the live DOM via `getComputedStyle`, which is the more load-bearing evidence for both findings; the visual description is corroborating, not the sole proof.
- **Every desk route was not walked at 1280px with Large text active** — UIU-01 was confirmed on the Server page (the brief's named example) and reasoned to be systemic because the masthead markup and CSS are shared chrome across all desk routes, not because each route was individually screenshotted.
