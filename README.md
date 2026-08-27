# TownReporter

> The public record is only the beginning.

**Current release: [0.3.6](https://github.com/scottconverse/TownReporter/releases/tag/v0.3.6)** — 26 August 2026. Changelog: [CHANGELOG.md](CHANGELOG.md).

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

You need **Node 22+** and an [xAI API key](https://console.x.ai) (or any OpenAI-compatible gateway — see below).

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium   # meeting transcripts + JS civic sites
cp .env.example .env              # then add at least XAI_API_KEY
npm run dev                       # http://localhost:8080
```

Open [http://localhost:8080/login](http://localhost:8080/login) and **create an editor account** (email + password). The first account becomes the newsroom owner. That account lives in your database, not Grok’s.

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

### This release (0.3.6)

- **Primary documents first.** Draft with AI searches for the named company’s or agency’s own press release before it rewrites another paper. The Ursa Major plant story should open their `/media/press-release/` page, not stop at the Longmont Leader homepage.
- **Pull a still-to-pull line.** It searches, opens what it finds, and drops the excerpt into a box under the story that does not print. Redraft reads that box.
- **Claims with URLs.** Load-bearing numbers, names, dates, and quotes are listed in notes with the document they came from.

Also in 0.3.3–0.3.5: Mountain Time masthead, overlapping printed headlines collapse, Draft with AI paints without a reload, credit the originating newsroom with a story URL.

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

## Model — Grok by default

```
XAI_API_KEY=xai-...          # https://console.x.ai
```

Scan, Draft, and Dark Desk use Grok unless you set a gateway.

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

- **Self-host:** email + password on `/login`. First account is owner. A second identity is **not** auto-granted editor.
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

**Do I have to use Grok?**
No. Grok is the default because one `XAI_API_KEY` is the shortest path. Any OpenAI-compatible `/v1/chat/completions` gateway works. Ollama counts.

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
