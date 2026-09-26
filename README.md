# TownReporter

> The public record is only the beginning.

**Current software version: [0.6.68](docs/releases/0.6.68.md).** Backups you can trust, and a page that says when something is wrong. One backup routine now runs from two places — the nightly run the watchdog already makes, and a **Back up now** button on the Control page — and every backup is copied to the second drive and checked byte for byte, same size and same SHA-256, before anything is deleted. The local folder keeps the latest three only after all of them are known good elsewhere; if that drive is missing, unwritable, or a copy fails its check, nothing local is removed and the page says so. The Control page gains **Last backup**, **Copy on D:** and **Attention** cards, and the watchdog raises an alert — on that card, as a Windows notification, and as a phone push only if the owner sets a topic — when the paper or the public site is down for more than ten minutes, when the daily scan fails or does not run by 8 AM, when the last good backup is over thirty hours old, when the offsite copy stops working, or when the second drive runs low. Each alert fires once when it starts and once when it clears, and a start task that is still running is no longer called a failure. No migration, no new scheduled task, no new program. GitHub remains the authority for publication state. [0.6.67 release guide](docs/releases/0.6.67.md) · [Changelog](CHANGELOG.md).

See [the deployment boundary](SELF-HOSTING.md) before diagnosing the live paper.
Release source, package metadata, installation checks and deployment evidence are recorded separately in the [0.6.68 release guide](docs/releases/0.6.68.md).

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

## Start here

