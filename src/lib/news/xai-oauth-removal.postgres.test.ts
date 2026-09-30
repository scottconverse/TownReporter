import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

/*
  migrations/0112_drop_xai_oauth_connections.sql, on a real PostgreSQL.

  WHY THIS IS NOT A PGLITE TEST. GR-C removed Grok (xAI) as a provider, and two
  separate promises have to hold on the database the newsroom actually runs:

    1. A LIVE INSTALL MIGRATES. A database that ran 0060 still holds
       `xai_oauth_connections`, with a row in it -- a real SuperGrok sign-in, its
       encrypted credential and the account's discovered model ids. The migration
       has to drop that table cleanly, be safe to run twice, and leave every
       other table alone.

    2. NOTHING THAT STORED THE RETIRED ID BREAKS. A newsroom, a `desk_jobs`
       row or a `model_assignments` row written by a build that still offered
       Grok carries the string `grok-oauth`. It must keep LOADING: the row is
       read without error and the desk normalises the id to Automatic, with the
       note that says the provider was removed. A refusal here would be a paper
       whose Models screen or job list threw because a provider went away.

  The lane is the repository's own runner, which is what CI runs:

    $env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION='1'
    $env:TEST_POSTGRES_ADMIN_URL='postgres://...@127.0.0.1:5432/postgres'
    node scripts/run-postgres-integration.mjs src/lib/news/xai-oauth-removal.postgres.test.ts

  Every case re-seeds the rows it reads, so the order below cannot matter.
*/

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL proof" };
const skip = probe.ok ? false : probe.reason;

const MIGRATION_112 = "0112_drop_xai_oauth_connections.sql";
const databaseName = `town_xai_removal_${process.pid}_${Date.now()}`;

const NEWSROOM = 7712;

let created = false;
let db: typeof import("../db.ts");

/** Every migration, in apply order, as scripts/migrate.mjs sends them. */
function migrationNames(): string[] {
  return readdirSync(resolve(process.cwd(), "migrations"))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
}

function migrationSql(name: string): string {
  return readFileSync(resolve(process.cwd(), "migrations", name), "utf8");
}

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
      created = true;
    } finally {
      await admin.end();
    }

    process.env.DATABASE_URL = new URL(withDatabase(adminUrl, databaseName)).toString();
    db = await import("../db.ts");
    const sql = await db.getSql();

    // Everything BEFORE this unit's migration: the state a live install is in
    // the moment before it upgrades.
    for (const name of migrationNames()) {
      if (name === MIGRATION_112) continue;
      await sql.query(migrationSql(name));
    }
    // A real SuperGrok sign-in, of the shape 0060 describes: an encrypted
    // credential, an account's discovered model ids and a selected model.
    await sql.query(
      `insert into newsrooms(id,name) values($1,'Grok removal proof') on conflict(id) do nothing`,
      [NEWSROOM],
    );
    await sql.query(
      `insert into xai_oauth_connections
         (newsroom_id, encrypted_credential, login_state, model_ids, selected_model_id, catalog_source)
       values ($1, 'v1:encrypted-supergrok-credential', 'connected', $2, 'grok-4.6', 'live')
       on conflict(newsroom_id) do update set encrypted_credential = excluded.encrypted_credential`,
      [NEWSROOM, JSON.stringify(["grok-4.6", "grok-4.5"])],
    );
  });

  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
        [databaseName],
      );
      await admin.query(`drop database ${databaseName}`);
    } finally {
      await admin.end();
    }
  });
}

/** Is that table there, according to the database itself? */
async function tableExists(name: string): Promise<boolean> {
  const sql = await db.getSql();
  const rows = await sql<{ present: boolean }>`
    select to_regclass(${name}) is not null as present
  `;
  return rows[0]!.present;
}

async function apply112(): Promise<void> {
  // The whole file at once, exactly as scripts/migrate.mjs sends it.
  const sql = await db.getSql();
  await sql.query(migrationSql(MIGRATION_112));
}

