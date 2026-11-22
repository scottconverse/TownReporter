import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { readRegistryFreshness } from "./registry-desk.server.ts";
import { getPublicRegistryService } from "./registry-public.server.ts";
import type { ParsedResourceChange } from "../schema.ts";
import {
  countPublishedForRecheck,
  planRegistryRechecks,
  runRegistryRechecks,
  type RecheckPage,
} from "./registry-recheck.server.ts";

await applyMigrationsToTestPglite();

type TestSql = Awaited<ReturnType<typeof getSql>>;

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T12:00:00Z");

async function one(sql: TestSql, text: string, params: unknown[]): Promise<number> {
  const rows = await sql.query<{ id: number }>(text, params);
  return Number(rows[0]!.id);
}

interface Seed {
  serviceId: number;
  sourceId: number;
  url: string;
  hsdsId: string;
}

/** One URL per seeded row: `sources` is unique on (user, newsroom, url). */
let seededRows = 0;

/**
 * One published service at one source page. `robot` seeds the last recheck and
 * any run of failures, so a test can stand on the second failure.
 */
async function seed(
  newsroomId: number,
  over: {
    crisis?: boolean;
    robotCheckedAt?: Date | null;
    failures?: number;
    firstFailureAt?: Date | null;
    published?: boolean;
    robotResult?: string | null;
  } = {},
): Promise<Seed> {
  const sql = await getSql();
  seededRows += 1;
  const url = `https://example.org/pantry-${newsroomId}-${seededRows}`;
  const sourceId = await one(
    sql,
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
     values ('scan-user', $1, $2, 'Example pantry', 'page', 'B', 'accepted') returning id`,
    [newsroomId, url],
  );
  const org = await one(
    sql,
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, $2, 'Helping Hands', 'active', true) returning id`,
    [newsroomId, `org-${seededRows}`],
  );
  const hsdsId = `svc-${seededRows}`;
  const serviceId = await one(
    sql,
    `insert into services (newsroom_id, hsds_id, organization_id, name, status, published,
                           fees, source_id, crisis, robot_checked_at, robot_check_result,
                           robot_failures, robot_first_failure_at)
     values ($1, $2, $3, 'Food Pantry', 'active', $4, 'Free', $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      newsroomId,
      hsdsId,
      org,
      over.published ?? true,
      sourceId,
      over.crisis ?? false,
      over.robotCheckedAt ? over.robotCheckedAt.toISOString() : null,
      over.robotResult ?? null,
      over.failures ?? 0,
      over.firstFailureAt ? over.firstFailureAt.toISOString() : null,
    ],
  );
  return { serviceId, sourceId, url, hsdsId };
}

function change(over: Partial<ParsedResourceChange> = {}): ParsedResourceChange {
  return {
    entity_type: "service",
    entity_hsds_id: "svc-1",
    entity_name: "Food Pantry",
    // The caller overrides the HSDS id with the seeded row's own.
    field_name: "fees",
    before_value: "Free",
    after_value: "5 dollars",
    change_kind: "field_change",
    summary: "The pantry now charges 5 dollars.",
    model_confidence: 0.9,
    source_url: "",
    ...over,
  };
}

async function rechecks(sql: TestSql, newsroomId: number, serviceId: number) {
  return sql.query<{ result: string; detail: string | null }>(
    `select result, detail from registry_rechecks
      where newsroom_id = $1 and service_id = $2 order by id`,
    [newsroomId, serviceId],
  );
}

test("a page that still states the stored facts records same and the date", async () => {
  const sql = await getSql();
  const newsroomId = 9101;
  const seeded = await seed(newsroomId);

  const summary = await runRegistryRechecks(sql, {
    newsroomId,
    userId: "scan-user",
    scanRunId: null,
    now: NOW,
    deps: {
      fetchPage: async (): Promise<RecheckPage> => ({ kind: "ok", text: "Fees: Free", title: "Pantry" }),
      readChanges: async () => [],
    },
  });

  assert.equal(summary.planned, 1);
  assert.equal(summary.same, 1);
  const [service] = await sql.query<Record<string, unknown>>(
    `select robot_check_result, robot_checked_at::text as at, robot_failures
       from services where id = $1`,
    [seeded.serviceId],
  );
  assert.equal(service!.robot_check_result, "same");
  assert.ok(service!.at);
  assert.equal(Number(service!.robot_failures), 0);
  assert.deepEqual((await rechecks(sql, newsroomId, seeded.serviceId)).map((r) => r.result), ["same"]);

  // A robot recheck is never an editor verification.
  const [verified] = await sql.query<{ n: number }>(
    "select count(*)::int as n from resource_verifications where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(verified!.n, 0);
});

test("a changed fact is applied and published through the scan's own step", async () => {
  const sql = await getSql();
  const newsroomId = 9102;
  const seeded = await seed(newsroomId);

  const summary = await runRegistryRechecks(sql, {
    newsroomId,
    userId: "scan-user",
    scanRunId: null,
    now: NOW,
    deps: {
      fetchPage: async () => ({ kind: "ok", text: "Fees: 5 dollars", title: "Pantry" }),
      readChanges: async () => [change({ entity_hsds_id: seeded.hsdsId })],
    },
  });

  assert.equal(summary.changed, 1);
  const [service] = await sql.query<Record<string, unknown>>(
    "select fees, published, robot_check_result from services where id = $1",
    [seeded.serviceId],
  );
  assert.equal(service!.fees, "5 dollars");
  assert.equal(service!.published, true);
  assert.equal(service!.robot_check_result, "changed");

  const [row] = await sql.query<Record<string, unknown>>(
    `select review_state, applied_at, evidence_capture_id
       from resource_changes where newsroom_id = $1 and entity_id = $2`,
    [newsroomId, seeded.serviceId],
  );
  assert.equal(row!.review_state, "accepted");
  assert.ok(row!.applied_at);
  assert.ok(row!.evidence_capture_id);

  const [audit] = await sql.query<{ n: number }>(
    `select count(*)::int as n from audit_events
      where newsroom_id = $1 and action = 'registry.service.autopublish'`,
    [newsroomId],
  );
  assert.equal(audit!.n, 1);
});

test("one failure only records the failure and leaves the entry published", async () => {
  const sql = await getSql();
  const newsroomId = 9103;
  const seeded = await seed(newsroomId);

  const summary = await runRegistryRechecks(sql, {
    newsroomId,
    userId: "scan-user",
    scanRunId: null,
    now: NOW,
    deps: {
      fetchPage: async () => ({ kind: "gone", reason: "Fetch failed (404)" }),
      readChanges: async () => [],
    },
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.sourceGone, 0);
  const [service] = await sql.query<Record<string, unknown>>(
    `select published, robot_check_result, robot_failures,
            robot_first_failure_at::text as first
       from services where id = $1`,
    [seeded.serviceId],
  );
  assert.equal(service!.published, true);
  assert.equal(service!.robot_check_result, null);
  assert.equal(Number(service!.robot_failures), 1);
  assert.ok(service!.first);
  assert.deepEqual((await rechecks(sql, newsroomId, seeded.serviceId)).map((r) => r.result), ["failed"]);
});

test("a second gone recheck at least three days later unpublishes and lists the entry", async () => {
  const sql = await getSql();
  const newsroomId = 9104;
  const seeded = await seed(newsroomId, {
    failures: 1,
    firstFailureAt: new Date(NOW.getTime() - 4 * DAY),
  });

  const summary = await runRegistryRechecks(sql, {
    newsroomId,
    userId: "scan-user",
    scanRunId: null,
    now: NOW,
    deps: {
      fetchPage: async () => ({ kind: "gone", reason: "getaddrinfo ENOTFOUND example.org" }),
      readChanges: async () => [],
    },
  });

  assert.equal(summary.sourceGone, 1);
  const [service] = await sql.query<Record<string, unknown>>(
    "select published, robot_check_result from services where id = $1",
    [seeded.serviceId],
  );
  assert.equal(service!.published, false);
  assert.equal(service!.robot_check_result, "source_gone");

  const [audit] = await sql.query<{ n: number }>(
    `select count(*)::int as n from audit_events
      where newsroom_id = $1 and action = 'registry.service.source_gone'`,
    [newsroomId],
  );
  assert.equal(audit!.n, 1);

  const freshness = await readRegistryFreshness(sql, newsroomId);
  assert.equal(freshness.sourceGone, 1);
  assert.deepEqual(freshness.sourceGoneEntries.map((entry) => entry.serviceId), [seeded.serviceId]);
});

test("a bad night that is not a missing page never takes the entry down", async () => {
  const sql = await getSql();
  const newsroomId = 9105;
  const seeded = await seed(newsroomId, {
    failures: 1,
    firstFailureAt: new Date(NOW.getTime() - 10 * DAY),
  });

  await runRegistryRechecks(sql, {
    newsroomId,
    userId: "scan-user",
    scanRunId: null,
    now: NOW,
    deps: {
      fetchPage: async () => ({ kind: "failed", reason: "This operation was aborted" }),
      readChanges: async () => [],
    },
  });

  const [service] = await sql.query<Record<string, unknown>>(
    "select published, robot_check_result from services where id = $1",
    [seeded.serviceId],
  );
  assert.equal(service!.published, true);
  assert.equal(service!.robot_check_result, null);
});

test("tonight's list is a thirtieth of the published registry, oldest first", async () => {
  const sql = await getSql();
  const newsroomId = 9106;
  for (let index = 0; index < 60; index += 1) {
    await seed(newsroomId, {
      robotCheckedAt: index < 5 ? null : new Date(NOW.getTime() - (index + 1) * DAY),
    });
  }
  assert.equal(await countPublishedForRecheck(sql, newsroomId), 60);

  const planned = await planRegistryRechecks(sql, newsroomId, NOW);
  // ceil(60 / 30) = 2 a night.
  assert.equal(planned.length, 2);
  for (const target of planned) {
    assert.equal(target.sourceUrl.startsWith("https://example.org/pantry-"), true);
  }
});

test("the public entry carries the robot's check, not a verification", async () => {
  const sql = await getSql();
  const newsroomId = 9107;
  const seeded = await seed(newsroomId);

  await runRegistryRechecks(sql, {
    newsroomId,
    userId: "scan-user",
    scanRunId: null,
    now: NOW,
    deps: {
      fetchPage: async () => ({ kind: "ok", text: "Fees: Free", title: "Pantry" }),
      readChanges: async () => [],
    },
  });

  const entry = await getPublicRegistryService(sql, newsroomId, seeded.serviceId);
  assert.equal(entry?.verifiedAt ?? null, null);
  assert.ok(entry?.robotCheckedAt);
  assert.equal(entry?.robotCheckedSite, "example.org");
});
