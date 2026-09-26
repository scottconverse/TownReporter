# TownReporter redesign: developer kickoff

For the developer (or coding agent) implementing this. Start with `START-HERE.md`. Read this first. Use the React components in `design-system/components/` as the reference implementation for every shared part. Then read `design-system/README.md` (the style guide and principles), `README.md` (the screen-by-screen spec) and `DECISIONS.md` (what’s locked). Then open `design/Desk App.dc.html` and click through it. For small fixes later, follow the checklist in `design-system/README.md` §11 rather than redesigning.

## What this is

A redesign of both halves of TownReporter:

- **The public paper.** New front page and article page in the locked “Neighborhood Daily” look: cream and warm black, yellow accent, Bricolage Grotesque + Literata, ruled grids.
- **The editor’s desk.** Same visual family, reorganized around how one person actually runs the paper in an hour or two a day:
  - pick leads, draft, check, publish
  - real buttons everywhere
  - live progress on every AI job
  - full editor override of anything the AI produces

The owner’s own complaint about today’s desk, in short: it’s mostly text and links with no obvious buttons, it’s hard to find things, and when an AI job runs for minutes there’s no sign it’s working or what it’s doing.

## The operating model: design every feature around this

- **One human.** The editor is the only person. There are no reporters, no one phones sources, and no one files CORA/FOIA requests.
- **AI does the work.** Scanning, lead filing, research, drafting, checking, follow-ups and investigations are all done by AI models.
- **The editor is the gate.** Nothing reaches the public without the editor pressing Publish, and the editor can edit, replace, redo or reject anything at any step.
- **Consequences:**
  - Every AI action needs visible progress and an honest failure state.
  - Every AI output needs a manual override.
  - Every destructive action needs a fast, explicit choice. The owner put it as: never make it hard, always give a choice.

## Standing rules (from the repo, still binding)

- WCAG AA contrast in both themes (`scripts/contrast-audit.mjs`).
- Nothing informational below 14px (`scripts/desk-min-font.test.mjs`); tap targets at least 44px.
- One button family, one chip family, one notice pattern.
- Quiet styling never carries meaning alone: states are written in words.
- “Checked, nothing changed” must look different from “could not check.”
- **“Anywhere an AI does something, the editor must be able to pick the model.”** (`provider-registry.ts`)
- The paper never loads or unloads a local model.
- Grok stays retired from every picker (owner instruction; `grok-oauth` is registered but `offeredFor: NO_SURFACE`).
- Redrafts never overwrite the editor’s headline (0.6.67, migration `0093`).
- Forward-only migrations, newsroom-scoped, each mirrored by an `ensure…Schema()` for PGLite, following the existing pattern.
- **Changed by the owner on 2026-09-26:** dark mode for both the desk and the paper is **warm black `#1b1916`** with `#e8e6e1` text, not pure black and white. Update the docs that say otherwise (`docs/design/*`, `docs/dark-desk*.md`).

> **Before you start, read the “Known caveats” list in `START-HERE.md`** (reference components, Radix dialogs, illustrative model names, sample data, fonts, backend work).

## What already exists (a lot)

> **v3 note:** the repo read below was at 0.6.68. Releases **0.6.69 and 0.6.70** have since shipped, among other things: Kill as a record (migration 0094; killed leads stay under **Killed**), corrections with Suggest wording, a plain note and an optional “fix the story text” (off by default), **Suggested sources** with provenance, a YouTube API-key panel and a code-measured style check. **Where the app already does something, keep its behavior and apply this design’s look.** v3 of the design already follows that for these items. Check the latest release notes before treating anything below as new work.
>
> **Later ideas, not in this build:** hourly or weekly source checks, and automatic release of held leads. Don’t build their UI until a backend exists.

I read the repo at `main` (0.6.68). Much of what the design shows is already built; the work there is restyling and reorganizing, not new logic.

