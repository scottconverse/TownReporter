import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  withDatabase,
} from "../test-support/pg-admin.ts";
import { KIND_BUDGETS, effectiveBudget } from "./provider-registry.ts";
import { cleanProviderTimeInput as pureCleanProviderTimeInput } from "./provider-settings.ts";

/**
 * QA-2 (2026-09-02): a pure unit test on `cleanProviderTimeInput`'s
 * `invalid` field -- no database needed, so it runs even without
 * TEST_POSTGRES_ADMIN_URL set. The DB-backed refusal (saveProviderTime
 * actually rejecting the request rather than resetting the row) is proven
 * below, next to the existing 9s/3601s/-5s range tests.
 */
describe("cleanProviderTimeInput distinguishes Reset from garbage", () => {
  it("marks omitted or explicit null as NOT invalid -- that is what Reset sends", () => {
    assert.equal(pureCleanProviderTimeInput({ providerId: "x" }).invalid, false);
    assert.equal(pureCleanProviderTimeInput({ providerId: "x", callSeconds: null }).invalid, false);
    assert.equal(pureCleanProviderTimeInput({ providerId: "x", callSeconds: null }).callSeconds, null);
  });

  it("marks a present-but-non-finite callSeconds as invalid, still surfacing null so a caller cannot mistake it for a real number", () => {
    for (const bad of [NaN, Infinity, -Infinity, "not-a-number", {}, [], true]) {
      const cleaned = pureCleanProviderTimeInput({ providerId: "x", callSeconds: bad as never });
      assert.equal(cleaned.invalid, true, `${String(bad)} must be marked invalid`);
      assert.equal(cleaned.callSeconds, null);
    }
  });

  it("leaves a real finite number alone, rounded, and not invalid", () => {
    assert.deepEqual(pureCleanProviderTimeInput({ providerId: "x", callSeconds: 90.4 }), {
      providerId: "x",
      callSeconds: 90,
      invalid: false,
    });
  });
});

/**
 * The per-paper time budgets, on a real Postgres (0.6.2).
 *
 * The operator's rule for this release: "timeouts are likely too short for
 * local models -- give the editor the option to make them longer or shorter in
 * the interface." That answer is a row in `provider_settings`, created by
 * migrations/0029_provider_settings.sql and mirrored for the PGLite path by
 * `ensureProviderSettingsSchema()`.
 *
 * Two schemas describing one table is exactly the kind of pair that drifts,
 * and the unit tests only ever see the PGLite one. This test runs the REAL
 * migration against a real Postgres and then round-trips a saved number back
 * out through `readProviderOverrides` and `effectiveBudget` -- so a column
 * that exists in the ensure-function and not in the migration (or a type that
 * PGLite tolerates and Postgres does not) fails here rather than on the
 * operator's machine the first time someone changes a timeout.
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` -- see pg-admin.ts); skips
 * with a reason otherwise. Named in the `postgres-integration` CI job in
 * `.github/workflows/ci.yml`, enforced by
 * `scripts/postgres-tests-are-covered.test.mjs`.
 */

const PSQL_ADMIN_URL = resolveAdminUrl();
const dbName = `townreporter_test_providersettings_${process.pid}_${Date.now()}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (real Postgres; the postgres-integration " +
        "CI job runs it on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let readProviderOverrides: typeof import("./provider-settings.ts").readProviderOverrides;
let providerTimeSettings: typeof import("./provider-settings.ts").providerTimeSettings;
let saveProviderTime: typeof import("./provider-settings.ts").saveProviderTime;
let cleanProviderTimeInput: typeof import("./provider-settings.ts").cleanProviderTimeInput;
let ensureNewsroomSchema: typeof import("./membership.ts").ensureNewsroomSchema;
let getSql: typeof import("../db.ts").getSql;
let closePoolForTests: typeof import("../db.ts").closePoolForTests;

const NEWSROOM_ID = 1;
const OWNER_ID = "provider-settings-owner";

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    // Set BEFORE importing anything that touches ../db.ts -- it reads
    // DATABASE_URL the moment it is first evaluated and would otherwise fall
    // back to PGLite.
    process.env.DATABASE_URL = dbUrl;
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";

    await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });

    const mod = await import("./provider-settings.ts");
    const db = await import("../db.ts");
    const membership = await import("./membership.ts");
    readProviderOverrides = mod.readProviderOverrides;
    providerTimeSettings = mod.providerTimeSettings;
    saveProviderTime = mod.saveProviderTime;
    cleanProviderTimeInput = mod.cleanProviderTimeInput;
    ensureNewsroomSchema = membership.ensureNewsroomSchema;
    getSql = db.getSql;
    closePoolForTests = db.closePoolForTests;

    await ensureNewsroomSchema();
    const sql = await getSql();
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${OWNER_ID}, 'owner', ${NEWSROOM_ID})
      on conflict (user_id) do update set role = 'owner', newsroom_id = ${NEWSROOM_ID}
    `;
  }, 60_000);

  after(async () => {
    await closePoolForTests?.();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      )
      .catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }, 30_000);
}

