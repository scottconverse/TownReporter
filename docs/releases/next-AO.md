# Next TownReporter patch — suggested sources (unreleased)

**State:** Candidate work in progress from unit AO (branch
`deepseek/0670-sources`, 0.6.70 lane 1). This document does not assert a
release, tag, GitHub publication, production deployment, or live-model result.

The owner's brief on 2026-09-24: *"Research/Dark agents can propose newly found
sources into the source database (as candidates; a person accepts), so the
source list grows over time."*

The scan was already doing half of that. Its reply has carried
`proposed_sources` since the daily scan was written, and the desk has inserted
them as `kind='discovered'`, `tier='unclassified'`, `status='proposed'` ever
since. What was missing was everything else. Rows were stored with a URL and a
title and nothing else, so the only way to decide one was to open the page; the
research pass and the Dark Desk, which read the most new pages of anyone, filed
no suggestions at all; and on production this morning there were **201 accepted
sources, 175 waiting suggestions and 6 rejected**, with nothing on the desk
built to clear 175 of anything. The newest batch — YMCA Financial Assistance,
WRV Staff and Jobs, NextLight Discount Programs, Head Start – Wild Plum Center,
T2 Dance Company RSS feed — all arrived in one scan at the same second and none
of them had been read by a person.

## Why and where are recorded now

