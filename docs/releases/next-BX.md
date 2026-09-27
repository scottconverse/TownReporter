# Next TownReporter patch — the front page after the designer's first round

**State:** Candidate work in progress. This document does not assert a release,
a tag, a GitHub publication, a production deployment, or a live-provider
result. No version was bumped.

Twelve things the designer asked for on the public front page. Nothing else on
the desk changed. No migration, no new route, no new scheduled task, no new
service, no new port, and no model was called or loaded to build or check any of
it.

## "This week" was empty beside stories that named dates

The live front page printed an empty **This week** panel while the stories
underneath named Oct. 1 (a hearing), Oct. 3 (an event), Oct. 6 (a second
reading) and Sept. 29 (a deadline) in their own headlines and evidence
appendixes.

The panel reads one structured date per recorded source, `document_date` — the
day the record itself bears, which is the day a reader can go and check.
`report.ts` writes that field as `String(o.document_date ?? "")`, whatever the
scanner sent, so it is free text. The reader that pulled those rows into the
panel accepted only a value that **started with** an ISO `YYYY-MM-DD`. Every
written date — the shape a captured agenda, notice or filing actually carries —
was skipped without a word. The dates were in the rows; the reading of them was
the defect.

`structuredDate` (`src/lib/story-dates.ts`) now reads the forms a document
bears: `2026-10-01`, `October 1, 2026`, `Oct. 1, 2026`, `Thursday, October 1st,
2026`, `1 October 2026`, and `10/1/2026` — with an optional weekday and ordinal
suffix, and numeric read month-first the way this paper writes dates, unless the
first number cannot be a month ("17/10/2026"). The two rules that were there
before are kept:

- A value that names **no day** — "early September", "September 2026", "last
  week" — is still skipped. The panel never prints a date no printed story
  reports; a short honest panel beats a guessed one.
- A day with no year ("Sept. 29") is resolved against the window's first day,
  which the front page passes. With no reference day it is skipped, never
  guessed. A day that does not exist ("2026-02-31") is refused by a round trip
  through the calendar rather than rolled forward into 3 March.

When there is genuinely nothing due, the panel is not rendered at all: the lead
runs the full width of the row and nothing on the page explains the absence.

## "Around the region" hides the same way

When no ground outside the home town has a printed story, the band is not
rendered, the Opinion block takes the full width, and no sentence stands in for
the missing half. Both halves still share one row when both are present. The
Opinion block, likewise, is only drawn when the paper has an printed opinion
piece to draw.

## Readers never see the word "misc"

A story filed in the catch-all section used to print its section tag — "misc" —
on the front page grid, in **Latest stories**, on the article page's breadcrumb
and on section lists. It now prints no tag anywhere on the reader's side. The
desk keeps its own labels: the Queue, the section picker and the editor's
sections are untouched, and a `misc` section is still a real section an editor
can file into.

## Small corrections on the page

- A grid cell said "1 read", "3 read". It says "1 min read", the same words the
  lead uses.
- The Opinion block on the front page printed "OPINION: A Libertarian case for
  the rail tax" inside a block already titled Opinion. It now prints the
  headline alone. This is display only — the stored headline is never rewritten,
  and the desk still shows it exactly as filed.
- **Latest stories** prints six stories and then an "All stories →" link to the
  existing all-stories page. "Load more stories" is gone from the front page;
  the archive page still pages through everything.
- Each latest-stories row printed its date twice — once above the headline,
  once in the meta line. It prints it once, in the meta line, which also
  carries the reading time.
- The county pill said "County" on a paper whose owner had configured a county.
  `useAreaLabels` never passed the configured county to the label builder, so
  the argument was always missing. It passes it now: a configured county prints
  as configured ("Boulder County"), and an unset one still prints "County".
- Three strips came off the front page: "Find your way around.", "A little
  easier on the eyes." and "Your community. An open record.". Text size stays in
  the top bar and About stays in the footer, so nothing became unreachable.
- **"Useful around town"** was removed, and its two links — City Council Votes
  and Utility Bill Analyzer — moved into the footer. No link was dropped.
- The strip "Reporting you can trace to the record / Corrections in the open /
  How we report" is kept as it was.

## The phone

At 390 px the top bar no longer wraps to three rows; it fits in two, with the
action buttons keeping their 44px targets and their labels moving to icons. The
geography pills are one row that scrolls sideways instead of wrapping to
several, with the same four labels in the same order and the scrollbar hidden.

## The stage fixture no longer reads the machine's pointer

`scripts/ci-stage-start.ps1` scenario 4 read `%LOCALAPPDATA%\TownReporter\
staged-copy.json` — the real machine's record of where the staged copy lives —
so it passed or failed depending on whether this machine had ever staged a copy,
and failed on any machine that had. The fixture now points `LOCALAPPDATA` at a
folder inside its own temp world for the whole run and restores the real value in
`finally`, the way `scripts/ops-scripts.test.mjs` already requires of another
fixture. `ops-scripts.test.mjs` asserts that wiring, so a later edit that drops
it fails the suite rather than silently going green on the fixture's own
machine.

## What is proved, and how

Every number below is from a command run in this working copy.

- `node --test scripts/ops-scripts.test.mjs` — exit 0, 59 tests, 59 pass, 0 fail.
- `node scripts/with-app-env.mjs node --test` over `story-dates`, `story-area`,
  `section-types` and `editorial` — exit 0, 77 tests, 77 pass, 0 fail; and over
  the two paper-identity files, which item 6 reaches — exit 0, 12 tests, 6 pass,
  6 skipped (the end-to-end half skips without a database), 0 fail.
- `scripts/front-page-river-e2e.mjs` — exit 0.
- `scripts/paper-panels.mjs` — exit 0.
- A Playwright walk over the built server — exit 0, 113 expectations, 0 failed.
  It seeds its own rows into an in-memory database, checks the page it is about
  to measure really is the page it seeded, and photographs the front page at
  1440 and 390 px in light and dark into `evidence/BX/`.
- `typecheck` exit 0, `typecheck:test` exit 0, `lint` exit 0,
  `node scripts/with-app-env.mjs npx vite build` exit 0.

**Red before green.** With the released `src/lib/story-dates.ts` restored, the
new story-dates test exits 1 — actual `[]` against expected
`['2026-09-29','2026-10-01','2026-10-03']` — which is the live empty panel as a
unit test. With this version it exits 0.

## Limits

- The database in every check above is a database these checks built in memory.
  The brief's throwaway-cluster source is off limits to this work (the project
  brief forbids the backup directory it lives in), so **no claim here was
  measured against the live paper's own rows**. What the live rows hold is read
  from `report.ts`'s own coercion of `document_date` and from the story text the
  brief quotes, not from a dump.
- The design assets named in the brief do not exist under
  `docs/design/redesign-v2-2026-09-26/`; the drawings used are the ones in
  `docs/design/handoff-2026-09-26/`.
- The phone-width rules were measured on the built page at 390 px. Nothing in
  this change was checked against a real phone.
