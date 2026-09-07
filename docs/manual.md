# TownReporter — the manual

Dark Desk uses the city and state saved in Paper setup, plus its configured county. It does not inherit Longmont jurisdictions for another town. The Reddit check requires one unambiguous subreddit among this newsroom's accepted Sources; otherwise it is unavailable and links to Sources. No subreddit is guessed from a town name.

**Version 0.6.27 · 7 September 2026**

**Documentation scope:** The Command Center and Dark Desk images are current local development captures. Queue, workbench, Opinion and Paper setup images are
development examples; the other screens are historical Longmont captures from
29 August. Their old **Leave as editor** header link now lives as **Give up
the desk** on the Server page.

TownReporter is a civic newsroom you run yourself. A public paper on the front,
a signed-in editor's desk behind it. It watches a city's meetings, packets,
minutes, money and contracts, notices when something changes or fails to appear,
and hands an editor a lead. Nothing reaches the paper until a person publishes
it.

The working edition covers Longmont, Colorado, at
[townreporter.org](https://townreporter.org). The code is MIT licensed. Point it
at your own city.

---

## Contents

**Installing on Windows?** Start with the [Windows installation guide](windows-install.md): download, provider setup, persistent database, start/stop and your first editorial workflow. The source setup remains available for Windows, macOS and Linux.

- [Part 1 — What it is](#part-1--what-it-is)
- [Part 2 — The desk, screen by screen](#part-2--the-desk-screen-by-screen)
- [Part 3 — Running it](#part-3--running-it)
- [Part 4 — How it is built](#part-4--how-it-is-built)
- [Part 5 — Architecture](#part-5--architecture)
- [Part 6 — Reference](#part-6--reference)

---

# Part 1 — What it is

## Current capabilities and remaining work

The Command Center uses Fable Direction A: composer and queue in the main
column; Dark Desk, Follow-ups and wire in the rail. Follow-ups record who was
asked, what is due and when; replies can be added to story reporting notes.
The story workbench stacks below 1024px. Historical screenshots elsewhere in
this guide illustrate workflows, not the current layout.

Dark Desk now separates speculative Black Desk signals (confidence ≤0.5) from
structured Dark Signal verification. See [the doctrine and its limits](dark-desk.md).
The verified label is a completed software protocol, not a substitute for
checking sources. The five-topic live acceptance exercise remains outstanding.

Local models can be discovered on LM Studio, Ollama or llama.cpp and selected
individually. Scanned PDF OCR supports embedded JPEG/PNG images, with limits of
12 extracted images, 2 MiB each and 10 minutes total. The extractor does not
establish PDF page order: new OCR records identify images, not PDF pages.
Historical stored OCR page labels require re-ingest or operator review if cited. Unsupported fax-style scans, failed
transcription and partial reads are reported rather than treated as complete.

Configurable sections are available in Paper setup (see Newspaper sections below).
Manual investigative page watching is available in Dark Desk. The owner-only legal-removal workflow is separate from normal Delete; see its section below. [The canonical queue](../TODO.md) records current work.

## Newspaper sections

The owner manages sections in **Server → Newspaper sections**, below Paper setup. Add a name and permanent key, rename a display label, move sections up or down, or hide them from the newspaper's section navigation. Keys cannot change after saving: existing story and section links stay valid. Hiding does not delete stories or prevent filing.

For reporting sections, enter a reporting brief and scan instructions, then select accepted Sources. **Scan → Scan scope** offers General or a section. A section run uses only its assigned accepted sources and saves the guidance and source IDs with the queued run. Later configuration edits do not change that run; a source dropped before execution is excluded. A section without accepted sources cannot start. General retains all accepted sources.

**Preview changes** shows proposed navigation and retirement impact without saving. **Cancel changes** discards the proposal. **Apply changes** saves, confirms the result and links to the newspaper. If another owner tab saved first, the stale save is refused and your edits remain visible; **Reload saved configuration** explicitly replaces them with the saved version.

Retire a section only into an active reporting section. Review the count of affected leads, drafts and articles, then use **Confirm retirement and apply**. Their section changes; their identities, article URLs and text remain. Old section links follow the replacement, including later retirements. Opinion and About remain reserved page routes: they cannot retire and do not run section scans. Their section-list labels and visibility do not remove the permanent page links.

Editors can use configured sections when filing and scanning; only the owner changes their configuration. Existing legacy topic keys are preserved during migration. These changes require a normal release and local-operator promotion; this repository does not establish the deployed version.

## Two rooms

|                        | What it is                                                       | Who sees it       |
| ---------------------- | ---------------------------------------------------------------- | ----------------- |
| **The paper** (`/`)    | Stories and editorials a human published, with the sources shown | Anyone            |
| **The desk** (`/desk`) | Watch list, scan, queue, drafts, Dark Desk, Opinion, Server      | Signed-in editors |

There is no automated path to the masthead. A machine can find a lead, fetch the
document, write a draft and tell you what it thinks. It cannot publish.

![The front page](images/01-front-page.png)

## The six moves

The paper describes its own method at `/how-we-report`. This is that method, in
the same order the software performs it.

1. **Watch.** A list of civic sources — city site, council, planning, the agenda
   portal, the school district, the county, the municipal utility, the city's
   YouTube channel, public-access television. The list is a starting point, not
   a fence; newly discovered public records are fair game.
2. **Detect.** A scan fetches those pages, hashes each against the last
   snapshot, and flags three things: what changed, what disappeared, and what
   failed to appear when it usually does. The third is the one nobody else
   watches.
3. **Follow.** Before a story is drafted, the desk asks what the announcing
   source leaves unexplained, then follows attachments, names, companies,
   contracts, parcels and prior meetings.
4. **Preserve.** Significant captures are stored. If a record later vanishes,
   the captured version remains and the article says so.
5. **Investigate.** Dark Desk is the recursive lane — competing hypotheses,
   unresolved identities, trails left open until new evidence reopens them. **It
   never prints.**
6. **Write, then gate.** Drafts are reported stories, not recaps. Hold, kill or
   publish is a person. Every material claim should be checkable against a
   document the paper shows you.

Corrections are public. Editorial policy is to correct a published story openly; a correction
runs as a dated note above it.

**Delete is always available**, before or after printing — a lead filed against
the wrong person, a scan that swept up something private, a story that should
never have run. Kill is not delete: a killed lead stays on the desk under
Killed. Delete removes the thing. Each one confirms in place and says what it
costs; taking a story off the paper says plainly that its URL becomes a 404 and
that a correction is what the paper normally does instead.

**Nothing deleted is gone straight away.** A copy waits 30 days under _Recently
deleted_ on the Server page, and an **Undo** appears where the delete happened.
Restoring puts the row back with its original id, so an article's corrections
and an editorial's fact sheet come back attached rather than orphaned.

![A published story](images/02-article.png)

## What it will not do

- It will not fact-check for you. Models invent facts, misattribute quotes and
  mangle names — especially names taken from auto-captions.
- It will not treat captions as minutes. Captions are a map of the tape. The
  packet and the minutes are the record.
- It will not print anything from Dark Desk. That desk has no publish button by
  design.
- It will not tell you it is finished when it has stopped early. A dark file
  that stops mid-trail says so, and says how much is left unread.

You are responsible for everything that appears on the paper.

## What the reader gets

- Fonts are self-hosted and no third-party script runs on the page. A cold load
  of the paper makes **zero requests to any outside host**, proven rather than
  asserted: `npm run smoke` loads the front page in a real browser and fails the
  build if any request leaves the machine.
- Every story has its own title, description, canonical URL, published time and
  social card.
- An RSS feed at `/feed`, a `sitemap.xml`, and a `robots.txt` that points at it.
- The sources under every story, as links, including captured copies when the
  original has moved.

---

# Part 2 — The desk, screen by screen

The full editor's guide, with what to click and what each screen is for, is
[docs/editor.md](editor.md). This is the tour.

## Set up the paper

`/desk/setup` — the first screen after the owner creates a fresh desk.

![Set up the paper](images/13-paper-setup.png)

The owner names the paper and its city, chooses the IANA timezone, adds an
optional council-votes link and editor contact, then supplies the first watch
list. Two new boxes control meeting discovery: **Meeting video channels**
accepts one YouTube channel URL per line, and **Meeting title keywords** accepts
the phrases that distinguish council, board and commission tapes from ordinary
city videos.

Saving the form writes those choices to the database, rewrites the welcome
article for the configured city, and opens the desk. Until it is saved, the
public site says “Not yet set up” and publishes no stories. The owner can change
every choice later under **Server → Paper setup**; no code edit or rebuild is
required.

## The desk

`/desk` — what needs you, and everything in flight.

![The desk](images/04-desk.png)

The current development image shows the queue in the main column and Dark Desk, Follow-ups and wire in the rail. When present, **Needs you** links flag outstanding actions such as drafts and proposed sources. Review the queue and Follow-ups even when no alert is shown.
As of 0.6.21 the desk is one main column (composer, then the queue) with a right rail: Dark Desk, Follow-ups, The wire.

## Scan

`/desk/scan` — the expensive button.

![Scan](images/05-scan.png)

One press reads every watched source, hashes it against the last snapshot, and
files what changed as leads. It is a button, not a loop: it runs when you ask.
Previous scans are listed underneath with what each one found.

## The queue

`/desk/queue` — everything that might be news, scored and sorted.

![The queue](images/06-queue.png)

The scanner files here, Dark Desk files here, and so do you. The number on the
left is the score. `NEW`, `DRAFTED`, `HELD`, `KILLED` are the states. Nothing
prints until you open a lead and publish it.

Each active row has its own Writing model picker and Draft/Redraft with AI
button. Automatic resolves one ready provider before enqueue and the result is
shown on that same row. If that provider's login lapses partway through the
run, Automatic moves to the next ladder rung once, if it is ready, and the
row shows which one took over. A named provider never falls back, at
enqueue or mid-run.

**Set up a writing model** opens help beneath every Queue, workbench and
Opinion picker, even when drafting is unavailable. Follow the installation and
sign-in steps on the computer/account running TownReporter, then reload and
retry. Opinion's help also covers the required editorial voice file. This is
guidance, not an automatic installer or sign-in button.

## The story workbench

`/desk/story/:id` — where a lead becomes a story.

![The story workbench](images/07-story-editor.png)

The lead and the reporting notes are on the left and never print. The draft is
on the right: headline, dek, topic, body. **Redraft** rewrites the story from
the notes with the provider selected beside it. A failed job's message remains
after reload and includes safe provider detail when available. **PULL** next to
an unfinished to-do goes and fetches that specific
document. **Publish to the paper** is the gate — after that, the story is only
ever corrected, never silently edited.

## Dark Desk

`/desk/dark` — investigates, never prints.

![Dark Desk](images/08-dark-desk.png)

Three piles: **To look at** is new, **On the desk** is started, **Set aside** is
parked. Nothing is deleted. Paste a URL, a person, an LLC, a contract number, a
rumour or a paragraph of text and it opens a file: it searches, fetches, keeps
copies, follows names, and writes down what it thinks connects — labelled, and
always with what would kill the theory.

A file that stops mid-trail is normal. It says how many pages it has not opened
yet and waits for **Keep digging**.

### The two dials

![The Dark Desk dials](images/09-dark-dials.png)

- **Dig — how far it chases.** Hops, searches, whether it leaves the watch list,
  how far it follows a name into a company, a parcel, a contract.
- **Nerve — how speculative it may be.** How sure it has to be before it writes
  a signal down, and whether it may propose a theory or only ask a question.

The sentence above the sliders is computed from the same functions the run uses,
so what the panel promises and what the run does cannot drift apart.

Three floors never move, at any setting: no invented claims of paid influence,
every signal is labelled with how mature the evidence is, and every theory
carries what would kill it.

## Opinion

`/desk/opinion` — the paper's own position.

![Opinion](images/10-opinion.png)

A subject, a sentence or a URL becomes an unsigned editorial. `OPINION` goes in
the headline and there is no byline, because an unsigned editorial is the
paper's position rather than one writer's. Claims and sources run in an appendix
at the end, where a reader who dislikes the piece can check them.

Opinion shows Automatic and Claude Opus (both use Claude Opus), plus Local model. Codex is
not offered here: its model declines to write an editorial that takes a
position on a local policy question, so it stays on the Story picker. Claude
Code reads the voice by file path for the writing pass. The page
lists every missing voice, installation, or login prerequisite and stays
disabled while readiness is unknown.

A successful process exit is not enough to file a piece. TownReporter rejects
provider refusals, assistant notes, implausible headlines, and incomplete
bodies before draft storage. Automatic currently uses Claude only; a failed
run reports the failure without switching to Local model. An explicit choice
also never switches providers. A
failed row has no Read, Edit, or Publish action; a finished row shows the
provider that actually delivered it.

**Edit**, on the row, opens the piece in its own workbench at
`/desk/story/draft/:id`: headline, dek, topic and the piece itself, plus the two
boxes that never print. Save, publish, or delete it from there.

It fetches records before it writes. Historical runs took **ten to forty
minutes** — two finished at 9m53s and 24m06s, and one was still going at 30.
Those are observations, not a deadline: `EDITORIAL_TIMEOUT_MS` now applies to
each research or writing pass, with a default of 45 minutes per pass. A pair
can take about 90 minutes. Automatic currently runs the Claude pair only.
Explicit Local model performs one writing call using the supplied material;
it does not run the frontier research pass. The page shows a
running clock and checks every twenty seconds. Editorials remain drafts until
you publish one.

It is also the most expensive thing the newsroom does. Those same two finished
runs cost **$2.66 and $23.76**; the second decided to dispatch research agents
of its own. Budget for a piece, not for a paragraph.

## The Server page

`/desk/ops` — everything this machine is doing to keep the paper online.

![Server](images/11-server.png)

Historical 0.5.1 screen: the status row pictured here no longer exists under
that name. A browser smoke test checks the same thing now.

The Windows installation package reports version, work queue, private database
and local HTTP readiness. Run health check is read-only; Restart the paper asks for
confirmation and restarts only this installation. It installs no tunnel,
watchdog or scheduled tasks, and does not promise automatic repair. Local
readiness does not prove public access. Unavailable maintenance actions stay
disabled; its Start/Stop launchers remain available when the desk cannot open.

Separately configured legacy installations can also report their public URL,
tunnel and watchdog task. Those checks run from the server, not from a reader's
computer. See [the editor guide](editor.md#server-deskops) and
[legacy ownership requirements](../SELF-HOSTING.md) before using those controls.

The owner also sees **Paper setup**, with the same fields used on first run, and
**Invite an editor**, which creates a one-time, email-bound link that expires
after seven days. Editors can work the whole desk but cannot change owner-only
settings or invite another editor.

## Stats

`/desk/stats` — editor-only, right after Server in the nav.

Raw page views, not unique visitors: no cookies, no fingerprinting, no IP or
user-agent stored, just a daily count. Shows the site total (all-time, last
7 days, last 30 days) and every published story ranked by views.

Counting is decoupled from page render on purpose: a client beacon fires
after a public page has already loaded and pings a lightweight endpoint that
validates the target, swallows its own errors, and always answers fast. A
stats failure can never slow or break the public page — this page simply has
nothing new to show until it recovers. Scoped to your newsroom. See
`src/lib/news/views.ts` and `migrations/0037_page_views.sql`.

## Published

`/desk/published` — what is live, and its corrections.

![Published](images/12-published.png)

---

# Part 3 — Running it

## Run from source on your own machine

You need **Node 22+**. API keys are optional: Story can use an
existing Codex/Claude login. Signed-in Codex and
[Claude Code](https://code.claude.com) CLIs supply the frontier Story and
Opinion choices.

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

Open `http://localhost:8080/login` and create an editor account. The first
account becomes the newsroom owner. There is no setup token: it was removed in
0.5.1, because a one-person newsroom that could not re-issue the token had a
lock with no locksmith. Sign-in is limited to ten attempts every five minutes
from any one address, which is what keeps an open desk from being a guessable
one.

After account creation, complete **Set up the paper**. The public paper remains
neutral and empty until that form is saved.

The public paper is `/`. The desk is `/desk`.

## Database

Unset `DATABASE_URL` and it runs on embedded PGLite. **Data dies when the
process stops** — fine for a look, not for a newsroom.

```
DATABASE_URL=postgres://user:pass@host:5432/townreporter
```

Migrations run on `npm run build`, and can be run alone with `npm run
db:migrate`.

## The model

Low-level configured-provider precedence is below. Per-run explicit choices on Story, Scan and Dark Desk override this chain; Automatic uses the configured gateway when present, otherwise the readiness ladder.

| Set this                                        | What runs                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint; also forces Story/Scan Automatic to it |
| `ANTHROPIC_API_KEY`                             | Claude, billed to that key                                        |
| _nothing_                                       | **Claude, through your Claude Code login**                        |
| `XAI_API_KEY`                                   | Grok                                                              |

### Drafting scope and evidence review

**Write a story** and the story workbench offer **Research public sources** or **Use only supplied material**. The latter opens only explicitly supplied URLs and reads the supplied text; it skips discovery and external searches. Its queued scope survives retries and provider selection. Choose Claude or a local/API model for supplied-only work; Codex is refused because its native tools cannot enforce that boundary. Instructions pasted inside source material do not replace this control.

After a body edit, drafts with reporting evidence require an explicit evidence review before publishing. Keep the evidence only after checking it against the revised text, or remove the old public evidence. Removal preserves the original private draft archive and does not remove body links. An evidence-review decision is refused if its saved draft has changed, and these actions remain scoped to the editor's newsroom. See [the workbench instructions](editor.md#draft).

### Which feature uses which provider

Every feature that calls a model has an editor-facing, per-run picker. Dark
Desk was the last one without: until 0.6.2 it used the configured-provider
chain, so a round ran on whatever the machine happened to prefer and the
editor could not say otherwise. Scan picked up its picker in 0.6.1, for the
same reason.

All four pickers are generated from one registry,
`src/lib/news/provider-registry.ts`. An entry there carries the label, the
model identifier, the environment variable that overrides it, the off switch,
the time budgets, and which pickers offer it. Adding a provider is one entry;
the registry is the canonical picker definition; provider adapters still implement their transports.

| Feature                       | Provider                                                                                                                                       | Model                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Scan                          | configured gateway forced for Automatic when set; otherwise first ready Claude Opus → Codex Terra rung, with one mid-run failover to the next rung if that login lapses (reusing the sources already fetched, not fetching them again); explicit choice never falls back | Codex Terra/Sol, Claude Opus, or Local model                                |
| Draft (Queue or workbench)    | configured gateway forced for Automatic when set; otherwise first ready Claude Opus → Codex Terra rung, with one mid-run failover to the next rung if that login lapses; explicit choice never falls back        | Codex Terra/Sol, Claude Opus, or Local model                                |
| **Write a story** (desk landing page) | files the lead, then the same Draft ladder above                                                                                       | Codex Terra/Sol, Claude Opus, or Local model                                |
| Dark Desk synthesis and brief | the one you pick beside **Keep digging**; Automatic behaves as it does for Draft, with one mid-run failover at the round level                  | the one you picked                                                          |
| Dark Desk **planner**         | the one you pick                                                                                                                               | a cheaper model from the SAME provider: Haiku on Claude, Terra on either Codex, and your own model on a gateway |
| **Opinion (editorials)**      | Claude Opus, through the signed-in Claude Code session, or Local model; Codex is not offered for editorials                                     | Claude Opus, or Local model                                                |

**Why Opinion excludes Codex.** An editorial uses the paper's configured
voice and frontier research; Codex is not offered for editorials because
its model declines to write a piece that takes a position. The local
model carries no such refusal, so Opinion's picker offers Automatic,
Claude Opus, and Local model. (Zen MiMo and the earlier, model-specific
Local Qwen entry were removed from every picker 2026-09-02; 0.6.10
brought a generic local pick back.) Claude Code
receives the voice by file path, and its writing pass is tool-free. The
explicit Local model path sends validated voice text as a system message to
the selected model server. It uses supplied material without a separate
research pass; the writing pack records that no gathering pass ran.

**The planner split.** Planning on Haiku costs about a quarter of planning on
Opus for the same output, so the desk substitutes it — but only within the
same provider. Claude plans on Haiku; either Codex plans on Terra; a
configured gateway is left alone. Pointing `LLM_BASE_URL` at LM Studio does
not make the desk ask a local endpoint for a Claude model; it uses yours. As
of 0.6.2 the substitution follows the model you picked for that round, not
whatever the machine's own precedence would have chosen.

### Time budgets

Each provider ships with a per-call ceiling: 150 seconds on the Claude Code
and Codex CLIs (they spawn a process and reload a large preamble every call),
180 on Automatic and a configured gateway, and 600 for the local model entry.

The owner can change the per-call number for any provider on the **Server**
page, under Writing models: **Time per call**, in seconds, with the shipped
default shown beside it and a **Reset**. Between 10 seconds and 60 minutes.
The answer is stored per paper in `provider_settings`
(`migrations/0029_provider_settings.sql`); Reset clears the row's number
rather than writing today's default into it, so a paper that never made a
decision keeps inheriting improvements to the defaults.

This exists for local models. A 30B answering a 20,000-character pack on the
same machine takes minutes, and the 150-second ceiling would report that as a
failure every time.

Pointing `LLM_BASE_URL` at a local model sends Scan, Dark Desk, and Story
Automatic to that gateway. An explicit Story choice still forces its named
provider. Opinion offers Claude Opus or Local model.
What that actually costs in quality was measured on this machine:
[docs/local-models.md](local-models.md).

Signed-in CLI paths use the operator's subscription/quota; API-key paths can incur API charges. It is slower than an HTTP API because
it reloads a fixed preamble on every call, so a draft takes minutes rather than
seconds; the time budgets adjust on their own.

Your own `CLAUDE.md`, skills and plugins are **not** loaded into news prompts.
Claude strips settings with `--setting-sources ""`. Codex is deliberately the
opposite: it loads the user's native configuration, rules, repository
instructions, skills and plugins, keeps search and local tools available, and
runs with `danger-full-access` rather than a TownReporter-imposed read-only
sandbox. It has the same available access to `C:\` as the signed-in account.

## The Opinion voice

The Opinion desk writes in a voice held in a file on disk, named by path:

```
TOWNREPORTER_VOICE_FILE=C:/Users/you/.townreporter/voice/your-voice.md
```

The file is deliberately outside the repository, and the app refuses a path
inside it. On Claude, only the **path** reaches the CLI. For explicit Local
model, TownReporter reads the validated file and sends its text as a system
message to the selected model server. The voice is not a command-line argument.
Without the file, the Opinion desk says so and spends nothing.

## Serving it publicly

The following describes the **legacy Halo installation**, not the Windows
installation package. Its local operator must first establish the
[legacy ownership configuration](../SELF-HOSTING.md). The package does not
install these tasks or a tunnel and refuses these legacy operations.
The `ops/` directory holds that installation's scripts:

| Script                         | What it does                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `ops/watchdog.ps1`             | Every five minutes: check the app, the tunnel and the public URL; restart what is down; write what it did           |
| `ops/run-tunnel.ps1`           | Start `cloudflared` for this hostname                                                                               |
| `ops/restart-app.ps1`          | Stop and start the paper                                                                                            |
| `ops/restart-tunnel.ps1`       | Stop and start the tunnel                                                                                           |
| `ops/rotate-logs.ps1`          | Keep `logs/` from growing without bound                                                                             |
| `ops/status.ps1`               | Is it up? Read-only, and it answers when the paper is down and `/desk/ops` cannot                                   |
| `ops/TownReporter Control.cmd` | The same, for someone who does not want a terminal. Double-click, pick a number.                                    |
| `ops/run-hidden.vbs`           | Runs the five-minute tasks with no console window                                                                   |
| `ops/install-tasks.ps1`        | Registers all six scheduled tasks. Idempotent, `-WhatIf` supported, and refuses to repoint another install's tasks. |

In that legacy installation, restart and tunnel-restart run as Windows scheduled tasks rather than as child
processes of the app — a restart cannot be performed by the process being
restarted, and a tunnel restart cannot report its result over the tunnel it just
killed.

Deployment notes for other hosts, and the remaining limits of a city setup, are in
[docs/setup.md](setup.md).

For this machine's release procedure, use
[Updating this installation](../SELF-HOSTING.md#updating-this-installation).
Never rebuild a checkout while a server is serving its `.output`.

## Point it at another city

Use the owner-only **Paper setup** form. On a fresh install it opens
automatically; later it lives on the Server page.

1. Set the paper name, tagline, city, state, timezone, contact and optional
   council-votes link.
2. Add the official pages worth watching.
3. Add meeting-video channel URLs and the title phrases used by that city.
4. If the city uses PrimeGov, add its public portal to the watch list.

The masthead, city copy, local dates, public links, source list and YouTube
meeting discovery all change from the saved database settings. Blank optional
fields remain blank; they do not inherit Longmont's values.

---

# Part 4 — How it is built

## The stack

| Layer     | What                                                                         | Why                                                                                                     |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Framework | [TanStack Start](https://tanstack.com/start) on Vite, React 19               | File-based routes, typed server functions, SSR without a separate API                                   |
| Server    | Nitro, `node-server` preset                                                  | A long-lived process: Chromium stays warm and background jobs are not chopped into request-sized pieces |
| Database  | PostgreSQL (PGLite for a throwaway look)                                     | Plain SQL through `pg`; migrations are numbered `.sql` files                                            |
| Auth      | [better-auth](https://better-auth.com)                                       | Email/password, with a bearer path for partitioned-cookie previews                                      |
| Styling   | Tailwind 4                                                                   |                                                                                                         |
| Fetching  | `undici`, with a connect-time SSRF guard                                     | The address approved is the address connected to                                                        |
| Rendering | Playwright Chromium                                                          | JS-heavy civic portals and YouTube "Show transcript"                                                    |
| PDFs      | `unpdf`                                                                      | Text extraction plus bounded vision OCR for supported scan images; unsupported or failed reads remain explicit                                        |
| Model     | Codex/Claude CLIs, Anthropic SDK, or any OpenAI-compatible URL              | Provider is resolved before enqueue and stored on each Story job                                        |

## Server functions and the desk boundary

Every desk action is a `createServerFn` with `deskMiddleware`, which:

1. asserts the request is same-site,
2. resolves the user from the session (never from anything the client sends),
3. requires that user to be an owner or editor of this newsroom.

The user id is never taken from the client. Open signup closes after the owner
claims the desk. A second person joins only through the one-time link created by
the owner under **Server → Invite an editor**.

## Jobs

Anything that can take minutes is a row in `desk_jobs`, not a held-open request.
Five kinds: `scan`, `draft`, `dark`, `editorial`, `brief`. The brief job refreshes
an investigation's read-me-first summary without holding open the request.

A job is claimed with a token and heartbeats while it runs. This is not
decoration: jobs used to run **twice**, because nothing refreshed the liveness
stamp mid-run and any job past the two-minute stale line was re-claimed and run
alongside the original.

## Evidence maturity

Extracted claims carry evidence-maturity labels, and each label caps the
confidence **in code** — not by asking a prompt nicely:

| Label       | Ceiling |
| ----------- | ------- |
| FACT        | 1.0     |
| OBSERVATION | 0.9     |
| INFERENCE   | 0.7     |
| ALLEGATION  | 0.6     |
| HYPOTHESIS  | 0.5     |
| UNKNOWN     | 0.3     |

The separate Stage 1 signal confidence is always capped at 0.5, regardless of the claim-label table above. A claim labelled FACT with no citation is downgraded rather than trusted. Claims
about the desk's own digging — "twelve hops found no contract" — are dropped
instead of filed as findings about the world.

## Model routing

Planning and synthesis are separate calls and can use different models.
Measured over five runs each, planning on Haiku produced the same output quality
as Opus at about a quarter of the cost. On the **Claude Dark Desk path**, Haiku
plans and the configured Claude model synthesises. Non-Claude providers keep
their configured model instead of receiving a Claude model name. Opinion is a
separate path offering Claude Opus or Local model.

## Tests

```bash
npm test
```

The default run is offline and free — no provider is contacted and nothing is
billed. It runs one test file at a time, which is slower but steady on a small
machine. The tests cover meeting ingest, retrieval,
draft stripping, timezone handling, the SSRF guard, the job lifecycle, the Dark
Desk loop, the dials, claim hygiene, the editorial parser, and the ops action
allowlist.

Two rules the suite enforces that are easy to lose:

- **The dials may never tighten.** A test fails if any notch of Dig or Nerve
  becomes more conservative than it was.
- **The version is locked** across `package.json`, `src/lib/version.ts` and the
  paper's own masthead.

`npm run smoke` is a separate, browser-driven check: it loads the front page in
a real browser, counts every request the page makes, and fails the build if any
of them leaves this machine. CI runs it against both the built server and the
dev server on every push.

---

# Part 5 — Architecture

## System context

This diagram shows the legacy Halo topology; the Windows package has no tunnel or watchdog, and Reddit checks use the configured accepted subreddit rather than a fixed town.

```mermaid
flowchart TB
    subgraph outside["The city, on the public web"]
        CITY["City site · council · planning"]
        PORTAL["Agenda portal<br/>(PrimeGov JSON API)"]
        TAPE["YouTube · public-access TV"]
        COUNTY["County · schools · utility"]
        REDDIT["r/longmont"]
    end

    subgraph machine["One machine you own"]
        APP["TownReporter<br/>Nitro node-server"]
        DB[("PostgreSQL")]
        PW["Playwright Chromium"]
        WD["Watchdog<br/>every 5 min"]
    end

    subgraph models["Whichever model you point it at"]
        CC["Claude Code CLI<br/>(no API key)"]
        CX["Codex CLI<br/>(OAuth, native full access)"]
        API["Anthropic API"]
        OAI["Any OpenAI-compatible URL<br/>incl. a local model"]
    end

    READER(["Reader"])
    EDITOR(["Editor"])

    outside --> APP
    APP <--> DB
    APP --> PW
    PW --> outside
    APP --> models
    WD -.watches, restarts.-> APP
    APP --> TUNNEL["Cloudflare Tunnel"]
    TUNNEL --> READER
    TUNNEL --> EDITOR
```

## The pipeline: source to printed page

```mermaid
flowchart LR
    S["Watch list<br/>sources"] --> SC["Scan<br/>fetch + hash"]
    SC --> D{"Compared to<br/>last snapshot"}
    D -->|changed| L["Lead"]
    D -->|disappeared| L
    D -->|failed to appear| L
    D -->|same| X["Nothing"]
    L --> Q["Queue<br/>scored"]
    Q --> DR["Draft<br/>+ reporting notes"]
    DR --> W["Workbench<br/>redraft · PULL · edit"]
    W --> G{"Editor"}
    G -->|publish| P["The paper"]
    G -->|hold| Q
    G -->|kill| X
    P --> C["Corrections<br/>dated, above the story"]

    style G fill:#7a2d2d,color:#fff
    style P fill:#1c1a17,color:#fff
```

The red box is the only way to the paper. Everything upstream of it is
assistance; everything downstream of it is a correction, never a silent edit.

## A job, end to end

```mermaid
sequenceDiagram
    participant E as Editor
    participant F as Server function
    participant J as desk_jobs
    participant W as Worker
    participant M as Model
    participant DB as Database

    E->>F: Run scan / Draft / Keep digging / Write an editorial
    F->>J: insert (kind, subject, queued)
    F-->>E: returns at once — nothing waits on the model
    W->>J: claim with a token
    loop while running
        W->>J: heartbeat
    end
    W->>M: call (budget from the provider)
    M-->>W: result
    W->>DB: file leads / draft / signals / editorial
    W->>J: finished
    E->>F: page polls
    F-->>E: the work, when it lands
```

## Dark Desk, one round

The model names in this diagram illustrate the Claude path; other selected providers use their own planner and writer models as described above.

```mermaid
flowchart TB
    OPEN["Open a file<br/>URL · person · LLC · rumour"] --> PLAN
    DIALS[/"Dig · Nerve · Map"/] -.sets hops, floor, scope.-> PLAN
    PLAN["Plan the hop<br/>(Haiku)"] --> SEARCH["Search + fetch"]
    SEARCH --> CAP["Capture a copy"]
    CAP --> EXTRACT["Entities · relationships<br/>signals · dead ends"]
    EXTRACT --> HYG{"Claim hygiene"}
    HYG -->|about our own digging| DROP["Dropped"]
    HYG -->|FACT with no citation| DOWN["Downgraded"]
    HYG -->|ok| CLAMP["Confidence capped<br/>by label"]
    CLAMP --> SYN["Synthesise<br/>(Opus)"]
    SYN --> BRIEF["Brief:<br/>connections · hypothesis · strength<br/>supports · benign · what kills it"]
    BRIEF --> STOP{"Budget spent?"}
    STOP -->|no| PLAN
    STOP -->|yes| PARK["Stop, say what is unread"]
    PARK --> KEEP["Keep digging"] --> PLAN
    BRIEF --> SPEC["Black Desk signal<br/>confidence at most 0.5"]
    SPEC --> ADV["App adversarial searches<br/>four kinds, three source tiers"]
    ADV --> VER["Dark Signal gate answers<br/>disproof, independence, context, self-reference"]
    VER --> DEC{"Verified and newsworthy?"}
    DEC -->|yes| QUEUE["Send finding to queue"]
    DEC -->|no| WATCH["Keep investigating or watch"]
    WATCH --> TIP["Editor explicitly sends unverified tip"]
    TIP --> QUEUE

    style DROP fill:#3a2a2a,color:#fff
    style QUEUE fill:#7a2d2d,color:#fff
```

Note what is missing from that diagram: any edge to the paper. The only way out
of Dark Desk is **Send to the queue**, which files a lead a human then has to
work.

## The Opinion desk and its voice handoff

```mermaid
flowchart LR
    subgraph repo["This repository — public"]
        UI["/desk/opinion"]
        PACK["Pack builder<br/>subject · pointers · our story"]
        PARSE["Parser<br/>headline · body · appendix<br/>fact sheet · image prompt"]
        DRAFTS[("drafts +<br/>editorial_extras")]
    end

    subgraph private["Outside the repository"]
        VOICE["The voice file<br/>~/.townreporter/voice/*.md"]
    end

    CLI["Claude Code CLI<br/>path-only voice, tool-free writing"]

    UI --> PACK
    PACK -->|"over stdin"| CLI
    VOICE -.->|"path only"| CLI
    CLI --> PARSE --> DRAFTS --> UI

    style private fill:#2a2320,color:#fff
    style VOICE fill:#7a2d2d,color:#fff
```

The diagram shows the Claude path. Claude receives the voice file by path.
The explicit Local model alternative reads the validated voice into a system
message for the selected model server and uses the supplied material without
a separate research pass. Neither path places the voice text in argv. A relative path, or any path inside the public
repository, is rejected.

## Keeping it online

This diagram describes the separately configured legacy watchdog, not the
Windows installation package, which has no automatic repair task.

```mermaid
flowchart TB
    T["Scheduled task<br/>every 5 minutes"] --> WD["watchdog.ps1"]
    WD --> C1{"App answering<br/>on PORT from .env?"}
    C1 -->|no| R1["Start the app"]
    C1 -->|yes| C2{"cloudflared<br/>running?"}
    R1 --> C2
    C2 -->|no| R2["Start the tunnel"]
    C2 -->|yes| C3{"Public URL<br/>answers 200?"}
    R2 --> C3
    C3 -->|no| R3["Restart the tunnel"]
    C3 -->|yes| OK["Write the check and stop"]
    R3 --> OK

    OPS["/desk/ops"] -.reads.-> LOG[("logs/watchdog.log")]
    WD --> LOG
```

## Data model, the shape of it

```mermaid
erDiagram
    NEWSROOMS ||--o{ SOURCES : watches
    NEWSROOMS ||--o{ LEADS : holds
    NEWSROOMS ||--o{ ARTICLES : prints
    SOURCES ||--o{ SNAPSHOTS : "hashed each scan"
    SOURCES ||--o{ SOURCE_MONITORS : "expected cadence"
    SNAPSHOTS ||--o{ ANOMALIES : "changed · gone · missing"
    ANOMALIES ||--o{ LEADS : becomes
    LEADS ||--o{ DRAFTS : "drafted into"
    DRAFTS ||--o| ARTICLES : "published as"
    ARTICLES ||--o{ CORRECTIONS : "dated, above"
    INVESTIGATIONS ||--o{ FRONTIER_ITEMS : "still unopened"
    INVESTIGATIONS ||--o{ ARTIFACTS : captured
    INVESTIGATIONS ||--o{ ENTITIES : found
    INVESTIGATIONS ||--o{ CLAIMS : "labelled + capped"
    INVESTIGATIONS ||--o{ HYPOTHESES : "with what kills it"
    INVESTIGATIONS ||--o{ DEAD_ENDS : "kept, reopenable"
    INVESTIGATIONS ||--o{ INVESTIGATION_BRIEFS : "read this first"
    EDITORIAL_REQUESTS ||--o| DRAFTS : "written into"
    DRAFTS ||--o| EDITORIAL_EXTRAS : "fact sheet, not printed"
    DESK_JOBS }o--|| NEWSROOMS : "scan draft dark editorial"
    DELETED_ITEMS }o--|| NEWSROOMS : "a copy, for 30 days"
```

## Choosing a provider, at call time

```mermaid
flowchart TB
    CALL["A model-backed desk action"] --> KIND{"Story/Scan/Dark picker?"}
    KIND -->|yes: Automatic| Q1{"LLM_* configured?"}
    Q1 -->|yes| OAI["Use that gateway only"]
    Q1 -->|no| READY["First ready<br/>Claude Opus → Codex Terra"]
    KIND -->|yes: named choice| ONE["Use only that provider<br/>no fallback"]
    OAI --> SAVE["Persist effective provider on job"]
    READY --> SAVE
    ONE --> SAVE
    SAVE --> RUN["Selected run uses that provider"]
    RUN -->|login lapses or timeout, Automatic only| NEXT["Next ladder rung, if ready<br/>(once per job)"]
    RUN -->|otherwise, or a named choice| SAME["Same provider for the rest of the run"]

    style SAVE fill:#1c1a17,color:#fff
```

---

# Part 6 — Reference

## Routes

| Path                                         | What                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/`                                          | The paper                                                                                  |
| `/?topic=opinion`                            | Editorials — the Opinion link in the masthead. Same route as the paper, filtered by topic. |
| `/articles/:slug`                            | A story                                                                                    |
| `/about` · `/how-we-report` · `/corrections` | Masthead pages                                                                             |
| `/feed` · `/sitemap.xml` · `/robots.txt`     | Machines                                                                                   |
| `/evidence/:versionId`                       | The captured copy of a source a printed story cited                                        |
| `/evidence/compare`                          | Two captures of the same URL, side by side                                                 |
| `/get-the-code` · `/TownReporter.zip`        | Download this newsroom's own source                                                        |
| `/login`                                     | Create an editor account, or sign in                                                       |
| `/desk/setup`                                | First-run paper setup; redirects away after setup is complete                              |
| `/desk`                                      | The desk — what needs you                                                                  |
| `/desk/sources`                              | Watch list, and bulk paste                                                                 |
| `/desk/scan`                                 | Fetch and file leads. The expensive button.                                                |
| `/desk/queue`                                | Leads: draft, hold, kill                                                                   |
| `/desk/story/:id`                            | The workbench, opened by lead                                                              |
| `/desk/story/draft/:id`                      | The editorial workbench, opened by draft — an editorial has no lead                        |
| `/desk/published`                            | Live stories and corrections                                                               |
| `/desk/dark`                                 | Dark Desk. Investigates, never prints.                                                     |
| `/desk/page-watches`                        | Manual investigative page watches and capture history                                     |
| `/desk/legal-removals`                       | Owner-only legal-removal cases, retained copies and backup attestations                     |
| `/desk/follow-ups`                           | Reporting requests and due dates                                                           |
| `/desk/stats`                                | Newsroom activity and coverage                                                             |
| `/desk/opinion`                              | Opinion. Unsigned editorials.                                                              |
| `/desk/ops`                                  | Server. Health, Paper setup, editor invites and the few operational buttons worth having.  |

## Environment

The variables an operator most often touches. The complete inventory, with a
comment on each, is [`.env.example`](../.env.example).

| Variable                                                          | Effect                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | Postgres. Unset means throwaway PGLite.                                                                                |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                     | Extra origins allowed to sign in, comma-separated                                                                      |
| `TOWNREPORTER_VOICE_FILE`                                         | Absolute path to the Opinion voice, outside the repo                                                                   |
| `TOWNREPORTER_EDITORIAL_MODEL`                                    | Override the Claude Opinion writing model (default Opus)                                                               |
| `ANTHROPIC_API_KEY`                                               | Bill Claude to a key instead of using the CLI login                                                                    |
| `LLM_BASE_URL` · `LLM_API_KEY` · `LLM_MODEL`                      | Configured provider for Scan/Dark; forced Story Automatic provider                                                     |
| `TOWNREPORTER_CODEX_TERRA_MODEL` · `TOWNREPORTER_CODEX_SOL_MODEL` | Codex picker model ids; defaults `gpt-5.6-terra` / `gpt-5.6-sol`                                                       |
| `CODEX_CLI_PATH` · `CODEX_HOME`                                   | Unusual Codex binary or OAuth-state locations; normal discovery needs neither                                          |
| `CLAUDE_CLI_PATH`                                                 | Unusual Claude Code binary location                                                                                    |
| `XAI_API_KEY`                                                     | Grok                                                                                                                   |
| `CRON_SECRET`                                                     | Lets an external monitor ping the job runner                                                                           |
| `HOST`                                                            | What the server binds to. Unset means every interface, LAN included. Set `127.0.0.1` when a tunnel or proxy fronts it. |
| `VITE_AUTH_ENABLED=false`                                         | No login at all. Local only. Never on a public host.                                                                   |

## Job kinds

| Kind        | Started by                         | Typical length                                                       |
| ----------- | ---------------------------------- | -------------------------------------------------------------------- |
| `scan`      | Scan page                          | minutes                                                              |
| `draft`     | Queue or workbench                 | minutes                                                              |
| `dark`      | Dark Desk — start, or Keep digging | minutes per round                                                    |
| `brief`     | Refresh the investigation brief    | a model call to update the file's read-me-first summary              |
| `editorial` | Opinion desk                       | Historical runs: 10–40 minutes; up to 45 minutes per pass by default |

## Commands

```bash
npm run dev          # http://localhost:8080
npm run build        # build, then migrate
npm start            # run the built server
npm test             # deterministic, offline, free
npm run test:live-model  # opt-in live evaluation (RUN_LIVE_MODEL_TESTS=1)
npm run typecheck
npm run db:migrate
npx playwright install chromium
```

## Manual investigative page watches

Dark Desk's **Watched pages** panel records a named public URL and the editor's reason for watching it. It uses the existing source-monitor scheduler, guarded capture engine and dated capture versions, independently of accepted-source scanning. See [the editor workflow](editor.md#watch-a-specific-page-in-dark-desk) for first captures, readable differences, failed checks, OCR selection, explicit lead/record actions and pause/stop behavior.

Migration 0046 adds watch state, a per-check lease and action history to the existing monitor/capture system. A transaction locks and verifies the lease before capture, history, baseline and optional file attachment writes. Failed checks keep the last readable baseline. Scheduler and manual checks share this path; an expired worker cannot overwrite a newer lease's result. The editor chooses an active configured reporting section when explicitly creating a lead. Stored captures and action targets remain newsroom scoped. Capture history and complete stored-text downloads preserve evidence; they are not legal-removal or backup-management features.

## Legal removal: owner workflow

Open **Published → Legal removal** beside a story, or **Published → Legal removal cases** to revisit a case. Editors cannot use this process. Ordinary Delete still uses 30-day trash; legal removal has no Undo.

1. Select the affected stories and **Review connected copies**. All stories sharing a lead must be selected before its reporting records can be removed. Review the counts and historical candidates. Old drafts, memory, audit labels and trash do not always carry article IDs; select only the records in scope. Selected entries remain visible and can be unchecked. Mixed trash requires explicit whole-snapshot selection. Changed records require a fresh preview.
2. Review independent evidence. Known same-paper URL copies and references in captures, chunks, original blobs, source snapshots, search results, associated frontier records, source/monitor descriptors and watch history are listed but **not automatically deleted**. These known copies block court destruction even with the evidence checkbox checked. Retained application removal may proceed with review explicitly pending. A local operator must resolve unsupported captured-copy cleanup; a checkbox does not establish erasure.
3. Choose the policy. **Keep an owner-only copy for 12 calendar months** uses the calendar anniversary, with February 29 clamped to February 28 in a non-leap year. This is owner access control, not encryption. The existing scheduled tick and case-list reads purge expired copies. Expired text cannot be opened even if cleanup has failed. **Explicit court destruction** never inserts removed text into the retained-copy table and requires the historical/evidence scope to be resolved first.
4. Enter a case identifier without story text, type **REMOVE**, and confirm. The transaction removes selected application copies, scrubs exact linked editorial source descriptors and blocks stale filing/restoration. Independent editorial drafts remain for review; interrupted writing must be restarted with reviewed sources. Foreign-newsroom relationships refuse removal rather than cascading into another paper. Matching automatic watches are paused and ordinary sources are excluded from scans, preserving their evidence for review. Stop remains available; resuming a removed article's watch is refused.
5. The result opens its case. **Open owner-only retained text (audited)** is available until expiry under the retention policy. There is no restore button. Record affected backup identifiers and operator cleanup attestations here. An attestation records what an operator reports; it is not independently verified erasure.

Fresh public article/feed/sitemap reads stop returning removed stories. Existing browser caches, downloads, external search caches, provider history, database logs and backups are outside the application's erasure proof. An older database restore can reintroduce removed content; the local operator must reconcile removal cases before serving restored data. Exact known URL checks include query/fragment/trailing-slash and percent-encoded slug aliases. Unlinked prose, malformed historical records, old deployment origins and unknown external copies still need owner/operator review. Do not treat this workflow as proof that no copy exists anywhere.

---

## Documents

| Audience                                            | Document                                        |
| --------------------------------------------------- | ----------------------------------------------- |
| Editors, with screenshots and no code               | [docs/editor.md](editor.md)                     |
| Operators — clone, env, Postgres, models, city swap | [docs/setup.md](setup.md)                       |
| Dark Desk UI contract                               | [docs/dark-desk-editor.md](dark-desk-editor.md) |
| Local models — what was measured, and why mostly no | [docs/local-models.md](local-models.md)         |
| Self-hosting this exact deployment                  | [SELF-HOSTING.md](../SELF-HOSTING.md)           |
| What changed, release by release                    | [CHANGELOG.md](../CHANGELOG.md)                 |

---

MIT licensed. Copyright (c) 2026 Scott Converse.
