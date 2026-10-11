# TownReporter — operator setup

**Current software version: [0.6.83](releases/0.6.83.md).** See the release guide for changes and evidence boundaries; GitHub records package publication, while deployment and provider-run evidence remain separate. Editors should start at [the editor guide](editor.md).

This is a Node 22 web app (TanStack Start + Vite), with a Windows installation package. The landing page in this folder is static marketing; GitHub Pages does not run the newsroom. The manual source commands are `npm run dev` / `npm run build`.

To publish the landing: GitHub repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. That is a one-time click. It does not run the desk.

---

## What you need

|                             |                                                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node**                    | 22 or newer (`node -v`). Types in this repo are Node 22.                                                                                                                                                                               |
| **npm**                     | Comes with Node. `npm install` is enough.                                                                                                                                                                                              |
| **A model**                 | Every writing picker offers Codex Astra, Sol, Terra and Luna; Claude Fable, Opus, Sonnet and Haiku; Local model; and saved custom connections.     |
| **Chromium via Playwright** | Once: `npx playwright install chromium`. Meeting transcripts and JS civic sites need it.                                                                                                                                               |
| **A database**              | Optional for a look (embedded PGLite). Required for a real newsroom (Postgres).                                                                                                                                                        |

Windows, macOS, and Linux all work.

**Windows users:** start with the [Windows installation package](windows-install.md). It provisions private prerequisites and a persistent database; you do not need to follow the manual Node/PostgreSQL setup below. The rest of this guide remains the source-install and public-hosting reference, including macOS and Linux. Do not run machine-specific `ops/` scripts as a generic installer.

`npm run dev` serves on `127.0.0.1:8080` by default (this PC only) — that
port is hard-coded in `vite.config.ts` (`strictPort: true`) as the
live-preview contract for the build tooling this repo was scaffolded with,
and it does **not** read `PORT`. Run `npm run dev:lan` to open it to your
network (`0.0.0.0:8080`) for phone/LAN testing.
The **built** server (`npm start`, `.output/server/index.mjs`) is the one that
honours `PORT` (default `3000`) and `HOST` (default every interface — set
`HOST=127.0.0.1` when a tunnel or reverse proxy fronts it).
The legacy operator scripts identify the paper by its owned IPv4 listener and verify the server command line before stopping it. The Windows
package also refuses occupied ports and checks that Windows permits an exclusive
loopback bind before starting.

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
| **Model calls**    | Scan, Draft, Dark Desk, Opinion                   | Each desk records its per-run choice first. A recognized technical failure can retry only the unfinished call on the next ready runtime and records requested/actual model and effort; a content refusal is terminal. Unattended ladders use Codex first and Claude Sonnet last, never Opus. |
| **Source fetches** | Watched pages, packets, PDFs, YouTube transcripts | The sites that host them. Normal web requests, guarded at connect time against private addresses (the SSRF guard).                                                                                                                                                                               |
| **Searches**       | Public-source research, PULL, and Dark Desk hops  | A third-party search chain, tried in order: Exa's hosted endpoint (`https://mcp.exa.ai/mcp`), then DuckDuckGo, Bing, Brave and Wikipedia (`src/lib/news/search-web.ts`). None needs an API key. Drafting scope **Use only supplied material** skips discovery/search for that draft, but still opens URLs you supply. PULL and Dark Desk remain separate external-research actions. |

The third row is the one to know before you use it: a name, an LLC, a
contract number, or an unpublished rumour typed into Dark Desk is seen by
whichever of those providers answers the query. This is unrelated to the
self-contained front page described above — the "zero outside requests"
claim is about the paper's own pages, not the desk.

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

Open the paper. Top right: **Create editor**. Email + password. On an unclaimed desk, the first account must also enter its one-time setup code. The sign-in form points to `logs/SETUP-CODE.txt` in the server data folder, and the server prints the code once in its log. In a source checkout, the data folder is `TOWNREPORTER_DATA_ROOT` when set, otherwise `.townreporter-data` under the project directory. The code is generated in development as well as by the built server. That account is stored in **your** database and becomes the newsroom **owner**. Sign-in has two limits: ten attempts every five minutes from any one address (`src/lib/auth/server.ts`), and an account lockout of ten failed attempts in fifteen minutes (`src/lib/auth/account-lockout.server.ts`). The lockout applies to the real owner too, not only an attacker, and a correct sign-in clears it immediately. There is no email password-reset service.

