# TownReporter — operator setup

**Current release: [0.5.1](https://github.com/scottconverse/TownReporter/releases/tag/v0.5.1).** Editors who only write and publish should start at [editor.md](editor.md). The short clone-and-run is in the [README](../README.md).

This is a Node 22 web app (TanStack Start + Vite). It is not a desktop installer and not a GitHub Pages app. The landing page in this folder is static marketing; the newsroom is `npm run dev` / `npm run build`.

To publish the landing: GitHub repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. That is a one-time click. It does not run the desk.

---

## What you need

| | |
|---|---|
| **Node** | 22 or newer (`node -v`). Types in this repo are Node 22. |
| **npm** | Comes with Node. `npm install` is enough. |
| **A model** | An [xAI key](https://console.x.ai) **or** any OpenAI-compatible `/v1/chat/completions` gateway. Scan, Draft, and Dark Desk will refuse to run without one. |
| **Chromium via Playwright** | Once: `npx playwright install chromium`. Meeting transcripts and JS civic sites need it. |
| **A database** | Optional for a look (embedded PGLite). Required for a real newsroom (Postgres). |

Windows, macOS, and Linux all work. The app binds `0.0.0.0:8080`.

---

## First run

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium
cp .env.example .env
```

Edit `.env`. **The minimum that produces a working desk is nothing at all** — if the [Claude Code](https://code.claude.com) CLI is installed and signed in, the desk uses that login. Check with:

```bash
claude --version
```

If you would rather use a key, or you do not have Claude Code, see [Model](#model) below.

Then:

```bash
npm run dev
```

Open the paper. Top right: **Create editor**. Email + password. That account is stored in **your** database. With no `NEWSROOM_SETUP_TOKEN`, that account becomes the newsroom **owner** and the button disappears. **Leave as editor** on the desk gives the hatch back. On a public host, set `NEWSROOM_SETUP_TOKEN` and paste it on Create the desk — signup alone does not own the desk.

- Paper: `http://localhost:8080/`
- Desk: `http://localhost:8080/desk`

`.env` is gitignored. Never commit it. `.env.example` is safe to commit.

---

## Environment

All of these are documented in [`.env.example`](../.env.example).

### Model

Resolution order, first match wins:

| # | Set this | What runs |
|---|---|---|
| 1 | `LLM_BASE_URL` or `LLM_API_KEY` + `LLM_MODEL` | any OpenAI-compatible endpoint, including a local model |
| 2 | `ANTHROPIC_API_KEY` | Claude, billed to that key |
| 3 | *nothing* | **Claude, through your local Claude Code login** |
| 4 | `XAI_API_KEY` | Grok |

#### Claude Code — the default, no key

Install the CLI and sign in once:

```bash
npm i -g @anthropic-ai/claude-code
claude          # then /login
```

That is the whole setup. Your Max or Pro subscription powers the desk.

```
# ANTHROPIC_MODEL=claude-opus-5   # the default
# CLAUDE_CLI_PATH=...             # only if the binary is somewhere unusual
# TOWNREPORTER_CLAUDE_CODE=0      # take the CLI out of the chain entirely
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

TownReporter POSTs to `{LLM_BASE_URL}/chat/completions` with `Authorization: Bearer {LLM_API_KEY}`. If `LLM_BASE_URL` or `LLM_API_KEY` is set, that **wins over everything above** — which is how you point the desk at a local model.

```
LLM_BASE_URL=http://127.0.0.1:4000/v1
LLM_API_KEY=sk-...
LLM_MODEL=claude-sonnet-4-5
```

| Gateway | Example `LLM_BASE_URL` | Notes |
|---|---|---|
| [LiteLLM](https://github.com/BerriAI/litellm) | `http://127.0.0.1:4000/v1` | One proxy, many providers |
| [Bifrost](https://github.com/maximhq/bifrost) | `http://127.0.0.1:4000/v1` | Bifrost’s own default port is **8080**. That is TownReporter. Map it: `docker run -p 4000:8080 maximhq/bifrost` |
| [Helicone](https://github.com/Helicone/helicone) | `https://oai.helicone.ai/v1` | Or your self-hosted worker |
| [MLflow AI Gateway](https://mlflow.org/docs/latest/llms/deployments/index.html) | `http://127.0.0.1:5000/v1` | |
| [Kong AI Gateway](https://docs.konghq.com/gateway/latest/ai-gateway/) | `http://127.0.0.1:8000/v1` | |
| Ollama | `http://127.0.0.1:11434/v1` | `LLM_API_KEY=ollama` · `LLM_MODEL=llama3.1` |
| OpenAI | `https://api.openai.com/v1` | |
| OpenRouter | `https://openrouter.ai/api/v1` | |

`OPENAI_API_KEY` is accepted as an alias for `LLM_API_KEY`. You do **not** install LiteLLM, Bifrost, Helicone, MLflow, or Kong as npm dependencies of this repo. Run the gateway next to TownReporter and point the three vars at it.

Resolution lives in `src/lib/news/ai.ts` (`resolveProvider()`); the Claude Code path is `ai-claude-code.server.ts`.

### The Opinion voice

The Opinion desk writes in a voice held in a **file on disk**, named by path:

```
TOWNREPORTER_VOICE_FILE=C:/Users/you/.townreporter/voice/your-voice.md
```

Rules the app enforces, not conventions:

- The path must be absolute. A relative path is refused.
- A path **inside this repository** is refused. The voice is meant to stay out
  of version control.
- Only the path ever reaches a command line. The file is read by the model CLI
  itself, never loaded into the app's memory and never passed as an argument —
  command lines are readable by every process on the machine.
- A path long enough to look like an inlined prompt is refused outright.

Without the variable, the Opinion desk says so and spends nothing. Everything
else on the desk works.

`TOWNREPORTER_EDITORIAL_MODEL` overrides the model for that one call. It
defaults to Opus deliberately: it is the only call in the newsroom where the
writing *is* the product.

Note the length, and the cost. A piece takes ten to forty minutes, because the
voice researches before it writes. Three measured runs:

| Wall clock | Cost | Notes |
|---|---|---|
| 9m53s | $2.66 | one document pointer, 32 turns |
| 24m06s | $23.76 | one pointer; it dispatched research agents of its own |
| >30m | — | same subject again, killed at the old cap |

The writer's ceiling is 45 minutes, set above the slowest run seen rather than
just above the fastest. The desk enqueues a job and returns at once; nothing
waits on the model. This is the most expensive call the newsroom makes — set a
spending limit at the provider.

---

### Keeping it online

The `ops/` directory holds the scripts the working edition runs on Windows:

| Script | What it does |
|---|---|
| `ops/watchdog.ps1` | Every five minutes: check the app, the tunnel and the public URL; restart what is down; append to `logs/watchdog.log` |
| `ops/run-tunnel.ps1` | Start `cloudflared` for this hostname |
| `ops/restart-app.ps1` | Stop and start the paper |
| `ops/restart-tunnel.ps1` | Stop and start the tunnel |
| `ops/rotate-logs.ps1` | Keep `logs/` bounded |

Register the watchdog and the two restarts as **scheduled tasks**, not as child
processes of the app. Two reasons learned the hard way: a process cannot restart
itself, and a tunnel restart cannot deliver its own result over the tunnel it
just killed. The Server page at `/desk/ops` triggers the tasks and reads the
log.

---

### Database

| `DATABASE_URL` | What you get |
|---|---|
| unset | Embedded PGLite. Fast to demo. **Wiped when the process stops.** |
| `postgres://…` | Real Postgres. Survives restarts. Use this if you care about the archive. |

Schema is applied on `npm run build` (`npm run db:migrate`) and on boot. SQL lives in `migrations/`.

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

The first signed-in user is inserted into `newsroom_members` as `owner`. After that, Create editor account is gone and new accounts are rejected.

There is no invite UI yet (0.5.1 has not named it). Do not turn auth off to “fix” this. Share the owner login, or wait for invite.

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

Also note there is no Claude Code CLI on a serverless host — set `ANTHROPIC_API_KEY` or the `LLM_*` trio instead.

Scan, Draft, and Dark Keep digging persist a job and return. This long-lived process drains waiting jobs. A Vercel serverless invocation may freeze after the click returns — those jobs finish when the monitors ping (`GET /api/cron/monitors` with `CRON_SECRET`) hits. The paper and a typed draft still deploy without that ping; Scan / Draft / Keep digging need it on a host that sleeps.

---

## Tests

```bash
npm test
npm run test:lifecycle   # needs the app on :8080 and Playwright Chromium
```

Node’s built-in test runner. No network, no model calls. Coverage includes PrimeGov catalog matching, YouTube meeting join (including the June-vs-August museum false join), retrieval skipping hold-music transcript heads, draft notebook stripping, Mountain Time masthead dates, printed-headline collapse, workbench draft-landing, auth gates, the Dark Desk loop, and durable jobs. CI also runs one Playwright lifecycle: create the desk, file a lead, publish, post a correction.

---

## Point it at another city

There is no settings screen for this. That is deliberate in 0.5.1 — the Longmont edition is the working proof, and a half-built city picker would lie. Edit the seed, rebuild.

### 1. The masthead and the watch list

[`src/lib/paper.ts`](../src/lib/paper.ts):

```ts
export const PAPER = {
  name: "TownReporter",
  city: "YourCity",
  state: "YourState",
  location: "YourCity, YourState",
  timezone: "America/Denver", // IANA. Masthead and meeting cadence use this, not UTC.
  tagline: "The public record is only the beginning.",
  kicker: "Independent civic reporting  ·  YourCity",
  deck: "…",
  trust: "Civic news, human-edited.",
} as const;
```

Replace `SEED_SOURCES` with your city site, council, agenda portal, planning, utility, school district, county, and video channels. `kind` is `official` | `news` | `youtube`. `tier` is `A` (primary record) or `B`.

Seeds upsert on desk boot (`on conflict do nothing`). Changing a seed later does not rewrite an already-accepted source — add or retire those from `/desk/sources`.

### 2. YouTube sister channels

[`src/lib/news/youtube.ts`](../src/lib/news/youtube.ts) — `LONGMONT_YOUTUBE_CHANNELS`. Put the official city channel first and the PEG / public-media channel second if you have one. Same-meeting titles are merged (month must match, so a June museum board does not join an August one). If the city tape has no captions, the sister tape is used.

Meeting-keyword filter and skip-list (`tldw`, block parties, cruise night) live in the same file. Edit them if your city’s video titles look different.

### 3. PrimeGov

If the city uses PrimeGov, add the public portal:

```
https://{tenant}.primegov.com/public/portal
```

Ingest uses `ListUpcomingMeetings` / `ListArchivedMeetings?year=` and `CompiledDocument?meetingTemplateId=…` (template id, not row id). Home `/` on PrimeGov redirects to login; the public catalog is `/public/portal`. You do not need Crawl4AI.

If the city uses Legistar, Granicus, CivicClerk, BoardDocs, or Municode instead, add those URLs as official sources. The Playwright render path already knows those hosts.

### 4. Topics

`TOPICS` in `paper.ts` is the paper’s section list (council, budget, housing, …). Change it if your beat list is different. The queue’s “file a lead” dropdown reads this array.

### What a city swap does **not** do yet

- Rewrite copy that names Longmont in About / How we report / some desk chrome. Search the repo for `Longmont` after you change `PAPER.city`.
- Invent a PrimeGov tenant from the city name. You add the URL.
- Migrate an existing PGLite/Postgres archive from Longmont to the new city. Start a fresh database.
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
