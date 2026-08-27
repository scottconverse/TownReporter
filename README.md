# TownReporter — Longmont edition

A civic newsroom and investigative record for Longmont: public paper + signed-in editor desk. The public record is only the beginning. TownReporter follows meetings, money, contracts and public records, then keeps digging when something changes, disappears or doesn’t add up. Nothing prints until an editor publishes. Dark Desk is the recursive investigative lane, never copy.

MIT licensed. Run it on your machine, or point it at your city.

## Run it yourself

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium   # meeting transcripts + JS civic sites (Municode, PrimeGov fallback)
cp .env.example .env              # then add at least XAI_API_KEY
npm run dev                       # http://localhost:8080
```

Open [http://localhost:8080/login](http://localhost:8080/login) and **create an editor account** (email + password). That account lives in your database, not Grok’s.

### Model — Grok by default

```
XAI_API_KEY=xai-...          # https://console.x.ai
```

Scan, Draft, and Dark Desk use Grok unless you set a gateway.

### Other models — one OpenAI-compatible URL

TownReporter talks `/v1/chat/completions`. Any of these work by changing three env vars. No extra npm package.

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

### Database

Unset `DATABASE_URL` → embedded PGLite. **Data dies when the process stops.**

Postgres (Neon, RDS, your box):

```
DATABASE_URL=postgres://user:pass@host:5432/townreporter
```

### Sign-in

- **Self-host:** email + password on `/login`.
- **This grok.me preview:** Google / X via Grok’s broker (those buttons only show on `*.grok.me`).
- Local with no login at all: `VITE_AUTH_ENABLED=false`. Do not do that on a public host.

### Playwright

`npx playwright install chromium` once. Without it, city YouTube **Show transcript** and JS-heavy civic sites (Municode, and PrimeGov if the API moves) will not render. PrimeGov packets still work — they are a JSON API + PDFs.

## Layout

- `/` — public paper
- `/desk` — editor (sign-in)
- `/desk/sources` — watch list + bulk paste
- `/desk/scan` — fetch + leads
- `/desk/queue` — draft / hold / publish
- `/desk/dark` — Dark Desk (not publishable). Editor UI brief: [`docs/dark-desk-editor.md`](docs/dark-desk-editor.md).
- `/feed` — RSS
- `/get-the-code` — download a zip of this tree

## License

[MIT](LICENSE).