While signed in, generate and securely save recovery codes from **Server → Recovery codes**. Each code works once; use **Lost your password? Use a recovery code** on the sign-in screen if you lose access. A valid code provides a one-time temporary password; sign in with it, then change your password. Generating a replacement set retires the previous set. **Give up the desk** unclaims the newsroom; the next owner must enter the setup code required for an unclaimed desk. It is not account recovery.

The next screen is **Set up the paper**. Enter:

- paper name, tagline, city, state and an [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones);
- the optional council-votes link and editor contact address;
- the starting watch list;
- optional YouTube meeting channels, one URL per line; and
- meeting-title keywords, one phrase per line.

Save once and the desk opens. Before that moment, the public site shows a
neutral “Not yet set up” page and no articles. The same form remains under
**Server → Paper identity** (**Paper setup** panel), so a typo or a changed source never requires a code
edit or rebuild.

To hand the newsroom to someone else, use **Give up the desk** at the bottom of the Server page; it asks you to type your email address, because it cannot be undone.

- Paper: `http://localhost:8080/`
- Desk: `http://localhost:8080/desk`

`.env` is gitignored. Never commit it. `.env.example` is safe to commit.

---

## Environment

All of these are documented in [`.env.example`](../.env.example).

### Model

The following is the low-level configured-provider resolution. Story, Scan and Dark Desk also have per-run pickers: explicit choices override this chain, and Automatic uses the configured gateway when present, otherwise the readiness ladder described below.

| #   | Set this                                      | What runs                                                                   |
| --- | --------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `LLM_BASE_URL` or `LLM_API_KEY` + `LLM_MODEL` | any OpenAI-compatible endpoint; Story Automatic tries this gateway first    |
| 2   | `ANTHROPIC_API_KEY`                           | credentials for selected Claude models; Claude Sonnet is the last rung of Opinion's Automatic only |
| 3   | _nothing_                                     | stories, scans and Dark Desk walk the Automatic ladder — DeepSeek v4.1 Flash, then the local model on this computer (whichever one LM Studio has loaded), then Codex Terra; Opinion walks DeepSeek v4.1 Flash, then Codex Sol, then Claude Sonnet |

