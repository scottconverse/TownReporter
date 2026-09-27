# Next TownReporter patch — unreleased (Unit BM, redesign phase 7: Stats, lane 2)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or a promoted candidate. Phase 7 lane 2 rebuilds one screen — **Stats**, at `/desk/stats` — on top of the reading beacon that feeds it. Nothing else on the desk changed.

## What an editor sees change

### The Stats screen is drawn the way the handoff draws it

`/desk/stats` now opens on a range control — **Today / 7 days / 30 days / 12 months** — with **Export CSV** beside it, and below that, in order: the live panel, the summary cells, the thirty-day chart, the story read-through table, the three bar panels, the hour-by-day heatmap with its one-line takeaway, the trust signals, and then the two panels that were already there — **Section chosen by hand** and **Saved reports**. The last two are untouched; the rest of the page is new.

### "Reading right now", and what it is not

The live panel has the yellow rule, the pulse, the count, the change against thirty minutes ago, a thirty-bar sparkline, and the pages being read at this moment with the average time so far. It is computed **in memory on the server** over a rolling thirty-minute window and is never written with any key that could name a reader. Two consequences an editor should know: the window empties when the server restarts, and on a site running more than one server process each process sees only its own readers. Nothing on this screen merges them.

### Visits mean "arrived from outside the site"

**Visits** counts page loads whose referrer is not this paper's own host. An empty referrer counts as outside — a link pasted into a text message looks the same as a bookmark, and the page says so. Arriving from one of our own story paths is **Read another story**, a recirculation and not a visit. **Left without reading** is a load whose active reading time was under ten seconds. There is **no daily unique count anywhere**, because computing one would require exactly the identifier the rule forbids; **returning readers** is not measured, and the panel under **What we never collect** says so in those words.

### Where readers are: the page does not look

The location panel prints that the paper does not look up where readers are, and offers nothing else. There is no GeoIP database in this unit and the IP is not read for any purpose.

### The stories table and the trust signals

**Stories, by how much they were read** has one row per story with a four-bar read-through group — 25, 50, 75 and 100 percent — the last bar drawn yellow, plus the story's age, its average time and its recirculation share. **Trust signals** counts the things a reader does that are not reads: the captured version opened, a source link followed, "How we reported this" reached, a correction filed, the credit copied, dark mode chosen, larger text chosen, and RSS fetches per day (counted on the server, on the feed route).

## What changed under it

- **`migrations/0103_read_hourly.sql`** — two new tables, both hourly aggregates over a path, a referrer class and a device class. `read_hourly` carries loads, visits, recirculations, early exits, active seconds and four depth bucket counters; `trust_signals_hourly` carries a count per event. Neither has a column for an IP, a user agent, a cookie, a session or any id, and a test asserts that by name.
- **`src/lib/news/reading.ts`** — the shared vocabulary and arithmetic: the eight referrer classes, the three device classes from viewport width, the four depth buckets, the ten-second threshold, the path allowlist, and the formatters the page prints with. This module is what the reader's browser runs, so a referrer becomes one of eight words there and the URL is dropped.
- **`src/components/read-beacon.tsx`** — the page half. It sends a load ping immediately and then a beat every fifteen seconds while the tab is visible, with scroll depth buckets and a final report on `visibilitychange` and `pagehide`, all through `navigator.sendBeacon`. Active time is time on screen; a hidden tab counts nothing, and a page that stays hidden for thirty seconds reports the end of the visit.
- **`src/routes/api/read.ts`** and **`src/lib/news/reading.server.ts`** — the server half: the handler that turns one beacon body into one aggregate increment. It takes a `Request` and never reads `request.headers`, which is a unit test rather than a promise.
- **`src/lib/news/reading-live.ts`** — the rolling window behind the live panel, in memory, with no per-reader key.
- **`src/lib/news/reading-stats.ts`** — the three server functions the page calls (stats, live, CSV export), registered the way the rest of the desk registers them.
- **`src/routes/desk.stats.tsx`** — the screen itself, drawn with plain SVG and CSS over the existing desk tokens. No chart library was added; the repo already depends on one, and this screen does not use it.
- **The feed route** counts one RSS fetch per request. **`index.tsx`**, **`articles.$slug.tsx`** and **`how-we-report.tsx`** each mount the beacon in one line.

## Limits

- **A tie is not named.** The one-line caption under the heatmap names a busiest hour only when one hour stands alone at the top of the range; when two or more are level it says how many are. Picking one of them would print the query's row order as a habit of the town.
- **Read time is time on screen, not attention.** A story left open on a desk counts the same as a story being read, up to a four-hour ceiling on one load. This is deliberate: knowing the difference would mean watching the reader.
- **The live panel is one process wide** and is lost on restart, as above.
- **"Left without reading" is a floor, not a measurement** — a reader who never scrolls and closes the tab inside ten seconds is counted; a reader who reads nothing for a minute is not.
- **Schema parity skips without `TEST_POSTGRES_ADMIN_URL`.** `src/lib/news/schema-parity.test.ts` runs its comparison only against a real Postgres; on a machine without one it passes without looking at the new tables. The migration was written by hand to match `ensureReadingSchema()` and the two were compared, but the automated check is the one that would have caught a drift.
- **The reading preference blob is a real write to localStorage** — `townreporter:reader:<paper>:<city>` — and it is the reader's own choice of text size and appearance, not a count, and it was there before this unit. On `/` and on a story, a clean load with no press writes nothing, which is what the browser walk asserts.
- **The referrer's query string is still attached by the browser** to the document navigation. The walk records every request and fails if it reaches any URL, body or other header, and asserts that the query really was in `document.referrer` first, so the negative result is not vacuous. It is the browser that sends it, not this site.
