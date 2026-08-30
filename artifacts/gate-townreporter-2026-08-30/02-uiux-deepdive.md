# UI/UX Deep-Dive — TownReporter 0.5.1 (GauntletGate 2026-08-30)

**Role:** Senior UI/UX Designer
**Lane:** walkthrough (part of `gauntletgate all`)
**Instance:** `http://127.0.0.1:3830`, own scratch database `townreporter_gate_uiux`, isolated `HOME`/`USERPROFILE`/`APPDATA`, no `ANTHROPIC_API_KEY`/`XAI_API_KEY`/`LLM_BASE_URL`/`CLAUDE_CLI_PATH` set — a genuine first-run, no-model-provider state. Desk unclaimed at start; I created the first editor account myself.
**Method:** Chromium via Playwright (the same tool the 2026-08-29 audit used), 1440×900 primary + one 375×812 mobile pass. Screenshots saved under `artifacts/gate-townreporter-2026-08-30/uiux-screens/`, cited by filename below. This round **extends** the 2026-08-29 UI/UX audit (`artifacts/audit-townreporter-2026-08-29/02-uiux-deepdive.md`, 29 findings, IDs `UX-001`…`UX-029`) rather than repeating it: every prior Critical/Major was re-tested against this build, three were found genuinely fixed, one is meaningfully improved but not closed, and several Majors/Minors still reproduce unchanged. New findings use the `UX2-` prefix.

## Environment-provisioning attestation

| What | State used | How verified |
|---|---|---|
| Database | Fresh scratch DB `townreporter_gate_uiux`, 18/18 migrations applied clean | `[migrate] done — 18 migration(s) applied.` console output; `desk/ops` later reports `Database: townreporter_gate_uiux · 11 MB` |
| Desk claim | Unclaimed at start | Home page pre-signup shows the black `CREATE EDITOR` chip (`home-topright-1440.png`); I created the first account through `/login` |
| Model provider | ABSENT — `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `LLM_BASE_URL`, `LLM_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_CLI_PATH` all unset in the server process's env before launch | `/desk/scan` after clicking Run scan renders "No model is set up yet…" and "AI is not available. Set ANTHROPIC_API_KEY…" (`desk-scan-after-1440.png`); Opinion desk reports "needs the Claude Code CLI, and it is switched off or missing here" (`desk-opinion-1440.png`) |
| Profile / HOME isolation | `HOME`/`USERPROFILE` pointed at a scratchpad dir, `APPDATA` pointed at a separate scratchpad dir, distinct from the real user profile | Server started and ran correctly with these vars set for the whole process lifetime; no Claude CLI was found (consistent with the walkthrough lane's prior attestation, which I am extending, not re-deriving) |
| Port / isolation from LIVE | `127.0.0.1:3830`, own Vite dev process | `netstat` confirmed 3830 was free before launch; did not touch `.output` (shared with the LIVE process on 3000) or run `npm run build` |
| Network | Online (default) | Dark Desk's "Pick one for me" reached `r/longmont` in "Reading r/longmont…" state, so outbound network was live |

**Isolation verified?** YES. **First-run coverage:** VALID for the surfaces I exercised (unclaimed desk → account creation → model-absent desk). I did not independently re-verify the Claude-CLI-absence mechanics (redirected `APPDATA`/registry probing); that half of the isolation is the prior walkthrough lane's attestation, which I am building on per my brief, not re-proving.

**Evidence artifacts:** all files under `artifacts/gate-townreporter-2026-08-30/uiux-screens/` (44 PNGs + the Playwright scripts that produced them, `_walk1.mjs`…`_walk13_headings.mjs`, kept alongside for reproducibility).

---

## Severity roll-up

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 0 |
| Major | 4 |
| Minor | 6 |
| Nit | 1 |
| **Total** | **11** |

Three findings from the prior round are recorded below as **FIXED**, one as **IMPROVED (not closed)**, and one prior Critical (`UX-003`) is recorded as **NOT RE-VERIFIABLE THIS ROUND** rather than closed or open — see its entry.

---

## What's working (re-verified this round, independently)

- **Publishing now asks first.** `/desk/story/1` → `Publish to the paper` no longer fires immediately. It expands an inline confirm: *"This puts the story on the public paper and in the feed, under your name, now. Corrections are published, not silent edits."* with `Yes, print it` / `Not yet`. This closes the prior round's `UX-008` (Major) — see FIXED below.
- **Published articles now carry their sources.** The article I published shows a **How we reported this** section with `Portal — longmont.primegov.com — Current source` beneath the body. This closes `UX-005` (Major) — see FIXED below.
- **The evidence route no longer leaks a database error.** A non-existent evidence ID now renders a designed page — headline **"That capture is not in this edition"**, body copy, `Back to the paper` — at HTTP 200, not a raw Postgres message at HTTP 500. This closes `UX-001` (Critical) — see FIXED below.
- **The Server page's Watchdog row is now plain language.** `ran 1m ago · OK · next run in 4m` — no raw exit code. This closes `UX-019` (Minor) — see FIXED below.
- **The Server page reports on the address it is actually running at**, `http://127.0.0.1:3830`, not a hardcoded production URL — closes `UX-029` (Nit).
- **The Opinion desk's pre-flight pattern is still the house model to copy.** It disables its action and explains why (*"This desk cannot write yet. The Opinion desk needs the Claude Code CLI…"*) before any click, never after a wait. `desk-opinion-1440.png`.
- **The delete confirmation on Published is still exemplary.** *"This takes it off the paper. Its URL becomes a 404, the feed and the sitemap drop it, and anyone holding a link has a dead link. Its corrections go too. Consider a correction instead…"* `desk-published-delete-confirm-1440.png`.
- **The lead-to-story-to-publish pipeline works end to end** on a fresh account with zero seed data: file a lead by hand → land in the story editor → save → publish (with confirm) → live on the front page and at its own article URL, in under two minutes of interaction.
- **Account creation is a clean, fast first-run step** — four fields, a plain-language stakes sentence, and I was on the desk within seconds of submitting.

