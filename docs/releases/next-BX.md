# Next TownReporter patch — the front page after the designer's first round

**State:** Candidate work in progress. This document does not assert a release,
a tag, a GitHub publication, a production deployment, or a live-provider
result. No version was bumped.

Twelve things the designer asked for on the public front page. Nothing else on
the desk changed. No migration, no new route, no new scheduled task, no new
service, no new port, and no model was called or loaded to build or check any of
it.

A second round (unit BX2) followed the first onto the same page: the dates
panel was still empty on the live paper after the fix above, for a reason the
first round could not see from here. That round is in its own section below.

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

### The dates the stories name in their own words (unit BX2)

Fixing that reader was not enough. On the live paper's twelve newest published
articles the fix changed nothing, because there was nothing to read: every
record's `document_date` came across as `''`. The dates were not in the rows at
all — they were in the stories' own sentences:

- a headline, "… Applications Close **Sept. 29**"
- a headline, "…schedules **Sept. 26** canvassing day and **Oct. 3** Brighton
  event for 3C and 3D"
- a dek, "…sends the plan to an **Oct. 6** public hearing and second reading…"
- a dek, "…a posted **Oct. 1** funding hearing packet…"
- a headline, "…beginner DaVinci Resolve editing class for **Sept. 29**"

The sweep now has a second source alongside the records. It reads a
month-name day out of the story's **headline and dek** — not the body, which is
deliberate: a headline and a dek are the desk's own summary of the story and
carry one date each, while a body sentence mentioning a date in passing ("the
council last met on Aug. 12") is indistinguishable from one announcing an event
without reading it closely enough to be wrong. A panel that stays short is
better than one that fills up.

The rules that keep that source honest:

- **Whole month names only.** The month alternatives are word-bounded and
  refuse a digit after them, so "Section 8", "Prop 123", "3C and 3D", "3D" and
  "the March 2026 packet" are read as no date at all, and a number that is not
  a real day of that month is refused.
- **The year comes from the story.** A day written with no year ("Sept. 29")
  takes the year of `published_at`; if that lands more than about two months
  behind the publish day the day is the coming year's. Filed in December, "Jan.
  5" means next January, not the one eleven months gone. A year written into
  the words ("Oct. 8, 2026") is the date's own and is never rolled.
- **One date per story per day.** A story that names the same day twice — in
  its headline and again in its dek, or in a record and again in its words —
  gets one line, and the record's own title is the better line.
- **Every line links to the story that named it.** A reader who wants to know
  why Oct. 6 is on the list can open the story that said so.
- **Nothing is invented.** A date outside the sweep's window is not printed,
  and a story naming nothing contributes nothing.

The same source now feeds the article page's own "Dates in this story" panel,
so a reader on the story sees the day it named. There the row carries no link:
it would point at the page the reader is already on.

### Four of ten lines read wrong on the live paper (unit BX3)

Filling the panel exposed the reading underneath it. On the coordinator's copy
of the live paper the week of Sept. 28 - Oct. 3 printed ten rows and four of
them were wrong: "-2 instrument collection drive" and "8 regular meeting" under
Oct. 1 were the **tails** of date expressions the reader had stopped short of
("Oct. 1-2 …", "Oct. 1 and 8 …"), and "Longmont Senior Center" (Fri 2) and
"Clark Centennial Park" (Sat 3) were **places**, not what happens there. The
first two were the reader taking the rest of a date as the event line; the last
two were it taking a name for an event.

The reader now consumes a whole date expression before it cuts the line: a range
("Oct. 1-2", "Oct. 1–2") names its first day and its tail is thrown away, while
a list ("Oct. 1 and 8", "Oct. 1, 8") names a day per number and each gets its
own row, if the day falls inside the window. And a line that is only a name is
refused in favour of the story's headline — a line that opens on a digit, a
dash, a comma or a conjunction, or that runs to fewer than two words, was
already no line, and an all-capital line cut from a headline now has to be a
whole clause and not the subject a cut-off verb phrase left behind. That last
clause is the one that matters for the live string: the desk's real headline
"Longmont Senior Center to begin free meal pickups Oct. 2" printed the venue
until this round, because the reader cut the sentence at "to" and the subject
was all the line had left. "Applications Close Sept. 29" is the exception the
rule is written around — a clause about what happens, title case only because a
headline is written that way — and the live row it prints is kept.

Two of the four strings are quoted off the measured page. The source text
behind "Clark Centennial Park" is not in this repository (grep for it over every
tracked file finds it only in the design handoff's rendered front page, row and
not story), so that one is tested as the shape the brief sanctions:
`"Oct. 3 at Clark Centennial Park"`. The other three, and the live strings for
the Senior Center story, are real. `docs/releases/next-BX.md` is a summary; the
measurements, the command exits and the limits are in the unit report.

### When the panel goes, the lead takes the width

With the panel absent the lead's **box** was the full width of the row but its
**text** was not — at 1440 px the headline and dek stayed about half-width with
a large blank area to their right (`evidence/audit-BX/front-desktop-light.png`).
The sole lead now reads as two columns at 901 px and wider: the section tag and
headline on the left, the dek and the line under it on the right. Below that the
existing rules already stack the lead, so the phone layout is unchanged, and the
row's own grid is untouched — `.lead`'s box is still the whole row, so a check
that measures the box measures the same thing it did before.

When there is genuinely nothing due, the panel is still not rendered at all and
nothing on the page explains the absence.

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

**Unit BX2**, the second source, from this working copy:

- `src/lib/story-dates.test.ts` over `with-app-env` — exit 0, 14 tests, 4
  suites, 14 pass, 0 fail. The five live strings, the past date (Sept. 26 on a
  Sept. 27 front page is outside the week and prints nothing), the year roll
  ("Jan. 5" on a story published in December), the written year that is never
  rolled, the non-dates ("Section 8", "Prop 123", "3C and 3D", "March 2026"),
  and the article page's row printing plain while the front page's row links.
- The four-part Playwright walk over the built server (`work/bx-shots.mjs`) —
  exit 0, 150 expectations, 0 failed. Its seed is the point: **every** story's
  `document_date` is `''` and the dates exist only in the headlines and deks,
  which is the live condition. At all four themes it reads the panel's rows as
  `canvassing day, applications close, public hearing and second reading,
  Brighton event` on the days `Tue 29, Wed 30, Thu 1, Sat 3`, each linking to
  the story that named it. On the article page the same panel prints its own
  story's one date with no link. With the panel gone — the empty-week seed —
  the row is `ledgerow solo` at 1440 and 390 px in both themes, the lead's box
  is the row's width, and the furthest-right text reaches 0.972 of the lead's
  width at 1440 px (0.954 at 390 px), against roughly half before.
- `scripts/paper-panels.mjs` run of its own against that seeded paper — exit 0,
  panel present and heading matched in all four theme/width combinations, 0
  contrast violations, 0 overflows past the panel edge, 0 words split.
- `scripts/front-page-river-e2e.mjs` — exit 0, 18 assertions. Its seed's
  headlines carry no month names, so the new source cannot repopulate the
  three-story panel that case asserts is absent.
- `lint` exit 0, `typecheck` exit 0, `typecheck:test` exit 0, `vite build` exit
  0.

Screenshots from the walk are in `evidence/BX2/`.

**Red before green.** With the released `src/lib/story-dates.ts` restored, the
new story-dates test exits 1 — actual `[]` against expected
`['2026-09-29','2026-10-01','2026-10-03']` — which is the live empty panel as a
unit test. With this version it exits 0. Unit BX2's red check is the walk's own
seed: the same walk run against the previous reader finds no rows at all in the
panel, because every `document_date` it would read is empty.

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
- **The story body is deliberately not read** (unit BX2). The brief left the
  precision of body-text date reading unverified and asked this work to decide
  and say so. It is not read: a date in a headline or a dek is the desk's
  summary of the story and is nearly always the event's own date, while a date
  inside a body sentence — a past meeting, a quoted document, an aside — reads
  identically and would put events on the front page that no story announced.
  The cost is real and is not hidden: a story that names its one date only in
  its body contributes nothing to the panel. The other cost is that this source
  reads **month-name days only**; "tomorrow", "next Tuesday" and "in two weeks"
  are not read, because turning them into a day needs a sentence parser that
  the live strings did not require.
- Unit BX2's panel was checked against a seeded paper whose records are all
  empty, not against the live paper's rows. The live paper's own rows were
  read, not written to, and no claim here is measured from them.
