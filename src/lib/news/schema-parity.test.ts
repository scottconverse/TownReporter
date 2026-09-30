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
 * under Node and falls back to nothing but these functions), then diffs
 * every table the ensure side creates against the same table in the
 * migrations side: the column set, and then -- because a names-only check
 * passes while `text` becomes `varchar(10)`, a `not null` disappears, a
 * default changes or a unique index is dropped -- each column's
 * `format_type`, nullability and default, and every `pg_index` index and
 * `pg_constraint` constraint definition.
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
    const modelAssignments = await import("./model-assignments-store.ts");
    const editorialServer = await import("./editorial.server.ts");
    const followUps = await import("./follow-ups.ts");
    // Unit BS: draft_batches + desk_jobs' draft_batch_id. Its own index and
    // FK are mirrored in draft-batch.server.ts, so without this call the
    // parity check reported two differences that were really just this
    // fixture not asking for the table.
    const draftBatch = await import("./draft-batch.server.ts");
    const ops = await import("./ops.ts");
    const views = await import("./views.ts");
    const reading = await import("./reading.server.ts");
    const sections = await import("./sections.server.ts");
    const pageWatch = await import("./page-watch.ts");
    const routineNoticePolicy = await import("./routine-notice-policy.ts");
    const routineNoticeChecks = await import("./routine-notice-checks.server.ts");
    const routineNoticeAutomation = await import("./routine-notice-automation.ts");
    const db = await import("../db.ts");
    closePoolForTests = db.closePoolForTests;

    await membership.ensureNewsroomSchema();
    await membership.ensureInviteSchema();
    await paperSettings.ensurePaperSettingsSchema();
    await providerLoginServer.ensureProviderLoginsSchema();
    await providerSettings.ensureProviderSettingsSchema();
    // Unit BG: model_assignments, mirrored by migrations/0100_model_assignments.sql.
    await modelAssignments.ensureModelAssignmentsSchema();
    await jobs.ensureJobsSchema();
    await editorialServer.ensureEditorialSchema();
    await editorialServer.ensureEditorialRequestSchema();
    await dark.ensureDarkSchema(); // also calls ensureInvestigateSchema
    await investigate.ensureInvestigateSchema();
    await views.ensureViewsSchema();
    // Unit BM: read_hourly + trust_signals_hourly, mirrored by
    // migrations/0103_read_hourly.sql. Without this call the two tables would
    // be created on the migrations side only, and this test skips a table that
    // has no ensure* counterpart -- so the parity check would pass by looking
    // at nothing. Unit U17b added location_daily + visitor_daily to the same
    // statement list (mirrored by migrations/0109_stats_location.sql), which is
    // why this one call now covers four tables.
    await reading.ensureReadingSchema();
    await followUps.ensureFollowUpsSchema();
    await draftBatch.ensureDraftBatchSchema();
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
    await routineNoticeChecks.ensureRoutineNoticeCheckSchema();
    await routineNoticeAutomation.ensureRoutineNoticeAutomationSchema();
    const routineCheckGuards = await sectionSql<{ tgname: string }>`
      select tgname from pg_trigger
      where tgname='routine_notice_checks_legal_guard' and tgenabled <> 'D'
    `;
    assert.equal(routineCheckGuards.length, 1, "runtime routine-check legal guard must exist");
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
    const [routineSource]=await sectionSql<{id:number}>`insert into sources(user_id,newsroom_id,url,title,status)
      values ('pg-legal-other',8811,'/articles/routine-removed','Routine source','accepted') returning id`;
    await sectionSql`insert into legal_removals(id,newsroom_id,requested_by,case_ref,policy)
      values ('routine-check-legal-proof',8811,'pg-legal-other','ROUTINE-CHECK-PROOF','destroy')`;
    await sectionSql`insert into legal_removal_urls(newsroom_id,url_hash,case_id)
      values (8811,md5(legal_article_url_identity('/articles/routine-removed')),'routine-check-legal-proof')`;
    await assert.rejects(sectionSql`insert into routine_notice_checks
      (newsroom_id,request_id,source_id,source_url_hash,format_key,policy_revision,adapter_key,adapter_version,state,actor)
      values (8811,'00000000-0000-4000-8000-000000000881',${routineSource.id},'proof','library-notice',1,
        'schema-event-jsonld',1,'capture-failed','pg-legal-other')`,/legal removal/);
  }, { timeout: 60_000 });

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
  }, { timeout: 30_000 });
}

/** One column's comparable attributes, as Postgres itself renders them. */
type ColumnShape = {
  /** `format_type(atttypid, atttypmod)`, so `text` and `character varying(10)` differ. */
  type: string;
  notNull: boolean;
  /** `pg_get_expr(adbin, adrelid)`, or null when the column has no default. */
  default: string | null;
};

