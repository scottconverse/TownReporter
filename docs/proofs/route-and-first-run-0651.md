# Isolated route and first-run proof

**Source under test:** integration branch `fix/finish-townreporter-20260916`, built app from base `c43273702d159b63a405b0053679d22b6b236149`. The two later commits on this branch are an operational PowerShell repair and documentation-only Windows setup guidance, so this runtime evidence applies to the same application source.

**Isolation:** each server used an empty `DATABASE_URL` (in-memory PGLite), a spare loopback port, and a test-only auth secret. No production database, production process, provider credential, local model, or production deployment was used. `TOWNREPORTER_LOCAL=0`, `TOWNREPORTER_LOCAL_DISCOVERY=0`, and `TOWNREPORTER_CLAUDE_CODE=0` were set for the desk-flow run; the fake Codex CLI at `scripts/fakes/fake-codex-cli.mjs` was used instead of a real provider.

## Public and unauthenticated route smoke

Command:

```powershell
$env:SMOKE_BASE_URL='http://127.0.0.1:3460'
node scripts/smoke-built-server.mjs
```

Result: all smoke checks passed.

- `/`, `/about`, `/how-we-report`, `/corrections`, `/feed`, `/sitemap.xml`, `/robots.txt`, and `/login` returned 200.
- A nonexistent article returned 404.
- `/` rendered the masthead.
- `/login` moved past its loading state and rendered four form fields.
- `/desk` did not render the desk to an unauthenticated visitor.
- The browser reported no console errors.
- The public front page made no outside requests.

## Isolated desk-flow walk

Command:

```powershell
$env:DESK_FLOWS_BASE_URL='http://127.0.0.1:3461'
node scripts/desk-flows-e2e.mjs
```

Result: `{ "ok": true, "steps": 23 }`.

The walk created its own owner on a fresh in-memory database and verified:

- First account owns the desk with no setup token.
- First-run paper setup saves and lands on `/desk`.
- Opinion desk renders; its shared model picker exposes Automatic, all named Codex/Claude models, Grok, and Local model.
- Missing Opinion dependency is stated before submission.
- Write a story renders, files a saved lead, and lands on `/desk/story/:id`.
- A lead can be filed by hand and appears in Queue.
- Story and Queue pickers expose the shared model choices; explicit Queue selection persists.
- Queue row actions are visible.
- Delete, Undo, Recently deleted, Restore, and return to Queue work.
- Server page renders.
- Dark Desk renders; “How hard to dig” dials open and describe Dig and Nerve in plain words.
- No console errors occurred across the walked screens.

## Correction-email helper

Command:

```powershell
$env:DATABASE_URL=''
node --experimental-strip-types --test src/lib/reader.test.ts
```

Result:

- tests 2
- pass 2
- fail 0
- duration_ms 94.5655

The test verifies that the correction helper preserves multiline details and URL punctuation without adding unintended mail headers. The UI prepares a `mailto:` message to `townreporter@gmail.com` for TownReporter and explicitly says the page has not sent it; the reader must review and send it in their email application. No real email account or delivery path was available for this run, so actual delivery was not proven.

## Limits

- This is not a fresh Windows installer or clean-machine human acceptance result.
- The desk-flow browser used an in-memory database and a fake Codex CLI; it did not prove a real provider response.
- The correction-path check proves the prepared `mailto:` behavior and copy, not delivery from a real email client.
- No production promotion, merge, tag, release, or deployment was performed.
