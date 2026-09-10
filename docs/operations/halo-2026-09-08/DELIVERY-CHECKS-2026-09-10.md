# Delivery checks — September 10, 2026

These are development checks, not deployment receipts. No production database,
settings, articles or services were changed.

## Pinned built publishing workflow

Build SHA-256: `fec0f3cb57e64b6ebb15e6401857b7b13779022905ec9904746a3902d5b7757c`.
Each command launched one fresh in-memory PGLite paper on loopback 3472, with
native model providers disabled and API keys empty. Three-minute outer deadline.

- `node artifacts/resume-publishing-check.mjs sources-reach-the-reader.mjs`
  Exit 0; result `ok: true`, 7 steps. Filed a lead, saved copy, confirmed evidence
  after editing, published, and inspected the reader's actual source link.
  Raw log: `artifacts/resume-sources-reach-the-reader.mjs-1789064453145.log`.
- `node artifacts/resume-publishing-check.mjs lifecycle-e2e.mjs`
  Exit 0; result `ok: true`. Published a manual story and verified its correction
  on the reader's page. Raw log:
  `artifacts/resume-lifecycle-e2e.mjs-1789064507859.log`.

Both logs retain Better Auth's missing trusted-client-IP warning and aborted
navigation `ECONNRESET` errors. No clean-server-log claim. These are manual-copy
workflow checks, not model factual-quality evidence.

Owned servers/children 29884/15164 and 26808/19092 were terminated after their
respective browser drivers completed. Subsequent process checks found the named
drivers and servers gone; port 3472 was free after the first run. No new workload
overlapped either browser check.

## Stats consolidation

Command:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 src/lib/news/stats-reports.server.test.ts src/lib/news/views.test.ts`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 13
ℹ suites 6
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 23100.1642
```

Command:
`node scripts/with-app-env.mjs node --test --test-concurrency=1 scripts/stats-copy.test.mjs scripts/dark-desk-scheduler.test.mjs`

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 133.6678
```

Both exit 0; no warnings in captured output. These rerun the existing Stats
implementation before committing it. Earlier built report-reader and actual
beacon evidence remain in the September 9 Stats acceptance documents; their
limitations have not changed. No claim of new TDD or production activation.
