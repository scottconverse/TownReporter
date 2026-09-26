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

Never point development or tests at a production database. Never commit
`.env`, credentials, model keys, browser captures or generated build output.

## Make and verify a change

- Add a failing test that demonstrates the behavior before changing production
  code.
- Keep reader-facing claims and operator documentation synchronized with the
  actual interface.
- Run `npm test`, `npm run typecheck` and `npm run lint`.
- If the interface changed, exercise the built screen in a browser at desktop
  and narrow widths.
- Check `git diff --check` and scan the staged diff for secrets before
  committing.

The ordinary test suite is offline and never calls a paid model. Real Postgres,
browser-flow and live-model lanes are separate; GitHub Actions runs the
repository's required integration lanes on every push.

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
