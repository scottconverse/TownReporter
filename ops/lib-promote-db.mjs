// @ts-check
/**
 * The database half of a promotion: the copy taken before a rollout, and the
 * swap that puts it back when the rollout fails.
 *
 * WHY THIS EXISTS. `npm run build` ends in `npm run db:migrate` (package.json),
 * so a promotion migrates the live database while the paper is stopped. When
 * the build dies half way through a migration, or the new app comes up against
 * a schema it cannot read, "put the old build back" is not enough: the old
 * build is then serving a database that has already moved on, and a page
 * reading a table or column a migration changed answers WRONGLY rather than
 * failing. The owner's answer, accepted by the production auditor: copy the
 * database before the rollout, and if the rollout fails, put that copy back.
 *
 * WHAT THE AUDITOR MEASURED (throwaway Postgres 18.6, nobody connected):
 * `CREATE DATABASE ... TEMPLATE` of a 545 MB database took 4.4 s, and the two
 * `ALTER DATABASE ... RENAME`s took 0.47 s together. The live database is about
 * 570 MB and the box carries roughly thirty old test databases beside it, so
 * expect more than 4.4 s on a busy server -- which is what the step's time
 * limit is for (Get-PromoteChildTimeoutSeconds, ops\lib-promote.ps1).
 *
 * THE HEAVY-IO WARNING, WHICH BELONGS IN PLAIN WORDS: `CREATE DATABASE ...
 * TEMPLATE` forces a checkpoint on the whole cluster. It is not a background
 * copy. On a shared server it makes every other database on the box wait, and
 * the ~4.4 s above was measured with nobody else connected.
 *
 * ONE RULE ABOUT WHICH DATABASES MAY BE TOUCHED. This machine's Postgres also
 * serves the development copy, the staging copy and thirty throwaway test
 * databases. A typo here would rename somebody else's database. So every name
 * this module will copy, create or rename -- the live one, the copy and the
 * failed one -- must start with `townreporter` and be a plain identifier. A
 * name that does not is refused with a sentence, before anything is done.
 *
 * NOTHING IS EVER DELETED. Not by this module and not by the promotion that
 * calls it. Copies and failed databases are kept, named in the log, and left
 * for the owner to remove by hand.
 *
 * This file takes an ADMIN connection string and names, and does the database
 * work only. The order of a promotion, the log, the stop-the-app window and
 * the decision to roll back all live in ops\promote.ps1 and
 * ops\lib-promote.ps1 -- the database facts belong here, where a test can run
 * them against a real Postgres, and the ordering belongs where a test can run
 * it against fakes.
 *
 * THE COMMAND LINE, which is how ops\promote.ps1 calls it:
 *
 *   node ops\lib-promote-db.mjs <command>
 *
 * with everything else in the environment, deliberately: an admin URL holds a
 * password, and a command line is written into the promotion's log.
 *
 *   PROMOTE_DB_ADMIN_URL    the connection used to create and rename (required)
 *   PROMOTE_DB_DATABASE_URL the app's own DATABASE_URL (required by preflight)
 *   PROMOTE_DB_DATABASE     the live database name
 *   PROMOTE_DB_COPY         the copy's name
 *   PROMOTE_DB_FAILED       the name the live database takes after a swap
 *   PROMOTE_DB_STAMP        yyyyMMddHHmmss, the run's stamp
 *   PROMOTE_DB_WAIT_SECONDS how long to wait for connections to clear (30)
 *   PROMOTE_DB_TIMEOUT_SECONDS  the server-side limit for the copy/swap (600)
 *   PROMOTE_DB_LIVE_PROMOTE "1" only from ops\promote.ps1 running for real
 *
 * THE LIVE-PORT GUARD, WHICH IS WHY THE LAST ONE EXISTS. Port 5433 is the live
 * paper's Postgres on the machine that runs it, and its connection string is
 * in the install's `.env` -- which is exactly what a test or a hand-typed
 * command on that machine inherits. So every command refuses a connection
 * string that points at 5433 unless PROMOTE_DB_LIVE_PROMOTE is "1", which only
 * the real promotion sets: not a test, and not a `-WhatIf` dry run, which
 * renames nothing. See checkLivePortGuard.
 *
 * stdout is exactly one JSON object on one line; everything a person reads is
 * left to the caller's log, which is where the promotion's record lives. Exit
 * codes: 0 = it happened, 3 = refused before touching anything, 1 = it broke.
 * A caller must read the JSON, not the exit code: 3 and 1 are both "no".
 */

import { statfsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

/**
 * Every database this module will copy, create or rename starts with this.
 *
 * It is the paper's own database, and nothing else on the box. See the header.
 */
export const TOWNREPORTER_DB_PREFIX = "townreporter";

/** PostgreSQL truncates identifiers at 63 bytes; a longer name is refused. */
const IDENTIFIER_MAX = 63;

/**
 * Letters, digits and underscore only.
 *
 * Names are quoted everywhere below, so this is not what makes them safe from
 * injection -- it is a second lock on the door that keeps "townreporter" from
 * being the first eight characters of something surprising, and it keeps a
 * percent-decoded URL from smuggling a quote into a name that gets logged.
 */
const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/** Suffix of the copy taken before a rollout. */
const COPY_SUFFIX = "_prerollout_";

/** Suffix of the database the live one becomes after a swap. */
const FAILED_SUFFIX = "_failed_";

const GIB = 1024 ** 3;

/**
 * The port the live paper's Postgres listens on, on the production machine.
 *
 * It is 5433 rather than the usual 5432 because that box already had something
 * on 5432 when the paper was installed (see SELF-HOSTING.md). Which makes it
 * the one port number that means "this is the real paper's data", and the one
 * this module must not be able to reach by accident -- see the guard below.
 */
export const LIVE_POSTGRES_PORT = 5433;

/**
 * The variable that says "this call really is the live promotion".
 *
 * Set by ops\promote.ps1, for the run that actually promotes, and by nothing
 * else. A test does not set it. `-WhatIf` does not set it, because a dry run
 * renames nothing.
 */
export const LIVE_PROMOTE_ENV = "PROMOTE_DB_LIVE_PROMOTE";

/**
 * `:5433` in the authority part of a connection string, for the strings URL
 * parsing cannot read.
 *
 * The authority is everything between `://` and the first `/`, `?` or `#`, so
 * this cannot match a password that happens to contain those digits -- the
 * `:5433` it looks for has to be the last thing before the path.
 */
const LIVE_PORT_IN_URL = /:\/\/[^/?#]*:5433(?:[/?#]|$)/;

/**
 * A refusal: something is wrong and NOTHING has been touched.
 *
 * Carried as its own class so the caller can tell "I refused, and here is the
 * sentence for the operator" from "it broke", which the promotion reports
 * differently.
 */
export class PromoteDbRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "PromoteDbRefusal";
  }
}

/**
 * The run's stamp: `yyyyMMddHHmmss`, local time.
 *
 * Local, not UTC, and matching the promotion's log file name
 * (logs\promote-<yyyyMMdd-HHmmss>.log) so an operator reading the log and
 * looking at the database list is looking at the same clock. The stamp is part
 * of a database name, so it is also what tells a later run that a copy belongs
 * to the promotion that is running now.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function formatStamp(date = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/**
 * The port a connection string dials, or null when it cannot be told.
 *
 * A URL with no port dials PostgreSQL's own default, 5432 -- and the live
 * machine is exactly the machine where that is NOT true, which is why the
 * guard below does not rely on this alone.
 *
 * @param {string} value
 * @returns {number|null}
 */
export function urlPort(value) {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.port) return Number(url.port);
    if (url.protocol === "postgres:" || url.protocol === "postgresql:") return 5432;
    return null;
  } catch {
    return null;
  }
}

/**
 * Would this call reach the live paper's Postgres? Returns a sentence when it
 * would, and "" when it would not.
 *
 * WHY THIS EXISTS. The live database's connection string is in the install's
 * `.env`, and `.env` is what every test and every hand-run command on that
 * machine inherits. The difference between `node ops\lib-promote-db.mjs copy`
 * and a promotion is four characters of a port number -- and one of those two
 * renames the newspaper's database. So the port itself is the guard: anything
 * that points at 5433 is refused unless the call says, explicitly, that it is
 * the live promotion.
 *
 * It applies to EVERY command, including the ones that only read. A rule with
 * "except the harmless ones" is a rule with a hole in it, and the harmless
 * list is exactly the thing that grows a destructive entry later.
 *
 * @param {Array<string|undefined>} urls every connection string this call would use
 * @param {boolean} [livePromote] the caller's "this really is the promotion"
 * @returns {string} "" when the call may proceed
 */
export function checkLivePortGuard(urls, livePromote) {
  if (livePromote) return "";
  for (const value of urls) {
    const raw = (value ?? "").trim();
    if (!raw) continue;
    if (urlPort(raw) !== LIVE_POSTGRES_PORT && !LIVE_PORT_IN_URL.test(raw)) continue;
    return (
      `Refusing to work on the PostgreSQL server on port ${LIVE_POSTGRES_PORT}. That is the live paper's ` +
      "database on the machine that runs it, and only ops\\promote.ps1 running for real may copy, rename or " +
      `swap databases there -- it sets ${LIVE_PROMOTE_ENV}=1 for that one call. A test, a -WhatIf dry run or a ` +
      "hand-typed command does not set it, which is what stops any of them reaching the paper's data by " +
      "accident. If this really is the promotion of the live paper, run ops\\promote.ps1; if it is not, point " +
      "this at a test server. Nothing was changed and the paper was not touched."
    );
  }
  return "";
}

/**
 * The database name out of a `DATABASE_URL`.
 *
 * Read the way `ops\promote.ps1` has always read it -- the last path segment --
 * but through URL parsing first, so a query string
 * (`?sslmode=require`) is not swallowed into the name.
 *
 * @param {string} databaseUrl
 * @returns {string} the name, or "" when the URL does not name one
 */
export function deriveDatabaseName(databaseUrl) {
  const raw = (databaseUrl ?? "").trim();
  if (!raw) return "";
  let path = "";
  try {
    path = new URL(raw).pathname;
  } catch {
    // Not a URL this runtime will parse. Fall back to the split promote.ps1
    // has always used rather than refusing a connection string that works.
    const cut = raw.lastIndexOf("/");
    path = cut >= 0 ? raw.slice(cut) : "";
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    name = last;
  }
  return name.trim();
}

