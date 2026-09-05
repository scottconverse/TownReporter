# Dark Desk — Full Review (why it's not working)
**Date:** 2026-09-03
**Scope:** End-to-end review after the first real use (the r/longmont "Interesting budget situation" file). Four read-only reviewers: capture/extraction, tools/approval-gate, lead dedup, and page UX. Grounded in code (file:line) and the live prod data.
**Reviewer:** Claude (4× read-only), synthesized.

## TL;DR
The *reasoning* ("On the record") is actually decent. The *evidence-gathering underneath it is broken four ways*, and the page hides the failure so a broken dig looks busy. Not usable as-is. Every cause is fixable; plan below. It's editor-only, so none of this is public-facing — no emergency, but it's useless until fixed.

## The four root causes

### 1. No real content extraction — Critical
Captures keep the **whole page's text** — nav, mega-menu, footer, subscribe widgets — because `htmlToPlainText` just strips tags with no main-content extraction (no readability/boilerplate removal; no such library in the repo). So "successful" captures are the site's **menu**, not the article. Live proof: the "finance" capture is 9,674 chars of nav ("Accessibility — Ensuring accessible government services…"); the reddit capture is literally the word "Reddit."
Files: `src/lib/news/html-text.ts:9`, used at `src/lib/news/ingest.ts:527`; render allowlist `render-detect.ts`.

### 2. The dig model is handed live-but-denied tools — Critical (the "sandbox" garbage)
On its Claude leg, the dig spawns the **real local `claude` CLI** headless with `--allowed-tools ""` — which is a **live tool surface (Bash, WebSearch, WebFetch, MCP) with everything denied**, not "no tools." The planner prompt tells it to "go search, find sources." So the model tries tools, gets auto-denied ("This command requires approval" — that's the CLI's own string, not ours), and writes its **sandbox-escape musings into the leads/dead-ends JSON** → the editor's "Still unopened" pile. Live: ~35 poisoned frontier rows, reproducing for 6 days.
The **correct path already exists and works**: `search-web.ts` (Exa/DuckDuckGo/Bing/Brave/Wikipedia via plain fetch, no CLI, no gate). The model should only emit query strings + URLs; the app fetches. It just isn't told to stay in that lane, and is handed a denied tool surface.
Files: `ai-claude-code.server.ts:305` (`--allowed-tools ""`), dig calls `investigate.ts:692`, `dark.ts:787`, `dark.ts:1707`; working path `search-web.ts:436`.

### 3. The leads pile is mostly noise — High
- **Duplicate leads:** dedup is by exact text; URLs are never canonicalized (a canonicalizer exists but is used elsewhere). Live: the same municode Code-of-Ordinances page saved **7 ways** (`?nodeId=…`, path variants, case). No unique index.
- **Zombie dead-ends:** closed dead-ends are re-inserted with no upsert (one hypothesis **18×**) and re-surfaced every hop via an over-loose substring match, **pinned above real leads** (priority ≥11, no cap, no "settled" state). Live: 42 revived-dead-end rows crowding the top-40 window.
Files: `investigate.ts:823` (`persistDiscovery` dedup), `investigate.ts:2617`/`2653` (dead-end insert/resurface), pile query `dark.ts:466`.

### 4. The page hides the failure — Critical (UX)
Counts are raw row counts with no success/failure split, so a mostly-blocked dig renders **identically to a working one**: "12 records" counts failed captures; "40 to open" counts duplicates; the "Why it stopped — that is normal" copy fires even when the whole batch was blocked; the "On the record" analysis is built from the blocked captures with **no confidence/evidence signal**. Some load-bearing labels are also sub-14px (old-eyes rule).
Files: counts `dark.ts:348`, header `desk.dark.tsx:898`, pause copy `desk-copy.ts:172`, synthesis pool `investigate.ts:1425`, brief font sizes `investigation-brief.tsx`.

