import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";
import {
  checkDatabaseName,
  checkLivePortGuard,
  copyDatabase,
  copyDatabaseName,
  renameDatabase,
  defaultMeasureFreeBytes,
  deriveDatabaseName,
  diskMarginBytes,
  effectivePort,
  failedDatabaseName,
  formatStamp,
  isCopyOf,
  LIVE_POSTGRES_PORT,
  LIVE_PROMOTE_ENV,
  parseCopyStamp,
  preflight,
  readConfig,
  requiredFreeBytes,
  runCommand,
  stateOf,
  swapBack,
  waitForZeroConnections,
} from "../../../ops/lib-promote-db.mjs";

/**
 * The database half of a promotion: the copy taken before a rollout, and the
 * swap that puts it back when the rollout fails. See ops/lib-promote-db.mjs
 * for why a failed promote needs one at all.
 *
 * THIS FILE RUNS AGAINST A REAL POSTGRES, and everything it creates is a
 * throwaway database named `townreporter_<this run>` -- the same prefix rule
 * the library itself enforces, because a promotion may
 * only ever copy, create or rename a database whose name starts with
 * `townreporter`, and this machine's Postgres also serves the live paper, the
 * development copy and thirty test databases.
 *
 * The four mutations the production auditor said to expect are each caught
 * here, and each is caught by an assertion about the SERVER rather than about
 * a return value:
 *
 *   - the copy is skipped      -> the copy does not exist and the rows are not
 *                                 in it (the copy-back test fails);
 *   - the rename order is
 *     swapped                  -> `_failed_` is missing or holds the wrong
 *                                 rows, and the recorded step order is wrong;
 *   - connections are not
 *     checked                  -> the open-session test would copy and rename
 *                                 under a live session instead of refusing;
 *   - the failed database is
 *     deleted                  -> there is no `_failed_` database to read the
 *                                 half-migrated rows out of.
 *
 * Run it through the lane runner, never directly:
 *   node scripts/run-postgres-integration.mjs src/lib/ops/promote-db.postgres.test.ts
 */

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this in the postgres-integration job" };
const skip = probe.ok ? false : probe.reason;

/** Every name this file creates. Dropped in `after`, whatever happened. */
const created: string[] = [];

/**
 * This run's own tag, short on purpose.
 *
 * A database name is capped at 63 characters by PostgreSQL -- and the copy's
 * name is the database's plus `_prerollout_` plus fourteen digits, which is
 * 27 more. A test that made a long name would be refused by the library's own
 * length check for a reason that has nothing to do with what it is testing.
 *
 * The pid and a slice of the clock are both in it so two runs of this file --
 * or a run that was interrupted and re-run -- cannot collide, and so a
 * leftover in the server's list says which run left it there.
 */
const RUN = `p${process.pid % 100000}x${Date.now().toString(36).slice(-4)}`;

/** A database of this file's own, with the prefix the library insists on. */
function scratchName(what: string): string {
  return `townreporter_${RUN}_${what}`;
}

async function admin(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  return client;
}

/** Create a database and remember it for teardown. */
async function createDatabase(name: string): Promise<void> {
  const client = await admin();
  try {
    await client.query(`create database "${name}"`);
    created.push(name);
  } finally {
    await client.end();
  }
}

/**
 * Run something against a database of this file's own, with one connection,
 * and close it again. `CREATE DATABASE ... TEMPLATE` refuses while anybody is
 * connected to the database being copied, so nothing here may leave one open.
 */
async function onDatabase<T>(name: string, body: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: withDatabase(adminUrl, name) });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function databaseNames(): Promise<string[]> {
  const client = await admin();
  try {
    const result = await client.query<{ datname: string }>("select datname from pg_database");
    return result.rows.map((row) => row.datname);
  } finally {
    await client.end();
  }
}

async function rowCount(name: string, table: string): Promise<number> {
  return onDatabase(name, async (client) => {
    const result = await client.query<{ n: string }>(`select count(*)::text as n from ${table}`);
    return Number(result.rows[0]?.n ?? -1);
  });
}

after(async () => {
  if (!probe.ok) return;
  const client = await admin();
  try {
    // Everything this file made, copies included. Some of them were created by
    // the library under test rather than by `createDatabase`, so the sweep is
    // by name rather than by a list -- every name this file makes carries the
    // pid it was made by, which is what keeps two runs from sweeping each
    // other's databases, and what makes a leftover readable.
    const made = await client.query<{ datname: string }>(
      "select datname from pg_database where datname like $1",
      [`townreporter_${RUN}%`],
    );
    for (const name of [...created, ...made.rows.map((row) => row.datname)]) {
      // Its own connections first, then the database -- this file's rule for
      // this file's own databases. The library under test NEVER does this.
      await client.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [name],
      );
      await client.query(`drop database if exists "${name}"`);
    }
  } finally {
    await client.end();
  }
});

/**
 * The naming rules, which decide which database on a shared server may be
 * touched at all. No Postgres needed, so these run everywhere -- the rest of
 * this file skips without an admin URL.
 */
