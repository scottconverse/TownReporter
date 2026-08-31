# Build-list handoff — 2026-08-31

Working state at the pause. Everything below is verified, not assumed.

## Do not restart work until Scott says go.

## Where things stand

**Dev HEAD:** `9184a3a`, pushed to `github/main`, working tree clean.
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

Claims about the code, each tied to a line I opened. Claims about the running
system have no file to cite and are kept separate, below.

VERIFIED: the masthead constant a new city must edit lives here | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/paper.ts:1
VERIFIED: the watch list a new city must edit lives here | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/paper.ts:71
VERIFIED: SEED_SOURCES is consumed only by ensureSeeds, which upserts with on-conflict-do-nothing | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/desk.ts:65
VERIFIED: the meeting-title keywords a new city must edit | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/youtube.ts:102
VERIFIED: the city video channels a new city must edit | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/youtube.ts:120
VERIFIED: the credit warning compares whole words, so an alias inside a longer word is not a credit | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/report.ts:342
VERIFIED: the credit warning itself, returning outlets named in sources but not in the body | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/report.ts:346
VERIFIED: Chromium's default launch args no longer include --no-sandbox | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/render-fetch.ts:94
VERIFIED: the sandbox opt-out is a single documented env var, not a code change | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/render-fetch.ts:89
VERIFIED: ensureBuilt asks whether a current build exists BEFORE taking the lock | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/test-support/pg-admin.ts:275
VERIFIED: and asks again while holding it, which is what stops a rebuild under live servers | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/test-support/pg-admin.ts:285
VERIFIED: the freshness check compares the marker against the newest source file | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/test-support/pg-admin.ts:234
VERIFIED: the watchdog's stale sweep starts from who holds the port being repaired | C:/Users/scott/Desktop/Code/townreporter-dev/ops/watchdog.ps1:147
VERIFIED: and stops only that owner, after confirming it is this app | C:/Users/scott/Desktop/Code/townreporter-dev/ops/watchdog.ps1:157
VERIFIED: the watchdog stands down while a promote marker is fresh | C:/Users/scott/Desktop/Code/townreporter-dev/ops/watchdog.ps1:75
VERIFIED: the gate that keeps the sweep port-scoped | C:/Users/scott/Desktop/Code/townreporter-dev/scripts/ops-scripts.test.mjs:265
VERIFIED: the gate that keeps ensureBuilt checking before it builds | C:/Users/scott/Desktop/Code/townreporter-dev/scripts/ops-scripts.test.mjs:236
VERIFIED: pglite is locked at 0.5.8 | C:/Users/scott/Desktop/Code/townreporter-dev/package-lock.json:527
VERIFIED: the app's own version constant reads 0.5.5 | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/version.ts:2

## Runtime observations

Things I ran and watched. There is no file:line for these, so they are not
dressed up as citations.

- Dev HEAD `9184a3a` at the time of writing, pushed, working tree clean
  (`git log`, `git status`).
- Production answered 200 both locally on `:3000` and publicly at
  townreporter.org (`curl`), and the production checkout is on `3475c16`
  (`git -C ../townreporter-web log`).
- No stray listeners on 8080/3050/3199/5199 (`netstat`).
- Tags stop at `v0.5.4` — there is no `v0.5.5` (`git tag -l`).
- CI was red on `8516ede`, `ae96926` and `08e3468`; every job died at
  `npm ci` on "Missing: lru-cache@11.5.2 from lock file"
  (`gh run list`, `gh run view --log-failed`).
- The regenerated lockfile installs cleanly under both npm 10 and npm 11, in
  a throwaway directory containing only package.json and the lock.
- The watchdog restarted a killed app: an instance on 3050 answered 200, was
  stopped by PID, and answered 200 again after the watchdog ran, while
  production's PID stayed 32056 throughout and `logs/watchdog.log` recorded
  "repaired: app".
- The six-file concurrent integration run — the same files and the same
  invocation CI uses — passed 25/25 after the ensureBuilt fix.
- `node --test scripts/**/*.test.mjs` passed 223, and each new gate was run
  RED against a deliberate mutation and GREEN again after restoring.

UNVERIFIED: CI is green on the lockfile fix - not checked; the run had not finished when this was written
UNVERIFIED: the windows-latest watchdog CI job passes as written - not checked; it has never run. Its recovery behaviour was proven locally instead, which is not the same thing
UNVERIFIED: item 7 CITY-SETUP takes roughly a week - not checked; an estimate, not a measurement
UNVERIFIED: the 0.5.5 changelog entry is inaccurate for its contents - not checked line by line; it was written before items 8, 9, 10 and 11 landed

## Standing constraints

- CivicCast may need the box; keep build/test bursts short and yield if asked.
- Never touch ports 3000, 5432, 5433. Never kill by image name.
- Only Scott tags — except he granted tag authority **for this series only**,
  on green, and only after a real lite+walkthrough gate with nothing but nits
  left.
- Promote after each item (batched here for CivicCast).

## A stale /goal will block every turn

The active `/goal` Stop hook is still the **v0.5.1 audit list** (TE-01..06,
TW-002..009, UIUX-02..05, ENG-008..010). Those 20 items are finished and
shipped — verified in code: `package.json:23` and `:26`, `ci.yml:102`,
`editorial.server.ts:75`, `states.tsx:364`, `desk-chrome.tsx:129`,
`desk.published.tsx:148`, `migrations/0018_search_index.sql`,
`voice.server.ts:1`, tag `v0.5.1`, and `artifacts/` down to 744K of Markdown
behind `scripts/artifacts-are-reports-only.test.mjs`.

The hook's evaluator only sees the post-compaction window, so it reads work
done earlier in the same session as never done, and blocks. It cannot be
satisfied by working: the only way to "show the work" would be to undo and
rebuild shipped features.

**Only Scott can clear it.** Do not redo finished work to appease it, and do
not let it push you into starting something new while paused.