describe("provider_settings round-trips on a real Postgres", { skip }, () => {
  it("starts with the shipped defaults and no rows at all", async () => {
    assert.deepEqual(await readProviderOverrides(NEWSROOM_ID), {});
    const rows = await providerTimeSettings(NEWSROOM_ID);
    const codex = rows.find((row) => row.providerId === "codex-balanced")!;
    assert.equal(codex.callSeconds, KIND_BUDGETS.codex.callMs / 1000);
    assert.equal(codex.defaultCallSeconds, KIND_BUDGETS.codex.callMs / 1000);
    assert.equal(codex.overridden, false);
  });

  it("stores a per-call ceiling and reads it back as the effective budget", async () => {
    const sql = await getSql();
    await sql`
      insert into provider_settings (newsroom_id, provider_id, call_ms)
      values (${NEWSROOM_ID}, ${"claude-frontier"}, ${420_000})
      on conflict (newsroom_id, provider_id) do update set call_ms = excluded.call_ms
    `;

    const overrides = await readProviderOverrides(NEWSROOM_ID);
    assert.equal(overrides["claude-frontier"]?.callMs, 420_000);
    assert.equal(effectiveBudget("claude-frontier", overrides).callMs, 420_000);
    // The reserve is not an editor-facing number and stays as shipped.
    assert.equal(
      effectiveBudget("claude-frontier", overrides).reserveMs,
      KIND_BUDGETS["claude-code"].reserveMs,
    );
    // Untouched providers keep theirs.
    assert.equal(effectiveBudget("codex-balanced", overrides).callMs, KIND_BUDGETS.codex.callMs);

    const rows = await providerTimeSettings(NEWSROOM_ID);
    const claude = rows.find((row) => row.providerId === "claude-frontier")!;
    assert.equal(claude.callSeconds, 420);
    assert.equal(claude.defaultCallSeconds, KIND_BUDGETS["claude-code"].callMs / 1000);
    assert.equal(claude.overridden, true);
  });

  it("upserts on (newsroom_id, provider_id) rather than growing a second row", async () => {
    const sql = await getSql();
    await sql`
      insert into provider_settings (newsroom_id, provider_id, call_ms)
      values (${NEWSROOM_ID}, ${"claude-frontier"}, ${300_000})
      on conflict (newsroom_id, provider_id) do update
        set call_ms = excluded.call_ms, updated_at = now()
    `;
    const rows = await sql<{ n: string }>`
      select count(*)::text as n from provider_settings
      where newsroom_id = ${NEWSROOM_ID} and provider_id = ${"claude-frontier"}
    `;
    assert.equal(rows[0]!.n, "1", "the unique constraint from the migration is missing");
    const overrides = await readProviderOverrides(NEWSROOM_ID);
    assert.equal(overrides["claude-frontier"]?.callMs, 300_000);
  });

  it("treats Reset -- a null column -- as 'use the shipped default'", async () => {
    /*
      Reset clears the stored number rather than writing today's default into
      the row, so a paper that never made a decision keeps inheriting
      improvements to the defaults.
    */
    const sql = await getSql();
    await sql`
      update provider_settings set call_ms = null
      where newsroom_id = ${NEWSROOM_ID} and provider_id = ${"claude-frontier"}
    `;
    const overrides = await readProviderOverrides(NEWSROOM_ID);
    assert.equal(overrides["claude-frontier"]?.callMs, null);
    assert.equal(
      effectiveBudget("claude-frontier", overrides).callMs,
      KIND_BUDGETS["claude-code"].callMs,
    );
    const rows = await providerTimeSettings(NEWSROOM_ID);
    assert.equal(rows.find((row) => row.providerId === "claude-frontier")!.overridden, false);
  });

  it("drops a row for a provider the registry no longer knows about", async () => {
    // A retired provider's stored timeout must not resurface as a budget for
    // whatever id happens to be reused later.
    const sql = await getSql();
    await sql`
      insert into provider_settings (newsroom_id, provider_id, call_ms)
      values (${NEWSROOM_ID}, ${"zen-mimo"}, ${999_000})
      on conflict (newsroom_id, provider_id) do nothing
    `;
    const overrides = await readProviderOverrides(NEWSROOM_ID);
    assert.ok(!("zen-mimo" in overrides));
  });

  it("keeps one paper's answer out of another's", async () => {
    const sql = await getSql();
    await sql`
      insert into provider_settings (newsroom_id, provider_id, call_ms)
      values (${2}, ${"codex-balanced"}, ${600_000})
      on conflict (newsroom_id, provider_id) do update set call_ms = excluded.call_ms
    `;
    const mine = await readProviderOverrides(NEWSROOM_ID);
    assert.ok(!mine["codex-balanced"]?.callMs);
    const theirs = await readProviderOverrides(2);
    assert.equal(theirs["codex-balanced"]?.callMs, 600_000);
  });
});