describe("what a promotion is allowed to name", () => {
  it("reads the database name out of DATABASE_URL the way the install writes it", () => {
    assert.equal(deriveDatabaseName("postgres://user:pass@127.0.0.1:5432/townreporter"), "townreporter");
    // A query string is not part of the name -- the old split-on-slash rule
    // would have handed "townreporter?sslmode=require" to pg_dump and to psql.
    assert.equal(deriveDatabaseName("postgres://user@h:5432/townreporter?sslmode=require"), "townreporter");
    assert.equal(deriveDatabaseName("postgres://user@h:5432/townreporter_dev"), "townreporter_dev");
    assert.equal(deriveDatabaseName("postgres://user@h:5432/"), "");
    assert.equal(deriveDatabaseName(""), "");
    // Not a URL at all: the last-segment rule the install has always used, so
    // a connection string this runtime will not parse is still read the way it
    // has always been read rather than refused outright. Nothing after the
    // last slash is still nothing, and an empty name is refused later.
    assert.equal(deriveDatabaseName("host:5432/townreporter"), "townreporter");
    assert.equal(deriveDatabaseName("not a url at all"), "");
  });

  it("refuses a database that is not the paper's, in a sentence that says nothing was touched", () => {
    for (const good of ["townreporter", "townreporter_dev", "townreporter_ci", "townreporter2"]) {
      assert.equal(checkDatabaseName(good), "", `${good} must be allowed`);
    }
    for (const bad of ["someotherpaper", "postgres", "template1", "", "townreporter dev", 'townreporter"; drop database x; --']) {
      const refusal = checkDatabaseName(bad);
      assert.ok(refusal, `${JSON.stringify(bad)} must be refused`);
      assert.match(refusal, /Nothing was changed and the paper was not touched\./, "a refusal must say the paper was untouched");
    }
    assert.match(checkDatabaseName("someotherpaper"), /townreporter/, "a refusal must say what the rule is");
    // A name that starts with the prefix but is not a plain identifier: the
    // prefix is not a licence to smuggle a quote into a name that gets logged.
    assert.ok(checkDatabaseName("townreporter-x"), "a name that is not a plain identifier must be refused");
    assert.ok(checkDatabaseName(`townreporter_${"x".repeat(60)}`), "a name past PostgreSQL's 63-character limit must be refused");
  });

  it("names the copy and the failed database after the run's own second", () => {
    const stamp = "20261001120000";
    assert.equal(copyDatabaseName("townreporter", stamp), "townreporter_prerollout_20261001120000");
    assert.equal(failedDatabaseName("townreporter", stamp), "townreporter_failed_20261001120000");
    assert.equal(parseCopyStamp("townreporter_prerollout_20261001120000"), stamp);
    assert.equal(parseCopyStamp("townreporter_failed_20261001120000"), null);
    assert.equal(isCopyOf("townreporter_prerollout_20261001120000", "townreporter"), true);
    // A copy of SOMEBODY ELSE'S database is never a copy of this one, whatever
    // its name ends with.
    assert.equal(isCopyOf("otherdb_prerollout_20261001120000", "townreporter"), false);
    assert.equal(isCopyOf("townreporter_failed_20261001120000", "townreporter"), false);
    // And the derived names pass the same guard as the live one.
    assert.equal(checkDatabaseName(copyDatabaseName("townreporter", stamp)), "");
    assert.equal(checkDatabaseName(failedDatabaseName("townreporter", stamp)), "");
  });

  it("asks for the database's own size plus a quarter of it, or 2 GB", () => {
    assert.equal(diskMarginBytes(1000), 2 * 1024 ** 3, "a small database still needs the 2 GB floor");
    assert.equal(diskMarginBytes(1 * 1024 ** 3), 2 * 1024 ** 3);
    assert.equal(diskMarginBytes(10 * 1024 ** 3), 2.5 * 1024 ** 3, "a large database needs a quarter of itself");
    assert.equal(requiredFreeBytes(10 * 1024 ** 3), 12.5 * 1024 ** 3);
  });

  it("refuses a disk it cannot measure rather than skipping the check", () => {
    // The default measurement is what a promotion on another machine hits: the
    // data directory reported by the server is not a path on this one.
    const missing = resolve(process.cwd(), "no-such-directory-2f4a91", "pgdata");
    const measured = defaultMeasureFreeBytes(missing);
    assert.equal(measured.ok, false, "an unreadable data directory must not look like free space");
    if (!measured.ok) {
      assert.match(measured.reason, /not on a drive this machine can read/);
      assert.match(measured.reason, /Nothing was changed and the paper was not touched\./);
    }
  });
});

/**
 * The live-port guard: port 5433 is the live paper's Postgres on the machine
 * that runs it, and its connection string sits in that install's .env, which
 * is exactly what a test or a hand-typed command on that machine inherits.
 * One of the two things a promotion can do to such a connection is rename the
 * newspaper's database, so the port itself is the guard.
 *
 * NOTHING HERE CONNECTS TO ANYTHING. The host is `.invalid`, which RFC 2606
 * reserves and no resolver will answer for, so even the mutation that removes
 * the guard -- the check the auditor runs -- fails fast and reaches no server.
 * The one command that is allowed through the guard is `names`, which opens no
 * connection at all.
 */
