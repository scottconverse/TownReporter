# Documentation Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-29
**Role:** Technical Writer
**Scope audited:** `README.md`, `SELF-HOSTING.md`, `CHANGELOG.md`, `.env.example`, `docs/manual.md`, `docs/editor.md`, `docs/setup.md`, `docs/dark-desk-editor.md`, `docs/local-models.md`, `docs/index.html` (GitHub Pages landing), `AGENTS.md`, `AGENTS.project.md`, `LICENSE`, `.github/workflows/ci.yml`, and the running product's own public copy at `/about` and `/how-we-report` (127.0.0.1:3200)
**Writer mode:** audit+draft
**Auditor posture:** Balanced

---

## TL;DR

This is a genuinely well-documented project — better than most commercial products I audit. `docs/manual.md` and `docs/editor.md` are real manuals with real screenshots, real Mermaid architecture diagrams, and a rare willingness to name what the software will *not* do. Nothing I found blocks a new operator from installing: I ran the documented `npm test` and the documented routes against the running build and they behave as written. The problems are all **drift** — three documents still describe a 0.5.0-or-earlier product and contradict the current one, most damagingly `docs/setup.md`'s "What you need" table, which tells a first-time operator they need an xAI API key when the headline feature of this release is that they need nothing at all. Second theme: the repo root presents two different products to a GitHub visitor (`AGENTS.md` says "You are Grok Build, in an isolated Linux sandbox"; `package.json` says `"name": "app-builder-workspace"`), and the docs are silent about the one privacy fact an investigative newsroom operator would most want disclosed — that every desk search leaves the machine to third-party search services.

## Severity roll-up (documentation)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 1 |
| Major | 5 |
| Minor | 5 |
| Nit | 2 |

## What's working

Credit where it is earned — these are the things this project should keep doing.

- **`docs/manual.md` Part 5 is a real architecture document with six Mermaid diagrams** — system context, the source-to-page pipeline, the job sequence, one Dark Desk round, the Opinion private-voice boundary, the watchdog loop, and an ER diagram of the data model. Most projects this size ship prose where a graph belongs. This one ships the graph, in-repo, in a format that updates with the code. The pipeline diagram even makes the product's central promise visually checkable: the editor gate is the only edge into "The paper", and the Dark Desk diagram has no edge to the paper at all.
- **`docs/editor.md` is written for the person who actually has to use this.** No code, screenshots of every screen, a "working day" numbered loop, and a 17-row "Common trouble" table written in symptom-first language ("Draft with AI ran, form still empty"). The non-technical-journalist persona is served better here than the developer persona is anywhere.
- **`docs/local-models.md` is a model of honest negative-result writing.** It states the machine, the method, the per-run numbers, the median, the run count, and reaches a verdict against the interesting answer ("mostly no"). It also names the two incidental discoveries that matter more than the verdict — that a reasoning model behind `LLM_BASE_URL` returns empty content the app cannot distinguish from a refusal, and that the frontier planner itself sometimes refuses. Publishing the disconfirming detail is what makes the rest credible.
- **The disclaimer is above the fold, not in a footer.** `README.md` puts "Drafts are AI-assisted… TownReporter does not fact-check for you… You are solely responsible" in a blockquote before the feature list. For an AI-assisted journalism tool that is the single most important paragraph in the repository, and it is placed where it cannot be missed.
- **The docs match the running product on every route I checked.** `/`, `/about`, `/how-we-report`, `/corrections`, `/desk`, `/login`, `/feed`, `/sitemap.xml`, `/robots.txt`, `/desk/ops`, `/desk/opinion`, `/desk/dark`, `/get-the-code`, `/evidence/compare` all answer 200 on the running 0.5.1 build, and a bogus slug returns a real 404 exactly as the changelog claims.
- **Zero broken relative links.** Every `[...](path)` target in `README.md`, `SELF-HOSTING.md`, `CHANGELOG.md` and all five `docs/*.md` resolves to a file that exists, and every one of the eleven `docs/images/*.png` referenced by the manuals is present on disk. That is unusual after a release.
- **The changelog explains causes, not just changes.** "`drafts.lead_id` was declared not null in the newsroom's second migration… so every finished piece hit a not-null violation at the moment it was stored." A reader learns the system from the changelog, which is rare.
- **The comments in CI and in the test suite carry their own documentation.** `.github/workflows/ci.yml` and `scripts/newsroom-security.test.mjs` explain in prose why each job exists and which audit finding it closes. Documentation that is enforced by a failing build does not drift.

## What couldn't be assessed

- **The public production site.** `https://townreporter.org` and the `townreporter-web` checkout were out of bounds by instruction. Every claim in `SELF-HOSTING.md` about the live deployment (tunnel behaviour, DNS, email routing, scheduled-task state) is therefore **unverified by me**, not verified-and-fine. Findings below are confined to statements I could check inside `townreporter-dev`.
- **The GitHub Pages landing as served.** I read `docs/index.html` from disk (valid UTF-8, `<meta charset="utf-8">` present, no mojibake) but did not load `https://scottconverse.github.io/TownReporter/`.
- **A cold clone.** I audited the working checkout, not a fresh `git clone` on a clean machine, so I cannot certify the quick start end to end myself. CI's `smoke-dev` job does run the README's own commands, which is good but is not the same evidence.
- **Support-channel traffic.** No issue tracker, Discord, or support inbox was in scope, so the FAQ could not be checked against questions people actually ask. The README FAQ is judged on internal merit only.

