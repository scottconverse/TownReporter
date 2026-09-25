# Release history

Verbatim release notes, moved out of the README on 2026-09-24. Newest first.
Current version: [0.6.63](0.6.63.md). Full detail: [CHANGELOG](../../CHANGELOG.md).

### Recent releases

- **0.6.51** — Adds per-runtime effort controls; named/Automatic first-choice routing that retries only a technically failed unfinished call and records requested/actual model and effort; terminal content refusals; Codex-first unattended order with Claude Sonnet last and no automatic Opus; migration of blank-model saved Gemini connections without replacing their key; Grok connection repair; editable daily-scan time/model/effort/source settings; Queue batch Redraft; and clearer retained-job health history. Direct Story/Opinion documents can retain and read all extracted PDF pages within their 20-million-character text limit. Generic capture and Dark Desk image-PDF OCR now offer **Read entire PDF**, which checkpoints bounded 12-page calls and resumes with only unread pages after interruption or a budget pause. The source repair prevents the prior Windows installer shutdown path from trying to kill a system child such as `csrss`; a root that has already crashed can still leave detached children because their ownership cannot be proved safely. See [the release guide](0.6.51.md) for evidence boundaries; it does not assert GitHub publication, production deployment, or live-model proof.

- **0.6.54** — Adds editor control over what a scan reads and honest reporting of what it did. A scan now takes three scopes: **General** (every accepted source), **Section** (one reporting beat), and **Custom** (an exact picked set, with search and kind/tier filters; unselected sources are never fetched). Named **source packs** save a reusable accepted set per beat without changing section setup. Every run records **selected, attempted, fetched, failed, and analysed** sources, the analysis **batches used and failed**, and the **failed sources by name**; a clean zero-lead success, a provider failure, and a partial scan render differently. Large scans are split into **bounded batches** instead of a single 48,000-character pass that silently dropped every source past the budget, so a 100-source scan is no longer truncated, one failed batch keeps its siblings' leads, and leads are de-duplicated across batches with source attribution preserved (resume-from-checkpoint is **not** in this release). Scan history now returns a **true total** and pages with real offsets, fixing a defect where history could never advance past row 50; **Show more** appends older runs and disappears when exhausted. Sections gain per-section accepted-source counts, a zero-source warning, and manual bulk assignment. Two additive migrations: `0065_scan_coverage_accounting.sql` and `0066_scan_source_packs.sql`. See [the release guide](0.6.54.md) for evidence boundaries; it does not assert production deployment or live-model proof.

- **0.6.53** — Patch line carrying the release-coherence work, the transaction-scoped advisory-lock turnover fix for routine-notice policy bootstrap, and the startup sweep that reattaches durable jobs (queued jobs become claimable; running extraction resumes from its checkpoint without rereading; stale running rows are adopted or requeued honestly, never terminated by PID signaling). See [the release guide](0.6.53.md).

- **0.6.52** — Repairs the `/desk` boundary so the public-home entry performs a fresh document load (the reported defect: the URL changed to `/desk` while the public homepage stayed mounted), extends that to the footer, masthead and error-page desk links with browser guards, preserves failed provider logins as immutable history with a distinct resolution row, and adds the bounded document-extraction retry that checkpoints pages so a later batch failure cannot discard earlier work. See [the release guide](0.6.52.md).

- **0.6.50** — Correctly identifies Ollama Cloud models, shows their reported context window, and prevents DeepSeek V4 reasoning from consuming the Story output budget before a draft is written.
- **0.6.49** — Restores bounded Dark Desk lead development and durable reporting Pull, adds direct SuperGrok OAuth and newsroom-managed Gemini connections to the shared model picker, keeps Story model controls reachable, and lets Automatic recover uploaded-document work when a provider reaches its limit or becomes unavailable.
- **0.6.48** — Connects discovered local models to Story drafting, makes evidence-check progress and results visible, verifies names from retained written records, selectively repairs missing citations, and distinguishes the writer checkpoint from the final checked draft.
- **0.6.47** — Keeps a labeled Editor’s desk button in the public header on desktop and phones.
- **0.6.46** — Implements the approved public-reader design, full archive search and pagination, browser-local saved stories, dark mode and text sizes, sharing, and a correction email form. See the [reader guide](../reader.md).
- **0.6.45** — Corrects the remaining Claude-only Opinion comment in the downloadable configuration template. Runtime behavior is unchanged from 0.6.44.

