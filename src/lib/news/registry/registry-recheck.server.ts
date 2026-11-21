/**
 * The nightly robot recheck (Scott's Nov 20 2026 order).
 *
 * "Every so often we should check the data that's there to make sure it's still
 * fresh and still accurate. It should not be static. Every so often you need to
 * go through and recheck everything."
 *
 * The scheduled scan calls `runRegistryRechecks` once at the end of its own
 * run. It picks the entries whose last robot recheck is oldest (crisis services
 * every week), opens each one's source page again with the scan's own capture
 * code, compares the page's key facts with what the registry stores, and:
 *
 *  - "same": records the date and that nothing differs;
 *  - "changed": sends the changes through the scan's own `resource_changes`
 *    step, which applies them and publishes the entry (with its audit row);
 *  - "source gone": after two failures at least three days apart, unpublishes
 *    the entry and lists it under "Source gone" on the desk. One failure only
 *    records the failure.
 *
 * A robot recheck NEVER writes `resource_verifications`, `last_verified_at` or
 * `last_verified_by`. Those are an editor's word, and this is not one.
 *
 * The fetch and the model read are injected (`deps`), so the rules can be tested
 * without a network or a model; the scan passes the real ones.
 */

import { withTransaction, type Sql } from "../../db.ts";
import { sha256 } from "../url-guard.ts";
import type { ParsedResourceChange } from "../schema.ts";
import { recordRegistryEvent } from "./registry-audit.server.ts";
import {
  CRISIS_RECHECK_EVERY_DAYS,
  RECHECK_EVERY_DAYS,
  RECHECK_NIGHTLY_CAP,
  classifyRecheckFailure,
  nextRecheckFailure,
  planRecheckSelection,
} from "./registry-recheck.ts";
import { commitScanResourceChanges, normalizeSourceUrl } from "./scan-changes.server.ts";
import { readKeyFacts, type KeyFacts } from "./registry-verify.server.ts";

export { CRISIS_RECHECK_EVERY_DAYS, RECHECK_EVERY_DAYS, RECHECK_NIGHTLY_CAP };

/** One published entry the robot may open again. */
export interface RecheckTarget {
  serviceId: number;
  serviceName: string;
  serviceHsdsId: string;
  organizationName: string;
  crisis: boolean;
  robotCheckedAt: string | Date | null;
  failures: number;
  firstFailureAt: string | Date | null;
  sourceId: number;
  sourceUrl: string;
  sourceTier: string | null;
}

/**
 * Only entries with a source page of their own can be rechecked: there is
 * nothing to open again for a hand-entered row with no source. (The desk's
 * oldest-unchecked number still counts every published entry, so such a row is
 * visible rather than quietly ignored.)
 */
export async function readRecheckTargets(
  sql: Sql,
  newsroomId: number,
): Promise<RecheckTarget[]> {
  const rows = await sql.query<{
    service_id: number;
    service_name: string;
    service_hsds_id: string;
    organization_name: string;
    crisis: boolean;
    robot_checked_at: string | Date | null;
    robot_failures: number;
    robot_first_failure_at: string | Date | null;
    source_id: number;
    source_url: string;
    source_tier: string | null;
  }>(
    `select s.id as service_id, s.name as service_name, s.hsds_id as service_hsds_id,
            o.name as organization_name, s.crisis,
            s.robot_checked_at, s.robot_failures, s.robot_first_failure_at,
            src.id as source_id, src.url as source_url, src.tier as source_tier
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
       join sources src
         on src.id = coalesce(s.source_id, o.source_id) and src.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.published = true
      order by s.id`,
    [newsroomId],
  );
  return rows.map((row) => ({
    serviceId: Number(row.service_id),
    serviceName: row.service_name,
    serviceHsdsId: row.service_hsds_id,
    organizationName: row.organization_name,
    crisis: Boolean(row.crisis),
    robotCheckedAt: row.robot_checked_at,
    failures: Number(row.robot_failures ?? 0),
    firstFailureAt: row.robot_first_failure_at,
    sourceId: Number(row.source_id),
    sourceUrl: row.source_url,
    sourceTier: row.source_tier,
  }));
}

