import { getSql, readSchemaEnsureMarker } from "./db.ts";
import { ensureCustomAiConnectionsSchema } from "./news/custom-ai-connections.server.ts";
import { ensureDarkSchema } from "./news/dark.ts";
import { ensureDeskDraftMemoSchema } from "./news/desk.ts";
import { ensureDailyScanPolicySchema } from "./news/daily-scan.ts";
import { ensureSourceScanPreferencesSchema } from "./news/source-scan-preferences.server.ts";
import { ensureScanSourceCoverageSchema } from "./news/scan-source-coverage.server.ts";
import { ensureDraftBatchSchema } from "./news/draft-batch.server.ts";
import { ensureEditorialRequestSchema, ensureEditorialSchema } from "./news/editorial.server.ts";
import { ensureFollowUpsSchema } from "./news/follow-ups.ts";
import { ensureInvestigateSchema } from "./news/investigate.ts";
import { ensureJobsSchema } from "./news/jobs.ts";
import { ensureLegalSchema } from "./news/legal-removal-schema.ts";
import { ensureInviteSchema, ensureNewsroomSchema } from "./news/membership.ts";
import { ensureModelAssignmentsSchema } from "./news/model-assignments-store.ts";
import { ensureModelRequestLeadMemoSchema } from "./news/model-request-commit.server.ts";
import { ensureAuditEventsSchema, ensureDeskRateSchema } from "./news/ops.ts";
import { ensurePageWatchSchema } from "./news/page-watch.ts";
import { ensurePaperSettingsSchema } from "./news/paper-settings.ts";
import { ensureProviderLoginsSchema } from "./news/provider-login.server.ts";
import { ensureProviderSettingsSchema } from "./news/provider-settings.ts";
import { ensurePullLeadMemoSchema } from "./news/pull.server.ts";
import { ensureReadingSchema } from "./news/reading.server.ts";
import { ensureRoutineNoticeAutomationSchema } from "./news/routine-notice-automation.ts";
import { ensureRoutineNoticeCheckSchema } from "./news/routine-notice-checks.server.ts";
import { ensureRoutineNoticePolicySchema } from "./news/routine-notice-policy.ts";
import { ensureSectionsSchema } from "./news/sections.server.ts";
import { ensureStoryAreaSchema } from "./news/story-area.server.ts";
import { ensureStoryDocuments } from "./news/story-documents.server.ts";
import { ensureViewsSchema, ensureViewsStatsAuditEventsSchema } from "./news/views.ts";
import { ensureYoutubeDataApiSchema } from "./news/youtube-data-api.server.ts";

/**
 * Boot-time schema warm-up (Unit CE, release 0.6.80).
 *
 * BACKGROUND: `ensureSchemaOnce` (db.ts) already turns every `ensure*Schema`
 * module's request-time DDL into a once-per-database no-op after its first
 * successful run -- but "first" is still request time. A module's FIRST use
 * after a schema-changing release can still run its `alter table ... add
 * column if not exists` list while a promote's `pg_dump` holds an ACCESS
 * SHARE lock on the same tables, which is exactly the 2026-09-26 incident
 * this unit exists to close. Promotes have compensated by stopping the app
 * before the backup (~2 min downtime); see
 * townreporter-deepseek-oversight/DECISIONS.md, "Keep the stop-the-app step
 * in promotes" (2026-09-27).
 *
 * This module is the fix: run EVERY `ensure*Schema` function once, in
 * sequence, before the server accepts its first request, so every module's
 * "first use" happens at boot -- with no `pg_dump` running yet -- instead of
 * on whatever request happens to arrive first. `SCHEMA_WARMUP_REGISTRY` is
 * the list `schema-warmup-registry-completeness.test.ts` checks against every
 * `ensure*Schema`-shaped export this repo defines: a module that adds one and
 * forgets to register it here fails that test.
 *
 * Callers: `server/plugins/schema-warmup.ts` (built server boot),
 * `vite.config.ts`'s dev bootstrap plugin, and `scripts/schema-warmup.mjs`
 * (a standalone run for ops, e.g. from a promote script after `db:migrate`).
 */
