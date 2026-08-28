# TownReporter

> The public record is only the beginning.

**Current release: [0.5.0](https://github.com/scottconverse/TownReporter/releases/tag/v0.5.0)** — 28 August 2026. Changelog: [CHANGELOG.md](CHANGELOG.md).

A civic newsroom you run yourself. A public paper on the front, a signed-in editor desk behind it. The working edition watches Longmont, Colorado — meetings, packets, minutes, money, contracts, and the YouTube tapes. Nothing prints until a person publishes.

MIT licensed. Clone it. Point it at your city.

---

> **Read this first.** Drafts are AI-assisted. Models invent facts, misattribute quotes, and mangle names — especially from auto-captions. TownReporter does **not** fact-check for you. Captions are not minutes. Dark Desk never prints. You are solely responsible for everything that appears on the paper. This is not a substitute for professional journalism, not legal advice, and not the city.

---

TownReporter is two rooms:

| | What it is | Who sees it |
|---|---|---|
| **The paper** (`/`) | Stories a human published, with sources shown | Anyone |
| **The desk** (`/desk`) | Watch list, scan, queue, drafts, notes, Dark Desk | Signed-in editors |

There is no fully automated path to the masthead.

It is not the Longmont Times-Call, not the city, and not a replacement for either. It covers the packets most people never sit through, and it shows the exact documents it used.

---

## Manuals

| Audience | Document |
|---|---|
| Operators (clone, env, Postgres, models, city swap) | [docs/setup.md](docs/setup.md) |
| Editors (login, scan, draft, Dark Desk, publish) | [docs/editor.md](docs/editor.md) |
| Dark Desk UI contract | [docs/dark-desk-editor.md](docs/dark-desk-editor.md) |
| Marketing / GitHub Pages landing | [docs/index.html](docs/index.html) · [live page](https://scottconverse.github.io/TownReporter/) |

GitHub Pages is that landing, not the newsroom. Enable it once: repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The token that pushes this repo cannot flip that switch.

---

## Run it (about five minutes)

You need **Node 22+**. You do **not** need an AI key if [Claude Code](https://code.claude.com) is installed and signed in — the desk uses that login. Otherwise see [Model](#model--your-claude-code-login-by-default) below.

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium   # meeting transcripts + JS civic sites
cp .env.example .env              # no AI key needed if Claude Code is signed in
npm run dev                       # http://localhost:8080
```

Open [http://localhost:8080/login](http://localhost:8080/login) and **create an editor account** (email + password). With no `NEWSROOM_SETUP_TOKEN`, the first account becomes the newsroom owner. On a public host, set that token — signup alone does not own the desk. The account lives in your database.

The public paper is `/`. The desk is `/desk`.

Full operator notes — Postgres, Vercel, other models, pointing it at another city — are in [docs/setup.md](docs/setup.md). How to run the desk is in [docs/editor.md](docs/editor.md).

---

## How it works

Same six moves the paper itself describes at `/how-we-report`:

1. **Watch.** A list of civic sources: city site, council, planning, PrimeGov, NextLight, St. Vrain Valley Schools, Boulder County, the city YouTube channel, Longmont Public Media. That list is a starting point, not a fence.
2. **Detect.** A scan fetches those pages, hashes them against the last snapshot, and flags what changed, what disappeared, and what failed to appear when it usually does.
3. **Follow.** Before a story is drafted, the desk asks what the announcing source leaves unexplained, then follows attachments, names, contracts, parcels, prior meetings.
4. **Preserve.** Significant captures are stored. If a record later vanishes, the captured version remains, and the article says so.
5. **Investigate.** Dark Desk is the recursive lane: competing hypotheses, unresolved identities, trails that were exhausted until new evidence reopened them. **It does not print.**
6. **Write, then gate.** Drafts are reported stories, not recaps. Hold, kill, or publish is a person. Every material claim should be checkable against a document we show.

Corrections are public (`/corrections`). We would rather look careful than look first.

### This release (0.5.0)

- **Self-hosted.** Builds to a plain Node server instead of Vercel. A long-lived process means the Chromium page reader works and background jobs are not chopped into pieces. `NITRO_PRESET=vercel` still builds for Vercel.
- **Runs on your Claude Code login.** No API key. The desk shells out to the local CLI, with the coding harness stripped — including your own `CLAUDE.md` and skills, which have no business in a news prompt. An API key or a local OpenAI-compatible gateway still win if set.
- **Jobs no longer run twice.** Nothing refreshed the liveness stamp mid-run, so any job past the two-minute stale line was re-claimed and run alongside the original — duplicate drafts, double spend.
- **SSRF is closed at connect time.** The old guard resolved DNS and then let the request resolve again. The address approved is now the address connected to.
- **The queue puts the best lead first.** Ordering on the timestamp alone buried a 14-point story under an 8-point one.
- **One click drafts.** A stale failure used to cancel the new draft the instant it started.
- **The feed works in a reader.** Absolute links, escaped titles. A `]]>` in a headline used to break the whole feed.
- **Runs on Windows at all.** `npm run dev` and `npm run build` both failed, every route 500'd on a self-hosted build, and 170 tests had never run.

Full detail, including the newsletter and rate-limiter fixes, is in [CHANGELOG.md](CHANGELOG.md). Setup for your own machine: [SELF-HOSTING.md](SELF-HOSTING.md).

### Earlier (0.4.x)

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

There is no city-picker UI. Edit the seed and rebuild.

1. [`src/lib/paper.ts`](src/lib/paper.ts) — `PAPER` (name, city, state, location, **timezone**, kicker, deck) and `SEED_SOURCES` (your city site, council, agenda portal, school district, PEG channel).
2. [`src/lib/news/youtube.ts`](src/lib/news/youtube.ts) — `LONGMONT_YOUTUBE_CHANNELS` if you have a city channel and a public-media sister.
3. If the city uses PrimeGov, add `https://{city}.primegov.com/public/portal` as an official source. The ingest already speaks that API.

Details and the honest limits of a city swap are in [docs/setup.md](docs/setup.md#point-it-at-another-city).

---

## Model — your Claude Code login, by default

**Nothing to set.** If the [Claude Code](https://code.claude.com) CLI is installed and signed in, Scan, Draft and Dark Desk use it. Your subscription does the work; there is no key to buy or paste.

Your own `CLAUDE.md`, skills and plugins are **not** loaded into news prompts — the harness is stripped on every call.

First match wins:

| Set this | What runs |
|---|---|
| `LLM_BASE_URL` (or `LLM_API_KEY` + `LLM_MODEL`) | any OpenAI-compatible endpoint, including a local model |
| `ANTHROPIC_API_KEY` | Claude, billed to that key |
| *nothing* | **Claude, through your Claude Code login** |
| `XAI_API_KEY` | Grok |

The CLI is slower than an API — it reloads a fixed preamble per call, so a draft takes minutes rather than seconds. Time budgets adjust on their own.

### Other models — one OpenAI-compatible URL

TownReporter talks `/v1/chat/completions`. Any of these work by changing three env vars. **No extra npm package.**

| Gateway | Example `LLM_BASE_URL` |
|---|---|
| [LiteLLM](https://github.com/BerriAI/litellm) | `http://127.0.0.1:4000/v1` |
| [Bifrost](https://github.com/maximhq/bifrost) | `http://127.0.0.1:4000/v1` (do **not** bind Bifrost to 8080 — that’s TownReporter) |
| [Helicone](https://github.com/Helicone/helicone) | `https://oai.helicone.ai/v1` or your self-hosted worker |
| [MLflow AI Gateway](https://mlflow.org/docs/latest/llms/deployments/index.html) | `http://127.0.0.1:5000/v1` |
| [Kong AI Gateway](https://docs.konghq.com/gateway/latest/ai-gateway/) | `http://127.0.0.1:8000/v1` |
| Ollama | `http://127.0.0.1:11434/v1` |
| OpenAI / OpenRouter | their `/v1` |

```
LLM_BASE_URL=http://127.0.0.1:4000/v1
LLM_API_KEY=sk-...
LLM_MODEL=claude-sonnet-4-5
```

If `LLM_BASE_URL` or `LLM_API_KEY` is set, that wins over Grok.

---

## Database

Unset `DATABASE_URL` → embedded PGLite. **Data dies when the process stops.** Fine for a look; not a newsroom.

Postgres (Neon, RDS, your box):

```
DATABASE_URL=postgres://user:pass@host:5432/townreporter
```

---

## Sign-in

- **Self-host:** first visit, **Create editor** on the paper (top right). After that the button is gone. **Leave as editor** on the desk hands the newsroom back. Set `NEWSROOM_SETUP_TOKEN` on a public host.
- **This grok.me preview:** Google / X via Grok’s broker (those buttons only show on `*.grok.me`).
- Local with no login at all: `VITE_AUTH_ENABLED=false`. Do not do that on a public host.

---

## Playwright

`npx playwright install chromium` once. Without it, city YouTube **Show transcript** and JS-heavy civic sites (Municode, and PrimeGov if the API moves) will not render. PrimeGov packets still work — they are a JSON API + PDFs.

---

## Layout

| Path | What |
|---|---|
| `/` | Public paper |
| `/about` · `/how-we-report` · `/corrections` | Masthead pages |
| `/desk` | Editor home (sign-in) |
| `/desk/sources` | Watch list + bulk paste |
| `/desk/scan` | Fetch + leads. The expensive button. Not a loop. |
| `/desk/queue` | Draft / hold / publish |
| `/desk/story/:id` | Workbench: draft, reporting notes, research memo, publish |
| `/desk/published` | Live stories + public corrections |
| `/desk/dark` | Dark Desk. Investigates. Never prints. |
| `/feed` | RSS |
| `/login` | Create account / sign in |

---

## Frequently asked questions

**Is this a newspaper?**
It is a newsroom you run. Stories that print have a human gate. It is not a newspaper of record, not the city, and not a wire service. Treat every draft as a first draft you still have to report.

**Will it publish by itself?**
No. Scan files leads. Draft writes a story into the workbench. Publish is a person.

**Can I use this for any city?**
Yes, by editing `paper.ts` (and the YouTube channel list). There is no config UI yet. See [docs/setup.md](docs/setup.md#point-it-at-another-city).

**Do I have to pay for an AI key?**
No. If Claude Code is signed in on the machine, the desk uses that login and there is no key at all. Set `ANTHROPIC_API_KEY` if you would rather bill a key, or point `LLM_BASE_URL` at any OpenAI-compatible endpoint — Ollama and other local models count, and cost nothing per word. `XAI_API_KEY` still runs Grok.

**Are YouTube captions the official record?**
No. Captions are a map of the tape. Minutes and the packet are the official record. Names in captions are often wrong. Dark Desk is told this; drafts still need a human check.

**What’s Dark Desk?**
The investigative lane. An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Remaining pages stay on the file. It has no publish button. Editor UI: [docs/dark-desk-editor.md](docs/dark-desk-editor.md) and [docs/editor.md](docs/editor.md#dark-desk).

**Can two people edit?**
The first signed-in user is owner. Later accounts get 403 unless you add them to `newsroom_members`. There is no “invite editor” screen yet. See [docs/setup.md](docs/setup.md#a-second-editor).

**What does a run cost?**
Scan, draft, and Dark Desk each call the model. A Longmont-sized scan is the expensive click; drafting one story is cheaper; a Dark Desk round is five short passes. Set a spending limit on the provider. Exact dollars depend on the model you point at.

**Does GitHub Pages run the newsroom?**
No. [docs/index.html](docs/index.html) is a static landing page. The app is Node. Clone it, or deploy to a host that can run Node 22, Playwright Chromium, and Postgres.

---

## Tests

```bash
npm test
```

No network, no token spend. Meeting ingest, retrieval, draft stripping, Mountain Time dates, printed-headline collapse, version lock, auth, and Dark Desk loop coverage live in `src/lib/news/*.test.ts`.

---

## License

[MIT](LICENSE). Copyright (c) 2026 Scott Converse.

Created by **Scott Converse**. Companion civic tools: [civic-transparency-toolkit](https://github.com/scottconverse/civic-transparency-toolkit), [civic-newsroom](https://github.com/scottconverse/civic-newsroom).