There is no fourth rung. Grok (xAI) was removed as a provider: `XAI_API_KEY`
is ignored, the SuperGrok sign-in is gone, and an install that still sets the
key is told so once at start-up. A saved Custom AI connection, or
`LLM_BASE_URL` below, still reaches any OpenAI-compatible endpoint you want.

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
# ANTHROPIC_MODEL=claude-sonnet-4-5 # optional configured-Claude override; Automatic never selects Opus
# CLAUDE_CLI_PATH=...             # only if the binary is somewhere unusual
# TOWNREPORTER_CLAUDE_CODE=0      # take the CLI out of the chain entirely
# TOWNREPORTER_CODEX=0            # same switch for the Codex CLI
```

Two things worth knowing:

- **Claude Code is constrained too.** TownReporter omits the operator's `CLAUDE.md`, skills, plugins and MCP configuration, starts the CLI outside the application tree in restricted safe mode, and allows only `WebSearch` and `WebFetch` for a caller-authorized research request. Planning calls hide tools; OCR reads one generated temporary page. Reporting does not receive shell, arbitrary file, browser or agent tools.
- **It is slower than an API.** The CLI spawns a process and reloads a fixed preamble per call — a couple of seconds at best, longer for a real prompt. A draft takes minutes rather than seconds. Time budgets adjust automatically; you do not need to tune anything.

#### Claude by API key

```
ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-4-5 # optional configured-Claude override; Automatic never selects Opus
# ANTHROPIC_EFFORT=high           # low | medium | high | xhigh | max
```

`ANTHROPIC_EFFORT` is the cost dial, and applies to the API path only. Lower is cheaper and faster; higher reads better.

#### Any other model — three vars, no extra package

TownReporter POSTs to `{LLM_BASE_URL}/chat/completions` with `Authorization:
Bearer {LLM_API_KEY}`. If `LLM_BASE_URL` or the `LLM_API_KEY` + `LLM_MODEL`
pair is set, that is the first runtime for Scan and Dark Desk and becomes Story
Automatic's first runtime. A recognized technical failure can move only the
unfinished model call to the next ready cloud runtime; a refusal is terminal.

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

#### Named custom connections

For an endpoint used only when an editor explicitly selects it, open
**Server → Add your own AI API**. Save a recognizable name, an HTTP(S) base
URL, an optional key (stored server-side), and a model discovered from `/models`
or entered manually. **Test connection** checks the saved chat-completions
path and reports capability information; it does not change Automatic. The
same panel supports **Edit**, **Disable/Enable**, and irreversible **Delete**.
An explicitly selected connection is the recorded first runtime. A recognized
technical failure can move only the unfinished call and records the destination;
review what leaves the machine with each endpoint operator. The full operator
walkthrough, including the optional LiteLLM example, is in
[custom-ai-connections.md](custom-ai-connections.md).

#### Per-run picker

Each picker includes a **Set up a writing model** disclosure with official
Codex and Claude installation links, same-server-account sign-in guidance and
reload/retry instructions. Opinion explains the voice-file prerequisite. The
disclosure stays usable when drafting is disabled and does not install or
sign in for you.

Every active Queue row and the story workbench default to **Automatic**. A
configured `LLM_*` gateway is forced for Automatic. Without one, TownReporter
uses DeepSeek v4.1 Flash first, then the local model this computer has loaded
if there is one, then Codex Terra, and stores the first ready provider on the job before it is
enqueued. Every pass in that Story run uses the same
effective provider unless it reaches a usage limit, becomes unavailable,
loses its login, or times out mid-run. Automatic then moves the unfinished
model call to the next ladder rung once, if it is ready. Earlier calls in that
active run are not repeated. A later restarted job retains uploaded source
material but may read it again. A content refusal stops the run. A named choice
is the first recorded provider and uses the same technical-only per-call retry
rule.

Zen MiMo and Local Qwen were removed from the picker (2026-09-02). 0.6.10
brought a local model back as a named pick, "Local model": generic this
time, whatever `LLM_BASE_URL` (plus `LLM_MODEL` / `LLM_API_KEY`) already
points at, shown on every picker once that variable is set. With nothing
configured, TownReporter also discovers Ollama, LM Studio, or llama.cpp
running on their default ports. See
[local-models.md](local-models.md) for the one-command way to get started.

| Choice | Default identity | Prerequisite / boundary |
| ------ | ---------------- | ----------------------- |
| Codex Astra / Sol / Terra / Luna | `gpt-6-astra` / `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` | Install/open Codex and sign in. TownReporter reuses its OAuth state; it never reads the token. |
| Claude Fable / Opus / Sonnet / Haiku | Claude CLI aliases `fable` / `claude-opus-5` / `sonnet` / `haiku` | Signed-in Claude Code, or `ANTHROPIC_API_KEY`. |
| Local model | whatever `LLM_MODEL` names | Discovered LM Studio/Ollama/llama.cpp model, or `LLM_BASE_URL` set (plus `LLM_MODEL`, and `LLM_API_KEY` if the server wants one). `TOWNREPORTER_LOCAL=0` takes it out of the pickers. |

Compatibility overrides:

```env
TOWNREPORTER_CODEX_TERRA_MODEL=gpt-5.6-terra
TOWNREPORTER_CODEX_SOL_MODEL=gpt-5.6-sol

