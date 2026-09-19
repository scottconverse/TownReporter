# TownReporter

> The public record is only the beginning.

**Current release: [0.6.55](docs/releases/0.6.55.md).** Published 2026-09-19 on GitHub with the Windows installer asset; the release record separates published source from production-deployment and live-model results. [0.6.50 release guide](docs/releases/0.6.50.md) · [Changelog](CHANGELOG.md).

See [the deployment boundary](SELF-HOSTING.md) before diagnosing the live paper.
Release source, installation checks and deployment evidence are recorded separately in the [release guide](docs/releases/0.6.55.md).

A civic newsroom you run yourself. A public paper on the front, a signed-in editor desk behind it. The working edition watches Longmont, Colorado — meetings, packets, minutes, money, contracts, and the YouTube tapes. Ordinary reporting is reviewed and published by a person; approved sources can produce automatic roundups of library, recreation, community-event, registration, waste-collection and public-meeting notices.

MIT licensed. Clone it. Point it at your city.

---

> **Read this first.** Drafts are AI-assisted. Models invent facts, misattribute quotes, and mangle names — especially from auto-captions. TownReporter checks names and evidence, but those checks do **not** replace editorial verification. Captions are not minutes. Dark Desk never prints. You are solely responsible for everything that appears on the paper. This is not a substitute for professional journalism, not legal advice, and not the city.

---

TownReporter is two rooms:

|                        | What it is                                                         | Who sees it       |
| ---------------------- | ------------------------------------------------------------------ | ----------------- |
| **The paper** (`/`)    | Stories and editorials, plus eligible owner-approved routine notices, with sources shown | Anyone            |
| **The desk** (`/desk`) | Watch list, scan, queue, drafts, notes, Dark Desk, Opinion, Server | Signed-in editors |

There is no fully automated path to the masthead for ordinary reporting; approved sources can produce the bounded notice roundups described above.

It is not the Longmont Times-Call, not the city, and not a replacement for either. It covers the packets most people never sit through, and it shows the exact documents it used.

---

## Manuals

