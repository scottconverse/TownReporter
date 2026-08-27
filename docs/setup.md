# TownReporter — operator setup

**Current release: [0.4.0](https://github.com/scottconverse/TownReporter/releases/tag/v0.4.0).** Editors who only write and publish should start at [editor.md](editor.md). The short clone-and-run is in the [README](../README.md).

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

Edit `.env`. The minimum that produces a working desk:

```
XAI_API_KEY=xai-...
```

Then:

```bash
npm run dev
```

Open `http://localhost:8080/login`. Create an editor account (email + password). That account is stored in **your** database. With no `NEWSROOM_SETUP_TOKEN`, the first account becomes the newsroom **owner**. On a public host, set `NEWSROOM_SETUP_TOKEN` and paste it on Create the desk — signup alone does not own the desk.

- Paper: `http://localhost:8080/`
- Desk: `http://localhost:8080/desk`

`.env` is gitignored. Never commit it. `.env.example` is safe to commit.

---

## Environment

All of these are documented in [`.env.example`](../.env.example).

### Model — Grok default

```
XAI_API_KEY=xai-...
# XAI_MODEL=grok-4.5
# XAI_BASE_URL=https://api.x.ai/v1
```

`GROK_API_KEY` is accepted as an alias for `XAI_API_KEY`.

### Other models — three vars, no extra package

TownReporter POSTs to `{LLM_BASE_URL}/chat/completions` with `Authorization: Bearer {LLM_API_KEY}`. If `LLM_BASE_URL` or `LLM_API_KEY` is set, that **wins over Grok**.

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

Resolution lives in `src/lib/news/ai.ts` (`resolveLlm()`).

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

The first signed-in user is inserted into `newsroom_members` as `owner`. Everyone else is 403 until they have a row.

There is no invite UI yet. To add an editor after they have created an account (so you know their `user_id`):

```sql
insert into newsroom_members (user_id, role)
values ('the-better-auth-user-id', 'editor');
```

Or share the owner login. Do not turn auth off to “fix” this.

### Cron (source monitors)

Background monitors tick in dev on an interval, and on demand:

```
GET /api/cron/monitors
```

If `CRON_SECRET` is set, send `Authorization: Bearer <CRON_SECRET>`. Point an external cron (or Vercel Cron) at that URL so missing packets and late minutes still get noticed when nobody has the desk open.

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

`build` runs Vite, patches SSR exports, then migrates the database.

Hosted: any Node 22 host with the env vars above. Vercel works for the paper + desk **if** you set:

- `DATABASE_URL` (Postgres; PGLite will not survive)
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` = the public `https://…` origin
- `XAI_API_KEY` or the `LLM_*` trio

Do not expect meeting-transcript Playwright to work on Vercel without extra infrastructure. See above.

Scan, Draft, and Dark Keep digging persist a job and return. A worker in **this same Node process** drains the queue. That works on a long-running host. A Vercel serverless invocation may freeze after the click returns, so those jobs may not finish there. The paper and a typed draft still deploy; the in-process drain is not a substitute for a worker.

---

## Tests

```bash
npm test
npm run test:lifecycle   # needs the app on :8080 and Playwright Chromium
```

Node’s built-in test runner. No network, no model calls. Coverage includes PrimeGov catalog matching, YouTube meeting join (including the June-vs-August museum false join), retrieval skipping hold-music transcript heads, draft notebook stripping, Mountain Time masthead dates, printed-headline collapse, workbench draft-landing, auth gates, the Dark Desk loop, and durable jobs. CI also runs one Playwright lifecycle: create the desk, file a lead, publish, post a correction.

---

## Point it at another city

There is no settings screen for this. That is deliberate in 0.3.x — the Longmont edition is the working proof, and a half-built city picker would lie. Edit the seed, rebuild.

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
├── src/lib/news/ai.ts         # Grok default + gateway
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
- **Second Google account on a self-host box** → 403. First user is owner. See [A second editor](#a-second-editor).
- **`VITE_AUTH_ENABLED=false` on the public internet** → the desk is open. Don’t.
- **Captions in a published story as if they were minutes** → that’s on the editor. The software will not save you. See [editor.md](editor.md#meetings-and-tapes).