# Optional local Halo Research Gateway MCP search provider; unset keeps the
# built-in fallback chain. Use only the unauthenticated loopback MCP endpoint.
# TOWNREPORTER_GATEWAY_MCP_URL=http://127.0.0.1:8765/mcp
```

Set `CODEX_CLI_PATH` or `CODEX_HOME` only if normal discovery cannot find the
binary or OAuth state. TownReporter reuses the signed-in account for CLI
authentication, but does not pass the operator's Codex setup into reporting
calls. Each call ignores Codex user configuration, starts from the system
temporary directory, runs ephemerally with a read-only sandbox, and disables
shell, computer, browser, apps, plugins, multi-agent and hook features. Native
web search is added only for a caller-authorized research call. Opinion's full
voice is supplied separately through Codex's instruction-file setting. These
are application-level CLI controls, not an operating-system security sandbox:
the reporting process still runs as the Windows account, and read-only mode
does not by itself restrict which files that account can read. Treat fetched
pages, transcripts and documents as evidence, never as instructions to expand
the reporting task.

Opinion displays Automatic, all named Codex and Claude models, Local model,
plus DeepSeek v4.1 Flash and saved custom connections. Codex Sol is selected by
default. **Opinion's own
Automatic** tries DeepSeek v4.1 Flash, then Codex Sol, then Claude Sonnet once if
the one before it is unavailable.
That is the Opinion ladder only, and DeepSeek is the one rung it shares with the
desk's own ladder. Stories, scans and Dark Desk walk the desk's
own Automatic ladder: DeepSeek v4.1 Flash, then the local model on this computer
(whichever one LM Studio has loaded), then Codex Terra. Claude Sonnet is a hand pick on those
surfaces. Explicit choices remain the requested first
runtime and can move only an unfinished call after a recognized technical
failure. An invalid
delivery -- a refusal, an assistant note, an incomplete piece --
creates no draft. The completed request and job store the provider that
finished.

**Scanned PDFs** (a council packet with no text layer) can be transcribed by a
selected provider that supports vision. TownReporter first renders each actual PDF page
through the local PDF renderer, including scan encodings that cannot be found
by lifting a JPEG/PNG stream, then sends that page image to the chosen vision
provider (`src/lib/news/ocr.ts`). Newly rendered records carry numeric PDF
page order for citations. Initial capture attempts the first 12 PDF pages.
In Dark Desk, **Read entire PDF** plans every missing page as durable groups of
up to 12 and saves a group before the next provider call. Each group rejects
rendered PNGs over 2 MiB. One complete-read job shares a cooperative 10-minute
and 48-transcription-attempt budget across its groups, then pauses with saved
progress. A failed, skipped or oversized page is explicitly incomplete and can
be retried without repeating saved pages; the renderer cannot forcibly interrupt
one page already running. Legacy stored `ocr:` records remain extracted-image
records: their labels continue to say that PDF page order is not established,
so they need re-ingest or operator review before page citation. Claude Opus
(API or CLI) and Codex provide vision paths when their prerequisites are met;
a reachable provider is not a guarantee that a particular scan can be read. A
text-only provider is refused for OCR with the reason stated, and the run moves
to a vision path rather than trying a model that cannot read an image. Automatic
OCR checks its established availability order — Anthropic API,
Codex, Claude Code, then a discovered local vision model. A local model can only
do it if it is a *vision* model -- pick one marked
**`· vision`** in the picker (or in the Server page's local-model table).
A historical built-runtime renderer check was performed with mock transcription. A single
source-path Codex/Terra run read 11 of 44 pages from a scanned council packet;
pages 1 and 3 were visually checked, page 10 failed, and pages 13–44 were
not attempted under the existing cap. That ingestion run did not prove
full-packet or packet-quality acceptance. See
[local-models.md](local-models.md#scanned-pdfs-and-why-they-need-a-vision-model)
for the full picture.

The 12-page value is the captured-source OCR batch size, not a total packet
limit and not the shared large-document uploader's limit. **Read entire PDF**
opens the retained original, counts its pages, checkpoints every batch and
resumes from page-numbered evidence already saved. A packet larger than one
run's time/call budget can therefore finish over several resume clicks without
re-reading successful pages. **Read selected pages** can
still request any 1-based inclusive range of up to 12 pages, including later
pages such as page 13. The result is
page-numbered additional evidence alongside the unchanged original and does
not refetch a missing PDF. See [pdf-page-reading.md](pdf-page-reading.md).
A bounded built-UI proof read real page 13 of a 44-page PDF and preserved the
16,254,338-byte original and its hash. It matched the main table rows and key
dates but omitted color-only RAG status and had a minor verb error, so full
packet and table-perfect quality remain unproven; compare every result with the
original before relying on it.

### The Opinion voice

The Opinion desk writes in a voice held in a **file on disk**, named by path:

```
TOWNREPORTER_VOICE_FILE=C:/Users/you/.townreporter/voice/your-voice.md
```

Rules the app enforces, not conventions:

- The path must be absolute. A relative path is refused.
- A path **inside this repository** is refused. The voice is meant to stay out
  of version control.
- Claude uses its native system-prompt-file option; Codex uses `model_instructions_file`. Both read the complete validated file. The assignment and retained evidence are separate input. The writer researches and writes with the voice in hand: the voice file carries the research protocol, so it holds the web tools as well as the file in one run. That combination is an accepted risk, stated in SECURITY.md.
- For explicit Local model, TownReporter reads the validated file and sends
  its text as a system message to the selected model server. It does not enter
  command-line arguments. Saved custom connections similarly receive the voice through their selected API endpoint.
- A writer with no web tools — explicit Local model, DeepSeek v4.1 Flash, a
  saved custom connection — is fetched for by the desk. The same voice text is
  the system message of the research calls too, so the protocol governs what the
  desk is asked to look for; the desk reads the newsroom's own record first, then
  searches, and runs to the protocol's stopping conditions under a safety ceiling
  (30 minutes, 80 pages, configurable through `EDITORIAL_RESEARCH_CEILING_MS` and
  `EDITORIAL_RESEARCH_PAGE_CEILING`) rather than to a fixed search count.
- A path long enough to look like an inlined prompt is refused outright.

Without the variable, the Opinion desk says so and spends nothing. Everything
else on the desk works.

The Opinion picker controls the writing model exactly. Named Claude choices use
Fable, Opus, Sonnet, or Haiku as labelled; named Codex choices use Astra, Sol,
Terra, or Luna as labelled.

Note the length, and the cost. A piece takes ten to forty minutes, because the
voice researches before it writes. Three measured runs:

| Wall clock | Cost   | Notes                                                 |
| ---------- | ------ | ----------------------------------------------------- |
| 9m53s      | $2.66  | one document pointer, 32 turns                        |
| 24m06s     | $23.76 | one pointer; it dispatched research agents of its own |
| >30m       | —      | same subject again, killed at the old cap             |

`EDITORIAL_TIMEOUT_MS` sets a ceiling **per research or writing pass**, not per
editorial, and defaults to 45 minutes. A complete provider pair can therefore
take about 90 minutes plus orchestration overhead. Automatic can try the Claude Sonnet pair after Codex fails, increasing the total duration; it does not fall back to Local model. Explicit Local
model makes one writing call from supplied material, with no separate research
pass. The
historical timings above are not a current maximum. The desk enqueues a job and
returns at once; the page does not wait on the model. This is the most expensive
workflow the newsroom makes — set a spending limit at the provider.

---

### Fetch limits

The shared guarded HTTP fetch reads at most **5,000,000 bytes** for web/text,
feeds and JSON, or **25,000,000 bytes** for PDF. It checks both declared length
and streamed bytes and cancels an oversized response. Supported types are
HTML/XHTML, plain text, XML/RSS/Atom, JSON, SSE, CSV and PDF. Explicit unsupported
types are rejected. A missing type remains size-bounded; octet-stream is accepted
only for a PDF path. Redirect/error bodies are discarded while status is retained.

These limits do **not** cover Chromium's renderer network resources or direct
AI/provider transports. OCR has its own image and time limits. A refused fetch
is unavailable evidence, not evidence that a record does not exist.

### Keeping it online

This section is for **separately configured legacy installations**, including
Halo. Before using these scripts, the local operator must establish the
[legacy ownership configuration](../SELF-HOSTING.md). The Windows package uses
its own launchers and health/restart controls; it installs no scheduled tasks,
watchdog or tunnel and refuses these legacy operations.

The `ops/` directory holds the legacy scripts:

| Script                   | What it does                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `ops/watchdog.ps1`       | Every five minutes: check the app, the tunnel and the public URL; restart what is down; append to `logs/watchdog.log` |
| `ops/run-tunnel.ps1`     | Start `cloudflared` for this hostname                                                                                 |
| `ops/restart-app.ps1`    | Stop and start the paper                                                                                              |
| `ops/restart-tunnel.ps1` | Stop and start the tunnel                                                                                             |
| `ops/rotate-logs.ps1`    | Keep `logs/` bounded                                                                                                  |
| `ops/status.ps1`         | Read-only: is the paper up? Also the Reddit reader and the DeepSeek model server. `-Root` describes another install; `-DryRun` says what it would do and does nothing |
| `ops/start-townreporter.ps1` | Start Postgres, migrate, serve — and start the Reddit reader if one is installed |
| `ops/stop-townreporter.ps1` | Stop the paper and the Reddit reader (`-IncludeDatabase` for Postgres too)                                         |
| `ops/redlib.ps1`         | The local Reddit reader: `status`, `start`, `stop`, `restart`, `check`, `setup`                                        |

For that legacy installation, register the watchdog and the two restarts as **scheduled tasks**, not as child
processes of the app. Two reasons learned the hard way: a process cannot restart
itself, and a tunnel restart cannot deliver its own result over the tunnel it
just killed. The Server page at `/desk/ops` triggers the tasks and reads the
log.

#### What starts after a reboot

Once the operator logs in. Nothing runs before the logon.

| What                       | Started by                                          |
| -------------------------- | --------------------------------------------------- |
| Postgres                   | the logon task, `ops/start-townreporter.ps1`         |
| The paper                  | the same task, after Postgres accepts connections    |
| The Reddit reader (Redlib) | the same task, detached, and the watchdog after that |
| Ollama (DeepSeek's server) | the operator's own Startup shortcut (`Ollama.lnk`)   |
| The tunnel                 | the tunnel logon task, `ops/run-tunnel.ps1`          |
| Anything that has stopped  | the watchdog, every five minutes                     |

The last three are optional. **Redlib** down, missing or switched off
(`TOWNREPORTER_REDLIB=0`) means the desk reads a subreddit through Reddit's
`.rss` and says so in the source text. **Ollama** down, missing or switched off
(`TOWNREPORTER_OLLAMA=0`) means *Automatic* moves to the next model on its
ladder. **LM Studio** is never started, probed or unloaded by anything in
`ops/`; it owns its own models.

#### The Control page on this machine

`ops/control.ps1` starts **TownReporter Control** at `http://127.0.0.1:3095`:
a page served by this checkout, on this computer, that says whether the machine
is healthy and puts the actions behind buttons. One large line reads
**Everything is up** or **N things need attention**; under it each check is one
card with a plain verdict and, when it is down, the single button that fixes it.
The rows are the database, the paper, the public site, the Redlib reader,
Ollama, the last backup, the last scan and the test copy. Redlib and Ollama are
marked **optional**, so a machine without them still reads *Everything is up*.