| Design feature | Already in the repo | Work |
|---|---|---|
| Desk shell and nav | `src/components/desk-chrome.tsx` (`DeskShell`, `InkButton`, `Chip`, `SecHead`, NAV list), `states.tsx` (`Notice`, `ScreenError`, `ListSkeleton`) | Restyle; new nav order; Running box |
| Themes and text size | `src/lib/appearance*.ts`, `reader-controls.tsx`; palettes in `src/desk-astra.css`, `src/reader-astra.css`, `src/styles.css` | Replace palettes with the new tokens; self-host the new fonts |
| Front page and article page | `src/routes/index.tsx`, `articles.$slug.tsx`, `paper-chrome.tsx`, `provenance.tsx`, `correction-form.tsx`, `copy-button.tsx`, `ai-disclosure.tsx` | Restyle; add This week and Dates in this story; geography pills |
| Sections | `0045_configurable_sections` (`newsroom_sections`: name, position, visible, brief, instructions) | Drive the nav and pills from it |
| Command Center | `src/routes/desk.index.tsx`, `desk-leads.tsx` | Re-layout: step strip, Running now, Tonight’s edition, keyboard |
| Queue | `desk.queue.tsx` | Table, bulk bar, More menu |
| Story workbench | `desk.story.$leadId.tsx` (116KB), `desk.story.draft.$draftId.tsx`, `draft-reconcile-control`, `desk-name-check.tsx`, `finding-evidence-review.tsx`, `model-picker.tsx`; headline control `0093` | Re-layout into tabs + writing surface + sticky publish gate; add “Add to story” |
| Document intake | `desk.import.tsx`, `0091_import_provenance` | Becomes tab (a) of New story; add tabs (b) and (c) |
| Opinion | `desk.opinion.tsx`, `0057`/`0058` opinion documents, Restore saved material | Restyle; request states |
| Published | `desk.published.tsx`, Edit headline | Table + More menu |
| Legal removal | `desk.legal-removals.tsx`, `0047_legal_removal`, `legal-removal-types.ts` | Reach it from More ▾; match the dialog copy |
| Sources and scan | `desk.sources.tsx`, `desk.scan.tsx`, `daily-scan-settings.tsx`, `0050_daily_scan`, `0065`/`0066` coverage and packs | Four-state chips; **bulk import is new** |
| Page watch | `page-watch-panel.tsx`, `0046_manual_page_watch` (`manual_watch_checks`, `manual_watch_actions`) | **Reuse as the engine for “re-check pages” follow-ups** |
| Dark Desk | `desk.dark.tsx` (79KB), `dark-dials-panel.tsx`, `investigation-brief.tsx`, `0043_dark_gates`, `0059_dark_run_budget` (usage + stop_reason) | Re-layout: piles, activity log, case file, Decide row |
| Follow-ups | `desk.follow-ups.tsx`, `follow-up-item.tsx`, `0042_follow_ups` (**manual**: who/what/due, Record reply, Nudge) | **Reworked into AI agents** (see below) |
| Models | `provider-registry.ts` (the single registry, surfaces `story\|scan\|opinion\|dark\|forced`, per-model effort lists `none…max`, Automatic ladder), `provider-settings.ts` (`0029`: time budgets, enabled), `custom-ai-connections.tsx` (`0055`), `local-models.ts` discovery (LM Studio :1234, Ollama :11434), sign-ins (`provider-signin-button.tsx`, `0027`, `0060`, `0064`), `0061_model_effort`, `0083_scoped_local_models` | Connections view mostly exists; **the per-job assignment grid with fallbacks is new** |
| Job progress | `desk_jobs` (`0013`: kind, status, `stage` text, error, result_json), heartbeat + claim token (`0017`, `0033`), failover note (`0032`), polling at 2s/5s in routes | **Needs structured progress** (see below) |
| Stats | `desk.stats.tsx`, `src/lib/news/views.ts`, `page_views` (`0037`: one count per target per day, no identity), `stats-reports` saved JSON | Keep the existing parts; **the reading beacon is new** |
| Meeting capture | `0067`–`0085`, `meeting-*` components | Unchanged; its jobs should report progress the new way |

## What is new, and how I’d build it

### A. Structured job progress (medium, foundational: do it early)
The design needs, for every job: a stage list, the current stage, an optional percent, a one-line “now” step, last activity time, cancel, and an open-result link.

Proposed addition to `desk_jobs` (forward migration):
- `stages_json text` (an ordered list of labels), `stage_index int`, `pct int null`, `step_text text`, `beat_at timestamptz`, `cancel_requested boolean default false`, `result_href text`.
- Keep `stage` for backwards compatibility, or derive it.

Server:
- A small helper, `reportProgress(jobId, {stageIndex, pct, step})`, that also bumps `beat_at`.
- Call it at every existing stage boundary, and on a 10–15s ticker while waiting on a model call (“Waiting on Codex Sol · 42s”).
- Workers check `cancel_requested` between steps.