/**
 * Is this a name this module may touch? Returns a sentence when it is not.
 *
 * Every refusal says what is wrong, what to do about it, and that nothing was
 * changed -- the operator reads it with the paper down and needs all three.
 *
 * @param {string} name
 * @param {string} [what] what this name is, for the sentence
 * @returns {string} "" when the name is fine, otherwise the refusal
 */
export function checkDatabaseName(name, what = "The database") {
  const value = (name ?? "").trim();
  if (!value) {
    return (
      `${what} name is empty, so there is nothing to copy. ` +
      "Set DATABASE_URL in the install's .env to the paper's database " +
      "(postgres://user:pass@host:5432/townreporter) and run this again. " +
      "Nothing was changed and the paper was not touched."
    );
  }
  if (!value.startsWith(TOWNREPORTER_DB_PREFIX)) {
    return (
      `${what} is "${value}", and this only ever copies or renames a database whose name ` +
      `starts with "${TOWNREPORTER_DB_PREFIX}", so that the paper's own database is the only ` +
      "one it can touch on this machine's shared Postgres. " +
      "Point DATABASE_URL at the paper's database and run this again. " +
      "Nothing was changed and the paper was not touched."
    );
  }
  if (!NAME_PATTERN.test(value)) {
    return (
      `${what} is "${value}", which is not a plain database name (letters, digits and ` +
      "underscore only). Rename it, or point DATABASE_URL at the plain name, and run this " +
      "again. Nothing was changed and the paper was not touched."
    );
  }
  if (value.length > IDENTIFIER_MAX) {
    return (
      `${what} is "${value}", which is ${value.length} characters and PostgreSQL stops at ` +
      `${IDENTIFIER_MAX}. Nothing was changed and the paper was not touched.`
    );
  }
  return "";
}

/**
 * The name of the copy taken before a rollout.
 * @param {string} database
 * @param {string} stamp
 * @returns {string}
 */
export function copyDatabaseName(database, stamp) {
  return `${database}${COPY_SUFFIX}${stamp}`;
}

/**
 * The name the live database takes when the copy is swapped back in.
 *
 * It keeps the failed schema rather than being dropped: it is the only copy of
 * whatever the half-finished migration did, and the owner decides when it goes.
 *
 * @param {string} database
 * @param {string} stamp
 * @returns {string}
 */
export function failedDatabaseName(database, stamp) {
  return `${database}${FAILED_SUFFIX}${stamp}`;
}

/**
 * The stamp inside a copy's name, or null when the name is not a copy's.
 * @param {string} name
 * @returns {string|null}
 */
export function parseCopyStamp(name) {
  const m = /_prerollout_(\d{14})$/.exec((name ?? "").trim());
  return m ? m[1] : null;
}

/**
 * Is `copy` a copy of `database` (and not of some other database)?
 * @param {string} copy
 * @param {string} database
 * @returns {boolean}
 */
export function isCopyOf(copy, database) {
  return Boolean(parseCopyStamp(copy)) && (copy ?? "").trim().startsWith(`${database}${COPY_SUFFIX}`);
}

/**
 * The room a copy needs beside the database itself: a quarter of its size or
 * two gigabytes, whichever is larger.
 *
 * @param {number} sizeBytes
 * @returns {number}
 */
export function diskMarginBytes(sizeBytes) {
  return Math.max(Math.ceil(sizeBytes * 0.25), 2 * GIB);
}

/**
 * Database size plus the margin above, which is what has to be free.
 * @param {number} sizeBytes
 * @returns {number}
 */
export function requiredFreeBytes(sizeBytes) {
  return sizeBytes + diskMarginBytes(sizeBytes);
}

/**
 * Free space on the filesystem holding `path`, through Node's own statfs.
 *
 * Returns a reason instead of throwing when the path cannot be read, because
 * that is a real and expected answer: the promotion may be pointed at a
 * Postgres on another machine (CI, a VPS), whose data directory does not exist
 * here. See `preflight` for what happens then -- it refuses rather than
 * skipping the check, because "we could not tell" must never read as "there is
 * room".
 *
 * @param {string} path
 * @returns {{ ok: true, freeBytes: number } | { ok: false, reason: string }}
 */
export function defaultMeasureFreeBytes(path) {
  try {
    const stat = statfsSync(path);
    return { ok: true, freeBytes: Number(stat.bavail) * Number(stat.bsize) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason:
        `PostgreSQL's data directory (${path}) is not on a drive this machine can read ` +
        `(${message}), so there is no way to tell whether the disk has room for a copy. ` +
        "This check refuses rather than skipping: if the paper's database is on another " +
        "machine, make room by hand and run the promote on the machine that holds it. " +
        "Nothing was changed and the paper was not touched.",
    };
  }
}