it("a database holding a SuperGrok sign-in migrates cleanly and the table is gone", { skip, timeout: 60_000 }, async () => {
  const sql = await db.getSql();
  assert.equal(
    await tableExists("xai_oauth_connections"),
    true,
    "0060 must have created the table, or this proof tests nothing",
  );
  const before = await sql<{ n: number }>`
    select count(*)::int as n from xai_oauth_connections where newsroom_id = ${NEWSROOM}
  `;
  assert.equal(before[0]!.n, 1, "the row this case migrates over must be present");

  // What a migration must not take with it: the newsroom itself, and the table
  // a saved Custom AI key lives in (a different feature, same server secret).
  assert.equal(await tableExists("newsrooms"), true);
  assert.equal(await tableExists("custom_ai_connections"), true);

  await apply112();

  assert.equal(
    await tableExists("xai_oauth_connections"),
    false,
    "the SuperGrok credential table must be gone",
  );
  assert.equal(await tableExists("newsrooms"), true, "the migration must touch nothing else");
  assert.equal(await tableExists("custom_ai_connections"), true);

  // Idempotent: a re-run (a retried promote, a second migrate) must not fail.
  await apply112();
  assert.equal(await tableExists("xai_oauth_connections"), false);
});

it("a newsroom whose stored choices hold grok-oauth still loads, as Automatic", { skip, timeout: 60_000 }, async () => {
  const sql = await db.getSql();
  const { readModelAssignments } = await import("./model-assignments-store.ts");
  const { resolveJobModel } = await import("./model-assignments.ts");
  const { effectiveStoryModelChoice, retiredModelChoiceNote, storyModelChoice } = await import(
    "./model-choice.ts"
  );
  const { providerEntry } = await import("./provider-registry.ts");

  // Two saved ranks: the retired id on the first choice, a live one behind it.
  // This is exactly what an install that chose Grok has on disk.
  await sql.query(
    `insert into model_assignments(newsroom_id, job_key, rank, provider_id, effort)
     values ($1,'story-draft',0,'grok-oauth','high'), ($1,'story-draft',1,'claude-sonnet',null)
     on conflict(newsroom_id, job_key, rank) do update set provider_id = excluded.provider_id`,
    [NEWSROOM],
  );

  const rows = await readModelAssignments(NEWSROOM);
  assert.deepEqual(
    rows.map((row) => `${row.jobKey}/${row.rank}/${row.providerId}`),
    ["story-draft/0/grok-oauth", "story-draft/1/claude-sonnet"],
    "the stored rows must load unchanged -- a retired provider is not a read error",
  );

  // Loading is half of it; RUNNING is the other. The retired id resolves to
  // nothing the registry knows, so the job falls to the desk's default and the
  // notice says why -- never to a transport that no longer exists.
  assert.equal(providerEntry("grok-oauth"), null, "the entry must be gone from the registry");
  const resolved = resolveJobModel({ jobKey: "story-draft", explicit: "grok-oauth" });
  assert.notEqual(resolved.providerId, "grok-oauth");
  assert.match(
    resolved.notice ?? "",
    /grok-oauth is not a model this job can use/,
    "the run must say why rather than silently switching",
  );
  assert.match(retiredModelChoiceNote("grok-oauth") ?? "", /has been removed/);

  // And a `desk_jobs.model_choice` holding it reads back as Automatic.
  await sql.query(
    `insert into desk_jobs(newsroom_id, user_id, kind, model_choice, status)
     values ($1,'xai-removal-proof','draft','grok-oauth','queued')`,
    [NEWSROOM],
  );
  const jobs = await sql<{ model_choice: string }>`
    select model_choice from desk_jobs where newsroom_id = ${NEWSROOM} order by id desc limit 1
  `;
  const stored = jobs[0]!.model_choice;
  assert.equal(stored, "grok-oauth", "the column must still hold what the old build wrote");
  assert.equal(storyModelChoice(stored), "auto");
  assert.equal(effectiveStoryModelChoice(stored), "auto");
});