| If you…                | Read this                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I edit the paper**   | [docs/editor.md](docs/editor.md) — the desk, with screenshots and no code. [docs/manual.md](docs/manual.md) — the full manual, including the architecture drawings.     |
| **I install or run it** | [docs/windows-install.md](docs/windows-install.md) · [docs/setup.md](docs/setup.md) · [SELF-HOSTING.md](SELF-HOSTING.md)                                              |
| **I work on the code** | [For technical readers](#for-technical-readers) below, and [docs/diagrams/README.md](docs/diagrams/README.md)                                                          |

## One editor, one town

A town does not need a newsroom to be covered. It needs a watch list and one person.

- Keep a **watch list** of the city's own sources: city site, council, agenda portal, school district, utility, meeting-video channels. A **scheduled daily scan** reads them at the time you set. It files leads. It does not draft or publish.
- Leads land in the **Queue**.
- Open a lead, give **story direction** — the decision or question to cover — then **Draft with AI**. The draft shows the sources it used. **Redraft** runs it again, and your saved draft stays until the new one finishes.
- **A person publishes.** Scan does not publish, Draft does not publish, Dark Desk does not publish.
- Council meetings arrive as recordings. Capture files them as leads with transcript citations, so a meeting story starts from the tape instead of a blank page.
- Approved routine notices become automatic roundups from fixed templates. Everything else waits for an editor.
- Long trails, competing hypotheses and unresolved identities live in **Dark Desk**. It digs. It never prints.
- Corrections are public at `/corrections`, with a date and an explanation of what changed.

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

![System context: what the newsroom talks to](docs/diagrams/system-context.svg)

![The pipeline: source to printed page](docs/diagrams/pipeline-source-to-page.svg)

---

## How a meeting becomes a story

A council meeting arrives as a recording, not as an article. Nothing on this path prints on its own.

1. **Capture.** **Run meetings now** reads the meeting video channels and stores a transcript revision. Each revision is content-addressed and immutable: a new recording is a new revision, never an edit of the old one.
2. **A lead in the Queue.** Capture files an ordinary lead, the same kind a scan files, carrying the transcript citations it drew from.
3. **Direction, then draft.** The editor says which decision or question to cover. The draft is written from a bounded slice of the transcript, not the whole tape.
4. **The draft shows its evidence.** The citations it actually used are saved and read off what the draft says. They are never inherited from the material it was given.
5. **Names are checked.** Unverified meeting speakers are masked in the saved copy as "an unidentified speaker", including a two-word office such as "Mayor Pro Tem".
6. **The gate.** Publication is blocked when a citation is missing, malformed, or no longer matches the recording.
7. **After publication.** If the recording is revised later, the printed story is not rewritten. It raises one high-priority editor review beside the published article.

![How a meeting becomes a story](docs/diagrams/meeting-to-story.svg)

Honest limits. Pulled notes are leads, not evidence. A vote tally or a mover can appear with no citation. A masked name reads stiffly. YouTube can rate-limit a capture (HTTP 429); a later pass picks it up. Captions are not minutes. A person approves every ordinary story.

### Meetings, tapes, packets

- **PrimeGov** (`longmont.primegov.com`) is a watched official source. The catalog comes from the public JSON API (upcoming + archived), not a headless crawl of the JS app. Agenda / packet / minutes PDFs are separate records. YouTube titles join the matching meeting.
- **YouTube.** The city channel is a catalog. Full timestamped transcripts live on each watch URL (Playwright opens **Show transcript** — not a 12k slice). Upcoming livestreams stay listed with no fake transcript and are rechecked. `@LongmontPublicMedia` is the second tape; same-meeting titles are merged.
- **Captions are a map, not minutes.** Names may be wrong. Quotes need a check against the packet. Minutes not posted after 36 hours is a catalog note, not a story.

---

## For technical readers

Everything below is for whoever installs, runs or changes the software. If you edit the paper, [How it works](#how-it-works) and [How a meeting becomes a story](#how-a-meeting-becomes-a-story) are the parts you need.

### All documents and manuals

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

Download the Windows x64 installer ZIP named `TownReporter-<version>-windows-x64.zip` from the [latest published release](https://github.com/scottconverse/TownReporter/releases/latest); the source-code ZIP is not the installer. If that asset is missing, stop and use a release that provides it. Extract the ZIP and open **Install TownReporter.cmd**. It provisions private Node/PostgreSQL runtimes, persistent storage and Chromium, builds the application, and checks that the correct server answers before directing you to setup. It does not replace an existing database or install Halo's Windows tasks. The 0.6.68 package adds the backups, the offsite copy and the alerts recorded in its release guide; the 0.6.67 package added the editor's controls recorded in its release guide; the 0.6.66 package added the reboot fix recorded in its release guide; the 0.6.65 package added the Control page; the 0.6.64 package added the daily scan on Automatic; the 0.6.63 package added the import, paste-one-story and section-source surfaces. The current package note names the expected tag and assets; the JSON metadata and `.sha256` sidecar are the authorities for source commit and ZIP hash, while GitHub records publication state.

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
Otherwise it uses DeepSeek v4.1 Flash first, then Qwen on this computer if it
is loaded, then Codex Terra — choosing the first ready provider before
enqueueing, and storing that effective choice on the job. A
named model is also the recorded first choice. If that model reaches a usage
limit, becomes unavailable, loses its login, times out, or returns no output,
TownReporter can move only the unfinished model call to the next ready runtime
and records the requested and actual model and effort. Earlier calls in that
active run are not repeated. A later restarted job retains uploaded source
material but may read it again. A content refusal stops the run.

There are **two Automatic ladders**, and they are not the same order:

| Automatic covers       | The order it walks                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Stories, scans, Dark Desk | DeepSeek v4.1 Flash → Qwen 3.6 35B **on this computer, when it is loaded** → Codex Terra                    |
| Opinion                | Codex Sol → Claude Sonnet                                                                                        |

Opinion is the only surface whose Automatic ends at Claude Sonnet. Opus, Codex
Astra and Claude Haiku are available only when an editor selects them by hand.

The Queue also offers **Draft selected** for one editor-chosen batch of up to
five eligible leads. That batch requires one named Codex, Claude, Local model,
or saved Custom AI connection, including a configured
Gemini endpoint. It never uses Automatic. It retains each lead's saved research
scope, shows each lead's durable result and workbench link, and never publishes
a story. Technical provider failures can move the unfinished call to the next
ready cloud runtime; a provider refusal remains terminal.

Daily Scan uses the same named choices and saved Custom AI connections. It stores the requested model with the schedule and the
runtime actually used on each job. Technical preflight or mid-call failures can
move unfinished work to the next ready cloud runtime and are recorded; a
provider refusal stops the run. For image OCR, the same technical-only rule
applies and only vision-capable candidates are considered.

Pick Codex Astra, Sol, Terra or Luna; Claude Fable, Opus, Sonnet or Haiku; or
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
TownReporter uses the signed-in account only to authenticate its Codex CLI
requests; a newsroom call does not inherit the operator's full Codex setup.
Each call ignores Codex user configuration, starts from the system temporary
directory, runs ephemerally with a read-only sandbox, and disables shell,
computer, browser, apps, plugins, multi-agent and hook features. Built-in web
search is added only when the trusted caller requests research. This is an
application-level tool boundary, not an operating-system security sandbox: the
reporting process still runs as the Windows account, and the read-only setting
does not by itself restrict which files that account can read. Untrusted source
material must therefore remain data, never an instruction to expand the task.

Claude Code is separately constrained. TownReporter omits the operator's
`CLAUDE.md`, skills, plugins and MCP configuration, starts the CLI outside the
application tree in restricted safe mode, and allows only `WebSearch` and
`WebFetch` for a caller-authorized research request. Planning calls hide all
tools; OCR has a narrow exception that reads one generated temporary page.
The reporting job does not receive shell, arbitrary file, browser or agent tools.

For **Automatic**, a configured gateway is tried first; named choices in Story, Scan and Dark Desk become the recorded first runtime instead of this low-level configured-provider chain:

| Set this                                        | What runs                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint; Story Automatic tries this gateway first    |
| `ANTHROPIC_API_KEY`                             | credentials for selected Claude models or the final Sonnet retry            |
| _nothing_                                       | stories, scans and Dark Desk walk the Automatic ladder above (DeepSeek → local Qwen → Codex Terra); Opinion walks Codex Sol → Claude Sonnet |
| `XAI_API_KEY`                                   | Grok                                                                        |

The CLI is slower than an API — it reloads a fixed preamble per call, so a draft takes minutes rather than seconds. Time budgets adjust on their own.

**Opinion offers the native providers and local model.** The picker offers
Automatic, Codex Astra, Sol, Terra and Luna, Claude Fable, Opus, Sonnet and
Haiku, Local model, and saved custom connections. Codex Sol is selected by
default. **Opinion's own Automatic** tries Codex Sol first and moves to Claude
Sonnet once if Codex is unavailable — that is the Opinion ladder, not the desk's
global order; stories, scans and Dark Desk walk DeepSeek v4.1 Flash → local Qwen
3.6 35B when it is loaded → Codex Terra. An explicit choice remains the recorded
first choice; a recognized technical failure can move only the unfinished call.
The writer reads the configured private voice file, and a provider refusal or
invalid delivery leaves the request failed without a draft.

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

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion defaults to Codex Sol; Opinion's Automatic tries Codex Sol, then Claude Sonnet. Both subscription writers read the complete configured voice using native instruction-file options and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and blocked from publication until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](docs/editor-desk.md) for the complete editor flow.

Dark Desk uses a separate cost-aware Automatic path: a configured gateway wins;
otherwise it walks the desk's own Automatic ladder — DeepSeek v4.1 Flash, then
Qwen 3.6 35B on this computer when it is loaded, then Codex Terra — and only the
unfinished stage moves to the next provider if a login has lapsed or synthesis
does not respond in time. Claude Sonnet is not on that ladder; it is a hand pick,
and Opinion is the only surface whose Automatic ends there.
Claude Haiku plans Claude runs and Codex Luna plans Astra/Luna runs. Research is
checkpointed before synthesis, so a synthesis retry does not repeat completed
searches or document reads. Each round enforces one wall-time, model-call,
search, and document-read budget and stores its actual call ledger when the
provider reports usage.

---

## Architecture

Twelve rendered diagrams, each with its Mermaid source beside it. The index is [docs/diagrams/README.md](docs/diagrams/README.md); the write-ups are [docs/manual.md](docs/manual.md) Part 5 and [docs/diagrams/scan-architecture.md](docs/diagrams/scan-architecture.md). Two are drawn above.

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| System context | [system-context.svg](docs/diagrams/system-context.svg) | [.mmd](docs/diagrams/system-context.mmd) | What the newsroom talks to — shown above |
| Data model | [data-model.svg](docs/diagrams/data-model.svg) | [.mmd](docs/diagrams/data-model.mmd) | The database shape — newsrooms, sources, snapshots, anomalies, leads, drafts, articles, corrections, investigations |
| Keeping it online | [keeping-it-online.svg](docs/diagrams/keeping-it-online.svg) | [.mmd](docs/diagrams/keeping-it-online.mmd) | Tunnel, watchdog, and what keeps a deployment answering |
| Pipeline: source to printed page | [pipeline-source-to-page.svg](docs/diagrams/pipeline-source-to-page.svg) | [.mmd](docs/diagrams/pipeline-source-to-page.mmd) | Watch list to lead to draft to editor to paper — the red box is the only way to print |
| How a meeting becomes a story | [meeting-to-story.svg](docs/diagrams/meeting-to-story.svg) | [.mmd](docs/diagrams/meeting-to-story.mmd) | A recording to a lead to a bounded draft to the publication gate — shown above |
| A job, end to end | [job-end-to-end.svg](docs/diagrams/job-end-to-end.svg) | [.mmd](docs/diagrams/job-end-to-end.mmd) | Lease, claim, work, checkpoint, finish |
| Choosing a provider at call time | [provider-at-call-time.svg](docs/diagrams/provider-at-call-time.svg) | [.mmd](docs/diagrams/provider-at-call-time.mmd) | First choice, technical failover, terminal refusal |
| Dark Desk, one round | [dark-desk-one-round.svg](docs/diagrams/dark-desk-one-round.svg) | [.mmd](docs/diagrams/dark-desk-one-round.mmd) | Competing hypotheses, the whole tape, trails that reopen |
| The Opinion desk and its voice handoff | [opinion-voice-handoff.svg](docs/diagrams/opinion-voice-handoff.svg) | [.mmd](docs/diagrams/opinion-voice-handoff.mmd) | How the publication voice reaches the writer |
| Scan overview | [scan-overview.svg](docs/diagrams/scan-overview.svg) | [.mmd](docs/diagrams/scan-overview.mmd) | Scope, run snapshot, fetch, bounded batch analysis, coverage accounting |
| How a run reports itself | [scan-run-reporting.svg](docs/diagrams/scan-run-reporting.svg) | [.mmd](docs/diagrams/scan-run-reporting.mmd) | Partial vs failure vs success-with-leads vs success-with-zero-leads |
| Scan history paging | [scan-history-paging.svg](docs/diagrams/scan-history-paging.svg) | [.mmd](docs/diagrams/scan-history-paging.mmd) | Real offset paging and when Show more disappears |

![Data model: the shape of the database](docs/diagrams/data-model.svg)

---

## Recent releases

**0.6.67** is the current version. It gives the editor the three controls that were missing from a story: a to-do the desk wrote too long no longer blocks Save or Publish, a headline an editor changed survives a redraft and can be rewritten even after the story has printed — same URL, with the old words kept — and Publish now reads **Publish in \<Section\>** and confirms that section in the same press. One additive migration. Read the [0.6.67 release guide](docs/releases/0.6.67.md) for what it claims and what it does not.
**0.6.66** was the previous version. The paper comes back by itself after a reboot: the wait before migrations asks Postgres a real query instead of trusting an open port, migrations run through `cmd.exe` so a child's stderr cannot terminate the logon start, they are retried three times with every attempt in the log, and a start that cannot serve the paper exits non-zero — which the watchdog now reads, running the `\TownReporter` task itself after a three-minute boot grace rather than leaving a failed start for someone to notice. Redlib's install root became a setting outside AppData, with a one-step helper to move an existing install there. Read the [0.6.66 release guide](docs/releases/0.6.66.md) for what it claims and what it does not.

Release notes for every earlier version, moved verbatim out of this README, are in the [release history](docs/releases/README.md). Line-by-line detail is in [CHANGELOG.md](CHANGELOG.md).
