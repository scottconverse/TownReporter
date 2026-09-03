# TownReporter — operator setup

**Current release: [0.6.8](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.8).** Editors who only write and publish should start at [editor.md](editor.md). The short clone-and-run is in the [README](../README.md).

This is a Node 22 web app (TanStack Start + Vite). It is not a desktop installer and not a GitHub Pages app. The landing page in this folder is static marketing; the newsroom is `npm run dev` / `npm run build`.

To publish the landing: GitHub repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. That is a one-time click. It does not run the desk.

---

## What you need

|                             |                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node**                    | 22 or newer (`node -v`). Types in this repo are Node 22.                                                                                                                                                                               |
| **npm**                     | Comes with Node. `npm install` is enough.                                                                                                                                                                                              |
| **A model**                 | Story can use a configured OpenAI-compatible gateway or signed-in Codex/Claude CLIs. Scan and Dig use the configured provider below. Opinion uses signed-in Claude only.     |
| **Chromium via Playwright** | Once: `npx playwright install chromium`. Meeting transcripts and JS civic sites need it.                                                                                                                                               |
| **A database**              | Optional for a look (embedded PGLite). Required for a real newsroom (Postgres).                                                                                                                                                        |

Windows, macOS, and Linux all work.

`npm run dev` serves on `127.0.0.1:8080` by default (this PC only) — that
port is hard-coded in `vite.config.ts` (`strictPort: true`) as the
live-preview contract for the build tooling this repo was scaffolded with,
and it does **not** read `PORT`. Run `npm run dev:lan` to open it to your
network (`0.0.0.0:8080`) for phone/LAN testing.
The **built** server (`npm start`, `.output/server/index.mjs`) is the one that
honours `PORT` (default `3000`) and `HOST` (default every interface — set
`HOST=127.0.0.1` when a tunnel or reverse proxy fronts it).
Only IPv4 listeners on the paper's port count; another program's IPv6-only
listener does not block a start.

---

## What leaves this machine

Reading the paper sends nothing anywhere: fonts are self-hosted in
`public/fonts/`, there is no analytics script, and `npm run smoke` proves a
cold load makes zero requests to any outside host — it loads the front page in
a real browser and fails the build if any request leaves the machine.

**Working the desk is different.** Three kinds of traffic leave this machine
on an editor's action:

| What               | Triggered by                                      | Where it goes                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Model calls**    | Scan, Draft, Dark Desk, Opinion                   | Scan/Dark use the configured provider. Story Automatic uses configured `LLM_*` exclusively when present; otherwise it tries Claude Opus, then Codex Terra, before enqueue. Opinion is always Claude Opus; Codex is not offered for editorials.              |
| **Source fetches** | Watched pages, packets, PDFs, YouTube transcripts | The sites that host them. Normal web requests, guarded at connect time against private addresses (the SSRF guard).                                                                                                                                                                               |
| **Searches**       | The research pass, PULL, and every Dark Desk hop  | A third-party search chain, tried in order: Exa's hosted endpoint (`https://mcp.exa.ai/mcp`), then DuckDuckGo, Bing, Brave and Wikipedia (`src/lib/news/search-web.ts`). None needs an API key, and there is currently no setting to keep a search on this machine — the chain is unconditional. |

The third row is the one to know before you use it: a name, an LLC, a
contract number, or an unpublished rumour typed into Dark Desk is seen by
whichever of those providers answers the query. This is unrelated to reader
privacy above — the "zero outside requests" claim is about the paper's own
pages, not the desk.

---

## First run

```bash
node -v                           # must print v22 or newer
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium
cp .env.example .env
                                   # no DATABASE_URL: runs on an embedded database, lost when npm run dev stops; set DATABASE_URL to keep it
```

