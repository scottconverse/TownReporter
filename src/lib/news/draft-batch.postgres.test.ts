import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : {
      ok: false as const,
      reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real concurrency proof",
    };
const skip = probe.ok ? false : probe.reason;
const dbName = "townreporter_batch_" + process.pid + "_" + Date.now();
let db: typeof import("../db.ts");
let batch: typeof import("./draft-batch.server.ts");
let created = false;

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("create database " + dbName);
      created = true;
    } finally {
      await admin.end();
    }
    process.env.DATABASE_URL = withDatabase(adminUrl, dbName);
    db = await import("../db.ts");
    batch = await import("./draft-batch.server.ts");
    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir)
      .filter((entry) => /^\d+.*\.sql$/.test(entry))
      .sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [
        dbName,
      ]);
      await admin.query("drop database " + dbName);
    } finally {
      await admin.end();
    }
  });
}

it(
  "two real PostgreSQL batch starts leave one batch and one open job",
  { skip, timeout: 15000 },
  async () => {
    const sql = await db.getSql();
    await sql.query(
      "insert into newsroom_members(user_id,role,newsroom_id) values('batch-editor','editor',1)",
    );
    const [lead] = await sql.query<{ id: number }>(
      "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values('batch-editor',1,'Lead','Why','council','new','[]','',1,'{}') returning id",
    );
    const input = {
      context: { userId: "batch-editor", newsroomId: 1 },
      items: [{ leadId: lead.id }],
      runtimeSnapshot: {
        runtime: "claude-cli",
        modelChoice: "claude-frontier",
        transport: "claude-code",
        model: "selected-claude",
      },
    };
    let release!: () => void;
    const pause = new Promise<void>((resolvePause) => {
      release = resolvePause;
    });
    let entered!: () => void;
    const ownsLeadLocks = new Promise<void>((resolveEntered) => {
      entered = resolveEntered;
    });
    const first = batch.commitDraftBatchForAuthenticatedEditor(input, {
      accountRate: false,
      kick: false,
      afterSelectionLocked: async () => {
        entered();
        await pause;
      },
    });
    void first.catch(() => {});
    const watcher = new Client({ connectionString: withDatabase(adminUrl, dbName) });
    await watcher.connect();
    let second: ReturnType<typeof batch.commitDraftBatchForAuthenticatedEditor> | undefined;
    try {
      await ownsLeadLocks;
      second = batch.commitDraftBatchForAuthenticatedEditor(input, {
        accountRate: false,
        kick: false,
      });
      void second.catch(() => {});
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const observed = await watcher.query<{ waiting: boolean }>(
          "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and lower(query) like '%from leads%for update%') waiting",
        );
        if (observed.rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
      const activity = waiting
        ? []
        : (
            await watcher.query<{
              state: string;
              wait_event_type: string | null;
              wait_event: string | null;
              query: string;
            }>(
              "select state,wait_event_type,wait_event,query from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() order by pid",
            )
          ).rows;
      assert.equal(
        waiting,
        true,
        "the second batch must wait on the first batch's lead lock; activity=" +
          JSON.stringify(activity),
      );
      assert.equal(
        (await sql.query<{ count: number }>("select count(*)::int count from draft_batches"))[0]
          .count,
        0,
      );
      assert.equal(
        (await sql.query<{ count: number }>("select count(*)::int count from desk_jobs"))[0].count,
        0,
      );
      release();
      const results = await Promise.all([first, second]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(
        results.filter((result) => !result.ok && result.code === "already-running").length,
        1,
      );
    } finally {
      release();
      await first.catch(() => {});
      await second?.catch(() => {});
      await watcher.end();
    }
    assert.equal(
      (await sql.query<{ count: number }>("select count(*)::int count from draft_batches"))[0]
        .count,
      1,
    );
    assert.equal(
      (await sql.query<{ count: number }>("select count(*)::int count from desk_jobs"))[0].count,
      1,
    );
  },
);