The six buttons carry the menu's own wording: check, restart the paper, restart
the tunnel, start everything, stop everything, restart the Reddit reader.
Pressing one streams its output into the page and refreshes the status when it
finishes. **Stop everything** opens a dialog naming what it will stop, and
cancelling does nothing at all. The page also links to the public paper, the
desk and the test copy on 3100.

Three properties to keep in mind before changing any of it:

- **Loopback only, and only to itself.** It binds `127.0.0.1` and refuses a Host
  header that is not this server. Each button press must also carry a token the
  page holds plus a matching Origin, so another page in the same browser cannot
  press one. It exits by itself after an hour with no requests.
- **It cannot publish, edit or delete anything.** The six actions are a fixed
  list — each an absolute System32 executable with a fixed argument array, no
  shell, and no argument that comes from the page. Ollama is only asked whether
  a model is ready; it is never loaded or unloaded.
- **One source of truth.** The page renders `ops/status.ps1 -Json`, so the
  console and the page cannot disagree about a row they both show.

For the Desktop icon, `ops/install-shortcut.ps1` builds a shortcut that runs
`ops/control.ps1` through `ops/run-hidden.vbs`, so no console window sits behind
the page; `-Fallback` builds the older `cmd /k` shortcut onto
`ops/TownReporter Control.cmd` instead. The numbered menu is unchanged as the
fallback — it needs nothing but Windows, where the page needs the checkout and
Node — and its entry 7 opens the Control page. Neither the page nor the
shortcut adds a scheduled task.

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