/**
 * Quote an identifier for SQL, and refuse anything that is not one.
 *
 * Doubling quotes is the actual safety; the pattern check above is what keeps a
 * name that reached here without going through it from being logged as
 * something it is not.
 *
 * @param {string} name
 * @returns {string}
 */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect for one command, and always close.
 *
 * `statement_timeout` is set so a `CREATE DATABASE ... TEMPLATE` that a busy
 * cluster has stalled is stopped by the SERVER as well as by the promotion's
 * own time limit -- the promotion kills the node process by PID, and this
 * makes sure the copy does not carry on in the background after it.
 *
 * @template T
 * @param {{ adminUrl: string, timeoutSeconds?: number, connectTimeoutMillis?: number }} options
 * @param {(client: Client) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function withAdmin(options, body) {
  // A bounded connect timeout, and it is not a detail: pg waits forever by
  // default, and a promotion whose Postgres is not answering would then sit
  // there holding the paper down until its step limit killed it -- with
  // nothing in the log saying why. Ten seconds is long enough for a loaded
  // local server and short enough to be a wait rather than a hang.
  const client = new Client({
    connectionString: options.adminUrl,
    connectionTimeoutMillis: options.connectTimeoutMillis ?? 10_000,
  });
  await client.connect();
  try {
    if (options.timeoutSeconds && options.timeoutSeconds > 0) {
      await client.query(`set statement_timeout = ${Math.floor(options.timeoutSeconds * 1000)}`);
    }
    return await body(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Does this database exist?
 * @param {Client} client
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function databaseExists(client, name) {
  const result = await client.query("select 1 from pg_database where datname = $1", [name]);
  return result.rowCount === 1;
}

/**
 * How big a database is, in bytes, as PostgreSQL itself measures it.
 * @param {Client} client
 * @param {string} name
 * @returns {Promise<number>}
 */
export async function databaseSizeBytes(client, name) {
  const result = await client.query("select pg_database_size($1)::bigint as bytes", [name]);
  return Number(result.rows[0]?.bytes ?? 0);
}

/**
 * Where PostgreSQL keeps this cluster's data, which is the drive a copy lands
 * on.
 * @param {Client} client
 * @returns {Promise<string>}
 */
export async function dataDirectory(client) {
  const result = await client.query("show data_directory");
  return String(result.rows[0]?.data_directory ?? "");
}

/**
 * May the role we are connected as create a database?
 *
 * `pg_database` says who owns what; this asks about the role itself, which is
 * the question `CREATE DATABASE` will ask. An owner who is not allowed is
 * refused by PostgreSQL at the copy, which is a worse moment to find out -- the
 * paper is already stopped by then.
 *
 * @param {Client} client
 * @returns {Promise<{ role: string, mayCreate: boolean, isSuperuser: boolean }>}
 */
export async function roleMayCreateDatabases(client) {
  const result = await client.query(
    "select current_user::text as role, rolsuper, rolcreatedb from pg_roles where rolname = current_user",
  );
  const row = result.rows[0] ?? {};
  return {
    role: String(row.role ?? ""),
    mayCreate: Boolean(row.rolsuper) || Boolean(row.rolcreatedb),
    isSuperuser: Boolean(row.rolsuper),
  };
}

/**
 * Who is connected to this database right now.
 *
 * Read-only. This module NEVER calls `pg_terminate_backend`: the sessions it
 * would find on this machine belong to the live paper, the development copy and
 * other people's tests, and ending one to make room for a promotion is not a
 * trade this script gets to make. It waits, and then it refuses.
 *
 * @param {Client} client
 * @param {string} name
 * @returns {Promise<Array<{ pid: number, user: string, application: string, host: string, state: string }>>}
 */
export async function connectionsTo(client, name) {
  const result = await client.query(
    `select pid,
            coalesce(usename, '')::text as usename,
            coalesce(application_name, '')::text as application_name,
            coalesce(host(client_addr), 'local')::text as host,
            coalesce(state, '')::text as state
       from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
      order by pid`,
    [name],
  );
  return result.rows.map((row) => ({
    pid: Number(row.pid),
    user: String(row.usename),
    application: String(row.application_name),
    host: String(row.host),
    state: String(row.state),
  }));
}

/**
 * Wait, up to a short limit, for nobody to be connected to a database.
 *
 * `CREATE DATABASE ... TEMPLATE` and `ALTER DATABASE ... RENAME` both refuse
 * while somebody else is connected to the database in question, so this is the
 * gate in front of both. The app was stopped a moment ago and its connections
 * drain in about a second, so the wait is normally invisible; it is bounded
 * because the alternative is a promotion that sits there holding the paper
 * down.
 *
 * @param {{
 *   adminUrl: string,
 *   databaseUrl?: string,
 *   databaseName: string,
 *   timeoutSeconds?: number,
 *   pollMs?: number,
 *   livePromote?: boolean,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   onWait?: (connections: Array<{ pid: number, user: string, application: string, host: string, state: string }>, elapsedSeconds: number) => void,
 * }} options
 * @returns {Promise<{ ok: boolean, connections: Array<{ pid: number, user: string, application: string, host: string, state: string }>, waitedSeconds: number, refusal: string }>}
 */
export async function waitForZeroConnections(options) {
  // The guard first, always: this is the gate everything destructive stands
  // behind, and it is checked before a connection is even opened.
  const guard = checkLivePortGuard([options.adminUrl, options.databaseUrl], options.livePromote);
  if (guard) return { ok: false, connections: [], waitedSeconds: 0, refusal: guard };
  const timeoutSeconds = options.timeoutSeconds ?? 30;
  const pollMs = options.pollMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const started = Date.now();
  let connections = [];
  for (;;) {
    connections = await withAdmin({ adminUrl: options.adminUrl }, (client) =>
      connectionsTo(client, options.databaseName),
    );
    const elapsedSeconds = (Date.now() - started) / 1000;
    if (connections.length === 0) {
      return { ok: true, connections: [], waitedSeconds: elapsedSeconds, refusal: "" };
    }
    if (elapsedSeconds >= timeoutSeconds) break;
    if (options.onWait) options.onWait(connections, elapsedSeconds);
    await sleep(Math.min(pollMs, Math.max(1, timeoutSeconds * 1000 - (Date.now() - started))));
  }
  const who = connections
    .slice(0, 5)
    .map((c) => `pid ${c.pid}${c.user ? ` (${c.user}${c.application ? `, ${c.application}` : ""})` : ""}`)
    .join(", ");
  const more = connections.length > 5 ? ` and ${connections.length - 5} more` : "";
  return {
    ok: false,
    connections,
    waitedSeconds: (Date.now() - started) / 1000,
    refusal:
      `${connections.length} connection(s) are still open to ${options.databaseName} after waiting ` +
      `${timeoutSeconds}s: ${who}${more}. Nothing was copied and nothing was renamed. Stop whatever ` +
      `is connected -- the paper on this install is the usual one -- and run this again. This script ` +
      `never ends another session: on this machine those sessions belong to the live paper, the ` +
      `development copy and other people's tests. Nothing was changed and the paper was not touched.`,
  };
}

/**
 * Everything that can be known BEFORE the app is stopped.
 *
 * The order of the promotion puts this inside its `preflight` step for exactly
 * that reason: the first real promotion stopped the paper and then discovered
 * the merge could not run, and the paper stayed down while it was sorted out.
 * Everything that can fail without consequence has to fail first.
 *
 * It reads; it changes nothing.
 *
 * @param {{
 *   adminUrl: string,
 *   databaseUrl: string,
 *   stamp: string,
 *   livePromote?: boolean,
 *   measureFreeBytes?: (path: string) => { ok: true, freeBytes: number } | { ok: false, reason: string },
 * }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function preflight(options) {
  const measure = options.measureFreeBytes ?? defaultMeasureFreeBytes;
  /** @type {Record<string, any>} */
  const report = {
    command: "preflight",
    ok: false,
    refusal: "",
    notes: [],
    database: "",
    copy: "",
    failed: "",
    stamp: options.stamp,
    sizeBytes: 0,
    requiredBytes: 0,
    freeBytes: null,
    dataDirectory: "",
    role: "",
    roleMayCreate: false,
    isSuperuser: false,
    copyExists: false,
    failedExists: false,
  };
  const refuse = (/** @type {string} */ sentence) => {
    report.refusal = sentence;
    return report;
  };
  const guard = checkLivePortGuard([options.adminUrl, options.databaseUrl], options.livePromote);
  if (guard) return refuse(guard);

  const database = deriveDatabaseName(options.databaseUrl);
  report.database = database;
  const nameRefusal = checkDatabaseName(database, "The database named by DATABASE_URL");
  if (nameRefusal) return refuse(nameRefusal);

  const copy = copyDatabaseName(database, options.stamp);
  const failed = failedDatabaseName(database, options.stamp);
  report.copy = copy;
  report.failed = failed;
  // Derived, so they start with the prefix by construction -- checked anyway,
  // because "by construction" is how a name check ends up not being one.
  for (const [name, what] of [
    [copy, "The copy's name"],
    [failed, "The failed-rollout database's name"],
  ]) {
    const derivedRefusal = checkDatabaseName(name, what);
    if (derivedRefusal) return refuse(derivedRefusal);
  }
  if (copy === failed) return refuse("The copy and the failed-rollout database would have the same name.");

  /*
    One shape for every branch, so the code below never has to ask whether a
    field it needs is there. An empty `refusal` means the checks passed.
  */
  const details = await withAdmin({ adminUrl: options.adminUrl, timeoutSeconds: 30 }, async (client) => {
    /** @type {{ refusal: string, role: { role: string, mayCreate: boolean, isSuperuser: boolean }, sizeBytes: number, directory: string, copyExists: boolean, failedExists: boolean }} */
    const out = {
      refusal: "",
      role: { role: "", mayCreate: false, isSuperuser: false },
      sizeBytes: 0,
      directory: "",
      copyExists: false,
      failedExists: false,
    };
    if (!(await databaseExists(client, database))) {
      out.refusal =
        `There is no database called "${database}" on the server DATABASE_URL points at. ` +
        "Check DATABASE_URL in the install's .env, then run this again. " +
        "Nothing was changed and the paper was not touched.";
      return out;
    }
    out.copyExists = await databaseExists(client, copy);
    out.failedExists = await databaseExists(client, failed);
    if (out.copyExists || out.failedExists) {
      const taken = [out.copyExists ? copy : null, out.failedExists ? failed : null].filter(Boolean).join('" and "');
      out.refusal =
        `"${taken}" already exists on the server. This run's copy and the database it would ` +
        "leave behind after a failed rollout are named after the second this run started, so " +
        "seeing one already there means this run has been started twice, or an earlier copy is " +
        "still lying around. Nothing is ever deleted automatically -- look at the databases on " +
        "the server, delete the old ones you no longer want by hand, and run this again. " +
        "Nothing was changed and the paper was not touched.";
      return out;
    }
    out.role = await roleMayCreateDatabases(client);
    if (!out.role.mayCreate) {
      out.refusal =
        `The role this install connects as ("${out.role.role}") is not allowed to create databases, ` +
        "and a promotion has to create one to copy the paper's database. Give that role CREATEDB, " +
        "or set PROMOTE_ADMIN_DATABASE_URL in the install's .env to a connection for a role that " +
        "may create databases, and run this again. " +
        "Nothing was changed and the paper was not touched.";
      return out;
    }
    out.sizeBytes = await databaseSizeBytes(client, database);
    out.directory = await dataDirectory(client);
    return out;
  });

  if (details.refusal) {
    report.role = details.role.role;
    report.roleMayCreate = details.role.mayCreate;
    return refuse(details.refusal);
  }

  report.role = details.role.role;
  report.roleMayCreate = details.role.mayCreate;
  report.isSuperuser = details.role.isSuperuser;
  report.copyExists = details.copyExists;
  report.failedExists = details.failedExists;
  report.sizeBytes = details.sizeBytes;
  report.requiredBytes = requiredFreeBytes(details.sizeBytes);
  report.dataDirectory = details.directory;

  const measured = measure(details.directory);
  if (!measured.ok) return refuse(measured.reason);
  report.freeBytes = measured.freeBytes;
  if (measured.freeBytes < report.requiredBytes) {
    return refuse(
      `There is not enough room for a copy of the paper's database. "${database}" is ` +
        `${formatBytes(details.sizeBytes)}, so a copy needs ${formatBytes(report.requiredBytes)} free ` +
        `(the database plus a quarter of its size, or 2 GB, whichever is larger), and the drive ` +
        `holding PostgreSQL's data directory (${details.directory}) has ${formatBytes(measured.freeBytes)} ` +
        "free. Free some space and run this again. Nothing was changed and the paper was not touched.",
    );
  }
  if (measured.freeBytes < report.requiredBytes * 2) {
    report.notes.push(
      `the drive holding PostgreSQL's data directory has ${formatBytes(measured.freeBytes)} free, ` +
        `which is enough for this copy (${formatBytes(report.requiredBytes)}) but not much more`,
    );
  }

  report.ok = true;
  return report;
}

/**
 * Take the copy: `CREATE DATABASE "<copy>" TEMPLATE "<database>"`.
 *
 * The caller has already stopped the app and waited for the connections to
 * clear; this checks both again rather than trusting the gap between two
 * processes, and refuses if either is not true. It never targets the copy of
 * a database it did not derive from the live name.
 *
 * @param {{ adminUrl: string, databaseUrl?: string, database: string, copy: string, timeoutSeconds?: number, livePromote?: boolean }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function copyDatabase(options) {
  const started = Date.now();
  /** @type {Record<string, any>} */
  const report = { command: "copy", ok: false, refusal: "", copy: options.copy, database: options.database, sizeBytes: 0, seconds: 0 };
  const refuse = (/** @type {string} */ sentence) => {
    report.refusal = sentence;
    report.seconds = (Date.now() - started) / 1000;
    return report;
  };
  const guard = checkLivePortGuard([options.adminUrl, options.databaseUrl], options.livePromote);
  if (guard) return refuse(guard);
  if (!isCopyOf(options.copy, options.database)) {
    return refuse(
      `The copy was to be called "${options.copy}", which is not "${options.database}${COPY_SUFFIX}<stamp>". ` +
        "Refusing. Nothing was changed and the paper was not touched.",
    );
  }

  const outcome = await withAdmin({ adminUrl: options.adminUrl, timeoutSeconds: options.timeoutSeconds }, async (client) => {
    if (!(await databaseExists(client, options.database))) {
      return `There is no database called "${options.database}" to copy.`;
    }
    if (await databaseExists(client, options.copy)) {
      return `"${options.copy}" already exists, and this never overwrites or deletes a database.`;
    }
    const connections = await connectionsTo(client, options.database);
    if (connections.length > 0) {
      return (
        `${connections.length} connection(s) are still open to ${options.database}, and PostgreSQL ` +
        "will not copy a database while they are. Nothing was copied."
      );
    }
    await client.query(`create database ${quoteIdent(options.copy)} template ${quoteIdent(options.database)}`);
    return null;
  });
  if (outcome) {
    return refuse(
      `${outcome} Free whatever is holding it and run this again. ` +
        "Nothing was changed and the paper was not touched.",
    );
  }

  report.sizeBytes = await withAdmin({ adminUrl: options.adminUrl }, (client) =>
    databaseSizeBytes(client, options.copy),
  );
  report.seconds = (Date.now() - started) / 1000;
  report.ok = true;
  return report;
}

/**
 * Put the copy back: rename the live database aside, then rename the copy into
 * its place.
 *
 * The order is the whole point and it is not interchangeable. Renaming the
 * live database ASIDE first means that at no moment is there no database under
 * the live name -- and if the second rename were to fail, the database the
 * paper was using is still on the server, under a name that says what happened
 * to it, rather than the promotion having overwritten it.
 *
 * `mode` only changes the wording: "recovery" is the promotion putting things
 * back by itself after a failed rollout, "manual" is an operator running
 * `ops\promote.ps1 -RollbackDatabase <copy>` afterwards, when the new app has
 * been serving and anything written since is about to be lost.
 *
 * @param {{
 *   adminUrl: string,
 *   databaseUrl?: string,
 *   database: string,
 *   copy: string,
 *   failed: string,
 *   mode?: "recovery" | "manual",
 *   timeoutSeconds?: number,
 *   livePromote?: boolean,
 * }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function swapBack(options) {
  const started = Date.now();
  const mode = options.mode ?? "recovery";
  /** @type {Record<string, any>} */
  const report = {
    command: mode === "manual" ? "rollback" : "swap-back",
    ok: false,
    refusal: "",
    database: options.database,
    copy: options.copy,
    failed: options.failed,
    steps: [],
    sizeBytes: 0,
    seconds: 0,
  };
  const refuse = (/** @type {string} */ sentence) => {
    report.refusal = sentence;
    report.seconds = (Date.now() - started) / 1000;
    return report;
  };

  const guard = checkLivePortGuard([options.adminUrl, options.databaseUrl], options.livePromote);
  if (guard) return refuse(guard);
  const nameRefusal = checkDatabaseName(options.database, "The live database's name");
  if (nameRefusal) return refuse(nameRefusal);
  if (!isCopyOf(options.copy, options.database)) {
    return refuse(
      `"${options.copy}" is not a copy of "${options.database}" ` +
        `(a copy is named "${options.database}${COPY_SUFFIX}<stamp>"). Refusing, because renaming ` +
        "something else over the paper's database is how the wrong database gets served. " +
        "Nothing was changed and the paper was not touched.",
    );
  }
  const failedRefusal = checkDatabaseName(options.failed, "The name the live database would take");
  if (failedRefusal) return refuse(failedRefusal);

  const outcome = await withAdmin({ adminUrl: options.adminUrl, timeoutSeconds: options.timeoutSeconds }, async (client) => {
    if (!(await databaseExists(client, options.database))) {
      return `There is no database called "${options.database}" to move aside.`;
    }
    if (!(await databaseExists(client, options.copy))) {
      return `The copy "${options.copy}" is not on the server, so there is nothing to put back.`;
    }
    if (await databaseExists(client, options.failed)) {
      return `"${options.failed}" already exists, and this never overwrites a database.`;
    }
    const connections = await connectionsTo(client, options.database);
    if (connections.length > 0) {
      return (
        `${connections.length} connection(s) are still open to ${options.database}, and PostgreSQL ` +
        "will not rename a database while they are."
      );
    }
    await client.query(`alter database ${quoteIdent(options.database)} rename to ${quoteIdent(options.failed)}`);
    report.steps.push(`renamed ${options.database} -> ${options.failed}`);
    await client.query(`alter database ${quoteIdent(options.copy)} rename to ${quoteIdent(options.database)}`);
    report.steps.push(`renamed ${options.copy} -> ${options.database}`);
    return null;
  });
  if (outcome) {
    const manual = mode === "manual" ? "Nothing was rolled back. " : "Nothing was swapped. ";
    return refuse(
      `${outcome} ${manual}The paper's database was not changed; see the log for what was still ` +
        "connected. Nothing was changed and the paper was not touched.",
    );
  }

  report.sizeBytes = await withAdmin({ adminUrl: options.adminUrl }, (client) =>
    databaseSizeBytes(client, options.database),
  );
  report.seconds = (Date.now() - started) / 1000;
  report.ok = true;
  return report;
}

/**
 * What exists right now, by name and size.
 *
 * Used by a resumed run: it must never take a second copy, so before it carries
 * on it asks whether the copy the interrupted run made is still on the server
 * and how big it is. Read-only.
 *
 * @param {{ adminUrl: string, names: string[], livePromote?: boolean }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function stateOf(options) {
  const guard = checkLivePortGuard([options.adminUrl], options.livePromote);
  if (guard) return { command: "state", ok: false, refusal: guard, databases: {} };
  const names = options.names.filter(Boolean);
  const found = await withAdmin({ adminUrl: options.adminUrl, timeoutSeconds: 30 }, async (client) => {
    /** @type {Record<string, { exists: boolean, sizeBytes: number }>} */
    const out = {};
    for (const name of names) {
      const exists = await databaseExists(client, name);
      out[name] = { exists, sizeBytes: exists ? await databaseSizeBytes(client, name) : 0 };
    }
    return out;
  });
  return { command: "state", ok: true, refusal: "", databases: found };
}