/**
 * One base table's comparable shape: every column's type/nullability/default,
 * plus every index and constraint definition, each keyed by name.
 *
 * Both sides are built by `create table if not exists` DDL written column for
 * column, so identical DDL yields identical auto-generated names
 * (`follow_ups_pkey`, `follow_ups_newsroom_status_due`) and identical
 * `pg_get_indexdef`/`pg_get_constraintdef` text -- the definitions carry the
 * `public` schema name but never the database name, so the two scratch
 * databases are directly comparable. Keying by name rather than by definition
 * is deliberate: a renamed-but-equivalent index is still a difference an
 * operator would see between an installed and a runtime-created database.
 */
type TableShape = {
  columns: Map<string, ColumnShape>;
  features: Map<string, string>;
};

/**
 * Every base table in the public schema -> its {@link TableShape}.
 *
 * `pg_attribute`/`pg_attrdef`/`pg_index`/`pg_constraint` rather than
 * `information_schema`: the catalogs are privileged-complete (nothing is
 * hidden by a grant) and they are the only place `attnotnull` and
 * `pg_get_indexdef` are exposed.
 */
async function tableShapes(url: string): Promise<Map<string, TableShape>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const columns = await c.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      not_null: boolean;
      column_default: string | null;
    }>(`
      select c.relname as table_name,
             a.attname as column_name,
             format_type(a.atttypid, a.atttypmod) as data_type,
             a.attnotnull as not_null,
             pg_get_expr(d.adbin, d.adrelid) as column_default
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and a.attnum > 0
        and not a.attisdropped
      order by c.relname, a.attname
    `);
    // Standalone indexes unioned with constraint definitions. The
    // `conindid` exclusion matters: a primary/unique constraint owns an
    // index of the same name, so without it the same name would come back
    // twice -- once as `CREATE UNIQUE INDEX ...` and once as
    // `PRIMARY KEY (...)` -- and the map would keep whichever row happened
    // to sort last, which is not a stable property. Each name therefore
    // yields exactly one row, and `create unique index` (which is not a
    // constraint) is still covered because it has no `pg_constraint` row.
    // `contype = 'n'` is skipped: not-null is already compared per column.
    const features = await c.query<{
      table_name: string;
      feature_name: string;
      definition: string;
    }>(`
      select c.relname as table_name,
             i.relname as feature_name,
             pg_get_indexdef(x.indexrelid) as definition
      from pg_index x
      join pg_class c on c.oid = x.indrelid
      join pg_class i on i.oid = x.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_constraint con where con.conindid = x.indexrelid)
      union all
      select c.relname as table_name,
             con.conname as feature_name,
             pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and con.contype in ('p', 'u', 'f', 'c')
      order by table_name, feature_name
    `);

    const map = new Map<string, TableShape>();
    const shape = (table: string): TableShape => {
      let found = map.get(table);
      if (!found) {
        found = { columns: new Map(), features: new Map() };
        map.set(table, found);
      }
      return found;
    };
    for (const row of columns.rows) {
      shape(row.table_name).columns.set(row.column_name, {
        type: row.data_type,
        notNull: row.not_null,
        default: row.column_default,
      });
    }
    for (const row of features.rows) {
      shape(row.table_name).features.set(row.feature_name, row.definition);
    }
    return map;
  } finally {
    await c.end();
  }
}

/** `null` reads as an absence, not as the string "null", in a failure message. */
function describeDefault(value: string | null): string {
  return value ?? "(no default)";
}

/**
 * Column-level and index/constraint-level differences for one table that
 * exists on both sides. Column-name differences are reported by the caller
 * (which owns the "missing from migrations" wording); this handles the
 * attributes a names-only comparison cannot see.
 */
function diffTableShape(
  table: string,
  migrations: TableShape,
  ensure: TableShape,
  mismatches: string[],
): void {
  for (const [column, left] of migrations.columns) {
    const right = ensure.columns.get(column);
    if (!right) continue; // a column-set mismatch, reported by the caller
    if (left.type !== right.type) {
      mismatches.push(
        `${table}.${column}: type differs -- migrations ${left.type}, ensure ${right.type}`,
      );
    }
    if (left.notNull !== right.notNull) {
      mismatches.push(
        `${table}.${column}: nullability differs -- migrations ` +
          `${left.notNull ? "not null" : "nullable"}, ensure ` +
          `${right.notNull ? "not null" : "nullable"}`,
      );
    }
    if (left.default !== right.default) {
      mismatches.push(
        `${table}.${column}: default differs -- migrations ${describeDefault(left.default)}, ` +
          `ensure ${describeDefault(right.default)}`,
      );
    }
  }

  for (const name of new Set([...migrations.features.keys(), ...ensure.features.keys()])) {
    const left = migrations.features.get(name);
    const right = ensure.features.get(name);
    if (left === right) continue;
    if (left === undefined) {
      mismatches.push(`${table}: index/constraint "${name}" exists only in ensure -- ${right}`);
    } else if (right === undefined) {
      mismatches.push(`${table}: index/constraint "${name}" exists only in migrations -- ${left}`);
    } else {
      mismatches.push(
        `${table}: index/constraint "${name}" definition differs -- migrations ${left}, ` +
          `ensure ${right}`,
      );
    }
  }
}