---

## Findings

### Fixed since 2026-08-29 (re-verified, not re-numbered as open findings)

**`UX-001` (was Critical) — FIXED.** Evidence: `evidence-bad-1440.png`. `/evidence/00000000-0000-0000-0000-000000000000` now returns HTTP 200 with headline **"That capture is not in this edition"** and body *"TownReporter only shows captured records that support a published story."* — no `invalid input syntax for type integer` leak, no missing site chrome.

**`UX-005` (was Major) — FIXED.** Evidence: `article-published-1440.png`. Publishing a lead that carried `https://longmont.primegov.com/public/portal` as its source produced a **How we reported this** section on the live article: `Portal / longmont.primegov.com / Current source`. The front page's "Sources shown." promise is now kept for at least the single-source case I tested.

**`UX-008` (was Major) — FIXED.** Evidence: `desk-story-publish-confirm-1440.png`. `Publish to the paper` now opens an inline confirm naming the consequence (*"…under your name, now. Corrections are published, not silent edits."*) before anything goes live, matching the pattern the Delete confirm already used.

**`UX-019` (was Minor) — FIXED.** Evidence: `desk-ops-resolved-1440.png`. Watchdog row now reads `ran 1m ago · OK · next run in 4m`; no process exit code is shown.

**`UX-029` (was Nit) — FIXED.** Evidence: same screenshot; Server page's Public site row correctly names this instance's own address.

**`UX-002` (was Critical) — IMPROVED, NOT CLOSED.** See `UX2-002` below: the 36-second silent spinner is gone (resolves in ~6s), but the pre-flight warning and developer-vocabulary error text it was flagged for are both still present.

**`UX-003` (was Critical) — NOT RE-VERIFIABLE THIS ROUND.** I ran Dark Desk's `Pick one for me` (reached `r/longmont` live — "Reading r/longmont…") and its `Start digging`, but the "To look at" pile stayed at 0 in both attempts (`desk-dark-after-check-1440.png`), so no card — placeholder-titled or otherwise — was produced to inspect. This is most likely a live-network/content-availability difference from the prior run (Dark Desk's yield depends on what it actually finds), not evidence the underlying field-mapping bug is fixed. **Do not read this as closed.** It needs a dedicated re-run, ideally seeding a source the scanner is guaranteed to find something on, before it can be marked fixed or reopened.

---

### [UX2-002] — Major — Journey — The desk still hides its own unconfigured state until after the user clicks (36s wait now closed; the rest of `UX-002` is not)