/**
 * Bytes as a person reads them, for the sentences above.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "an unknown size";
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

/**
 * Read the command's inputs out of the environment.
 *
 * The environment rather than the command line, because the admin connection
 * string holds a password and the promotion writes every command it runs into
 * its log (see the header).
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function readConfig(env = process.env) {
  const wait = Number(env.PROMOTE_DB_WAIT_SECONDS ?? "");
  const timeout = Number(env.PROMOTE_DB_TIMEOUT_SECONDS ?? "");
  return {
    adminUrl: (env.PROMOTE_DB_ADMIN_URL || env.PROMOTE_DB_DATABASE_URL || "").trim(),
    databaseUrl: (env.PROMOTE_DB_DATABASE_URL || "").trim(),
    database: (env.PROMOTE_DB_DATABASE || "").trim(),
    copy: (env.PROMOTE_DB_COPY || "").trim(),
    failed: (env.PROMOTE_DB_FAILED || "").trim(),
    stamp: (env.PROMOTE_DB_STAMP || "").trim(),
    waitSeconds: Number.isFinite(wait) && wait > 0 ? wait : 30,
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 600,
    // Exactly "1". Not "truthy": this is the one flag that unlocks the live
    // paper's database, and a stray empty or "false" in the environment must
    // read as "no".
    livePromote: (env[LIVE_PROMOTE_ENV] ?? "").trim() === "1",
  };
}

/**
 * Run one command. Returns the report; throws only when it could not run at
 * all.
 *
 * @param {string} command
 * @param {ReturnType<typeof readConfig>} config
 * @param {(path: string) => { ok: true, freeBytes: number } | { ok: false, reason: string }} [measureFreeBytes]
 * @returns {Promise<Record<string, any>>}
 */
