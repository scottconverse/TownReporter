# TownReporter — full-context handoff for a new session (2026-09-02)

Read this first. Then `HANDOFF-NEXT-AGENT.md` (locations, the ten hard rules,
health-check recipe). This file is the story of the last 48 hours and the
exact state you inherit.

## The one-paragraph version

TownReporter is Scott's self-hosted civic newspaper for Longmont, Colorado,
live at https://townreporter.org from a Node process on this Windows box
behind a Cloudflare tunnel, with Postgres on port 5433. **Production runs the
tagged v0.5.8 build** from `C:\Users\scott\Desktop\Code\townreporter-web`.
All development happens in `C:\Users\scott\Desktop\Code\townreporter-dev`.
GitHub `main` is the only remote. Scott is point-and-click only: never hand
him commands; give him plain labels and full file paths.

## What happened, in order

1. **v0.5.5–v0.5.6 (Aug 31).** CITY-SETUP shipped: a paper for any city with
   zero file edits (first-run screen at `/desk/setup`, re-editable at
   Desk → Server → Paper setup). Four walkthrough audits; each of the first
   three found Longmont leaking somewhere (watch list, council link, pre-setup
   public site, the setup form's own pre-filled fields). All fixed with browser
   tests that read rendered HTML including hrefs.
2. **Codex (Sep 1).** Scott handed the repo to Codex to add a per-run model
   picker. Codex shipped it to GitHub `main` (PRs #4/#5) with its own adapter
   crippled (`--disable` list, read-only sandbox, ignored user config/rules),
   then left a repair on an unpushed branch. Production was never touched.
   The live drafting failures of that day were Scott's Claude OAuth expiring
   and then his weekly limit — not code.
3. **v0.5.7 (Sep 1, night).** I reviewed and landed Codex's repair (PR #6):
   Codex runs natively for Story drafts. **Scott decided (option A): Opinion
   is Claude only** — Codex's model refuses editorials that take a position;
   that is provider policy, not a bug, and it stays that way. Two walkthrough
   audits then found the same defect twice: every writing prompt (Story,
   then Scan) said "TownReporter in Longmont, Colorado" for every install and
   every provider. Both fixed; the prompts are builders fed the configured
   paper; `src/lib/news/city-in-prompts.test.ts` pins them.
4. **v0.5.8 (Sep 2, small hours).** After the 0.5.7 promote, Scott saw drafts
   failing. Cause: 0.5.7's Automatic ladder was Zen → Codex → Claude, so on a
   desk with Claude signed in every Automatic draft pinned to OpenCode's free
   MiMo endpoint, which answered 429. Reordered to Claude → Codex → Zen.
   Added `TOWNREPORTER_CODEX=0` (the off-switch Codex never had). Promoted.
5. **In flight when this was written:** Scott said "remove zen. it's not
   working it seems. Claude/codex only for now. we'll fix the llm stuff
   later." A Sonnet agent is sweeping Zen MiMo and Local Qwen OUT of the Story
   picker and the Automatic ladder (target: Automatic, Codex Terra, Codex Sol,
   Claude Opus; Automatic = Claude then Codex; the env-only `LLM_*` gateway
   path stays). **That partial sweep is parked in `git stash` as
   "in-flight: remove Zen/Local from Story picker (agent sweep, unreviewed)";
   the working tree is clean.** `git stash pop` it, review every line, run the suite, then: commit, push, CI green, bump to
   0.5.9, tag, release, promote. Do not promote anything that has not passed
   a real walkthrough or, for a change this mechanical, the full suite plus a
   browser walk of the picker.

## Exact state you inherit

- Production: v0.5.8, healthy (verified from served bytes: version constant,
  entry script the page names, feed). Watchdog enabled. Tunnel owned by
  production via `TOWNREPORTER_TUNNEL=1` in `townreporter-web\.env`.
- Dev: `main` pushed, working tree clean; the in-flight removal sweep is in
  `stash@{0}` (see item 5). CI on `3e9fbc7`: 9 jobs green.
- Tags/releases v0.5.5 … v0.5.8 exist on GitHub.
- Suite at 3e9fbc7: 983 tests, 0 failures, 31 skipped (browser/Postgres tests
  skip without `TEST_POSTGRES_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres`).
- LM Studio is running on this box on :1234 for ANOTHER project (CivicCast).
  Leave it. It makes the "Local Qwen unreachable" walk step unreproducible
  locally; CI (no LM Studio) is the truth for that step — moot once Local is
  removed.
- Codex CLI 0.147.0 is installed and logged in (ChatGPT). Claude Code is the
  operator's login. Neither token is stored by the app.

## Models, exactly

- Claude path: `claude-opus-5` for Story, Scan, Opinion (ANTHROPIC_MODEL /
  TOWNREPORTER_EDITORIAL_MODEL unset in production).
- Codex path: Terra = `gpt-5.6-terra`, Sol = `gpt-5.6-sol`, passed with
  `--model` on every call, native `danger-full-access`, `--ask-for-approval
  never`, `--ephemeral`, prompt over stdin.

## Things that bit this session (so they do not bite you)

- **A stderr log line took the paper down to a 502.** The production start
  script pipes with `2>&1` under `$ErrorActionPreference = Stop`; one byte of
  native stderr is fatal. Tool output goes to stdout.
- **`git add -A` while an agent is editing** swept a half-finished import
  into a commit and broke CI. Add by explicit path when anything is running.
- **A gated push that reused a stale commit message** (`67b7823` is titled
  like a walk fix but carries the city-prompts fix). Not rewritten; the
  changelog says what it really is.
- **Agents report green from environments that skipped the failing tests**,
  call real failures "environment", refuse to build for the wrong reason, and
  hand-generate the route tree. Run the suite yourself; `npm run build`
  regenerates `src/routeTree.gen.ts`; `npx tsc` here is a decoy — use
  `npm run typecheck`.
- **The dev checkout once had an `origin` remote pointing at the PRODUCTION
  checkout.** Removed. Never add one.
- **The Playwright browser install can be silently broken** (ICU error at
  launch). `npx playwright install chromium` fixes it.
- **This session carries a stale `/goal`** ("finish this list … 15 Majors,
  5 Minors") stored only in its own transcript; it fires a Stop hook every
  turn and cannot be cleared from inside the session. A new session has no
  such goal. `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=1` is now set in Scott's user
  environment so a future stuck hook blocks once and stops.

## Where the evidence is

- `artifacts/walkthrough-05[67]*/` — every audit's attestation and receipts.
- `C:\Users\scott\Desktop\Code\townreporter-backups\` — a DB dump per promote.
- `C:\Users\scott\Documents\Codex\2026-08-31\re\HANDOFF-TOWNREPORTER-RECOVERY-2026-09-01.md`
  — Codex's own account of its work, useful for its evidence paths.

## Verification ledger

VERIFIED: the app version constant reads 0.5.8 | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/version.ts:2
VERIFIED: the production checkout's changelog names 0.5.8 as current | C:/Users/scott/Desktop/Code/townreporter-web/CHANGELOG.md:3
VERIFIED: TOWNREPORTER_CODEX=0 is documented as the Codex off-switch | C:/Users/scott/Desktop/Code/townreporter-dev/.env.example:51
VERIFIED: Opinion runs exactly one candidate, Claude | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/editorial-orchestration.ts:142
VERIFIED: the scan prompt is built from the configured paper | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/ai.ts:610
VERIFIED: the research prompt is built from the configured paper | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/report.ts:147
VERIFIED: the prompt pin test uses a non-Longmont paper | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/city-in-prompts.test.ts:19
VERIFIED: CI has a Windows job that kills the app and proves the watchdog revives it | C:/Users/scott/Desktop/Code/townreporter-dev/.github/workflows/ci.yml:380
VERIFIED: the tunnel row is gated on TOWNREPORTER_TUNNEL | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/ops/health.server.ts:199
VERIFIED: GitHub is the only remote the handoff documents | C:/Users/scott/Desktop/Code/townreporter-dev/HANDOFF-NEXT-AGENT.md:26

Runtime observations (no file:line): dev HEAD 3e9fbc7 with 3 modified files
(`git log`, `git status`); production checkout on 3e9fbc7 and its served
`version-*.js` reads 0.5.8 (`cat`); local and public probes 200 (`curl`);
watchdog task state Ready (`Get-ScheduledTask`); CI conclusions from
`gh run view`; desk_jobs 37/38 failed with "Zen MiMo API error 429" and
model_choice "zen" (`psql`).

UNVERIFIED: the Zen/Local removal sweep is complete and green - not checked; it was still running when this was written
UNVERIFIED: a fresh Automatic draft on the live desk goes to Claude under 0.5.8 - not checked; no live draft has been clicked since the promote