- Email + password on `/login` is the only way in (`src/lib/auth/email-password.ts`). There is no Google, X or broker sign-in to configure.
- `BETTER_AUTH_SECRET` should be a long random string in any hosted environment. Locally, a process-stable fallback exists so `npm run dev` still signs in.
- `BETTER_AUTH_URL` should be the public origin people actually type (scheme + host, no path). Wrong origin = cookies that never stick.
- The session cookie is `__Host-tr-auth.session_token`. **Updating across 0.6.83 signs every editor out once** — the cookie was renamed, so the browser stops sending the old one and the visitor simply lands on `/login`.
- `VITE_AUTH_ENABLED=false` makes the desk unsigned-in. **Do not use on a public host.**

### A second editor

The first signed-in user is inserted into `newsroom_members` as `owner`. After that, Create editor account is gone and new accounts are rejected — with one keyed exception.

**Invite an editor** lives at the bottom of the Server page (`/desk/ops`), owner only. Type their email address, copy the one-time link it mints, and hand it over however you like. The link is bound to exactly that address, expires in seven days, burns on use, and the person sets their own password. They arrive as an **editor**: everything on the desk works for them, but they cannot invite others, and “Give up the desk” only removes their own seat — the newsroom stays yours. The server stores only a hash of the link, so copy it when it is shown; minting again for the same address replaces the old link. Do not turn auth off to “fix” anything.

### Cron (source monitors)

Background monitors tick in dev on an interval, and on demand:

```
GET /api/cron/monitors
```

