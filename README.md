# TownReporter

> The public record is only the beginning.

**Current release: [0.6.18](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.18)** — 5 September 2026. Changelog: [CHANGELOG.md](CHANGELOG.md).

See [the deployment boundary](SELF-HOSTING.md) before diagnosing the live paper.

A civic newsroom you run yourself. A public paper on the front, a signed-in editor desk behind it. The working edition watches Longmont, Colorado — meetings, packets, minutes, money, contracts, and the YouTube tapes. Nothing prints until a person publishes.

MIT licensed. Clone it. Point it at your city.

---

> **Read this first.** Drafts are AI-assisted. Models invent facts, misattribute quotes, and mangle names — especially from auto-captions. TownReporter does **not** fact-check for you. Captions are not minutes. Dark Desk never prints. You are solely responsible for everything that appears on the paper. This is not a substitute for professional journalism, not legal advice, and not the city.

---

TownReporter is two rooms:

|                        | What it is                                                         | Who sees it       |
| ---------------------- | ------------------------------------------------------------------ | ----------------- |
| **The paper** (`/`)    | Stories and editorials a human published, with sources shown       | Anyone            |
| **The desk** (`/desk`) | Watch list, scan, queue, drafts, notes, Dark Desk, Opinion, Server | Signed-in editors |

There is no fully automated path to the masthead.

It is not the Longmont Times-Call, not the city, and not a replacement for either. It covers the packets most people never sit through, and it shows the exact documents it used.

---

## Manuals