describe("the live paper's port", () => {
  const LIVE = `postgres://promote:secret@townreporter-live.invalid:${LIVE_POSTGRES_PORT}/townreporter`;
  const TEST_SERVER = "postgres://promote:secret@townreporter-test.invalid:55433/townreporter";
  const NO_PORT = "postgres://promote:secret@townreporter-test.invalid/townreporter";

  const envFor = (adminUrl: string, livePromote: string) => ({
    PROMOTE_DB_ADMIN_URL: adminUrl,
    PROMOTE_DB_DATABASE_URL: adminUrl,
    PROMOTE_DB_DATABASE: "townreporter",
    PROMOTE_DB_COPY: "townreporter_prerollout_20261001120000",
    PROMOTE_DB_FAILED: "townreporter_failed_20261001120000",
    PROMOTE_DB_STAMP: "20261001120000",
    PROMOTE_DB_WAIT_SECONDS: "1",
    PROMOTE_DB_TIMEOUT_SECONDS: "1",
    [LIVE_PROMOTE_ENV]: livePromote,
  });

  it("knows which port a connection string dials", () => {
    assert.equal(effectivePort(LIVE), LIVE_POSTGRES_PORT);
    assert.equal(effectivePort(TEST_SERVER), 55433);
    // No port at all means PostgreSQL's own default -- which is 5432, and is
    // NOT the live machine's, so this can never be the answer that lets
    // something through.
    assert.equal(effectivePort(NO_PORT), 5432);
    assert.equal(effectivePort("nonsense"), null);
    assert.equal(effectivePort(""), null);
  });

  it("refuses 5433 without the flag, and takes it with the flag", () => {
    assert.equal(checkLivePortGuard([TEST_SERVER], false), "", "a test server must not be refused");
    assert.equal(checkLivePortGuard([TEST_SERVER], true), "");
    assert.equal(checkLivePortGuard([NO_PORT], false), "", "a default-port server must not be refused");
    assert.equal(checkLivePortGuard([], false), "");
    assert.equal(checkLivePortGuard([LIVE], true), "", "the live promotion itself must be allowed through");

    const refusal = checkLivePortGuard([LIVE], false);
    assert.match(refusal, /port 5433/);
    assert.match(refusal, new RegExp(LIVE_PROMOTE_ENV), "the refusal must name the flag that unlocks it");
    assert.match(refusal, /ops\\promote\.ps1/, "the refusal must say what to run instead");
    assert.match(refusal, /Nothing was changed and the paper was not touched\./);

    // The DATABASE url is checked too, not just the admin one: on the live
    // install they are usually the same string, but a promotion may be given
    // a separate admin connection while .env still points at 5433.
    assert.match(checkLivePortGuard(["", LIVE], false), /port 5433/);
  });

  it("does not mistake those four digits for the port", () => {
    // A rule that refuses a password containing "5433" would be a rule that
    // refuses a working install, and the first thing anyone would do is
    // weaken it.
    assert.equal(checkLivePortGuard(["postgres://user:5433@h.invalid/db"], false), "");
    // `?port=5433` is the port pg DIALS -- pg-connection-string folds the
    // query option into the same field as `:5433` -- so it is refused like any
    // other way of writing it. An earlier version of this guard read the URL
    // text only and this line asserted the opposite.
    assert.match(checkLivePortGuard(["postgres://user@h.invalid/db?port=5433"], false), /port 5433/);
    // The auditor's case: authority 5432, query 5433. pg lets the query win.
    assert.match(checkLivePortGuard(["postgres://user@h.invalid:5432/db?port=5433"], false), /port 5433/);
    assert.match(checkLivePortGuard(["postgres://user@h.invalid:5433/db?port=5432"], false), /port 5433/);
    assert.equal(checkLivePortGuard(["postgres://user@h.invalid/townreporter5433"], false), "");
    assert.equal(checkLivePortGuard(["postgres://user@h.invalid:54330/db"], false), "");
  });

  it("refuses EVERY command on 5433, and lets the one that does not connect through with the flag", async () => {
    const commands = ["names", "preflight", "copy", "wait-for-zero", "swap-back", "rollback", "state"];
    for (const command of commands) {
      const report = await runCommand(command, readConfig(envFor(LIVE, "") as NodeJS.ProcessEnv));
      assert.equal(report.ok, false, `${command} was allowed to run against port 5433`);
      assert.match(
        String(report.refusal),
        /port 5433/,
        `${command} was refused for some other reason, so the guard is not what stopped it: ${report.refusal}`,
      );
    }

    // With the flag the guard steps aside. `names` opens no connection, so
    // this is the one command that can prove it without dialling anything --
    // and on the live machine 5433 is a server this test must never reach.
    const named = await runCommand("names", readConfig(envFor(LIVE, "1") as NodeJS.ProcessEnv));
    assert.equal(named.ok, true, `the guard refused the live promotion itself: ${named.refusal}`);
    assert.equal(named.database, "townreporter");

    // ...and for a command that DOES connect, the guard is no longer what
    // stops it: this one fails on the unresolvable host instead.
    await assert.rejects(
      () => runCommand("preflight", readConfig(envFor(LIVE, "1") as NodeJS.ProcessEnv)),
      (error: unknown) => !/port 5433/.test(String(error)),
      "with the flag set, the guard is still refusing instead of the connection failing",
    );
  });

  it("applies the same naming rules to EVERY command", async () => {
    /*
      MAJOR M4. The rules used to be spelled out per command and had drifted:
      `copy` and `wait-for-zero` never checked the live database's name at all
      -- `copy` would rename a database called anything at all as long as the
      copy beside it looked like a copy of it -- and `preflight` accepted an
      empty stamp that `names` refused.

      The commands are listed here rather than imported, so a command added
      without a rule fails this test instead of quietly joining the list.
    */
    const commands = ["names", "preflight", "copy", "wait-for-zero", "swap-back", "rollback", "state"];
    const good = {
      PROMOTE_DB_ADMIN_URL: TEST_SERVER,
      PROMOTE_DB_DATABASE_URL: TEST_SERVER,
      PROMOTE_DB_DATABASE: "townreporter",
      PROMOTE_DB_COPY: "townreporter_prerollout_20261001120000",
      PROMOTE_DB_FAILED: "townreporter_failed_20261001120000",
      PROMOTE_DB_STAMP: "20261001120000",
      PROMOTE_DB_WAIT_SECONDS: "1",
      PROMOTE_DB_TIMEOUT_SECONDS: "1",
    };

    for (const command of commands) {
      // A live database that is not the paper's. Every command must refuse it
      // BEFORE anything else -- none of these reach the server, which is what
      // makes it safe to run them against a URL that could not be reached
      // anyway.
      const badName = await runCommand(command, readConfig({ ...good, PROMOTE_DB_DATABASE: "someotherpaper" } as NodeJS.ProcessEnv));
      assert.equal(badName.ok, false, `${command} accepted a database that is not the paper's`);
      assert.match(String(badName.refusal), /starts with/, `${command} refused for some other reason: ${badName.refusal}`);

      // ...and an empty stamp, which one command used to accept while another
      // refused it.
      const noStamp = await runCommand(command, readConfig({ ...good, PROMOTE_DB_STAMP: "" } as NodeJS.ProcessEnv));
      assert.equal(noStamp.ok, false, `${command} ran with no stamp`);
      assert.match(String(noStamp.refusal), /No stamp was given for this run/, `${command} refused for some other reason: ${noStamp.refusal}`);

    }

    // A bad COPY name, on the commands that are GIVEN one -- the rule that
    // keeps something else from being renamed over the paper's database.
    // `names` and `preflight` are not in this list because they take no copy
    // name at all: they derive it, and the validator checks what it derived.
    for (const command of ["copy", "wait-for-zero", "swap-back", "rollback", "state"]) {
      const badCopy = await runCommand(command, readConfig({ ...good, PROMOTE_DB_COPY: "something_else" } as NodeJS.ProcessEnv));
      assert.equal(badCopy.ok, false, `${command} accepted a copy name that is not a copy`);
      assert.match(String(badCopy.refusal), /is not a copy of/, `${command} refused for some other reason: ${badCopy.refusal}`);
    }
  });

  it("only accepts exactly the flag the promotion sets", () => {
    // "1" and nothing else. A stray empty, "0", "false" or "true" in the
    // environment must read as "no", because this is the one value that
    // unlocks the live paper's database.
    assert.equal(readConfig(envFor(LIVE, "") as NodeJS.ProcessEnv).livePromote, false);
    assert.equal(readConfig({ [LIVE_PROMOTE_ENV]: "0" } as NodeJS.ProcessEnv).livePromote, false);
    assert.equal(readConfig({ [LIVE_PROMOTE_ENV]: "true" } as NodeJS.ProcessEnv).livePromote, false);
    assert.equal(readConfig({ [LIVE_PROMOTE_ENV]: " 1 " } as NodeJS.ProcessEnv).livePromote, true);
  });
});