Client:
- One `<JobCard job compact? />` component (spec in README “Job card”), fed by one `useDeskJobs()` query that polls at 2s while anything is running and backs off to idle.
- It shows in context, in Running now on Today, and in the nav box.
- Stall rule: `now − beat_at ≥ 60s` shows the stalled state with “Keep waiting” / “Retry on next model” (reuse the existing failover path).

### B. Editor-control additions (mostly small; together medium)
- **Add a lead** (link or tip → research and score / research and draft / file as-is): a new server function that creates a lead, optionally queuing the existing research or draft job.
- **New story tab (b) “Write it myself”** and **tab (c) “Paste a finished story”**:
  - These create a draft directly. Suggested `drafts` additions: `origin text check in ('ai','editor','reprint')`, `credit_line`, `original_url`.
  - Reprints print the credit line and link.
  - The evidence check stays optional and runs the same checks.
- **Add to story**: weave in (an AI job that returns a diff for review) / timed update at the top / append as-is.
- **Headline dialog**: keep mine / pick one of 3 / type a new one / suggest 3 more. Suggestions already exist; the dialog is new UI.
- **Hold and Kill reasons**: the reason is optional, and there is always a “no reason” button. The Kill button and the X key open the same dialog, and Undo stays on the row.
  - Suggested storage: `leads.hold_reason`, `leads.kill_reason`, `leads.kill_note`, or append-only rows in an existing action log.
  - Feed kill reasons back into the scanner’s scoring prompt or source weighting.
- **Keyboard triage** (J/K/S/H/X/U/Enter/N/⌘S/?): client only.
- **Tonight’s edition checklist**: aggregates existing gate state (saved, evidence checked, names reviewed, section confirmed, preview viewed). Mostly a query plus UI.
- **Evidence meter**: records opened vs. could not open per lead. Use the existing “documents opened” data if it’s already per lead; otherwise it’s a count query over captures.
- **More ▾ menus**: on leads (edit, hold, merge into a printed story, send to Dark Desk, AI follow-up, kill) and on published stories (edit and republish with an Updated time, correction, update, unpublish, legal removal).
- **Bulk source import**:
  - paste a list, upload CSV / OPML / sitemap, or “Ask AI to find sources” (results land in Suggested sources, which already exists)
  - always show a preview with duplicates flagged
  - after adding, run a first check as a job

### C. Models: “Who does what” (medium)
Today the registry offers models per *surface* (`story`, `scan`, `opinion`, `dark`, `forced`), with Automatic and forced ladders in code. The design asks for a per-*job* assignment with an effort level and two fallbacks.

Proposed:
- A table `model_assignments(newsroom_id, job_key, rank smallint, provider_id text, effort text, primary key (newsroom_id, job_key, rank))`.
- `job_key` values: `scan`, `lead-score`, `story-draft`, `opinion`, `evidence-check`, `headlines`, `dark`, `follow-up`, `ocr`, `transcript`.
- Resolution order: an explicit per-run pick, then `model_assignments`, then today’s surface default and Automatic.
- Validate effort with `modelEffortsFor(id, exactModel)`, and record requested versus actual model as the code does now.
- A content refusal stays final.
- Options come only from `providersFor(surface)` plus `custom:<uuid>` connections. Never hardcode names; the prototype’s model names are illustrative.

### D. AI follow-ups (large, genuinely new)
The current follow-ups are a manual list of who owes you an answer. The owner confirmed there’s no one to do that, so follow-ups become **agent tasks**:

- `follow_ups` gains:
  - `agent_kind text check in ('recheck','search','agenda')`, `targets_json`, `schedule text`, `model_choice`
  - `last_run_at`, `next_run_at`, `last_state text check in ('found','no-change','could-not-check','running','waiting')`, `finding_json`
  - status becomes `active | paused | stopped | done`
  - Keep the old columns so existing rows still render.
- **recheck**: back it with the existing manual page-watch engine (`source_monitors.manual_watch`, `manual_watch_checks`).
- **search**: a scheduled research job using the existing research tools, scoped to the question.
- **agenda**: watch a meeting body’s portal on its usual posting days; reuse the meeting and scan source code.
- On a finding: write to the story’s reporting notes (the existing notes save path), mark the follow-up “found”, and surface it on Today. **It never publishes.**
- Create follow-ups from the story page, from a lead’s More ▾, from Dark Desk “Start an AI follow-up”, and from the Follow-ups page.

