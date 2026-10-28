# TownReporter

> The public record is only the beginning.

**Current software version: [0.6.84](docs/releases/0.6.84.md)** (2026-10-27). The live paper is [townreporter.org](https://townreporter.org), the Longmont, Colorado edition. [Download the Windows release](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.84) · [Landing page](https://scottconverse.github.io/TownReporter/) · [Manual](docs/manual.md) · [Changelog](CHANGELOG.md)

A civic newsroom you run yourself. A public paper on the front, a signed-in editor desk behind it. The working edition watches Longmont, Colorado: meetings, packets, minutes, money, contracts, and the YouTube tapes. Ordinary reporting is reviewed and published by a person. Approved sources can produce automatic roundups of library, recreation, community-event, registration, waste-collection and public-meeting notices through fixed templates.

MIT licensed. Clone it. Point it at your city.

---

> **Read this first.** Drafts are AI-assisted. Models invent facts, misattribute quotes, and mangle names, especially from auto-captions. TownReporter checks names and evidence, but those checks do **not** replace editorial verification. Captions are not minutes. Dark Desk never prints. You are solely responsible for everything that appears on the paper. This is not a substitute for professional journalism, not legal advice, and not the city.

---

## What is new in 0.6.84

124 pull requests since 0.6.83. The short list; the long list is in the [changelog](CHANGELOG.md#0684--2026-10-27) and the [release guide](docs/releases/0.6.84.md).

- **One model picker, with the full list, on every AI screen.** **Automatic** tries DeepSeek v4.1 Flash 1017, then the Local model the computer has loaded, then Codex Sol 6.1 (balanced), then Claude Sonnet 5.5. Gemini is a model you can pick by name; Automatic never picks it. See [Model](#model-the-automatic-ladder-and-named-picks).
- **Find evidence** on the Story page: search the paper's captured evidence by exact words and by meaning, including **Our past stories close in meaning** and uploaded files. Editor desk only; the public paper is unchanged.
- **Today in town** prints a time-ordered list of the day's events from approved public calendars, and every routine run says why items need review.
- **The app warns; it never blocks.** Every warning has an "anyway" button: **Publish anyway in <section>**, **Kill anyway**, **Hold anyway**, **Draft anyway**. Each override is written to an audit trail.
- A rebuilt **Dark Desk**, a **Drafts** page that survives a bad row, evidence checks where the AI judges each claim and you review the exceptions, **Undo** (and the **U** key) from every door.
- Subscribed **newsletters** enter the archive and scan. **Excel, PowerPoint and LibreOffice** files are read. The daily scan reads the whole accepted source pool.
- The ops backup script keeps three days of backups on D: and nothing on C: once a copy is verified, and the watchdog no longer kills a start that is still starting.

---

TownReporter is two rooms:

|                        | What it is                                                         | Who sees it       |
| ---------------------- | ------------------------------------------------------------------ | ----------------- |
| **The paper** (`/`)    | Stories and editorials, plus eligible owner-approved routine notices, with sources shown | Anyone            |
| **The desk** (`/desk`) | Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk, Sources & scan, Models, Server, Stats | Signed-in editors |

There is no fully automated path to the masthead for ordinary reporting. Approved sources can produce the bounded notice roundups described below.

It is not the Longmont Times-Call, not the city, and not a replacement for either. It covers the packets most people never sit through, and it shows the exact documents it used.

---

## Start here

| If you…                | Read this                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read the paper**     | [docs/reader.md](docs/reader.md): the front page, sections, search, saved stories, corrections, RSS.                                                                    |
| **Edit the paper**     | [docs/editor.md](docs/editor.md): the desk, with screenshots and no code. [docs/editor-desk.md](docs/editor-desk.md): the current workflow. [docs/manual.md](docs/manual.md): the full manual. |
| **Install or run it**  | [docs/windows-install.md](docs/windows-install.md) · [docs/setup.md](docs/setup.md) · [SELF-HOSTING.md](SELF-HOSTING.md)                                              |
| **Work on the code**   | [For technical readers](#for-technical-readers) below, [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/diagrams/README.md](docs/diagrams/README.md)                       |

## One editor, one town

A town does not need a newsroom to be covered. It needs a watch list and one person.

- Keep a **watch list** of the city's own sources: city site, council, agenda portal, school district, utility, meeting-video channels. A **scheduled daily scan** reads them at the time you set. It files leads. It does not draft or publish.
- Leads land in the **Queue**.
- Open a lead, give **story direction** (the decision or question to cover), then **Draft with AI**. The draft shows the sources it used. **Redraft** runs it again, and your saved draft stays until the new one finishes.
- **Ordinary stories require an editor's Publish click.** Scan does not publish, Draft does not publish, and Dark Desk does not publish.
- Council meetings arrive as recordings. Capture files them as leads with transcript citations, so a meeting story starts from the tape instead of a blank page.
- Only owner-approved routine notices from approved sources and fixed templates can become automatic roundups. Everything else waits for an editor.
- Long trails, competing hypotheses and unresolved identities live in **Dark Desk**. It digs. It never prints.
- Corrections are public at `/corrections`, with a date and an explanation of what changed.

---

## What it can do

Every item here is in the code of this release. The full manual covers each one screen by screen.

**Watch and scan**

- A watch list of civic sources with kind and tier, saved source packs, and per-source purpose, cadence and deadline.
- A daily scan that reads the whole accepted pool, never-read sources first, inside a 90-minute budget; each run reports sources read, waiting and blocked, by name. Manual scans take three scopes: General, Section, or Custom.
- Pages that refuse automated reads are retried once through a guarded Chromium read, then through the page's RSS or Atom feed. RSS, Atom and JSON feeds are read directly. Calendar and index pages keep their lists.
- Subscribed newsletters are read from a read-only mailbox the owner sets up, and enter the archive and scan.
- PrimeGov agendas, packets and minutes; YouTube meeting tapes with full timestamped transcripts.

**Report and write**

- Queue, Drafts and the story workbench: story direction, Draft with AI, Redraft, **Draft selected** (a batch of up to five leads on one named model), Hold, Kill, and Undo.
- Assignment-based reporting packages: a coverage ledger, source-linked claims, readiness, and a run receipt beside every draft. Whole-meeting coverage with an editor-visible action ledger and vote counts that are never guessed.
- **Add documents** reads PDF, Word, text and pictures (OCR), and now Excel, PowerPoint and LibreOffice files through headless LibreOffice. Install [LibreOffice](https://www.libreoffice.org/download/) on the computer to use that last part; the Server page shows whether it was found.
- **Find evidence** and search by meaning (desk only), described below.
- Evidence checks: the AI judges each claim against its pinned passage, and you review the exceptions. A draft with no recorded claims says **Not checked yet**.
- **Opinion** writes an unsigned editorial from a subject, a sentence or a URL, in a voice file you keep on your own disk.
- **Dark Desk** investigates a person, document, URL, rumor or gap with two dials, **Dig** and **Nerve**. It has no publish button.
- **Follow-ups** are AI agents that keep working on a question: re-check pages, search public records, or watch for the next agenda.

**Publish**

- The Publish bar lists every warning and reads **Publish anyway in <section>**. A person presses it. Every override is audited.
- Public corrections, RSS, an evidence page for every cited record, and a side-by-side comparison when a cited record has moved.
- Routine editions (**Today in town**, **This weekend**, **Deadlines approaching**) publish from approved sources through fixed templates.

**Run it**

- Windows installer package, or run from source on Windows, macOS or Linux (Node 22+). Postgres for a real newsroom; an embedded database for a quick look.
- Models: signed-in Codex and Claude sessions, a local model on LM Studio, Ollama or llama.cpp, DeepSeek through Ollama, Gemini, or any OpenAI-compatible endpoint you save as a connection.
- One owner, invited editors, one-time recovery codes. Stats without naming a reader. Legal removal workflow. The ops backup script keeps three days of backups on D:.

---

## Routine editions: Today in town

Three automatic editions exist, and the owner switches them on after approving their sources: **Today in town**, **This weekend** and **Deadlines approaching**. They use fixed templates and approved structured sources, with source, eligibility, freshness, conflict, review-history and idempotency checks. Nothing a source supplies reaches the reader as markup.

**Today in town** prints one block per event in start-time order (time, name, place, then "Free" or "Sign up" only when the data has it). With six or more events the blocks sit under Morning, Afternoon and Evening in the paper's own time zone. The dek reads "N events on <Town>'s public calendars today." and the source line is a named link. Every eligible routine notice keeps a saved status (deferred, in review or published); a run never silently drops a notice, and the run card says in plain words why items need review.

## Find evidence, and search by meaning

On the Story page, under **Your source material**, **Find evidence** has three lists:

- **Exact words**: the phrase, anywhere in the paper's captured evidence.
- **Close in meaning**: the five closest pieces of captured evidence and files you uploaded with **Add documents** (marked "your file"), found by a small MiniLM model that runs inside the server process. Vectors are kept in the database (`evidence_vectors`, `story_meaning_vectors`) without the text or the address, and a background job fills them in; `TOWNREPORTER_MEANING_SEARCH=off` turns that job off.
- **Our past stories close in meaning**: published stories of the same paper, each with **Open story**. The writer is given the five closest as background only, with words telling it to add nothing from them to the story.

Each row has **Open** and **Add to this story**. If the meaning model is unavailable, the exact-words list still works and the panel says so. This is on the editor desk only. It is not on the public paper, and the public search box is untouched.

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

**The app warns; it never blocks.** When a rule says an editor should stop, the desk shows the warning and an "anyway" button that does what the editor asked: **Publish anyway in <section>**, **Kill anyway**, **Hold anyway**, **Draft anyway**, **Add to this story anyway**. Each press writes the editor, the time, the warning and the target to the audit trail. Only true impossibilities stay refused.

![System context: what the newsroom talks to](docs/diagrams/system-context.svg)

![The pipeline: source to printed page](docs/diagrams/pipeline-source-to-page.svg)

---

## How a meeting becomes a story

A council meeting arrives as a recording, not as an article. Nothing on this path prints on its own.

1. **Capture.** **Run meetings now** reads the meeting video channels and stores a transcript revision. Each revision is content-addressed and immutable: a new recording is a new revision, never an edit of the old one. Audio is write-once, and a hash mismatch offers **Capture again**, which makes a new capture.
2. **A lead in the Queue.** Capture files an ordinary lead, the same kind a scan files, carrying the transcript citations it drew from.
3. **Direction, then draft.** The editor says which decision or question to cover. The draft is written from a bounded slice of the transcript, not the whole tape, and starts on a transcript aligned to the agenda when one exists.
4. **The draft shows its evidence.** The citations it actually used are saved and read off what the draft says. They are never inherited from the material it was given.
5. **Names are checked.** Unverified meeting speakers are masked in the saved copy as "an unidentified speaker", including a two-word office such as "Mayor Pro Tem".
6. **The gate.** Publication warns when a citation is missing, malformed, or no longer matches the recording, and the editor decides.
7. **After publication.** If the recording is revised later, the printed story is not rewritten. It raises one high-priority editor review beside the published article.

![How a meeting becomes a story](docs/diagrams/meeting-to-story.svg)

Honest limits. Pulled notes are leads, not evidence. A vote tally or a mover can appear with no citation, and a missing vote count stays unknown, never zero. A masked name reads stiffly. YouTube can rate-limit a capture (HTTP 429); a later pass picks it up. Captions are not minutes. A person approves every ordinary story.

### Meetings, tapes, packets

- **PrimeGov** (`longmont.primegov.com`) is a watched official source. The catalog comes from the public JSON API (upcoming + archived), not a headless crawl of the JS app. Agenda / packet / minutes PDFs are separate records. YouTube titles join the matching meeting.
- **YouTube.** The city channel is a catalog. Full timestamped transcripts live on each watch URL (Playwright opens **Show transcript**, not a 12k slice). Upcoming livestreams stay listed with no fake transcript and are rechecked. `@LongmontPublicMedia` is the second tape; same-meeting titles are merged. When a meeting has no captions, the transcription engine is named (`TEXTFLOWKIT_ENGINE`, default `whistle`) and the engine and model it reports are stored with the transcript.
- **Captions are a map, not minutes.** Names may be wrong. Quotes need a check against the packet. Minutes not posted after 36 hours is a catalog note, not a story.

---

## For technical readers

Everything below is for whoever installs, runs or changes the software. If you edit the paper, [How it works](#how-it-works) and [How a meeting becomes a story](#how-a-meeting-becomes-a-story) are the parts you need.

### Architecture in short

TownReporter is one Node 22 web application (TanStack Start on Vite) with a Postgres database.

- **Front end.** The public paper and the desk are React routes in `src/routes`. The paper is self-contained: fonts are served from this machine, there is no analytics script, and a cold load makes zero requests to an outside host.
- **Server functions.** Every desk and Dark Desk mutation runs through `deskMiddleware`, which resolves the signed-in user and requires owner or editor membership.
- **Database.** Migrations in `migrations/` (0001 to 0158); the server answers 503 until the database matches them. Without `DATABASE_URL` it runs on an embedded database that is lost when the process stops.
- **Job queue.** Scans, drafts, Dark Desk rounds, meeting capture and evidence checks run as leased jobs with a heartbeat, on separate lanes so a draft does not wait behind a scan.
- **Models.** A provider registry (`src/lib/news/provider-registry.ts`) is the one list every picker, ladder and failover reads. Codex and Claude run as restricted CLIs; DeepSeek runs inside the Claude Code CLI through a local relay that sets its thinking budget (off by default); local models and saved connections speak `/v1/chat/completions`.
- **Evidence.** Captured records are content-hashed; transcripts are immutable revisions; the meaning index is a table of vectors with no text.
- **Operations.** PowerShell scripts in `ops/` for backup, promote, staging, the watchdog and the control page; a Cloudflare Tunnel can front the app.

The full write-up, with the drawings, is [docs/manual.md](docs/manual.md) Parts 4 to 6. The twelve diagrams are listed [below](#architecture-diagrams).

### All documents and manuals

| Audience                                                   | Document                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Everyone: the full manual**, with architecture drawings  | [docs/manual.md](docs/manual.md)                                                                |
| Readers of the public paper                                | [docs/reader.md](docs/reader.md)                                                                |
| Editors, with screenshots and no code                      | [docs/editor.md](docs/editor.md)                                                                |
| Editors: current desk workflow                             | [docs/editor-desk.md](docs/editor-desk.md)                                                      |
| Editors: the Queue and draft workflow                      | [docs/editor-workflow-delivery.md](docs/editor-workflow-delivery.md)                            |
| Dark Desk, for editors                                     | [docs/dark-desk.md](docs/dark-desk.md)                                                          |
| Dark Desk UI contract                                      | [docs/dark-desk-editor.md](docs/dark-desk-editor.md)                                            |
| Reading retained PDF pages                                 | [docs/pdf-page-reading.md](docs/pdf-page-reading.md)                                            |
| Stats and saved reports                                    | [docs/stats-reports.md](docs/stats-reports.md)                                                  |
| Operators: clone, env, Postgres, models, city swap         | [docs/setup.md](docs/setup.md)                                                                  |
| Operators: install on Windows                              | [docs/windows-install.md](docs/windows-install.md)                                              |
| Operators: how a deployment runs, promote and roll back    | [SELF-HOSTING.md](SELF-HOSTING.md)                                                              |
| Operators: stage a build against a copy of real data       | [docs/staging.md](docs/staging.md)                                                              |
| Operators: the nightly proof                               | [docs/nightly-proof.md](docs/nightly-proof.md)                                                  |
| Local models, measured on real prompts                     | [docs/local-models.md](docs/local-models.md)                                                    |
| Add and use a named AI API connection                      | [docs/custom-ai-connections.md](docs/custom-ai-connections.md)                                  |
| Developers: PostgreSQL integration tests                   | [docs/postgres-integration-testing.md](docs/postgres-integration-testing.md)                    |
| Developers: contributing changes                           | [CONTRIBUTING.md](CONTRIBUTING.md)                                                              |
| Security policy and how to report a vulnerability          | [SECURITY.md](SECURITY.md)                                                                      |
| **Architecture diagrams** (rendered SVG + Mermaid source)  | [docs/diagrams/README.md](docs/diagrams/README.md) · [scan architecture](docs/diagrams/scan-architecture.md) |
| Screenshots and how they were taken                        | [docs/images/README.md](docs/images/README.md)                                                  |
| Release history and per-version guides                     | [docs/releases/README.md](docs/releases/README.md) · [0.6.84](docs/releases/0.6.84.md)           |
| Every change, line by line                                 | [CHANGELOG.md](CHANGELOG.md)                                                                    |
| Third-party licenses                                       | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) · [LICENSE](LICENSE)                           |
| Landing page                                               | [docs/index.html](docs/index.html) · [live page](https://scottconverse.github.io/TownReporter/) |
| Open work and deployment status                            | [TODO.md](TODO.md) · [HANDOFF-NEXT-AGENT.md](HANDOFF-NEXT-AGENT.md)                            |

Records, not manuals: `docs/proofs`, `docs/operations`, `docs/archive`, `docs/HALO-UPDATE-*` and the dated `HANDOFF-*` files are historical records and are not rewritten.

GitHub Pages is the landing page, not the newsroom. It is served from `main` / `/docs`.

---

## Install on Windows

The release at [github.com/scottconverse/TownReporter/releases/tag/v0.6.84](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.84) carries three files: `TownReporter-0.6.84-windows-x64.zip`, its `.zip.json` (the exact source commit) and its `.zip.sha256` (the hash). Download the ZIP, not the "Source code" archive, and extract it completely into a folder you intend to keep. Open **Install TownReporter.cmd**. It downloads pinned Node and PostgreSQL, checks their hashes, installs the application, Chromium and a private database, and builds the app on your computer. The default local paper is **http://127.0.0.1:4388**, and the installer prints the one-time setup code for claiming the desk. A first manual workflow takes under an hour on a normal connection; that is a goal, not a measured result for every computer.

CI also builds a self-contained `TownReporter-<version>-Setup.exe` and its SHA-256 sidecar in the **windows-setup** Actions artifact. It bundles Node, PostgreSQL, Chromium and the compiled application and installs without downloading. It is not a release asset of 0.6.84, and no fresh-machine human acceptance of it is claimed here.

Follow the [Windows installation guide](docs/windows-install.md) for setup, start and stop, private data and troubleshooting. Public hosting and AI provider setup are separate from local installation.

## Run from source (Windows, macOS or Linux)

You need **Node 22+**. Story drafting uses an existing Codex or Claude login, a local model, or a configured `LLM_BASE_URL` gateway; API keys are optional, but going without one relies on a signed-in Codex (ChatGPT) or Claude Code (Claude Pro/Max) subscription, or a model on your own hardware. See [Model](#model-the-automatic-ladder-and-named-picks) below.

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

Open [http://localhost:8080/login](http://localhost:8080/login) and **create an editor account** (email + password). On an unclaimed desk, enter its one-time setup code when prompted. The login form points to `logs/SETUP-CODE.txt` in the server data folder; in a source checkout, that folder is `TOWNREPORTER_DATA_ROOT` if set, otherwise `.townreporter-data` under the project directory. The server prints the code once in its log, and this gate also applies in development. TownReporter then opens **Set up the paper**: enter the paper name, city, state, timezone, contact details, starting watch list, meeting-video channels and meeting-title keywords. Nothing is published before that setup is saved. The account and paper settings live in your database, and sign-in is limited to ten attempts every five minutes per address.

The public paper is `/`. The desk is `/desk`; first-run setup is `/desk/setup`, and the owner can revise it later under **Server → Paper identity** (**Paper setup** panel).

Full operator notes (Postgres, Vercel, other models, pointing it at another city) are in [docs/setup.md](docs/setup.md). How to run the desk is in [docs/editor.md](docs/editor.md).

---

## Point it at another city

No code edit or rebuild is required. The owner fills out **Set up the paper** after creating the first account:

1. Paper name, tagline, city, state, IANA timezone, optional council-votes link and editor contact.
2. A starting watch list: city site, council, agenda portal, school district, utility and other reporting sources.
3. Optional YouTube meeting channels, one URL per line, plus the title phrases that identify meetings on those channels.
4. Optional newsletter mailbox, for subscribed newsletters (**Server → Paper setup → The paper's newsletter mailbox**).

The same form stays available under **Server → Paper identity** (**Paper setup** panel). Saving it changes the public masthead, city copy, local clock, contact links, watch list and meeting-video discovery. A blank optional field means none; it never borrows another town's value. Before setup, the public site shows a neutral "not yet set up" page and no articles.

If the city uses PrimeGov, put its public portal URL in the watch list. The ingest already speaks that API. If it publishes a motion-by-motion vote record of its own, put that site in the **council-votes** field: section 5 reads structured votes there, and blank means it reads none rather than another city's.

Two things a city swap does not carry over, because they are written for the shipped city's own pages: the notice parsers that read Longmont's waste-collection, library and sports-registration pages (they fire only on those URLs, so another city's sources produce no such roundups until there are equivalent parsers), and Colorado's business-registry search, which is offered only when the configured state is Colorado.

Details and the honest limits of a city swap are in [docs/setup.md](docs/setup.md#point-it-at-another-city).

---

## Model: the Automatic ladder and named picks

Every place an AI does work shows the **same model picker with the full list**: **Automatic**, every available Codex, Claude and Gemini model, DeepSeek, **Local model** (with a second picker of every model the computer has found, defaulting to the loaded one), and your saved custom connections. Beneath each picker, **Set up a writing model** opens installation, sign-in and retry guidance. Setup belongs on the computer and Windows account running TownReporter; the desk does not install software or sign you in automatically. Models → Who does what saves the model each job uses, and the model saved there is the model that runs.

### What Automatic does

The default is **Automatic**. The paper's default writing model is **DeepSeek v4.1 Flash 1017** (`deepseek-v4.1-flash:1017-cloud`), with thinking effort **none**, run inside the Claude Code CLI. Automatic checks readiness before queuing a job, picks the first ready model, and stores that effective choice on the job:

| Automatic covers                   | The order it walks                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Stories, scans, Dark Desk, Follow-ups | DeepSeek v4.1 Flash 1017 → **Local model** (whichever model is loaded) → Codex Sol 6.1 (balanced) → Claude Sonnet 5.5 |
| Opinion                            | DeepSeek v4.1 Flash 1017 → Codex Sol 6.1 → Claude Sonnet 5.5                                                |

If `LLM_BASE_URL`, or the `LLM_API_KEY` + `LLM_MODEL` pair, names a gateway, Automatic records that gateway as the preferred first runtime instead. A rung that is not ready (a local model nothing has loaded, a Codex login that expired) is skipped. If a model reaches a usage limit, becomes unavailable, loses its login, times out, is unloaded mid-draft or returns no output, TownReporter moves **only the unfinished call** to the next ready rung and records the requested and the actual model and effort. A provider refusal stops the run. Opus, Codex Astra and Claude Haiku are available only when an editor picks them by hand.

**Gemini is not on the ladder.** Gemini 3.8 Flash and Gemini 3.1 Pro (through the signed-in Gemini program) stay on every picker as named choices. Automatic and every failover never move a run to Gemini on their own.

### Named picks and receipts

A named pick is the recorded first choice. The Story page names the model while a draft runs ("Writer: <model> · picked: <pick>"), afterward shows **Last draft: <model>, <time>**, and shows every hop of a failover in order. An explicit pick that is unavailable is refused before it is queued, with how to restore it. **Draft anyway** is offered where a warning allows it.

- **Queue → Draft selected** runs one editor-chosen batch of up to five eligible leads on one named model, never Automatic. It retains each lead's saved research scope, shows each lead's durable result, and never publishes a story.
- **Daily Scan** uses the same named choices. It stores the requested model with the schedule and the runtime actually used on each job. A usage limit no longer pauses the daily scan.
- **Local model** supports individual models discovered on LM Studio, Ollama and llama.cpp, or a configured `LLM_BASE_URL` with `LLM_MODEL` and optional `LLM_API_KEY`. The owner can set it under **Models → Connections → Local & self-hosted**. A DeepSeek pick never follows the Local model setting to another server. See [docs/local-models.md](docs/local-models.md).
- **Supplied-only scope** tells the writer to use only the material you supplied, with no web search or fetch.
- A normal news lead is written by the report-local-news skill when the pick is DeepSeek or a Claude model; if the skill cannot finish, the same model writes the story the usual way and the page says so. Every other pick keeps the four-pass writer. A meeting lead always stays on the meeting path.

### How the CLI models are held

Codex and Claude use the operator's existing signed-in CLI sessions; no API key is required. `CODEX_CLI_PATH`, `CODEX_HOME` and `CLAUDE_CLI_PATH` are available when normal discovery cannot find the binary or Codex state directory. TownReporter uses the signed-in account only to authenticate its Codex CLI requests; a newsroom call does not inherit the operator's full Codex setup. Each call ignores Codex user configuration, starts from the system temporary directory, runs ephemerally with a read-only sandbox, and disables shell, computer, browser, apps, plugins, multi-agent and hook features. Built-in web search is added only when the trusted caller requests research. This is an application-level tool boundary, not an operating-system security sandbox: the reporting process still runs as the Windows account, and the read-only setting does not by itself restrict which files that account can read. Untrusted source material must therefore remain data, never an instruction to expand the task.

Claude Code is separately constrained. TownReporter omits the operator's `CLAUDE.md`, skills, plugins and MCP configuration, starts the CLI outside the application tree in restricted safe mode, and allows only `WebSearch` and `WebFetch` for a caller-authorized research request. Planning calls hide all tools; OCR has a narrow exception that reads one generated temporary page. The reporting job does not receive shell, arbitrary file, browser or agent tools.

DeepSeek runs through that same restricted Claude Code CLI against a small relay on `127.0.0.1` that sets the thinking budget from the run's effort (off at the default, effort none); setting `TOWNREPORTER_CLAUDE_CODE=0` sends it by plain HTTP instead.

The CLI is slower than an API: it reloads a fixed preamble per call, so a draft takes minutes rather than seconds. Time budgets adjust on their own, and each writing model has its own **Time per call** on the Server page.

### Opinion

The picker offers Automatic (the default), every named model, Local model and saved custom connections. The writer reads the configured private voice file, researches while writing, and a provider refusal or invalid delivery leaves the request failed without a draft. The voice is a file on disk that you point at with `TOWNREPORTER_VOICE_FILE`; it is not in this repository. DeepSeek, Local model and saved connections have no web search of their own, so the desk does the searching first, the newsroom's own record before the open web, under the same voice.

### Other models: one OpenAI-compatible URL

TownReporter talks `/v1/chat/completions`. Any of these work by changing three env vars. **No extra npm package.**

| Gateway                                                                         | Example `LLM_BASE_URL`                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [LiteLLM](https://github.com/BerriAI/litellm)                                   | `http://127.0.0.1:4000/v1`                                                         |
| [Bifrost](https://github.com/maximhq/bifrost)                                   | `http://127.0.0.1:4000/v1` (do **not** bind Bifrost to 8080, that's TownReporter)  |
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

For a per-run, editor-selected endpoint instead of changing the configured provider, use **Server → Add your own AI API**. Save a name, base URL, optional server-side key and either a discovered or manually entered model, then use **Test connection** (it shows the requested and the reported model) before selecting it in Scan, Story, Opinion or Dark Desk. This is an explicit opt-in and does not change Automatic or fallback defaults. See the [connection guide](docs/custom-ai-connections.md).

| Set this                                        | What runs                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint; Automatic tries this gateway first          |
| `ANTHROPIC_API_KEY`                             | credentials for selected Claude models                                       |
| _nothing_                                       | Automatic walks the ladder above                                            |

There is no `XAI_API_KEY` rung: Grok (xAI) was removed as a provider, the key is ignored, and an install that still sets it is told so once at start-up. A saved Custom AI connection reaches any OpenAI-compatible endpoint you want.

---

## Database

Unset `DATABASE_URL` → embedded PGLite. **Data dies when the process stops.** Fine for a look; not a newsroom.

Postgres (Neon, RDS, your box):

```
DATABASE_URL=postgres://user:pass@host:5432/townreporter
```

The server refuses to serve a database that is behind its migrations (HTTP 503) until they are applied; the operator is told which files to run.

---

## Sign-in

- **Self-host:** on an unclaimed desk, the first account must enter the one-time setup code; the sign-in form identifies its location. After that account owns the desk. Generate and securely save owner recovery codes from **Server → Recovery codes** before you need them. If you lose the password, use **Lost your password? Use a recovery code** on the sign-in screen; an unused code supplies a one-time temporary password to sign in with and then change. This is not an email password-reset service. **Give up the desk** unclaims it; the next owner must enter the setup code required for an unclaimed desk. It is not password recovery.
- Email and password on `/login` is the only door, on every host. There is no broker and no third-party sign-in.
- Under **Server → Invite an editor** the owner creates a one-time link, good for seven days and for one address; the owner can cancel pending invitations.
- Local with no login at all: `VITE_AUTH_ENABLED=false`. Do not do that on a public host.

---

## Playwright

`npx playwright install chromium` once. Without it, city YouTube **Show transcript** and JS-heavy civic sites (Municode, and PrimeGov if the API moves) will not render, and the one-time Chromium retry of a source that refuses automated reads is unavailable. PrimeGov packets still work: they are a JSON API + PDFs.

---

## Layout

| Path                                         | What                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/`                                          | Public paper                                                                                                              |
| `/?topic=opinion`                            | Editorials: unsigned, the paper's own position. The Opinion link in the masthead; the same route as the paper, filtered.  |
| `/about` · `/how-we-report` · `/corrections` | Masthead pages                                                                                                            |
| `/sitemap.xml` · `/robots.txt`               | For search engines                                                                                                        |
| `/evidence/:versionId`                       | An excerpt of the captured record a printed story cited                                                                   |
| `/evidence/compare`                          | Two captures of the same URL, side by side                                                                                |
| `/get-the-code` · `/TownReporter.zip`        | Download this newsroom's own source                                                                                       |
| `/desk`                                      | Today: the editor home (sign-in)                                                                                          |
| `/desk/queue`                                | Draft / hold / kill / publish                                                                                             |
| `/desk/drafts`                               | Drafts in progress and finished, with readiness                                                                           |
| `/desk/story/:id`                            | Workbench: lead, draft, checks, sources and Find evidence, publish                                                        |
| `/desk/published`                            | Live stories + public corrections                                                                                         |
| `/desk/opinion`                              | Opinion. Writes an unsigned editorial.                                                                                    |
| `/desk/follow-ups`                           | AI follow-ups that keep working on a question                                                                             |
| `/desk/dark`                                 | Dark Desk. Investigates. Never prints. Two dials.                                                                         |
| `/desk/sources` · `/desk/scan`               | Watch list + bulk paste · Scan history (the expensive button, not a loop)                                                 |
| `/desk/models`                               | Models: who does what, connections, the Local model                                                                       |
| `/desk/ops`                                  | Server. Health, backups, paper setup, and the few buttons worth having.                                                   |
| `/desk/stats`                                | Stats without naming a reader                                                                                             |
| `/desk/import` · `/desk/memory` · `/desk/legal-removals` | Import · Beat memory · Legal removals                                                                         |
| `/feed`                                      | RSS                                                                                                                       |
| `/login`                                     | Create account / sign in                                                                                                  |

The dated `HANDOFF-*.md` session records at the repo root are not TownReporter documentation. They are personal handoff notes from the App Builder sandbox this repo was originally scaffolded with. They stay in this repository as history and are excluded from every release archive (`.gitattributes` marks them `export-ignore`), so an installed copy never carries them. (`HANDOFF-NEXT-AGENT.md` is the current handoff, is linked from `SELF-HOSTING.md` and the release guides, and does ship.) The sandbox's own material, its agent contract (`AGENTS.md`, `AGENTS.project.md`), the `.grok/` skill trees, its `startup.sh` and its preview host bridge, has been deleted outright, and `scripts/no-grok-scaffold.test.mjs` fails if any of it comes back. If you are here to understand the newspaper, start at the top of this file, not in the handoffs.

---

## Owner-only legal removal

Published stories have a separate [legal-removal workflow](docs/editor.md#legal-removal-owner-workflow): review connected and historical copies, choose 12-calendar-month owner-only retention or an explicit no-retention destruction policy, and follow the result to an audited case. Known shared captured copies block destruction. Backup cleanup remains an operator task with attributed attestations; retained copies have owner access controls, not encryption. Ordinary Delete remains 30-day trash. Release and deployment status are tracked in [TODO.md](TODO.md).

## Frequently asked questions

**Is this a newspaper?**
It is a newsroom you run. Ordinary stories that print have a human gate; approved routine notices can use the notice-roundup path described above. It is not a newspaper of record, not the city, and not a wire service. Treat every draft as a first draft you still have to report.

**Will it publish by itself?**
Ordinary reporting does not: scans file leads, drafts go to the workbench, and a person reviews and publishes them. Only the owner-approved routine formats (Today in town, This weekend, Deadlines approaching) can publish automatically, after their source, eligibility, freshness, conflict, review-history and idempotency checks pass.

**Can I use this for any city?**
Yes. The first owner completes **Set up the paper**, and can revise the same database-backed settings later on the Server page. No source edit or rebuild is required. See [docs/setup.md](docs/setup.md#point-it-at-another-city).

**Do I have to pay for an AI key?**
No. Story drafting can use a signed-in Codex/Claude CLI, a model on your own hardware, or a configured `LLM_BASE_URL` gateway. Set `ANTHROPIC_API_KEY` if you would rather bill a Claude key, or point `LLM_BASE_URL` at an OpenAI-compatible endpoint. That configured gateway becomes Automatic's preferred first runtime. Recognized technical failures can move only the unfinished call; refusals stop. Grok (xAI) is no longer a provider: `XAI_API_KEY` is ignored, with a start-up warning saying so. A hosted Ollama model (such as the DeepSeek build the paper uses) is a cloud service and may spend credits.

**Why is Gemini not in Automatic?**
A run once fell to Gemini after DeepSeek and Codex were unavailable, and the owner ordered it out of the rotation. Gemini 3.8 Flash and Gemini 3.1 Pro are still on every picker; an editor chooses them by name.

**Are YouTube captions the official record?**
No. Captions are a map of the tape. Minutes and the packet are the official record. Names in captions are often wrong. Dark Desk is told this; drafts still need a human check.

**What's Dark Desk?**
The investigative lane. An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Remaining pages stay on the file. It has no publish button. Editor UI: [docs/dark-desk-editor.md](docs/dark-desk-editor.md) and [docs/editor.md](docs/editor.md#dark-desk-deskdark).

**What's the Opinion desk?**
Give it a subject, a sentence, or a URL and it asks the selected provider for an unsigned editorial: OPINION in the headline, no byline, because an unsigned editorial is the paper's own position. Claims and sources run in an appendix at the end. It is a draft until you publish it. If a provider declines or returns an assistant message instead of a real piece, the run is marked Failed and no draft, Read/Edit action, or Publish button is created. The writing voice is a file on disk that you point at with `TOWNREPORTER_VOICE_FILE`; it is not in this repository, and only its path ever reaches a command line.

**Does anything leave my machine when I use the desk?**
Yes, and it is worth knowing which things. Reading the paper sends nothing anywhere: fonts are served from this machine, there is no analytics script, and a cold load makes zero requests to any outside host; the browser-based `npm run smoke` check enforces this. That only covers the reader. Working the desk is different: pages you watch and documents you pull are fetched from the sites that host them; Scan and Dark Desk model calls go to the configured provider; Story calls go to the effective provider stored for that run (which may be Codex, Claude, Ollama or a configured gateway); and searches (the research pass, PULL, and every Dark Desk hop) go to a third-party search chain, tried in order: Exa's hosted endpoint (`https://mcp.exa.ai/mcp`), then DuckDuckGo, Bing, Brave and Wikipedia. None needs an API key, and there is no setting to keep a search on this machine; the chain runs unconditionally (`src/lib/news/search-web.ts`). That means a name, an LLC, or a contract number you type into Dark Desk is seen by whichever provider answers it. Search by meaning runs inside this server process and stores vectors only.

**What are the Dark Desk dials?**
_Dig_ is how far it chases: hops, searches, whether it leaves the watch list. _Nerve_ is how speculative it may be: how sure it has to be before it writes a signal down, and whether it may propose a theory or only ask a question. Three floors never move at any setting: no invented claims of paid influence, everything is labelled, and every theory carries what would kill it.

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

Deterministic, offline and free by default: no provider is contacted and nothing is billed. The test launcher removes any inherited `DATABASE_URL` and `RUN_LIVE_MODEL_TESTS` before the suite starts, so destructive fixture cleanup can only reach embedded PGLite or a disposable database a test creates itself, and a stale shell flag cannot turn an ordinary run into a paid evaluation. The live model evaluation is separate and opt-in (`RUN_LIVE_MODEL_TESTS=1 npm run test:live-model`), because a default suite that calls a paid API is neither reproducible nor free. Meeting ingest, retrieval, draft stripping, configured-timezone dates, printed-headline collapse, version lock, auth, paper setup, and Dark Desk loop coverage live in `src/lib/news/*.test.ts`.

---

## License

[MIT](LICENSE). Copyright (c) 2026 Scott Converse.

Created by **Scott Converse**. Companion civic tools: [civic-transparency-toolkit](https://github.com/scottconverse/civic-transparency-toolkit), [civic-newsroom](https://github.com/scottconverse/civic-newsroom).

## Opinion documents and review

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Both writers read the complete configured voice and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and is flagged at Publish until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](docs/editor-desk.md) for the complete editor flow.

Dark Desk walks the same Automatic ladder as stories and scans (DeepSeek v4.1 Flash 1017, the loaded Local model, Codex Sol 6.1 (balanced), Claude Sonnet 5.5), and only the unfinished stage moves to the next provider if a login has lapsed or synthesis does not respond in time. Claude Haiku plans Claude runs and Codex Luna plans Astra/Luna runs. Research is checkpointed before synthesis, so a synthesis retry does not repeat completed searches or document reads. Each round enforces one wall-time, model-call, search, and document-read budget and stores its actual call ledger when the provider reports usage.

---

## Architecture diagrams

Twelve rendered diagrams, each with its Mermaid source beside it. The index is [docs/diagrams/README.md](docs/diagrams/README.md); the write-ups are [docs/manual.md](docs/manual.md) Part 5 and [docs/diagrams/scan-architecture.md](docs/diagrams/scan-architecture.md). Two are drawn above.

| Diagram | Rendered | Source | What it shows |
| --- | --- | --- | --- |
| System context | [system-context.svg](docs/diagrams/system-context.svg) | [.mmd](docs/diagrams/system-context.mmd) | What the newsroom talks to, shown above |
| Data model | [data-model.svg](docs/diagrams/data-model.svg) | [.mmd](docs/diagrams/data-model.mmd) | The database shape: newsrooms, sources, snapshots, anomalies, leads, drafts, articles, corrections, investigations |
| Keeping it online | [keeping-it-online.svg](docs/diagrams/keeping-it-online.svg) | [.mmd](docs/diagrams/keeping-it-online.mmd) | Tunnel, watchdog, and what keeps a deployment answering |
| Pipeline: source to printed page | [pipeline-source-to-page.svg](docs/diagrams/pipeline-source-to-page.svg) | [.mmd](docs/diagrams/pipeline-source-to-page.mmd) | Watch list to lead to draft to editor to paper; the red box is the only way to print |
| How a meeting becomes a story | [meeting-to-story.svg](docs/diagrams/meeting-to-story.svg) | [.mmd](docs/diagrams/meeting-to-story.mmd) | A recording to a lead to a bounded draft to the publication gate, shown above |
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

- **[0.6.84](docs/releases/0.6.84.md)** (2026-10-27), the current version. One shared model picker and the Automatic ladder (DeepSeek v4.1 Flash 1017, Local model, Codex Sol 6.1 (balanced), Claude Sonnet 5.5); Find evidence and search by meaning on the editor desk; the Today in town list; warn-never-block with audited "anyway" buttons; a rebuilt Dark Desk; newsletters; Excel, PowerPoint and LibreOffice reading; three-day backups on D: from the ops script.
- **[0.6.83](docs/releases/0.6.83.md)** (2026-10-06). Assignment-scoped reporting packages, private evidence review, sourced corrections and targeted follow-ups, whole-meeting coverage with an action ledger, and reviewable source discovery.
- **[0.6.82](docs/releases/0.6.82.md)** (2026-09-28). Fixes from the 0.6.81 live walk.

Release notes for every earlier version are in the [release history](docs/releases/README.md). Line-by-line detail is in [CHANGELOG.md](CHANGELOG.md).
