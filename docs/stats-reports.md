# Stats and saved reports

**Development status:** this feature is implemented in the development tree;
deployment and production acceptance are still pending.

Open **Desk → Stats** as a signed-in editor. Stats counts anonymous page loads,
not unique people or completed reads. It stores no cookie, fingerprint, IP
address, or user-agent. A home-page load contributes to the site total; a
published-story page load contributes to the site total and that story's
counter. A refresh is another page load and can count again. Opening Stats or
reading a saved report does not create a public-page view.

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
