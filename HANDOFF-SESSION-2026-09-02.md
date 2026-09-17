# TownReporter — full-context handoff for a new session (2026-09-02)

## STATE AS OF 21:40 2026-09-02 (read this first)

**Production is on v0.6.3 (f9c2a1a)**, live at https://townreporter.org,
served from `C:\Users\scott\Desktop\Code\townreporter-web`. **v0.6.4
(6495a51) is sitting in dev HEAD and CI right now** — not yet tagged or
promoted. The coordinator intends to tag/release/promote it tonight if CI
comes back green; **the next session must check for itself** which one is
actually live before assuming either way — run `git tag` (dev checkout) and
fetch `https://townreporter.org/assets/version-*.js` (or read the served
version constant) rather than trusting this paragraph's tense. Development
happens in `C:\Users\scott\Desktop\Code\townreporter-dev`. GitHub `github` is
the only remote (`https://github.com/scottconverse/TownReporter.git`).

**0.6.3 — ops hotfix, already live.** Address-aware port checks
(`Test-TownReporterPort` / `Get-TownReporterPortOwner` in
`ops/lib-port.ps1`), shared by start/watchdog/restart/promote/status/stage,
so a port check only counts a listener bound to an address this app can
actually use (127.0.0.1, 0.0.0.0, or `.env` `HOST`) — closes the false
"already up" read that caused the 17:43 IPv6-collision outage (see Incidents
in the plan file).

**0.6.4 — GauntletGate gate fixes, CI in flight, not yet promoted.** A full
GauntletGate run (walkthrough + all 5 roles) against the dev tree scored
**0 Blocker, 2 Critical, 11 Major, 14 Minor, 5 Nit** and returned **DO NOT
ADVANCE**; first-run coverage was VALID (a brand-new operator with nothing
installed reaches the desk and every core action degrades gracefully, never
a dead end). Full detail: `artifacts/gate-townreporter-2026-09-02/GATE-REPORT.md`.
The two Criticals:

- **ENG-01** — the ops dashboard's owner-only actions (restart app, restart
  tunnel, migrate, rotate logs, and the host health report) were gated only
  in React (`isOwner` hiding the panel); the server functions themselves
  (`getOpsHealth`, `runOpsAction`) checked newsroom membership but not role,
  so an invited *editor* could call them directly and reach owner-only
  machine actions.
- **QA-1** — the scan duplicate-lead matcher could silently discard a
  genuinely distinct lead that happened to share a portal URL, a date, and a
  dollar figure with an unrelated one (e.g. two different agenda items on
  the same PrimeGov page).

Both were fixed and put through **independent adversarial re-verification by
a fresh agent that did not write the fix**, not just the fixer's own claim:

- ENG-01: `assertOwner` (lifted into `src/lib/news/desk-auth.ts`) is now the
  first line of both `getOpsHealth` and `runOpsAction`
  (`src/lib/ops/dashboard.ts`). Proven at runtime — a real invited-editor
  session against a live built server got refused ("Only the owner can do
  that."), the owner's identical call passed.
- QA-1: took three adversarial rounds to actually close. Round 1's fix
  (require a shared content word on the anchor path) still let the two
  headline-overlap paths merge different agenda items on shared civic
  filler words. Round 2 (score every path on content tokens only) still
  merged 6 of 10 new negative pairs and missed 1 positive — a pure
  threshold could not distinguish "same story reworded" from "same agenda
  template, different item." Round 3 changed the product's behavior instead
  of tuning the threshold: `matchStrength()` (`src/lib/news/lead-match.ts`)
  now scores every candidate "strong" (stamp the existing lead "seen again,"
  as before) or "possible" (file it as its own new lead, never discarded,
  with a new `leads.possible_duplicate_of` column — migration `0031` — and a
  dotted **MAYBE SAME AS #N** chip on the row for the editor to judge). 0 of
  18 distinct-story pairs across all three rounds now score "strong."

After fixes, re-verification returned **0 Blocker, 0 Critical** (Major 9,
Minor 14, Nit 5 — all riding on the watchlist) and **CLEAR TO ADVANCE,
conditional on CI green and a staged walk of the final tree** — shipping as
v0.6.4. Also in 0.6.4: Time-per-call now refuses non-numeric/NaN/Infinity
input instead of silently treating it as a Reset (QA-2); `.env.example`'s
Opinion comment and `docs/manual.md`'s stale "unreleased candidate" scope
note both fixed (TEC-01/02); e2e walks hardened (no `networkidle` on setup —
element/URL waits instead), tied to the CI-stall watchlist item below.

**Watchlist carried forward from the gate** (not blocking, not yet worked):
ENG-02 (Dark Desk rebuild path recreates tables without `newsroom_id`),
ENG-03 (migration/ensure drift, 9 tables), ENG-04 (26 inserts omit
`newsroom_id`), ENG-05 (Automatic doesn't fail over on an unusable-but-
successful rung — design decision needed), ENG-06 (stale sign-in cancel can
kill a recycled PID), ENG-11 (stale session cookie honoured on an ownerless
DB), UIU-01 through UIU-04 (header wraps at 1280px with Large text — belongs
with the redesign Scott is already considering, do not fix ad hoc), TES-01
(Scan/Sources screens lack CI browser coverage), TES-02 (build lock not
namespaced), QA-3 (dev server ships no security headers), the offline cell
(no walkthrough row exists for it — the web-search chain is unconditional),
and the repo-committed `.env` shipping `TOWNREPORTER_CLAUDE_CODE=0`.

**Intermittent CI stall, still open.** The first-run setup walk has stalled
in CI 3 separate times today; a dedicated agent could not reproduce it in 10
throttled local runs and made no speculative product change. The walks were
hardened (element/URL waits instead of `networkidle`) and both dependent
walks passed clean afterward, but the root cause itself is still open — this
is a mitigation, not a fix, and it may resurface.

**Cross-session messaging.** Same-machine agent-to-agent messaging works.
Cross-machine (Remote Control) messaging **failed in both directions** with
a false "delivered" status on the sending side — filed as
`anthropics/claude-code#91671` (posted at Scott's instruction). Separately,
`anthropics/claude-code#91549` (Fable being routed code-writing work it
shouldn't get) is still open.

**Operator notes, unchanged.** The desk redesign is pending — **do not act
on it**, it is Scott's call. Scott has been away and back intermittently
today; treat any given moment as "assume away unless told otherwise." The
nightly proof scheduled task ("TownReporter Nightly Proof", 03:30 daily)
has not had its first real fire yet as of this writing.

**Prior releases today, for context** (0.5.9 through 0.6.2, all still live
in history, superseded by 0.6.3/0.6.4 above):

- **0.5.9** — the Zen/Local-model removal swept in (Automatic ladder down to
  Claude → Codex; picker down to Automatic, Codex Terra, Codex Sol, Claude
  Opus).
- **0.5.10** — a provider auth error mid-draft now says "sign in again," and
  names the claude.ai browser login as separate from Claude Code's CLI login.
- **0.5.11** — Automatic fails over to the next ladder rung on a login lapse
  only, once per job, recorded on `desk_jobs.model_choice_source`.
- **0.5.12** — docs no longer hardcode a version number in the "unreleased
  features" notice.
- **0.6.0** — a Server-page **Writing models** panel: sign in to Claude Code
  or Codex from inside the desk (no terminal), a one-call **Test** button,
  and a Sign-in button surfaced directly on a failed draft/scan.
- **0.6.1** — Scan gets the same per-run writing-model picker and fail-over
  Story has; Scan's AI read gets the same provider-sized time budget as a
  draft (was a flat 90s, now 150s on the CLI providers); a killed lead the
  scanner re-finds is stamped "seen again ×N" instead of being refiled;
  Server-page buttons say what they do; Dark Desk and Opinion say "sign in
  again" on a lapsed login; staging is now mandatory pre-promote via
  `ops\stage.ps1`.
- **0.6.2** — one shared provider registry (`src/lib/news/provider-registry.ts`)
  that every picker, the Automatic ladder, and every timeout floor now read
  from instead of four hand-synced spots; a per-paper **Time per call**
  control per model on the Server page (`provider_settings`, migration 0029);
  a Dark Desk **Digging model** picker and the Brief turned into a queued job
  like Story/Scan/Opinion (migration 0030); an anchor-based duplicate-lead
  matcher (fixes a PRINTED-status bug) that stamps a killed lead the scanner
  re-finds as "seen again ×N" instead of refiling it; WCAG AA color contrast
  plus a Text Normal/Large control; Automatic's fail-over path now proven by
  a real browser end-to-end run in CI, not just a unit test; and a nightly
  scheduled task (Windows Task Scheduler, "TownReporter Nightly Proof", 03:30
  daily) that runs the live scan-then-draft pipeline for real and writes
  proof to `artifacts/nightly/`. See `CHANGELOG.md` for the full text of each
  entry — the lines above are summaries, not the record.

**Release path now (binding).** Suite + build + lint locally, push, wait for
CI green (10 jobs, including a provider-signin job) on GitHub, then in the
**dev** checkout run `ops\stage.ps1`: it restores the newest backup from
`C:\Users\scott\Desktop\Code\townreporter-backups` into the `townreporter_dev`
database, builds, and serves the candidate on `127.0.0.1:3100`
(`scripts/stage-editor.mjs` creates a `staging@townreporter.test` /
`staging-walk-2026` editor login for the walk — see `docs/staging.md`).
Walk every changed screen on that staged copy. Only then tag, `gh release
create`, and run `ops\promote.ps1` from the **production** checkout
(`townreporter-web`), with the watchdog scheduled task disabled before and
re-enabled after. Verify the promote by reading the served version bytes
(the page's version constant / entry script name), not by trusting the
script's own "Promoted" line. **Known quirk:** `promote.ps1`'s outer pwsh
wrapper hangs after printing "Promoted" — stop only that one PID, nothing
else.

**Operator rules recorded today** (apply going forward): Fable coordinates
only and writes zero product code; Sonnet/Opus do the building (there is an
open GitHub issue, `anthropics/claude-code#91549`, about Fable being routed
code-writing work it shouldn't get). Any decision that needs Scott's call
comes as its own labelled block: plain-language statement of the choice, at
most two options, a recommended pick, and why — never buried in prose.
Anywhere an AI model acts in the product there must be a model picker in the
UI (no silent single-provider paths). Local LLMs (llama.cpp / LM Studio) are
the next provider tier to add, so every picker should read from one shared
model registry rather than being hand-wired per feature. Any operation with
a timeout must have that timeout editable from the UI, not just in code. A
killed lead must never be silently hidden from Dark Desk's context — it
stays visible there, marked as killed/resurfaced.

**0.6.2 shipped**, merged from the two worktrees (`registry`, Opus; `proofs`,
Sonnet) described in earlier state above. CI needed two pushes to go green:
`package-lock.json` had lost nitro's `lru-cache` entry (a Windows `npm
install` drops it; Linux `npm ci` on the runner requires it) — restored from
the previous lockfile. Separately, "The 0.5.1 desk flows" browser walk
stalled once on the setup page and passed clean on rerun; 3 local
reproduction attempts did not reproduce the stall — treated as CI flake, not
a code defect, pending a repeat. Staged, walked, tagged, released, and
promoted at 17:43.

**INCIDENT, 17:43–~18:10.** The promote stopped the running app as designed,
but the app did not come back up: `ops/start-townreporter.ps1`'s
`Test-Port` check (`Get-NetTCPConnection -LocalPort 3000`, no address
filter) found an unrelated dev server — `vinext dev` for
`halo-research-gateway/website`, PID 39124, owner unknown, neither live peer
Claude session claimed it — listening on `[::1]:3000` (IPv6 only), concluded
TownReporter was already up, and never started it. TownReporter binds
`127.0.0.1:3000` so there was no actual port collision, only a false-positive
liveness check. `promote.ps1` reported `[FAIL]` and townreporter.org served
502 for roughly 27 minutes. Recovery: the coordinator started the built
server directly with the start script's exact command (`node
scripts/with-app-env.mjs node .output/server/index.mjs` from
`townreporter-web`, logging to `logs/app.*.log`). The foreign PID 39124 was
NOT killed — ownership unconfirmed, left alone. Fix in flight as **0.6.3**:
an address-aware `Test-TownReporterPort` in `ops/lib-port.ps1`, shared by
start/watchdog/restart/promote/status/stage, probing `127.0.0.1` explicitly
instead of `localhost`.

**Operator notes.** Scott flagged the desk as "clunky and disjointed" and a
redesign is pending — this is a design decision for Scott, **do not act on
it**. Scott has been away for a few hours as of ~16:40; the coordinator has
the helm and is continuing release/hardening work solo.

**Open items:** 0.6.3 hotfix (address-aware port checks) is in flight; Phase
4 GauntletGate full-lane pass is still pending; the Server-page header wraps
to two lines at 1280px since the Text Normal/Large control was added in
0.6.2 (cosmetic, noted for the pending redesign rather than fixed now); a
live scan under 0.6.1 was confirmed complete within the new 150s budget with
3 killed leads correctly stamped "seen again ×N" — verified.

**Known facts, so you don't relitigate them.** Claude Code's login on this
box lives in the CLI's own file, `~/.claude/.credentials.json` — separate
from the Cowork desktop app's own auth; the two do not share state. A
headless `claude -p` call will silently refresh an expired access token if
the stored refresh token is still valid. On 2026-09-02 the refresh token
itself was rejected by the server (401) and the CLI cleared its local login
entirely; Codex was found signed out at the same time. Scott re-signed in to
both by hand. The Server page's **Writing models** panel (shipped in 0.6.0)
is the in-app fix for exactly this failure mode going forward. Separately,
the Scan AI read timed out at 90s twice under 0.6.0 in production; 0.6.1
raises that to 150s on the CLI providers, but that fix has not yet been
confirmed against a real 0.6.1 production scan — Scott is running one as
this is being written. Story count on the live paper is 19.

**Evidence paths**, in case a claim above needs re-checking:
`artifacts/clean-install-0512` (walkthrough at
`C:\Users\scott\Desktop\Code\clean-install-0512\WALKTHROUGH.md`),
`artifacts/signin-spike-2026-09-02`, `artifacts/logs-contrast-0.6.1`, the
`server-copy-0.6.1` artifact inside the `registry` worktree
(`.claude/worktrees/agent-ae1088488784e61c3/artifacts/server-copy-0.6.1`),
and DB backups in `C:\Users\scott\Desktop\Code\townreporter-backups\`
(newest as of writing: `townreporter_2026-09-02_1556.sql`).

### Verification ledger

VERIFIED: dev HEAD's version constant reads 0.6.4 | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/version.ts:2
VERIFIED: the changelog names 0.6.4 as current | C:/Users/scott/Desktop/Code/townreporter-dev/CHANGELOG.md:3
VERIFIED: the gate verdict lines (DO NOT ADVANCE before fixes, CLEAR TO ADVANCE after) | C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-09-02/GATE-REPORT.md:1
VERIFIED: assertOwner is present as the first check in the ops server functions | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/ops/dashboard.ts:1
VERIFIED: matchStrength is present in the lead matcher | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/lead-match.ts:1

UNVERIFIED: v0.6.4 has been promoted to production - not checked; CI was still in flight as of this writing, promotion is planned for tonight if green
UNVERIFIED: the nightly proof task's first scheduled run (03:30) has happened - not checked; next scheduled fire is 03:30

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
   path stays). **That partial sweep is parked in TWO stashes: `stash@{1}` "in-flight:
   remove Zen/Local from Story picker (agent sweep, unreviewed)" and
   `stash@{0}` "in-flight (part 2)", the agent's last docs/manual.md edits.
   The working tree is clean; the agent was stopped.** Pop both (part 2 on
   top), review every line, run the suite, then: commit, push, CI green, bump to
   0.5.9, tag, release, promote. Do not promote anything that has not passed
   a real walkthrough or, for a change this mechanical, the full suite plus a
   browser walk of the picker.

## Exact state you inherit

- Production: v0.5.8, healthy (verified from served bytes: version constant,
  entry script the page names, feed). Watchdog enabled. Tunnel owned by
  production via `TOWNREPORTER_TUNNEL=1` in `townreporter-web\.env`.
- Dev: `main` pushed, working tree clean; the in-flight removal sweep is in
  `stash@{0}` + `stash@{1}` (see item 5). CI on `3e9fbc7`: 9 jobs green.
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

## Postscript, later on 2026-09-02: item 5 is done

v0.5.9 is LIVE. The Zen/Local removal sweep was popped from both stashes,
reviewed line by line, swept for leftovers (four stale doc lines fixed:
manual env table, local-models.md picker claims), suite 986/0 fail with
Postgres, typecheck and lint clean, desk-flows browser walk 20/20 on a
throwaway desk on port 3199 (Codex hidden via APPDATA/PATH to match CI),
pushed as 7596aaf + ad4d91d, CI 9/9 green, tagged v0.5.9, released, promoted
with ops\promote.ps1 (backup townreporter_2026-09-02_0233.sql, 17 stories
before and after). Watchdog re-enabled. Only the forensic stash remains.

One CI red on the way: scripts/editorial-delivery-docs.test.mjs pinned the
literal v0.5.8; it now reads the version from package.json. Lesson: rerun the
suite AFTER the version bump, not before.

Still UNVERIFIED: a fresh Automatic draft on the live desk goes to Claude under
0.5.9 - not checked; that needs Scott's signed-in desk.

VERIFIED: the app version constant reads 0.5.9 | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/version.ts:2
VERIFIED: the changelog names 0.5.9 as current | C:/Users/scott/Desktop/Code/townreporter-dev/CHANGELOG.md:3
VERIFIED: the docs test derives the tag from package.json | C:/Users/scott/Desktop/Code/townreporter-dev/scripts/editorial-delivery-docs.test.mjs:48

## Postscript, later still on 2026-09-02: v0.5.10 and v0.5.11 shipped

v0.5.10 (6e11c04): a provider auth error mid-draft now says "sign in again,"
not "click again," and names the claude.ai browser login as separate from
Claude Code's. Detection shared via looksLikeProviderAuthFailure in
preflight.ts so the classifier and desk copy cannot drift.

v0.5.11 (737d982): Automatic fails over to the next ladder rung on a login
lapse only, once per job, recorded via desk_jobs.model_choice_source
(migration 0026) and decided by planAutomaticFailover in
automatic-failover.ts. performDraftWork got wrapped in createServerOnlyFn:
its new imports leaked server modules into a client chunk; that was the fix.

Both promoted. Live DB has 0026 applied; 17 stories intact. Backups:
townreporter_2026-09-02_1023.sql and _1118.sql. Root cause of the live 401
on job 41: Claude Code's saved OAuth token (8h) expired and the headless run
did not refresh it, while an interactive `claude -p` five minutes later did
-- why the headless run didn't is still unknown.

Known quirk: promote.ps1's outer pwsh wrapper hangs after "Promoted" -- stop
only that PID.

VERIFIED: version constant reads 0.5.11 | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/version.ts:2
VERIFIED: planAutomaticFailover requires source auto | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/automatic-failover.ts:54
UNVERIFIED: a live Automatic draft has exercised the fail-over path - not checked; needs a lapsed login on the live desk