export interface SchemaWarmupEntry {
  /** The `name` ensureSchemaOnce keys `_schema_ensure_state` on for this module. */
  readonly name: string;
  /** Source file, relative to `src/lib/`, for logs and the completeness test. */
  readonly module: string;
  /**
   * The exported identifier in `module` this entry wraps. The completeness
   * test dynamically imports every module under `src/lib/` and `src/lib/news/`
   * that calls `ensureSchemaOnce`, and checks each of its `ensure*Schema`-named
   * exports against this field -- not a text search over this registry, an
   * actual `Object.keys(await import(module))` comparison.
   */
  readonly exportName: string;
  /**
   * The raw imported function this entry wraps -- for entries whose `run` is
   * a plain pass-through this is literally `run`; for a wrapped entry (one
   * that supplies a default argument, discards a return value, or is a
   * private call-site extraction) it is the underlying named import instead.
   * The completeness test compares by THIS reference (not by module path),
   * so a module that re-exports an already-registered function under its own
   * name (e.g. `desk.ts` re-exporting `follow-ups.ts`'s `ensureFollowUpsSchema`)
   * is correctly recognised as already covered rather than flagged as a gap.
   */
  readonly fn: unknown;
  readonly run: () => Promise<void>;
}

export const SCHEMA_WARMUP_REGISTRY: readonly SchemaWarmupEntry[] = [
  {
    name: "custom-ai-connections",
    module: "news/custom-ai-connections.server.ts",
    exportName: "ensureCustomAiConnectionsSchema",
    fn: ensureCustomAiConnectionsSchema,
    run: ensureCustomAiConnectionsSchema,
  },
  {
    name: "dark",
    module: "news/dark.ts",
    exportName: "ensureDarkSchema",
    fn: ensureDarkSchema,
    run: ensureDarkSchema,
  },
  {
    name: "daily-scan-fixed-source-count",
    module: "news/daily-scan.ts",
    exportName: "ensureDailyScanPolicySchema",
    fn: ensureDailyScanPolicySchema,
    run: ensureDailyScanPolicySchema,
  },
  {
    name: "source-scan-preferences",
    module: "news/source-scan-preferences.server.ts",
    exportName: "ensureSourceScanPreferencesSchema",
    fn: ensureSourceScanPreferencesSchema,
    run: ensureSourceScanPreferencesSchema,
  },
  {
    name: "scan-source-coverage",
    module: "news/scan-source-coverage.server.ts",
    exportName: "ensureScanSourceCoverageSchema",
    fn: ensureScanSourceCoverageSchema,
    run: ensureScanSourceCoverageSchema,
  },
  {
    name: "desk-draft-memo-columns",
    module: "news/desk.ts",
    exportName: "ensureDeskDraftMemoSchema",
    fn: ensureDeskDraftMemoSchema,
    run: ensureDeskDraftMemoSchema,
  },
  {
    name: "draft-batch",
    module: "news/draft-batch.server.ts",
    exportName: "ensureDraftBatchSchema",
    fn: ensureDraftBatchSchema,
    run: () => ensureDraftBatchSchema(),
  },
  {
    name: "editorial-extras",
    module: "news/editorial.server.ts",
    exportName: "ensureEditorialSchema",
    fn: ensureEditorialSchema,
    run: ensureEditorialSchema,
  },
  {
    name: "editorial-requests",
    module: "news/editorial.server.ts",
    exportName: "ensureEditorialRequestSchema",
    fn: ensureEditorialRequestSchema,
    run: ensureEditorialRequestSchema,
  },
  {
    name: "follow-ups",
    module: "news/follow-ups.ts",
    exportName: "ensureFollowUpsSchema",
    fn: ensureFollowUpsSchema,
    run: ensureFollowUpsSchema,
  },
  {
    name: "investigate",
    module: "news/investigate.ts",
    exportName: "ensureInvestigateSchema",
    fn: ensureInvestigateSchema,
    run: ensureInvestigateSchema,
  },
  {
    name: "desk-jobs",
    module: "news/jobs.ts",
    exportName: "ensureJobsSchema",
    fn: ensureJobsSchema,
    run: ensureJobsSchema,
  },
  {
    name: "legal-removal",
    module: "news/legal-removal-schema.ts",
    exportName: "ensureLegalSchema",
    fn: ensureLegalSchema,
    run: ensureLegalSchema,
  },
  {
    name: "newsrooms",
    module: "news/membership.ts",
    exportName: "ensureNewsroomSchema",
    fn: ensureNewsroomSchema,
    run: () => ensureNewsroomSchema().then(() => undefined),
  },
  {
    name: "editor-invites",
    module: "news/membership.ts",
    exportName: "ensureInviteSchema",
    fn: ensureInviteSchema,
    run: ensureInviteSchema,
  },
  {
    name: "model-assignments",
    module: "news/model-assignments-store.ts",
    exportName: "ensureModelAssignmentsSchema",
    fn: ensureModelAssignmentsSchema,
    run: ensureModelAssignmentsSchema,
  },
  {
    name: "model-request-lead-memo-column",
    module: "news/model-request-commit.server.ts",
    exportName: "ensureModelRequestLeadMemoSchema",
    fn: ensureModelRequestLeadMemoSchema,
    run: ensureModelRequestLeadMemoSchema,
  },
  {
    name: "desk-rate",
    module: "news/ops.ts",
    exportName: "ensureDeskRateSchema",
    fn: ensureDeskRateSchema,
    run: ensureDeskRateSchema,
  },
  {
    name: "audit-events",
    module: "news/ops.ts",
    exportName: "ensureAuditEventsSchema",
    fn: ensureAuditEventsSchema,
    run: ensureAuditEventsSchema,
  },
  // Also runs ensureInvestigateSchema internally; harmless, "investigate" above
  // will already show "skipped-by-marker" by the time this one runs.
  {
    name: "manual-page-watch",
    module: "news/page-watch.ts",
    exportName: "ensurePageWatchSchema",
    fn: ensurePageWatchSchema,
    run: ensurePageWatchSchema,
  },
  {
    name: "paper-settings",
    module: "news/paper-settings.ts",
    exportName: "ensurePaperSettingsSchema",
    fn: ensurePaperSettingsSchema,
    run: ensurePaperSettingsSchema,
  },
  {
    name: "provider-logins",
    module: "news/provider-login.server.ts",
    exportName: "ensureProviderLoginsSchema",
    fn: ensureProviderLoginsSchema,
    run: ensureProviderLoginsSchema,
  },
  {
    name: "provider-settings",
    module: "news/provider-settings.ts",
    exportName: "ensureProviderSettingsSchema",
    fn: ensureProviderSettingsSchema,
    run: ensureProviderSettingsSchema,
  },
  {
    name: "pull-lead-memo-column",
    module: "news/pull.server.ts",
    exportName: "ensurePullLeadMemoSchema",
    fn: ensurePullLeadMemoSchema,
    run: ensurePullLeadMemoSchema,
  },
  {
    name: "read_hourly",
    module: "news/reading.server.ts",
    exportName: "ensureReadingSchema",
    fn: ensureReadingSchema,
    run: ensureReadingSchema,
  },
  {
    name: "routine-notice-automation-0054",
    module: "news/routine-notice-automation.ts",
    exportName: "ensureRoutineNoticeAutomationSchema",
    fn: ensureRoutineNoticeAutomationSchema,
    run: ensureRoutineNoticeAutomationSchema,
  },
  {
    name: "routine-notice-checks-0053",
    module: "news/routine-notice-checks.server.ts",
    exportName: "ensureRoutineNoticeCheckSchema",
    fn: ensureRoutineNoticeCheckSchema,
    run: ensureRoutineNoticeCheckSchema,
  },
  {
    name: "routine-notice-policy-0052",
    module: "news/routine-notice-policy.ts",
    exportName: "ensureRoutineNoticePolicySchema",
    fn: ensureRoutineNoticePolicySchema,
    run: ensureRoutineNoticePolicySchema,
  },
  {
    name: "sections",
    module: "news/sections.server.ts",
    exportName: "ensureSectionsSchema",
    fn: ensureSectionsSchema,
    run: ensureSectionsSchema,
  },
  {
    name: "story-area",
    module: "news/story-area.server.ts",
    exportName: "ensureStoryAreaSchema",
    fn: ensureStoryAreaSchema,
    run: ensureStoryAreaSchema,
  },
  {
    name: "story-documents",
    module: "news/story-documents.server.ts",
    exportName: "ensureStoryDocuments",
    fn: ensureStoryDocuments,
    run: async () => {
      await ensureStoryDocuments(await getSql());
    },
  },
  {
    name: "page-views",
    module: "news/views.ts",
    exportName: "ensureViewsSchema",
    fn: ensureViewsSchema,
    run: ensureViewsSchema,
  },
  {
    name: "views-stats-audit-events",
    module: "news/views.ts",
    exportName: "ensureViewsStatsAuditEventsSchema",
    fn: ensureViewsStatsAuditEventsSchema,
    run: ensureViewsStatsAuditEventsSchema,
  },
  {
    name: "youtube-data-api",
    module: "news/youtube-data-api.server.ts",
    exportName: "ensureYoutubeDataApiSchema",
    fn: ensureYoutubeDataApiSchema,
    run: ensureYoutubeDataApiSchema,
  },
];