---

## Doc asset inventory

| Asset | Exists? | Status | Finding(s) |
|---|---|---|---|
| README.md | Yes | **Strong** | DOC-007, DOC-009, DOC-013 |
| ARCHITECTURE.md | No (content lives in `docs/manual.md` Part 5) | Adequate — content strong, discoverability weak | DOC-011 |
| User manual / guide | Yes — `docs/manual.md`, `docs/editor.md` | **Strong** | DOC-008 |
| Operator setup | Yes — `docs/setup.md` | **Weak** (stale requirements table) | DOC-001, DOC-010 |
| Deployment worked example | Yes — `SELF-HOSTING.md` | Weak (stale + mis-framed) | DOC-002, DOC-007 |
| API reference | N/A | No public API surface; routes are tabled in `docs/manual.md` Part 6 | — |
| FAQ | Yes — README "Frequently asked questions" (12 entries) | Adequate | DOC-003 |
| CHANGELOG | Yes | **Strong** | — |
| CONTRIBUTING | **No** | Missing | DOC-005 |
| SECURITY | **No** | Missing | DOC-004 |
| CODE_OF_CONDUCT | No | Missing (low priority, single-maintainer repo) | noted under DOC-005 |
| LICENSE | Yes — MIT, © 2026 Scott Converse | Strong | — |
| Landing / marketing page | Yes — `docs/index.html` | Adequate, one unqualified claim | DOC-003 |
| Config reference | Yes — `.env.example` | Adequate, one stale comment | DOC-002 |

---

## Persona walk-through

### First-time user (GitHub reader)

Succeeds. The README answers "what is this" in one sentence, "who is it for" in the two-room table, and "how do I try it" in a five-command block, all within the first screen. The honesty blockquote lands before any feature claim. Two things degrade the arrival: the repo root also contains `AGENTS.md`, whose first line is "You are Grok Build, in an isolated Linux sandbox" (DOC-006), and `package.json` names the project `app-builder-workspace`. A reader who opens either — and on GitHub, `AGENTS.md` is a file people now habitually open — meets a second, unrelated product.

### Returning user / operator

Mostly succeeds, with one bad turn. Navigation between the five docs is good; each links the others and the audience table in the README is accurate. But an operator who goes to `docs/setup.md` to answer "what do I actually need to buy" reads a "What you need" table that requires an xAI key or a gateway (DOC-001), and an operator who reads `SELF-HOSTING.md` is told `npm test` will spend a real model call (DOC-002). Both statements were true in an earlier release and are false now. The returning-user experience is where all the drift is concentrated.

### Non-technical journalist (the person who has to run it)

Best-served persona in the project. `docs/editor.md` is genuinely usable without a terminal: sign-in, the working day, each screen, what never prints, and a symptom-indexed trouble table. The gaps are at the seams — the moment something goes wrong at the machine level, the journalist is sent to `setup.md` (developer-shaped, and currently wrong about what they need) or to `SELF-HOSTING.md` (a record of one specific Windows box, not instructions for theirs).

### New team member / contributor

Weakest persona. There is no `CONTRIBUTING.md` (DOC-005) and no `SECURITY.md` (DOC-004). The information exists — `npm test`, `npm run typecheck`, the CI matrix, the repo layout table in `docs/setup.md`, the test conventions enforced in `scripts/newsroom-security.test.mjs` — but it is scattered across three documents and a workflow file, and there is no stated way to report a vulnerability privately in a project that ships an SSRF guard, session auth, and an admin desk.

---

## Findings

> **Finding ID prefix:** `DOC-`
> **Categories:** Accuracy / Completeness / Onboarding / Architecture / API / FAQ / Marketing / Tone / Hygiene

### [DOC-001] — Critical — Accuracy / Onboarding — `docs/setup.md` still requires an API key the product no longer needs

**Evidence**

`docs/setup.md`, section "What you need", the "A model" row:

