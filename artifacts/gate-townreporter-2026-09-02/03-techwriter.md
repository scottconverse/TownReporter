# GauntletGate — Full lane — Technical Writer deep-dive — TownReporter v0.6.3

Run date: 2026-09-02. Repo: `C:\Users\scott\Desktop\Code\townreporter-dev` at `f9c2a1a` (v0.6.3).
Read-only pass: no product source modified, nothing built or run, no server started, no commit/push/tag.
Built on the Walkthrough lane's report (`artifacts/gate-townreporter-2026-09-02/00-walkthrough.md`) rather
than re-walking the UI.

**Scope:** README.md, SELF-HOSTING.md, CONTRIBUTING.md (existence only), docs/setup.md, docs/editor.md,
docs/manual.md, docs/local-models.md, docs/staging.md, docs/nightly-proof.md, docs/index.html,
CHANGELOG.md, `.env.example` (cross-checked as the "complete inventory" several docs point readers to),
and the source files needed to verify each documented claim (provider registry, auth rate limiting, cron
route, ops scripts, vite config, package.json).

## Severity counts

Blocker: 0 · Critical: 0 · Major: 2 · Minor: 1 · Nit: 0

---

## Findings

### TEC-01 — Major — `.env.example`'s Opinion/Codex comment contradicts the shipped, documented, and code-enforced behavior
- **Category:** accuracy / internal contradiction
- **Evidence:**
  - `.env.example:38-40` (saved: `artifacts/03-techwriter/TEC-01-env-example-opinion-codex.txt`):
    > "Opinion shows Automatic, Codex Sol and Claude Opus. Automatic tries Codex Sol first, then Claude Opus. Codex sends the configured editorial voice text to OpenAI over stdin; Claude Code receives the voice by file path."
  - `src/lib/news/model-choice.ts:53` onward (saved: `artifacts/03-techwriter/TEC-01-code-opinion-claude-only.txt`), the actual shipped source of truth:
    > "Opinion offers Claude only. Decided 2026-09-02. Codex was offered here too, and its model refuses the job... That is the provider's policy, not a bug... Codex stays on..." — the Story picker only.
  - README.md:226 ("**Opinion is Claude only.** The picker offers Automatic and Claude Opus."), docs/setup.md:260 ("Opinion displays Automatic and Claude Opus, and both mean Claude Opus. Codex is not offered for editorials"), docs/editor.md:374-377, docs/manual.md:241-243, and SELF-HOSTING.md:192/202-206 all agree with the code, not with `.env.example`.
  - **Observed vs expected:** expected every doc surface (including the config template every operator is told to `cp .env.example .env`) to describe the same, single Opinion behavior. Observed: six surfaces say "Claude only", one — the file operators actually read and copy during setup — says "Codex Sol first, then Claude Opus."
- **Why it matters:** `.env.example` is not a side document; `docs/setup.md`, `docs/manual.md`, and `SELF-HOSTING.md` all explicitly point operators at it as "the complete inventory" of environment variables ("All of these are documented in `.env.example`", `docs/setup.md:114`; "The complete inventory, with a comment on each, is `.env.example`", `docs/manual.md:856`). An operator who reads the file they were told to trust will expect a Codex-first Opinion ladder that does not exist, and will either file a false bug report or distrust the rest of the file's guidance once they notice the piece never appears.
- **Impact scope:** every operator who reads `.env.example` as instructed (the file is the canonical reference six other docs delegate to); not a runtime defect — the app itself behaves per the code and the other six docs.
- **Fix path:** update `.env.example:38-40` to match `model-choice.ts`'s decided behavior — "Opinion shows Automatic and Claude Opus. Both mean Claude Opus, through the signed-in Claude Code session. Codex is not offered for editorials because its model declines to write a piece that takes a position." A comment-only change; no code or schema involved.
- **Suggested test:** a lightweight doc-consistency check (e.g. a script asserting the string "Codex Sol" does not appear near "Opinion" in `.env.example`, or a shared source-of-truth snippet templated into both the registry doc-comment and `.env.example`) would have caught this the same day it went stale (2026-09-02, per the `model-choice.ts` decision date — this file was evidently not updated in the same commit).
- **Cross-role note:** this is a pure docs/config-comment defect — no code change needed. Worth flagging to Engineering only as a candidate for the "generate `.env.example`'s prose from the registry" idea `docs/local-models.md` already gestures at for the registry itself.

