# Build-list handoff — 2026-08-31

Working state at the pause. Everything below is verified, not assumed.

## Do not restart work until Scott says go.

## Where things stand

**Dev HEAD:** `b8de474`, pushed to `github/main`, working tree clean.
**Production:** healthy — local `:3000` and `townreporter.org` both answer 200.
**Production is running `3475c16` (v0.5.4).** Everything since is committed and
pushed but **not tagged and not promoted**.

No agents running. No stray processes (8080/3050/3199/5199 all free).

## The 11-item list: 10 done, 1 not started

| # | Item | State |
|---|------|-------|
| 1 | PULL-EXCERPT | done, **live** (v0.5.2) |
| 2 | INVITE-EDITORS | done, **live** (v0.5.3) |
| 3 | TEST-001 two-editor races | done, **live** (v0.5.4) |
| 4 | QA-002 sign-in flash | done, committed, not released |
| 5 | UX-004 focus rings | done, committed, not released |
| 6 | ENG-204 enqueue race | done, committed, not released |
| 8 | TEST-003 watchdog recovery | done, committed, not released |
| 9 | ENG-203 Chromium sandbox | done, committed, not released |
| 10 | DEP | done, committed, not released |
| 11 | CREDIT-GATE | done, committed, not released |
| **7** | **CITY-SETUP** | **NOT STARTED** — the only remaining item |

## The one loose end that matters

**v0.5.5 was never finished.** `package.json` says `0.5.5` and the changelog
has a 0.5.5 entry, but:

- the tag `v0.5.5` was never cut,
- no GitHub release exists for it,
- production was never promoted to it,
- and CI was RED on `8516ede`, `ae96926` and `08e3468`.

The CI failures were one cause, now fixed in `b8de474`: a plain `npm install`
regenerated the lockfile with npm 11, which omits an optional peer that npm 10
(what CI runs) demands. Every job died at `npm ci`. The lock was regenerated
with npm 10 and proved installable under both. **CI has not yet been confirmed
green on `b8de474` — check it first.**

Six items are sitting in that unreleased window (4, 5, 6, 8, 9, 10, 11), so the
0.5.5 changelog entry no longer describes what is actually in it.

**First actions on resume, in order:**

1. Confirm CI is green on `b8de474` (the lock fix). It was red for the three commits before it.
2. Rewrite the 0.5.5 changelog entry to cover everything actually in it
   (sandbox, credit gate, watchdog recovery, dependency bump, the sweep fix),
   or bump to 0.5.6 and split it. `scripts/versions-agree.test.mjs` enforces
   that every version surface matches `package.json`.
3. Tag, release, promote.

## Incidents this session (both fixed, both worth remembering)

**The paper served a half-written build for ~11 minutes.** The v0.5.4 promote
stopped the app; the watchdog saw "app down" and restarted it 45 seconds
before the build finished writing. The front page answered 200 the whole time,
which is why the promote's own check passed. Fixed three ways: the promote
holds the watchdog off with a marker (30-minute cap), its final check now
fetches a real script asset the page names, and stale browser tabs reload
themselves once on a chunk-load failure.

**The watchdog would have killed the live paper.** Its stale-process sweep
enumerated every `node.exe` whose command line contained
`.output/server/index.mjs` and killed all of them — every install on the
machine, not the one being repaired. This box runs the live paper and a dev
copy side by side. Now scoped to the process holding the port being repaired.
Mutation-proven gate in `scripts/ops-scripts.test.mjs`.

**CI's shared test build had the same shape of bug.** `ensureBuilt` treated
"I got the lock" as "I build", so a late test file rebuilt `.output` under
sibling servers already serving from it. Now it checks whether a current build
exists before taking the lock, and again while holding it.

## Item 7 (CITY-SETUP) — what was learned before stopping

Not started, but scoped. The two things a new city must change today:

- `src/lib/paper.ts` — the `PAPER` constant (name, city, state, location,
  timezone, tagline, kicker, deck, trust) **and** `SEED_SOURCES` (the watch
  list: url/title/kind/tier).
- `src/lib/news/youtube.ts` — the city's video channels and meeting keywords.

