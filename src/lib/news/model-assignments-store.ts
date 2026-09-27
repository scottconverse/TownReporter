/**
 * The table behind "Who does what": reading and writing `model_assignments`.
 *
 * Split from ./model-assignments.ts so the vocabulary, the resolution order
 * and the option lists can be imported and tested without a database, and so
 * nothing in the browser bundle pulls `getSql` in by accident.
 *
 * The write is "replace this job's set", not "patch one column": the screen
 * saves three selects at a time and a rank that was cleared has to disappear
 * rather than linger as an empty string. It runs inside `withTransaction`, so
 * a failure halfway through leaves the newsroom's assignments exactly as they
 * were instead of with the first choice gone and no fallbacks written.
 */

import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import {
  MODEL_EFFORT_LABELS,
  type ModelEffort,
} from "./provider-registry.ts";
import {
  FALLBACK_RANKS,
  FIRST_CHOICE_RANK,
  isModelJobKey,
  type ModelAssignmentRow,
  type ModelJobKey,
} from "./model-assignments.ts";

/**
 * Idempotent runtime ensure for the PGLite preview and unit-test paths,
 * mirroring migrations/0100_model_assignments.sql. Same reason
 * `ensureProviderSettingsSchema` exists: Node's test runner never runs
 * `migrations/*.sql` (see src/lib/db.ts createPgliteSql -- `import.meta.glob`
 * is a Vite-only transform), so the schema has to be stated twice.
 */
export async function ensureModelAssignmentsSchema() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await ensureSchemaOnce(sql, "model-assignments", [
    `
    create table if not exists model_assignments (
      newsroom_id integer not null default 1 references newsrooms(id) on delete cascade,
      job_key text not null,
      rank smallint not null check (rank between 0 and 2),
      provider_id text not null,
      effort text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (newsroom_id, job_key, rank)
    )
  `,
  ]);
}

type StoredRow = { job_key: string; rank: number; provider_id: string; effort: string | null };

/**
 * Every assignment this newsroom has saved, in rank order.
 *
 * A row whose `job_key` this build does not know is dropped rather than
 * returned: it was written by a build with one more job, and the reader here
 * cannot say what it means. Dropping it means an older build's page simply
 * does not show that job -- and, because the save writes the whole set the
 * screen holds, an editor who saves on the older build loses the newer row.
 * That is a real cost, and it is the right one: the alternative is a page
 * that shows assignments it cannot draw.
 */
export async function readModelAssignments(
  newsroomId: number = 1,
): Promise<ModelAssignmentRow[]> {
  const sql = await getSql();
  const rows = await sql<StoredRow>`
    select job_key, rank, provider_id, effort
    from model_assignments
    where newsroom_id = ${newsroomId}
    order by job_key, rank
  `;
  const out: ModelAssignmentRow[] = [];
  for (const row of rows) {
    if (!isModelJobKey(row.job_key)) continue;
    if (row.rank < FIRST_CHOICE_RANK || row.rank > FALLBACK_RANKS[FALLBACK_RANKS.length - 1]) {
      continue;
    }
    out.push({
      jobKey: row.job_key,
      rank: row.rank,
      providerId: row.provider_id,
      effort: row.effort,
    });
  }
  return out;
}

/** What a caller may send. Everything else is refused, not repaired silently. */
export type ModelAssignmentInput = {
  jobKey: string;
  rank: number;
  providerId: string;
  effort?: string | null;
};

export class ModelAssignmentInputError extends Error {}

function cleanInput(rows: readonly ModelAssignmentInput[]): ModelAssignmentRow[] {
  const seen = new Set<string>();
  const out: ModelAssignmentRow[] = [];
  for (const row of rows) {
    if (!isModelJobKey(row.jobKey)) {
      throw new ModelAssignmentInputError(`Unknown job: ${String(row.jobKey)}`);
    }
    if (row.rank !== FIRST_CHOICE_RANK && !(FALLBACK_RANKS as readonly number[]).includes(row.rank)) {
      throw new ModelAssignmentInputError(`Rank must be 0, 1 or 2: ${String(row.rank)}`);
    }
    const providerId = typeof row.providerId === "string" ? row.providerId.trim() : "";
    if (!providerId) throw new ModelAssignmentInputError("A rank needs a model.");
    if (seen.has(`${row.jobKey}:${row.rank}`)) {
      throw new ModelAssignmentInputError(`Two models for one rank: ${row.jobKey} rank ${row.rank}`);
    }
    seen.add(`${row.jobKey}:${row.rank}`);
    /*
      The effort is stored as given only when it is a level the vocabulary
      knows. Whether the LEVEL suits the model is decided at read time against
      that model (`cleanJobEffort`), because the valid levels depend on the
      model behind the id and that cannot be checked here -- but a string that
      is not a level at all is a bug in the caller, not a provider default.
    */
    let effort: ModelEffort | null = null;
    if (row.effort != null && row.effort !== "") {
      if (!(row.effort in MODEL_EFFORT_LABELS)) {
        throw new ModelAssignmentInputError(`Unknown effort: ${String(row.effort)}`);
      }
      effort = row.effort as ModelEffort;
    }
    out.push({ jobKey: row.jobKey as ModelJobKey, rank: row.rank, providerId, effort });
  }
  return out;
}

/**
 * Replace one newsroom's assignments with the set given, and answer with what
 * is now stored.
 *
 * The screen sends the rows it is holding, so this is a full replace: a rank
 * left empty is deleted, which is how "Automatic" is expressed (no row at
 * all rather than a row holding the word).
 */
export async function saveModelAssignments(
  newsroomId: number,
  rows: readonly ModelAssignmentInput[],
): Promise<ModelAssignmentRow[]> {
  const clean = cleanInput(rows);
  await withTransaction(async (sql: Sql) => {
    await sql`delete from model_assignments where newsroom_id = ${newsroomId}`;
    for (const row of clean) {
      await sql`
        insert into model_assignments (newsroom_id, job_key, rank, provider_id, effort)
        values (${newsroomId}, ${row.jobKey}, ${row.rank}, ${row.providerId}, ${row.effort})
      `;
    }
  });
  return readModelAssignments(newsroomId);
}