### TEC-02 — Major — `docs/manual.md`'s opening "Documentation scope" note misstates the whole manual as describing an unreleased candidate
- **Category:** accuracy / honesty (stale claim)
- **Evidence:** `docs/manual.md:3-10` (saved: `artifacts/03-techwriter/TEC-02-manual-scope-note.txt`):
  > "**Version 0.6.3 · 2 September 2026** ... **Documentation scope:** 0.5.6 is the released baseline. Per-run model pickers and the restored native Codex path below describe the **unreleased candidate**, not the live paper until promotion."
  - This is self-contradictory on its face: the same five lines assert both "Version 0.6.3" and "0.5.6 is the released baseline."
  - It is also stale against the rest of the repo. README.md's own changelog summary (`README.md:97-98`) dates the per-run model picker to **0.5.7** ("the editor picks the writing model per run, Codex drafts stories natively") and Codex's native restoration to the same release — both four minor releases and (per SELF-HOSTING.md, confirmed live) already promoted to production before 0.6.3. SELF-HOSTING.md states outright that "the live-deployment notes below record the established setup as of the tagged **v0.6.3** build, which is what the production checkout runs" (SELF-HOSTING.md:7-8), and describes per-run Codex/Claude choice as already running in production (SELF-HOSTING.md:185-206).
  - **Observed vs expected:** expected the manual's framing note to describe what is true of the shipped 0.6.3 build it is titled for. Observed: it tells the reader that the manual's central feature — the per-run model picker most of Part 2 and Part 3 is about — is not yet live, which is false for the live production paper this repo ships.
