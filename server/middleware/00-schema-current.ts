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
 * THE BODY NAMES NO INTERNALS (batch-6 pre-merge audit, item 12). This used to
 * return `error.message` to whoever asked. The guard's own `console.error`
 * already carries the detail to the log, and the messages that reach here are
 * not all migration sentences: a connection failure reads
 * `connect ECONNREFUSED 127.0.0.1:55432` -- the database's host, port and
 * user, printed by an unauthenticated route to any passer-by -- and a
 * driver error can carry a table name or a fragment of SQL. The operator gets
 * the same detail from the log this file already writes; the caller gets a
 * sentence that says what is wrong and that somebody has been told. `no-store`
 * because a 503 that says "needs an update" must not be cached into a browser
 * that will then keep showing it after the update has run.
 *
 * The PGlite/self-hosted-without-a-database case never trips this: `getSql()`
 * applies `migrations/*.sql` before the first query, so the ledger is current
 * by the time it is read.
 */
import { getMigrationGuardPromise } from "../../src/lib/migration-status.ts";

/** The one sentence a refused request is answered with. Fixed, at all times. */
export const SCHEMA_UNAVAILABLE_BODY =
  "Service unavailable: the paper's database needs an update. The operator has been told what to run.";

export default async function schemaCurrentGate(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  try {
    await getMigrationGuardPromise();
  } catch (error) {
    /*
      The detail is already in the guard's `console.error` -- this is the second
      copy, for whoever is watching the process rather than the response.
    */
    console.error(
      "[schema-current] refusing to serve:",
      error instanceof Error ? error.message : String(error),
    );
    return new Response(SCHEMA_UNAVAILABLE_BODY, {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return next();
}