const INTERNAL_TABLES = new Set(["_migrations", "_schema_ensure_state"]);

describe("every runtime ensure* schema agrees with migrations/*.sql (ENG-03 capstone)", () => {
  it(
    "the column sets, column types/nullability/defaults and index/constraint definitions match, table by table",
    { skip },
    async () => {
      const migrationsShapes = await tableShapes(withDatabase(PSQL_ADMIN_URL, migrationsDbName));
      const ensureShapes = await tableShapes(withDatabase(PSQL_ADMIN_URL, ensureDbName));

      const allTables = new Set([...migrationsShapes.keys(), ...ensureShapes.keys()]);
      const mismatches: string[] = [];

      for (const table of allTables) {
        if (INTERNAL_TABLES.has(table)) continue;
        if (ALLOWLIST[table]) continue;

        const inMigrations = migrationsShapes.get(table);
        const inEnsure = ensureShapes.get(table);

        if (!inMigrations) {
          mismatches.push(
            `${table}: created by an ensure* function but has no migration at all ` +
              `(columns: ${[...(inEnsure?.columns.keys() ?? [])].join(", ")}) -- add a migration, ` +
              `or add it to ALLOWLIST with a reason`,
          );
          continue;
        }
        if (!inEnsure) {
          // A table migrations define but no ensure* function ever creates is
          // only a drift risk if some OTHER ensure* function tries to ALTER
          // it (which would have thrown above, during setup) -- it did not
          // throw, so this table is simply untouched by the ensure side, the
          // same as the allowlisted migrations-only tables. Not a mismatch.
          //
          // Note the blind spot this leaves, found while mirroring the
          // migrations: several whole subsystems (meeting_*, article_body_
          // history) are migrations-only and deliberately unallowlisted, so
          // "not in the ensure database" cannot be read as "not mirrored" --
          // which also means a `create table` that silently stops parsing on
          // the ensure side (ensureSchemaOnce swallows the throw) looks
          // exactly like a table that was never meant to be mirrored there.
          continue;
        }

        const onlyInMigrations = [...inMigrations.columns.keys()].filter(
          (c) => !inEnsure.columns.has(c),
        );
        const onlyInEnsure = [...inEnsure.columns.keys()].filter(
          (c) => !inMigrations.columns.has(c),
        );
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

        // Types, nullability, defaults, and every index/constraint definition.
        // A column-set match alone is not parity: `text` vs `varchar(10)`,
        // `not null` vs nullable, a lost default and a dropped unique index
        // all leave the names identical.
        diffTableShape(table, inMigrations, inEnsure, mismatches);
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

/*
  Unit U17b: the one Stats table with a finite life is pruned on the same real
  Postgres the parity check above builds, because the retention rule is SQL --
  `current_date - make_interval(months => 12)` -- and a PGlite run would not
  prove the interval arithmetic a deployed database actually performs.
*/
it('the stats place prune keeps twelve months on a real Postgres and takes nothing else', {skip,timeout:30000}, async()=>{
  const {getSql}=await import('../db.ts');
  const reading=await import('./reading.server.ts');
  await reading.ensureReadingSchema();
  const sql=await getSql();
  const newsroomId=8899;
  await sql`delete from location_daily where newsroom_id = ${newsroomId}`;
  try {
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits) values
        (${newsroomId}, current_date, 'US', 'Longmont', 5),
        (${newsroomId}, current_date - 400, 'US', 'Lyons', 5),
        (${newsroomId}, current_date - 364, 'US', 'Berthoud', 5)
    `;
    const removed=await reading.pruneLocationDaily();
    assert.equal(removed,1,'exactly the row past twelve months');
    const left=await sql<{city:string}>`
      select city from location_daily where newsroom_id = ${newsroomId} order by city
    `;
    assert.deepEqual(left.map((row)=>row.city),['Berthoud','Longmont'],'the boundary itself is kept');
    assert.equal(await reading.pruneLocationDaily(),0,'and it is idempotent');
  } finally {
    await sql`delete from location_daily where newsroom_id = ${newsroomId}`;
  }
});
