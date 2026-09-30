/**
 * Refuse to serve the desk on a half-migrated database (ENG-5, U18a-3).
 *
 * `migrations/*.sql` is the single schema authority, and until this file
 * existed nothing at runtime read `_migrations` back: a server started any way
 * other than `installer/Start.ps1` or `ops/start-townreporter.ps1` (both of
 * which migrate before starting) served whatever schema the database happened
 * to have. Every page rendered, and the failure surfaced later as a
 * column-not-found error on an editor's save -- in the log, if anywhere, miles
 * from the cause. The migration ledger is the fact that was sitting right
 * there unread.
 *
 * Numbered `00-` so Nitro's alphabetical middleware scan runs it before
 * `00-schema-warmup.ts` (the ledger is checked before any warm-up DDL), and
 * before `app-chrome.ts`, `canonical-host.ts` and `security-headers.ts`. The
 * check itself is started by `server/plugins/schema-warmup.ts` at app
 * creation; this awaits the SAME shared promise, so the normal case costs one
 * resolved-promise await per request, not a query.
 *
 * A failure is a 503 for every request plus the guard's own one-line
 * `console.error` (which names the missing files and the command to apply
 * them) -- loud, specific, and impossible to miss in a promote log. It does
 * NOT exit the process: the appliers already refuse to start on a failed
 * migration, and a server that answers 503 with the reason is far easier to
 * diagnose from outside than one that vanished. The promise forgets its
 * failure (see `getMigrationGuardPromise`), so a database that was briefly
 * unreachable at boot starts serving as soon as it is reachable again.
 *
 * The PGlite/self-hosted-without-a-database case never trips this: `getSql()`
 * applies `migrations/*.sql` before the first query, so the ledger is current
 * by the time it is read.
 */
import { getMigrationGuardPromise } from "../../src/lib/migration-status.ts";

export default async function schemaCurrentGate(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  try {
    await getMigrationGuardPromise();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return next();
}
