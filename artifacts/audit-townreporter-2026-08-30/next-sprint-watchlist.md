# Next-sprint watchlist — TownReporter 0.5.1 audit — 2026-08-30

Structural items that survive promotion. None block the current release.

| ID | Title | Sev | Role | Why it can wait / what to do |
|---|---|---|---|---|
| TEST-001 | No concurrency/race coverage: two editors racing publish/delete/restore on one record | Major | Tests | Real gap; needs an integration harness (two sessions, one Postgres). Design it, don't patch it. |
| ENG-203 | Chromium runs `--no-sandbox` while rendering hostile pages | Minor | Eng | ENG-201's proxy now bounds where it can reach. Long-term: run the render worker as a non-root user so the sandbox initializes, then drop the flag. |
| ENG-204 | `enqueueJob` retry insert lacks `on conflict do nothing` | Minor | Eng | Narrow double-race can 500 a "Scan" click under contention. Mirror the primary insert + one more findOpenJob. |
| TEST-003 | Windows watchdog/control plane: static/parse tests only, no runtime recovery test | Minor | Tests | Honest gap. A Windows CI runner or a sandboxed local harness could kill the app and assert the watchdog restarts it. |
| QA-002 | Brief "Opening the desk…" flash on direct desk-route navigation while signed in | Minor | QA | Unconfirmed (browser-pane collisions during audit). Re-test cleanly; if real, it is a session-resolution ordering issue. |
| QA re-run | Adversarial runtime pass that QA-001's tooling collision blocked (publish/delete/undo/restore/corrections/paste, two-tab conflicts, mobile) | — | QA | Run with ONE browser-driving agent at a time. CI e2e covers these flows headlessly meanwhile. |
| UX-004 | Focus indicators faint on topbar links; desk inputs swap outline for border-color | Minor | UX | Contrast pass on :focus-visible tokens. |
| DEP | `nitro` pinned to a dated beta; `@electric-sql/pglite` pre-1.0 | Nit | Eng | Track to stable lines before wider distribution. |
| TW-002 tail | package.json says 0.5.1; only v0.5.0 tag exists | — | Docs | Operator cuts the v0.5.1 tag (owner-gated; agents do not tag). |
