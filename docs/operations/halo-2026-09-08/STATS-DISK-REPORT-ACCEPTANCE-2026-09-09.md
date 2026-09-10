# Stats disk-report acceptance — September 9, 2026

## Result

PASS for the bounded claim: the isolated built editor saved daily, weekly and monthly report files to disk, listed them, and loaded each report through the Stats controls on desktop and mobile.

This is **disk save plus saved-report reader rendering**, not database-counter end-to-end proof. After the built app created the three structurally valid zero-count files, the acceptance harness replaced only those disposable files with synthetic totals so the rendered reader could be checked. It does not prove production data, historical accuracy, newsroom-timezone buckets, clean server logs, or deployment.

## Isolation and artifact identity

- Built server: loopback `127.0.0.1:3468`, parent-owned tool session 2217 (not a Windows PID). A later authoritative listener scan confirmed it stopped.
- Database: explicitly empty `DATABASE_URL`; disposable in-memory PGLite.
- Data root: `artifacts/stats-ui-acceptance-r2`.
- Model/provider variables were empty or disabled. No model or provider request was made.
- Production, staging, public tunnel, and existing report data were not used.
- The earlier 3468 process was discarded because it overlapped a later build; none of its observations are acceptance evidence.

## Browser result

Command:

`$env:STATS_UI_BASE='http://127.0.0.1:3468'; $env:STATS_UI_ISOLATED='1'; $env:TOWNREPORTER_DATA_ROOT='C:\Users\scott\Desktop\Code\townreporter-dev\artifacts\stats-ui-acceptance-r2'; node scripts/stats-ui-acceptance.mjs`

Exact result:

```json
{"ok":true,"scope":"disk save plus saved-report reader rendering","files":["daily-2026-09-08.json","monthly-2026-08-31.json","weekly-2026-09-06.json"],"reportsRead":3,"mobileOverflow":false,"pageErrors":[],"screenshots":["C:\\Users\\scott\\Desktop\\Code\\townreporter-dev\\artifacts\\stats-ui-acceptance-r2\\screenshots\\stats-reports-desktop.png","C:\\Users\\scott\\Desktop\\Code\\townreporter-dev\\artifacts\\stats-ui-acceptance-r2\\screenshots\\stats-reports-mobile.png"]}
```

The harness observed the empty report state, invoked **Save latest reports**, and found exactly:

- `daily-2026-09-08.json`
- `weekly-2026-09-06.json`
- `monthly-2026-08-31.json`

It then wrote synthetic site totals 17, 71 and 301 plus one synthetic story total of 9 into those disposable files, reloaded the built page, and opened all three **Read report** controls. Each expected total and story appeared. The page explicitly displayed “stored database calendar dates” and “anonymous page loads, not readers.”

Desktop and 390×844 screenshots were visually inspected. The Stats page had no document-level horizontal overflow; its wide existing story table remains inside its deliberate horizontal-scroll container. No browser page errors were observed. Browser page-error absence is not a claim that server logs were clean.

## Evidence files

- `artifacts/stats-ui-acceptance-r2/screenshots/stats-reports-desktop.png`
- `artifacts/stats-ui-acceptance-r2/screenshots/stats-reports-mobile.png`
- `artifacts/stats-ui-acceptance-r2/reports/stats/newsroom-1/`

## Limits

- No production or staging mutation.
- No build was performed by this workstream during acceptance.
- No live provider/model call.
- Synthetic report-file rendering does not prove database aggregation values; focused PGLite tests separately cover report boundary/storage logic and existing view aggregation.
- Server log cleanliness was not asserted.

## Separate database aggregation verification

The later isolated test calls the actual `buildStatsReport` against in-memory
PGLite containing one published fixture and anonymous counter buckets of 11
site loads and 7 story loads. Both totals reach the report; re-reading the
buckets proves report generation does not increment them. This is not a live
browser-beacon-to-database test and does not revise the synthetic UI evidence.

Command run by the Stats subagent:

```powershell
$env:DATABASE_URL=''; node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 src/lib/news/stats-reports.server.test.ts
```

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 3
ℹ suites 3
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11401.3586
```

Editor Stats/report pages do not mount a beacon. An editor visiting the public
homepage or a public story is counted like any other anonymous load; the
product does not retain an identity to subtract that visit later.