**Evidence**
Fresh account, no model provider (verified absent — see attestation).
- `/desk/scan`: `Run scan` renders as an active dark primary button with **no warning before the click**. Screenshot: `desk-scan-before-1440.png`.
- After clicking, it resolves quickly (~6s, not 36s) to: *"The desk cannot scan yet. No model is set up yet. Either sign in to Claude Code on this machine, or set ANTHROPIC_API_KEY, or point LLM_BASE_URL at any OpenAI-compatible endpoint — a local model counts. See docs/setup.md."* plus a second line: *"AI is not available. Set ANTHROPIC_API_KEY for Claude (default), or XAI_API_KEY for Grok, or LLM_BASE_URL for any OpenAI-compatible gateway (LiteLLM, Bifrost, Helicone, MLflow, Kong, Ollama)."* Screenshot: `desk-scan-after-1440.png`.
- `/desk/story/1` → `Draft with AI`: button is enabled with no warning (`desk-story-1440-fresh.png`); clicking resolves in ~6s (measured, single sample) to *"No model is set up yet. Either sign in to Claude Code on this machine, or set ANTHROPIC_API_KEY, or point LLM_BASE_URL at any OpenAI-compatible endpoint — a local model counts. See docs/setup.md. Nothing is spent until one of those answers."* — this is a shorter, less alarming message than the prior round's *"Nothing you click will fix it — that is an operator job."* Screenshot: `desk-story-draftai-resolved-1440.png`.

**What changed vs. `UX-002`:** the 36-second spinner and the "that is an operator job" line are gone — a real, meaningful improvement to the worst part of the prior finding. **What has not changed:** the buttons are still enabled with no upfront indication that AI is unavailable (the product already knows this — the Opinion desk proves the check exists and can run before the click); the resolved message still reads as an environment-variable dump (`ANTHROPIC_API_KEY`, `XAI_API_KEY`, `LLM_BASE_URL`, `docs/setup.md`, a parenthetical list of seven gateway product names) addressed to a developer, not the stated non-technical journalist; and it is still two overlapping messages on the Scan page for one condition.

**Why this matters**
The prior round's fix path had four parts: (1) a first-run banner, (2) disable AI buttons with a plain-language reason before the click, (3) a real in-app "how to set this up" page instead of `docs/setup.md`, (4) delete the redundant second message. None of the four appear to have landed — what landed was a latency fix on the failure path, which is real and worth crediting, but it does not change what a first-run journalist sees: an inviting, enabled "Run scan" button that still ends in a paragraph about environment variables and OpenAI-compatible gateways.

**Impact scope**
- Adjacent code: same as `UX-002`'s original blast radius — `/desk/scan`, `/desk/story/:id` (Draft with AI, Redraft), `/desk/dark` (Keep digging / Write the brief) all share this enabled-then-fails shape; `/desk/opinion` already does it correctly and remains the template to copy.
- User-facing: until the pre-flight check moves earlier, every first-run operator will still click into a wall on their first real attempt to use the product's core AI features, just a faster wall than before.
- Tests to update: none known.

**Fix path** — unchanged from `UX-002`: lift the existing provider-availability check (it already exists — Opinion uses it) into a shared readiness state the desk shell reads on mount; disable `Run scan` / `Draft with AI` / `Redraft` with one plain-language reason inline; delete the second stacked error message on Scan; replace `docs/setup.md` with an in-app "three ways, pick one" page. See the original `UX-002` fix path in the 2026-08-29 report for full copy suggestions.

---

### [UX2-004] — Major — Journey — The source-download button on `/get-the-code` still links to itself

**Evidence** `get-the-code-1440.png`. DOM link set, read programmatically:
```
Download TownReporter.zip -> /get-the-code
Backup link              -> /get-the-code
Back to the paper        -> /
```
Both download affordances still resolve to the page the user is already on; the real GitHub archive URL is reachable only by copying the plain-text URL printed below the button. This is an exact re-reproduction of `UX-004` from the prior round — unchanged.

**Why this matters** Right-click → Copy link, middle-click, and any JS-off or popup-blocked context all still yield the wrong destination. The page is still an orphan (nothing in the site nav links to it) and still speaks in "this preview" voice to a self-hosting operator.

**Impact scope** Same as `UX-004`: `src/components/source-zip.tsx`, `src/routes/get-the-code.tsx`. User-facing: the button becomes a real link; no other surfaces affected.

**Fix path** Unchanged: `href={SOURCE_ZIP_URL}` with `target="_blank" rel="noopener noreferrer"`, drop the `preventDefault`, rewrite the page copy for a self-hoster, link it from the footer. See `UX-004` in the prior report for suggested copy.

---

### [UX2-006] — Major — Journey — `/about` still has no contact information; `/corrections` still points readers there