- **0.6.44** — Packages the Astra desk, shared large-document and URL intake, private-document evidence checks, supported name corrections, saved Opinion material, Sol default and native voice-file integration for both subscription writers. See [the 0.6.48 release guide](0.6.48.md).

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

Current development status and remaining features: [TODO.md](../../TODO.md). Remote takeover and deployment evidence: [HANDOFF-NEXT-AGENT.md](../../HANDOFF-NEXT-AGENT.md).

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

- **The newsroom watches itself.** The paper was offline for hours and nothing said so. A watchdog now checks the app, the tunnel and the public URL every five minutes and restarts what is down. A [Server page](../manual.md#the-server-page) shows all of it.
- **Fonts are self-hosted, and the reader's page stays self-contained.** A third-party script was removed from every page, and a cold load of the paper makes zero outside requests.
- **Stories are shareable.** Per-story titles, descriptions, canonical URLs and social cards — they all used to share one blurb. Plus a sitemap.
- **An Opinion desk.** A subject, pasted source text, uploaded documents or a URL becomes an unsigned editorial: OPINION in the headline, no byline, receipts in an appendix at the end. The writer fetches its own records first, so it takes ten to forty minutes.
- **Dark Desk has two dials.** _Dig_ — how far it chases. _Nerve_ — how speculative it may be. The panel says in plain words what the current setting will do.
- **Dark Desk's planner had never run.** Its budget was 45 seconds against a call that needs 150, and every failure fell back to keyword matching in silence. The database held zero entities, claims or hypotheses.
- **Confidence is capped by the label in code**, not requested in a prompt, and a FACT with no citation is downgraded.
- **Reddit is a tip line** — one unambiguous accepted subreddit source enables the paced check. RSS discovers candidates; an optional local Redlib reads selected original posts in full and reports its coverage, while RSS remains the fallback. Posts are filed as unverified tips, never as reporting; a new town does not silently inherit r/longmont.
- **Search works.** Exa runs first, and a PULL no longer answers a Longmont question with three California school-district PDFs.
- **Nothing scrolls sideways.** The navigation rails wrap.

Full detail is in [CHANGELOG.md](../../CHANGELOG.md).

### Earlier (0.5.0)

- **Self-hosted.** Builds to a plain Node server instead of Vercel. A long-lived process means the Chromium page reader works and background jobs are not chopped into pieces. `NITRO_PRESET=vercel` still builds for Vercel.
- **Runs on your Claude Code login.** No API key. The desk shells out to the local CLI, with the coding harness stripped — including your own `CLAUDE.md` and skills, which have no business in a news prompt. An API key or a local OpenAI-compatible gateway still win if set.
- **Jobs no longer run twice.** Nothing refreshed the liveness stamp mid-run, so any job past the two-minute stale line was re-claimed and run alongside the original — duplicate drafts, double spend.
- **SSRF is closed at connect time.** The old guard resolved DNS and then let the request resolve again. The address approved is now the address connected to.
- **The queue puts the best lead first.** Ordering on the timestamp alone buried a 14-point story under an 8-point one.
- **One click drafts.** A stale failure used to cancel the new draft the instant it started.
- **The feed works in a reader.** Absolute links, escaped titles. A `]]>` in a headline used to break the whole feed.
- **Runs on Windows at all.** `npm run dev` and `npm run build` both failed, every route 500'd on a self-hosted build, and 170 tests had never run.

Full detail, including the newsletter and rate-limiter fixes, is in [CHANGELOG.md](../../CHANGELOG.md). Setup for your own machine: [SELF-HOSTING.md](../../SELF-HOSTING.md).

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
[Read retained PDF pages](../pdf-page-reading.md). A bounded built-UI proof
read real page 13 of a 44-page PDF and preserved the 16,254,338-byte original
and its hash. The main table rows and key dates matched, but color-only RAG
status was omitted and a minor verb differed; this is not full-packet or
table-perfect acceptance, and the editor must compare the transcript with the
original.

Also in 0.3.3–0.3.8: Mountain Time masthead, overlapping printed headlines collapse, Draft with AI paints without a reload, Redraft survives the cookie glitch, Start digging keeps the card on a failed open.