> **A model** | An [xAI key](https://console.x.ai) **or** any OpenAI-compatible `/v1/chat/completions` gateway. Scan, Draft, and Dark Desk will refuse to run without one.

Three paragraphs later, the same document says the opposite:

> Edit `.env`. **The minimum that produces a working desk is nothing at all** — if the [Claude Code](https://code.claude.com) CLI is installed and signed in, the desk uses that login.

The rest of the project agrees with the second statement: `README.md` ("You do **not** need an AI key if Claude Code is installed and signed in"), `docs/manual.md` Part 3, `.env.example` ("NOTHING TO SET"), `docs/index.html` ("No API key by default"), and the code — `src/lib/news/ai.ts` returns the Claude Code path unless `TOWNREPORTER_CLAUDE_CODE=0`, and `docs/manual.md`'s provider table lists *nothing* as a valid selection. The "What you need" table is a survivor from before the Claude Code path shipped in 0.5.0.

**Why this matters**

This is the first table in the operator manual, under the heading a person reads to decide whether they can run this at all. The non-technical journalist persona — the audience this release is aimed at — reads "you need an xAI key" and concludes they must open a billing account with a model vendor before they can see the product. The single most valuable thing about 0.5.1 for that reader is that they do not. It is also the exact class of error the role brief calls out: a doc that misstates the setup prerequisite is worse than no doc, because the reader who bounces never comes back to discover the correction three paragraphs down. It is not a Blocker only because the surrounding text and the README both contradict it, so a thorough reader recovers.

**Blast radius**

- **Other docs that repeat the same error:** none found — README, `manual.md`, `.env.example` and `index.html` are all correct. This is a single stale table, which makes it cheap to fix.
- **Adjacent claims in the same file:** `docs/setup.md` "The app binds `0.0.0.0:8080`" (DOC-010) is stale in the same way and should be fixed in the same pass.
- **User-facing:** an operator stops believing they must buy a key; the "five minutes, nothing to set" promise becomes consistent across every surface.
- **Migration:** none — documentation only.
- **Tests to update:** none known. Consider adding a docs assertion to `scripts/newsroom-security.test.mjs`, which already enforces prose-level invariants, so the requirement table cannot drift from `resolveProvider()` again.
- **Related findings:** DOC-002 (same root cause: 0.5.0/0.5.1 provider change not propagated to every doc), DOC-010.

**Fix path**

Replace the "A model" row with the current truth. Drafted in full at `doc-rewrites/docs/setup.md`; the row becomes:

> **A model** | Nothing, if the [Claude Code](https://code.claude.com) CLI is installed and signed in on this machine — the desk uses that login and there is no key to buy. Otherwise set `ANTHROPIC_API_KEY`, or `LLM_BASE_URL` for any OpenAI-compatible gateway (including a local model), or `XAI_API_KEY` for Grok. With none of the four, Scan, Draft and Dark Desk say so and spend nothing.

---

### [DOC-002] — Major — Accuracy — Two docs say `npm test` makes a live, billed model call; it does not

**Evidence**

`SELF-HOSTING.md`, section "The AI":

> `npm test` makes one real Claude call (~28s). To skip it:
> ```bash
> TOWNREPORTER_CLAUDE_CODE=0 npm test
> ```

`.env.example`, in the Claude block:

> `# Take the CLI out of the chain entirely (also makes `npm test` skip the one live-API test, so a test run costs nothing):`

Measured on this checkout, with a Claude Code CLI available on the box and no `TOWNREPORTER_CLAUDE_CODE` override:

```
ℹ tests 534
ℹ suites 174
ℹ pass 531
ℹ fail 0
ℹ skipped 3
ℹ duration_ms 17213.9155
```

17.2 seconds, no provider contacted. The behaviour changed in this release and is now enforced by the suite itself — `scripts/newsroom-security.test.mjs` fails the build if any default test can reach a live model unasked, and `src/lib/news/scan-pass.test.ts` gates the live evaluation behind `RUN_LIVE_MODEL_TESTS=1`. `README.md` and `docs/setup.md` both describe the current behaviour correctly; `SELF-HOSTING.md` and `.env.example` did not get the update.

**Why this matters**

The contributor and the operator both read a cost warning that no longer applies, and act on it — setting `TOWNREPORTER_CLAUDE_CODE=0` to protect a subscription that is not at risk, or avoiding the test suite entirely. It also directly contradicts the README on the same page-load journey, and a reader who catches the contradiction has no way to know which document to trust. The irony is sharp: this exact drift is the kind of thing the project's own CI comments were written to prevent.

**Blast radius**

- **Other docs that repeat the same error:** `.env.example` (same claim, inline comment). `README.md` §Tests and `docs/setup.md` §Tests are already correct — do not touch them.
- **Shared config:** the advice tells people to set `TOWNREPORTER_CLAUDE_CODE=0`, which also disables the Opinion desk (`src/lib/news/editorial.server.ts` refuses outright). A reader following the stale advice loses a feature for no benefit — that consequence is undocumented at the point of advice.
- **User-facing:** none directly; the cost of the misinformation is trust and one unnecessary env var.
- **Migration:** none.
- **Tests to update:** none known. `scripts/newsroom-security.test.mjs` already pins the behaviour; the docs are what lag.
- **Related findings:** DOC-001 (same root: release changes propagated to some docs, not all), DOC-007.

**Fix path**

In `SELF-HOSTING.md`, replace the paragraph with: "`npm test` is deterministic, offline and free — 534 tests in about 17 seconds, and the suite fails if any test can reach a live model unasked. The live model evaluation is opt-in: `RUN_LIVE_MODEL_TESTS=1 npm run test:live-model`." Full replacement drafted at `doc-rewrites/SELF-HOSTING.md`. In `.env.example`, cut the parenthetical to "Take the CLI out of the chain entirely. Note this also disables the Opinion desk, which requires the CLI by design."

---

### [DOC-003] — Major — Completeness / Marketing — No doc discloses that desk searches go to third-party services

**Evidence**

`src/lib/news/search-web.ts` defines a search chain whose first provider is Exa's hosted MCP endpoint, `https://mcp.exa.ai/mcp` (line 129), with fallbacks implemented as `searchDdg`, `searchDdgLite`, `searchWikipedia`, `searchBing` and `searchBrave`. The source comment above the endpoint is candid about the consequence:

> Scraped engines stay behind it: this is a third party seeing every query, and its free tier has no documented ceiling, so the desk must still work when it refuses.

Searching the user-facing documentation for that fact returns two hits, both feature bullets that do not mention data leaving the machine: `README.md` line 89 ("**Search works.** Exa runs first…") and the matching `CHANGELOG.md` entry. `.env.example`, `docs/setup.md`, `docs/manual.md`, `docs/editor.md` and `docs/index.html` do not mention Exa, MCP, or third-party search at all. Meanwhile the landing page carries the badge "**Zero** trackers — zero outside requests", and `docs/manual.md` §"Privacy of the reader" makes the same claim under a heading that scopes it correctly to the reader — the landing badge has no such scope.

I verified the reader-side claim and it holds: fonts are self-hosted in `public/fonts/` (Fraunces and Source Serif 4 `.woff2` on disk) and the served front page contains no external asset host. The gap is not that the reader claim is false; it is that the **editor**-side egress is undisclosed next to it.

**Why this matters**

The product is an investigative tool. An editor typing a person's name, an LLC, a contract number or an unpublished rumour into Dark Desk is sending that string to a third-party search company, and — on fallback — to Bing, Brave and DuckDuckGo. That is a normal engineering choice and defensible; not telling the operator is not. A local journalist who chose a self-hosted newsroom specifically so their reporting stays on their own machine is making that decision on incomplete information, and the marketing badge actively points them the wrong way. The code comment shows the team already understands the exposure; only the docs are silent. Per the role brief, buried or omitted limitations are the failure mode that costs the most trust on discovery.

**Blast radius**

- **Other docs that repeat the same framing:** `docs/index.html` badge row ("Zero trackers — zero outside requests"), `docs/manual.md` §"What the reader gets", `README.md` FAQ "Does the paper track readers?" — all three are true as written about readers, and all three should gain the one-clause counterpart about the desk so the pair is impossible to misread.
- **Shared state / config:** no env var governs this today — the chain is unconditional in `search-web.ts`. If the fix is to be more than documentation, an opt-out flag is a product decision, not a writing one.
- **User-facing:** an editor learns, before they type a name into Dark Desk, where that string goes. Some will change their behaviour; that is the point.
- **Migration:** none for the docs-only fix.
- **Tests to update:** none known.
- **Related findings:** none share this root cause.

**Fix path**

Three edits, none large. (1) A "What leaves this machine" section in `docs/setup.md` — drafted at `doc-rewrites/docs/setup.md` — listing the model provider, the civic sources fetched, and the search chain by name, with the note that queries are visible to whichever provider answers. (2) A README FAQ entry immediately after "Does the paper track readers?":

> **Does anything leave my machine when I use the desk?**
> Yes, and it is worth knowing which things. Reading the paper sends nothing anywhere. Working the desk does: pages you watch and documents you pull are fetched from the sites that host them; model calls go to whichever provider you chose; and searches go to a third-party search chain — Exa's hosted endpoint first, then DuckDuckGo, Bing, Brave and Wikipedia. That means a name, an LLC or a contract number you type into Dark Desk is seen by a search provider. No key is needed for any of them, and none of it touches the reader side of the paper.

(3) Qualify the landing badge to "**Zero** trackers on the reader's page — zero outside requests", which costs four words and makes the claim exactly true.

---

### [DOC-004] — Major — Hygiene / Completeness — No `SECURITY.md`, and no stated way to report a vulnerability

**Evidence**

The tracked repository root contains `.env.example`, `.gitignore`, `.prettierrc`, `AGENTS.md`, `AGENTS.project.md`, `CHANGELOG.md`, `LICENSE`, `README.md`, `SELF-HOSTING.md`, `eslint.config.mjs`, `package-lock.json`, `package.json`, `startup.sh`, `tsconfig.json`, `vite.config.ts` — no `SECURITY.md`. `.github/` contains exactly one file, `workflows/ci.yml` — no `SECURITY.md` there either. Searching the five `docs/*.md`, the README and `SELF-HOSTING.md` for a disclosure address or process turns up nothing; the only contact surface documented anywhere is `tips@townreporter.org`, described in `SELF-HOSTING.md` as a **receive-only tip line** for the newspaper.

This is a project that documents an SSRF guard ("the address approved is now the address connected to"), session auth with an owner/editor boundary, a `NEWSROOM_SETUP_TOKEN` that gates newsroom ownership, a `CRON_SECRET`, and a `VITE_AUTH_ENABLED=false` switch it repeatedly warns must never be used on a public host. It invites strangers to clone it and run it on the public internet.

**Why this matters**

A researcher who finds an auth bypass or an SSRF escape in a cloned TownReporter has two options today: open a public GitHub issue, which discloses it to every operator at once including the live Longmont paper, or send it to a tip line that the docs say is not read as a mailbox. Both are bad outcomes, and both are the project's fault rather than the researcher's. For a self-hosted product whose whole pitch is "clone it, point it at your city", every operator downstream inherits the absence of a coordinated-disclosure path.

**Blast radius**

- **Adjacent surfaces:** GitHub renders `SECURITY.md` in the repo sidebar and in the "Report a vulnerability" flow, so the file changes the platform's own affordances, not just the docs.
- **Shared state:** the file must name a real monitored address. `tips@` is documented as receive-only and forwards to a personal Gmail — using it for security reports is a decision the maintainer has to make, not one a writer can make for him. The draft leaves that address as an explicit `<fill in>`.
- **User-facing:** none in the product.
- **Migration:** none.
- **Tests to update:** none known.
- **Related findings:** DOC-005 (same root: open-source project hygiene files were never created).

**Fix path**

Drafted at `doc-rewrites/SECURITY.md` — supported versions, what is in scope for a self-hosted app (including the explicit note that a self-hosted operator's own misconfiguration is theirs), where to send a report, expected response time, and the project's existing hardening as context. One address needs filling in before it ships.

---

### [DOC-005] — Major — Completeness / Onboarding — No `CONTRIBUTING.md`; the contributor path is scattered across four files

**Evidence**

No `CONTRIBUTING.md` in the tracked root or in `.github/` (full listings under DOC-004). The information a contributor needs exists but is distributed: `npm test` and `npm run typecheck` are in `package.json` and mentioned in three different docs with three different framings; the repo layout table is in `docs/setup.md` §"Layout of this repo"; the architecture is in `docs/manual.md` Part 5; the CI matrix (five jobs — `test`, `lifecycle`, `smoke-built`, `smoke-dev`, `search-index`) is only discoverable by reading `.github/workflows/ci.yml`; and two non-obvious, enforced conventions are documented only as comments inside test files — that the default suite may never reach a live model (`scripts/newsroom-security.test.mjs`) and that the Dig/Nerve dials may never be tightened (`docs/manual.md` §Tests mentions it; the enforcement is in the suite).

**Why this matters**

The new-team-member persona from the role brief fails here. A contributor cannot answer "how do I run what CI runs", "where do tests live", "what will get my PR rejected", or "does this project even take PRs" from any single page. The `search-index` job needs a real Postgres and the `lifecycle` job needs Playwright Chromium — a contributor who runs only `npm test`, passes, and opens a PR gets a red build for reasons no document warned them about. The cost is not that people are blocked; it is that the maintainer pays for the missing page in review comments, one contributor at a time.

**Blast radius**

- **Adjacent docs:** the fix should *link* rather than duplicate — `docs/setup.md` owns environment, `docs/manual.md` owns architecture. A CONTRIBUTING that restates them becomes a fourth thing to keep in sync, and this audit already found three docs drifting.
- **Shared state:** the two enforced invariants (no live model in the default suite; dials never tighten) currently live only as code comments. Naming them in prose is what makes them reviewable by a human before CI says no.
- **User-facing:** none.
- **Migration:** none.
- **Tests to update:** none known.
- **Related findings:** DOC-004 (same root), DOC-011 (architecture discoverability), DOC-006 (the root-level files a contributor meets first).

**Fix path**

Drafted at `doc-rewrites/CONTRIBUTING.md` — what the project accepts, the dev loop, the five CI jobs and what each needs, where tests live and the two invariants they enforce, the docs map, and commit/PR expectations. A `CODE_OF_CONDUCT.md` is worth adding at the same time; for a single-maintainer repo the Contributor Covenant with one contact line is sufficient and I have not drafted one.

---

### [DOC-006] — Major — Tone / Accuracy — The repo root ships a second, contradictory product identity

**Evidence**

Tracked at the root of a repository whose README opens "# TownReporter":

- `AGENTS.md` (18,640 bytes), first lines: "# App Builder Workspace — **The single source of truth** for the App Builder sandbox contract. You are Grok Build, in an isolated Linux sandbox; read it fully before writing code… ship a **playable / demo-quality** product."
- `AGENTS.project.md` (2,648 bytes), "TownReporter — Scott's standing orders", whose documented workflow is uploading a zip to `tmpfiles.org` and `litterbox.catbox.moe` and pasting the URL as line 1 of a reply.
- 88 tracked files under `.grok/` (`git ls-files .grok | wc -l` → 88), including a skills library for `auth`, `design-ui`, `building-games`, `neon`.
- `package.json`: `"name": "app-builder-workspace"`.

`AGENTS.project.md` also contradicts the shipped product. Its "Forbidden (already failed — never retry)" list includes "`/TownReporter.zip` or any zip inside the live preview" and "a Download zip button on the paper, desk, login, or any product UI" — while `docs/manual.md` Part 6 documents `/get-the-code` · `/TownReporter.zip` as product routes, and both answer on the running build (200 and 307 respectively).

**Why this matters**

`AGENTS.md` is now one of the first files people and coding agents open in a repository. A GitHub reader evaluating whether to clone a civic-journalism tool finds a document telling them they are "Grok Build" building "playable / demo-quality" products in a sandbox, a personal file-handoff runbook, a game-development skills library, and a `package.json` that names the project something else entirely. The effect on the "is this a serious project I can run my newsroom on" judgement is direct, and it is unearned — the actual product docs are excellent. There is a second-order effect worth naming: an instruction file at a repository root is read as instructions by any agent working in a clone, so a stale one does not sit inert, it misdirects.

**Blast radius**

- **Adjacent surfaces:** `package.json` `name` is also what npm, the lockfile and the `> app-builder-workspace@0.5.1 test` banner in every test run display. Renaming touches `package-lock.json`; the version-lock test asserts the *version* across `package.json`, `src/lib/version.ts` and the masthead, so check whether anything asserts the name before changing it.
- **Shared state:** `.grok/app-env.json` is functional — `scripts/with-app-env.mjs` reads it for `VITE_`-prefixed build flags, and `npm run dev` routes through that wrapper. **Do not delete `.grok/` wholesale**; only the skills/references content is inert here, and the app-env file is load-bearing.
- **User-facing:** none in the running product. This is entirely about what a GitHub visitor and a contributing agent meet first.
- **Migration:** none, if the change is limited to moving or scoping the files. Renaming the npm package is a larger call and should be a separate decision.
- **Tests to update:** none known — but re-run `npm test` after any `package.json` name change, since the version-lock suite reads that file.
- **Related findings:** DOC-005 (root-level files the contributor meets), DOC-011.

**Fix path**

A product decision, not a rewrite, so I have not drafted a replacement. Three options in increasing order of effort: (1) give `AGENTS.md` a scope header naming it a build-platform contract that is not part of TownReporter, and reconcile `AGENTS.project.md`'s "forbidden" list with the shipped `/get-the-code` route; (2) move both plus `.grok/skills/` and `.grok/references/` under a clearly labelled `tooling/` or `.builder/` directory, keeping `.grok/app-env.json` where `scripts/with-app-env.mjs` expects it; (3) additionally rename the npm package to `townreporter`. Whichever is chosen, the README should say in one line what the remaining file is, so its presence reads as deliberate rather than as debris.

---

### [DOC-007] — Minor — Accuracy / Tone — `SELF-HOSTING.md` is a record of one machine, framed by the README as setup for yours

**Evidence**

`README.md` §"Earlier (0.5.0)" ends: "Setup for your own machine: [SELF-HOSTING.md](SELF-HOSTING.md)." The document itself opens "# TownReporter — how this is actually running / Live at **https://townreporter.org**, served from a Node process on this machine… Everything below is running and was verified end to end," and is specific to one box throughout: `HALO\scott` logon triggers, Postgres on 5433 because another cluster owns 5432 *on this machine*, `ops/install-tasks.ps1` and Windows Task Scheduler, a Cloudflare Tunnel and that account's Email Routing, `tips@townreporter.org`.

**Why this matters**

A reader following the README's pointer expects instructions and gets a logbook. It is a genuinely valuable logbook — the reasoning about `run-hidden.vbs`, the `__Host-` cookie and LAN sign-in, and the SPF `~all` decision is exactly the hard-won detail most projects never write down — but a Linux or macOS self-hoster hits Windows scheduled tasks in the second section and cannot tell which parts generalise. The "verified end to end" framing also makes stale content (DOC-002) read as freshly attested.

**Fix path**

Retitle and re-frame as a worked example, and label the portable parts. Drafted at `doc-rewrites/SELF-HOSTING.md`. Change the README pointer to "A worked example of one machine serving the live paper: SELF-HOSTING.md — the portable deployment notes are in docs/setup.md."

---

### [DOC-008] — Minor — Accuracy — `docs/manual.md` states 528 tests; the suite has 534

**Evidence**

`docs/manual.md` Part 4, §Tests: "528 tests, and the default run is deterministic, offline and free." Measured on this checkout: `tests 534 / pass 531 / fail 0 / skipped 3`. The qualitative half of the sentence is correct and verified; only the count has drifted.

**Fix path**

Two options. Either update to "534 tests (three skipped without a Postgres)", or — better, given this is the second count-drift class in the audit — drop the number and say "the default run is deterministic, offline and free", since a hand-maintained count is a thing that can only ever go stale. The project already learned this lesson once for test *discovery* (`scripts/newsroom-security.test.mjs` forbids a hand-maintained file list); the same reasoning applies to a hand-maintained count in prose.

---

### [DOC-009] — Minor — Accuracy — README says "the same six moves the paper describes"; the paper describes eight

**Evidence**

`README.md` §"How it works": "Same six moves the paper itself describes at `/how-we-report`", followed by six numbered items. The running page at `http://127.0.0.1:3200/how-we-report` renders eight headed steps: Watch, Detect, Follow, Preserve, Investigate, Write-then-gate, **Credit**, **Corrections**. `docs/manual.md` §"The six moves" has the same six plus a separate Corrections paragraph. The two extras are not filler — Credit is a substantive editorial policy ("we name them and link the exact story, not a homepage") and it is the one step a reader worried about AI-assisted journalism plagiarising local outlets would most want to see.

**Fix path**

Change to "Same eight moves the paper itself describes at `/how-we-report`" and add the two items; Credit in particular deserves the README's real estate. `docs/manual.md` §"The six moves" needs the same treatment — it already covers corrections in prose, so only Credit is missing there.

---

### [DOC-010] — Minor — Accuracy — `docs/setup.md` says the app binds `0.0.0.0:8080`; the built server defaults to port 3000

**Evidence**

`docs/setup.md` §"What you need", closing line: "Windows, macOS, and Linux all work. The app binds `0.0.0.0:8080`." That is the **dev** server: `package.json` `dev` is `vite dev --host 0.0.0.0 --port 8080`. The built server takes `PORT` (documented in `.env.example` as "PORT defaults to 3000") and `HOST`; CI's `smoke-built` job boots it on 3000, `SELF-HOSTING.md` describes the live deployment on `127.0.0.1:3000`, and `docs/manual.md`'s watchdog diagram checks "App answering on PORT (3000)?".

**Fix path**

"`npm run dev` serves on `0.0.0.0:8080`. The built server (`npm start`) listens on `PORT` (default 3000) and `HOST` (default every interface — set `127.0.0.1` when a tunnel or proxy fronts it)." Included in `doc-rewrites/docs/setup.md`.

---

### [DOC-011] — Minor — Architecture / Discoverability — Strong architecture content, no `ARCHITECTURE.md` to find it by

**Evidence**

`docs/manual.md` Part 5 contains the system-context, pipeline, job-sequence, Dark Desk round, Opinion voice-boundary, watchdog and ER diagrams, plus Part 4's stack table and the desk-boundary and job-lifecycle explanations. There is no `ARCHITECTURE.md` at the root; the README's manuals table points to `docs/manual.md` with the parenthetical "with architecture drawings".

**Why this matters**

The content requirement is met and met well — this is a discoverability nit, not a gap. But an engineer evaluating the repo looks for `ARCHITECTURE.md` by convention, and a 29 KB manual is a long way to scroll to find out whether the project has thought about its own shape.

**Fix path**

Either a thin `ARCHITECTURE.md` at the root that links to `docs/manual.md#part-5--architecture` and inlines the system-context diagram, or split Part 5 into `docs/architecture.md` and link it from both the manual and the README table. The former is cheaper and cannot drift. No draft produced — the content already exists and should not be duplicated by an auditor.

---

### [DOC-012] — Nit — Hygiene — Manual screenshot numbering skips `03`

`docs/images/` holds `01`, `02`, `04`–`12`. Every image referenced by `docs/manual.md` and `docs/editor.md` exists — nothing is broken — but the gap suggests a screenshot that was cut without renumbering, and the next person to add one will not know whether `03` is missing or pending.

---

### [DOC-013] — Nit — Hygiene — The README carries three releases of changelog

`README.md` devotes roughly a third of its length to "This release (0.5.1)", "Earlier (0.5.0)" and "Earlier still (0.4.x)", duplicating `CHANGELOG.md`. It reads well and the entries are genuinely interesting, but it pushes the FAQ, the model table and the layout table below a lot of history for a first-time reader, and it is a second copy to keep in sync. Trimming to 0.5.1 plus a link would tighten the front door. Flagged once; the maintainer may reasonably prefer it as is.

---

## Drafts produced

Writer mode is audit+draft. Four files, all in `artifacts/audit-townreporter-2026-08-29/doc-rewrites/`, named to match where they would live in the repo. Each is intended to be publishable with light editing, not a stub — but each carries a short auditor's note at the top listing anything the maintainer must confirm before shipping, because a doc that an auditor guessed at is exactly the kind of doc this report is about.

- `doc-rewrites/docs/setup.md` — full replacement for `docs/setup.md`. Fixes the "What you need" table (DOC-001) and the bind claim (DOC-010), and adds a "What leaves this machine" section covering the model provider, source fetching and the third-party search chain (DOC-003). Everything else is preserved from the current document, which is otherwise good.
- `doc-rewrites/SELF-HOSTING.md` — full replacement. Corrects the `npm test` claim with the measured numbers (DOC-002), re-frames the document as a worked example of one machine rather than generic setup instructions, and marks each section portable or machine-specific (DOC-007). Unverifiable production claims are kept as the author's attestations and labelled as such, since I could not check them.
- `doc-rewrites/SECURITY.md` — new file (DOC-004). Supported versions, scope for a self-hosted app, reporting channel, response expectations, existing hardening. One contact address needs filling in.
- `doc-rewrites/CONTRIBUTING.md` — new file (DOC-005). Dev loop, the five CI jobs and their prerequisites, where tests live, the two invariants the suite enforces, the docs map, and PR expectations.

Not drafted, deliberately: `ARCHITECTURE.md` (DOC-011 — the content exists in `docs/manual.md` and should be linked, not duplicated by an auditor), a replacement `README.md` (its findings are Minor and are inline rewrites), and any change to `AGENTS.md` (DOC-006 is a product decision about what the repository ships, not a writing task).

## Marketing / honesty audit

`docs/index.html` was audited against the running product. On balance it is one of the more honest landing pages I have read for an AI-assisted product, and the reasons are specific.

**What it gets right:**

- A "Status and limits" section that leads with "Drafts are AI-assisted. Models invent facts… TownReporter does not fact-check for you", and lists seven concrete limitations including "First user is owner. A second account is 403", "PGLite is a demo database", and "City swap is code, not a dropdown". Naming your own missing invite screen on your landing page is unusual.
- "These are screenshots of the running Longmont edition, not mockups" — a claim I could partially corroborate, in that the screens shown match the routes the running build serves.
- Numbers that are sourced rather than asserted: the Opinion timings and costs on the site trace to the three measured runs written up in `docs/setup.md` and `docs/manual.md`, and the local-model comparison traces to `docs/local-models.md` with run counts and medians.
- "Dark Desk has no publish button. That is not a missing feature" — framing a constraint as a design position instead of hiding it.
- The one place it could most easily overclaim, it does not: nowhere does it say the product produces publishable journalism.

**What needs a word changed:**

- The badge "**Zero** trackers — zero outside requests" is true of the reader and untrue of the desk, and the page gives the reader no scope for it (DOC-003). Four words fix it. This is the only claim on the page I would call misleading rather than merely compressible.
- "Claude Code login, or any API key — no key required" reads, on a fast scan of the badge row, as though the product needs no model at all. The Install section clarifies properly. Nit-level.

No unsubstantiated performance stats, no "enterprise-ready", no invented benchmark, no feature listed that I could not find in the product. The gap between what this page promises and what the running build does is the smallest part of this audit.

## Patterns and systemic observations

**Pattern 1 — Release drift lands in the second-tier docs (DOC-001, DOC-002, DOC-008, DOC-010).** Every accuracy finding in this audit is the same shape: 0.5.0 or 0.5.1 changed a behaviour, the README and `docs/manual.md` were updated, and `docs/setup.md`, `SELF-HOSTING.md` or `.env.example` were not. The project has already solved this class of problem for code — the version-lock test pins `package.json` against the masthead, the security test forbids a hand-maintained test list, and the CI comments explain which audit finding each job closes. None of that machinery points at prose. The highest-leverage fix in this report is not any single finding: it is extending `scripts/newsroom-security.test.mjs` with two or three assertions over the docs themselves — that no doc claims `npm test` calls a model, that the provider chain named in `docs/setup.md` matches `resolveProvider()`, that no doc hardcodes a test count. That is a small test file, and it converts the whole category from recurring to impossible.

**Pattern 2 — The docs are strongest where a human is the audience and weakest where a contributor is (DOC-004, DOC-005, DOC-006, DOC-011).** `editor.md` for the journalist is excellent; `manual.md` for the curious reader is excellent. The developer-facing surface — contributing, security disclosure, architecture discoverability, and what the root-level files even are — is the part nobody has written yet. That is a defensible priority for a working newspaper, and it is the gap that will cost most if the project attracts the contributors the MIT license and the "clone it, point it at your city" invitation are asking for.

**Pattern 3 — The code comments are better documentation than some of the docs.** The Exa endpoint comment, the CI job comments, the `scan-pass.test.ts` explanation of why the live call is opt-in, and the `.gitignore` comment explaining the tracked-screenshots exception are all clearer, better-evidenced writing than the paragraphs they are hidden behind. DOC-003 exists precisely because the honest sentence was written in the source file and never made it to a reader. Worth a habit: when a comment explains a user-visible consequence, that sentence belongs in a doc too.

## Appendix: docs reviewed

| Artifact | Read | Notes |
|---|---|---|
| `README.md` | In full | 18,651 bytes |
| `SELF-HOSTING.md` | In full | 8,924 bytes |
| `CHANGELOG.md` | 0.5.1 section in full; remainder sampled | 31,861 bytes |
| `.env.example` | In full | Config reference |
| `docs/setup.md` | In full | 18,293 bytes |
| `docs/manual.md` | In full | 29,422 bytes, Parts 1–6 |
| `docs/editor.md` | In full | 22,702 bytes |
| `docs/dark-desk-editor.md` | In full | 4,879 bytes |
| `docs/local-models.md` | In full | 7,141 bytes |
| `docs/index.html` | Full extracted text | 32,308 bytes, GitHub Pages landing |
| `AGENTS.md` | Opening sections | 18,640 bytes |
| `AGENTS.project.md` | In full | 2,648 bytes |
| `LICENSE`, `package.json`, `.gitignore`, `startup.sh` | In full | Metadata cross-checks |
| `.github/workflows/ci.yml` | In full | Five jobs |
| `src/lib/news/search-web.ts` | Provider chain and Exa section | Evidence for DOC-003 |
| `src/lib/news/scan-pass.test.ts`, `scripts/newsroom-security.test.mjs` | Relevant sections | Evidence for DOC-002 |
| Running build, `http://127.0.0.1:3200` | 16 routes probed; `/about` and `/how-we-report` read as rendered | Evidence for DOC-009 and the route table |
| `npm test` | Executed | 534 tests, 531 pass, 0 fail, 3 skipped, 17.2 s — evidence for DOC-002 and DOC-008 |

*Out of scope by instruction and not touched: `C:\Users\scott\Desktop\Code\townreporter-web`, `https://townreporter.org`.*