/** Everything below needs a real Postgres. */
describe("the copy and the swap, on a real server", { skip }, () => {
  it("copies a database and puts it back, keeping the failed one", async () => {
    const stamp = formatStamp();
    const live = scratchName("live");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key, headline text)");
      await client.query("insert into articles values (1, 'the first story'), (2, 'the second story')");
    });

    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);

    // --- preflight: read-only, and it says the copy's name is free ---------
    const report = await preflight({
      adminUrl,
      databaseUrl: withDatabase(adminUrl, live),
      stamp,
      // Injected: on CI the server is a container, so its data directory is
      // not a path the runner can measure. The real measurement has its own
      // test above.
      measureFreeBytes: () => ({ ok: true, freeBytes: Number.MAX_SAFE_INTEGER }),
    });
    assert.equal(report.ok, true, `preflight refused: ${report.refusal}`);
    assert.equal(report.database, live);
    assert.equal(report.copy, copy);
    assert.equal(report.failed, failed);
    assert.equal(report.copyExists, false);
    assert.equal(report.roleMayCreate, true, "the CI/test role must be allowed to create a database");
    assert.ok(report.sizeBytes > 0);
    assert.ok(report.requiredBytes >= 2 * 1024 ** 3, "the required room includes the 2 GB floor");
    assert.ok(report.dataDirectory.length > 0, "the server must report where it keeps its data");

    // --- the copy ---------------------------------------------------------
    const copied = await copyDatabase({ adminUrl, database: live, copy, stamp });
    assert.equal(copied.ok, true, `the copy was refused: ${copied.refusal}`);
    assert.ok((await databaseNames()).includes(copy), "CREATE DATABASE ... TEMPLATE did not leave the copy on the server");
    assert.equal(await rowCount(copy, "articles"), 2, "the copy does not hold the rows the live database had");

    // --- the failed rollout: the migration that died half way -------------
    // Exactly what `npm run db:migrate` leaves behind when it dies inside a
    // migration: the new table exists, and so does whatever it wrote.
    await onDatabase(live, async (client) => {
      await client.query("create table articles_v2 (id int primary key, headline text, dek text)");
      await client.query("insert into articles_v2 values (1, 'the first story', 'half migrated')");
    });
    assert.equal(await rowCount(live, "articles_v2"), 1, "the half-finished migration was not simulated");

    // --- the swap ---------------------------------------------------------
    const swapped = await swapBack({ adminUrl, database: live, copy, failed, stamp });
    assert.equal(swapped.ok, true, `the swap was refused: ${swapped.refusal}`);
    // The ORDER, which is the part that is not interchangeable: the live
    // database is moved aside FIRST, so there is never no database under the
    // live name.
    assert.deepEqual(swapped.steps, [`renamed ${live} -> ${failed}`, `renamed ${copy} -> ${live}`]);

    // The paper's database is the picture from before the rollout...
    assert.equal(await rowCount(live, "articles"), 2, "the paper's database does not hold the original rows");
    const columns = await onDatabase(live, async (client) => {
      const result = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public'",
      );
      return result.rows.map((row) => row.table_name).sort();
    });
    assert.deepEqual(columns, ["articles"], "the half-migrated table is still in the database the paper serves");

    // ...and the half-migrated schema is not deleted, it is named.
    const names = await databaseNames();
    assert.ok(names.includes(failed), "the failed-rollout database was not kept -- nothing may be deleted");
    assert.ok(!names.includes(copy), "the copy is still there under its own name after being swapped in");
    assert.equal(await rowCount(failed, "articles_v2"), 1, "the failed-rollout database does not hold what the migration wrote");
    assert.equal(await rowCount(failed, "articles"), 2);

    // --- what a resumed run asks ------------------------------------------
    const state = await stateOf({ adminUrl, names: [live, copy, failed], stamp });
    assert.equal(state.ok, true);
    assert.equal(state.databases[live]?.exists, true);
    assert.equal(state.databases[copy]?.exists, false, "the copy's old name must be gone after the swap");
    assert.equal(state.databases[failed]?.exists, true);
  });

  it("refuses to copy or rename while a session is open, and never ends that session", async (t) => {
    const stamp = formatStamp();
    const live = scratchName("busy");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key)");
      await client.query("insert into articles values (1)");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);

    // Somebody else's session -- a stand-in for the app that did not finish
    // going down, or another worker's test. It is NOT this code's to end.
    const other = new Client({ connectionString: withDatabase(adminUrl, live) });
    await other.connect();
    t.after(async () => {
      await other.end().catch(() => undefined);
    });
    const backendPid = await other.query<{ pid: number }>("select pg_backend_pid() as pid");
    const pid = Number(backendPid.rows[0]?.pid);

    // The wait is short here on purpose; the promotion's own is 30s.
    const waited = await waitForZeroConnections({ adminUrl, databaseName: live, stamp, timeoutSeconds: 2, pollMs: 200 });
    assert.equal(waited.ok, false, "an open session must not be reported as a clear database");
    assert.equal(waited.connections.length, 1);
    assert.equal(waited.connections[0]?.pid, pid);
    assert.match(waited.refusal, /still open/);
    assert.match(waited.refusal, /never ends another session/);
    assert.match(waited.refusal, /Nothing was changed and the paper was not touched\./);

    // The copy refuses rather than forcing its way past the session...
    const copied = await copyDatabase({ adminUrl, database: live, copy, stamp });
    assert.equal(copied.ok, false, "the copy ran while a session was open");
    assert.match(copied.refusal, /connection\(s\) are still open/);
    assert.ok(!(await databaseNames()).includes(copy), "a refused copy still created a database");

    // ...and so does the swap. Nothing is renamed either.
    const refused = await swapBack({ adminUrl, database: live, copy, failed, stamp });
    assert.equal(refused.ok, false, "the swap ran while a session was open");
    assert.deepEqual(refused.steps, [], "a refused swap must not have renamed anything");

    // THE PART THAT MATTERS: the other session is still alive and still
    // working. Ending it would have made the checks above pass.
    const alive = await other.query<{ n: string }>("select count(*)::text as n from articles");
    assert.equal(Number(alive.rows[0]?.n), 1, "the other session was killed to make room for the promotion");

    // With the session gone, the same calls work -- so the refusals above were
    // about the session and not about the arguments.
    await other.end();
    const copiedNow = await copyDatabase({ adminUrl, database: live, copy, stamp });
    assert.equal(copiedNow.ok, true, `the copy was refused after the session closed: ${copiedNow.refusal}`);
  });

  it("refuses a database that is not the paper's before it touches the server", async () => {
    const stamp = formatStamp();
    // A scratch database this file made, with somebody else's prefix: not a
    // database a promotion may copy. The rule is the name, not who owns it.
    const foreign = `notthepaper_${RUN}`;
    await createDatabase(foreign);

    const report = await preflight({
      adminUrl,
      databaseUrl: withDatabase(adminUrl, foreign),
      stamp,
      measureFreeBytes: () => ({ ok: true, freeBytes: Number.MAX_SAFE_INTEGER }),
    });
    assert.equal(report.ok, false);
    assert.match(report.refusal, /starts with/);
    assert.match(report.refusal, /Nothing was changed and the paper was not touched\./);
    // It refused before it touched the server: no copy of THAT database exists.
    const names = await databaseNames();
    assert.ok(!names.includes(copyDatabaseName(foreign, stamp)), "a refused preflight created a copy anyway");
    assert.ok(!names.includes(failedDatabaseName(foreign, stamp)));
  });

  it("refuses when there is no room on the disk, and when the disk cannot be read", async () => {
    const stamp = formatStamp();
    const live = scratchName("disk");
    await createDatabase(live);
    const options = { adminUrl, databaseUrl: withDatabase(adminUrl, live), stamp };

    const tight = await preflight({ ...options, measureFreeBytes: () => ({ ok: true, freeBytes: 1024 }) });
    assert.equal(tight.ok, false, "a full disk must not be reported as ready");
    assert.match(tight.refusal, /not enough room for a copy/);
    assert.match(tight.refusal, /Free some space/);
    assert.match(tight.refusal, /Nothing was changed and the paper was not touched\./);

    const unreadable = await preflight({
      ...options,
      // The real answer when the server is not on this machine.
      measureFreeBytes: () => ({ ok: false, reason: "PostgreSQL's data directory is not on a drive this machine can read. Nothing was changed and the paper was not touched." }),
    });
    assert.equal(unreadable.ok, false, "an unmeasurable disk must not be skipped");
    assert.match(unreadable.refusal, /not on a drive this machine can read/);

    // Enough room: the same call passes, so the refusals above were about the
    // measurement and not about anything else.
    const roomy = await preflight({ ...options, measureFreeBytes: () => ({ ok: true, freeBytes: Number.MAX_SAFE_INTEGER }) });
    assert.equal(roomy.ok, true, `preflight refused with room to spare: ${roomy.refusal}`);
  });

  it("does not take a second copy when the run is resumed", async () => {
    const stamp = formatStamp();
    const live = scratchName("resume");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key)");
      await client.query("insert into articles values (1)");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);

    const first = await copyDatabase({ adminUrl, database: live, copy, stamp });
    assert.equal(first.ok, true, `the first copy was refused: ${first.refusal}`);

    // A resumed run asks what is there and finds the copy; the preflight it
    // would otherwise run refuses rather than making a second one, which is
    // the point: nothing is overwritten and nothing is deleted.
    const state = await stateOf({ adminUrl, names: [live, copy], stamp });
    assert.equal(state.databases[copy]?.exists, true, "the resumed run must be able to see the copy it already took");
    assert.equal(state.databases[copy]?.sizeBytes, first.sizeBytes);

    const again = await copyDatabase({ adminUrl, database: live, copy, stamp });
    assert.equal(again.ok, false, "a resumed run took a second copy");
    assert.match(again.refusal, /already exists/);
    assert.match(again.refusal, /never overwrites or deletes a database/);
    assert.match(again.refusal, /Nothing was changed and the paper was not touched\./);

    const second = await preflight({
      adminUrl,
      databaseUrl: withDatabase(adminUrl, live),
      stamp,
      measureFreeBytes: () => ({ ok: true, freeBytes: Number.MAX_SAFE_INTEGER }),
    });
    assert.equal(second.ok, false, "preflight must refuse a stamp whose copy already exists");
    assert.match(second.refusal, /already exists/);

    // The copy that IS there is untouched by either refusal.
    assert.equal(await rowCount(copy, "articles"), 1);
    assert.equal(await rowCount(live, "articles"), 1);
    // And the failed name is still free, so nothing was consumed by the
    // refusals either.
    assert.ok(!(await databaseNames()).includes(failed));
  });

  it("rolls back by hand: the same swap, run afterwards by an operator", async () => {
    const rolloutStamp = formatStamp();
    const live = scratchName("manual");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key, headline text)");
      await client.query("insert into articles values (1, 'before the rollout'), (2, 'also before')");
    });
    const copy = copyDatabaseName(live, rolloutStamp);
    assert.equal((await copyDatabase({ adminUrl, database: live, copy, stamp: rolloutStamp })).ok, true);

    // The rollout succeeded and then the new app took writes -- which is
    // exactly why nothing rolls back by itself at this point.
    await onDatabase(live, async (client) => {
      await client.query("insert into articles values (3, 'written after the new app started')");
    });

    // `ops\promote.ps1 -RollbackDatabase <copy>`: a NEW stamp for what is
    // being replaced, because this is a different moment from the rollout.
    const failed = failedDatabaseName(live, formatStamp());
    const rolled = await swapBack({ adminUrl, database: live, copy, failed, stamp: rolloutStamp, mode: "manual" });
    assert.equal(rolled.ok, true, `the manual rollback was refused: ${rolled.refusal}`);
    assert.equal(rolled.command, "rollback");
    assert.deepEqual(rolled.steps, [`renamed ${live} -> ${failed}`, `renamed ${copy} -> ${live}`]);

    assert.equal(await rowCount(live, "articles"), 2, "the rollback did not restore the rows from before the rollout");
    assert.equal(await rowCount(failed, "articles"), 3, "what was written after the rollout must be kept, not deleted");

    // Refusals in this mode say which of the two things went wrong, so an
    // operator mid-incident is not left guessing.
    const badCopy = await swapBack({ adminUrl, database: live, copy: "something_else", failed, stamp: rolloutStamp, mode: "manual" });
    assert.equal(badCopy.ok, false);
    assert.match(badCopy.refusal, /is not a copy of/);
    assert.match(badCopy.refusal, /Nothing was changed and the paper was not touched\./);
  });

  it("works when the admin URL's own database IS the one being renamed (the default configuration)", async () => {
    /*
      BLOCKER B1, in the configuration .env.example recommends.

      With PROMOTE_ADMIN_DATABASE_URL unset -- which is the normal install --
      the promotion's admin connection is DATABASE_URL, and that string names
      the paper's OWN database. PostgreSQL refuses `ALTER DATABASE <current
      database> RENAME` with "current database cannot be renamed", so a
      swap-back issued from there failed at the first rename and left the paper
      on the half-migrated database with no way back. The COPY worked, which is
      why nothing caught it earlier: the failure only appears at the one moment
      the copy exists for.

      Every other test in this file points the admin URL at a maintenance
      database, which is exactly why this one did not exist. Here the admin URL
      IS the live database, for preflight, the copy and the swap.
    */
    const stamp = formatStamp();
    const live = scratchName("selfadmin");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key, headline text)");
      await client.query("insert into articles values (1, 'before the rollout')");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);
    // The admin connection points at the database that is about to be renamed.
    const asTheAppRole = withDatabase(adminUrl, live);

    const report = await preflight({
      adminUrl: asTheAppRole,
      databaseUrl: asTheAppRole,
      stamp,
      measureFreeBytes: () => ({ ok: true, freeBytes: Number.MAX_SAFE_INTEGER }),
    });
    assert.equal(report.ok, true, `preflight refused with the admin URL on the live database: ${report.refusal}`);
    assert.equal(report.copy, copy);

    const copied = await copyDatabase({ adminUrl: asTheAppRole, database: live, copy: copy, stamp });
    assert.equal(copied.ok, true, `the copy failed with the admin URL on the live database: ${copied.refusal}`);

    // The rollout fails; the database is now half-migrated.
    await onDatabase(live, async (client) => {
      await client.query("create table articles_v2 (id int primary key)");
    });

    const swapped = await swapBack({ adminUrl: asTheAppRole, database: live, copy, failed, stamp });
    assert.equal(
      swapped.ok,
      true,
      `the swap-back failed with the admin URL on the live database -- this is the whole of B1: ${swapped.refusal || swapped.error}`,
    );
    assert.deepEqual(swapped.steps, [`renamed ${live} -> ${failed}`, `renamed ${copy} -> ${live}`]);
    assert.equal(await rowCount(live, "articles"), 1, "the paper's database is not the copy again");
    const columns = await onDatabase(live, async (client) => {
      const result = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public'",
      );
      return result.rows.map((row) => row.table_name).sort();
    });
    assert.deepEqual(columns, ["articles"], "the half-migrated table is still in the database the paper serves");
    assert.equal(await rowCount(failed, "articles_v2"), 0);
  });

  it("refuses when a session is attached to the COPY, and renames nothing", async (t) => {
    /*
      BLOCKER B2, first half. The old check looked at the live database only,
      so a session on the copy was invisible: rename 1 went through, rename 2
      threw "is being accessed by other users", and the server was left with a
      failed database, a prerollout database and NO database under the paper's
      name. Neither the retry nor -RollbackDatabase could resume, because both
      refused with "there is no database to move aside".
    */
    const stamp = formatStamp();
    const live = scratchName("busycopy");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key)");
      await client.query("insert into articles values (1)");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);
    assert.equal((await copyDatabase({ adminUrl, database: live, copy, stamp })).ok, true);

    // Somebody else's session, on the COPY.
    const other = new Client({ connectionString: withDatabase(adminUrl, copy) });
    await other.connect();
    t.after(async () => {
      await other.end().catch(() => undefined);
    });

    const refused = await swapBack({ adminUrl, database: live, copy, failed, stamp });
    assert.equal(refused.ok, false, "a swap ran while a session was attached to the copy");
    assert.deepEqual(refused.steps, [], "a refused swap renamed something");
    assert.match(String(refused.refusal), /still open to /);
    assert.match(String(refused.refusal), new RegExp(copy), "the refusal does not name the copy that is being used");

    // NOTHING moved: the paper still has its own name, the copy still has its
    // own name, and the failed name was never created.
    const names = await databaseNames();
    assert.ok(names.includes(live), "the paper's database name is gone");
    assert.ok(names.includes(copy), "the copy's name is gone");
    assert.ok(!names.includes(failed), "a failed database was created by a swap that refused");
    assert.equal(await rowCount(live, "articles"), 1);

    // ...and the session that caused it is still alive. Ending it would have
    // made the assertions above pass.
    assert.equal(Number((await other.query<{ n: string }>("select count(*)::text as n from pg_class")).rows[0]?.n) > 0, true);
  });

  it("puts the paper's name back when the second rename fails anyway", async () => {
    /*
      BLOCKER B2, second half. The connection check is a check, not a lock: a
      session can arrive between it and the rename, and PostgreSQL will refuse
      then. When it does, rename 1 has already happened -- so the swap undoes
      it, and the paper goes on serving the database it was serving.

      The failure is injected (the real one needs a session to arrive inside a
      window of a few milliseconds, which cannot be made deterministic without
      holding a session on a database this test does not own). EVERYTHING ELSE
      IS REAL: the pre-checks, rename 1, the undo, and the verification that
      the paper's database is where it was are all against a real Postgres.
    */
    const stamp = formatStamp();
    const live = scratchName("renamefail");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key)");
      await client.query("insert into articles values (7)");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);
    assert.equal((await copyDatabase({ adminUrl, database: live, copy, stamp })).ok, true);

    let renames = 0;
    const swapped = await swapBack({
      adminUrl,
      database: live,
      copy,
      failed,
      stamp,
      rename: async (client, from, to) => {
        renames += 1;
        // The first one is real. The second is the one that fails.
        if (renames === 2) throw new Error(`database "${to}" is being accessed by other users`);
        await renameDatabase(client, from, to);
      },
    });

    assert.equal(swapped.ok, false, "a swap whose second rename failed was reported as done");
    // (3) the record of what happened survives the failure.
    assert.deepEqual(
      swapped.steps,
      [`renamed ${live} -> ${failed}`, `renamed ${failed} -> ${live} (put back after the next rename failed)`],
      "the report does not carry both renames, so the log cannot say what happened",
    );
    assert.equal(renames, 3, "the undo did not run");
    assert.match(String(swapped.error), /could not be renamed to /, `the failure sentence is missing: ${swapped.error}`);
    assert.match(String(swapped.error), /has been undone/, "the sentence does not say the first rename was undone");

    // The paper's database: same name, same rows, same table set.
    const names = await databaseNames();
    assert.ok(names.includes(live), "the paper's database name was not put back");
    assert.ok(names.includes(copy), "the copy was consumed by a swap that failed");
    assert.ok(!names.includes(failed), "the failed database was left behind after the undo");
    assert.equal(await rowCount(live, "articles"), 1, "the paper's rows moved somewhere");
  });

  it("finishes a swap that stopped half way, including from the hand rollback", async () => {
    /*
      BLOCKER B2, third part: RESUMABLE.

      The state an interrupted swap leaves is "no live name, the failed name
      present, the copy present". Both the retry and `-RollbackDatabase` used
      to refuse it -- "there is no database called townreporter to move aside"
      -- which is how a paper stayed stuck with its data under a name nothing
      was serving.

      The half state is made here the way it is really made: rename 1, done by
      hand against the server, and nothing else.
    */
    const stamp = formatStamp();
    const live = scratchName("halfstate");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key, headline text)");
      await client.query("insert into articles values (1, 'before the rollout')");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);
    assert.equal((await copyDatabase({ adminUrl, database: live, copy, stamp })).ok, true);
    // The half-migrated database: the rollout got as far as migrating.
    await onDatabase(live, async (client) => {
      await client.query("insert into articles values (2, 'written by the half-migrated schema')");
    });

    // Rename 1, on its own -- this is where a swap whose second rename failed
    // leaves the server.
    const raw = await admin();
    try {
      await raw.query(`alter database "${live}" rename to "${failed}"`);
    } finally {
      await raw.end();
    }
    const names = await databaseNames();
    assert.ok(!names.includes(live) && names.includes(failed) && names.includes(copy), "the half state was not set up");

    // A plain retry finishes it -- and says so, because a reader has to know
    // this run did not do the first rename.
    const finished = await swapBack({ adminUrl, database: live, copy, failed, stamp });
    assert.equal(finished.ok, true, `the half state could not be finished: ${finished.refusal || finished.error}`);
    assert.equal(finished.resumedFromHalfState, true, "the report does not say it was picking up a half-finished swap");
    assert.deepEqual(finished.steps, [`renamed ${copy} -> ${live} (finishing a swap that stopped part way)`]);
    assert.equal(await rowCount(live, "articles"), 1, "the paper's database is not the pre-rollout copy");
    assert.equal(await rowCount(failed, "articles"), 2, "what the failed rollout wrote was not kept");

    // And the hand rollback accepts the same state. `-RollbackDatabase` derives
    // the failed name from the copy's own stamp, which is the only name the
    // data could be under -- so this is the same call it makes.
    const stamp2 = formatStamp();
    const live2 = scratchName("halfrollback");
    await createDatabase(live2);
    await onDatabase(live2, async (client) => {
      await client.query("create table articles (id int primary key)");
      await client.query("insert into articles values (1)");
    });
    const copy2 = copyDatabaseName(live2, stamp2);
    const failed2 = failedDatabaseName(live2, stamp2);
    assert.equal((await copyDatabase({ adminUrl, database: live2, copy: copy2, stamp: stamp2 })).ok, true);
    const admin2 = await admin();
    try {
      await admin2.query(`alter database "${live2}" rename to "${failed2}"`);
    } finally {
      await admin2.end();
    }
    const rolled = await swapBack({
      adminUrl,
      database: live2,
      copy: copy2,
      failed: failedDatabaseName(live2, parseCopyStamp(copy2) ?? ""),
      stamp: stamp2,
      mode: "manual",
    });
    assert.equal(rolled.ok, true, `the hand rollback cannot resume the half state: ${rolled.refusal || rolled.error}`);
    assert.equal(rolled.command, "rollback");
    assert.equal(await rowCount(live2, "articles"), 1);
  });

  it("reports the swap as done when only the size query afterwards fails", async () => {
    /*
      MAJOR M5. Both renames have landed -- the paper's database IS the copy --
      and then the size query fails. The report used to call that "NOT
      swapped", which the promotion turns into a refusal: the operator would be
      told the database was not put back when it was, and the recovery would
      start moving the old build onto a database it thought was still
      half-migrated.
    */
    const stamp = formatStamp();
    const live = scratchName("sizefail");
    await createDatabase(live);
    await onDatabase(live, async (client) => {
      await client.query("create table articles (id int primary key)");
      await client.query("insert into articles values (1)");
    });
    const copy = copyDatabaseName(live, stamp);
    const failed = failedDatabaseName(live, stamp);
    assert.equal((await copyDatabase({ adminUrl, database: live, copy, stamp })).ok, true);

    const swapped = await swapBack({
      adminUrl,
      database: live,
      copy,
      failed,
      stamp,
      sizeOf: async () => {
        throw new Error("connection terminated unexpectedly");
      },
    });

    assert.equal(swapped.ok, true, `a swap that finished was reported as failed because a size could not be read: ${swapped.refusal || swapped.error}`);
    assert.equal(swapped.sizeKnown, false, "the report claims to know a size it could not read");
    assert.equal(swapped.sizeBytes, null);
    assert.match(String(swapped.sizeNote), /the swap is done, but the size of /, `the note does not say the swap is done: ${swapped.sizeNote}`);
    assert.deepEqual(swapped.steps, [`renamed ${live} -> ${failed}`, `renamed ${copy} -> ${live}`]);

    // And the server agrees: the swap really happened.
    assert.equal(await rowCount(live, "articles"), 1);
    assert.ok((await databaseNames()).includes(failed), "the failed database was not kept");
  });

  it("answers the promotion's command line with one line of JSON", async () => {
    const stamp = formatStamp();
    const live = scratchName("cli");
    await createDatabase(live);
    const cli = resolve(process.cwd(), "ops", "lib-promote-db.mjs");
    const env = {
      ...process.env,
      PROMOTE_DB_ADMIN_URL: adminUrl,
      PROMOTE_DB_DATABASE_URL: withDatabase(adminUrl, live),
      PROMOTE_DB_DATABASE: live,
      PROMOTE_DB_COPY: copyDatabaseName(live, stamp),
      PROMOTE_DB_FAILED: failedDatabaseName(live, stamp),
      PROMOTE_DB_STAMP: stamp,
      PROMOTE_DB_WAIT_SECONDS: "5",
      PROMOTE_DB_TIMEOUT_SECONDS: "60",
    };

    const printed = execFileSync(process.execPath, [cli, "names"], { env, encoding: "utf8" });
    // ONE line, and nothing else: the promotion parses this out of a file that
    // also holds the wrapper's own exit-code line.
    assert.equal(printed.trim().split("\n").length, 1, `the command line printed more than one line: ${printed}`);
    const names = JSON.parse(printed.trim());
    assert.equal(names.ok, true);
    assert.equal(names.database, live);
    assert.equal(names.copy, copyDatabaseName(live, stamp));
    assert.equal(names.failed, failedDatabaseName(live, stamp));
    // The connection string is never echoed: it holds a password, and this
    // line ends up in the promotion's log.
    assert.doesNotMatch(printed, /PROMOTE_DB_ADMIN_URL|password/i);

    // A refusal exits 3 and is a sentence, not a stack trace.
    // PROMOTE_DB_DATABASE is cleared as well: the promotion sets it once it
    // has a name, and `names` prefers it to the URL, so leaving it would test
    // the wrong thing (a name that is fine, from the run before).
    const refusedEnv = {
      ...env,
      PROMOTE_DB_DATABASE: "",
      PROMOTE_DB_DATABASE_URL: withDatabase(adminUrl, "someotherpaper"),
    };
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, [cli, "names"], { env: refusedEnv, encoding: "utf8" });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      status = failure.status ?? 0;
      stdout = failure.stdout ?? "";
    }
    assert.equal(status, 3, "a refusal must exit 3, so a person at a prompt can tell it from a crash");
    const refusal = JSON.parse(stdout.trim());
    assert.equal(refusal.ok, false);
    assert.match(refusal.refusal, /Nothing was changed and the paper was not touched\./);

    // The same, through the function the promotion's `copy` command calls.
    const viaCommand = await runCommand("copy", readConfig(env as NodeJS.ProcessEnv));
    assert.equal(viaCommand.ok, true, `the copy command refused: ${viaCommand.refusal}`);
    assert.ok((await databaseNames()).includes(copyDatabaseName(live, stamp)));
  });
});