Send `Authorization: Bearer <CRON_SECRET>`. The endpoint refuses unauthenticated calls; with `CRON_SECRET` unset it returns 503 and does no work. Point an external cron (or Vercel Cron) at that URL so missing packets still get noticed **and** Scan / Draft / Keep digging finish after the click even if this program went to sleep. One ping does both. This long-lived preview drains jobs on its own; a host that freezes after the request needs the ping.

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

Self-hosted builds include matching `playwright` and `playwright-core` packages in
`.output/server/node_modules`; Chromium itself remains in the browser cache.
On the live box, run `npm run playwright:install` from the installed app as the
same Windows user that runs the server. The Windows installer sets
`PLAYWRIGHT_BROWSERS_PATH` to its configured browser directory; use that same
value when installing. Without an override, Playwright uses the user's normal
cache (`%LOCALAPPDATA%/ms-playwright` on Windows). An upgrade must install the
Chromium revision matching the installed Playwright version. The app logs the
actual module/launch/page error and browser path when rendering fails, then
tries public feeds. It does not download a browser during a source read.

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
instead. Opinion Automatic requires a ready Codex Sol or signed-in Claude
Sonnet fallback and the configured voice file. Every explicit named Claude or
Codex model, Local model, or custom choice is tried first; a recognized
technical failure can move only the unfinished call and records requested and
actual model and effort. Explicit Local
model has no separate research pass. These provider options do not remove
serverless job-lifetime limits.

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
on first run, or **Server → Paper identity** (**Paper setup** panel) later.

### 1. Masthead, locality and contact

Set the paper name, tagline, city, state and IANA timezone. The save derives the
reader-facing kicker and deck from those choices, changes the public clock and
meeting-cadence math, and rewrites the seeded welcome article for the city.
Optional council-votes and editor-contact fields may be left blank; blank means
the corresponding public link or address is not shown, and a blank council-votes
field also means section 5 reads no structured vote record for this paper — it
does not read another city's.

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

After saving setup, an owner can enable the **Meeting capture** panel at
**Server → Meeting capture** and choose **Run meetings now** for an on-demand
pass. This does not consume the scheduled daily run. While a pass is active,
**Stop** requests a stop; **Resume stopped captures** continues partial files
that remain on disk. The **Captured meetings** section at **Scan → Captured
meetings** reports capture/alignment outcomes and links a filed lead or draft
with **Open the story**. For the complete editor workflow—including used
citations, redrafting against a newer transcript, publication review, and the
limits of captions—see [From a meeting recording to a story in the editor’s
manual](editor.md#from-a-meeting-recording-to-a-story).

#### Which python runs yt-dlp (0.6.80)

Capture starts yt-dlp as a python program — `python -m yt_dlp` — and reads a
meeting's audio through **ffmpeg**, so both have to be installed on the machine
that runs TownReporter. If that machine has more than one python and only one of
them carries yt-dlp, the order of `PATH` silently decides which one a capture
gets. Name the right one in the app's `.env` (or in the environment of the
service that runs it):

```
TOWNREPORTER_PYTHON=C:\Program Files\Python313\python.exe
```

Left unset the desk uses `python` from `PATH`, as it always has. A path that is
set but has no file behind it is refused in words, naming the variable and the
path, rather than quietly running a different interpreter. To read the same
answer off the machine, the Control page's **Meeting video tools** row runs that
interpreter with `-m yt_dlp --version` and `ffmpeg -version` and names both, or
says which one did not answer and what to set.

#### Speech-to-text for tapes with no captions (optional)