### E. Stats v2 reading beacon (large, new)
Today’s `page_views` stays as-is and powers “Page loads” and the per-story totals.

New:
- A second beacon, `POST /api/read`, sent every 15s while a page is visible. It fires after render, and its failure never touches the page, as today.
- **Payload:** target, an in-page random token held only in JS memory (never stored, dies with the tab), referrer *category*, device class, scroll-depth bucket, engaged seconds since the last ping (active only: scroll, key, pointer, touch), whether this is the first page of the visit (referrer is not this site), and whether the reader came from another story.
- **Server, live view:** an in-memory map from token to last-seen time, target and category with a 60s expiry. This gives live readers, per-page counts and average time so far, and is never written to disk.
- **Server, stored totals:** a flush each minute into daily totals only. Suggested tables (all newsroom-scoped, keyed by day):
  - `read_daily(target, visits, engaged_ms, reach_25, reach_50, reach_75, reach_100, second_story, quick_exits)`
  - `referrer_daily(category, count)`
  - `area_daily(area, count)`: city or county only, from a local lookup (MaxMind GeoLite2-City or similar) whose IP is never stored or logged
  - `device_daily(device, count)`
  - `hour_daily(dow, hour, count)`
  - `ui_event_daily(event, count)`: captured-version opened, source link, How we reported reached, credit copied, correction filed, dark mode, large text
- Charts: `recharts` is already a dependency. The prototype draws bars with divs; either is fine if it meets 14px and contrast.
- Keep **Section chosen by hand** and **Saved reports**; extend the saved report JSON with the new daily totals.
- Update the privacy copy (`/about`, `docs/stats-reports.md`) to match exactly what is collected. The page’s “What we never collect” box has to be literally true.

## Suggested phases (ship each one)

0. **Foundations**: tokens, fonts, button, chip, notice and dialog restyle; theme on warm black; contrast and min-font scripts green.
1. **Public paper**: front and article pages. Frontend only; the existing data is enough except the This week data, which can come from dated story items.
2. **Desk reskin**: new shell and nav, and every existing desk screen re-laid out using the current data and endpoints. Here the desk starts to *feel* new.
3. **Job progress v2** (A) across every job type.
4. **Editor control** (B).
5. **Models assignment** (C).
6. **AI follow-ups** (D).
7. **Stats v2** (E).

Phases 0–2 are mostly restyling and layout. Phases 3–5 extend existing systems. Phases 6–7 are the genuinely new builds. If time is short, 0–4 deliver most of what the owner asked for.

## Acceptance for each phase
- `npm run lint`, `typecheck`, `test`, `test:flows`, `test:opinion` and the smoke tests all green. Add e2e coverage for the new dialogs and the job states (running, stalled, done, failed).
- Walk every changed screen in **both themes**, at Standard and Large text, at **1440, 1280, 1024, 900 and 390** widths. No horizontal scroll, nothing under 14px, every button at least 44px.
- For job progress, force each state: a slow model (the stall at 60s appears), a quota failure (the real reason shows, Retry works) and a cancel.
- For Stats, verify with browser devtools that no cookie, localStorage or sessionStorage entry is written by the public site, and that no IP reaches any stored table or log.
- Stage on real data and get the owner’s go-ahead before promoting, as the repo’s process requires.

## Open questions for the owner (ask before the phase that needs them)
1. **This week source**: dated items from published stories only, or also from meeting-capture calendars?
2. **Regional coverage** (Nearby / Boulder County / Colorado): are there sections or sources for these yet, or do the pills filter by a new “area” tag on stories?
3. **Kill reasons feeding the scanner**: automatically lower a source’s weight after repeated “bad source” kills, or only show the pattern to the editor?
4. ~~Legal removal~~ **Answered 2026-09-06:** keep a sealed, owner-only copy of the removed text, deleted automatically after 12 months. If the reason is a court order to destroy, keep nothing. The dialog makes the editor pick which rule applies before confirming.
5. **Stats location lookup**: OK to bundle a city-level GeoIP database (the IP is used in memory and dropped), or skip location entirely?
6. **Visits definition**: “arrived from outside the site” (no storage). Confirm that’s acceptable instead of a daily unique count.