### Plus: reddit uses the wrong path
Your **reddit-search technique** (browser-UA `.rss` feeds, paced ~8s) already lives in `reddit.ts` for the curated source — but the **generic fetch path** (any reddit URL the dig proposes) has zero reddit handling, so it gets the JS shell. That's the "route reddit through old.reddit.com" the model reinvented; the real fix is the `.rss` technique.

## Prioritized fix plan

**P0 — make it gather real evidence and stop poisoning the pile:**
- **F1** Tell the dig model it has NO tools — emit only `searches`/`fetch_urls`; the app fetches (search-web.ts already does). Stop handing the CLI a live-denied tool surface. *(fixes the sandbox garbage at the source)*
- **F2** Add real article extraction (readability/boilerplate strip; render JS for app-shell sites) so captures are content, not menus.
- **F3** Apply the self-referential filter (`isSelfReferential`) to **all** model outputs (frontier/anomalies/dead_ends/signals), not just claims, and widen it to the new vocabulary (approval/blackout/tool-schema/MCP).

**P1 — clean signal:**
- **F4** Canonicalize URLs before dedup + a unique index; upsert dead-ends with a confirmation count and a settled state; stop pinning revived noise above real leads.
- **F5** Route the generic fetch path's reddit URLs through the `.rss`/browser-UA technique (the reddit-search skill), with its pacing.

**P2 — honest UX:**
- **F6** Split counts (opened vs blocked), condition the "why it stopped" copy on the blocked ratio, add a "this dig is being blocked" banner + exit ramp, grade findings by evidence strength, bump sub-14px labels.

**Cleanup:**
- **F7** Purge the ~35 poisoned frontier rows + the duplicate/zombie rows once F1–F4 land (else they get "reopened" again).

## Verification ledger

VERIFIED: the Claude CLI is invoked with `--allowed-tools` + `(opts.allowedTools ?? []).join(",")`, i.e. an empty allow-list (a denied-but-live tool surface) when no tools are passed | src/lib/news/ai-claude-code.server.ts:305-306
VERIFIED: the dig/planner/synthesis calls go through grokChat/grokPlanner (no allowedTools threaded) | src/lib/news/investigate.ts:692 ; src/lib/news/dark.ts:787,1707
VERIFIED: a working tool-free search path exists (searchWithFallback) that the app can drive without the CLI | src/lib/news/search-web.ts:436,449
VERIFIED: a self-referential filter exists and is imported into the dig | src/lib/news/claim-hygiene.ts:50 ; imported at src/lib/news/investigate.ts:11
UNVERIFIED: no main-content extraction in htmlToPlainText (captures keep nav/footer); the finance capture is 100% nav and the reddit capture is 6 chars "Reddit" - relayed from the capture reviewer (grounded at html-text.ts:9, ingest.ts:527, prod artifact_versions id 689/682), not re-opened by the synthesizer
UNVERIFIED: isSelfReferential is applied ONLY to `claims`, not frontier/anomalies/dead_ends/dark_signals - relayed (grounded at investigate.ts:609), not re-checked
UNVERIFIED: ~35 poisoned frontier_items on prod reproducing since 2026-08-28; the "This command requires approval" string is not in the TownReporter source (it is the CLI's own) - relayed from the tools reviewer (prod SELECT + grep), not re-run by the synthesizer
UNVERIFIED: duplicate leads (same municode page 7 ways) and dead-ends re-inserted up to 18× / 42 open revived-dead-end rows - relayed from the dedup reviewer (prod SELECT at frontier_items/dead_ends), not re-run
UNVERIFIED: headline counts (records on file / still to open) are unfiltered row counts, and the "Why it stopped" copy is unconditional - relayed from the UX reviewer (grounded at dark.ts:348, desk.dark.tsx:898, desk-copy.ts:172), not re-checked
UNVERIFIED: reddit `.rss`/browser-UA handling exists in reddit.ts but NOT in the generic fetch path (ingest.ts/fetch-url.ts) - relayed from the tools/capture reviewers, not re-checked

## Per-area reviewer notes
Full detail from each reviewer is in this session's transcript (capture/extraction, tools/approval-gate, dedup, UX).
