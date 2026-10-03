# Stats and saved reports

**Development status:** this feature is implemented in the development tree;
deployment and production acceptance are still pending.

Open **Desk → Stats** as a signed-in editor. Stats counts anonymous page loads,
not unique people or completed reads. It stores no cookie, fingerprint, IP
address, or user-agent. A home-page load contributes to the site total; a
published-story page load contributes to the site total and that story's
counter. A refresh is another page load and can count again. Opening Stats or
reading a saved report does not create a public-page view.

Two signals are read while a public page is open and neither is stored as a
value. The **city and country** are derived by Cloudflare from the reader's IP
address and arrive as request headers; they are believed only when the request
came over loopback, where the tunnel daemon connects from, so a direct
connection cannot forge them. What is kept is a per-day count per place, never
the address, and it counts **readers, not page loads**: each reader is counted
once in a place on a day, so opening twenty-five pages cannot make a town look
busier than it was. A place is printed by name only on days when at least 25
readers were counted in it, and the number beside it is those days only — the
city's quieter days, and every place that never reached 25, are "other places"
for that day instead. **Today's counts are kept per place until the day
ends**; on a finished day, the hourly check adds every place under 25 readers
together into that day's "other places" row and deletes the individual rows, so
they are not kept individually beyond the day — and a backup taken before the
fold still holds them. The **requesting address and the browser's type** (a few words
such as "phone", never the user-agent string) are read for one moment inside a
one-way code that changes every day, only so the same visit is not counted
twice; the code is never written to the database or a log, cannot be reversed,
and cannot be matched across days. The day's **visitors** figure is therefore an
estimate that can be wrong in both directions — a restart or a busy day can
count the same reader twice, and one shared address reads as one reader — and
"returning readers" is still not measurable. Places older than twelve months are
pruned; every other Stats count, including the saved reports below, is kept
indefinitely.

Both public beacon endpoints (`/api/view` and `/api/read`) are bounded together
by one process-wide budget with no key of any kind: 20 writes a second sustained
with a burst of 400 (`BEACON_RATE_PER_SECOND` / `BEACON_RATE_BURST` in
`src/lib/news/stats-privacy.ts`), and a 2 KB cap on the request body, enforced by
counting bytes as they arrive rather than trusting a header. A request over
either bound is answered exactly like a working one and writes nothing.

The live page shows site and published-story totals for:

- Today
- The last 7 calendar dates, including today
- The last 30 calendar dates, including today
- All time

The story table shows the same windows for each published story. These are raw
beacon counts, not audience estimates.

## Save and read reports

Select **Save latest reports** to create any missing snapshots for the last
completed:

- day (yesterday)
- Monday–Sunday week
- calendar month

Saved reports appear under **Saved reports**. Select **Read report** beside one
to open its stored site total and per-story totals for that period. Saving and
reading are editor-only and newsroom-scoped.

Lists show five rows initially, with **Show all N** for the rest. Weekly reports
read **Week of Sept. 28** rather than ISO dates. The privacy and location panels
keep their counting details under **How we count**.

The server also checks automatically after startup and then hourly. It creates
the same completed-period files and skips files that already exist. This is an
idempotent local archive, not a promise to reconstruct every period: if the
installation was stopped or unavailable, older missed periods are not filled
automatically.

## Where files live

Reports are stored on the TownReporter installation at:

```text
TOWNREPORTER_DATA_ROOT/reports/stats/newsroom-ID/
```

where `ID` is the newsroom number. If `TOWNREPORTER_DATA_ROOT` is not set, the
local fallback is:

```text
.townreporter-data/reports/stats/newsroom-ID/
```

Files are named `daily-YYYY-MM-DD.json`, `weekly-YYYY-MM-DD.json`, or
`monthly-YYYY-MM-DD.json`. Keep this data directory in the installation's
backup plan. Restoring reports without the matching newsroom data can make
the archive incomplete; reports are not a substitute for database backups.
