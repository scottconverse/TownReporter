# TownReporter — the manual

**Version 0.5.1 · 29 August 2026**

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

- [Part 1 — What it is](#part-1--what-it-is)
- [Part 2 — The desk, screen by screen](#part-2--the-desk-screen-by-screen)
- [Part 3 — Running it](#part-3--running-it)
- [Part 4 — How it is built](#part-4--how-it-is-built)
- [Part 5 — Architecture](#part-5--architecture)
- [Part 6 — Reference](#part-6--reference)

---

# Part 1 — What it is

## Two rooms

| | What it is | Who sees it |
|---|---|---|
| **The paper** (`/`) | Stories and editorials a human published, with the sources shown | Anyone |
| **The desk** (`/desk`) | Watch list, scan, queue, drafts, Dark Desk, Opinion, Server | Signed-in editors |

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

Corrections are public. A published story is never quietly edited; a correction
runs as a dated note above it.

**Delete is always available**, before or after printing — a lead filed against
the wrong person, a scan that swept up something private, a story that should
never have run. Kill is not delete: a killed lead stays on the desk under
Killed. Delete removes the thing. Each one confirms in place and says what it
costs; taking a story off the paper says plainly that its URL becomes a 404 and
that a correction is what the paper normally does instead.

**Nothing deleted is gone straight away.** A copy waits 30 days under *Recently
deleted* on the Server page, and an **Undo** appears where the delete happened.
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

- No tracker, no analytics script, no third-party font. A cold load of the paper
  makes **zero requests to any outside host**. The Server page checks this and
  will tell you when it stops being true.
- Every story has its own title, description, canonical URL, published time and
  social card.
- An RSS feed at `/feed`, a `sitemap.xml`, and a `robots.txt` that points at it.
- The sources under every story, as links, including captured copies when the
  original has moved.

---

# Part 2 — The desk, screen by screen

The full editor's guide, with what to click and what each screen is for, is
[docs/editor.md](editor.md). This is the tour.

## The desk

`/desk` — what needs you, and everything in flight.

![The desk](images/04-desk.png)

Three columns: the queue on the left, Dark Desk in the middle, the wire on the
right. The line under the heading is the whole point of the page — *2 drafts
ready to publish, 14 proposed sources await review, 1 Dark Desk file ready for
another round*. If that line is empty there is nothing for you to do.

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

## The story workbench

`/desk/story/:id` — where a lead becomes a story.

![The story workbench](images/07-story-editor.png)

The lead and the reporting notes are on the left and never print. The draft is
on the right: headline, dek, topic, body. **Redraft** rewrites the story from
the notes. **PULL** next to an unfinished to-do goes and fetches that specific
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

**Edit**, on the row, opens the piece in its own workbench at
`/desk/story/draft/:id`: headline, dek, topic and the piece itself, plus the two
boxes that never print. Save, publish, or delete it from there.

It fetches its own records before it writes a word, so it takes **ten to forty
minutes** — three measured runs came in at 9m53s, 24m06s, and one still going at
30. The page shows a running clock rather than a frozen word, and checks every
twenty seconds. Editorials are drafts until you publish one.

It is also the most expensive thing the newsroom does. Those same two finished
runs cost **$2.66 and $23.76**; the second decided to dispatch research agents
of its own. Budget for a piece, not for a paragraph.

## The Server page

`/desk/ops` — everything this machine is doing to keep the paper online.

![Server](images/11-server.png)

Version, uptime, memory, the public URL as answered from this machine, tunnel
processes, database size, what the paper holds, queue depth, the last watchdog
run, free disk, and whether the reader made any outside request.

The buttons are few and each says what it will do before it does it. The two
that interrupt the paper ask twice.

## Published

`/desk/published` — what is live, and its corrections.

![Published](images/12-published.png)

---

# Part 3 — Running it

## Five minutes, on your own machine

You need **Node 22+**. You do **not** need an AI key if
[Claude Code](https://code.claude.com) is installed and signed in — the desk
uses that login.

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

Open `http://localhost:8080/login` and create an editor account. With no
`NEWSROOM_SETUP_TOKEN` set, the first account becomes the newsroom owner. On a
public host, set that token — signing up alone must not own the desk.

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

First match wins:

| Set this | What runs |
|---|---|
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint, including a local model |
| `ANTHROPIC_API_KEY` | Claude, billed to that key |
| *nothing* | **Claude, through your Claude Code login** |
| `XAI_API_KEY` | Grok |

Pointing `LLM_BASE_URL` at a local model sends **everything** local, including
the story writing and the editorials — there is no per-call provider routing.
What that actually costs in quality was measured on this machine:
[docs/local-models.md](local-models.md).

The CLI path spends no API money at all. It is slower than an HTTP API because
it reloads a fixed preamble on every call, so a draft takes minutes rather than
seconds; the time budgets adjust on their own.

Your own `CLAUDE.md`, skills and plugins are **not** loaded into news prompts.
The harness is stripped on every call with `--setting-sources ""`.

## The Opinion voice

The Opinion desk writes in a voice held in a file on disk, named by path:

```
TOWNREPORTER_VOICE_FILE=C:/Users/you/.townreporter/voice/your-voice.md
```

The file is deliberately outside the repository, and the app refuses a path
inside it. Only the **path** ever reaches a command line — the file itself is
read by the CLI, never loaded into the app's memory and never passed as an
argument, because command lines are readable by every process on the machine.
Without the file, the Opinion desk says so and spends nothing.

## Serving it publicly

The working edition runs on one Windows machine behind a Cloudflare Tunnel. The
`ops/` directory holds the scripts that keep it up:

| Script | What it does |
|---|---|
| `ops/watchdog.ps1` | Every five minutes: check the app, the tunnel and the public URL; restart what is down; write what it did |
| `ops/run-tunnel.ps1` | Start `cloudflared` for this hostname |
| `ops/restart-app.ps1` | Stop and start the paper |
| `ops/restart-tunnel.ps1` | Stop and start the tunnel |
| `ops/rotate-logs.ps1` | Keep `logs/` from growing without bound |
| `ops/status.ps1` | Is it up? Read-only, and it answers when the paper is down and `/desk/ops` cannot |
| `ops/TownReporter Control.cmd` | The same, for someone who does not want a terminal. Double-click, pick a number. |
| `ops/run-hidden.vbs` | Runs the five-minute tasks with no console window |

Restart and tunnel-restart run as Windows scheduled tasks rather than as child
processes of the app — a restart cannot be performed by the process being
restarted, and a tunnel restart cannot report its result over the tunnel it just
killed.

Deployment notes for other hosts, and the honest limits of a city swap, are in
[docs/setup.md](setup.md).

## Point it at another city

There is no city-picker UI yet. Edit the seed and rebuild.

1. `src/lib/paper.ts` — `PAPER` (name, city, state, location, **timezone**,
   kicker, deck) and `SEED_SOURCES`.
2. `src/lib/news/youtube.ts` — the channel list, if the city streams.
3. If the city uses PrimeGov, add `https://{city}.primegov.com/public/portal`
   as an official source. The ingest already speaks that API.

---

# Part 4 — How it is built

## The stack

| Layer | What | Why |
|---|---|---|
| Framework | [TanStack Start](https://tanstack.com/start) on Vite, React 19 | File-based routes, typed server functions, SSR without a separate API |
| Server | Nitro, `node-server` preset | A long-lived process: Chromium stays warm and background jobs are not chopped into request-sized pieces |
| Database | PostgreSQL (PGLite for a throwaway look) | Plain SQL through `pg`; migrations are numbered `.sql` files |
| Auth | [better-auth](https://better-auth.com) | Email/password, with a bearer path for partitioned-cookie previews |
| Styling | Tailwind 4 | |
| Fetching | `undici`, with a connect-time SSRF guard | The address approved is the address connected to |
| Rendering | Playwright Chromium | JS-heavy civic portals and YouTube "Show transcript" |
| PDFs | `unpdf` | Text extraction; image-only PDFs are honestly reported as unread |
| Model | Claude Code CLI, Anthropic SDK, or any OpenAI-compatible URL | Provider is chosen at call time, not at build time |

## Server functions and the desk boundary

Every desk action is a `createServerFn` with `deskMiddleware`, which:

1. asserts the request is same-site,
2. resolves the user from the session (never from anything the client sends),
3. requires that user to be an owner or editor of this newsroom.

The user id is never taken from the client. A second identity that signs up gets
403 until it is added to `newsroom_members`.

## Jobs

Anything that can take minutes is a row in `desk_jobs`, not a held-open request.
Four kinds: `scan`, `draft`, `dark`, `editorial`.

A job is claimed with a token and heartbeats while it runs. This is not
decoration: jobs used to run **twice**, because nothing refreshed the liveness
stamp mid-run and any job past the two-minute stale line was re-claimed and run
alongside the original.

## Evidence maturity

Everything Dark Desk writes down carries a label, and the label caps the
confidence **in code** — not by asking a prompt nicely:

| Label | Ceiling |
|---|---|
| FACT | 1.0 |
| OBSERVATION | 0.9 |
| INFERENCE | 0.7 |
| ALLEGATION | 0.6 |
| HYPOTHESIS | 0.5 |
| UNKNOWN | 0.3 |

A claim labelled FACT with no citation is downgraded rather than trusted. Claims
about the desk's own digging — "twelve hops found no contract" — are dropped
instead of filed as findings about the world.

## Model routing

Planning and synthesis are separate calls and can use different models.
Measured over five runs each, planning on Haiku produced the same output quality
as Opus at about a quarter of the cost, so **Haiku plans and Opus synthesises**.
The editorial writer is Opus deliberately: it is the one call where the writing
*is* the product.

## Privacy of the reader

- Fonts are self-hosted in `public/fonts/`; `scripts/fetch-fonts.mjs` refreshes
  them.
- There is no analytics script and no third-party embed on a reader page.
- The Server page's **Reader privacy** row re-checks this and reports what it
  found.

## Tests

```bash
npm test
```

495 tests, no network and no token spend. They cover meeting ingest, retrieval,
draft stripping, timezone handling, the SSRF guard, the job lifecycle, the Dark
Desk loop, the dials, claim hygiene, the editorial parser, and the ops action
allowlist.

Two rules the suite enforces that are easy to lose:

- **The dials may never tighten.** A test fails if any notch of Dig or Nerve
  becomes more conservative than it was.
- **The version is locked** across `package.json`, `src/lib/version.ts` and the
  paper's own masthead.

---

# Part 5 — Architecture

## System context

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
    BRIEF --> QUEUE["Send to the queue"]

    style DROP fill:#3a2a2a,color:#fff
    style QUEUE fill:#7a2d2d,color:#fff
```

Note what is missing from that diagram: any edge to the paper. The only way out
of Dark Desk is **Send to the queue**, which files a lead a human then has to
work.

## The Opinion desk, and the private-voice boundary

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

    CLI["Claude Code CLI"]

    UI --> PACK
    PACK -->|"over stdin"| CLI
    VOICE -.->|"path only,<br/>read by the CLI"| CLI
    CLI --> PARSE --> DRAFTS --> UI

    style private fill:#2a2320,color:#fff
    style VOICE fill:#7a2d2d,color:#fff
```

The voice file is never read into the app's memory and never becomes a command
line argument. The app holds a path and a refusal: a relative path, or any path
inside the repository, is rejected.

## Keeping it online

```mermaid
flowchart TB
    T["Scheduled task<br/>every 5 minutes"] --> WD["watchdog.ps1"]
    WD --> C1{"App answering<br/>on :8080?"}
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
    CALL["A desk call"] --> Q1{"LLM_BASE_URL<br/>or LLM_API_KEY?"}
    Q1 -->|yes| OAI["OpenAI-compatible endpoint<br/>(LiteLLM · Ollama · anything)"]
    Q1 -->|no| Q2{"ANTHROPIC_API_KEY?"}
    Q2 -->|yes| SDK["Anthropic API"]
    Q2 -->|no| Q3{"Claude Code CLI<br/>installed and signed in?"}
    Q3 -->|yes| CC["The CLI — no key, no per-call bill"]
    Q3 -->|no| Q4{"XAI_API_KEY?"}
    Q4 -->|yes| GROK["Grok"]
    Q4 -->|no| NONE["Say so. Spend nothing."]

    style CC fill:#1c1a17,color:#fff
    style NONE fill:#3a2a2a,color:#fff
```

---

# Part 6 — Reference

## Routes

| Path | What |
|---|---|
| `/` | The paper |
| `/?topic=opinion` | Editorials — the Opinion link in the masthead. Same route as the paper, filtered by topic. |
| `/articles/:slug` | A story |
| `/about` · `/how-we-report` · `/corrections` | Masthead pages |
| `/feed` · `/sitemap.xml` · `/robots.txt` | Machines |
| `/login` | Create an editor account, or sign in |
| `/desk` | The desk — what needs you |
| `/desk/sources` | Watch list, and bulk paste |
| `/desk/scan` | Fetch and file leads. The expensive button. |
| `/desk/queue` | Leads: draft, hold, kill |
| `/desk/story/:id` | The workbench, opened by lead |
| `/desk/story/draft/:id` | The editorial workbench, opened by draft — an editorial has no lead |
| `/desk/published` | Live stories and corrections |
| `/desk/dark` | Dark Desk. Investigates, never prints. |
| `/desk/opinion` | Opinion. Unsigned editorials. |
| `/desk/ops` | Server. Health and the few buttons worth having. |

## Environment

| Variable | Effect |
|---|---|
| `DATABASE_URL` | Postgres. Unset means throwaway PGLite. |
| `NEWSROOM_SETUP_TOKEN` | Required on a public host, so signing up does not own the desk |
| `TOWNREPORTER_VOICE_FILE` | Absolute path to the Opinion voice, outside the repo |
| `TOWNREPORTER_EDITORIAL_MODEL` | Override the editorial model (default Opus) |
| `ANTHROPIC_API_KEY` | Bill Claude to a key instead of using the CLI login |
| `LLM_BASE_URL` · `LLM_API_KEY` · `LLM_MODEL` | Any OpenAI-compatible endpoint |
| `XAI_API_KEY` | Grok |
| `CRON_SECRET` | Lets an external monitor ping the job runner |
| `HOST` | What the server binds to. Unset means every interface, LAN included. Set `127.0.0.1` when a tunnel or proxy fronts it. |
| `VITE_AUTH_ENABLED=false` | No login at all. Local only. Never on a public host. |

## Job kinds

| Kind | Started by | Typical length |
|---|---|---|
| `scan` | Scan page | minutes |
| `draft` | Queue or workbench | minutes |
| `dark` | Dark Desk — start, or Keep digging | minutes per round |
| `editorial` | Opinion desk | 10–40 minutes |

## Commands

```bash
npm run dev          # http://localhost:8080
npm run build        # build, then migrate
npm start            # run the built server
npm test             # 495 tests, no network
npm run typecheck
npm run db:migrate
npx playwright install chromium
```

## Documents

| Audience | Document |
|---|---|
| Editors, with screenshots and no code | [docs/editor.md](editor.md) |
| Operators — clone, env, Postgres, models, city swap | [docs/setup.md](setup.md) |
| Dark Desk UI contract | [docs/dark-desk-editor.md](dark-desk-editor.md) |
| Local models — what was measured, and why mostly no | [docs/local-models.md](local-models.md) |
| Self-hosting this exact deployment | [SELF-HOSTING.md](../SELF-HOSTING.md) |
| What changed, release by release | [CHANGELOG.md](../CHANGELOG.md) |

---

MIT licensed. Copyright (c) 2026 Scott Converse.
