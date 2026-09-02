# TownReporter — complete handoff for a new agent

Written 2026-08-31, refreshed 2026-09-02 after the v0.5.7 release. You are assumed to know
nothing. Read this whole file before touching anything.

## What this project is

TownReporter is a self-hosted local civic newspaper. One machine runs the whole
thing: a web server, a Postgres database, and a Cloudflare tunnel that puts it
on the public internet at **https://townreporter.org**. An editor signs in,
points an AI (Claude Code CLI, the operator's OAuth) at official civic sources,
reviews every draft, and publishes. Nothing publishes without a human. The
current paper covers Longmont, Colorado, and since v0.5.6 a second city can be
set up with zero file edits.

The operator is Scott. **He is point-and-click only — never hand him shell
commands.** Everything he touches needs a plain label. Deliver text in chat
with full raw file paths.

## Where everything is on this machine

| What | Where |
|---|---|
| **PRODUCTION checkout** (serves the live site) | `C:\Users\scott\Desktop\Code\townreporter-web` |
| **DEVELOPMENT checkout** (do all work here) | `C:\Users\scott\Desktop\Code\townreporter-dev` |
| GitHub remote (both push here, branch `main`) | `github.com/scottconverse/TownReporter` |
| Production database | Postgres on port **5433**, database `townreporter` |
| Dev database | same Postgres, database `townreporter_dev` |
| Production server | node, port **3000**, run by scheduled task `TownReporter` |
| Public route in | `cloudflared`, scheduled task `TownReporter Tunnel` |
| Watchdog (restarts a dead app every 5 min) | scheduled task `TownReporter Watchdog` |
| Ops scripts (promote, restart, watchdog) | `townreporter-web\ops\*.ps1` |
| Production logs | `townreporter-web\logs\` |
| Database backups (promote makes one every run) | `C:\Users\scott\Desktop\Code\townreporter-backups\` |
| Audit evidence from this session | `townreporter-dev\artifacts\walkthrough-056*\` |

## Rules that are not optional

1. **NEVER touch ports 3000, 5432, 5433.** 3000 is the live paper; 5433 is the
   real Postgres. Test servers go on spare ports (3199, 386x range) with
   throwaway databases.
2. **NEVER kill a process by image name.** Resolve the PID that owns the port
   you started and kill only that. A name-based sweep has killed unrelated
   live services on this box twice.
3. **NEVER run `npm run build` in a checkout whose `.output` a live server is
   serving.** This once took the live paper down for 12 minutes while every
   health check said 200. Build in `townreporter-dev`; verify first that
   nothing serves its `.output` (check who owns which port).
4. **Promotion is `ops\promote.ps1` run from inside `townreporter-web`**, never
   hand-typed steps. Disable the `TownReporter Watchdog` scheduled task before
   a promote, re-enable after. The script backs up the DB, stops, pulls,
   builds, starts, and verifies a real served asset.
5. Every integration test file must use a unique PORT —
   `scripts/integration-ports-are-unique.test.mjs` enforces it.
6. `npx tsc` on this box is a decoy package. Use `npm run typecheck`.
7. PowerShell 5.1 + `2>&1` + `$ErrorActionPreference=Stop` treats ONE BYTE of
   native stderr as a fatal error. A stderr log line in a script the start
   task pipes took the paper down to a 502 tonight. Keep tool output on stdout.
8. PS1 files are ASCII only (PS 5.1 reads BOM-less UTF-8 as ANSI).
9. Windows heredocs mangle escapes; write a script file and run it instead.
10. `.env` is merged whole by `scripts/with-app-env.mjs` — a run that does not
    override `DATABASE_URL` inherits the checkout's configured database. The
    wrapper now prints which database it resolved at startup; read that line.

## Current state (all verified tonight)

- **v0.5.7 is LIVE.** townreporter.org serves it; the built version constant
  and the served entry script were checked from the actual bytes, and 13
  published stories survived the promote.
- Both checkouts are on the same commit, pushed, working trees clean (the
  production checkout has an untracked `backups/` dir; leave it).
- CI: 9 jobs, all green — unit/gate suite, built-server boot + smoke, four
  browser walk jobs, real-Postgres integration jobs, and a Windows job that
  kills the app and proves the watchdog revives it.
- Test suite: 664 tests, 0 failures (browser/integration tests need
  `TEST_POSTGRES_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres`;
  without it they skip and the suite is ~633 running).
- Tags/releases through v0.5.7 exist on GitHub with release notes.
- Watchdog re-enabled. Tunnel owned by production via `TOWNREPORTER_TUNNEL=1`
  in `townreporter-web\.env`.
- Tonight's backup: `townreporter-backups\townreporter_2026-08-31_1521.sql`.

## What v0.5.7 is (2026-09-02)

The editor picks the writing model per run (Story: Automatic, Local Qwen, Zen
MiMo, Codex Terra, Codex Sol, Claude Opus). Codex drafts stories natively as
the signed-in user. Opinion is Claude only, because Codex's model refuses
editorials that take a position -- provider policy, not a bug. Every writing
and scanning prompt names the configured paper and city (two audits each
caught a Longmont leak; both fixed, pinned by src/lib/news/city-in-prompts.test.ts).
First-run setup no longer bounces back to a blank form. The dev checkout's
`origin` remote that pointed at PRODUCTION is gone -- `github` is the only
remote; never add one pointing at townreporter-web.

## What v0.5.6 is

CITY-SETUP: the paper's identity (name, city, state, timezone, tagline, watch
list, video channels, meeting keywords, council link, editor email) moved from
source constants into a `paper_settings` database row. A first-run setup
screen at `/desk/setup` collects it; the Server page re-edits it; the seeded
welcome article is rewritten for the configured city. Before setup completes,
a fresh install publicly claims to be nobody ("not yet set up") instead of
serving Longmont's paper. Existing installs with an owner were grandfathered
by migration 0023 so nothing changed for the live paper.

Four GauntletGate walkthrough audits gated the release; each of the first
three found real Blockers (Longmont leaking through the watch list, the
council link, the pre-setup public site, and the setup form's own pre-filled
fields). All fixed, each with a browser test that reads rendered HTML
including hrefs. Round four: 0 Blocker, 0 Critical.

## What is left

**Nothing is owed.** The build list (11 items) and the older v0.5.1 audit list
(20 items) are complete and shipped. Open threads worth knowing about, none
blocking:

1. **Watchlist (operator-approved future work, not started):** the full
   dependency-present pipeline (scan → draft → publish with a real model) has
   never run in CI — it needs credentials CI doesn't have. Worth a full-lane
   gauntlet before any GA claim.
2. The GauntletGate **full** lane (5-role audit) was not run for v0.5.6 —
   walkthrough lanes only. A formal CLEAR TO ADVANCE needs `gauntletgate all`.
3. Scott's Claude OAuth expired once today (drafting failed with "OAuth
   session expired"). If drafting fails again, that is the first thing to
   check — it is his login, not the code. He re-authenticates in the app.
4. If a promote hangs at its final check, do not force anything: check whether
   the app answers, read `logs\`, and kill only the promote's own PID. A
   promote once hung for 2 hours doing nothing after finishing its real work.

## How to verify the paper is healthy (do this before believing anything)

1. `http://localhost:3000/` answers 200 AND `https://townreporter.org/`
   answers 200.
2. The page HTML names an entry script under `/assets/`; fetch it; it must be
   200. (A 200 front page with 404 assets is the half-deployed failure mode.)
3. The served build's `version-*.js` in
   `townreporter-web\.output\public\assets\` names the expected version.
4. `logs\watchdog.log` tail shows quiet or "repaired: app", never a loop.

## Verification ledger

VERIFIED: the app version constant reads 0.5.7 | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/version.ts:2
VERIFIED: the changelog's current release line reads 0.5.7 | C:/Users/scott/Desktop/Code/townreporter-web/CHANGELOG.md:3
VERIFIED: the shipped Longmont defaults live in the PAPER constant | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/paper.ts:1
VERIFIED: nothing is seeded into a newsroom before setup completes | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/desk.ts:78
VERIFIED: the tunnel is claimed per-install via TOWNREPORTER_TUNNEL | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/ops/health.server.ts:196
VERIFIED: the promote script is the one deployment path | C:/Users/scott/Desktop/Code/townreporter-web/ops/promote.ps1:1
VERIFIED: the watchdog job that proves recovery exists in CI | C:/Users/scott/Desktop/Code/townreporter-dev/.github/workflows/ci.yml:381

Runtime observations (no file:line exists for these): dev and prod checkouts
both on commit 21acfb1 with clean trees (`git log`, `git status` in each);
production and public probes returned 200 tonight; the served version asset
read 0.5.6; the story count read 13 via psql; CI conclusions came from
`gh run list`/`gh run view`.

UNVERIFIED: the dependency-present pipeline works end to end in CI - not checked; CI has no model credentials, it has never run there
UNVERIFIED: the GauntletGate full lane would pass - not checked; only walkthrough lanes ran for v0.5.6