**Evidence** `about-1440.png`. Programmatic check of the full page text for `mailto|@|contact` returned no match. `/corrections` (`corrections-1440.png`) still instructs: *"write the editor from the About page."* Exact re-reproduction of `UX-006` — unchanged. Note: `.env.example` in this build now documents a `VITE_TOWNREPORTER_EDITOR_EMAIL` variable specifically for this purpose (*"How a reader reaches the editor. Printed on About and on Corrections, and nowhere at all while it is unset…"*) — the mechanism exists and is simply unset on this instance, and unset appears to be this build's actual out-of-the-box default (the variable is commented out with no value in `.env.example`).

**Why this matters** Same as `UX-006`: this is the paper's only stated tip/correction channel, and it is a dead end for every reader and every self-hoster who does not manually set that one variable during setup. Since `.env.example` now proves the product is aware this needs a value, the fix is closer to "make setup prompt for it or fail loud when unset" than "build the feature" — the feature is built.

**Impact scope** `src/routes/about.tsx`, `src/routes/corrections.tsx`, `.env.example`/`docs/setup.md`. User-facing: readers gain a real contact path once an operator sets the variable, or on first run if the setup flow is made to ask for it.

**Fix path** Two options, not mutually exclusive: (1) prompt for `VITE_TOWNREPORTER_EDITOR_EMAIL` during whatever first-run/setup step exists, so a fresh install cannot reach a published state without it; (2) make `/corrections`' sentence conditional — if the variable is unset, do not tell readers to go write an email address that does not exist.

---

### [UX2-009] — Minor — Accessibility — Front-page heading levels still diverge between stories

**Evidence** Front page with two published stories (the seeded welcome article + the one I published this session). Heading outline, read programmatically:
```
H1: TownReporter
H2: Council packet posted late for the Sept 1 session   ← story I published
H3: A civic paper for Longmont, edited by a human        ← seeded story
H2: The paper is this site
```
Exact re-reproduction of `UX-009`'s core symptom (story headlines at different heading levels on the list page) — unchanged. With a single story present, the outline was clean (verified separately, `home-1440.png` / `home-1440` heading dump: `H1, H2, H2`), so the bug is specifically about how the second-and-later story on the list is leveled.

**Why this matters** Screen-reader heading navigation on the front page — the site's front door — still cannot reliably tell stories apart by level as the paper accumulates more than one story, which is the normal steady state for any paper more than a day old.

**Fix path** Unchanged from `UX-009`: render every story headline in the list at a fixed level (`h2`) regardless of position.

---

### [UX2-013] — Minor — Copy — The seeded welcome article still renders its section headings as unformatted run-on lines

**Evidence** `/`, `home-1440.png`; text extraction confirms the raw content: *"…A human editor still decides what publishes.\nWhat we cover\nCity Council and study sessions…\nWhat we will not do\nWe will not quote neighborhood apps as fact…"* — `What we cover` and `What we will not do` are still plain paragraph text with no heading markup, weight, or spacing change. Exact re-reproduction of `UX-013`'s core symptom — unchanged. (I did not re-verify the triple-printed reprint-notice detail from the original finding this round.)

**Why this matters** This is still the first and, on a brand-new install, only story every operator and reader sees, and it still reads as an unformatted grey slab despite genuinely good prose.

**Fix path** Unchanged: rewrite the seed article body with real markdown headings (`## What we cover`).

---

### [UX2-015] — Minor — Copy — A lead filed seconds ago is still told its notes predate note-keeping

**Evidence** `/desk/story/1`, immediately after filing a brand-new lead by hand: the Reporting Notes panel reads *"This draft was written before notes were kept. Redraft fills them; lines you add stay."* — the lead was seconds old. Exact re-reproduction of `UX-015` — unchanged. (`desk-story-1440-fresh.png` shows the panel; text confirmed via extraction.)

**Fix path** Unchanged: branch the copy on whether notes were ever possible for this lead.

---

### [UX2-018] — Minor — Visual hierarchy — The desk command centre still leaves most of the screen empty on first run

**Evidence** `desk-index-1440.png`. On a freshly claimed desk with an empty queue, all content sits in the top ~460px of a 900px-tall viewport; the remaining ~440px is empty ground. Exact re-reproduction of `UX-018` — unchanged.

**Fix path** Unchanged: use the empty space for a first-run "what to do first" checklist, which is also the natural home for `UX2-002`'s still-missing setup banner.

---

### [UX2-020] — Minor — IA — `/desk/memory` still silently rewrites its URL to `/desk/published`

