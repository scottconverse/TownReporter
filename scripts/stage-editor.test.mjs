import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import { assertStagingDatabase, upsertStagingEditor, STAGING_EMAIL, STAGING_USER_ID } from "./stage-editor.mjs";

test("staging writer refuses a fake config naming live townreporter before any writes", async () => {
  const config = { database: "townreporter" };
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      // Complete enough to let an unguarded writer succeed: the test must
      // fail from a missing refusal, not an unrelated fake-client error.
      return { rows: [{ database: config.database, reg: "present", id: STAGING_USER_ID, just_created: true }] };
    },
  };
  await assert.rejects(upsertStagingEditor(client), /Refusing database 'townreporter'.*townreporter_dev/);
  assert.deepEqual(queries, ["select current_database() as database"]);
});

test("staging URL guard refuses protocol and database query overrides", () => {
  for (const url of [
    "https://127.0.0.1:5550/townreporter_dev",
    "postgres://postgres@127.0.0.1:5550/townreporter_dev?database=townreporter",
    "postgres://postgres@127.0.0.1:5550/townreporter_dev#townreporter",
  ]) {
    assert.equal(assertStagingDatabase(url).ok, false, url);
  }
});

// Explicit opt-in: ordinary npm test never starts a database. This test owns
// a fresh Scoop Postgres cluster, not an inherited DATABASE_URL or PGPORT.
// PowerShell: $env:TOWNREPORTER_STAGE_OWNER_POSTGRES_TEST='1'; node --test scripts/stage-editor.test.mjs
test("staging account on throwaway UTF8 Postgres at port 5550", {
  skip: process.env.TOWNREPORTER_STAGE_OWNER_POSTGRES_TEST !== "1" || process.env.TOWNREPORTER_TEST_ENV_VERIFIED === "1",
  timeout: 120_000,
}, async (t) => {
  assert.equal(process.platform, "win32", "This fixture uses the Windows Scoop Postgres binaries.");
  const port = 5550;
  const probe = createServer();
  await new Promise((resolveProbe, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolveProbe);
  });
  await new Promise((resolveProbe, reject) => probe.close((error) => error ? reject(error) : resolveProbe()));

  const tempRoot = resolve(tmpdir());
  const clusterRoot = mkdtempSync(join(tempRoot, "townreporter-stage-owner-"));
  assert.ok(clusterRoot.startsWith(`${tempRoot}${sep}`));
  const data = join(clusterRoot, "data");
  const bin = join(homedir(), "scoop", "apps", "postgresql", "current", "bin");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  function run(tool, args) {
    return execFileSync(join(bin, `${tool}.exe`), args, {
      // Windows Postgres can inherit pg_ctl's pipes after pg_ctl exits.
      // Its server output goes to postgres.log; don't wait on those pipes.
      env, stdio: "ignore", windowsHide: true, timeout: 60_000,
    });
  }
  let started = false;
  let client;
  try {
    run("initdb", ["-D", data, "--encoding=UTF8", "--locale=C", "--auth=trust", "--username=postgres"]);
    run("pg_ctl", ["-D", data, "-l", join(clusterRoot, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1`, "-w", "start"]);
    started = true;
    const config = { host: "127.0.0.1", port, user: "postgres", password: "", ssl: false, options: "" };
    const admin = new pg.Client({ ...config, database: "postgres" });
    await admin.connect();
    try {
      await admin.query("create database townreporter_dev encoding 'UTF8' template template0");
    } finally {
      await admin.end();
    }
    client = new pg.Client({ ...config, database: "townreporter_dev" });
    await client.connect();
    assert.equal((await client.query("show server_encoding")).rows[0].server_encoding, "UTF8");
    await client.query(readFileSync(new URL("../migrations/0001_auth.sql", import.meta.url), "utf8"));
    await client.query(`
      create table newsrooms (id serial primary key, name text not null, created_at timestamptz not null default now());
      create table newsroom_members (user_id text primary key, role text not null, newsroom_id integer not null default 1,
                                    created_at timestamptz not null default now());
      create unique index newsroom_members_one_owner on newsroom_members (newsroom_id) where role = 'owner';
      -- Real column shapes from migrations/0050_daily_scan.sql and
      -- migrations/0054_routine_notice_automation.sql for the columns the
      -- swap moves; the schedulers gate on these user ids being the owner.
      create table daily_scan_policies (
        newsroom_id integer primary key references newsrooms(id),
        enabled boolean not null default false,
        paused boolean not null default false,
        pause_reason text,
        configured_by_user_id text not null
      );
      create table routine_notice_automations (
        newsroom_id integer primary key references newsrooms(id) on delete cascade,
        enabled boolean not null default false,
        revision integer not null default 0,
        activated_by text,
        activated_at timestamptz
      );
    `);
    async function reset() {
      await client.query(`
        truncate "user", "account", "session", newsroom_members, daily_scan_policies, routine_notice_automations cascade;
        insert into newsrooms (id, name) values (1, 'TownReporter Longmont') on conflict (id) do nothing;
        insert into "user" (id, name, email, "emailVerified") values ('real-owner', 'Real Owner', 'owner@example.test', true);
        insert into newsroom_members (user_id, role) values ('real-owner', 'owner');
      `);
    }
    // An enabled daily scan and an enabled routine-notice automation, both
    // configured by the restored real owner — the state a real backup carries.
    async function seedOwnerBoundAutomation() {
      await client.query(`
        insert into daily_scan_policies (newsroom_id, enabled, paused, configured_by_user_id)
          values (1, true, false, 'real-owner');
        insert into routine_notice_automations (newsroom_id, enabled, revision, activated_by, activated_at)
          values (1, true, 1, 'real-owner', now());
      `);
    }
    async function automation() {
      return (await client.query(`
        select p.enabled as scan_enabled, p.configured_by_user_id as scan_owner,
               a.enabled as notice_enabled, a.activated_by as notice_owner
        from daily_scan_policies p, routine_notice_automations a
        where p.newsroom_id = 1 and a.newsroom_id = 1
      `)).rows[0];
    }
    async function roles() {
      return (await client.query("select user_id, role from newsroom_members where newsroom_id = 1 order by user_id")).rows;
    }
    await t.test("default transfers ownership atomically and stays idempotent on a second run", async () => {
      await reset();
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await upsertStagingEditor(client);
        assert.deepEqual(await roles(), [
          { user_id: "real-owner", role: "editor" },
          { user_id: STAGING_USER_ID, role: "owner" },
        ]);
        assert.equal(result.role, "owner");
        assert.equal((await client.query("select count(*)::int as owners from newsroom_members where role = 'owner'")).rows[0].owners, 1);
        assert.equal((await client.query('select count(*)::int as users from "user" where email = $1', [STAGING_EMAIL])).rows[0].users, 1);
        assert.equal((await client.query('select count(*)::int as accounts from "account" where "userId" = $1', [STAGING_USER_ID])).rows[0].accounts, 1);
      }
    });
    await t.test("editor opt-out preserves the restored owner", async () => {
      await reset();
      assert.equal((await upsertStagingEditor(client, { stageOwner: false })).role, "editor");
      assert.deepEqual(await roles(), [
        { user_id: "real-owner", role: "owner" },
        { user_id: STAGING_USER_ID, role: "editor" },
      ]);
    });
    await t.test("default moves owner-bound automation authority to the staging user", async () => {
      await reset();
      await seedOwnerBoundAutomation();
      const result = await upsertStagingEditor(client);
      // The demoted owner configured an enabled daily scan and an enabled
      // routine-notice automation. The unattended schedulers pause/skip both
      // unless those ids are still the owner, so the swap has to re-point
      // them — and leave them enabled — or the dev copy stops behaving live.
      assert.deepEqual(await automation(), {
        scan_enabled: true,
        scan_owner: STAGING_USER_ID,
        notice_enabled: true,
        notice_owner: STAGING_USER_ID,
      });
      assert.deepEqual(
        result.automation,
        [
          { table: "daily_scan_policies", column: "configured_by_user_id", moved: 1 },
          { table: "routine_notice_automations", column: "activated_by", moved: 1 },
        ],
        "the swap should report moving one row of each authority column",
      );
    });
    await t.test("editor opt-out leaves automation authority with the real owner", async () => {
      await reset();
      await seedOwnerBoundAutomation();
      await upsertStagingEditor(client, { stageOwner: false });
      assert.deepEqual(await automation(), {
        scan_enabled: true,
        scan_owner: "real-owner",
        notice_enabled: true,
        notice_owner: "real-owner",
      });
    });
    await t.test("failed staging membership rolls back demotion and account creation", async () => {
      await reset();
      await client.query(`
        create function reject_staging() returns trigger language plpgsql as $$
          begin raise exception 'fixture membership failure'; end $$;
        create trigger reject_staging before insert or update on newsroom_members
          for each row when (NEW.user_id = '${STAGING_USER_ID}') execute function reject_staging();
      `);
      await assert.rejects(upsertStagingEditor(client), /fixture membership failure/);
      assert.deepEqual(await roles(), [{ user_id: "real-owner", role: "owner" }]);
      assert.equal((await client.query('select count(*)::int as users from "user" where email = $1', [STAGING_EMAIL])).rows[0].users, 0);
      assert.equal((await client.query('select count(*)::int as accounts from "account" where "userId" = $1', [STAGING_USER_ID])).rows[0].accounts, 0);
    });
  } finally {
    await client?.end();
    if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    // Only our freshly created, resolved directory under %TEMP% is removed.
    assert.ok(resolve(clusterRoot).startsWith(`${tempRoot}${sep}`));
    rmSync(clusterRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
