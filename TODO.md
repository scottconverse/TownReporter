# TownReporter — TODO (canonical, in-repo)
_Kept current by whichever Claude session is working. Last updated: 2026-09-05 (0.6.17 live). Companion to `HANDOFF-SESSION-2026-09-04.md` (the full context) and `artifacts/dark-desk-review-2026-09-03/RECEIPTS-2026-09-04.md` (operator receipts)._

Legend: `[x]` done · `[~]` in progress · `[ ]` not started · **⏸** blocked on the owner

---

## In flight
- (nothing in flight)

## Open queue (bug fixes first — owner chose to skip the redesign for now)
0. [ ] **Prove reddit actually captures on live 0.6.17** — a real thread fetch should return content, not "blocked" (it 429d in independent review before the pacing fix).
1. [ ] **`source_monitors` newsroom-scoping** — still pinned to `DEFAULT_NEWSROOM_ID` (honest STOP from 0.6.11). Do this BEFORE exposing manual watch controls. Touches `investigate.ts` (`watchSource`/`maybeWatch`/`runDueMonitors`) + `monitors-cron.ts`.
2. [ ] **Manual "watch this page" for Dark Desk** — wire the existing `watchSource` to an editor button so an editor can put a page on the investigative monitor list by hand (today only the dig adds monitors). Do after #1. Must have clear UX feedback (owner rule).
3. [ ] **Legal removal** — one-click legal takedown for a published story: immediate purge (skip the 30-day trash), audit trail (who/when/why), and flag which on-disk DB backups still contain the item so an operator can complete the scrub. Context: normal delete keeps a restorable copy 30 days AND the story lingers in every backup taken while it existed.
4. [ ] **Finish "civic → non-profit" in source** — `src/routes/about.tsx` still says "a local civic newsroom"; add a seed migration so fresh installs get the non-profit welcome-article text (prod was edited directly). Rides the next release.
5. [ ] **Topics / sections (Phase 8)** — expand beyond the fixed civic topic list (business, etc.). **⏸ Needs the owner's section list.** P8.1 configurable sections in Paper setup; P8.2 per-section scanner sources/prompt.
6. [ ] **Dark Desk "do it right" pass** — **⏸ parked by owner.** (a) Grant the dig a CURATED, SAFE tool set (guarded web search/fetch with SSRF + domain limits + cost caps, like the owner's `civic-scanner`) so it investigates live instead of the rigid emit-queries/app-fetches loop — do NOT re-open the raw claude-CLI agent surface (Bash/Edit/MCP) on the prod box. (b) Restore the owner's fuller doctrine (two-stage Black Desk → Dark Signal verification, mandatory adversarial gate, self-referential Gate 4, search minimums) — ONLY after testing whether the 6-month-old prompts still hold up. Originals: repos `civic-scanner`, `civic-newsroom`, `civic-transparency-toolkit`, `CivicNewspaper`.
- **⏸ Redesign** — desk feels clunky/disjointed; owner may bring a designer. **DO NOT ACT** until he decides. Accessibility fixes are fine.

## Done (this stretch, all live unless noted)
- [x] 0.6.7 — Automatic fails over to Codex on a timeout, not only a sign-in lapse.
- [x] 0.6.8 — durable "why the draft switched models" note.
- [x] 0.6.9 — removed the invented "reader privacy" positioning (kept the self-contained-page CI check, renamed).
- [x] 0.6.10 — local model pickable on every surface (Opinion routing Blocker + cloud-fallback fixed in 0.6.13).
- [x] 0.6.11 — newsroom_id data-integrity (schema parity test, ~33 scoped inserts).
- [x] 0.6.12 — kill-safety on stale sign-in cancel; Scan/Sources CI coverage.
- [x] 0.6.13 — audit-fix + outage hardening (public page can't white-screen; promote verifies real content; test/ops tools don't default to prod).
- [x] 0.6.14 — **Stats tab** (editor-only anonymous view counts via fail-safe beacon).
- [x] 0.6.15 — **Dark Desk plumbing fix**: dig runs tool-free (app fetches), real article extraction, junk filter, URL dedup + capped dead-ends, reddit `.rss` routing, honest page. 247 poisoned/zombie prod rows retired (receipt).
- [x] 0.6.16 — Dark Desk actions confirm clearly (Send-to-queue links to the lead; feedback on every action).
- [x] "Non-profit" masthead/deck/welcome copy live.
- [x] 0.6.17 — Reddit requests strictly serialized + redd.it links resolve (TR-001). LIVE, tagged v0.6.17, 26 stories intact.

## Known caveats (honest state)
- Dark Desk is proven on ONE real staged topic (receipt); the Reddit leg was the weak spot (TR-001, now fixed pending release). Not a certification of every source type.
- `source_monitors` is not newsroom-isolated yet (#1).
- Migration 0038 dedupes new writes; historical URL variants aren't fully canonicalized (prod cleanup was a separate operator action).
- "Live" claims can only be made by the local session after promote + served-bytes check.

## Operating gotchas (see handoff §3 for detail)
Shared Postgres (never run heavy DB tests against 5433 while prod is live; use PGLite) · `npm version` lockfile trap (lru-cache) · promote verifies real content now · don't `Tee` background server launches · `npm run build` migrates against the .env DB by default · UI/UX is co-equal with code.