**Evidence** Navigating to `/desk/memory` settles at `http://127.0.0.1:3830/desk/published` (confirmed via `page.url()` after navigation). Exact re-reproduction of `UX-020` — unchanged.

**Fix path** Unchanged: give Beat memory its own route, or make the desk-index link an anchor instead of rewriting the address.

---

### [UX2-022] — Minor — Copy — Beat memory still shows two rows per published story, one keyed by topic and one by headline

**Evidence** `/desk/published`, after publishing one story: the Beat memory table shows **2** entries —
| ENTITY | LAST ANGLE | UPDATED |
|---|---|---|
| `council` | The packet went up under 48 hours before the vote, again. | Aug 30, 2026 |
| `Council packet posted late for the Sept 1 session` | The packet went up under 48 hours before the vote, again. | Aug 30, 2026 |

One story, two entities, identical angle. Exact re-reproduction of `UX-022` — unchanged.

**Fix path** Unchanged: decide what an "entity" is and record only those; a topic slug and a headline are both being fed into the same field.

---

### [UX2-023] — Nit — IA — Two differently-labeled controls both claim the newsroom on an unclaimed desk

**Evidence** `home-topright-1440.png`. On the unclaimed instance, the public home page shows a black `CREATE EDITOR` chip at the top-right of the masthead meta bar *and*, in the nav bar below it, a separate black `EDITOR DESK`/`Editor desk` button (`href="/desk"`) that also routes an unclaimed visitor into the claim flow. Two visually similar high-contrast black chips, in different positions, both leading to "become the editor," is more entry points than the action needs.

**Why this matters** This is a first-impression redundancy, not a broken flow — both paths work — but it adds visual noise to the loudest part of a reader's first screen (see the prior round's "First impressions" note about `CREATE EDITOR` already being the highest-contrast element on the page). It is a Nit rather than a Minor because nothing is actually confusing once clicked; it is only inefficient.

**Fix path** Pick one entry point for the unclaimed state — most likely the nav-bar `Editor desk` chip, since it is also the correct label post-claim — and let the meta-bar slot go quiet (or show nothing) until claimed.

---

## What couldn't be assessed

- **`UX-003` (Dark Desk placeholder titles)** — see above. I exercised the feature live but it produced an empty pile both times; I cannot say whether the underlying field-mapping bug is fixed, regressed, or simply didn't trigger because nothing was found this run.
- **Contrast, focus order, reduced-motion, and the full accessibility snapshot from the prior round** — not re-measured this round (no regression signal found in the surfaces I did inspect, e.g. focus rings were visible throughout my walkthrough, but this is not a re-run of the prior systematic contrast script).
- **Touch target sizing (`UX-011`) across the full desk** — spot-checked only: the Sources page's `Drop` button now measures 54.75×36px at 375px width (previously reported 43×27), a real improvement, still short of the 44px guideline. I did not re-measure every control across every desk route this round.
- **AI-drafted content quality** — still unreachable with no model provider configured, as documented above. Same limitation as the prior round.
- **The Claude Code CLI Opinion path's populated state** — same reason.
- **The "Leave as editor" control** — I could not find it anywhere in the masthead or an account menu this round (clicking the account-name area did not open a menu; `text=Leave as editor` matched 0 elements). This could mean it moved to a place I didn't find, or was removed. I flag this rather than assert either — worth a follow-up grep of the desk-chrome component before concluding anything.
- **The body-content of the article I published** — my own test script mis-targeted a form field while filling the story editor, so the published article's body ended up containing the headline text rather than my intended paragraph. This is an artifact of my test script, not a product defect — I confirmed the sources-rendering and publish-confirm findings independently of this mistake and did not let it affect either finding.

---

## Appendix: surfaces exercised this round

`/` (0 and 1 and 2 stories), `/about`, `/corrections`, `/login` (empty + filled + submit), `/desk`, `/desk/sources`, `/desk/scan` (Run scan, timed), `/desk/queue` (file a lead, full flow), `/desk/story/1` (Draft with AI timed, manual fill, save, publish with confirm), `/desk/opinion`, `/desk/dark` (Check r/longmont, Pick one for me, Start digging), `/desk/ops` (health, resolved state), `/desk/published` (delete confirm), `/desk/memory`, `/evidence/<bad-uuid>`, `/get-the-code`, `/articles/<published-slug>`. Viewports: 1440×900 (primary), 375×812 (spot check). Chromium via Playwright, scripts and all 44 screenshots retained under `uiux-screens/`.