export async function runCommand(command, config, measureFreeBytes) {
  /*
    THE LIVE-PORT GUARD, AND IT IS FIRST -- ahead of the missing-connection
    check, ahead of the argument checks, ahead of everything.

    Every command goes through here, including `names`, which only builds
    strings and opens nothing. That is deliberate: "every command except the
    harmless ones" is a rule with a list in it, and the list is what a later
    change adds a destructive entry to. One rule, checked once, before
    anything else can decide to connect.
  */
  const guard = checkLivePortGuard([config.adminUrl, config.databaseUrl], config.livePromote);
  if (guard) return { command, ok: false, refusal: guard };
  if (!config.adminUrl) {
    return {
      command,
      ok: false,
      refusal:
        "No connection to the database server was given. Set PROMOTE_ADMIN_DATABASE_URL, or " +
        "DATABASE_URL, in the install's .env. Nothing was changed and the paper was not touched.",
    };
  }
  switch (command) {
    case "names": {
      // The three names and nothing else -- no connection, no checks against
      // the server. Used by a resumed run that is carrying on from a step
      // before the copy: it has no names in hand and must not invent them, so
      // the rule stays here, where the copy command validates against it too.
      const database = config.database || deriveDatabaseName(config.databaseUrl);
      const refusal = checkDatabaseName(database, "The database named by DATABASE_URL");
      if (refusal) return { command, ok: false, refusal };
      if (!config.stamp) {
        return {
          command,
          ok: false,
          refusal:
            "No stamp was given for this run, so the copy's name cannot be built. " +
            "Nothing was changed and the paper was not touched.",
        };
      }
      return {
        command,
        ok: true,
        refusal: "",
        database,
        copy: copyDatabaseName(database, config.stamp),
        failed: failedDatabaseName(database, config.stamp),
        stamp: config.stamp,
      };
    }
    // Every one of these repeats the guard inside the function it calls, and
    // passes the flag on. Not belt and braces for its own sake: the functions
    // are exported, so a test or a script can call them without going through
    // a command line, and the guard has to be true of them too.
    case "preflight":
      return preflight({
        adminUrl: config.adminUrl,
        databaseUrl: config.databaseUrl,
        stamp: config.stamp,
        measureFreeBytes,
        livePromote: config.livePromote,
      });
    case "copy":
      return copyDatabase({
        adminUrl: config.adminUrl,
        database: config.database,
        copy: config.copy,
        timeoutSeconds: config.timeoutSeconds,
        livePromote: config.livePromote,
      });
    case "swap-back":
    case "rollback":
      return swapBack({
        adminUrl: config.adminUrl,
        database: config.database,
        copy: config.copy,
        failed: config.failed,
        mode: command === "rollback" ? "manual" : "recovery",
        timeoutSeconds: config.timeoutSeconds,
        livePromote: config.livePromote,
      });
    case "wait-for-zero": {
      const waited = await waitForZeroConnections({
        adminUrl: config.adminUrl,
        databaseName: config.database,
        timeoutSeconds: config.waitSeconds,
        livePromote: config.livePromote,
      });
      return { command, ...waited };
    }
    case "state":
      return stateOf({
        adminUrl: config.adminUrl,
        names: [config.database, config.copy, config.failed],
        livePromote: config.livePromote,
      });
    default:
      return {
        command,
        ok: false,
        refusal:
          `"${command}" is not one of this script's commands ` +
          "(names, preflight, copy, wait-for-zero, swap-back, rollback, state).",
      };
  }
}

const USAGE = "usage: node ops/lib-promote-db.mjs <names|preflight|copy|wait-for-zero|swap-back|rollback|state>";

/**
 * The command line, which is how ops\promote.ps1 calls this.
 *
 * One JSON object on stdout and nothing else, ever: the caller parses that line
 * out of the child's redirected output file, and a stray progress line would be
 * a line the promotion's log cannot read.
 */
async function main() {
  const command = (process.argv[2] ?? "").trim();
  if (!command || command === "--help" || command === "-h") {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  let report;
  try {
    report = await runCommand(command, readConfig());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report = {
      command,
      ok: false,
      refusal: "",
      error: message,
    };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.ok) {
    process.exitCode = 0;
    return;
  }
  // 3 is "refused, nothing was touched" and 1 is "it broke". The caller reads
  // the JSON either way; the codes are for a person at a prompt.
  process.exitCode = report.refusal ? 3 : 1;
}

// Same guard as scripts\run-postgres-integration.mjs: only run when this file
// IS the program, so a test can import everything above without a CLI firing.
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