- **Why it matters:** this is the very first thing a reader of "the full manual" sees, immediately under the title. A new operator or a reviewer reading top-to-bottom is told to discount the model-picker sections as forward-looking/aspirational, when they in fact describe the running system. That is exactly the kind of "aspirational claim" framing the brief was told to watch for, just inverted (understating rather than overstating what's shipped) — still a completeness/honesty defect because it actively misdirects the reader about release status.
- **Impact scope:** every reader of `docs/manual.md`, which README.md lists first under Manuals as "Everyone — the full manual." Does not affect runtime behavior; purely a reader-trust and completeness defect at the top of the primary manual.
- **Fix path:** delete or rewrite the "Documentation scope" paragraph (`docs/manual.md:5-6`) now that per-run pickers and the native Codex path have been live and promoted for several releases. If a scope caveat is still needed for something genuinely unreleased in this candidate, name that specific thing instead of the picker/Codex features that already shipped.
- **Suggested test:** none applicable (prose staleness, not app behavior) — a manual process fix: whoever edits this note per-release should diff it against the version header on the same page.

### TEC-03 — Minor — `docs/nightly-proof.md` misstates the live production database's port as 5432
- **Category:** accuracy / internal contradiction
- **Evidence:** `docs/nightly-proof.md:125-127` (saved: `artifacts/03-techwriter/TEC-03-nightly-proof-port-5432.txt`):
  > "`townreporter_dev` is a restored copy of production, not the live database (`townreporter`, port 5432). The nightly proof only ever reads/writes `townreporter_dev` on port 5433..."
  - SELF-HOSTING.md has a section literally titled **"Postgres is on 5433, not 5432"** (SELF-HOSTING.md:121-132): "**Another Postgres that does not belong to this project already owns 5432 on this machine.**... Ours runs on **5433** so there is no chance the paper writes to the wrong cluster. Do not 'tidy' this back to 5432."
  - The code agrees with SELF-HOSTING.md, not with nightly-proof.md: `ops/start-townreporter.ps1:7-8` ("Postgres lives on 5433, NOT the default 5432 - another Postgres that does not belong to this project already owns 5432"), `ops/stop-townreporter.ps1:8` ("One cluster on 5433 serves the live paper..."), `ops/status.ps1:38-39`, `ops/watchdog.ps1:91-93`, and `ops/promote.ps1` (all hardcode/reference `5433` for the live paper's own Postgres). Saved: `artifacts/03-techwriter/TEC-03-code-and-selfhosting-port-5433.txt`.
  - CHANGELOG.md:248-249 independently confirms the same fact in the other direction ("5433 is one production box's port workaround (5432 is standard)").
  - **Observed vs expected:** expected `nightly-proof.md` to name the live database's real port (5433, per every other source in the repo). Observed: it names 5432, which — per SELF-HOSTING.md — belongs to an unrelated Postgres instance that has nothing to do with this project.
- **Why it matters:** this sentence sits inside the doc's own "Safety notes" section, whose entire purpose is reassuring a reader which port is safe to leave alone and which is live. Getting that fact backwards in prose, in a safety-framed paragraph, is exactly the kind of "count/fact mismatch" that should be caught before it compounds — even though (see Impact scope) the actual script enforcement is unaffected.
- **Impact scope:** documentation-only. The real safeguard is code, not prose: `scripts/live-pipeline-proof.mjs`'s `assertDevDatabase` and `scripts/stage-editor.mjs` both hardcode 5433 and refuse any other database name (confirmed via `docs/nightly-proof.md`'s own citations of `assertDevDatabase`, and independently via the `ops/*.ps1` port references above) — so this misstatement cannot cause the nightly job to touch a live port. It is a correctness defect in the explanation, not in the guard it is explaining.
- **Fix path:** change `docs/nightly-proof.md:126` from "(`townreporter`, port 5432)" to "(`townreporter`, port 5433)".
- **Suggested test:** none applicable (prose fact, not app behavior).

---

## Cross-role notes

- TEC-01 and TEC-02 are both instances of a doc going stale on the same day (2026-09-02) a decision or a release landed elsewhere in the repo, while five-to-six sibling docs were updated correctly. Worth flagging to whoever owns the release checklist: `.env.example` and `docs/manual.md`'s scope header are evidently not on the list of files touched when a provider decision or a release ships, even though `README.md`, `docs/setup.md`, `docs/editor.md`, and `SELF-HOSTING.md` reliably are.
- None of the three findings touch code paths the QA or Engineering roles would exercise at runtime — all three are prose-only defects with no behavioral counterpart, so there is no expected overlap with their findings beyond the general observation above.
- If the QA or Walkthrough role independently probed `.env.example` while constructing the dependency-absent/present environment (the walkthrough report shows they read it closely for the `TOWNREPORTER_CLAUDE_CODE=0` off-switch, its own Finding 2), they may want to know TEC-01 exists in the same file, a few dozen lines away.

---

## What's working

- **Every documented command actually exists and matches**, checked directly against `package.json`'s `scripts` block: `npm run dev`, `dev:lan`, `build`, `start`, `db:migrate`, `test`, `test:lifecycle`, `test:live-model`, `typecheck`, `smoke`, `playwright:install`, and the ops PowerShell scripts named in SELF-HOSTING.md and docs/setup.md all resolve to real files/scripts.
- **Every model identifier documented is the real one**, checked against `src/lib/news/provider-registry.ts`: `claude-opus-5`, `gpt-5.6-terra`, `gpt-5.6-sol`, and the env-override names (`TOWNREPORTER_CODEX_TERRA_MODEL`, `TOWNREPORTER_CODEX_SOL_MODEL`) all match exactly what six different docs claim.
- **Every port claim except TEC-03 is internally consistent and code-verified**: the 8080 dev port with `strictPort: true` (vite.config.ts:276-287, matching README/setup.md's "hard-coded... does not read PORT"), the built server's `PORT`-honoring default of 3000 (`src/lib/auth/server.ts:146`), the 5433/5432 split for production Postgres (matching across SELF-HOSTING.md, CHANGELOG.md, and five `ops/*.ps1` scripts), and staging's fixed 3100 / nightly-proof's fixed 3318 (docs/staging.md, docs/nightly-proof.md) are all corroborated by the actual scripts.
- **The sign-in rate limit is accurately documented**: "ten attempts every five minutes" (README, setup.md, editor.md, manual.md) matches `src/lib/auth/server.ts:307-312` exactly (`customRules: { "/sign-in/email": { window: 300, max: 10 } }`).
- **The `CRON_SECRET` behavior is accurately documented**: "unset → 503, does nothing" and "missing header → 403" (SELF-HOSTING.md, docs/editor.md) match `src/routes/api/cron.monitors.ts` exactly.
- **Every relative link across README.md, SELF-HOSTING.md, and all six `docs/*.md` files resolves** — checked programmatically against the filesystem, including every `docs/images/*.png` reference (all twelve images exist).
- **Every external URL checked (19 total: GitHub repo/release/blob links, the GitHub Pages landing, both companion-tool repos, code.claude.com, and every gateway link in the LiteLLM/Bifrost/Helicone/MLflow/Kong table) answered HTTP 200** via `curl -L`.
- **Version numbers are locked and consistent** across `package.json` (0.6.3), `src/lib/version.ts` (`APP_VERSION = "0.6.3"`), README.md, docs/setup.md, docs/editor.md, and CHANGELOG.md's "Current release" line — with `docs/manual.md`'s header being the sole exception (see TEC-02, which is about the scope-note paragraph beneath that correct header, not the header itself).
- **The provisioning-chain tables (Scan/Dark Desk configured-provider precedence, Story Automatic ladder, Opinion) are worded consistently across README.md, docs/setup.md, docs/editor.md, and docs/manual.md** — the one place this same information goes wrong is the isolated `.env.example` comment in TEC-01, not a systemic drift across the prose docs.
- **`docs/index.html`'s claims are consistent with the Markdown docs** it links to (release tag, GitHub repo path, doc filenames) — no separate marketing-page exaggeration was found distinct from the two Major findings above.

## What I could not assess and why

- **Screenshot accuracy** (whether `docs/images/*.png` genuinely depict the described 0.6.3 screens, versus the "historical Longmont screens from 29 August" the docs themselves flag as stale) — this requires visually comparing each image against a running instance, which is the Walkthrough/QA lane's job, not a static read-only docs pass. The docs are self-aware and honest about which images are historical (editor.md:5-8, manual.md:7-10), so this is a labelled limitation in the product's own docs rather than an unflagged gap.
- **`docs/dark-desk-editor.md`** was outside this role's assigned scope list and was only spot-checked for existence (it exists, and is linked correctly from three other docs); it was not read end-to-end for accuracy.
- **`CONTRIBUTING.md`** was only checked for existence (README links it); its content was not audited against actual contribution workflow/CI, since the brief's scope list did not name it as a target file.
- **Whether the Opinion "ten to forty minutes" / cost figures ($2.66, $23.76) in README, editor.md, and manual.md are still representative** of the current 0.6.3 code path — these are explicitly labelled as historical measured runs in all three docs ("Historical runs", "observations, not a deadline"), so they are honest about their own dated nature; I did not re-run Opinion to reproduce them (out of scope for this lane; no server was started).
- **AGENTS.md / AGENTS.project.md / `.grok/`** were not audited as documentation, per README's own explicit disclaimer that they are build-tool scaffold artifacts, not TownReporter docs (README.md:307-313) — I verified `.grok/app-env.json` and `scripts/with-app-env.mjs` both exist as claimed, but did not audit AGENTS.md's content itself.
