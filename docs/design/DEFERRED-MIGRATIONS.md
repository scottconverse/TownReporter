# Deferred migrations

A migration that removes something the PREVIOUS release still reads must not ship in the same rollout as the build that stops reading it. `npm run build` runs the migrations before the new build starts, and a failed promote puts the previous build back; the previous build then meets a database that is already one step ahead.

Rule (owner, 2026-10-01): **no migration in a rollout may drop, rename, retype or delete anything the live release's schema had.** `scripts/no-destructive-migrate.test.mjs` enforces it for every migration after the live release's last one (0108 for the batch 4 release).

## Waiting to ship (in the release AFTER the Grok-removal rollout)

| Drop | Why it waits | Ship when |
|---|---|---|
| `drop table if exists xai_oauth_connections;` | The batch 4 build reads it with no catch (`provider-availability.server.ts` -> model picker). Migration `0112` is a comment-only no-op so the table stays through the rollout. | The rollout that carries the Grok removal is live and the owner no longer wants the ability to roll back to batch 4. Then add it as the next free migration number, and move the live release marker in the test (`LIVE_RELEASE_LAST_MIGRATION`) forward. |