TownReporter does not ship this tool and the Windows installer does not add
it. Without it, a meeting that has no captions stays audio-only, which is what
the app did before this existed. If you want those tapes transcribed, install
**[textflowkit](https://github.com/scottconverse/textflowkit)** on the machine
that runs TownReporter:

```
python -m pip install textflowkit
```

It calls **ffmpeg** to read the audio, so ffmpeg has to be installed and on
`PATH` as well. Then tell TownReporter where it is, either in the environment
of the service that runs the app:

```
TEXTFLOWKIT_CLI_PATH=C:\path\to\textflowkit.exe
```

or by leaving that unset and putting `textflowkit` on `PATH`. `TEXTFLOWKIT_ENGINE`
optionally selects `whistle`, `whisper`, or `faster-whisper`; otherwise a
`TEXTFLOWKIT_MODEL` other than `whistle` selects Whisper with that model, and
an unset model or `whistle` selects Whistle. Whisper engines default to model
`small`; Whistle uses its engine default (or model `whistle`). On CLIs older
than 0.1.9, Whistle falls back to Whisper with model `small`, and the desk says
so; upgrade to 0.1.9+ for Whistle. `TEXTFLOWKIT_LANGUAGE` defaults to `en`.
A larger Whisper model takes longer; run a meeting by hand first and watch
the row before you turn it loose on a schedule.

To check, open **Server → Meeting capture**. One line tells you what the desk
found: the version, the model and the language, or that it is not installed.
That line is the answer to "why did this captionless meeting stay audio-only".

The tool reads the recording the capture already downloaded and writes its own
JSON into the meeting’s storage folder; the desk stores that JSON as the
transcript, hashed, beside the audio. It is labeled in the desk as
speech-to-text, not official captions. A run that cannot finish — no tool, no
audio, a recording that no longer matches the hash the desk recorded for it, or
a run past its allowance — leaves a named reason on the meeting and keeps the
recording, so the next pass can try again.

### 4. PrimeGov

If the city uses PrimeGov, add the public portal:

```
https://{tenant}.primegov.com/public/portal
```

**Accept** the row once it is on the watch list. The first accepted source whose
host ends in `.primegov.com` is the portal this newsroom reads — that is the
only place the portal is configured, and there is no built-in city to fall back
on. With no PrimeGov source accepted, meeting videos are ingested without a
packet lookup rather than against some other city’s portal; if you have more
than one portal accepted, only the first is read.

Ingest uses `ListUpcomingMeetings` / `ListArchivedMeetings?year=` and `CompiledDocument?meetingTemplateId=…` (template id, not row id). Home `/` on PrimeGov redirects to login; the public catalog is `/public/portal`. You do not need Crawl4AI.

A meeting video joins a portal meeting only when the tape's date and the
meeting's date agree **and** the two titles share a body name (`city council`,
`planning`, `zoning`, `school board`, …). A shared date alone is not enough —
several bodies meet on the same night — so a tape whose title carries no date
and no body name is written without a packet rather than joined to the nearest
meeting.

If the portal answers with a failure on both of its meeting lists (a 5xx, a
timeout or a block), the source is recorded as "Could not check" with the reason
and no catalog is stored. If only one list fails, the catalog is stored with a
`PARTIAL` line naming the list that could not be read. An outage is never
recorded as a portal with no meetings.

If the city uses Legistar, Granicus, CivicClerk, BoardDocs, or Municode instead, add those URLs as official sources. The Playwright render path already knows those hosts.

### 5. Newspaper sections

After saving Paper setup, open **Server → Sections** (**Newspaper sections** panel). The owner can add, rename, reorder, hide and retire sections, assign accepted sources, and write reporting briefs and scan instructions. Review the unsaved old and new values before confirming; source assignments show names and URLs. Retirement requires a replacement and explicit impact confirmation. See [the editor guide](editor.md#newspaper-sections) for the full workflow.

Migration 0045 preserves existing topic keys and seeds their labels. It does not rename or delete stories. Runtime filing resolves retired keys so queued work cannot restore a retired section. Existing keys are stable URLs; display names can change. Source assignments and section configuration belong to one newsroom.

### What city setup does **not** do

- Invent an agenda portal from the city name. Add the exact public URL.
- Choose your reporting priorities. Configure sections and assign accepted sources in the owner controls after Paper setup.
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
├── src/lib/auth/              # email/password sign-in + session
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

## Current Opinion document and review workflow

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion opens on Automatic, which tries DeepSeek v4.1 Flash, then Codex Sol, then Claude Sonnet. Both subscription writers read the complete configured voice using native instruction-file options and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and blocked from publication until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](editor-desk.md) for the complete editor flow.

## 0.6.52 operator notes

0.6.52 keeps model effort as a run setting, not an environment-wide guess: Codex and Claude present only their supported values. Exact selection records the first runtime; technical unavailability may advance to a ready runtime with the switch retained in job history, while a content refusal is final.

In **Server → Daily scan**, the owner sets the local time, named runtime, supported effort, selected accepted sources, and a source cap from 1 through 12. The scheduler files leads only. A Gemini/OpenAI-compatible connection requires its encrypted key and a model ID; the Gemini form supplies its normal default. Automatic is resolved to one named runtime before the job is queued, and the run record says which one ran.

The Windows lifecycle repair prevents shutdown from terminating protected system descendants by validating process identities and killing only through a verified handle. It cannot safely clean provider/browser descendants after the root process has already crashed; use the remaining process record and warning as an investigation signal, not proof of a clean stop. A fresh Windows packaged-install result is not recorded by this release guide.
