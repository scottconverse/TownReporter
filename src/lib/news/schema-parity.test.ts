import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  withDatabase,
} from "../test-support/pg-admin.ts";

/**
 * GauntletGate ENG-03: migration/ensure drift runs in both directions, and
 * only 4 of 10 `ensure*` functions had a parity test before this one. This
 * is the generalised test the finding asked for -- it builds one database
 * from `migrations/*.sql` alone (`scripts/migrate.mjs`, the deploy path) and
 * a second from the hand-mirrored runtime `ensure*` functions alone (the
 * path a plain `node --test` run and a rebuilt PGLite instance actually take
 * -- see `src/lib/db.ts`'s `createPgliteSql`, whose migration glob throws
 * under Node and falls back to nothing but these functions), then diffs the
 * column set of every table the ensure side creates against the same table
 * in the migrations side.
 *
 * A table that ONLY migrations define (never mirrored by any `ensure*`
 * function -- `leads`, `drafts`, `snapshots`, `sources`, `scan_runs`,
 * `articles`, `beat_memory`, `corrections`: see the allowlist below) is not
 * a drift case. There is nothing to compare: those tables are reached only
 * through a real migration replay (Vite's PGLite glob, or `db:migrate`
 * against Postgres), never through hand-mirrored DDL, so their "runtime"
 * column set and their migration column set are the same code path by
 * construction. Test files that need one of them under plain `node --test`
 * (where the migration glob is unavailable) each define their own scratch
 * table inline for exactly this reason -- grep `create table if not exists
 * leads` across `src/lib/news/*.test.ts`.
 * Sections/watch additionally require core tables in this parity fixture, so
 * their dependencies replay 0002 and its 0005 ops extension. These dependencies
 * still participate in the existing comparison; no column mismatch is waived.
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` -- see pg-admin.ts); skips
 * with a reason otherwise. Named in the `postgres-integration` CI job in
 * `.github/workflows/ci.yml`.
 */

