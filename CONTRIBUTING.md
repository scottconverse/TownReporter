# Contributing to TownReporter

TownReporter is a human-edited civic newsroom. A change is ready only when it
preserves the human publish gate, source provenance, newsroom isolation and the
operator's data.

## Set up

For a persistent Windows newsroom, use the [installation package](docs/windows-install.md). The steps below are the development/source setup. Installer changes must also pass the fresh-package Windows lane; do not substitute an already-installed development directory for the release ZIP.

1. Install Node 22 or newer and clone the repository.
2. Run `npm install`.
3. Run `npx playwright install chromium`.
4. Copy `.env.example` to `.env`. Leave `DATABASE_URL` unset for a
   disposable local look; use a separate Postgres database for persistent
   development.
5. Run `npm run dev` and open `http://localhost:8080`.

A change to the desk is walked before it reaches the live paper: a development
server first, then a throwaway copy of real data with a full walk that ends in a
real Publish ([docs/staging.md](docs/staging.md)). Do not skip a tier.

Never point development or tests at a production database. Never commit
`.env`, credentials, model keys, browser captures or generated build output.

## Make and verify a change

- Add a failing test that demonstrates the behavior before changing production
  code.
- Keep reader-facing claims and operator documentation synchronized with the
  actual interface.
- Run `npm test`, `npm run typecheck`, `npm run typecheck:test` and `npm run lint`.
- If the interface changed, exercise the built screen in a browser at desktop
  and narrow widths.
- Check `git diff --check` and scan the staged diff for secrets before
  committing.
- If you change what a screen says or does, change the documentation in the same
  pull request: the README, the [manual](docs/manual.md), the guide for that
  screen and the [changelog](CHANGELOG.md). Three tests keep the documents
  honest: `scripts/docs-links.test.mjs` (every relative link and anchor
  resolves), `scripts/docs-routes.test.mjs` (every URL a document names is a
  route the app serves) and `scripts/versions-agree.test.mjs` (every surface
  that states the version states the same one).

The ordinary test suite is offline and never calls a paid model. Real Postgres,
browser-flow and live-model lanes are separate; GitHub Actions runs the
repository's required integration lanes on every push. The Postgres lanes are
described in [docs/postgres-integration-testing.md](docs/postgres-integration-testing.md).

Every test process replaces `fetch` with a default-deny seal
(`src/lib/test-support/model-seal.ts`), so a test that forgets to stub the
transport is refused rather than answered by whatever model server happens to
be running on your machine — 127.0.0.1 on 1234, 11434 or 8080, any non-loopback
host, and any cloud model API all throw with the URL and the reason. Stub
`fetch`, inject a fake provider, or start a fake server on an ephemeral
loopback port instead; `TOWNREPORTER_TEST_ALLOW_REAL_MODELS=1` makes one
deliberate live call and prints a warning to stderr, and CI never sets it.

`npm test` on your own machine runs the complete suite. CI runs that same
command on several machines at once, each with a shard index in its
environment, and the single `test` check is green only when every shard is. To
reproduce one shard exactly as CI ran it:

```bash
TOWNREPORTER_TEST_SHARD=3 TOWNREPORTER_TEST_SHARD_TOTAL=6 npm test
```

Both variables must be set together, and a shard is never a substitute for the
complete suite before you push. Adding a test file needs no bookkeeping: the
launcher discovers files by glob and hands each one to exactly one shard. If
you change how many machines the suite runs on, change the shard count in
`.github/workflows/ci.yml` in both places at once, which
`scripts/test-shards-cover-the-suite.test.mjs` requires.

## Pull requests

Explain the user-visible outcome, the failure the test reproduces, and the
verification you ran. Keep unrelated cleanup out of the same commit. Do not
include private civic material, unpublished reporting notes, credentials or
production logs.

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE).