| Audience                                                   | Document                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Everyone — the full manual**, with architecture drawings | [docs/manual.md](docs/manual.md)                                                                |
| Editors, with screenshots and no code                      | [docs/editor.md](docs/editor.md)                                                                |
| Operators (clone, env, Postgres, models, city swap)        | [docs/setup.md](docs/setup.md)                                                                  |
| Dark Desk UI contract                                      | [docs/dark-desk-editor.md](docs/dark-desk-editor.md)                                            |
| Local models, measured on real prompts                     | [docs/local-models.md](docs/local-models.md)                                                    |
| Marketing / GitHub Pages landing                           | [docs/index.html](docs/index.html) · [live page](https://scottconverse.github.io/TownReporter/) |
| Contributing changes                                       | [CONTRIBUTING.md](CONTRIBUTING.md)                                                              |

GitHub Pages is that landing, not the newsroom. Enable it once: repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The token that pushes this repo cannot flip that switch.

---

## Run it (about five minutes)

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

The public paper is `/`. The desk is `/desk`; first-run setup is `/desk/setup`, and the owner can revise it later under **Server → Paper setup**.

Full operator notes — Postgres, Vercel, other models, pointing it at another city — are in [docs/setup.md](docs/setup.md). How to run the desk is in [docs/editor.md](docs/editor.md).

---

## How it works

Same six moves the paper itself describes at `/how-we-report`:

1. **Watch.** A list of civic sources: city site, council, planning, agenda portal, school district, utility and meeting-video channels. The Longmont edition ships with a working list; every new installation chooses its own.
2. **Detect.** A scan fetches those pages, hashes them against the last snapshot, and flags what changed, what disappeared, and what failed to appear when it usually does.
3. **Follow.** Before a story is drafted, the desk asks what the announcing source leaves unexplained, then follows attachments, names, contracts, parcels, prior meetings.
4. **Preserve.** Significant captures are stored. If a record later vanishes, the captured version remains, and the article says so.
5. **Investigate.** Dark Desk is the recursive lane: competing hypotheses, unresolved identities, trails that were exhausted until new evidence reopened them. **It does not print.**
6. **Write, then gate.** Drafts are reported stories, not recaps. Hold, kill, or publish is a person. Every material claim should be checkable against a document we show.

Corrections are public (`/corrections`). We would rather look careful than look first.

### Recent releases

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
- **An Opinion desk.** A subject, a sentence or a URL becomes an unsigned editorial: OPINION in the headline, no byline, receipts in an appendix at the end. The writer fetches its own records first, so it takes ten to forty minutes.
- **Dark Desk has two dials.** _Dig_ — how far it chases. _Nerve_ — how speculative it may be. The panel says in plain words what the current setting will do.
- **Dark Desk's planner had never run.** Its budget was 45 seconds against a call that needs 150, and every failure fell back to keyword matching in silence. The database held zero entities, claims or hypotheses.
- **Confidence is capped by the label in code**, not requested in a prompt, and a FACT with no citation is downgraded.
- **r/longmont is a tip line** — scored, paced, and filed as unverified tips that can never be mistaken for reporting.
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
- **Honest OCR.** Image-only PDFs are unread. There is no JPEG-as-chat OCR.

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

The same form stays available under **Server → Paper setup**. Saving it changes the public masthead, city copy, local clock, contact links, watch list and meeting-video discovery. A blank optional field means none; it never borrows another town's value. Before setup, the public site shows a neutral “not yet set up” page and no articles.

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
pair names a gateway, Automatic uses that gateway and no other provider.
Otherwise it tries Claude Opus, then Codex Terra, chooses the first ready
provider before enqueueing, and stores that effective choice on the job. Every
reporting and writing pass in that run uses the same provider, unless that
provider's login lapses mid-run -- Automatic then moves to the next ladder
rung once, if it is ready.

Pick Codex Terra, frontier Codex Sol, frontier Claude Opus, or **Local
model** to force that provider for one run. Explicit choices never fall
back, at enqueue or mid-run. The endpoint/model compatibility overrides are
listed in [docs/setup.md](docs/setup.md#per-run-picker).

Zen MiMo and Local Qwen were removed from the picker (2026-09-02). 0.6.10
brought a local model back as a named pick, "Local model" -- generic this
time: whatever `LLM_BASE_URL` (plus `LLM_MODEL` / `LLM_API_KEY`) already
points at, with its own longer, editable timeouts, shown in every picker
once that variable is set. See [docs/local-models.md](docs/local-models.md).

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

For **Scan and Dark Desk**, configured-provider precedence is:

| Set this                                        | What runs                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint; also forces Story Automatic to this gateway |
| `ANTHROPIC_API_KEY`                             | Claude, billed to that key                                                  |
| _nothing_                                       | **Claude, through your Claude Code login**                                  |
| `XAI_API_KEY`                                   | Grok                                                                        |

The CLI is slower than an API — it reloads a fixed preamble per call, so a draft takes minutes rather than seconds. Time budgets adjust on their own.

**Opinion offers Claude and the local model.** The picker offers Automatic,
Claude Opus, and Local model (once `LLM_BASE_URL` is set). Claude Code runs
its own research pass, then loads the editorial voice by file path for the
writing pass. Codex is not offered for editorials: its model declines to
write a piece that takes a position on a local policy question, so it stays
on the Story picker, where it drafts reporting.

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
the exclusive Story Automatic provider.

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

## Frequently asked questions

**Is this a newspaper?**
It is a newsroom you run. Stories that print have a human gate. It is not a newspaper of record, not the city, and not a wire service. Treat every draft as a first draft you still have to report.

**Will it publish by itself?**
No. Scan files leads. Draft writes a story into the workbench. Publish is a person.

**Can I use this for any city?**
Yes. The first owner completes **Set up the paper**, and can revise the same database-backed settings later on the Server page. No source edit or rebuild is required. See [docs/setup.md](docs/setup.md#point-it-at-another-city).

**Do I have to pay for an AI key?**
No. Story drafting can use a signed-in Codex/Claude CLI, or a configured
`LLM_BASE_URL` gateway to a model on your own hardware. Set `ANTHROPIC_API_KEY` if you would rather bill a
Claude key, or point `LLM_BASE_URL` at an OpenAI-compatible endpoint. That
configured gateway becomes the forced Story Automatic provider and remains the
configured provider for Scan and Dark Desk. `XAI_API_KEY` still runs Grok for
configured-provider features.

**Are YouTube captions the official record?**
No. Captions are a map of the tape. Minutes and the packet are the official record. Names in captions are often wrong. Dark Desk is told this; drafts still need a human check.

**What’s Dark Desk?**
The investigative lane. An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Remaining pages stay on the file. It has no publish button. Editor UI: [docs/dark-desk-editor.md](docs/dark-desk-editor.md) and [docs/editor.md](docs/editor.md#dark-desk).

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
Scan, draft, and Dark Desk each call the model. A Longmont-sized scan is the expensive click; drafting one story is cheaper; a Dark Desk round is five short passes. Set a spending limit on the provider. Exact dollars depend on the model you point at.

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