export type SchemaWarmupStatus = "ran" | "skipped-by-marker" | "failed";

export interface SchemaWarmupResult {
  readonly name: string;
  readonly status: SchemaWarmupStatus;
  readonly ms: number;
  readonly error?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Memoized, process-wide warm-up run, shared by the built server's boot
 * plugin (`server/plugins/schema-warmup.ts`, which starts it) and its
 * request-gating middleware (`server/middleware/00-schema-warmup.ts`, which
 * awaits it before letting any request through) plus the dev server's
 * `configureServer` hook (`vite.config.ts`). One run per process, like
 * `getSql()` -- a second call after a failed first run retries, matching
 * `getSql()`'s own "don't memoize failures" pattern, since `runSchemaWarmup`
 * only rejects on something outside its own per-module try/catch (e.g. no
 * database reachable at all).
 */
const globalRef = globalThis as typeof globalThis & {
  __schemaWarmupPromise__?: Promise<SchemaWarmupResult[]>;
};

export function getSchemaWarmupPromise(): Promise<SchemaWarmupResult[]> {
  globalRef.__schemaWarmupPromise__ ??= runSchemaWarmup().catch((err) => {
    globalRef.__schemaWarmupPromise__ = undefined;
    throw err;
  });
  return globalRef.__schemaWarmupPromise__;
}

/**
 * Run every registered `ensure*Schema` function once, in sequence, logging
 * one line per module. Never throws: a module that fails is logged plainly
 * and skipped -- its own request-time `ensureSchemaOnce` call still runs
 * later, on whatever request first needs it, exactly as before this unit.
 * Modules already current (matching fingerprint from a prior boot or a prior
 * request) log `skipped-by-marker` and do no DDL at all.
 */
export async function runSchemaWarmup(
  options: { timeoutMs?: number; log?: (line: string) => void } = {},
): Promise<SchemaWarmupResult[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.log ?? ((line: string) => console.log(line));
  const sql = await getSql();
  const results: SchemaWarmupResult[] = [];

  for (const entry of SCHEMA_WARMUP_REGISTRY) {
    const started = Date.now();
    const before = await readSchemaEnsureMarker(sql, entry.name);
    try {
      await withTimeout(entry.run(), timeoutMs);
      const after = await readSchemaEnsureMarker(sql, entry.name);
      const ms = Date.now() - started;
      const status: SchemaWarmupStatus =
        before !== null && before === after ? "skipped-by-marker" : "ran";
      results.push({ name: entry.name, status, ms });
      log(`[schema-warmup] ${entry.name} ${ms}ms ${status}`);
    } catch (error) {
      const ms = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: entry.name, status: "failed", ms, error: message });
      log(`[schema-warmup] ${entry.name} ${ms}ms failed: ${message}`);
    }
  }

  return results;
}
