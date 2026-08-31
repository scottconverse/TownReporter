# Build-list handoff — 2026-08-31

Working state at the pause. Everything below is verified, not assumed.

## Do not restart work until Scott says go.

## Where things stand

**Dev HEAD:** `08e3468`, pushed to `github/main`, working tree clean.
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
- and CI has **not** been checked since `8516ede` (three commits ago).

Six items are sitting in that unreleased window (4, 5, 6, 8, 9, 10, 11), so the
0.5.5 changelog entry no longer describes what is actually in it.

**First actions on resume, in order:**

1. Check CI on `08e3468` — it has never run for these commits.
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

## Standing constraints

- CivicCast may need the box; keep build/test bursts short and yield if asked.
- Never touch ports 3000, 5432, 5433. Never kill by image name.
- Only Scott tags — except he granted tag authority **for this series only**,
  on green, and only after a real lite+walkthrough gate with nothing but nits
  left.
- Promote after each item (batched here for CivicCast).