| Audience                                                   | Document                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Everyone — the full manual**, with architecture drawings | [docs/manual.md](docs/manual.md)                                                                |
| Editors — current desk workflow                          | [docs/editor-desk.md](docs/editor-desk.md) |
| Editors, with screenshots and no code                      | [docs/editor.md](docs/editor.md)                                                                |
| Operators (clone, env, Postgres, models, city swap)        | [docs/setup.md](docs/setup.md)                                                                  |
| Add and use a named AI API connection                       | [docs/custom-ai-connections.md](docs/custom-ai-connections.md)                                  |
| Connect a SuperGrok subscription directly                  | [docs/grok-oauth.md](docs/grok-oauth.md)                                                        |
| Dark Desk UI contract                                      | [docs/dark-desk-editor.md](docs/dark-desk-editor.md)                                            |
| Local models, measured on real prompts                     | [docs/local-models.md](docs/local-models.md)                                                    |
| Marketing / GitHub Pages landing                           | [docs/index.html](docs/index.html) · [live page](https://scottconverse.github.io/TownReporter/) |
| **Architecture diagrams** (rendered SVG + Mermaid source) | [docs/diagrams/scan-architecture.md](docs/diagrams/scan-architecture.md)                                          |
| Contributing changes                                       | [CONTRIBUTING.md](CONTRIBUTING.md)                                                              |

GitHub Pages is that landing, not the newsroom. Enable it once: repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The token that pushes this repo cannot flip that switch.

---

## Install on Windows

Download the Windows x64 installer ZIP named `TownReporter-<version>-windows-x64.zip` from the [latest published release](https://github.com/scottconverse/TownReporter/releases/latest); the source-code ZIP is not the installer. If that asset is missing, stop and use a release that provides it. Extract the ZIP and open **Install TownReporter.cmd**. It provisions private Node/PostgreSQL runtimes, persistent storage and Chromium, builds the application, and checks that the correct server answers before directing you to setup. It does not replace an existing database or install Halo's Windows tasks. The 0.6.55 release adds the global 14px informational-text floor that closes a GauntletGate Critical, corrects the release-state documentation and adds its guard, and adds the non-destructive authenticated desk regression with its CI job. The exact v0.6.55 tag, source commit, Windows x64 ZIP name, and SHA-256 are recorded in the release note after publication.

Follow the [Windows installation guide](docs/windows-install.md) for provider setup, your first article, start/stop, data locations and troubleshooting. The target is installation plus a first manual editorial workflow within an hour with working internet; that is a goal, not a measured fresh-machine result, and no fresh-machine human acceptance is documented. Release evidence records only the stated automated installer and package checks and their limits. Public hosting is separate from this local installation.

## Run from source (Windows, macOS or Linux)

You need **Node 22+**. Story drafting uses an existing Codex or Claude login,
or a configured `LLM_BASE_URL` gateway; API keys are optional, but going without one relies on a
signed-in Codex (ChatGPT) or Claude Code (Claude Pro/Max) subscription. Scan
and Dark Desk still use the configured provider. See [Model](#model--automatic-ladder-with-an-editor-override) below.

```bash
node -v                           # must print v22 or newer
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium   # meeting transcripts + JS civic sites
cp .env.example .env              # choose local, CLI login, or optional API settings
                                   # no DATABASE_URL: runs on an embedded database, lost when npm run dev stops; set DATABASE_URL to keep it
npm run dev                       # http://localhost:8080
```

Open [http://localhost:8080/login](http://localhost:8080/login) and **create an editor account** (email + password). The first account becomes the newsroom owner — there is no setup token. TownReporter then opens **Set up the paper**: enter the paper name, city, state, timezone, contact details, starting watch list, meeting-video channels and meeting-title keywords. Nothing is published before that setup is saved. The account and paper settings live in your database, and sign-in is limited to ten attempts every five minutes per address.

The public paper is `/`. The desk is `/desk`; first-run setup is `/desk/setup`, and the owner can revise it later under **Server → Paper identity** (**Paper setup** panel).

Full operator notes — Postgres, Vercel, other models, pointing it at another city — are in [docs/setup.md](docs/setup.md). How to run the desk is in [docs/editor.md](docs/editor.md).

---

## How it works

Same six moves the paper itself describes at `/how-we-report`:

1. **Watch.** A list of civic sources: city site, council, planning, agenda portal, school district, utility and meeting-video channels. The Longmont edition ships with a working list; every new installation chooses its own.
2. **Detect.** A scan fetches those pages, hashes them against the last snapshot, and flags what changed, what disappeared, and what failed to appear when it usually does.
3. **Follow.** Before a story is drafted, the desk asks what the announcing source leaves unexplained, then follows attachments, names, contracts, parcels, prior meetings.
4. **Preserve.** Significant captures are stored. If a record later vanishes, the captured version remains, and the article says so.
5. **Investigate.** Dark Desk is the recursive lane: competing hypotheses, unresolved identities, trails that were exhausted until new evidence reopened them. **It does not print.**
6. **Write, then gate.** Drafts are reported stories, not recaps. Ordinary reporting is held, killed or published by a person; approved routine notices use fixed templates and approved sources. Every material claim should be checkable against a document we show.

Corrections are public (`/corrections`). We would rather look careful than look first.

### Recent releases

- **0.6.51** — Adds per-runtime effort controls; named/Automatic first-choice routing that retries only a technically failed unfinished call and records requested/actual model and effort; terminal content refusals; Codex-first unattended order with Claude Sonnet last and no automatic Opus; migration of blank-model saved Gemini connections without replacing their key; Grok connection repair; editable daily-scan time/model/effort/source settings; Queue batch Redraft; and clearer retained-job health history. Direct Story/Opinion documents can retain and read all extracted PDF pages within their 20-million-character text limit. Generic capture and Dark Desk image-PDF OCR now offer **Read entire PDF**, which checkpoints bounded 12-page calls and resumes with only unread pages after interruption or a budget pause. The source repair prevents the prior Windows installer shutdown path from trying to kill a system child such as `csrss`; a root that has already crashed can still leave detached children because their ownership cannot be proved safely. See [the release guide](docs/releases/0.6.51.md) for evidence boundaries; it does not assert GitHub publication, production deployment, or live-model proof.

- **0.6.54** — Adds editor control over what a scan reads and honest reporting of what it did. A scan now takes three scopes: **General** (every accepted source), **Section** (one reporting beat), and **Custom** (an exact picked set, with search and kind/tier filters; unselected sources are never fetched). Named **source packs** save a reusable accepted set per beat without changing section setup. Every run records **selected, attempted, fetched, failed, and analysed** sources, the analysis **batches used and failed**, and the **failed sources by name**; a clean zero-lead success, a provider failure, and a partial scan render differently. Large scans are split into **bounded batches** instead of a single 48,000-character pass that silently dropped every source past the budget, so a 100-source scan is no longer truncated, one failed batch keeps its siblings' leads, and leads are de-duplicated across batches with source attribution preserved (resume-from-checkpoint is **not** in this release). Scan history now returns a **true total** and pages with real offsets, fixing a defect where history could never advance past row 50; **Show more** appends older runs and disappears when exhausted. Sections gain per-section accepted-source counts, a zero-source warning, and manual bulk assignment. Two additive migrations: `0065_scan_coverage_accounting.sql` and `0066_scan_source_packs.sql`. See [the release guide](docs/releases/0.6.54.md) for evidence boundaries; it does not assert production deployment or live-model proof.

- **0.6.53** — Patch line carrying the release-coherence work, the transaction-scoped advisory-lock turnover fix for routine-notice policy bootstrap, and the startup sweep that reattaches durable jobs (queued jobs become claimable; running extraction resumes from its checkpoint without rereading; stale running rows are adopted or requeued honestly, never terminated by PID signaling). See [the release guide](docs/releases/0.6.53.md).

- **0.6.52** — Repairs the `/desk` boundary so the public-home entry performs a fresh document load (the reported defect: the URL changed to `/desk` while the public homepage stayed mounted), extends that to the footer, masthead and error-page desk links with browser guards, preserves failed provider logins as immutable history with a distinct resolution row, and adds the bounded document-extraction retry that checkpoints pages so a later batch failure cannot discard earlier work. See [the release guide](docs/releases/0.6.52.md).

- **0.6.50** — Correctly identifies Ollama Cloud models, shows their reported context window, and prevents DeepSeek V4 reasoning from consuming the Story output budget before a draft is written.
- **0.6.49** — Restores bounded Dark Desk lead development and durable reporting Pull, adds direct SuperGrok OAuth and newsroom-managed Gemini connections to the shared model picker, keeps Story model controls reachable, and lets Automatic recover uploaded-document work when a provider reaches its limit or becomes unavailable.
- **0.6.48** — Connects discovered local models to Story drafting, makes evidence-check progress and results visible, verifies names from retained written records, selectively repairs missing citations, and distinguishes the writer checkpoint from the final checked draft.
- **0.6.47** — Keeps a labeled Editor’s desk button in the public header on desktop and phones.
- **0.6.46** — Implements the approved public-reader design, full archive search and pagination, browser-local saved stories, dark mode and text sizes, sharing, and a correction email form. See the [reader guide](docs/reader.md).
- **0.6.45** — Corrects the remaining Claude-only Opinion comment in the downloadable configuration template. Runtime behavior is unchanged from 0.6.44.

- **0.6.44** — Packages the Astra desk, shared large-document and URL intake, private-document evidence checks, supported name corrections, saved Opinion material, Sol default and native voice-file integration for both subscription writers. See [the 0.6.48 release guide](docs/releases/0.6.48.md).

- **0.6.35 beta** — Editor delivery includes the story evidence-check workbench, Stats reports, named custom AI connections, draft recovery and reconciliation, PDF/page-aware evidence, ownership-preserving research and queue improvements, and retained routine-notice editor controls. Published and deployed to Halo at `6f603ec`; the PDF/page-aware OCR and Dark Desk work retain the bounded acceptance limits described below.
- **0.6.34 beta** — Dark Desk selects relevant captured records across the full inventory before shared selection builds separately bounded inputs for stage-one signal synthesis and the final brief. The release receipt records runtime proof and its limits.
- **0.6.33 beta** — Packaged installations can start the native Codex CLI from their extracted, non-Git application directory. See the release receipt for native and application verification.
- **0.6.32 beta** — Evidence review groups duplicate views of the same available captured version while retaining its artifact and capture-event identities, uses singular claim counts, distinguishes editor-selected records from draft citations, and simplifies current-beta release links.
- **0.6.31 beta** — An optional Queue focus for up to 3–5 existing eligible leads, with the full queue retained. The owner-approved six-format routine publication path, claim/manual corroboration, and routine automation/roundups are included. Routine automation runs on a daily schedule rather than continuous source watching; an approved source change can be corrected by a same-day rerun.

- **0.6.30** — Editor-selected draft batches, mandatory review before saving section changes, and owner-controlled preparation for exact routine-notice source/format pairs. Pure routine-notice contracts and saved-data adapters remain unverified inputs; this release does not enable automatic publication.

- **0.6.29** — Owner-configured daily discovery with an explicit subscription/local runtime; private recorded-finding evidence review; stronger draft saving and job recovery. Scheduled scans file leads for review and do not draft or publish.

- **0.6.28** — Corrections stay within the editor's newsroom; Reddit requests preserve the eight-second elapsed-time floor across clock and transport-setup changes.
- **0.6.27** — Windows installation package, installation-owned maintenance and build/readiness checks, supplied-material drafting and evidence review, and the page-watch trailing-slash correction.
- **0.6.26** — owner-only legal removal with retention, expiry, copy-scope refusals and an external-backup trail; saved investigative search windows and verification limits with honest full-denominator summaries.

- **0.6.25** — owner-configurable newspaper sections, section-specific scanning instructions and source assignments, and manual Dark Desk page watching with dated captures, honest failure states and explicit handoffs to a file or unverified lead.

- **0.6.24** — corrective release: failed adversarial searches stay unverified, verification reads returned evidence and context, guarded HTTP fetches enforce size/type limits, OCR page images reach the selected provider, and takeover documentation separates repository releases from deployment receipts.

- **0.6.23** — two-stage Dark Desk with structured adversarial checks, broader community Reddit discovery, bounded scanned-PDF OCR, llama.cpp discovery, county setting and Opinion copy controls. These are implemented capabilities, not a certification of investigative conclusions.

Current development status and remaining features: [TODO.md](TODO.md). Remote takeover and deployment evidence: [HANDOFF-NEXT-AGENT.md](HANDOFF-NEXT-AGENT.md).

- **0.6.22** — the story page aligned to the redesign: a 380px column for the lead, its sources and the reporting notes, the draft on the right, one column below 1024px, no overflow at any width; the local model row under the picker reads as a plain second row.
- **0.6.21** — the redesigned Command Center (direction A): the queue is the lead column, Dark Desk, Follow-ups and the wire sit in a right rail, queue rows breathe, and the desk lays out cleanly from 1440 down to a phone. New: Follow-ups — who you asked, for what, and when it is due.
- **0.6.20** — desk readability release from the design audit: nothing informational under 14px, Large text now scales headlines and reading panes, one button family, destructive buttons look destructive, Held and set-aside leads have their own chips.
- **0.6.19** — the desk in dark mode is white text on black; local models are found automatically (LM Studio, Ollama) and picked per model in every picker; a claims-of-absence gate stops a story from saying something does not exist until the paper has searched the city's own site and the editor has confirmed; Check r/longmont shows its progress and every scored post.
- **0.6.18** — bug-fix release: interrupted drafts show one honest "recovering" state; promote refuses to restart under a running job; Dark Desk monitors record the real newsroom; the ≈ PRINTED chip names and links the story it matched; About page and fresh-install welcome say non-profit; subreddit/user/search pages fetch via real .rss feeds.
- **0.6.17** — Reddit fetching is now strictly one-at-a-time and paced, shared across the tip scan and digs, fixing a concurrency bug that could trigger rate limits; redd.it short links now resolve.
- **0.6.16** — Dark Desk actions now confirm clearly: "Send to the queue" shows where the lead went and links to it; every action gives visible feedback.
- **0.6.15** — Dark Desk actually gathers evidence now: the dig runs tool-free (it proposes, the app fetches), captures the real article instead of the nav menu, dedupes leads, caps dead ends, fetches reddit reliably, and the page honestly shows readable-vs-blocked.
- **0.6.14** — the desk now has a Stats tab: anonymous site and per-story view counts, recorded by a fail-safe beacon that never touches page rendering.
- **0.6.13** — audit-fix & hardening release: Opinion local-model routing fixed, failover regression-tested, Dark Desk investigation newsroom-scoped, test/ops tools no longer point at production, and the public page can't white-screen on an identity-load hiccup.
- **0.6.12** — cancelling a stale sign-in can no longer kill an unrelated process; the Scan and Sources screens now have CI browser coverage.
- **0.6.11** — data-integrity hardening: every newsroom-scoped write now records its newsroom, the Dark Desk rebuild path and the migration/ensure lists agree, guarded by new tests. Groundwork for multiple newsrooms and reader/user accounts.
- **0.6.10** — a local model (llama.cpp / LM Studio / any OpenAI-compatible server) is now a named writing model you can pick anywhere the desk uses AI, with its own longer timeouts.
- **0.6.9** — removed a reader-tracking-privacy positioning that was never part of the product's goals; the public page still loads nothing from outside, described plainly.
- **0.6.8** — the desk now shows why a draft switched writing models, and the Automatic picker says it moves on a timeout too.
- **0.6.7** — Automatic now falls back to the next writing model when a draft times out, not only when a sign-in has lapsed.
- **0.6.6** — every CI browser walk except the documented dev-path walk now runs against the built server (`npm start`), ending the cold-dev-server flakiness.
- **0.6.5** — write a story from a URL, text, or an idea in one box on the Desk; hand-filed leads sort to the top; Dark Desk no longer crashes on a long prompt.
- **0.6.4** — gate fixes: ops actions are owner-only on the server; the duplicate matcher requires a shared subject word; Time per call rejects non-numbers.
- **0.6.3** — ops hotfix: the paper's start and watchdog no longer mistake another program's IPv6-only listener on port 3000 for the paper itself.
- **0.6.2** — one provider registry with editable time budgets; Dark Desk picks its model; the desk is readable in dark mode with a Text size control; killed leads match reworded repeats; nightly live proof.
- **0.6.1** — Scan gets the model picker and a real time budget; killed leads are stamped "seen again" instead of refiled; the Server page explains itself; staging before every promote.
- **0.6.0** — sign in to Claude Code and Codex from the Server page; dev server local-only by default.
- **0.5.12** — doc and health-tile polish from the first public read: no more hardcoded version in the unreleased-features notice, an honest note on what "no API key" relies on, and the Server page no longer calls the embedded database "postgres".
- **0.5.11** — Automatic fails over to the next model once, mid-run, if the first one's login has lapsed.
- **0.5.10** — an expired Claude Code login is reported as "sign in again", never "click again".
- **0.5.9** — Claude and Codex only: Zen MiMo and Local Qwen removed from the Story picker and the Automatic ladder.
- **0.5.8** — Automatic drafts with your own signed-in Claude first, not a free rate-limited endpoint.
- **0.5.7** — the editor picks the writing model per run, Codex drafts stories natively, Opinion is Claude only; the AI is finally told which city it works in.
- **0.5.6** — set up a paper for any city with zero file edits; before setup, a fresh install claims to be nobody instead of Longmont.
- **0.5.5** — a deploy can no longer be interrupted by the watchdog mid-build; stale tabs heal themselves; keyboard focus is visible in both themes.

- **0.5.4** — two editors racing on one story is now a tested property: delete-under-edit, double-save, and double-publish all end sanely, proven in CI with two real browser sessions.

- **0.5.3** — a second editor can join by invite: a one-time, single-address link minted on the Server page. No more sharing the owner login.

- **0.5.2** — the workbench's Pull button drops the passage that answers the pulled line, readable paragraphs intact, instead of a page-top wall of navigation.

#### 0.5.1

- **The newsroom watches itself.** The paper was offline for hours and nothing said so. A watchdog now checks the app, the tunnel and the public URL every five minutes and restarts what is down. A [Server page](docs/manual.md#the-server-page) shows all of it.
- **Fonts are self-hosted, and the reader's page stays self-contained.** A third-party script was removed from every page, and a cold load of the paper makes zero outside requests.
- **Stories are shareable.** Per-story titles, descriptions, canonical URLs and social cards — they all used to share one blurb. Plus a sitemap.
- **An Opinion desk.** A subject, pasted source text, uploaded documents or a URL becomes an unsigned editorial: OPINION in the headline, no byline, receipts in an appendix at the end. The writer fetches its own records first, so it takes ten to forty minutes.
- **Dark Desk has two dials.** _Dig_ — how far it chases. _Nerve_ — how speculative it may be. The panel says in plain words what the current setting will do.
- **Dark Desk's planner had never run.** Its budget was 45 seconds against a call that needs 150, and every failure fell back to keyword matching in silence. The database held zero entities, claims or hypotheses.
- **Confidence is capped by the label in code**, not requested in a prompt, and a FACT with no citation is downgraded.
- **Reddit is a tip line** — one unambiguous accepted subreddit source enables the paced check. RSS discovers candidates; an optional local Redlib reads selected original posts in full and reports its coverage, while RSS remains the fallback. Posts are filed as unverified tips, never as reporting; a new town does not silently inherit r/longmont.
- **Search works.** Exa runs first, and a PULL no longer answers a Longmont question with three California school-district PDFs.
- **Nothing scrolls sideways.** The navigation rails wrap.

Full detail is in [CHANGELOG.md](CHANGELOG.md).

### Earlier (0.5.0)

- **Self-hosted.** Builds to a plain Node server instead of Vercel. A long-lived process means the Chromium page reader works and background jobs are not chopped into pieces. `NITRO_PRESET=vercel` still builds for Vercel.
- **Runs on your Claude Code login.** No API key. The desk shells out to the local CLI, with the coding harness stripped — including your own `CLAUDE.md` and skills, which have no business in a news prompt. An API key or a local OpenAI-compatible gateway still win if set.
- **Jobs no longer run twice.** Nothing refreshed the liveness stamp mid-run, so any job past the two-minute stale line was re-claimed and run alongside the original — duplicate drafts, double spend.
- **SSRF is closed at connect time.** The old guard resolved DNS and then let the request resolve again. The address approved is now the address connected to.
- **The queue puts the best lead first.** Ordering on the timestamp alone buried a 14-point story under an 8-point one.
- **One click drafts.** A stale failure used to cancel the new draft the instant it started.
- **The feed works in a reader.** Absolute links, escaped titles. A `]]>` in a headline used to break the whole feed.
- **Runs on Windows at all.** `npm run dev` and `npm run build` both failed, every route 500'd on a self-hosted build, and 170 tests had never run.

Full detail, including the newsletter and rate-limiter fixes, is in [CHANGELOG.md](CHANGELOG.md). Setup for your own machine: [SELF-HOSTING.md](SELF-HOSTING.md).

### Earlier still (0.4.x)

- **URL history, watches, and names belong to the newsroom.** A later editor reuses the captured page, the watch list, and the name graph. Who clicked is still stored.
- **Quotes have to be in the document.** `resolved` means the captured text contains the evidence.
- **Mapped IPv6 loopback is blocked.** `http://[::ffff:7f00:1]/` is 127.0.0.1.
- **Dark hops belong to the file.** A later editor continues the same trail.
- **Jobs wake up.** Scan / Draft / Keep digging persist, then finish in this process or on the monitors ping (`CRON_SECRET`).
- **Historical OCR behavior (0.4.x).** Image-only PDFs were unread. Since 0.6.23, supported embedded JPEG/PNG scan images can be transcribed by a vision-capable provider; unsupported formats and partial reads remain explicit.

> **Captured-PDF OCR.** Initial scanned-PDF ingestion renders up to 12 ordered PDF pages, with a 2 MiB rendered-image cap and a cooperative 10-minute render-and-OCR budget. New records can retain numeric page citations; legacy extracted-image records remain explicitly unordered. In Dark Desk, **Read entire PDF** continues through bounded 12-page calls, saves every completed batch, and resumes with only unread pages after interruption. One click pauses after 10 minutes or 48 transcription attempts, preserves its checkpoints, and names the unread pages for the next click. Built-runtime rendering is proven with mock transcription. The earlier source-path Codex/Terra ingestion run read 11 of 44 pages from a scanned council packet; that historical run did not prove the new whole-packet workflow or packet-quality acceptance.

The retained-PDF reader lets an editor open a captured PDF in Dark Desk, choose
an explicit model, read the complete retained file in resumable batches, or
request any 1-based inclusive range of up to 12 pages. The reader adds page-numbered evidence beside
the unchanged original; it does not refetch a missing PDF. See
[Read retained PDF pages](docs/pdf-page-reading.md). A bounded built-UI proof
read real page 13 of a 44-page PDF and preserved the 16,254,338-byte original
and its hash. The main table rows and key dates matched, but color-only RAG
status was omitted and a minor verb differed; this is not full-packet or
table-perfect acceptance, and the editor must compare the transcript with the
original.

Also in 0.3.3–0.3.8: Mountain Time masthead, overlapping printed headlines collapse, Draft with AI paints without a reload, Redraft survives the cookie glitch, Start digging keeps the card on a failed open.

### Meetings, tapes, packets

- **PrimeGov** (`longmont.primegov.com`) is a watched official source. The catalog comes from the public JSON API (upcoming + archived), not a headless crawl of the JS app. Agenda / packet / minutes PDFs are separate records. YouTube titles join the matching meeting.
- **YouTube.** The city channel is a catalog. Full timestamped transcripts live on each watch URL (Playwright opens **Show transcript** — not a 12k slice). Upcoming livestreams stay listed with no fake transcript and are rechecked. `@LongmontPublicMedia` is the second tape; same-meeting titles are merged.
- **Captions are a map, not minutes.** Names may be wrong. Quotes need a check against the packet. Minutes not posted after 36 hours is a catalog note, not a story.

---

## Point it at another city

No code edit or rebuild is required. The owner fills out **Set up the paper** after creating the first account:

1. Paper name, tagline, city, state, IANA timezone, optional council-votes link and editor contact.
2. A starting watch list: city site, council, agenda portal, school district, utility and other reporting sources.
3. Optional YouTube meeting channels, one URL per line, plus the title phrases that identify meetings on those channels.

The same form stays available under **Server → Paper identity** (**Paper setup** panel). Saving it changes the public masthead, city copy, local clock, contact links, watch list and meeting-video discovery. A blank optional field means none; it never borrows another town's value. Before setup, the public site shows a neutral “not yet set up” page and no articles.

If the city uses PrimeGov, put its public portal URL in the watch list. The ingest already speaks that API.

Details and the honest limits of a city swap are in [docs/setup.md](docs/setup.md#point-it-at-another-city).

---

## Model — automatic ladder, with an editor override

**Set up a writing model**, beneath each Queue, workbench and Opinion picker,
opens installation, sign-in and retry guidance. Setup belongs on the computer
and Windows account running TownReporter; Opinion also explains its voice-file
prerequisite. The desk does not install software or sign you in automatically.

Every active Queue row has its own **Writing model** picker beside **Draft with
AI**; the story workbench has the same control beside Draft or Redraft. The
default is **Automatic**. If `LLM_BASE_URL` or the `LLM_API_KEY` + `LLM_MODEL`
pair names a gateway, Automatic records that gateway as the preferred first runtime.
Otherwise it tries Codex Terra, then Claude Sonnet, chooses the first ready
provider before enqueueing, and stores that effective choice on the job. A
named model is also the recorded first choice. If that model reaches a usage
limit, becomes unavailable, loses its login, times out, or returns no output,
TownReporter can move only the unfinished model call to the next ready runtime
and records the requested and actual model and effort. Earlier calls in that
active run are not repeated. A later restarted job retains uploaded source
material but may read it again. A content refusal stops the run. Unattended
ladders put Claude last and use Sonnet; Opus is available
only when an editor selects it.

The Queue also offers **Draft selected** for one editor-chosen batch of up to
five eligible leads. That batch requires one named Codex, Claude, Grok
(SuperGrok), Local model, or saved Custom AI connection, including a configured
Gemini endpoint. It never uses Automatic. It retains each lead's saved research
scope, shows each lead's durable result and workbench link, and never publishes
a story. Technical provider failures can move the unfinished call to the next
ready cloud runtime; a provider refusal remains terminal.

Daily Scan uses the same named choices, including Grok (SuperGrok) and saved
Custom AI connections. It stores the requested model with the schedule and the
runtime actually used on each job. Technical preflight or mid-call failures can
move unfinished work to the next ready cloud runtime and are recorded; a
provider refusal stops the run. For image OCR, the same technical-only rule
applies and only vision-capable candidates are considered.

Pick Codex Astra, Sol, Terra or Luna; Claude Fable, Opus, Sonnet or Haiku;
**Grok (SuperGrok)** through the newsroom's direct OAuth connection; or
**Local model** as the preferred provider for one run. A named choice remains
the first choice; only a recognized technical failure can move the unfinished
call. The endpoint/model compatibility overrides are
listed in [docs/setup.md](docs/setup.md#per-run-picker).

Local model supports individual models discovered on LM Studio, Ollama and
llama.cpp, or a configured `LLM_BASE_URL` with `LLM_MODEL` and optional
`LLM_API_KEY`. It has its own longer, editable timeouts. See [docs/local-models.md](docs/local-models.md).

Codex and Claude use the operator's existing signed-in CLI/OAuth sessions; no
API key is required. Readiness is checked before enqueueing. If a login expires,
the desk refuses and tells the editor which app to open and sign in to.
`CODEX_CLI_PATH`, `CODEX_HOME`, and `CLAUDE_CLI_PATH` are available when normal
discovery cannot find the binary or Codex state directory.
Codex runs with the signed-in Windows user's native configuration and full
available machine capabilities. TownReporter does not disable its search,
shell/file access, browser/computer tools, apps, plugins, hooks, skills,
multi-agent features, user rules, or repository instructions, and it does not
replace them with a read-only sandbox. That includes every path on `C:\` the
signed-in account can access. The requested newsroom job still comes from the
prompt; available capability is not permission to perform an unrelated action.

Claude Code remains the separate CLI path: its own `CLAUDE.md`, skills and
plugins are not loaded into news prompts because that adapter passes
`--setting-sources ""`.

For **Automatic**, a configured gateway is tried first; named choices in Story, Scan and Dark Desk become the recorded first runtime instead of this low-level configured-provider chain:

| Set this                                        | What runs                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint; Story Automatic tries this gateway first    |
| `ANTHROPIC_API_KEY`                             | credentials for selected Claude models or the final Sonnet retry            |
| _nothing_                                       | signed-in Codex first; signed-in Claude Sonnet is the last unattended rung  |
| `XAI_API_KEY`                                   | Grok                                                                        |

The CLI is slower than an API — it reloads a fixed preamble per call, so a draft takes minutes rather than seconds. Time budgets adjust on their own.

**Opinion offers the native providers and local model.** The picker offers
Automatic, Codex Astra, Sol, Terra and Luna, Claude Fable, Opus, Sonnet and
Haiku, Local model, and saved custom connections. Codex Sol is selected by
default. Automatic tries Codex Sol first and moves to Claude Sonnet once if
Codex is unavailable. An explicit choice remains the recorded first choice;
a recognized technical failure can move only the unfinished call. The writer
reads the configured private voice file, and a provider refusal or invalid
delivery leaves the request failed without a draft.

### Other models — one OpenAI-compatible URL

TownReporter talks `/v1/chat/completions`. Any of these work by changing three env vars. **No extra npm package.**

| Gateway                                                                         | Example `LLM_BASE_URL`                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [LiteLLM](https://github.com/BerriAI/litellm)                                   | `http://127.0.0.1:4000/v1`                                                         |
| [Bifrost](https://github.com/maximhq/bifrost)                                   | `http://127.0.0.1:4000/v1` (do **not** bind Bifrost to 8080 — that’s TownReporter) |
| [Helicone](https://github.com/Helicone/helicone)                                | `https://oai.helicone.ai/v1` or your self-hosted worker                            |
| [MLflow AI Gateway](https://mlflow.org/docs/latest/llms/deployments/index.html) | `http://127.0.0.1:5000/v1`                                                         |
| [Kong AI Gateway](https://docs.konghq.com/gateway/latest/ai-gateway/)           | `http://127.0.0.1:8000/v1`                                                         |
| Ollama                                                                          | `http://127.0.0.1:11434/v1`                                                        |
| OpenAI / OpenRouter                                                             | their `/v1`                                                                        |

```
LLM_BASE_URL=http://127.0.0.1:4000/v1
LLM_API_KEY=sk-...
LLM_MODEL=claude-sonnet-4-5
```

If `LLM_BASE_URL` is set — or `LLM_API_KEY` and `LLM_MODEL` are both set —
that configured gateway wins over Grok for configured-provider features and is
Story Automatic's preferred first runtime. Recognized technical failure can
move only the unfinished call; a content refusal remains terminal.

For a per-run, editor-selected endpoint instead of changing the configured
provider, use **Server → Add your own AI API**. Save a name, base URL, optional
server-side key and either a discovered or manually entered model, then use
**Test connection** before selecting it in Scan, Story, Opinion or Dark Desk.
Disable, edit or delete saved connections from the same panel. This is an
explicit opt-in and does not change Automatic or fallback defaults. See the
[connection guide](docs/custom-ai-connections.md).

---

## Database

Unset `DATABASE_URL` → embedded PGLite. **Data dies when the process stops.** Fine for a look; not a newsroom.

Postgres (Neon, RDS, your box):

```
DATABASE_URL=postgres://user:pass@host:5432/townreporter
```

---

## Sign-in

- **Self-host:** first visit, **Create editor** on the paper (top right). After that the button is gone and the first account owns the desk — there is no setup token, removed in 0.5.1. **Give up the desk**, at the bottom of the Server page, hands the newsroom to the next person who signs in; it asks you to type your email address, because there is no way back.
- **This grok.me preview:** Google / X via Grok’s broker (those buttons only show on `*.grok.me`).
- Local with no login at all: `VITE_AUTH_ENABLED=false`. Do not do that on a public host.

---

## Playwright

`npx playwright install chromium` once. Without it, city YouTube **Show transcript** and JS-heavy civic sites (Municode, and PrimeGov if the API moves) will not render. PrimeGov packets still work — they are a JSON API + PDFs.

---

## Layout

| Path                                         | What                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/`                                          | Public paper                                                                                                              |
| `/?topic=opinion`                            | Editorials — unsigned, the paper's own position. The Opinion link in the masthead; the same route as the paper, filtered. |
| `/about` · `/how-we-report` · `/corrections` | Masthead pages                                                                                                            |
| `/sitemap.xml` · `/robots.txt`               | For search engines                                                                                                        |
| `/evidence/:versionId`                       | The captured copy of a source a printed story cited                                                                       |
| `/evidence/compare`                          | Two captures of the same URL, side by side                                                                                |
| `/get-the-code` · `/TownReporter.zip`        | Download this newsroom's own source                                                                                       |
| `/desk`                                      | Editor home (sign-in)                                                                                                     |
| `/desk/sources`                              | Watch list + bulk paste                                                                                                   |
| `/desk/scan`                                 | Fetch + leads. The expensive button. Not a loop.                                                                          |
| `/desk/queue`                                | Draft / hold / publish                                                                                                    |
| `/desk/story/:id`                            | Workbench: draft, reporting notes, research memo, publish                                                                 |
| `/desk/published`                            | Live stories + public corrections                                                                                         |
| `/desk/dark`                                 | Dark Desk. Investigates. Never prints. Two dials.                                                                         |
| `/desk/opinion`                              | Opinion. Writes an unsigned editorial.                                                                                    |
| `/desk/ops`                                  | Server. Health, and the few buttons worth having.                                                                         |
| `/feed`                                      | RSS                                                                                                                       |
| `/login`                                     | Create account / sign in                                                                                                  |

`AGENTS.md`, `AGENTS.project.md`, and `.grok/` at the repo root are not
TownReporter documentation — they are the build-tool contract and personal
handoff notes from the App Builder sandbox this repo was originally
scaffolded with. Some of it (`.grok/app-env.json`, read by
`scripts/with-app-env.mjs`) is still load-bearing for `npm run dev`/`build`;
the rest is inert. If you are here to understand the newspaper, start at the
top of this file, not there.

---

## Owner-only legal removal

Published stories have a separate [legal-removal workflow](docs/editor.md#legal-removal-owner-workflow): review connected and historical copies, choose 12-calendar-month owner-only retention or an explicit no-retention destruction policy, and follow the result to an audited case. Known shared captured copies block destruction. Backup cleanup remains an operator task with attributed attestations; retained copies have owner access controls, not encryption. Ordinary Delete remains 30-day trash. Release and deployment status are tracked in [TODO.md](TODO.md).

## Frequently asked questions

**Is this a newspaper?**
It is a newsroom you run. Ordinary stories that print have a human gate; approved routine notices can use the notice-roundup path described above. It is not a newspaper of record, not the city, and not a wire service. Treat every draft as a first draft you still have to report.

**Will it publish by itself?**
Ordinary reporting does not: scans file leads, drafts go to the workbench, and a person reviews and publishes them. Only the six owner-approved routine formats can publish automatically, after their source, eligibility, freshness, conflict, review-history and idempotency checks pass.

**Can I use this for any city?**
Yes. The first owner completes **Set up the paper**, and can revise the same database-backed settings later on the Server page. No source edit or rebuild is required. See [docs/setup.md](docs/setup.md#point-it-at-another-city).

**Do I have to pay for an AI key?**
No. Story drafting can use a signed-in Codex/Claude CLI, or a configured
`LLM_BASE_URL` gateway to a model on your own hardware. Set `ANTHROPIC_API_KEY` if you would rather bill a
Claude key, or point `LLM_BASE_URL` at an OpenAI-compatible endpoint. That
configured gateway becomes Story Automatic's preferred first runtime and remains
the configured first runtime for Scan and Dark Desk. Recognized technical
failures can move only the unfinished call; refusals stop. `XAI_API_KEY` still runs Grok for
configured-provider features.

**Are YouTube captions the official record?**
No. Captions are a map of the tape. Minutes and the packet are the official record. Names in captions are often wrong. Dark Desk is told this; drafts still need a human check.

**What’s Dark Desk?**
The investigative lane. An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Remaining pages stay on the file. It has no publish button. Editor UI: [docs/dark-desk-editor.md](docs/dark-desk-editor.md) and [docs/editor.md](docs/editor.md#dark-desk-deskdark).

**What's the Opinion desk?**
Give it a subject, a sentence, or a URL and it asks the selected provider for an unsigned editorial — OPINION in the headline, no byline, because an unsigned editorial is the paper's own position. Claims and sources run in an appendix at the end. It is a draft until you publish it. If a provider declines or returns an assistant message instead of a real piece, the run is marked Failed and no draft, Read/Edit action, or Publish button is created. The writing voice is a file on disk that you point at with `TOWNREPORTER_VOICE_FILE`; it is not in this repository, and only its path ever reaches a command line.

**Does anything leave my machine when I use the desk?**
Yes, and it is worth knowing which things. Reading the paper sends nothing
anywhere: fonts are served from this machine, there is no analytics script, and
a cold load makes zero requests to any outside host — the browser-based
`npm run smoke` check enforces this. That only covers the reader. Working the
desk is different: pages you watch and documents you pull are fetched from the
sites that host them; Scan and Dark Desk model calls go to the configured
provider; Story calls go to the effective provider stored for that run (which
may be Codex, Claude, or a configured gateway); and searches — the research pass,
PULL, and every Dark Desk hop — go to a third-party search chain, tried in
order: Exa's hosted endpoint (`https://mcp.exa.ai/mcp`), then DuckDuckGo, Bing,
Brave and Wikipedia. None needs an API key, and there is no setting to keep a
search on this machine — the chain runs unconditionally
(`src/lib/news/search-web.ts`). That means a name, an LLC, or a contract number
you type into Dark Desk is seen by whichever provider answers it.

**What are the Dark Desk dials?**
_Dig_ is how far it chases — hops, searches, whether it leaves the watch list. _Nerve_ is how speculative it may be — how sure it has to be before it writes a signal down, and whether it may propose a theory or only ask a question. Three floors never move at any setting: no invented claims of paid influence, everything is labelled, and every theory carries what would kill it.

**Can two people edit?**
The first signed-in user is owner. Under **Server → Invite an editor**, the owner enters an email and copies a one-time link. It expires in seven days, works only for that address, and creates an editor seat without sharing the owner login. See [docs/setup.md](docs/setup.md#a-second-editor).

**What does a run cost?**
Scan, draft, and Dark Desk each call the model. A Longmont-sized scan is the expensive click; drafting one story is cheaper; a Dark Desk round can include planning, synthesis and several verification calls. Set a spending limit on the provider. Exact dollars depend on the model you point at.

**Does GitHub Pages run the newsroom?**
No. [docs/index.html](docs/index.html) is a static landing page. The app is Node. Clone it, or deploy to a host that can run Node 22, Playwright Chromium, and Postgres.

---

## Tests

```bash
npm test
```

Deterministic, offline and free by default — no provider is contacted and nothing is billed. The test launcher removes any inherited `DATABASE_URL` and `RUN_LIVE_MODEL_TESTS` before the suite starts, so destructive fixture cleanup can only reach embedded PGLite or a disposable database a test creates itself, and a stale shell flag cannot turn an ordinary run into a paid evaluation. The live model evaluation is separate and opt-in (`RUN_LIVE_MODEL_TESTS=1 npm run test:live-model`), because a default suite that calls a paid API is neither reproducible nor free. Meeting ingest, retrieval, draft stripping, configured-timezone dates, printed-headline collapse, version lock, auth, paper setup, and Dark Desk loop coverage live in `src/lib/news/*.test.ts`.

---

## License

[MIT](LICENSE). Copyright (c) 2026 Scott Converse.

Created by **Scott Converse**. Companion civic tools: [civic-transparency-toolkit](https://github.com/scottconverse/civic-transparency-toolkit), [civic-newsroom](https://github.com/scottconverse/civic-newsroom).

## Current Opinion document and review workflow

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion defaults to Codex Sol; Automatic tries Codex Sol, then Claude Sonnet. Both subscription writers read the complete configured voice using native instruction-file options and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and blocked from publication until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](docs/editor-desk.md) for the complete editor flow.

Dark Desk uses a separate cost-aware Automatic path: a configured gateway wins;
otherwise Codex Terra synthesizes and Claude Sonnet is the one eligible retry.
Claude Haiku plans Claude runs and Codex Luna plans Astra/Luna runs. Research is
checkpointed before synthesis, so a synthesis retry does not repeat completed
searches or document reads. Each round enforces one wall-time, model-call,
search, and document-read budget and stores its actual call ledger when the
provider reports usage.
