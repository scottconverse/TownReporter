# Pull: one bounded live retrieval flow

**Source under test:** `fix/finish-townreporter-20260916` at `917dcad`, built `.output`, served on `127.0.0.1:3492` against a **fresh in-memory database** (the harness creates its own editor account, so it must not run against a newsroom that already has an owner). `TOWNREPORTER_LOCAL=0`, `TOWNREPORTER_LOCAL_DISCOVERY=0`, `TOWNREPORTER_CLAUDE_CODE=0`, test-only auth secret. No production database, process, or credential was used.

**Harness:** the repository's existing `scripts/pull-progress-e2e.mjs` - a real browser driving the reporting-item Pull control, unmodified.

**Command:**

```powershell
$env:PULL_E2E_BASE_URL='http://127.0.0.1:3492'
node scripts/pull-progress-e2e.mjs
```

**Result (verbatim):**

```text
Pull progress: real browser and public-web proof passed
  ok    live mechanical stage and counters appeared immediately
  ok    active job reappeared after browser reload
  ok    Stop made the saved checkpoint continuable
  ok    Continue did not lose prior progress
  ok    real extraction completed (1 searches · 1 providers · 6 index pages · 4 documents opened · 4 saved)
  ok    completed status and saved source survived a second reload
```

## What this proves, against the directive's Pull requirements

| Requirement | Evidence |
|---|---|
| It is mechanical and says so | The walk waits for the exact string "Mechanical web search and document extraction - no AI model is being used." before it proceeds |
| It does not look dead | The stage text and a live counter line (`searches · providers · index pages · documents opened · saved`) were visible immediately after pressing Pull |
| Stage, counters, saved documents visible | The same counter line, and the completion line `Finished · ... relevant document(s) saved` |
| Work survives reload / navigation | The active job reappeared with its counters after a full browser reload |
| Stop and Continue are real and correctly wired | Stop produced a `Continue pull` control within 70 s; Continue resumed without losing previously counted progress |
| Useful source material is saved as it goes | The run finished with **4 documents saved**, and the harness fails the walk if the counter shows zero |
| A source is retained, not just counted | The saved URL is asserted present in the `Pulled notes` field, and re-read after a **second** reload |
| No writing-model tokens spent | Pull ran under `TOWNREPORTER_LOCAL=0` / `TOWNREPORTER_CLAUDE_CODE=0`; the run completed in ~12 s with 1 search, 1 provider, 6 index pages, 4 documents opened, 4 saved - no model call is part of this path |

## Limits

- **One** bounded flow, one query ("Find the official City of Longmont City Council meeting agendas and packets for 2026"), one machine. It is evidence that the path works, not a claim about search quality or completeness.
- Live public-web results vary between runs; a different day could legitimately find more, fewer, or different documents. The assertions are about the flow's behaviour, not about a specific document.
- The run used a fresh in-memory database, so durability was proven across browser reloads and Stop/Continue within a single server process - **not** across a server restart. A restart-survival claim would need a persistent database.
- The "no AI model" claim is supported by the code path, the product's own on-screen statement, and the disabled-provider environment; it was not instrumented through external provider telemetry.
- No production service, credential, commit beyond `917dcad`, merge, tag, or release was touched by this flow.
