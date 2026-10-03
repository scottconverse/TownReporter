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
import { effectivePort, LIVE_POSTGRES_PORT, parseConnectionString, targetsLivePostgres } from "./lib-postgres-url.mjs";

// Re-exported so a caller (and the tests) can ask the same questions this
// module asks, without having to know that the answers live in their own file.
export { effectivePort, LIVE_POSTGRES_PORT, parseConnectionString, targetsLivePostgres };

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
 * The variable that says "this call really is the live promotion".
 *
 * Set by ops\promote.ps1, for the run that actually promotes. A test does not
 * set it, and `-WhatIf` does not set it either, because a dry run renames
 * nothing.
 */
export const LIVE_PROMOTE_ENV = "PROMOTE_DB_LIVE_PROMOTE";

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
 * WHICH PORT, EXACTLY, is the question this used to get wrong. It read the URL
 * text, so `postgres://host/db?port=5433` and a shell that had exported
 * `PGPORT=5433` both walked straight past it -- and pg dials 5433 for either.
 * The answer now comes from ops\lib-postgres-url.mjs, which resolves a port
 * exactly the way pg does, and is the same code the Postgres test lane's own
 * guard uses. One implementation, so the two cannot disagree about which
 * server they are looking at.
 *
 * It applies to EVERY command, including the ones that only read. A rule with
 * "except the harmless ones" is a rule with a hole in it, and the harmless
 * list is exactly the thing that grows a destructive entry later.
 *
 * @param {Array<string|undefined>} urls every connection string this call would use
 * @param {boolean} [livePromote] the caller's "this really is the promotion"
 * @param {NodeJS.ProcessEnv} [env] where PGPORT is read from
 * @returns {string} "" when the call may proceed
 */
