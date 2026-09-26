# Next TownReporter patch — unreleased (Unit BA, redesign phase 0)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or a promoted candidate. Phase 0 of the redesign lays foundations only: no screen changed layout and no new screen was added.

## What an editor sees change

### Dark mode is one warm black, on the desk and on the paper

Dark mode used to be pure black behind pure white. It is now a warm near-black
ground (`#1b1916`) with warm off-white text (`#e8e6e1`), and panels sit one step
up from the ground (`#27231f`) instead of blending into it. **The same pair is now
used by the desk and by the public paper**, so switching between them no longer
looks like two different products.

This is the change you will notice first, and it is the whole point: a page of
white on black is a flashlight at midnight; warm off-white on warm black is a
page. Light mode keeps its cream ground (`#fffdf7`) and its ink (`#111111`).

### "Checked, nothing changed" no longer looks like "could not check"

The desk had collapsed the design's two state colors into one, so every
attention state painted the same red as a failure. Amber and red are now two
distinct colors in **both** themes:

| | light | dark |
|---|---|---|
| attention (`--warn`) | `#8a4b00` | `#f0b27a` |
| failure (`--danger`) | `#b3261e` | `#f0998c` |
| nothing changed (`--ok`) | `#1e6b34` | `#9fd4a8` |

and the three notices now carry three different shapes, not three different
words with the same border:

- **Could not check / failed** — `Note` and error notices get a **2px dashed red**
  border. Dashed means the check did not finish.
- **Attention** (held, expiring soon, needs review) — a **2px solid amber** border.
- **Checked, nothing changed** — a **1px solid green** border.

"Could not check" and "checked and nothing changed" can no longer be mistaken for
each other at a glance, which is rule 3 of the design rules the desk is held to.

### The type is Bricolage Grotesque and Literata, and it does not phone Google

Headlines and UI use Bricolage Grotesque (500/700/800); body text uses Literata
(400/500/600 roman and 400 italic). Both are now **self-hosted** — 14 `woff2`
files served from this app. No request to `fonts.googleapis.com` leaves the app
any more, so the desk and the paper render in the intended faces on a machine
with no internet, and nobody's reading habits are reported to a third party. The
build-time fetcher (`scripts/fetch-fonts.mjs`) is the one place the upstream URLs
survive; it is not part of what a browser loads.

Fraunces and Source Serif 4 are gone from `public/fonts`. The old names survive
only in historical design documents, which record what the desk used to be.

### The shared parts have one look

Buttons, chips, notices, skeletons, empty states, pending and error screens were
restyled in place to the design system's vocabulary — one button family, one chip
family, one notice — without removing a single prop or export. Editors see:
consistent button heights (nothing below 44px), square corners throughout, and
chip colors that say what they mean (a failed chip is dashed red, a held chip is
solid amber, a `✓` chip is outlined green).

### A shared dialog, ready for phase 2

There is now one `Dialog` and one `ChoiceCard` in `src/components/`, built on
Radix, with the design's 820px panel, 2px border and the one drop shadow the
design system allows. **No screen uses it yet** — moving the desk's existing
dialogs onto it is phase 2. It is here so that phase 2 has one target instead of
several. It traps focus, closes on Escape, locks the page behind it and returns
focus to where it opened from, and there is a test that proves all three.

## Foundations, not layout

Phase 0 replaces values, not structure. No screen changed its layout, no screen
was added, no navigation changed, and there are no backend or migration changes.
If a page looks different, it is because a color, a typeface, a border or a
spacing token underneath it changed — not because the page was rearranged.

**Limits.** The redesign is not complete: phase 2 has to move the existing
dialogs onto the shared `Dialog`, and the rest of the design system's component
vocabulary is not yet in the product. The dark theme's contrast was measured by
`scripts/contrast-audit.mjs` over the desk's tokens in both themes, not over every
screen; the four screenshots in the unit's evidence folder are what was actually
looked at.