One additive migration, `0097_suggested_source_origin.sql`: seven nullable
columns on `sources` — `proposed_reason` (the model's one sentence about what
the page offers the paper), `proposed_by` (`scan`, `research`, `dark` or
`editor`), `proposed_scan_run_id`, `proposed_lead_id`, `proposed_section` (the
model's guess), `reviewed_at`, `review_note` — plus a partial index for
`(newsroom_id, id desc) where status = 'proposed'`, which is the review list's
own query. Columns rather than a side table, because a suggestion *is* a source
row at an earlier status and a second table would have to be joined, kept in
step, and explained.

Every row that predates this release is null in all seven, and the desk says so
in words: *No reason was recorded when this was suggested*, and `not recorded`
where the suggester is named. A `null` is "not recorded", not "no reason".

The scan's own reply now asks for both: a `why` of one sentence and a `section`
key, with the item schema (`schema.ts`) extended and `desk-copy.ts`'s prompt
telling the model what the sentence is for, to cite only public http(s) pages
the text actually points at, never a search page. Both fields are optional in
the schema, so a reply written before this release still parses as a suggestion
with no reason and no guess. The guess is kept only when it names a section the
run accepts, by key or by the display name the prompt showed — the same rule a
lead's `topic` already gets — because the review screen preselects the section
picker with it and a key no section has would preselect nothing while looking
like a decision.

## One door for three passes

`insertProposedNewsroomSource` was already the scan's one insert. It is now the
one insert for all three passes, and it holds the rules every caller would
otherwise have to remember:

- **A page, not a URL string.** `sourceIdentity` (`url-guard.ts`) is the host
  and the path, ignoring the scheme, a leading `www.`, a trailing slash and the
  query. The `sources` table keys on the raw string, so `http://x/`,
  `https://x` and `https://www.x/` are three rows — and the scan, which sees one
  page linked from a dozen articles, proposes all three. A page this newsroom
  already has, whatever status it is in, is not proposed again.
- **A results page is not a page.** `isSearchResultUrl` refuses search engines
  by host label (`google.com`, `news.google.com`, `html.duckduckgo.com`) and
  any host's search endpoint carrying a `q`; a homepage or a section front is
  not affected, because an agenda index is exactly what the owner wants watched.
- **A social profile only for a paper that watches social sources.** The rule is
  read from `kindFromSourceUrl` (`desk-copy.ts`), the one place that decides what
  counts as a social source (Twitter/X, Facebook, Instagram, Nextdoor, Reddit),
  rather than written out a second time here. The Longmont edition ships with
  `@CityofLongmont` and `@LongmontPublicMedia` on watch, so a scan finding a city
  account is proposing exactly what the owner asked it to watch; a paper watching
  none has chosen otherwise, and a pass that opened a Facebook group on the way
  to a story should not put one on the list. "Watches" means **accepted** — a
  dropped row is not a standing decision, and a suggestion already waiting is not
  one either. The check is inside the same lock as the dedupe, because it reads
  the watch list too.
- **Nothing a pass did not read.** The research pass proposes what it opened and
  cited, not every URL it saw; the Dark Desk proposes the pages it read while
  developing a file, taken from the investigation's own artifacts and capped at
  twelve per pass, each with a reason naming the file.

Each pass writes its own `proposed_by`: the scan writes `scan` with its
`runId`; the research pass writes `research` with the lead it was working on and
the section it guessed; the Dark Desk writes `dark` with the lead it handed to
the queue. All three go through `proposePassSources`, which dedupes within the
pass as well as against the table.

## A screen that can clear 175

The **Sources** page's third group is now **Suggested sources: N** — newest
first, so the run that just finished is at the top. Each row carries the reason,
the suggester and its lead (linked to the lead), and the section guess, which
starts the section picker. **Anyone / The scan / The research pass / The Dark
Desk / Not recorded** filter the list. Per row: **Accept to \<section\>**,
**Reject**, and an optional note saved with either. For a batch: **Select
\<title\>** on each row or **Select all N**, then **Accept selected** or
**Reject selected**, with one section picker for the batch.

Every press reports itself — **Saving…**, then *Accepted 3 suggestions and filed
them under Council* or **Nothing was changed:** and why. A batch is **one
transaction**: the status, the review stamp, the note, the section link and the
`section_config` revision bump all commit together or not at all, so the screen
can say nothing was changed and be telling the truth. The one-at-a-time path
still exists and also records who reviewed the row and when; a row sent back to
`proposed` clears that stamp rather than leaving a reviewed-at on a row waiting
to be reviewed.

The section half stays **owner-only**, the same rule as every other writer of
`section_sources`; an editor who is not the owner accepts and rejects, and sees
the guess as a note rather than as a picker they cannot use. The Command
Center's rail counts suggestions as it counted proposals, names who found each
one, and its "N more" link now lands on this list rather than the top of the
page.

## What a reader sees

Nothing. A suggestion is a desk-only row: it is never fetched, never scanned and
never published until an editor accepts it, and accepting it only puts it on the
watch list for the next scan. Nothing in this release touches the paper.

## Evidence

`npx tsc --noEmit` and `npm run typecheck:test` clean (exit 0); ESLint clean on
every changed file (exit 0); the new `suggested-sources.test.ts` 18/18 (dedupe by
page, refusal of search and no-identity URLs, a social profile refused to a paper
that watches none and allowed once an accepted social source exists, an old-shape
reply still parsing, the reason/by/run/lead/section actually reaching the row, the
research and Dark paths calling the insert, and bulk accept writing status and
section link in one transaction — with two red checks recorded: removing the
social gate turns the new test red (17 pass, 1 fail, exit 1) and dropping
`section_sources` before the press rolls the status, the stamp and the revision
all back); every test file that builds a `sources` table ran together — 145 tests,
143 pass, 0 fail, 2 skipped, exit 0 — and the fixtures that build their own
`sources` table now apply 0097 from disk and carry the `kind` column the social
rule reads (the lesson from AK3); the CI-shaped scripts suite
`node --test --test-concurrency=1 "scripts/**/*.test.mjs"` exit 0, 517 tests,
514 pass, 0 fail, 3 skipped. The desk walks were
read against the new screen: the Sources walk only opens **On watch** and
**Dropped**, which are unchanged, and its stale row-lookup comment was corrected;
no walk needed a behavioural change. No walk was added for the new list, and the
e2e walks **were not run here** — they need a served build and a database, which
this unit's rules put out of reach.
