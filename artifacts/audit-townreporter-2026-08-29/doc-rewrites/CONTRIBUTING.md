<!--
AUDIT DRAFT — 2026-08-29, Technical Writer. New file (finding DOC-005).
CONFIRM BEFORE SHIPPING:
  * Whether the project actually wants outside PRs, and of what kind. The
    "What this project takes" section is the auditor's reading of a
    single-maintainer working newspaper; the maintainer should set that policy.
  * Whether AGENTS.md / .grok/ stay at the repo root (finding DOC-006). The
    "The files at the root" section below describes them as they are today and
    will need one line changed if they move.
Everything else is drawn from package.json, .github/workflows/ci.yml, the test
suite, and a measured `npm test` run.
-->

# Contributing to TownReporter

TownReporter is a civic newsroom that a person runs and a person publishes
from. It is maintained by one person and it prints a real paper, so the bar for
a change is "would this still be right at 11pm on deadline", not "does it
compile".

## What this project takes

Good first contributions, in rough order of usefulness:

- **A civic-portal adapter.** PrimeGov, Legistar, Granicus, CivicClerk,
  BoardDocs, Municode and CivicPlus are already recognised. Your city's portal
  probably is not.
- **A bug with a failing test.** The test is the contribution; the fix is the
  easy half.
- **Documentation that is wrong.** This repository has been bitten by doc drift
  more than once; a correction with the evidence attached is welcome.
- **Accessibility and small UI fixes on the desk.** It is used by journalists,
  not developers.

Please open an issue before a large change. A refactor that lands on a working
newspaper has to be worth the risk to the person running it.

Security issues do **not** go in an issue or a PR — see
[SECURITY.md](SECURITY.md).

## Getting a dev environment

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium
cp .env.example .env
npm run dev            # http://localhost:8080
```

Node 22 or newer. You do **not** need a model key: with the
[Claude Code](https://code.claude.com) CLI installed and signed in, the desk
uses that login, and with no provider at all the desk says so and spends
nothing — which is a perfectly good state to develop most things in.

Unset `DATABASE_URL` and you get embedded PGLite, which is fine for local work
and loses everything when the process stops. Some tests need a real Postgres;
see below.

Full operator detail: [docs/setup.md](docs/setup.md). How the product is meant
to be used: [docs/editor.md](docs/editor.md). How it is built, with diagrams:
[docs/manual.md](docs/manual.md) Parts 4 and 5.

## The loop

```bash
npm test          # deterministic, offline, free — about 17 seconds
npm run typecheck # tsc --noEmit
npm run format    # prettier
```

`npm test` runs Node's built-in test runner over `scripts/**/*.test.mjs` and
`src/**/*.test.ts`. Discovery is a glob on purpose — do not replace it with a
list of files; a test file that is on disk but not in a list is a test that
quietly never runs, which has happened here.

## What CI runs, and what each job needs

A green `npm test` is not a green pipeline. `.github/workflows/ci.yml` has five
jobs:

| Job | What it does | What it needs that you may not have locally |
|---|---|---|
| `test` | `npm run typecheck` then `npm test` | nothing |
| `lifecycle` | Creates the desk, files a lead, publishes, posts a correction against `npm run dev`; then the 0.5.1 desk flows (Opinion, delete, Undo, trash and restore, the Server page, the dials) | Playwright Chromium |
| `smoke-built` | `npm run build`, boots `.output/server/index.mjs` on port 3000 with no provider, and opens it in a browser | Playwright Chromium |
| `smoke-dev` | Runs the README's own quick start verbatim and opens the result in a browser | Playwright Chromium |
| `search-index` | Runs the real migrations against Postgres 18 and re-runs the 20,000-story benchmark, failing if the index does not help | a real Postgres |

Two of those exist because of specific past failures worth knowing about. Both
smoke jobs exist because CI once ran typecheck, units and a dev-mode lifecycle
test, never built the app, never booted `.output`, and never opened a page — so
`node:crypto` reached the client bundle and killed the documented onboarding
path while every request still answered 200. `search-index` exists because the
index assertions skip on PGLite, and a skipped test is honest but is not
coverage.

If you touch the build, the server entry, routing, or migrations, expect to
need Chromium and a Postgres before you can reproduce CI locally.

## Rules the test suite enforces

These are not style preferences. A PR that breaks one fails the build, and each
was written after the thing it prevents actually happened:

1. **No test in the default suite may reach a live model.** Gate it behind
   `RUN_LIVE_MODEL_TESTS=1`, or disable the provider inside the test with
   `TOWNREPORTER_CLAUDE_CODE=0`. A default suite must be deterministic, offline
   and free — see `scripts/newsroom-security.test.mjs`.
2. **The Dark Desk dials may never tighten.** A test fails if any notch of Dig
   or Nerve becomes more conservative than it is today. Curiosity is not a gate
   in this product, and that is a product position, not an oversight.
3. **The version is locked** across `package.json`, `src/lib/version.ts` and
   the paper's own masthead. Bump them together.
4. **Test discovery stays a glob**, not a hand-maintained list.
5. **Ingest follows documents across origins.** A story often lives one host
   away from the listing that led to it.

## Where things live

```
src/lib/paper.ts        # city, masthead, seed sources — the city-swap seam
src/lib/news/           # ingest, PrimeGov, YouTube, Dark Desk, draft, search
src/lib/news/ai.ts      # provider resolution and time budgets
src/lib/auth/           # email/password, and the optional preview OAuth
src/routes/             # the paper and the desk
migrations/             # numbered .sql, applied on build and on boot
scripts/                # build helpers, migrations, e2e, and .test.mjs suites
ops/                    # Windows scripts for the live deployment
docs/                   # manuals and the GitHub Pages landing
```

Tests sit next to the code they cover (`src/lib/news/*.test.ts`), with
repository-wide invariants in `scripts/*.test.mjs`.

## The files at the root

`AGENTS.md`, `AGENTS.project.md` and `.grok/` come from the build platform this
project was originally developed on. They are not part of TownReporter and you
can ignore them — with one exception: `scripts/with-app-env.mjs` reads
`.grok/app-env.json` for `VITE_`-prefixed build flags, and `npm run dev`,
`npm run build` and `npm run preview` all route through that wrapper. Do not
delete that file.

## Pull requests

- Branch from `main`.
- One concern per PR. A bug fix and a refactor in the same diff get reviewed as
  the refactor.
- Include the test. If the change cannot be tested, say why in the PR body —
  that is a real answer, and sometimes the right one.
- Run `npm test`, `npm run typecheck` and `npm run format` before pushing.
- If you changed behaviour a document describes, change the document in the
  same PR. Which document is usually `docs/setup.md` (operators),
  `docs/editor.md` (journalists), `docs/manual.md` (everyone) or
  `.env.example` (config) — and often more than one.
- Add a `CHANGELOG.md` entry in the house style: what changed, and what went
  wrong that made it necessary.

## Tone, in docs and in the product

The desk is used by journalists. Plain English, no engine vocabulary on screen
— `src/lib/news/desk-copy.ts` holds the editor-facing words, and "hop",
"frontier", "artifact", "heuristic" and raw stack traces are banned from the
UI. Documentation follows the same rule: say what a thing does and what it
costs, name the limitation rather than burying it, and never claim a capability
the code does not have.

## License

MIT. By contributing you agree your contribution ships under it.