/** How many services in this newsroom are published (the quota's denominator). */
export async function countPublishedForRecheck(
  sql: Sql,
  newsroomId: number,
): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    "select count(*)::text as count from services where newsroom_id = $1 and published = true",
    [newsroomId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Tonight's list, oldest first after the crisis entries. */
export async function planRegistryRechecks(
  sql: Sql,
  newsroomId: number,
  now: Date = new Date(),
  cap: number = RECHECK_NIGHTLY_CAP,
): Promise<RecheckTarget[]> {
  const targets = await readRecheckTargets(sql, newsroomId);
  const byId = new Map(targets.map((target) => [target.serviceId, target]));
  /*
    The quota is a thirtieth of the entries that have a source page to open.
    A hand-entered row with no source cannot be rechecked at all, so counting
    it would only make every other entry wait longer than a month.
  */
  const chosen = planRecheckSelection(
    targets.map((target) => ({
      serviceId: target.serviceId,
      crisis: target.crisis,
      robotCheckedAt: target.robotCheckedAt,
    })),
    now,
    { cap },
  );
  return chosen.map((id) => byId.get(id)!).filter(Boolean);
}

export type RecheckPage =
  | { kind: "ok"; text: string; title: string }
  /** A 404/410 or a name that no longer resolves. */
  | { kind: "gone"; reason: string }
  /** A timeout, a 500, a block: a bad night, not a dead source. */
  | { kind: "failed"; reason: string };

/** The real fetch: the scan's own capture code, opening one page again. */
export async function fetchRecheckPage(url: string): Promise<RecheckPage> {
  const { fetchSourceText } = await import("../fetch-url.ts");
  try {
    const page = await fetchSourceText(url);
    return { kind: "ok", text: page.text, title: page.titleHint || "" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return classifyRecheckFailure(reason) === "gone"
      ? { kind: "gone", reason }
      : { kind: "failed", reason };
  }
}

/** What the model is asked, and what it answers, for one recheck. */
export interface RecheckRead {
  target: RecheckTarget;
  facts: KeyFacts;
  pageText: string;
  pageTitle: string;
}

export interface RegistryRecheckDeps {
  fetchPage: (url: string) => Promise<RecheckPage>;
  /** Compare the stored key facts with the page; [] means nothing differs. */
  readChanges: (input: RecheckRead) => Promise<ParsedResourceChange[]>;
}

export interface RegistryRecheckInput {
  newsroomId: number;
  userId: string;
  /** The scan run that hosts the batch; null when a test drives it alone. */
  scanRunId: number | null;
  now?: Date;
  cap?: number;
  deps: RegistryRecheckDeps;
}

export interface RegistryRecheckSummary {
  planned: number;
  same: number;
  changed: number;
  /** Entries unpublished by this run because their source page is gone. */
  sourceGone: number;
  /** A single failure recorded this run (the entry stays published). */
  failed: number;
  skipped: number;
}

/** One row per attempt, plus the service's own last-recheck stamp. */
async function recordRecheck(
  sql: Sql,
  input: {
    newsroomId: number;
    serviceId: number;
    result: "same" | "changed" | "source_gone" | "failed";
    sourceUrl: string;
    detail: string;
    now: Date;
    failures?: { failures: number; firstFailureAt: string };
  },
): Promise<void> {
  await sql.query(
    `insert into registry_rechecks
       (newsroom_id, service_id, checked_at, result, source_url, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.newsroomId,
      input.serviceId,
      input.now.toISOString(),
      input.result,
      input.sourceUrl,
      input.detail,
    ],
  );
  if (input.result === "failed") {
    /*
      A bad night advances the clock (so the entry goes to the back of the
      queue) but does not replace the last settled result. A gone-shaped first
      failure also keeps its own run, which is what the second failure is
      measured against.
    */
    if (input.failures) {
      await sql.query(
        `update services
            set robot_checked_at = $1,
                robot_failures = $2,
                robot_first_failure_at = $3,
                updated_at = now()
          where id = $4 and newsroom_id = $5`,
        [
          input.now.toISOString(),
          input.failures.failures,
          input.failures.firstFailureAt,
          input.serviceId,
          input.newsroomId,
        ],
      );
      return;
    }
    await sql.query(
      `update services set robot_checked_at = $1, updated_at = now()
        where id = $2 and newsroom_id = $3`,
      [input.now.toISOString(), input.serviceId, input.newsroomId],
    );
    return;
  }
  if (input.result === "source_gone") {
    await sql.query(
      `update services
          set robot_checked_at = $1,
              robot_check_result = 'source_gone',
              robot_failures = $2,
              robot_first_failure_at = $3,
              published = false,
              updated_at = now()
        where id = $4 and newsroom_id = $5`,
      [
        input.now.toISOString(),
        input.failures?.failures ?? 0,
        input.failures?.firstFailureAt ?? null,
        input.serviceId,
        input.newsroomId,
      ],
    );
    return;
  }
  await sql.query(
    `update services
        set robot_checked_at = $1,
            robot_check_result = $2,
            robot_failures = 0,
            robot_first_failure_at = null,
            updated_at = now()
      where id = $3 and newsroom_id = $4`,
    [input.now.toISOString(), input.result, input.serviceId, input.newsroomId],
  );
}

/**
 * Run tonight's batch. One failure never stops the batch: a page that cannot
 * be read is recorded and the next entry is tried.
 */
export async function runRegistryRechecks(
  sql: Sql,
  input: RegistryRecheckInput,
): Promise<RegistryRecheckSummary> {
  const now = input.now ?? new Date();
  const targets = await planRegistryRechecks(sql, input.newsroomId, now, input.cap);
  const summary: RegistryRecheckSummary = {
    planned: targets.length,
    same: 0,
    changed: 0,
    sourceGone: 0,
    failed: 0,
    skipped: 0,
  };

  for (const target of targets) {
    const page = await input.deps.fetchPage(target.sourceUrl);

    if (page.kind === "gone") {
      const outcome = nextRecheckFailure(
        { failures: target.failures, firstFailureAt: target.firstFailureAt },
        now,
      );
      const gone = outcome.sourceGone;
      await withTransaction(async (tx) => {
        await recordRecheck(tx, {
          newsroomId: input.newsroomId,
          serviceId: target.serviceId,
          result: gone ? "source_gone" : "failed",
          sourceUrl: target.sourceUrl,
          detail: gone
            ? `Source page gone (${page.reason}). Unpublished after two failures at least three days apart.`
            : `Source page gone (${page.reason}). First failure; nothing was changed.`,
          now,
          failures: { failures: outcome.failures, firstFailureAt: outcome.firstFailureAt },
        });
        if (gone) {
          await recordRegistryEvent(tx, {
            newsroomId: input.newsroomId,
            userId: input.userId,
            action: "registry.service.source_gone",
            subjectKind: "registry-service",
            subjectId: target.serviceId,
            detail: `Unpublished "${target.serviceName}": its source page ${target.sourceUrl} is gone.`,
          });
        }
      });
      if (gone) summary.sourceGone += 1;
      else summary.failed += 1;
      continue;
    }

    if (page.kind === "failed") {
      await withTransaction(async (tx) => {
        await recordRecheck(tx, {
          newsroomId: input.newsroomId,
          serviceId: target.serviceId,
          result: "failed",
          sourceUrl: target.sourceUrl,
          detail: `Could not read the source page (${page.reason}). Nothing was changed.`,
          now,
        });
      });
      summary.failed += 1;
      continue;
    }

    let facts: KeyFacts;
    try {
      facts = await readKeyFacts(sql, input.newsroomId, target.serviceId);
    } catch {
      summary.skipped += 1;
      continue;
    }

    let changes: ParsedResourceChange[];
    try {
      changes = await input.deps.readChanges({
        target,
        facts,
        pageText: page.text,
        pageTitle: page.title,
      });
    } catch {
      await withTransaction(async (tx) => {
        await recordRecheck(tx, {
          newsroomId: input.newsroomId,
          serviceId: target.serviceId,
          result: "failed",
          sourceUrl: target.sourceUrl,
          detail: "The page was read but the comparison failed. Nothing was changed.",
          now,
        });
      });
      summary.failed += 1;
      continue;
    }

    if (changes.length === 0) {
      await withTransaction(async (tx) => {
        await recordRecheck(tx, {
          newsroomId: input.newsroomId,
          serviceId: target.serviceId,
          result: "same",
          sourceUrl: target.sourceUrl,
          detail: "The page still states the stored facts.",
          now,
        });
      });
      summary.same += 1;
      continue;
    }

    /*
      A change read on a recheck goes through the scan's own resource_changes
      step: applied and published, with the audit row naming the page. The page
      is captured first, because a change without a retained capture is exactly
      what that step refuses.
    */
    const sourceUrl = normalizeSourceUrl(target.sourceUrl);
    const scoped = changes.map((change) => ({
      ...change,
      // The page this recheck opened is the evidence, whatever URL the model
      // echoed back.
      source_url: target.sourceUrl,
      entity_hsds_id: change.entity_hsds_id || target.serviceHsdsId,
      entity_name: change.entity_name || target.serviceName,
    }));
    await withTransaction(async (tx) => {
      const [capture] = await tx.query<{ id: number }>(
        `insert into snapshots (user_id, newsroom_id, source_id, content_hash, excerpt)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          input.userId,
          input.newsroomId,
          target.sourceId,
          await sha256(page.text),
          page.text.slice(0, 32000),
        ],
      );
      await commitScanResourceChanges(tx, {
        newsroomId: input.newsroomId,
        scanRunId: input.scanRunId,
        userId: input.userId,
        changes: scoped,
        sourceIdByUrl: new Map([[sourceUrl, target.sourceId]]),
        snapshotIdBySourceId: new Map([[target.sourceId, Number(capture!.id)]]),
        tierBySourceId: new Map([[target.sourceId, target.sourceTier ?? "C"]]),
        createMissing: false,
      });
      await recordRecheck(tx, {
        newsroomId: input.newsroomId,
        serviceId: target.serviceId,
        result: "changed",
        sourceUrl: target.sourceUrl,
        detail: `${changes.length} change${changes.length === 1 ? "" : "s"} applied and published from the page.`,
        now,
      });
    });
    summary.changed += 1;
  }

  return summary;
}