`SEED_SOURCES` is consumed only by `ensureSeeds()` in `src/lib/news/desk.ts`,
which upserts rows into `sources` on desk boot with `on conflict do nothing`.
That is the whole coupling — which makes a config table a clean swap: seed
from the database, fall back to the constants so nothing breaks.

Scott's rule for this one: **it ships whole or not at all** — no half-built
city picker. The gate should be that the first-run walkthrough passes for a
fake second city with zero file edits.

## Verification ledger

Checked by running the command or reading the file, at the time of writing.

VERIFIED: dev HEAD is b8de474, pushed to github/main, working tree clean | git log --oneline -1 + git status --short
VERIFIED: production answers 200 locally and publicly | curl http://127.0.0.1:3000/ and https://townreporter.org/
VERIFIED: the production checkout is on 3475c16 (v0.5.4) | git -C ../townreporter-web log --oneline -1
VERIFIED: no stray listeners on 8080/3050/3199/5199 | netstat -ano | grep LISTENING
VERIFIED: tags stop at v0.5.4; no v0.5.5 exists | git tag -l 'v0.5.*'
VERIFIED: package.json says 0.5.5 while no such tag exists | node -e require('./package.json').version
VERIFIED: CI was red on 8516ede, ae96926 and 08e3468 | gh run list --workflow CI
VERIFIED: every job died at npm ci on 'Missing: lru-cache@11.5.2 from lock file' | gh run view --log-failed
VERIFIED: the regenerated lock installs under npm 10 AND npm 11 in a clean room | npx npm@10 ci + npm ci on a copied package.json/lock
VERIFIED: pglite is locked and installed at 0.5.8 | package-lock.json entry + node_modules/@electric-sql/pglite/package.json
VERIFIED: the watchdog restarted a killed app while production's PID never changed | live PowerShell run: 3050 answered 200 after the kill, prod PID 32056 before and after, logs/watchdog.log recorded 'repaired: app'
VERIFIED: the watchdog sweep is now scoped to the port's owner | ops/watchdog.ps1 (Get-NetTCPConnection -LocalPort $port, then Stop-Process -Id $owner)
VERIFIED: the watchdog parses and is ASCII-only | PSParser::Tokenize + a char-code scan over ops/watchdog.ps1
VERIFIED: ensureBuilt consults buildIsCurrent before the lock and again under it | src/lib/test-support/pg-admin.ts
VERIFIED: the six-file concurrent integration run passes 25/25 with that fix | node --test on the same six files CI names
VERIFIED: PAPER and SEED_SOURCES both live in src/lib/paper.ts | src/lib/paper.ts:1 (PAPER) and :71 (SEED_SOURCES)
VERIFIED: SEED_SOURCES is consumed only by ensureSeeds, which upserts with on-conflict-do-nothing | src/lib/news/desk.ts:65-74
VERIFIED: the city's video channels and meeting keywords live in youtube.ts | src/lib/news/youtube.ts:102 (MEETING_KEYWORDS), :120 (LONGMONT_YOUTUBE_CHANNELS)
VERIFIED: the credit warning matches whole words only | src/lib/news/report.ts spacedWords + 50/50 in src/lib/news/report.test.ts
VERIFIED: Chromium's default launch args no longer include --no-sandbox | src/lib/news/render-fetch.ts sandboxedLaunchArgs
VERIFIED: gates pass and the named ones fail on mutation | node --test scripts/**/*.test.mjs (223 pass) plus per-gate RED/GREEN runs recorded in the commits

UNVERIFIED: CI is green on b8de474 - not checked; the run had not finished when this was written
UNVERIFIED: the windows-latest watchdog CI job passes as written - not checked; it has never run. Its recovery behaviour was proven locally instead (see above), but the job itself is unexercised
UNVERIFIED: item 7 CITY-SETUP effort of roughly a week - not checked; an estimate, not a measurement
UNVERIFIED: the 0.5.5 changelog entry is now inaccurate for its contents - not checked line by line; it was written before items 8, 9, 10 and 11 landed

## Standing constraints

- CivicCast may need the box; keep build/test bursts short and yield if asked.
- Never touch ports 3000, 5432, 5433. Never kill by image name.
- Only Scott tags — except he granted tag authority **for this series only**,
  on green, and only after a real lite+walkthrough gate with nothing but nits
  left.
- Promote after each item (batched here for CivicCast).
