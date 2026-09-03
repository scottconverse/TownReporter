# GauntletGate report — TownReporter — v0.6.3 (release candidate for "ready for other people")

**Date:** 2026-09-02 · **Build/commit:** f9c2a1a (v0.6.3, live in production since 18:12) · **Run by:** Fable 5.1 coordinator (Townreporter2) orchestrating one Walkthrough agent (Sonnet) and five role agents (Principal Engineer on Opus; UI/UX, Technical Writer, Test, QA on Sonnet), read and cross-checked by the coordinator.
**Lanes run:** walkthrough, full · **Lanes NOT run:** lite (feeder only; not part of the advancement bar)
**How run / environment:** dev checkout `C:\Users\scott\Desktop\Code\townreporter-dev`; first-run rows on PGLite dev servers (ports 3321 absent, 3322 faked-present) with a verified clean APPDATA and both CLIs made absent; populated row on a real production backup via `ops\stage.ps1` (port 3100, read-only). Production was not touched.

---

## Verdict (read first)

> **⛔ DO NOT ADVANCE**

- **First-run:** reaches core feature ✅ — a brand-new operator with no model installed reaches the desk, sets up a paper, and every core action (Draft, Scan, Dark Desk, Opinion) degrades to a guided in-product message, never a dead end. (first-run coverage: **VALID**)
- **Severity roll-up (walkthrough + full, duplicates counted once):** Blocker 0 · **Critical 2** · Major 11 · Minor 14 · Nit 5
- **One-line why:** two Criticals block advancement — an invited *editor* can run owner-only machine actions (restart the app, restart the tunnel, migrate, rotate logs) because the ops server functions check membership but not role; and the Scan duplicate matcher can silently discard a genuinely distinct lead that shares a portal URL, a date and a dollar figure with an unrelated one.

---

## Environment provisioning — verified (attestation)

Produced by the Walkthrough lane; artifacts on disk under `artifacts/walkthrough/`.

| What | State used | How VERIFIED — not assumed |
|---|---|---|
| Profile / APPDATA isolation | `C:\tr-gate-scratch\absent-appdata` (empty) for the absent row; `...\present-appdata` for the faked row | Directory listed empty before and after; the real npm shims live under the untouched real `%APPDATA%\npm`; that path segment stripped from the launching shell's PATH (`where claude` resolved there before the run) |
| First-run flags | Unset (no owner) | `/login` served "Create the desk" (0 editors) on first navigation to the fresh PGLite instance |
| External dependency: Claude Code CLI | ABSENT (probed) / PRESENT faked | `CLAUDE_CLI_PATH` → nonexistent file + shim off PATH; the desk's own Server-page probe read "NOT INSTALLED — Claude Code was not found on this machine." Present: `scripts/fakes/fake-claude-cli.mjs`, a real draft job run end to end |
| External dependency: Codex CLI | ABSENT (probed) / PRESENT faked | Same method; Server page read "NOT INSTALLED — Codex is not installed…" |
| Data store | Empty (PGLite, absent/present rows) / Populated (real backup `townreporter_2026-09-02_1812.sql`, 19 stories) | Server page Health tile read "embedded (PGLite) … 1 published · 0 drafts · 0 leads · 0 sources" right after setup; staging reported 19 published stories and showed real Longmont content |
| Network | Online | Research pass made live web requests even with CLIs absent (the search chain is unconditional); offline cell not constructed — see watchlist |

**Isolation verified?** YES · **First-run coverage:** VALID
**Evidence artifacts:** `artifacts/walkthrough/01-server-page-note.txt`, `artifacts/walkthrough/01-server-page-dependency-absent.html`, `artifacts/walkthrough/02-dependency-present-failover-draft.txt` (all present on disk, listed by the coordinator). Cells covered: first-run × absent × empty × online; first-run × faked-present × empty × online; returning × populated (real) × online. Not covered: any offline cell; returning × empty.

---

## Lane results

