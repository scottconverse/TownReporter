# TownReporter — TODO (canonical, in-repo)

Updated 2026-09-07. Maintained by the active developer, irrespective of model.
Start with [the current takeover handoff](HANDOFF-NEXT-AGENT.md).
Repository baseline for this reconciliation: `cd437a9`, package version 0.6.23.
Completed code, CI results and production deployment are separate facts.

Legend: [x] implemented · [~] in progress · [ ] open · **external** requires Halo-local execution.

## In flight

- [~] **Continuous development takeover**, authorized by the owner 2026-09-06: reconcile docs, review Dark Desk/OCR/newsroom boundaries, run focused local verification, fix material defects, then work the queue below. Release finished green work on GitHub; no production promotion from this machine.
- [x] Reconcile README, manuals, landing page and versioning. Dated operator receipts remain attributed history. Seventeen missing historical source releases were restored with exact-commit CI links; v0.5.0 was excluded because its code CI failed, and its tag remains untouched.
- [~] **Configurable sections:** implemented in the next candidate with migration 0045; focused checks and local editor/reader walkthrough passed. Independent review, exact-candidate CI, merge and promotion remain pending. Manual page watching is implemented in the combined next candidate; independent review and final gates remain pending.
- **0.6.24:** corrective implementation is complete; [release and publication evidence](https://github.com/scottconverse/TownReporter/pull/7) records the checks and promotion boundary. GitHub publication never implies deployment on Halo.

## Open queue — implementation order

1. [x] **Dark Desk corrective review (0.6.24).** Reproduced failures in search verification, model evidence context, saved-result reporting, newsroom isolation and PDF/OCR provenance were corrected. Both signal and whole-file queue handoffs preserve uncertainty. Real investigative quality remains the separate five-run acceptance exercise below.
2. [x] **Fetch safeguards (0.6.24).** Shared guarded HTTP responses have streamed size and declared content-type caps, with visible refusal reasons. Chromium resources and direct provider transports remain outside these caps.
3. [~] **Sections — dynamic, editor-owned.** Ship a starting set the editor can add to, rename, reorder, hide and retire. Preserve existing stories and provide explicit reassignment when retiring a section. Per-section reporting briefs, accepted-source assignments and scanning instructions remain part of this work, with preview before applying changes. No fixed section list is awaited.
4. [~] **Manual “watch this page” for Dark Desk — implemented in the next candidate, verification/merge pending.** An editor can add a page to investigative monitors without first running a dig. Keep it distinct from ordinary accepted-source scanning; explain first capture, changes, failed checks, pause/stop and where evidence or a lead went.
5. [ ] **Legal removal.** Distinct from normal 30-day trash. Owner policy of 2026-09-06: a sealed, owner-only copy of removed text expires automatically after 12 months; an explicit court order to destroy means keep nothing. Audit and backup handling must respect that exception. Track affected backups and incomplete operator cleanup honestly; ordinary Delete is not this feature.
6. [ ] **Investigative settings.** Editable search window (default 90 days; a search preference, not guaranteed date filtering) and verify-per-round limit (default 6), with a visible “verified X of N” summary.
7. [ ] **Five real Dark Desk investigations — external.** Prepare and use the [acceptance exercise](docs/dark-desk.md#five-live-investigations--acceptance-exercise). Only a local operator on Halo runs them when directed by the owner. Two owner topics are recorded there; three additional topics must be identified before execution. No fabricated results or forced findings.
8. [ ] **Direction A follow-through.** Incorporate the owner's real-use feedback and actionable findings from [the design audit brief](docs/design/DESIGN-AUDIT-BRIEF-2026-09-05.md). Keep Fable's newsroom structure, airier queue and Follow-ups rail. Other tabs retain their current pages unless a specific defect requires a change.

## Superseded decisions

- “Redesign on hold” was superseded by Fable Direction A, implemented on the Command Center and story workbench in 0.6.21–0.6.22. It does not authorize a new visual direction.
- “Wait for the owner's section list” was superseded by editor-owned configurable sections on 2026-09-06.
- The duplicate legal-removal entries are consolidated above. The later sealed-copy/destruction policy governs; the earlier blanket immediate-purge wording is incomplete.
- The doctrine-restoration portion of “Dark Desk do it right” was implemented in 0.6.23. Its real-world verification remains open. Giving the model raw shell/edit/MCP tools is not authorized by that restoration; the application owns search and fetch.
- Interrupted-draft recovery, promote job guard, monitor newsroom scoping, ≈ PRINTED story links, non-profit copy and Reddit routing/pacing are completed code work, not open backlog items.

## Evidence limits

- The release history below preserves previous sessions' reports, including their “LIVE” language. Those are **attributed Halo-local operator receipts**, not a new deployment verification by this remote developer. See [the dated handoff](HANDOFF-SESSION-2026-09-04.md) and [earlier receipts](artifacts/dark-desk-review-2026-09-03/RECEIPTS-2026-09-04.md).
- One staged Dark Desk topic and one claims-of-absence incident replay are reported. Neither certifies the rebuilt process across source types or five live topics.
- The baseline verification checks completeness of structured answers; it is not independent fact-checking. Search/evidence failure behavior is under review.
- OCR supports extracted JPEG/PNG images with bounded processing and no established PDF page mapping; unsupported scans and incomplete reads must remain visible. Vision capability is not a guarantee of accurate transcription.
- URL canonicalization of historical records is distinct from guards on new writes. Production cleanup is an operator action.
- Historical records with incorrect newsroom assignment or OCR page references need operator review or re-ingestion; this release does not infer ownership or rewrite old citations. Migration 0044 corrects entity-alias/match uniqueness for future same-user cross-newsroom records while preserving existing rows.

## Completed release history — prior operator reports
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
- [x] #2 Proven: live 0.6.17 code fetched a real r/longmont thread — HTTP 200, reddit-rss, 2,621 chars of real post+comments, one paced request.
- [x] #3 `source_monitors` newsroom-scoped (8741b1d): monitors + their anomalies carry the real newsroom; guard-listed; 5 proof tests.
- [x] #4 Queue "≈ PRINTED" chip names + links the story it matched — an editor could only see a hover date before; `nearDuplicate` (src/lib/news/desk-copy.ts) now carries the matched published story's headline on `PrintedDup`, and the Queue row (src/components/desk-leads.tsx) shows "matches: <headline> · published <date>" with the headline as a real link to `/articles/<slug>`, plus the hover title on the chip itself. This commit.
- [x] #6 — retired the 17 historical duplicate leads on prod (17 → 0, reversible), 2026-09-05.
- [x] 0.6.18 — bug-fix release (A recovering state, B promote guard, #3 monitors scoping, #4 PRINTED chip, #5 non-profit + 0040, #7 reddit listings via .rss). LIVE 2026-09-05, CI 14/14, staged on real data, promote checks OK, 26 stories intact.
- [x] 0.6.19 — LIVE 2026-09-05 (tag v0.6.19 at 25bc882): claims-of-absence gate + city-site pulls + site notices (f80a5ce); local model discovery + per-model picker + thinking off + migration 0041 (2e4b8b3); black-on-white dark desk + theme-aware Notice + single model error (6158100); Check r/longmont progress/results/File-as-tip (9ad5369). Staged on real data, incident replay proved the gate, CI 14/14, promote checks OK.
- [x] Five desk rule defects (14px floor, Large scales headlines and reading panes, one button family + invert/--muted fixes, Kill styled as destructive, Held/aside chips) — auditor punch list 2026-09-05.
- [x] 0.6.20 — LIVE 2026-09-06 (tag v0.6.20 at 2a25936): five desk rule defects from the design audit — 14px floor, Large text scales headlines/panes, one button family, destructive buttons look destructive, Held/set-aside chips; guard tests added.
- [x] 0.6.21 — LIVE 2026-09-06 (tag v0.6.21 at 08eef0a): redesigned Command Center, direction A stage 1 — queue as lead column, Dark Desk / Follow-ups / wire rail, airier queue rows, Follow-ups object (migration 0042, /desk/follow-ups), narrow layout measured clean at six widths.
- [x] 0.6.22 — LIVE 2026-09-06 (tag v0.6.22 at 2508cdc): direction A stage 2 — story page aligned to the prototype (380px lead column, one column below 1024, wrapped URLs, scaling headline), plain local model row. Direction A complete for the Command Center and story page.
- [x] 0.6.23 — llama.cpp joins LM Studio/Ollama (version attribution corrected from the earlier “0.6.22 same tag” note; commit c4c545e is later than the 0.6.22 tag) in zero-config local discovery (`http://127.0.0.1:8080/v1`, kind `llamacpp`); docs/local-models.md opens with one recommended path (Ollama, one command) instead of the measurement writeup; a capture's OCR read (or honest needs-OCR reason) is now shown in words on Dark Desk's "What to read" list, its reader panel, and the story page's "Documents opened for this draft".
- [x] Reddit clues, community-life extension (b16fec2, 2026-09-06): rotating 8-group search set (govt/infra/business/schools/housing/health-safety/community/arts) replaces the fixed 2-query search, 3 groups run per check rotated by hour; civicScore extended with change-signal vocabulary (closing/opening, laid off, sold, eviction, boundary change, hospital/clinic cuts, scam-seniors, flooding, cancelled season, permit denied, HOA fine, nonprofit funding cut, strike/union) plus a named-place +2 bonus; chatter (restaurant/coffee/pizza/shop) no longer penalised when a change signal is present; top-N raised 8 -> 12, near-misses (score 3-5) shown by default with File as tip; searched-groups line added to the result panel. Bakery-closing fixture post scored 5 before (below the 6 threshold, never filed), 10 after.
- [x] Scanned PDFs are read (2026-09-06, this commit): `productionOcr` (src/lib/news/ocr.ts) is real — pulls embedded JPEG/PNG page images out of a scan (`extractEmbeddedPageImages`, cap 12 pages/2MB per page/10min total) and asks the picked model to transcribe them verbatim, through the same provider registry every other AI call uses. Anthropic API (image blocks) -> Codex CLI (`codex exec --image`) -> Claude Code CLI (`claude -p --tools Read`, one scoped temp file) -> a vision-marked local model -> honest `needs-ocr` with a reason. `local-models.ts` now reports `vision: boolean` per model (LM Studio's `type: "vlm"`, one `/api/show` call per Ollama model); the picker shows `· vision`, the Server page catalog table gets a Vision column. Extraction method round-trips through the existing DB column as `ocr:<provider>:<read>/<total>`, decoded by `describeExtractionMethod` ("Read by OCR · Claude · 3 of 5 pages") — the display integration was completed in 0.6.22–0.6.23. CCITT/JBIG2 fax-style scans (no embedded JPEG/PNG at all) still cannot be read; the desk says so honestly. CI 1186/1186, typecheck/eslint/build clean.
- [x] Two owner requests (2026-09-06, this commit): Opinion desk's extracted blocks (image prompt, editor's fact sheet) get a Copy button (`src/components/copy-button.tsx`, shared, dependency-free) that writes the clipboard, swaps its label to "Copied" for 2s and announces through the desk's live region, or shows a plain-words notice ("Could not copy. Select the text and copy it by hand.") on failure — never a silent no-op. Paper setup gets a County field (`DarkDeskCounty` in `src/routes/desk.ops.tsx`) that persists to `dark_settings.county` (`saveDarkCountyFor`/`saveDarkCounty` in `src/lib/news/dark.ts`) — the same table and newsroom-scoped upsert the dig/nerve/scope dials already use, and the column `readDarkPlace` was already reading from with nothing ever writing it, so every install's county-scoped Dark Desk searches silently fell back to the city alone until now. CI 1224/1224, typecheck/eslint/build clean.
- [x] 0.6.23 — LIVE 2026-09-06 (tag v0.6.23 at b52a3ae): Dark Desk restored to the owner's doctrine (two stages, four gates, adversarial searches, three postures, newsworthiness gate, migration 0043); Reddit covers community life; scanned PDFs read by the picked model; llama.cpp discovered; absence gate searches four ways before it asks the editor; last newsroom-1 default closed; copy buttons; county field.


## Operating gotchas

Use `DATABASE_URL=""` for local test/build (PGLite). Never build into a served `.output`. Do not access Halo ports, DBs, backup files or production checkout from this travel session. Preserve CRLF/LF conventions. Check lockfile consistency when versioning; `npm version` previously removed Nitro's transitive `lru-cache`. Exact-commit CI and a GitHub release do not imply production deployment.