export function checkLivePortGuard(urls, livePromote, env = process.env) {
  if (livePromote) return "";
  for (const value of urls) {
    const raw = (value ?? "").trim();
    if (!raw) continue;
    if (!targetsLivePostgres(raw, env)) continue;
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
 * The naming rules, once, for EVERY command.
 *
 * WHY ONE FUNCTION. These rules used to be spelled out at each command, and
 * they drifted: `copy` and `wait-for-zero` never checked the live database's
 * name at all, so `copy` would happily rename a database called anything at
 * all as long as the copy beside it looked like a copy of it, and
 * `wait-for-zero` would wait on any name it was handed. `preflight` accepted
 * an empty stamp that `names` refused, and built `townreporter_prerollout_`
 * out of nothing. One rule, in one place, called before a command does
 * anything -- including the commands that only read, because "the harmless
 * ones" is the list a destructive entry gets added to later.
 *
 * A STAMP IS REQUIRED BY EVERY COMMAND, not just the two that build names from
 * it. It is what every name in a run is derived from and what every log line
 * and every report is tied to; a command running without one is a caller that
 * has lost the thread of which run it belongs to, and the right answer is to
 * stop rather than to proceed with a name nobody can trace.
 *
 * @param {{
 *   database?: string,
 *   copy?: string,
 *   failed?: string,
 *   stamp?: string,
 *   deriveNames?: boolean,
 *   requireCopy?: boolean,
 *   requireFailed?: boolean,
 * }} options
 * @returns {string} "" when the names are all usable
 */
export function validateCommandNames(options) {
  const database = String(options.database ?? "").trim();
  const stamp = String(options.stamp ?? "").trim();
  const copy = String(options.copy ?? "").trim();
  const failed = String(options.failed ?? "").trim();

  const nameRefusal = checkDatabaseName(database, "The database name");
  if (nameRefusal) return nameRefusal;

  if (!stamp) {
    return (
      "No stamp was given for this run, so the copy's name cannot be built and nothing can be named " +
      "safely. Nothing was changed and the paper was not touched."
    );
  }

  const copyName = options.deriveNames ? copyDatabaseName(database, stamp) : copy;
  if (options.requireCopy && !copyName) {
    return `No name was given for the copy of ${database}. Nothing was changed and the paper was not touched.`;
  }
  if (copyName && !isCopyOf(copyName, database)) {
    return (
      `"${copyName}" is not a copy of "${database}" (a copy is named "${database}${COPY_SUFFIX}<stamp>"). ` +
      "Refusing, because renaming something else over the paper's database is how the wrong database gets " +
      "served. Nothing was changed and the paper was not touched."
    );
  }

  const failedName = options.deriveNames ? failedDatabaseName(database, stamp) : failed;
  if (options.requireFailed && !failedName) {
    return (
      `No name was given for the database ${database} is set aside as when a rollout fails. ` +
      "Nothing was changed and the paper was not touched."
    );
  }
  if (failedName) {
    const failedRefusal = checkDatabaseName(failedName, "The name the live database takes after a failed rollout");
    if (failedRefusal) return failedRefusal;
  }
  if (copyName && failedName && copyName === failedName) {
    return `The copy and the failed-rollout database would be the same name ("${copyName}"). Nothing was changed and the paper was not touched.`;
  }
  return "";
}

/**
 * What each command needs of its names. Used by runCommand, so the command
 * line cannot drift from what the function behind it enforces.
 */
/** @type {Record<string, { deriveNames?: boolean, requireCopy?: boolean, requireFailed?: boolean }>} */
const COMMAND_NAMES = {
  names: { deriveNames: true },
  preflight: { deriveNames: true },
  copy: { requireCopy: true },
  "wait-for-zero": {},
  "swap-back": { requireCopy: true, requireFailed: true },
  rollback: { requireCopy: true, requireFailed: true },
  state: {},
};

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

/**
 * A connection string with the password taken out.
 *
 * This module's output ends up in the promotion's log, and the log is what an
 * operator pastes into a ticket. The admin URL has a password in it.
 *
 * @param {string} url
 * @returns {string}
 */
export function redact(url) {
  return String(url ?? "").replace(/:[^:@/]*@/, ":***@");
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The databases this module will connect to in order to do its admin work.
 *
 * `postgres` is the maintenance database every PostgreSQL install has;
 * `template1` is the one it is created from, and is the fallback for a server
 * that has had `postgres` dropped or renamed.
 */
const MAINTENANCE_DATABASES = ["postgres", "template1"];

/**
 * The same connection string, pointed at one of the maintenance databases.
 *
 * User, password, host, port and query options are kept exactly as they were:
 * this changes the database name and nothing else. A URL that cannot be parsed
 * is handed back untouched, so the failure is the connection's own and not
 * this function's.
 *
 * @param {string} adminUrl
 * @param {string} database
 * @returns {string}
 */
export function maintenanceUrl(adminUrl, database) {
  const parsed = parseConnectionString(adminUrl);
  if (!parsed.ok) return adminUrl;
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** PostgreSQL's code for "that database does not exist". */
const INVALID_CATALOG_NAME = "3D000";

/** PostgreSQL's code for "you may not do that". */
const INSUFFICIENT_PRIVILEGE = "42501";

/** @param {unknown} error */
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

/**
 * Connect to the maintenance database on this server, and hand back the
 * client plus the name of the database it landed on.
 *
 * WHY IT IS NEVER THE DATABASE THE URL NAMES. With
 * `PROMOTE_ADMIN_DATABASE_URL` unset -- which is what .env.example
 * recommends -- the admin connection IS `DATABASE_URL`, and on the machine
 * that runs the paper that string names the paper's own database. PostgreSQL
 * refuses `ALTER DATABASE <current database> RENAME` with "current database
 * cannot be renamed", so a swap-back issued from there fails at the first
 * rename: the recovery would leave the paper on a half-migrated database with
 * nothing it could do about it. The copy worked, so the failure only appeared
 * at the one moment the copy exists for.
 *
 * Connecting to `postgres` instead is what the `psql -U postgres -d postgres`
 * in every tutorial is doing, and it is why the rest of this machine's
 * scripts do their database-level work from there.
 *
 * @param {{ adminUrl: string, connectTimeoutMillis?: number }} options
 * @returns {Promise<{ client: Client, database: string }>}
 */
async function connectForAdmin(options) {
  // A bounded connect timeout, and it is not a detail: pg waits forever by
  // default, and a promotion whose Postgres is not answering would then sit
  // there holding the paper down until its step limit killed it -- with
  // nothing in the log saying why. Ten seconds is long enough for a loaded
  // local server and short enough to be a wait rather than a hang.
  const connectTimeoutMillis = options.connectTimeoutMillis ?? 10_000;
  /** @type {unknown} */
  let lastError;
  for (const database of MAINTENANCE_DATABASES) {
    const client = new Client({
      connectionString: maintenanceUrl(options.adminUrl, database),
      connectionTimeoutMillis: connectTimeoutMillis,
    });
    try {
      await client.connect();
      return { client, database };
    } catch (error) {
      await client.end().catch(() => undefined);
      lastError = error;
      // Fall back ONLY for "that database is not there". Every other failure
      // -- wrong password, no route, no such role -- would fail identically on
      // template1, and trying twice would spend the step's time limit twice
      // while the paper is stopped.
      if (errorCode(error) !== INVALID_CATALOG_NAME) throw error;
    }
  }
  throw lastError;
}

/**
 * One connection to the maintenance database, closed again whatever happens.
 *
 * `statement_timeout` is set so a `CREATE DATABASE ... TEMPLATE` that a busy
 * cluster has stalled is stopped by the SERVER as well as by the promotion's
 * own time limit -- the promotion kills the node process by PID, and this
 * makes sure the copy does not carry on in the background after it.
 *
 * @template T
 * @param {{ adminUrl: string, timeoutSeconds?: number, connectTimeoutMillis?: number }} options
 * @param {(client: Client, maintenanceDatabase: string) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function withAdmin(options, body) {
  const { client, database } = await connectForAdmin(options);
  try {
    if (options.timeoutSeconds && options.timeoutSeconds > 0) {
      await client.query(`set statement_timeout = ${Math.floor(options.timeoutSeconds * 1000)}`);
    }
    return await body(client, database);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Turn a connection failure into a sentence an operator can act on.
 *
 * Only used where the failure has already been caught: the raw pg message is
 * a protocol detail ("permission denied for database postgres"), and the
 * useful half of it is which setting to change.
 *
 * @param {unknown} error
 * @param {string} adminUrl
 * @returns {string}
 */
export function connectFailureSentence(error, adminUrl) {
  const message = error instanceof Error ? error.message : String(error);
  if (errorCode(error) === INSUFFICIENT_PRIVILEGE) {
    return (
      `The role this install connects as may not open the "postgres" maintenance database on the server ` +
      `(${message}). Every promotion does its database work from there, because renaming a database from ` +
      "inside it is refused by PostgreSQL. Grant that role CONNECT on postgres, or set " +
      "PROMOTE_ADMIN_DATABASE_URL in the install's .env to a connection for a role that may. " +
      "Nothing was changed and the paper was not touched."
    );
  }
  return (
    `Could not reach the PostgreSQL server through ${redact(adminUrl)} (${message}). ` +
    "Nothing was changed and the paper was not touched."
  );
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
 * Who owns a database, or null when it is not there. A copy made over the admin
 * URL is owned by the admin role, and on PostgreSQL 18 schema `public` belongs
 * to `pg_database_owner`, so an app role that does not own its database cannot
 * create in `public`: the paper answers 500 once such a copy takes the live name.
 * @param {Client} client
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function databaseOwner(client, name) {
  const result = await client.query(
    "select r.rolname from pg_database d join pg_roles r on r.oid = d.datdba where d.datname = $1",
    [name],
  );
  return result.rowCount === 1 ? String(result.rows[0].rolname) : null;
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
 * The only `pg_stat_activity.backend_type` this module counts as a session.
 *
 * FINDING A, from the auditor's clone lab. A rollout aborted with the paper
 * already stopped because of this:
 *
 *   "2 connection(s) are still open to townreporter_prodclone, and PostgreSQL
 *    will not copy a database while they are."
 *
 * Those two were not the app and not a person. `pg_stat_activity` showed empty
 * usename and application_name, state `active`, query
 * `autovacuum: VACUUM pg_toast...`, and `backend_type = 'autovacuum worker'`.
 * A freshly restored 900 MB database gets vacuumed immediately, and the live
 * one gets it from time to time, so the rollout would abort whenever a vacuum
 * happened to be running -- and a minute later the same query showed nothing
 * and the copy worked. That is not a thing an unattended rollout can have.
 */
export const SESSION_BACKEND_TYPE = "client backend";

/**
 * Which rows of `pg_stat_activity` are a SESSION -- somebody who would actually
 * be disturbed by the database being copied or renamed.
 *
 * Everything else in that view is the server working on itself: autovacuum
 * workers, the checkpointer, the WAL writer, the logical replication launcher,
 * a background worker. Counting those would refuse a rollout for a reason no
 * operator can act on, with the paper down.
 *
 * WHY IGNORING AUTOVACUUM IS SAFE, and this is the part worth checking rather
 * than assuming. PostgreSQL's own check for both `CREATE DATABASE ... TEMPLATE`
 * and `ALTER DATABASE ... RENAME` is `CountOtherDBBackends`
 * (src/backend/storage/ipc/procarray.c). Its header says, in the source:
 *
 *   "If there are other backends in the DB, we will wait a maximum of 5
 *    seconds for them to exit.  Autovacuum backends are encouraged to exit
 *    early by sending them SIGTERM, but normal user backends are just waited
 *    for."
 *
 * So an autovacuum worker IS counted by PostgreSQL -- and PostgreSQL deals
 * with it: it SIGTERMs up to ten of them per pass and waits up to five seconds
 * for them to go. Recent versions also terminate interruptible background
 * workers attached to the database (commit f1e251b, "Allow bgworkers to be
 * terminated for database-related commands"). The conclusion is that a vacuum
 * cannot make our own `CREATE DATABASE ... TEMPLATE` or `ALTER DATABASE ...
 * RENAME` fail: they will clear it themselves. A *client* session is the one
 * PostgreSQL will NOT clear, and the one that therefore has to stop us before
 * we start -- which is exactly the line drawn here.
 *
 * Certainty: the header text above is quoted from the PostgreSQL source and is
 * the documented behaviour of the function, so I am confident about the
 * mechanism. What I could not do on this machine is watch it happen: nothing
 * here can provoke an autovacuum worker on demand (see the test file).
 *
 * @param {Array<{ pid?: unknown, usename?: unknown, application_name?: unknown, host?: unknown, state?: unknown, backend_type?: unknown }>} rows
 * @returns {Array<{ pid: number, user: string, application: string, host: string, state: string }>}
 */
export function sessionBackends(rows) {
  return rows
    // Compared case-insensitively, and trimmed. PostgreSQL returns exactly
    // "client backend" and always has, but the failure this guards against is
    // the quiet one: a comparison that stops matching counts NO sessions, and
    // the copy then runs under a live app instead of refusing. Being lenient
    // here can only ever count a row PostgreSQL would also have refused over.
    .filter((row) => String(row.backend_type ?? "").trim().toLowerCase() === SESSION_BACKEND_TYPE)
    .map((row) => ({
      pid: Number(row.pid),
      user: String(row.usename),
      application: String(row.application_name),
      host: String(row.host),
      state: String(row.state),
    }));
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
            coalesce(state, '')::text as state,
            coalesce(backend_type, '')::text as backend_type
       from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
      order by pid`,
    [name],
  );
  return sessionBackends(result.rows);
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
 *   stamp?: string,
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
  // This command used to wait on any name it was handed, which meant the one
  // gate in front of a rename did not apply the rule the rename itself does.
  const namesRefusal = validateCommandNames({ database: options.databaseName, stamp: options.stamp });
  if (namesRefusal) return { ok: false, connections: [], waitedSeconds: 0, refusal: namesRefusal };
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
  // The same rules every other command runs, including the empty stamp this
  // one used to accept -- and with them the copy and failed names it derives,
  // which were previously checked twice and in a second place.
  const namesRefusal = validateCommandNames({
    database,
    stamp: options.stamp,
    deriveNames: true,
  });
  if (namesRefusal) return refuse(namesRefusal);

  const copy = copyDatabaseName(database, options.stamp);
  const failed = failedDatabaseName(database, options.stamp);
  report.copy = copy;
  report.failed = failed;

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
 * @param {{ adminUrl: string, databaseUrl?: string, database: string, copy: string, stamp?: string, timeoutSeconds?: number, livePromote?: boolean }} options
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
  // The live database's name included. This command used to check only that
  // the copy looked like a copy of WHATEVER the live name was, so a live name
  // of `someotherpaper` with `someotherpaper_prerollout_<stamp>` beside it
  // sailed through and `CREATE DATABASE ... TEMPLATE` ran against a database
  // this module has no business touching.
  const namesRefusal = validateCommandNames({
    database: options.database,
    copy: options.copy,
    stamp: options.stamp,
    requireCopy: true,
  });
  if (namesRefusal) return refuse(namesRefusal);

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
    // The copy gets the live database's owner, not the admin role's.
    const owner = await databaseOwner(client, options.database);
    report.owner = owner;
    await client.query(
      `create database ${quoteIdent(options.copy)} template ${quoteIdent(options.database)}` +
        (owner ? ` owner ${quoteIdent(owner)}` : ""),
    );
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
 * After the copy takes the live name, give it back the owner the database it
 * replaced had. Also covers copies taken before copyDatabase set the owner.
 * Returns a sentence when it could not, null otherwise.
 * @param {Client} client
 * @param {string} name
 * @param {string|null} owner
 * @param {string[]} steps
 * @returns {Promise<string|null>}
 */
async function restoreOwner(client, name, owner, steps) {
  if (!owner) return null;
  const current = await databaseOwner(client, name);
  if (current === owner) return null;
  try {
    await client.query(`alter database ${quoteIdent(name)} owner to ${quoteIdent(owner)}`);
    steps.push(`set the owner of ${name} to ${owner} (it was ${current ?? "unknown"})`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      `The swap landed but ${name} could not be given back its owner ${owner} (${message}); the paper will answer 500 ` +
      `until you run: ALTER DATABASE ${quoteIdent(name)} OWNER TO ${quoteIdent(owner)};`
    );
  }
}

/**
 * One `ALTER DATABASE ... RENAME`, against the connection it is given.
 *
 * Its own exported function so a test can put a failing rename in its place
 * and watch what the swap does about it -- see `swapBack`'s `rename` option.
 *
 * @param {Client} client
 * @param {string} from
 * @param {string} to
 * @returns {Promise<void>}
 */
export async function renameDatabase(client, from, to) {
  await client.query(`alter database ${quoteIdent(from)} rename to ${quoteIdent(to)}`);
}

/**
 * Put the copy back: rename the live database aside, then rename the copy into
 * its place.
 *
 * WHAT IS ACTUALLY TRUE ABOUT THE WINDOW BETWEEN THE TWO RENAMES. Between
 * rename 1 and rename 2 there is NO database under the paper's name, for as
 * long as the second catalog update takes. That is unavoidable -- the two
 * renames are two statements and PostgreSQL has no transaction that covers
 * both (`ALTER DATABASE ... RENAME` cannot run inside one). What the ORDER
 * buys is different and still worth having: the database the paper was using
 * is never overwritten, so if rename 2 does not happen the data is all still
 * there, under a name that says what became of it. (An earlier version of
 * this comment claimed "at no moment is there no database under the live
 * name", which was simply untrue, and the auditor was right to call it.)
 *
 * BECAUSE rename 2 CAN FAIL, it is compensated. PostgreSQL refuses to rename a
 * database anybody is connected to, and the connection it is about to refuse
 * over is usually the COPY's -- something attached to the copy is invisible to
 * a check that only looks at the live database, which is what the first
 * version of this did. So:
 *
 *   1. BOTH databases are checked for sessions before rename 1, and the swap
 *      refuses, having renamed nothing, if either has one. A session is never
 *      ended, here or anywhere in this module.
 *   2. If rename 2 fails anyway -- a session that arrived in the gap, a name
 *      that came back -- rename 1 is undone immediately, and both outcomes
 *      are reported. The paper goes on serving the database it was serving.
 *   3. If even that fails, the report says exactly which name holds the
 *      paper's data and the one statement that puts it back.
 *   4. A swap that stopped in the middle (no live name, the failed name
 *      present, the copy present) is RESUMABLE: running it again finishes
 *      rename 2 instead of refusing because there is nothing to move aside.
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
 *   stamp?: string,
 *   timeoutSeconds?: number,
 *   livePromote?: boolean,
 *   rename?: (client: Client, from: string, to: string) => Promise<void>,
 *   sizeOf?: (client: Client, name: string) => Promise<number>,
 * }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function swapBack(options) {
  const started = Date.now();
  const mode = options.mode ?? "recovery";
  const rename = options.rename ?? renameDatabase;
  /** @type {Record<string, any>} */
  const report = {
    command: mode === "manual" ? "rollback" : "swap-back",
    ok: false,
    refusal: "",
    error: "",
    database: options.database,
    copy: options.copy,
    failed: options.failed,
    steps: [],
    resumedFromHalfState: false,
    sizeBytes: null,
    sizeKnown: false,
    seconds: 0,
  };
  const refuse = (/** @type {string} */ sentence) => {
    report.refusal = sentence;
    report.seconds = (Date.now() - started) / 1000;
    return report;
  };
  /**
   * Not a refusal: something WAS done, or was attempted and may have landed.
   * Kept separate from `refusal` because the caller's sentence for the two is
   * different -- "nothing was changed" is a lie for this one.
   */
  const broke = (/** @type {string} */ sentence) => {
    report.error = sentence;
    report.seconds = (Date.now() - started) / 1000;
    return report;
  };
  /** What happened so far, for a sentence that has to carry it. */
  const soFar = () => (report.steps.length ? ` What happened, in order: ${report.steps.join("; ")}.` : " Nothing had been renamed.");
  const connectionsSentence = (
    /** @type {Array<{ pid: number, user: string, application: string, host: string, state: string }>} */ rows,
    /** @type {string} */ name,
  ) =>
    `${rows.length} connection(s) are still open to ${name} (${rows
      .slice(0, 5)
      .map((row) => `pid ${row.pid}${row.user ? `, ${row.user}` : ""}`)
      .join("; ")}), and PostgreSQL will not rename a database while they are`;

  const guard = checkLivePortGuard([options.adminUrl, options.databaseUrl], options.livePromote);
  if (guard) return refuse(guard);
  const namesRefusal = validateCommandNames({
    database: options.database,
    copy: options.copy,
    failed: options.failed,
    stamp: options.stamp,
    requireCopy: true,
    requireFailed: true,
  });
  if (namesRefusal) return refuse(namesRefusal);

  /** @type {string|{ happened: string }|null} */
  let outcome = null;
  try {
    outcome = await withAdmin({ adminUrl: options.adminUrl, timeoutSeconds: options.timeoutSeconds }, async (client) => {
      const liveExists = await databaseExists(client, options.database);
      const copyExists = await databaseExists(client, options.copy);
      const failedExists = await databaseExists(client, options.failed);

      /*
        THE HALF STATE. An earlier swap got rename 1 done and rename 2 did not
        happen: the paper's name is free, its data is under the failed name and
        the copy is waiting. Finishing it is the only useful thing to do --
        refusing here ("there is no database called X to move aside") is what
        used to leave a promotion stuck with no way forward, because the retry
        path could not resume either.
      */
      if (!liveExists && copyExists && failedExists) {
        const onCopy = await connectionsTo(client, options.copy);
        if (onCopy.length > 0) {
          return `${connectionsSentence(onCopy, options.copy)}. This is the second half of a swap that stopped part way: ${options.failed} holds the database that was serving, and this finishes it by renaming ${options.copy} to ${options.database}`;
        }
        await rename(client, options.copy, options.database);
        report.steps.push(`renamed ${options.copy} -> ${options.database} (finishing a swap that stopped part way)`);
        report.resumedFromHalfState = true;
        const ownerProblem = await restoreOwner(client, options.database, await databaseOwner(client, options.failed), report.steps);
        return ownerProblem ? { happened: ownerProblem } : null;
      }

      if (!liveExists) {
        return `There is no database called "${options.database}" to move aside`;
      }
      if (!copyExists) {
        return `The copy "${options.copy}" is not on the server, so there is nothing to put back`;
      }
      if (failedExists) {
        return `"${options.failed}" already exists, and this never overwrites a database`;
      }

      // BOTH of them. The copy is the one PostgreSQL refuses over, and a check
      // that only looked at the live database is how a swap got half done.
      const onLive = await connectionsTo(client, options.database);
      if (onLive.length > 0) return connectionsSentence(onLive, options.database);
      const onCopy = await connectionsTo(client, options.copy);
      if (onCopy.length > 0) return connectionsSentence(onCopy, options.copy);

      const liveOwner = await databaseOwner(client, options.database);
      await rename(client, options.database, options.failed);
      report.steps.push(`renamed ${options.database} -> ${options.failed}`);
      try {
        await rename(client, options.copy, options.database);
        report.steps.push(`renamed ${options.copy} -> ${options.database}`);
        const ownerProblem = await restoreOwner(client, options.database, liveOwner, report.steps);
        if (ownerProblem) return { happened: ownerProblem };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        /*
          rename 2 did not happen. Undo rename 1, so the paper goes on serving
          the database it was serving -- the alternative is a paper whose
          database name does not exist.
        */
        try {
          await rename(client, options.failed, options.database);
          report.steps.push(`renamed ${options.failed} -> ${options.database} (put back after the next rename failed)`);
          // NOT a refusal: two renames really ran, and the caller's wording
          // for a refusal ("nothing was changed") would be a lie about them.
          // This travels back as an error with the sentence intact, and the
          // steps above travel with it.
          return {
            happened:
              `${options.copy} could not be renamed to ${options.database} (${message}). ${options.database} had already ` +
              `been renamed to ${options.failed}, and that has been undone, so the database the paper serves is unchanged ` +
              "and its data is where it was",
          };
        } catch (undoError) {
          const undoMessage = undoError instanceof Error ? undoError.message : String(undoError);
          report.steps.push(`putting ${options.failed} back as ${options.database} ALSO failed: ${undoMessage}`);
          return {
            happened:
              `${options.copy} could not be renamed to ${options.database} (${message}), and putting ${options.failed} ` +
              `back as ${options.database} failed too (${undoMessage}). THE PAPER'S DATABASE NAME IS GONE: its data is ` +
              `under ${options.failed}. Put it back with: ALTER DATABASE ${quoteIdent(options.failed)} RENAME TO ` +
              `${quoteIdent(options.database)};`,
          };
        }
      }
      return null;
    });
  } catch (error) {
    // A connection that failed, or anything else that escaped the closure.
    // The steps taken so far are already recorded on the report and are
    // carried out with the sentence -- an exception must not erase the record
    // of a rename that really happened.
    const message = error instanceof Error ? error.message : String(error);
    return broke(`The swap did not finish: ${message}.${soFar()}`);
  }
  if (outcome && typeof outcome === "object") {
    // Something happened and was undone, or happened and could not be undone.
    // Either way the sentence says so, and it carries the steps with it.
    return broke(`${outcome.happened}.${soFar()}`);
  }
  if (outcome) {
    const manual = mode === "manual" ? "Nothing was rolled back. " : "Nothing was swapped. ";
    return refuse(
      `${outcome}.${soFar()} ${manual}The paper's database was not changed; see the log for what was still ` +
        "connected. Nothing was changed and the paper was not touched.",
    );
  }

  /*
    The size, AFTER both renames landed -- and a failure here must not turn a
    swap that worked into a report that says it did not. The database the paper
    serves is already the copy; the size is only something the log says.

    `sizeOf` is the seam that test uses to make this fail on purpose. It is
    the only way to exercise it: the database the size is read from is the one
    that was just renamed into place, and nothing a test can do to a real
    server makes a `pg_database_size` fail without also breaking the swap.
  */
  const sizeOf = options.sizeOf ?? ((client, name) => databaseSizeBytes(client, name));
  try {
    report.sizeBytes = await withAdmin({ adminUrl: options.adminUrl }, (client) =>
      sizeOf(client, options.database),
    );
    report.sizeKnown = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.sizeBytes = null;
    report.sizeKnown = false;
    report.sizeNote = `the swap is done, but the size of ${options.database} could not be read afterwards (${message})`;
  }
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
 * @param {{ adminUrl: string, names: string[], stamp?: string, livePromote?: boolean }} options
 * @returns {Promise<Record<string, any>>}
 */
export async function stateOf(options) {
  const guard = checkLivePortGuard([options.adminUrl], options.livePromote);
  if (guard) return { command: "state", ok: false, refusal: guard, databases: {} };
  const namesRefusal = validateCommandNames({
    database: options.names[0],
    copy: options.names[1],
    failed: options.names[2],
    stamp: options.stamp,
  });
  if (namesRefusal) return { command: "state", ok: false, refusal: namesRefusal, databases: {} };
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

  /*
    THE NAMING RULES, HERE TOO. Each function below validates its own names as
    well, because they are exported and a script or a test can call them
    without a command line. This one is what makes the COMMAND LINE uniform:
    a bad live name or an empty stamp is refused before the switch, whichever
    command was asked for -- including `names`, which opens no connection.
  */
  const needs = COMMAND_NAMES[command] ?? { deriveNames: true, requireCopy: true, requireFailed: true };
  const databaseForNames = config.database || deriveDatabaseName(config.databaseUrl);
  const namesRefusal = validateCommandNames({
    database: databaseForNames,
    copy: config.copy,
    failed: config.failed,
    stamp: config.stamp,
    deriveNames: needs.deriveNames,
    requireCopy: needs.requireCopy,
    requireFailed: needs.requireFailed,
  });
  if (namesRefusal) return { command, ok: false, refusal: namesRefusal };

  switch (command) {
    case "names": {
      // The three names and nothing else -- no connection, no checks against
      // the server. Used by a resumed run that is carrying on from a step
      // before the copy: it has no names in hand and must not invent them, so
      // the rule stays in validateCommandNames, which every command uses.
      return {
        command,
        ok: true,
        refusal: "",
        database: databaseForNames,
        copy: copyDatabaseName(databaseForNames, config.stamp),
        failed: failedDatabaseName(databaseForNames, config.stamp),
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
        database: databaseForNames,
        copy: config.copy,
        stamp: config.stamp,
        timeoutSeconds: config.timeoutSeconds,
        livePromote: config.livePromote,
      });
    case "swap-back":
    case "rollback":
      return swapBack({
        adminUrl: config.adminUrl,
        database: databaseForNames,
        copy: config.copy,
        failed: config.failed,
        stamp: config.stamp,
        mode: command === "rollback" ? "manual" : "recovery",
        timeoutSeconds: config.timeoutSeconds,
        livePromote: config.livePromote,
      });
    case "wait-for-zero": {
      const waited = await waitForZeroConnections({
        adminUrl: config.adminUrl,
        databaseName: databaseForNames,
        stamp: config.stamp,
        timeoutSeconds: config.waitSeconds,
        livePromote: config.livePromote,
      });
      return { command, ...waited };
    }
    case "state":
      return stateOf({
        adminUrl: config.adminUrl,
        names: [databaseForNames, config.copy, config.failed],
        stamp: config.stamp,
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
  let config = readConfig();
  let report;
  try {
    report = await runCommand(command, config);
  } catch (error) {
    /*
      A failure this module did not turn into a sentence of its own. Two kinds
      matter to an operator and they need different words:

        - could not connect: nothing was touched, so the sentence may say so;
        - anything else (a rename that failed half way, say): the promotion
          must NOT be told "nothing was changed", because something was. Those
          are carried up as the raw message and the caller's own wording.
    */
    const code = errorCode(error);
    const connectionCodes = [
      "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET", // node
      "28P01", // invalid password
      "28000", // invalid authorization
      INSUFFICIENT_PRIVILEGE,
      INVALID_CATALOG_NAME,
    ];
    const message = error instanceof Error ? error.message : String(error);
    report = {
      command,
      ok: false,
      refusal: "",
      error: connectionCodes.includes(code) ? connectFailureSentence(error, config.adminUrl) : message,
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
