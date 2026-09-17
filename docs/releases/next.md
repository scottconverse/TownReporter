# Next TownReporter patch — unreleased

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or live-provider result.

## Operational fixes

### Windows promotion process match

The v0.6.51 production promotion initially refused to stop the verified TownReporter server because `ops/promote.ps1` looked for `.output/server/index.mjs` with forward slashes. Windows reports the command line with backslashes.

The candidate now checks the process through `Test-TownReporterServerProcess` in `ops/lib-port.ps1`. It normalizes slash direction and requires this checkout's exact absolute built-server path. It still rejects `node.exe` processes whose command line points somewhere else.

Targeted evidence:

- `node --test scripts/ops-promote-process.test.mjs` passed 1/1. The test executes the PowerShell helper and covers both the real Windows TownReporter command line and an unrelated Node command line.
- `node --test scripts/ops-scripts.test.mjs` passed 24/24.

These checks prove the focused process classifier behavior. They do not prove that a new candidate has been promoted to production.