### Walkthrough
First-run verdict: reaches core feature ✅ (coverage VALID). 0 Blocker · 0 Critical · 1 Major · 2 Minor · 1 Nit. Report: `00-walkthrough.md`.
- **Finding 1 · Major** — Automatic fails over on a 401 login lapse (proven live with fake CLIs: Claude Opus → Codex Terra, banner shown, job completed) but **not** when the first rung exits successfully with an unparseable answer; the editor gets a manual-retry message. Same defect as ENG-05; counted once. QA disputes severity (the fail-over module's design comment deliberately excludes malformed answers) — recorded as a tension, kept at Major because the editor's experience is "Automatic did not do its job".
- Finding 2 · Minor — the repo-committed `.env` sets `TOWNREPORTER_CLAUDE_CODE=0`, which makes a clean checkout report "Disabled by operator" instead of the true not-found probe.
- Finding 3 · Minor — a stale signed session cookie was honoured by a freshly reset, ownerless database and skipped "Create the desk" (ENG-11 is the root cause).
- Finding 4 · Nit — no byte-for-byte offline first-run is possible without OS-level egress blocking because the web-search chain is unconditional.
- Readiness by area: create-desk gate genuine; paper setup rewrites masthead/welcome; every core action guided when the CLI is absent; staging script clean; populated desk and public site correct at desktop and 375px with zero console errors.

### Full
Per-role roll-up (deep-dives in `01-engineering.md` … `05-qa.md`; all five ran; none empty or truncated):

| Role | Blocker | Critical | Major | Minor | Nit | Top finding |
|---|---|---|---|---|---|---|
| Principal Engineer (Opus) | 0 | 1 | 5 | 6 | 2 | ENG-01 ops actions owner-gated only in React |
| UI/UX Designer | 0 | 0 | 2 | 2 | 1 | UIU-01 Large text breaks the masthead at 1280px |
| Technical Writer | 0 | 0 | 2 | 1 | 0 | TEC-01 `.env.example` says Opinion offers Codex |
| Test Engineer | 0 | 0 | 1 | 2 | 1 | TES-01 Scan and Sources screens have no CI browser coverage |
| QA Engineer | 0 | 1 | 1 | 1 | 0 | QA-1 matcher discards a distinct lead on shared URL+date+amount |

**Cross-role findings.**
- **ENG-01 (Critical)** is also a test gap (no privilege-boundary test) and a docs gap (the manual never states what an editor may not do). Triple finding.
- **QA-1 (Critical)** is also a test gap (`lead-match.test.ts` has no distinct-subject negative on the anchor path) and a docs gap (docs/editor.md describes the stamp as safe). Triple finding.
- **ENG-05 = Walkthrough Finding 1.** ENG-11 = Walkthrough Finding 3's root cause.
- **ENG-02/03** are test gaps first: `dark-schema-rebuild.test.ts` asserts the table exists, not that it is usable; only 4 of 10 ensure functions have a migration-parity test.
- **UIU-01** and the operator's own report earlier today (header wraps at 1280px) are the same defect; UIU-02 is a contrast pair the audit script deliberately excludes.
- **QA-3** (dev server carries no security headers because the Nitro middleware is build-only) is a docs gap for anyone testing on `npm run dev`.

Coordinator verification of the two Criticals: `src/lib/ops/dashboard.ts` lines 20–28 show both server functions carry only `deskMiddleware`; no `assertOwner` in the file. `src/lib/news/lead-match.ts` line 69 sets `ANCHOR_MATCH_MIN_SHARED = 2` and line 309 fires the anchor path on a shared URL with no subject-noun requirement; QA's repro follows directly.

---

## Blocking punch list (must clear to advance)

| ID | Title | Sev | Lane/role | What to do | Size |
|---|---|---|---|---|---|
| ENG-01 | Ops actions and ops health are owner-gated only in the browser | Critical | Full/Eng | `assertOwner(context.role)` first in `getOpsHealth` and `runOpsAction`; lift the helper into desk-auth; unit test the guard; editor-role e2e asserting 403 | S |
| QA-1 | Anchor-path matcher merges distinct stories sharing URL + date + amount | Critical | Full/QA | Anchor path also requires ≥1 shared non-stoplist subject noun (or: log/flag the candidate instead of discarding it); add the library-roof vs park-irrigation negative and a filing test that the second lead still inserts | S |
| QA-2 | Time-per-call server fn treats NaN/Infinity/non-numeric as "reset" | Major | Full/QA | Reject non-finite/non-numeric with the same error the range check uses; test | S |
| TEC-01 | `.env.example` says Opinion offers Codex Sol then Claude | Major | Full/Docs | Rewrite the comment to Claude-only | S |
| TEC-02 | `docs/manual.md` opening note calls the manual an "unreleased candidate" | Major | Full/Docs | Delete or rewrite the scope note | S |

The product does not advance until ENG-01 and QA-1 are fixed and re-verified. QA-2, TEC-01, TEC-02 are cheap and ride along.

## Next-stage watchlist

- ENG-02 Dark Desk rebuild path recreates tables without `newsroom_id`; strengthen `dark-schema-rebuild.test.ts` to insert and select. (M)
- ENG-03 migration/ensure drift both ways (9 tables, 2 code-only columns); a parity test over all 10 ensure functions. (M)
- ENG-04 26 inserts omit `newsroom_id`; harmless with one newsroom, a data-loss trap for a second. (M)
- ENG-05 / Walkthrough F1 Automatic does not fail over on an unusable-but-successful rung; decide the policy, then encode it. (M, design decision)
- ENG-06 stale sign-in cancel can `taskkill` a recycled PID; check process identity (name + start time) before killing. (S)
- ENG-11 / Walkthrough F3 stale session cookie honoured on an ownerless database. (S)
- UIU-01 Large text breaks the 1280px masthead; UIU-02/03/04 contrast and size leftovers; belongs with the redesign Scott is considering. (M)
- TES-01 Scan and Sources screens need CI browser walks; TES-02 build lock not namespaced (re-finding from 08-30). (M)
- QA-3 dev server has no security headers; document it. (S)
- Walkthrough: no offline cell; `.env` ships `TOWNREPORTER_CLAUDE_CODE=0`. (S)
- Test Engineer note: the full suite does not finish inside 25 minutes on this box under agent load; the coordinator's gate runs finish in ~7 minutes when the box is otherwise idle.

## What's working (credited, specific)

- SSRF defence is two-layer and real: host screening plus a guarded DNS lookup on the outbound agent, per-hop redirect re-check, and the Playwright renderer behind a loopback proxy re-validating every subresource.
- No prompt ever becomes an argv entry; the CLI adapters refuse shells and `.cmd` shims; model ids come from a closed registry.
- The ops action list is a fixed allowlist of six ids mapped to fixed commands (ENG-01 is about who may pull the lever, not what the lever can do).
- The job queue is race-safe by construction: partial unique index, `ON CONFLICT DO NOTHING`, claim tokens, heartbeat inside the stale window.
- First-run truth: a brand-new operator with nothing installed is guided at every core action, never dead-ended; the Server page's dependency probe tells the truth.
- Automatic's 401 fail-over proven live with fake CLIs; staging script stages and tears down real data cleanly; populated desk and public site render correctly at desktop and mobile with zero console errors.
- Full suite fresh: 1,130 tests, 1,127 pass, 0 fail, 3 explained skips; 12 CI jobs exactly as claimed.

---

## Sign-off checklist

- [x] The verdict matches the lanes actually run (walkthrough + full; DO NOT ADVANCE on two Criticals).
- [x] Environment attestation filled with verified facts and linked to on-disk evidence artifacts.
- [x] First-run reachability stated: reaches core feature; no dead end.
- [x] All 5 roles ran; five deep-dives exist and are substantive (90–573 lines); cross-role findings noted.
- [x] Every Critical has evidence, impact scope, and a fix path.
- [x] What's-working is present and specific.

## Verification ledger

VERIFIED: the ops server functions carry only deskMiddleware, no owner check | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/ops/dashboard.ts:21
VERIFIED: the anchor match threshold is two shared anchors | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/lead-match.ts:69
VERIFIED: the anchor path fires on a shared URL with no subject requirement | C:/Users/scott/Desktop/Code/townreporter-dev/src/lib/news/lead-match.ts:309
VERIFIED: the walkthrough attestation lists three on-disk artifacts and reads coverage VALID | C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-09-02/00-walkthrough.md:1
VERIFIED: ENG-01 evidence and fix path as written by the engineering role | C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-09-02/01-engineering.md:1
VERIFIED: QA-1 numbered repro as written by the QA role | C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-09-02/05-qa.md:1
UNVERIFIED: ENG-01 exploited at runtime by an editor-role caller - not run; every allowlisted action mutates the operator's live machine
UNVERIFIED: QA-1 reproduced against a live scan - not run; reproduced against the pure matcher function only

---

## Re-verification after fixes (same day, 19:30–21:10)

Fix commits on main: e95fce2 (ENG-01, QA-1 round 1, QA-2, TEC-01/02), 40d9a68 (QA-1 round 2), and the round-3 commit that follows e84f818 (two-tier matcher + walk hardening). Each fix was attacked by a fresh adversarial agent that did not write it.

| Item | Round 1 verdict | Round 2 | Round 3 | Evidence |
|---|---|---|---|---|
| ENG-01 owner gate | FIXED — runtime-proven: a real invited editor's `runOpsAction` and `getOpsHealth` calls refused with "Only the owner can do that."; the owner's same call passed the owner check | — | — | `artifacts/reverify/eng01-runtime-transcript.json`, `eng01-run.log` |
| QA-2 time budget | FIXED — NaN/Infinity/"abc"/"" refused; 9 and 3601 refused; 10 and 3600 accepted; null = reset | — | — | `artifacts/reverify/qa2-output.txt` |
| QA-1 matcher | PARTIAL — anchor path fixed; word-overlap path still merged 7/13 templated distinct items | BROKEN — content-token scoring on every path; 20 NEW pairs: 6/10 negatives still merged, 1/10 positive missed | RESOLVED BY DESIGN — two tiers: near-identical → stamp; anything else → file the lead and tag "MAYBE SAME AS #N" (leads.possible_duplicate_of). 0 of 18 distinct-story pairs score "strong". Nothing is discarded. | `artifacts/reverify/qa1-matcher-output.txt`, `-round2.txt`, `-round3.txt`, `-round4.txt` |
| TEC-01 / TEC-02 | FIXED — `.env.example` says Opinion is Claude only; the manual's stale scope note removed | — | — | commit e95fce2 |

**Coordinator note on QA-1.** Lexical overlap cannot tell "same story reworded" from "same agenda template, different item"; two tuning rounds proved that. The Critical was resolved by changing the product's behaviour rather than its thresholds: the scanner never throws a lead away. A false "possible" costs the editor one extra kill; a false "strong" is now bounded to near-identical headlines with a shared URL. Residual: a synonym-only rewrite with no anchors ("raise" vs "hike") is filed as new rather than linked — a missed link, not a lost story.

**Setup-stall (CI intermittent, twice today).** A dedicated agent could not reproduce the exact signature in 10 throttled runs and applied no speculative product change. The walk's waits were hardened (domcontentloaded + element waits instead of networkidle; post-save wait keyed on the Queue link, then the URL asserted) and both dependent walks passed on fresh servers. Root cause remains open on the watchlist.

**Gate after fixes (coordinator-run on the final tree):** typecheck clean, lint 0 errors, full suite 1188 tests / 1185 pass / 0 fail / 0 cancelled, build clean with no server modules in client chunks.

## Verdict after re-verification

> **CLEAR TO ADVANCE — conditional on CI green and the staged walk of the final tree**, then promoted as v0.6.4.

- Both lanes ran (walkthrough + full). First-run coverage VALID; new user reaches the core feature.
- Severity roll-up after fixes: **Blocker 0 · Critical 0** · Major 9 (QA-2, TEC-01, TEC-02 cleared; ENG-05/Walkthrough-1 kept as one) · Minor 14 · Nit 5 — Majors ride on the watchlist.
- The two Criticals are closed with independent adversarial evidence, not the fixer's word.
