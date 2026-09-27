# Next TownReporter patch — the story workbench, laid out as drawn (unit BH)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or any live-model result. **No model was loaded, unloaded or called to write it**, in code or in a test.

## What changed

The redesigned story workbench, in the order the drawing puts it, on `src/routes/desk.story.$leadId.tsx`. No migration, no new scheduled task, service or program, no new route.

### 1. One column, in the drawn order

Before: the top bar, then the lead's context line as a caption *inside* the lead panel, then the two-column `420px | 1fr` grid with the inspector tabs on the left and the writing surface on the right. The context line was in the wrong row — the drawing gives it its own row under the top bar, above the stage stepper (the v3.1 fix).

Now: top bar with **← Today**, the context row on its own line (the lead's caption plus its status chip), the stage stepper, and then `420px | 1fr`. The left panel keeps its **Checks · Sources · Reporting** tabs and their existing content unchanged; the right is the writing surface — writer row, headline box, summary, story, the saved time, and the action row.

The stepper is derived, not stored: `Lead → Draft → Check → Publish`, each stage's tick read from what the page already knows (`data.draft`, the evidence-check verdict, `onPaper`), and the first unfinished stage marked as the current one. `checkClear` requires a draft, no stale evidence, no open claims, no reconcile in flight and no review fetch pending, so a stage cannot read done while the thing that decides it is still moving.

### 2. A full `JobCard` under the actions

Phase 3's `JobCard` / `useDeskJobs()` replace the old progress text while a check or a redraft runs. `StoryCheckJobProgress` (new, in `src/components/JobCard.tsx`) is the evidence-check twin of the existing `StoryJobProgress`: same card, same 2 s poll, filtering `kind === "reconcile"` for this lead instead of `kind === "draft"`. It is deliberately the same component with one field changed, because the two jobs this page can run at once are the same kind of thing.

No `initial` prop on the check card: the page's own `data.job` row is the draft job, and the reconcile row arrives from the same poll `DraftReconcileControl` already runs. A second fetch would be two requests for one row.

### 3. The sticky publish bar

The bar keeps 0.6.67's rule — the section is confirmed in the same press that prints, and phase 1's area select is still at publish — and carries the gate chips (`Saved`, `Evidence checked`, `N names to review`, `Preview viewed`), each ticked or flagged from the same derived state the stepper uses. Measured in a real viewport scrolled to the end of the document: `top: 754, bottom: 830, viewportHeight: 900, scrollY: 3241` — the bar is on screen at the bottom of a 3,241px page, in both appearances.

### 4. One hit target fixed

`change` (the section picker) is a standalone action in the publish row, not a link inside a sentence, so the design system's 44px minimum applies. Measured before: **22px** tall — the only control this unit introduced that was under the minimum. The class had no CSS rule at all; `grep -rn "publish-section-change" src/*.css` found only the new rule and `grep -n "astra-publish-section-change" src/routes/desk.story.$leadId.tsx` found the one usage.

## What this unit did not do, and why

**The six "existing dialogs" are not dialogs today.** The brief's item 2 is written as though Correction, Legal removal, Redraft, Compare versions, Kill and More ▾ already exist as dialogs on the phase-0 `Dialog`. Probes on this commit:

- `grep -rn "astra-dialog" src/` found two native `<dialog>` elements — `src/components/desk-chrome.tsx:343` (lane 3's file, do-not-edit) and `src/routes/desk.story.$leadId.tsx:2465` (the story preview) — and nothing else.
- `grep -n "components/dialog" src/` found no importer of the phase-0 `Dialog`; the only hit is its own comment in `src/styles.css:1964`.
- Correction is an inline form on `src/routes/desk.published.tsx` (`addCorrection`, `suggestCorrectionWording`).
- Legal removal is a whole route, `src/routes/desk.legal-removals.tsx`, with its policy radio and REMOVE-to-confirm inline.
- Compare versions is the `<details className="evidence-check-review">` inside `src/components/draft-reconcile-control.ts`, and its words already match the drawing exactly.
- Kill on the story page is only `killAsDuplicateOfPrior` (`setLeadStatus({status:"killed", killReason, killReasonUrl})`); there is no plain kill control.
- More ▾ is `DeskMoreMenu`, which is not on `4325c4fa`.

Turning an inline form into a dialog where it stands is a restyle; turning a **whole route** into a dialog, or **adding** a kill control that does not exist, is new behavior — and the brief puts behavior that does not exist yet in phases 4 and 6. That is an owner decision, not something to guess at, so it is written up in `questions/BH.md` and item 2 is not built here.

## Targeted evidence

- `node scripts/with-app-env.mjs npx vite build` — **exit 0.**
- `node --test scripts/draft-batch-result-render.test.mjs scripts/job-card-render.test.mjs scripts/lead-badge-render.test.mjs scripts/meeting-source-block-render.test.mjs scripts/claims-of-absence-gate.test.mjs scripts/desk-uiux-pins.test.mjs scripts/desk-cc-grid-min-width.test.mjs` — **81 tests, 81 pass, 0 fail, exit 0.**
- `node --test src/components/draft-reconcile-control.test.ts src/components/headline-control.test.ts src/lib/news/desk-copy.test.ts` — **137 tests, 23 suites, 137 pass, 0 fail, exit 0.**
- `node scripts/bh-evidence-walk.mjs` — the built server on a free port, one real lead filed through the Queue, photographed at 1280 light, 1280 dark and 390 light: `scrollX 0` in all three, nothing informational under 14px in any of them, `consoleErrors: []`, and the publish bar pinned at the bottom of the document in both appearances. Output in `evidence/BH/`.
- The page's hidden `h1` keeps its old words. The drawn top bar draws no title — only the way back and the stepper — so the heading that used to be visible became screen-reader-only rather than being rewording; the first draft of this unit called it "Story workbench" and three existing walks (`redraft-scan-e2e.mjs`, `story-quota-failover-e2e.mjs`, `custom-api-ui-acceptance.mjs`) look the page's heading up by accessible name, so it reads "Story workspace" again, which is also the shell's own crumb for this route. Nothing visible changes either way.

The workbench's drawing is `docs/design/handoff-2026-09-26/design/Desk Story.dc.html`; the captures compared against are `desk-04-story-checks-dark.png`, `desk-05-story-ready-reporting-light.png` and `desk-06-story-checking-sources-dark.png`. Every visible difference that was left in place is listed, with its reason, in the unit report.