describe("saveProviderTime input validation (QA-2, 2026-09-02)", { skip }, () => {
  const PROVIDER_ID = "claude-frontier";

  async function currentCallMs(): Promise<number | null> {
    const overrides = await readProviderOverrides(NEWSROOM_ID);
    return overrides[PROVIDER_ID]?.callMs ?? null;
  }

  it("refuses 9 seconds, 3601 seconds, and -5 seconds -- out of range, not silently clamped", async () => {
    for (const bad of [9, 3601, -5]) {
      const result = await saveProviderTime(OWNER_ID, cleanProviderTimeInput({ providerId: PROVIDER_ID, callSeconds: bad }));
      assert.equal(result.ok, false, `${bad}s must be refused`);
      if (!result.ok) assert.match(result.error, /between 10 seconds and 3600 seconds/);
    }
  });

  it("refuses NaN, Infinity, and a non-numeric value with the SAME shape as an out-of-range number -- not a silent reset", async () => {
    // First, give the row a real override so a silent reset would be visible.
    const seeded = await saveProviderTime(
      OWNER_ID,
      cleanProviderTimeInput({ providerId: PROVIDER_ID, callSeconds: 600 }),
    );
    assert.equal(seeded.ok, true);
    assert.equal(await currentCallMs(), 600_000);

    for (const bad of [NaN, Infinity, -Infinity, "not-a-number", {}, [], true]) {
      const result = await saveProviderTime(
        OWNER_ID,
        cleanProviderTimeInput({ providerId: PROVIDER_ID, callSeconds: bad }),
      );
      assert.equal(result.ok, false, `${String(bad)} must be refused, not accepted as a reset`);
      if (!result.ok) assert.match(result.error, /number of seconds/);
      // The malformed request must not have touched the stored override.
      assert.equal(await currentCallMs(), 600_000, `${String(bad)} must not silently reset the stored override`);
    }
  });

  it("still treats an explicitly-omitted or null callSeconds as Reset, not as invalid", async () => {
    assert.equal(cleanProviderTimeInput({ providerId: PROVIDER_ID }).invalid, false);
    assert.equal(cleanProviderTimeInput({ providerId: PROVIDER_ID, callSeconds: null }).invalid, false);

    const result = await saveProviderTime(OWNER_ID, cleanProviderTimeInput({ providerId: PROVIDER_ID, callSeconds: null }));
    assert.equal(result.ok, true);
    assert.equal(await currentCallMs(), null, "an actual Reset must still clear the stored override");
  });
});
