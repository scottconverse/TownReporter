# TownReporter — Longmont edition

A civic newsroom and investigative record for Longmont: public paper + signed-in editor desk. The public record is only the beginning. TownReporter follows meetings, money, contracts and public records, then keeps digging when something changes, disappears or doesn’t add up. Nothing prints until an editor publishes. Dark Desk is the recursive investigative lane, never copy.

Built in Grok Build. The live preview database is in-memory; **Publish** (or your own Postgres) is what lasts.

## Run

```bash
npm install
npm run dev
```

Needs:

- `XAI_API_KEY` — Scan / Draft / Dark Desk
- `DATABASE_URL` — Postgres in production (Neon or other). Without it, local PGLite is used and **dies on process restart**.
- Auth is wired to Grok’s sign-in broker (`*.grok.me`). On your own host you will need to replace that with your own auth.

## Layout

- `/` — public paper
- `/desk` — editor (sign-in)
- `/desk/sources` — watch list + bulk paste
- `/desk/scan` — fetch + leads
- `/desk/queue` — draft / hold / publish
- `/desk/dark` — Dark Desk (not publishable)
- `/feed` — RSS

MIT if you ship it that way; this copy is yours.