Edit `.env`. **The minimum that produces every enabled desk feature is a
signed-in [Claude Code](https://code.claude.com) CLI**; Story alone can also run
through Codex or a configured gateway. Check Claude with:

```bash
claude --version
```

If you would rather use a key, or you do not have Claude Code, see [Model](#model) below.

Then:

```bash
npm run dev
```

Open the paper. Top right: **Create editor**. Email + password. That account is stored in **your** database, becomes the newsroom **owner**, and the button disappears. First person in owns the desk. There is no setup token — it was removed in 0.5.1, because a one-person newsroom that could not re-issue the token had a lock with no locksmith. Sign-in allows ten attempts every five minutes from any one address, so a desk on the open internet is not a desk open to guessing.

The next screen is **Set up the paper**. Enter:

- paper name, tagline, city, state and an [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones);
- the optional council-votes link and editor contact address;
- the starting watch list;
- optional YouTube meeting channels, one URL per line; and
- meeting-title keywords, one phrase per line.

Save once and the desk opens. Before that moment, the public site shows a
neutral “Not yet set up” page and no articles. The same form remains under
**Server → Paper setup**, so a typo or a changed source never requires a code
edit or rebuild.

To hand the newsroom to someone else, use **Give up the desk** at the bottom of the Server page; it asks you to type your email address, because it cannot be undone.

- Paper: `http://localhost:8080/`
- Desk: `http://localhost:8080/desk`

`.env` is gitignored. Never commit it. `.env.example` is safe to commit.

---

## Environment

All of these are documented in [`.env.example`](../.env.example).

### Model

Configured-provider resolution for **Scan and Dark Desk**, first match wins:

| #   | Set this                                      | What runs                                                                   |
| --- | --------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `LLM_BASE_URL` or `LLM_API_KEY` + `LLM_MODEL` | any OpenAI-compatible endpoint; also forces Story Automatic to this gateway |
| 2   | `ANTHROPIC_API_KEY`                           | Claude, billed to that key                                                  |
| 3   | _nothing_                                     | **Claude, through your local Claude Code login**                            |
| 4   | `XAI_API_KEY`                                 | Grok                                                                        |

#### Claude Code — configured-provider default, no key

Install the CLI:

```bash
npm i -g @anthropic-ai/claude-code
```

Then sign in from the desk: **Server → Writing models → Sign in to Claude
Code**. It opens the CLI's own sign-in, shows you the link, and the row turns
to "Signed in" by itself when you finish. The same panel has a **Test** button
that asks the model for one word, which is the only check that proves the desk
can really write. Codex works the same way, with a one-time code as well as a
link. See [the editor's manual](editor.md#signing-in-to-a-writing-model).

That is the whole setup. Your Max or Pro subscription powers the desk.

Being signed in to claude.ai in a browser, or in the Claude desktop app, is a
separate login and does not count — the desk uses the command-line program's
own credentials.

**If the button does not work**, sign in from a terminal instead:

```bash
claude          # then /login
codex login     # for Codex
```

```
# ANTHROPIC_MODEL=claude-opus-5   # the default
# CLAUDE_CLI_PATH=...             # only if the binary is somewhere unusual
# TOWNREPORTER_CLAUDE_CODE=0      # take the CLI out of the chain entirely
# TOWNREPORTER_CODEX=0            # same switch for the Codex CLI
```

Two things worth knowing:

- **Your personal config is kept out of the newsroom.** Every call passes `--setting-sources ""`, so your own `CLAUDE.md`, skills and plugins are not loaded. Without that, your developer instructions get prepended to every news prompt.
- **It is slower than an API.** The CLI spawns a process and reloads a fixed preamble per call — a couple of seconds at best, longer for a real prompt. A draft takes minutes rather than seconds. Time budgets adjust automatically; you do not need to tune anything.

#### Claude by API key

```
ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-opus-5
# ANTHROPIC_EFFORT=high           # low | medium | high | xhigh | max
```

`ANTHROPIC_EFFORT` is the cost dial, and applies to the API path only. Lower is cheaper and faster; higher reads better.

#### Grok

```
XAI_API_KEY=xai-...
# XAI_MODEL=grok-4.5
# XAI_BASE_URL=https://api.x.ai/v1
```

`GROK_API_KEY` is accepted as an alias for `XAI_API_KEY`.

#### Any other model — three vars, no extra package

TownReporter POSTs to `{LLM_BASE_URL}/chat/completions` with `Authorization:
Bearer {LLM_API_KEY}`. If `LLM_BASE_URL` or the `LLM_API_KEY` + `LLM_MODEL`
pair is set, that wins for Scan and Dark Desk and becomes Story Automatic's
exclusive provider. An explicit Story picker choice still means exactly that
named provider and never falls back.

```
LLM_BASE_URL=http://127.0.0.1:4000/v1
LLM_API_KEY=sk-...
LLM_MODEL=claude-sonnet-4-5
```

| Gateway                                                                         | Example `LLM_BASE_URL`         | Notes                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [LiteLLM](https://github.com/BerriAI/litellm)                                   | `http://127.0.0.1:4000/v1`     | One proxy, many providers                                                                                       |
| [Bifrost](https://github.com/maximhq/bifrost)                                   | `http://127.0.0.1:4000/v1`     | Bifrost’s own default port is **8080**. That is TownReporter. Map it: `docker run -p 4000:8080 maximhq/bifrost` |
| [Helicone](https://github.com/Helicone/helicone)                                | `https://oai.helicone.ai/v1`   | Or your self-hosted worker                                                                                      |
| [MLflow AI Gateway](https://mlflow.org/docs/latest/llms/deployments/index.html) | `http://127.0.0.1:5000/v1`     |                                                                                                                 |
| [Kong AI Gateway](https://docs.konghq.com/gateway/latest/ai-gateway/)           | `http://127.0.0.1:8000/v1`     |                                                                                                                 |
| Ollama                                                                          | `http://127.0.0.1:11434/v1`    | `LLM_API_KEY=ollama` · `LLM_MODEL=llama3.1`                                                                     |
| OpenAI                                                                          | `https://api.openai.com/v1`    |                                                                                                                 |
| OpenRouter                                                                      | `https://openrouter.ai/api/v1` |                                                                                                                 |

`OPENAI_API_KEY` is accepted as an alias for `LLM_API_KEY`. You do **not** install LiteLLM, Bifrost, Helicone, MLflow, or Kong as npm dependencies of this repo. Run the gateway next to TownReporter and point the three vars at it.

Resolution lives in `src/lib/news/ai.ts` (`resolveProvider()`); the Claude Code path is `ai-claude-code.server.ts`.

#### Per-run picker

Each picker includes a **Set up a writing model** disclosure with official
Codex and Claude installation links, same-server-account sign-in guidance and
reload/retry instructions. Opinion explains the voice-file prerequisite. The
disclosure stays usable when drafting is disabled and does not install or
sign in for you.

Every active Queue row and the story workbench default to **Automatic**. A
configured `LLM_*` gateway is forced for Automatic. Without one, TownReporter
tries Claude Opus, then Codex Terra, and stores the first ready provider on
the job before it is enqueued. Every pass in that Story run uses the same
effective provider, unless that provider's login lapses mid-run -- Automatic
then moves to the next ladder rung once, if it is ready. A named choice
forces only that provider; explicit choices never fall back, at enqueue or
mid-run.

Zen MiMo and Local Qwen were removed from the picker (2026-09-02): Claude and
Codex only, for now. See [local-models.md](local-models.md) for the
surviving `LLM_BASE_URL` gateway path if you want to point Story at a model on
your own hardware.

| Choice      | Default identity | Prerequisite / boundary                                                                        |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Codex Terra | `gpt-5.6-terra`   | Install/open Codex and sign in. TownReporter reuses its OAuth state; it never reads the token.   |
| Codex Sol   | `gpt-5.6-sol`     | Same Codex login; frontier Story override.                                                       |
| Claude Opus | `claude-opus-5`   | Signed-in Claude Code, or `ANTHROPIC_API_KEY`.                                                   |

Compatibility overrides:

```env
TOWNREPORTER_CODEX_TERRA_MODEL=gpt-5.6-terra
TOWNREPORTER_CODEX_SOL_MODEL=gpt-5.6-sol
```

Set `CODEX_CLI_PATH` or `CODEX_HOME` only if normal discovery cannot find the
binary or OAuth state. Codex calls run ephemerally but otherwise use the native
signed-in Windows configuration: user and repository rules, search, local
shell/file access, browser/computer tools, apps, plugins, hooks, skills and
multi-agent capabilities remain available. TownReporter launches Codex with
`danger-full-access`, not a read-only sandbox, so it can reach every `C:\` path
the signed-in account can reach. The newsroom prompt still travels over stdin,
and its task remains the scope of the requested run.

Opinion displays Automatic and Claude Opus, and both mean Claude Opus. Codex
is not offered for editorials: its model declines to write a piece that takes
a position on a local policy question, so it stays on the Story picker. An
invalid delivery -- a refusal, an assistant note, an incomplete piece --
creates no draft. The completed request and job store the provider that
finished.

### The Opinion voice

The Opinion desk writes in a voice held in a **file on disk**, named by path:

```
TOWNREPORTER_VOICE_FILE=C:/Users/you/.townreporter/voice/your-voice.md
```

Rules the app enforces, not conventions:

- The path must be absolute. A relative path is refused.
- A path **inside this repository** is refused. The voice is meant to stay out
  of version control.
- On Claude, only the path reaches the CLI; Claude Code reads the file.
- On Codex, TownReporter reads the validated file and sends its text to OpenAI
  over stdin for the native full-capability writing pass. It never enters argv
  or logs.
- A path long enough to look like an inlined prompt is refused outright.

Without the variable, the Opinion desk says so and spends nothing. Everything
else on the desk works.

`TOWNREPORTER_EDITORIAL_MODEL` overrides the **Claude Opinion writing model**.
It defaults to Opus deliberately: it is the only call in the newsroom where
the writing _is_ the product. It does not change Story choices or Codex models.

Note the length, and the cost. A piece takes ten to forty minutes, because the
voice researches before it writes. Three measured runs:

| Wall clock | Cost   | Notes                                                 |
| ---------- | ------ | ----------------------------------------------------- |
| 9m53s      | $2.66  | one document pointer, 32 turns                        |
| 24m06s     | $23.76 | one pointer; it dispatched research agents of its own |
| >30m       | —      | same subject again, killed at the old cap             |

`EDITORIAL_TIMEOUT_MS` sets a ceiling **per research or writing pass**, not per
editorial, and defaults to 45 minutes. A complete provider pair can therefore
take about 90 minutes. Automatic may run two pairs, for up to roughly three
hours plus orchestration overhead if every pass approaches its ceiling. The
historical timings above are not a current maximum. The desk enqueues a job and
returns at once; the page does not wait on the model. This is the most expensive
workflow the newsroom makes — set a spending limit at the provider.

---

### Keeping it online

The `ops/` directory holds the scripts the working edition runs on Windows:

| Script                   | What it does                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `ops/watchdog.ps1`       | Every five minutes: check the app, the tunnel and the public URL; restart what is down; append to `logs/watchdog.log` |
| `ops/run-tunnel.ps1`     | Start `cloudflared` for this hostname                                                                                 |
| `ops/restart-app.ps1`    | Stop and start the paper                                                                                              |
| `ops/restart-tunnel.ps1` | Stop and start the tunnel                                                                                             |
| `ops/rotate-logs.ps1`    | Keep `logs/` bounded                                                                                                  |

Register the watchdog and the two restarts as **scheduled tasks**, not as child
processes of the app. Two reasons learned the hard way: a process cannot restart
itself, and a tunnel restart cannot deliver its own result over the tunnel it
just killed. The Server page at `/desk/ops` triggers the tasks and reads the
log.

---

### Database

| `DATABASE_URL` | What you get                                                              |
| -------------- | ------------------------------------------------------------------------- |
| unset          | Embedded PGLite. Fast to demo. **Wiped when the process stops.**          |
| `postgres://…` | Real Postgres. Survives restarts. Use this if you care about the archive. |

Schema is applied by `npm run db:migrate`, which both `npm run dev` and `npm run build` run for you. SQL lives in `migrations/`.

This page used to say the schema was applied "on boot", which was true of the
build and false of `npm run dev` -- the command the README gives you. A first
run against an empty Postgres met `relation "articles" does not exist` on the
front page. `dev` migrates first now, so the sentence above is true of both.

### Sign-in

```
BETTER_AUTH_URL=http://localhost:8080
BETTER_AUTH_SECRET=generate-a-long-random-string
```

- Self-host default: email + password on `/login` (`src/lib/auth/email-password.ts`).
- `BETTER_AUTH_SECRET` should be a long random string in any hosted environment. Locally, a process-stable fallback exists so `npm run dev` still signs in.
- `BETTER_AUTH_URL` should be the public origin people actually type (scheme + host, no path). Wrong origin = cookies that never stick.
- Grok Google / X buttons only render on `*.grok.me` / `*.grok-sandbox.com`, or if you set `VITE_GROK_OAUTH=true` **and** the `GROK_AUTH_*` broker vars. Ordinary self-hosters can ignore those.
- `VITE_AUTH_ENABLED=false` makes the desk unsigned-in. **Do not use on a public host.**

### A second editor

The first signed-in user is inserted into `newsroom_members` as `owner`. After that, Create editor account is gone and new accounts are rejected — with one keyed exception.

**Invite an editor** lives at the bottom of the Server page (`/desk/ops`), owner only. Type their email address, copy the one-time link it mints, and hand it over however you like. The link is bound to exactly that address, expires in seven days, burns on use, and the person sets their own password. They arrive as an **editor**: everything on the desk works for them, but they cannot invite others, and “Give up the desk” only removes their own seat — the newsroom stays yours. The server stores only a hash of the link, so copy it when it is shown; minting again for the same address replaces the old link. Do not turn auth off to “fix” anything.

### Cron (source monitors)

Background monitors tick in dev on an interval, and on demand:

```
GET /api/cron/monitors
```

If `CRON_SECRET` is set, send `Authorization: Bearer <CRON_SECRET>`. Point an external cron (or Vercel Cron) at that URL so missing packets still get noticed **and** Scan / Draft / Keep digging finish after the click even if this program went to sleep. One ping does both. This long-lived preview drains jobs on its own; a host that freezes after the request needs the ping.

---

## Playwright

```bash
npx playwright install chromium
# or: npm run playwright:install
```

Used when:

- A YouTube watch page has a **Show transcript** panel (the full tape, timestamped).
- A civic host is a JS app shell (Municode, eCode360, Granicus, Legistar, CivicClerk, BoardDocs, CivicPlus, American Legal; PrimeGov if the JSON API is gone).

Not used when:

- PrimeGov’s public JSON API + `CompiledDocument` PDFs (the normal path).
- Ordinary static HTML and most city PDFs.

If Chromium is missing, those fetches skip the browser path. Packets still ingest. Meeting tapes will say there is no transcript yet.

**Serverless caveat.** Playwright needs a real Chromium on the machine. A Vercel serverless function usually cannot open it. If transcripts and Municode matter, run TownReporter on a VPS, a home box, or any long-running Node host where `npx playwright install chromium` succeeded. The paper and desk still deploy to Vercel; the browser path just will not fire there.

---

## Production build

These commands are for a checkout whose `.output` is **not being served**.
Never build under a running server, even if no migration is needed. For the
existing Windows production installation, follow
[Updating this installation](../SELF-HOSTING.md#updating-this-installation)
instead: verify in development, approve the exact candidate, then use the
production promotion script with the watchdog held off.

```bash
npm run build
npm run preview    # serves the built app (this repo’s preview script)
```

`build` runs Vite, patches SSR exports, copies runtime assets, then migrates the database.

**The default build target is a plain Node server** (`node-server`), which produces `.output/server/index.mjs`. Run it with `npm start`. Any Node 22 host works — a VPS, a home box, a container.

That default is deliberate. A long-lived process is what makes the Chromium page reader usable and keeps background jobs whole. See [SELF-HOSTING.md](../SELF-HOSTING.md) for a worked example on a home machine behind a Cloudflare Tunnel.

Whatever the host, set:

- `DATABASE_URL` (Postgres; PGLite will not survive a restart)
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` = the public `https://…` origin
- `BETTER_AUTH_TRUSTED_ORIGINS` = every **other** origin the desk is reached from, comma-separated. A missing origin is rejected at sign-in with "Invalid origin" while pages still load normally, which reads like a wrong password.
- A model, or nothing at all if Claude Code is signed in on that machine

### Vercel

Still supported:

```bash
NITRO_PRESET=vercel npm run build
```

Two things stop working there, both by design:

- **Chromium does not run.** Playwright needs a real browser on the machine; a serverless function cannot open one. Transcripts and JavaScript-heavy civic sites (Municode) will not be read.
- **Background jobs get chopped up.** A serverless invocation may freeze once the click returns, so Scan / Draft / Keep digging only finish when the monitors ping arrives.

Also note there is normally no Codex or Claude Code CLI on a serverless host —
set `ANTHROPIC_API_KEY` or the `LLM_*` trio for Scan, Dark Desk, and Story
instead. Opinion is unavailable unless that host actually provides a signed-in
Codex or Claude Code CLI, because its frontier voice paths use those native
clients.

Scan, Draft, and Dark Keep digging persist a job and return. This long-lived process drains waiting jobs. A Vercel serverless invocation may freeze after the click returns — those jobs finish when the monitors ping (`GET /api/cron/monitors` with `CRON_SECRET`) hits. The paper and a typed draft still deploy without that ping; Scan / Draft / Keep digging need it on a host that sleeps.

---

## Tests

```bash
npm test
npm run test:lifecycle   # needs the app on :8080 and Playwright Chromium
```

Node’s built-in test runner. No network, no model calls. Coverage includes PrimeGov catalog matching, configured YouTube meeting discovery (including the June-vs-August museum false join), retrieval skipping hold-music transcript heads, draft notebook stripping, configured-timezone masthead dates, printed-headline collapse, paper setup, workbench draft-landing, auth gates, the Dark Desk loop, and durable jobs. CI also runs one Playwright lifecycle: create the desk, set up the paper, file a lead, publish, post a correction.

Nearly every CI browser walk builds the app and drives it through `npm start` (`.output/server/index.mjs`) — the same command production runs — rather than `npm run dev`, so the walks prove the built server, not just the dev server. One job (`smoke-dev` / "Documented dev path works in a browser") is the deliberate exception: it exists to prove the README's own `npm run dev` quick start still works.

---

## Point it at another city

The city setup is database-backed and owner-operated. Use **Set up the paper**
on first run, or **Server → Paper setup** later.

### 1. Masthead, locality and contact

Set the paper name, tagline, city, state and IANA timezone. The save derives the
reader-facing kicker and deck from those choices, changes the public clock and
meeting-cadence math, and rewrites the seeded welcome article for the city.
Optional council-votes and editor-contact fields may be left blank; blank means
the corresponding public link or address is not shown.

### 2. Watch list

Add the city site, council, agenda portal, planning department, utility, school
district, county and local reporting sources. You can add or retire individual
entries later at `/desk/sources`.

### 3. YouTube meeting channels

Under **Meeting video channels**, put the official city channel first and any
PEG or public-media sister channels after it, one URL per line. If one tape has
no captions, TownReporter can use a matching sister tape. Same-meeting titles
are merged only when their date clues agree.

Under **Meeting title keywords**, list the phrases that identify civic meetings
in your channels — for example `city council`, `planning commission`, or
`zoning appeals`. These saved values drive both meeting filtering and
sister-channel transcript matching. A blank channel list means TownReporter
uses none; it never falls back to Longmont after setup.

### 4. PrimeGov

If the city uses PrimeGov, add the public portal:

```
https://{tenant}.primegov.com/public/portal
```

Ingest uses `ListUpcomingMeetings` / `ListArchivedMeetings?year=` and `CompiledDocument?meetingTemplateId=…` (template id, not row id). Home `/` on PrimeGov redirects to login; the public catalog is `/public/portal`. You do not need Crawl4AI.

If the city uses Legistar, Granicus, CivicClerk, BoardDocs, or Municode instead, add those URLs as official sources. The Playwright render path already knows those hosts.

### 5. Topics

`TOPICS` in `paper.ts` is the paper’s section list (council, budget, housing, …). Change it if your beat list is different. The queue’s “file a lead” dropdown reads this array.

### What city setup does **not** do

- Invent an agenda portal from the city name. Add the exact public URL.
- Replace the built-in topic taxonomy. That remains the advanced `TOPICS`
  constant in `src/lib/paper.ts`.
- Convert an existing town's archive into a different town's archive. Use a
  fresh database for a different publication.
- Give you legal cover. You are the publisher.

---

## Layout of this repo (the parts that matter)

```
TownReporter/
├── src/lib/paper.ts           # city, masthead, seed sources
├── src/lib/news/              # ingest, PrimeGov, YouTube, Dark Desk, draft
├── src/lib/news/ai.ts         # provider resolution + budgets
├── src/lib/auth/              # email/password + optional Grok OAuth
├── src/routes/                # paper + desk pages
├── migrations/                # Postgres / PGLite schema
├── docs/                      # this manual, editor manual, landing
├── .env.example
└── LICENSE                    # MIT
```

---

## What will bite you

- **Forgot Playwright** → YouTube meetings ingest as titles with “no transcript yet.” PrimeGov PDFs still work.
- **PGLite in production** → archive vanishes on restart / scale-to-zero.
- **Bifrost on 8080** → it steals TownReporter’s port. Map 4000:8080.
- **Second Google account on a self-host box** → cannot create an account once the desk is claimed. See [A second editor](#a-second-editor).
- **`VITE_AUTH_ENABLED=false` on the public internet** → the desk is open. Don’t.
- **Captions in a published story as if they were minutes** → that’s on the editor. The software will not save you. See [editor.md](editor.md#meetings-and-tapes).