const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const suffix = `${process.pid}_${Date.now()}`;
const migrationsDbName = `townreporter_test_parity_migrations_${suffix}`;
const ensureDbName = `townreporter_test_parity_ensure_${suffix}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (it builds two real scratch databases; " +
        "the postgres-integration CI job runs it on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
// Sections/watch require migrations-owned core tables. Replay their ops extension
// too: 0002 also creates subscribers, whose confirmation fields arrive in 0005.
// Neither subscriber table nor columns have a runtime ensure counterpart.
const CORE_DEPENDENCY_MIGRATIONS = ["0002_newsroom.sql", "0005_ops.sql"];

it("parity dependency fixtures include subscriber confirmation fields", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const fixture = new PGlite();
  try {
    for (const file of CORE_DEPENDENCY_MIGRATIONS) {
      await fixture.exec(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"));
    }
    const result = await fixture.query<{ status: string; confirm_token: string | null }>(
      "insert into subscribers(email) values ('parity@example.test') returning status, confirm_token",
    );
    assert.deepEqual(result.rows, [{ status: "pending", confirm_token: null }]);
  } finally {
    await fixture.close();
  }
});

/**
 * Tables with a documented, intentional gap on one side. Every entry needs a
 * reason -- this is the "small explicit allowlist for any genuinely
 * intentional exception" GauntletGate ENG-03 asked for, not a place to hide
 * an unreviewed mismatch.
 *
 * `columnsOnlyIn` names the side (`"migrations"` or `"ensure"`) where extra
 * columns are expected and why. Leave it undefined to allow the table's
 * entire presence on one side only (no counterpart at all).
 */
const ALLOWLIST: Record<string, { reason: string }> = {
  // No runtime ensure* function ever creates these -- see the file docstring.
  // They exist in the ensure-only database not at all (not even the base
  // table), so they are skipped rather than diffed.
  leads: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  drafts: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  snapshots: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  sources: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  scan_runs: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  articles: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  beat_memory: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  corrections: { reason: "migrations-only table; no ensure* counterpart (see file docstring)" },
  // Better Auth's own tables (migrations/0001_auth.sql, applied only when an
  // app turns sign-in on) have no ensure* mirror; out of scope for this desk
  // schema check.
  user: { reason: "Better Auth table, not part of the desk schema this test covers" },
  session: { reason: "Better Auth table, not part of the desk schema this test covers" },
  account: { reason: "Better Auth table, not part of the desk schema this test covers" },
  verification: { reason: "Better Auth table, not part of the desk schema this test covers" },
};

let closePoolForTests: () => Promise<void>;

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${migrationsDbName}`);
    await admin.query(`CREATE DATABASE ${ensureDbName}`);
    await admin.end();

    // Side A: migrations/*.sql alone, via the real deploy applier.
    const migrationsDbUrl = withDatabase(PSQL_ADMIN_URL, migrationsDbName);
    await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
      ...process.env,
      DATABASE_URL: migrationsDbUrl,
    });

    // Side B: every runtime ensure* function, alone, against a bare database.
    // Set BEFORE importing anything that touches ../db.ts -- it reads
    // DATABASE_URL the moment it is first evaluated (see
    // dark-schema-rebuild.test.ts for the same constraint).
    const ensureDbUrl = withDatabase(PSQL_ADMIN_URL, ensureDbName);
    process.env.DATABASE_URL = ensureDbUrl;
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";

    const dark = await import("./dark.ts");
    const investigate = await import("./investigate.ts");
    const jobs = await import("./jobs.ts");
    const membership = await import("./membership.ts");
    const paperSettings = await import("./paper-settings.ts");
    const providerLoginServer = await import("./provider-login.server.ts");
    const providerSettings = await import("./provider-settings.ts");
    const editorialServer = await import("./editorial.server.ts");
    const followUps = await import("./follow-ups.ts");
    const ops = await import("./ops.ts");
    const views = await import("./views.ts");
    const sections = await import("./sections.server.ts");
    const pageWatch = await import("./page-watch.ts");
    const routineNoticePolicy = await import("./routine-notice-policy.ts");
    const db = await import("../db.ts");
    closePoolForTests = db.closePoolForTests;

    await membership.ensureNewsroomSchema();
    await membership.ensureInviteSchema();
    await paperSettings.ensurePaperSettingsSchema();
    await providerLoginServer.ensureProviderLoginsSchema();
    await providerSettings.ensureProviderSettingsSchema();
    await jobs.ensureJobsSchema();
    await editorialServer.ensureEditorialSchema();
    await editorialServer.ensureEditorialRequestSchema();
    await dark.ensureDarkSchema(); // also calls ensureInvestigateSchema
    await investigate.ensureInvestigateSchema();
    await views.ensureViewsSchema();
    await followUps.ensureFollowUpsSchema();
    // Sections depend on the actual migrations-owned newsroom tables, not a
    // sources(id) stand-in: verify the snapshot column and all filing triggers.
    const sectionSql = await db.getSql();
    for (const file of CORE_DEPENDENCY_MIGRATIONS) {
      await sectionSql.query(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"));
    }
    for (const table of ["sources", "snapshots", "leads", "drafts", "articles", "scan_runs", "beat_memory", "corrections"]) {
      await sectionSql.query(`alter table ${table} add column if not exists newsroom_id integer not null default 1`);
    }
    await sectionSql.query('alter table snapshots add column if not exists url text');
    await sectionSql.query(await readFile(new URL("../../../migrations/0016_trash.sql",import.meta.url),"utf8"));
    await sections.ensureSectionsSchema();
    await pageWatch.ensurePageWatchSchema();
    await routineNoticePolicy.ensureRoutineNoticePolicySchema();
    const sectionTriggers = await sectionSql<{ tgname: string }>`
      select tgname from pg_trigger where tgname in
        ('leads_resolve_section','drafts_resolve_section','articles_resolve_section') and tgenabled <> 'D'
    `;
    assert.equal(sectionTriggers.length, 3, "all runtime filing guards must exist");
    const snapshotColumn = await sectionSql`select column_name from information_schema.columns
      where table_schema='public' and table_name='scan_runs' and column_name='section_snapshot'`;
    assert.equal(snapshotColumn.length, 1, "queued scans must store their section snapshot");
    const ownSections = await sections.getSections(8801);
    const foreignSections = await sections.getSections(8802);
    await sections.saveSections(8801, {
      ...ownSections,
      sections: ownSections.sections.map((section) => section.key === "budget"
        ? { ...section, replacementKey: "council" } : section),
    });
    const [filed] = await sectionSql<{ topic: string }>`insert into leads
      (user_id,newsroom_id,headline,why,topic) values ('pg-section-proof',8801,'Example','Reason','budget') returning topic`;
    assert.equal(filed.topic, "council", "real Postgres resolves a retired key on filing");
    await assert.rejects(sectionSql`insert into leads
      (user_id,newsroom_id,headline,why,topic) values ('pg-section-proof',8801,'Example','Reason','unknown-section')`,
      /Section not found in this newsroom/);
    const [foreignFiled] = await sectionSql<{ topic: string }>`insert into leads
      (user_id,newsroom_id,headline,why,topic) values ('pg-section-proof',8802,'Example','Reason','budget') returning topic`;
    assert.equal(foreignFiled.topic, "budget", "another newsroom keeps its own active section");
    assert.deepEqual(await sections.getSections(8802), foreignSections);
    // desk_rate / audit_events: no ensure*Schema name, but the same
    // create-table-if-not-exists-on-every-call shape (ENG-09) -- a real call
    // each creates the table.
    await ops.assertRate("schema-parity-smoke-user", "scan");
    await ops.audit("schema-parity-smoke-user", "smoke", "schema-parity test");
    const legalSchema=await import("./legal-removal-schema.ts");
    const legal=await import("./legal-removal-store.ts");
    await legalSchema.ensureLegalSchema();
    await sectionSql`insert into newsroom_members(user_id,newsroom_id,role) values ('pg-legal-owner',8810,'owner')`;
    const [legalArticle]=await sectionSql<{id:number}>`insert into articles(user_id,newsroom_id,slug,headline,body,topic)
      values ('pg-legal-owner',8810,'pg-legal-proof','Private test title','Private test body','council') returning id`;
    const legalSelection={articleIds:[legalArticle.id],draftIds:[],memoryIds:[],auditIds:[],trashIds:[],reviewedLegacy:true,reviewedEvidence:true};
    const legalPreview=await legal.previewLegalRemoval('pg-legal-owner',legalSelection);
    const removal=await legal.removeLegally('pg-legal-owner',{selection:legalSelection,fingerprint:legalPreview.fingerprint,policy:'destroy',caseRef:'PG-LEGAL-PROOF'});
    assert.deepEqual(await sectionSql`select case_id from legal_removal_copies where case_id=${removal.caseId}`,[]);
    await assert.rejects(sectionSql`insert into articles(user_id,newsroom_id,slug,headline,body,topic)
      values ('pg-legal-owner',8810,'pg-legal-proof','Stale output','Stale text','council')`,/legal removal/);
    await sectionSql`insert into articles(user_id,newsroom_id,slug,headline,body,topic)
      values ('pg-legal-other',8811,'pg-legal-proof','Independent paper','Independent text','council')`;
    await assert.rejects(sectionSql`insert into artifact_versions(user_id,newsroom_id,url,content_hash,full_text)
      values ('pg-legal-owner',8810,'/articles/pg-legal-proof','stale-proof','Stale text')`,/legal removal/);
  }, 60_000);

  after(async () => {
    await closePoolForTests?.();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    for (const name of [migrationsDbName, ensureDbName]) {
      await admin
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        )
        .catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    }
    await admin.end();
  }, 30_000);
}

