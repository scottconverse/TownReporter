// @ts-check
/**
 * Reading a PostgreSQL connection string the way `pg` reads it.
 *
 * WHY THIS IS ITS OWN FILE. Two very different callers have to agree, exactly,
 * about which server a connection string will end up dialling:
 *
 *   - ops\lib-promote-db.mjs, which refuses to touch the live paper's Postgres
 *     (port 5433) unless the call is the promotion itself;
 *   - scripts\postgres-integration-opt-in.mjs, the gate in front of the
 *     real-Postgres test lane, which drops `townreporter_*` scratch databases
 *     and must never do that on 5433.
 *
 * A second implementation of "which port is this, really" is how one of the
 * two ends up disagreeing with the other, and the disagreement would be
 * discovered by a test dropping a database on the live paper. So there is one,
 * here, and it is deliberately dependency-free: the test lane's guard loads it
 * through `--import` before anything else runs, and should not be pulling a
 * database driver in to work out a port number.
 *
 * WHAT "REALLY" MEANS, measured against pg's own ConnectionParameters
 * (node_modules\pg\lib\connection-parameters.js) on 2026-10-01:
 *
 *   1. `port` from the URL -- `postgres://h:5433/db`, and ALSO
 *      `postgres://h/db?port=5433`, because pg-connection-string folds the
 *      query option into the same field. Both dial 5433.
 *   2. otherwise `PGPORT` from the environment;
 *   3. otherwise 5432.
 *
 * The first version of the live-port guard read the URL text only, so
 * `?port=5433` and an inherited `PGPORT=5433` sailed straight past it. That is
 * the bug this file exists to not have.
 */

/**
 * The port the live paper's Postgres listens on, on the machine that runs it.
 *
 * 5433 rather than the usual 5432 because that box already had something on
 * 5432 when the paper was installed (see SELF-HOSTING.md). Which makes it the
 * one port number that means "this is the real paper's data".
 */
export const LIVE_POSTGRES_PORT = 5433;

/** PostgreSQL's own default, at the end of pg's fallback chain. */
export const DEFAULT_POSTGRES_PORT = 5432;

/**
 * The port a connection string declares in its authority, or null.
 *
 * For strings URL parsing cannot read. The authority is everything between
 * `://` and the first `/`, `?` or `#`, so a password that happens to contain
 * digits cannot be mistaken for a port -- the `:NNNN` has to be the last thing
 * before the path.
 *
 * @param {string} raw
 * @returns {number|null}
 */
export function portFromAuthority(raw) {
  const match = /:\/\/[^/?#]*?:(\d{1,5})(?:[/?#]|$)/.exec((raw ?? "").trim());
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isFinite(port) ? port : null;
}

/**
 * The parts of a connection string these callers care about.
 *
 * @param {string} raw
 * @returns {{ ok: true, protocol: string, hostname: string, port: number|null, authorityPort: number|null, queryPort: number|null, database: string, search: string, hash: string } | { ok: false, reason: string }}
 */
export function parseConnectionString(raw) {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "the connection string is empty" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "the connection string is not a URL" };
  }
  const declared = url.port ? Number(url.port) : null;
  const fromQuery = Number(url.searchParams.get("port") ?? "");
  const queryPort = Number.isFinite(fromQuery) && fromQuery > 0 ? fromQuery : null;
  return {
    ok: true,
    protocol: url.protocol,
    hostname: url.hostname,
    // pg-connection-string folds `?port=` into the same field as `:port`, and
    // the QUERY value WINS: `...:5432/db?port=5433` dials 5433 (measured on the
    // installed package by the production auditor, 2026-10-01). The first
    // version here had it the other way round and let that URL past the guard.
    port: queryPort ?? declared,
    // Both sources, for callers that must be safe whichever one a driver reads.
    authorityPort: declared,
    queryPort,
    database: url.pathname.replace(/^\//, ""),
    search: url.search,
    hash: url.hash,
  };
}

/**
 * The port this connection string will dial, as pg resolves it.
 *
 * @param {string} raw
 * @param {NodeJS.ProcessEnv} [env] where PGPORT is read from
 * @returns {number|null} null only when there is nothing to read at all
 */
export function effectivePort(raw, env = process.env) {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const parsed = parseConnectionString(value);
  if (parsed.ok && parsed.port !== null) return parsed.port;

  // pg only reaches the environment when the string itself says nothing about
  // a port, which is why this is a fallback and not a preference.
  const fromEnv = Number((env?.PGPORT ?? "").trim());
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  if (parsed.ok) return DEFAULT_POSTGRES_PORT;
  return portFromAuthority(value);
}

/**
 * Would pg dial the live paper's Postgres for this connection string?
 *
 * The host is deliberately not part of the answer. `localhost`, `127.0.0.1`
 * and `[::1]` all reach the same server on the machine that runs the paper,
 * and so does the machine's own name, so a rule that named one of them would
 * be a rule anybody could step around by typing a different one.
 *
 * @param {string} raw
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function targetsLivePostgres(raw, env = process.env) {
  // pg's precedence is query value, then authority, then PGPORT, then 5432. A
  // string is treated as live when ANY of the sources a driver might read says
  // 5433, so a different driver (or a different version of pg) cannot read a
  // different answer out of the same text and walk past this.
  const parsed = parseConnectionString(raw);
  if (parsed.ok && (parsed.authorityPort === LIVE_POSTGRES_PORT || parsed.queryPort === LIVE_POSTGRES_PORT)) return true;
  return effectivePort(raw, env) === LIVE_POSTGRES_PORT;
}
