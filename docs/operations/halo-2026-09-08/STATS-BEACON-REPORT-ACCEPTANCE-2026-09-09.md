# Stats public beacon to report acceptance — 2026-09-09

## Verdict

PASS on the frozen built application. A real public homepage navigation, public
story navigation, and full story refresh reached `POST /api/view`, updated the
disposable PGLite aggregate counters, and appeared in `buildStatsReport` as
three site loads and two loads for `welcome-to-townreporter`.

No product-source fix was warranted. Two earlier runs read the report before
the refreshed page's effects had produced endpoint receipts and failed at
site 2 / story 1. A diagnostic run then captured the refresh calls, and the
final harness replaced the timing assumption with bounded phase-specific 204
receipt waits. This is an acceptance-harness race correction, not evidence of
a ViewBeacon product defect.

## Authoritative isolated run

Command, from the repository root:

```powershell
$env:DATABASE_URL=''; $env:STATS_BEACON_ISOLATED='1'; node scripts/stats-beacon-report-acceptance.mjs
```

Result: exit 0. The in-process built server listened only on
`http://127.0.0.1:3472` and was stopped by the harness.

Phase receipts and report assertions:

1. Homepage: one successful `/api/view` response; report site loads = 1.
2. Client story navigation: two more successful responses; report site loads
   = 2 and story loads = 1.
3. Full HTTP 200 story reload: two more successful responses; report site
   loads = 3 and story loads = 2.

All five endpoint responses were 204. A diagnostic wrapper around the native
`navigator.sendBeacon` (delegating to the original function) captured these
payloads before the final unmodified-transport run:

```text
before reload: {"target":"site"}
before reload: {"target":"story:welcome-to-townreporter"}
before reload: {"target":"site"}
after reload:  {"target":"story:welcome-to-townreporter"}
after reload:  {"target":"site"}
```

The reload ended at the exact story URL with `document.readyState=complete`.
The article body was present, the public Search control reacted to a click
(client hydration evidence), the ViewBeacon bundle loaded, and there were no
browser console errors, page errors, or failed requests. Diagnostic screenshot:
`artifacts/stats-beacon-diagnostic/after-story-reload.png`.

## Privacy and counting boundaries

- The signed-in editor's public-page loads counted as anonymous aggregate
  loads. Desk pages do not mount ViewBeacon.
- A full refresh counts again; this is a load counter, not unique readership.
- The generated report contains no `userId` or `visitorId`.
- The beacon endpoint receives only a target (`site` or `story:<slug>`); this
  acceptance did not add identity, cookies, fingerprints, or engagement data.
- Bot classification/deduplication is not implemented or claimed. A bot that
  executes the browser JavaScript can count; a crawler that only consumes SSR
  HTML will not execute the effect.

## Isolation and limits

- `DATABASE_URL` was explicitly empty, selecting the disposable in-memory
  database. No production or port-5433 database was used.
- No model calls, paid services, external browser profiles, build, deployment,
  or production mutation occurred.
- The test uses the already-built `.output`; it does not prove a newer source
  tree until that tree is rebuilt separately.
- The runtime emitted the existing Better Auth trusted-client-IP warning in
  this loopback fixture. One earlier diagnostic also logged an aborted request
  while deliberately reloading; the authoritative phase-aligned run had no
  failed browser requests and passed all counter assertions.