/** table -> sorted column names, for every base table in the public schema. */
async function tableColumns(url: string): Promise<Map<string, string[]>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = await c.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, column_name
    `);
    const map = new Map<string, string[]>();
    for (const row of rows.rows) {
      const cols = map.get(row.table_name) ?? [];
      cols.push(row.column_name);
      map.set(row.table_name, cols);
    }
    return map;
  } finally {
    await c.end();
  }
}

const INTERNAL_TABLES = new Set(["_migrations", "_schema_ensure_state"]);

describe("every runtime ensure* schema agrees with migrations/*.sql (ENG-03 capstone)", () => {
  it(
    "the ensure-only column set and the migrations-only column set match, table by table",
    { skip },
    async () => {
      const migrationsCols = await tableColumns(withDatabase(PSQL_ADMIN_URL, migrationsDbName));
      const ensureCols = await tableColumns(withDatabase(PSQL_ADMIN_URL, ensureDbName));

      const allTables = new Set([...migrationsCols.keys(), ...ensureCols.keys()]);
      const mismatches: string[] = [];

      for (const table of allTables) {
        if (INTERNAL_TABLES.has(table)) continue;
        if (ALLOWLIST[table]) continue;

        const inMigrations = migrationsCols.get(table);
        const inEnsure = ensureCols.get(table);

        if (!inMigrations) {
          mismatches.push(
            `${table}: created by an ensure* function but has no migration at all ` +
              `(columns: ${inEnsure?.join(", ")}) -- add a migration, or add it to ALLOWLIST with a reason`,
          );
          continue;
        }
        if (!inEnsure) {
          // A table migrations define but no ensure* function ever creates is
          // only a drift risk if some OTHER ensure* function tries to ALTER
          // it (which would have thrown above, during setup) -- it did not
          // throw, so this table is simply untouched by the ensure side, the
          // same as the allowlisted migrations-only tables. Not a mismatch.
          continue;
        }

        const onlyInMigrations = inMigrations.filter((c) => !inEnsure.includes(c));
        const onlyInEnsure = inEnsure.filter((c) => !inMigrations.includes(c));
        if (onlyInMigrations.length || onlyInEnsure.length) {
          mismatches.push(
            `${table}: ` +
              (onlyInMigrations.length
                ? `in migrations, missing from ensure: [${onlyInMigrations.join(", ")}]. `
                : "") +
              (onlyInEnsure.length
                ? `in ensure, missing from migrations: [${onlyInEnsure.join(", ")}].`
                : ""),
          );
        }
      }

      assert.deepEqual(
        mismatches,
        [],
        `schema drift between migrations/*.sql and the runtime ensure* functions:\n` +
          mismatches.join("\n"),
      );
    },
  );
});

it('legal parent locks prevent a foreign FK insert racing the removal scope check', {skip,timeout:20000}, async()=>{
  const {getSql}=await import('../db.ts');const sql=await getSql();
  const legal=await import('./legal-removal-store.ts');
  await sql`insert into newsroom_members(user_id,newsroom_id,role) values ('pg-legal-race',8890,'owner')`;
  const [lead]=await sql<{id:number}>`insert into leads(user_id,newsroom_id,headline,why,topic) values('pg-legal-race',8890,'Race test','Test','council') returning id`;
  const [article]=await sql<{id:number}>`insert into articles(user_id,newsroom_id,lead_id,slug,headline,body,topic) values('pg-legal-race',8890,${lead.id},'pg-legal-race','Race test','Test','council') returning id`;
  const selection={articleIds:[article.id],draftIds:[],memoryIds:[],auditIds:[],trashIds:[],reviewedLegacy:true,reviewedEvidence:true};
  const preview=await legal.previewLegalRemoval('pg-legal-race',selection);
  const blocker=new Client({connectionString:withDatabase(PSQL_ADMIN_URL,ensureDbName)});
  const foreign=new Client({connectionString:withDatabase(PSQL_ADMIN_URL,ensureDbName)});
  await blocker.connect();await foreign.connect();
  let removal:Promise<unknown>|undefined;let insert:Promise<{ok:boolean;error?:unknown}>|undefined;
  async function waitForBlocked(pid?:number) {
    const until=Date.now()+5000;
    while(Date.now()<until) {
      const found=await blocker.query<{waiting:boolean}>(pid
        ?'select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting'
        :"select exists(select 1 from pg_locks where locktype='advisory' and objid=889001 and not granted) as waiting",pid?[pid]:[]);
      if(found.rows[0].waiting)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Expected competing transaction never reached the database lock');
  }
  try {
    await blocker.query('select pg_advisory_lock(889001)');
    await sql.query("create function test_pause_legal_delete() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(889001); return OLD; end $$");
    await sql.query('create trigger test_pause_legal_delete before delete on articles for each row execute function test_pause_legal_delete()');
    removal=legal.removeLegally('pg-legal-race',{selection,fingerprint:preview.fingerprint,policy:'destroy',caseRef:'PG-RACE'});
    await waitForBlocked();
    const pid=(await foreign.query<{pid:number}>('select pg_backend_pid() as pid')).rows[0].pid;
    insert=foreign.query("insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic) values('other-room',8891,$1,'Foreign','Must survive or refuse','council')",[lead.id]).then(()=>({ok:true}),error=>({ok:false,error}));
    await waitForBlocked(pid);
    await blocker.query('select pg_advisory_unlock(889001)');
    await removal;
    const outcome=await insert;assert.equal(outcome.ok,false,'foreign insert cannot slip between scope inspection and cascade');
    assert.match(String(outcome.error),/foreign key constraint/);
    assert.deepEqual(await sql`select id from drafts where newsroom_id=8891`,[]);
  } finally {
    await blocker.query('select pg_advisory_unlock(889001)');
    await removal?.catch(()=>undefined);await insert;
    await sql.query('drop trigger if exists test_pause_legal_delete on articles');
    await blocker.end();await foreign.end();
  }
});
