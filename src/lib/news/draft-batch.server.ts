import { getSql, withTransaction, type Sql } from "../db.ts";
import { assertRate } from "./ops.ts";
import { parseNotes } from "./notes.ts";
import { kickJobs } from "./jobs.ts";
import {
  forcedRuntimeLabel,
  parseForcedRuntimeSnapshot,
  validateForcedRuntime,
  type ForcedRuntimeSnapshot,
} from "./forced-runtime.server.ts";
import type {
  DraftBatchFailure,
  DraftBatchResult,
  DraftBatchStartItem,
  DraftBatchView,
} from "./draft-batch.ts";
import type { AuthenticatedEditorContext } from "./model-request-commit.server.ts";

export const validateBatchRuntime = validateForcedRuntime;

export function parseDraftBatchCompletion(value: unknown): {
  draftId: number;
  evidenceCheckIncomplete: boolean;
} | null {
  try {
    const row = typeof value === "string" ? JSON.parse(value) : value;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const result = row as Record<string, unknown>;
    if (result.version !== 1 || !Number.isSafeInteger(result.draftId) || Number(result.draftId) <= 0)
      return null;
    return {
      draftId: Number(result.draftId),
      evidenceCheckIncomplete: result.evidenceCheckIncomplete === true,
    };
  } catch {
    return null;
  }
}

export async function isCurrentBatchEditor(context: AuthenticatedEditorContext): Promise<boolean> {
  const [member] = await (
    await getSql()
  ).query(
    "select 1 from newsroom_members where newsroom_id=$1 and user_id=$2 and role in ('owner','editor')",
    [context.newsroomId, context.userId],
  );
  return Boolean(member);
}

export function batchRuntimeFailure(error: unknown): DraftBatchFailure {
  const message = error instanceof Error ? error.message : "The selected runtime is unavailable.";
  return {
    ok: false,
    code: /^Rate limit:/i.test(message) ? "rate-limited" : "runtime-unavailable",
    error: message,
  };
}

let draftBatchSchemaReady: Promise<void> | null = null;

export function ensureDraftBatchSchema(provided?: Sql): Promise<void> {
  draftBatchSchemaReady ??= (async () => {
    const sql = provided ?? (await getSql());
    await sql.query(
      "create table if not exists draft_batches(id serial primary key,newsroom_id integer not null references newsrooms(id),user_id text not null,runtime_snapshot jsonb not null,created_at timestamptz not null default now())",
    );
    await sql.query("alter table desk_jobs add column if not exists draft_batch_id integer");
    await sql.query(
      "create index if not exists draft_batches_newsroom_idx on draft_batches(newsroom_id,id desc)",
    );
    await sql.query(
      "do $$ begin if not exists(select 1 from pg_constraint where conname='desk_jobs_draft_batch_fk') then alter table desk_jobs add constraint desk_jobs_draft_batch_fk foreign key(draft_batch_id) references draft_batches(id); end if; end $$",
    );
    await sql.query(
      "create index if not exists desk_jobs_draft_batch_idx on desk_jobs(newsroom_id,draft_batch_id,id) where draft_batch_id is not null",
    );
  })().catch((error) => {
    draftBatchSchemaReady = null;
    throw error;
  });
  return draftBatchSchemaReady;
}

type CommitDeps = {
  accountRate?: boolean;
  kick?: boolean;
  assertRate?: typeof assertRate;
  afterSelectionLocked?: () => Promise<void>;
};
type LeadState = { id: number; status: string; notes_json: string | null };
const isIneligible = (status: string) =>
  status === "held" || status === "killed" || status === "published";

type ResolvedItem = { leadId: number; researchScope: "public" | "supplied" };

async function inspectSelection(
  sql: Sql,
  input: {
    context: AuthenticatedEditorContext;
    items: DraftBatchStartItem[];
  },
  runtimeSnapshot: ForcedRuntimeSnapshot,
  lock: boolean,
): Promise<{ ok: true; items: ResolvedItem[] } | DraftBatchFailure> {
  const [member] = await sql.query(
    "select 1 from newsroom_members where newsroom_id=$1 and user_id=$2 and role in ('owner','editor')" +
      (lock ? " for share" : ""),
    [input.context.newsroomId, input.context.userId],
  );
  if (!member) {
    return { ok: false, code: "not-found", error: "Draft batch could not be started." };
  }
  const requested = [...input.items].sort((a, b) => a.leadId - b.leadId);
  const leads = await sql.query<LeadState>(
    "select id,status,notes_json from leads where newsroom_id=$1 and id=any($2::int[]) order by id" +
      (lock ? " for update" : ""),
    [input.context.newsroomId, requested.map((item) => item.leadId)],
  );
  if (leads.length !== requested.length) {
    return { ok: false, code: "not-found", error: "Lead not found." };
  }
  const leadById = new Map(leads.map((lead) => [Number(lead.id), lead]));
  const items: ResolvedItem[] = [];
  for (const item of input.items) {
    const lead = leadById.get(item.leadId)!;
    if (isIneligible(lead.status)) {
      return {
        ok: false,
        code: "ineligible",
        error: "This lead is not eligible for batch drafting.",
        leadId: item.leadId,
      };
    }
    const scope = item.researchScope ?? parseNotes(lead.notes_json).researchScope ?? "public";
    if (
      scope === "supplied" &&
      (runtimeSnapshot.runtime === "codex-terra" || runtimeSnapshot.runtime === "codex-sol")
    ) {
      return {
        ok: false,
        code: "ineligible",
        error: "Use only supplied material requires Claude Code or a local model.",
        leadId: item.leadId,
      };
    }
    items.push({ leadId: item.leadId, researchScope: scope });
  }
  const [open] = await sql.query<{ id: number; subject_id: number }>(
    "select id,subject_id from desk_jobs where newsroom_id=$1 and kind='draft' and subject_id=any($2::int[]) and status in ('queued','running') order by id limit 1",
    [input.context.newsroomId, input.items.map((item) => item.leadId)],
  );
  if (open) {
    return {
      ok: false,
      code: "already-running",
      error: "A selected lead is already drafting.",
      leadId: Number(open.subject_id),
      jobId: Number(open.id),
    };
  }
  return { ok: true, items };
}

async function batchView(
  sql: Sql,
  context: AuthenticatedEditorContext,
  batchId?: number,
): Promise<{ ok: true; batch: DraftBatchView | null } | DraftBatchFailure> {
  const params: unknown[] = [context.newsroomId];
  const idClause = batchId === undefined ? "" : "and b.id=$2";
  if (batchId !== undefined) params.push(batchId);
  const [batch] = await sql.query<{
    id: number;
    created_at: Date | string;
    runtime_snapshot: unknown;
  }>(
    "select b.id,b.created_at,b.runtime_snapshot from draft_batches b where b.newsroom_id=$1 " +
      idClause +
      " order by b.id desc limit 1",
    params,
  );
  if (!batch) {
    return batchId === undefined
      ? { ok: true, batch: null }
      : { ok: false, code: "not-found", error: "Draft batch not found." };
  }
  const snapshot = parseForcedRuntimeSnapshot(batch.runtime_snapshot);
  if (!snapshot) return { ok: false, code: "not-found", error: "Draft batch not found." };
  const jobs = await sql.query<{
    subject_id: number;
    id: number;
    status: DraftBatchView["items"][number]["status"];
    stage: string;
    error: string | null;
    result_json: string;
  }>(
    "select subject_id,id,status,stage,error,result_json from desk_jobs where newsroom_id=$1 and draft_batch_id=$2 order by id",
    [context.newsroomId, batch.id],
  );
  const parsed = new Map(jobs.map((job) => [job.id, parseDraftBatchCompletion(job.result_json)]));
  const candidateDraftIds = [...new Set([...parsed.values()].flatMap((row) => row ? [row.draftId] : []))];
  const boundDrafts = candidateDraftIds.length
    ? await sql.query<{ id: number; lead_id: number }>(
        "select id,lead_id from drafts where newsroom_id=$1 and id=any($2::int[])",
        [context.newsroomId, candidateDraftIds],
      )
    : [];
  const validDrafts = new Map(boundDrafts.map((draft) => [Number(draft.id), Number(draft.lead_id)]));
  return {
    ok: true,
    batch: {
      id: Number(batch.id),
      createdAt:
        batch.created_at instanceof Date
          ? batch.created_at.toISOString()
          : new Date(batch.created_at).toISOString(),
      runtime: { runtime: snapshot.runtime, label: forcedRuntimeLabel(snapshot) },
      items: jobs.map((job) => {
        const completion = parsed.get(job.id);
        const draftId = completion && validDrafts.get(completion.draftId) === Number(job.subject_id)
          ? completion.draftId
          : null;
        return {
        leadId: Number(job.subject_id),
        jobId: Number(job.id),
        status: job.status,
        stage: job.stage,
        error: job.error,
        draftId,
        evidenceCheckIncomplete: draftId != null && completion?.evidenceCheckIncomplete === true,
        workbenchHref: "/desk/story/" + job.subject_id,
        };
      }),
    },
  };
}

export async function readDraftBatchForAuthenticatedEditor(
  context: AuthenticatedEditorContext,
  batchId?: number,
) {
  if (batchId !== undefined && (!Number.isSafeInteger(batchId) || batchId <= 0)) {
    return {
      ok: false as const,
      code: "invalid-input" as const,
      error: "Draft batch ID must be a positive integer.",
    };
  }
  if (!(await isCurrentBatchEditor(context))) {
    return batchId === undefined
      ? { ok: true as const, batch: null }
      : { ok: false as const, code: "not-found" as const, error: "Draft batch not found." };
  }
  const sql = await getSql();
  await ensureDraftBatchSchema(sql);
  return batchView(sql, context, batchId);
}

export async function commitDraftBatchForAuthenticatedEditor(
  input: {
    context: AuthenticatedEditorContext;
    items: DraftBatchStartItem[];
    runtimeSnapshot: unknown;
  },
  deps: CommitDeps = {},
): Promise<DraftBatchResult> {
  const ids = new Set(input.items.map((item) => item.leadId));
  if (
    input.items.length < 1 ||
    input.items.length > 5 ||
    ids.size !== input.items.length ||
    input.items.some(
      (item) =>
        !Number.isSafeInteger(item.leadId) ||
        item.leadId <= 0 ||
        (item.researchScope !== undefined &&
          item.researchScope !== "public" &&
          item.researchScope !== "supplied"),
    )
  ) {
    return { ok: false, code: "invalid-input", error: "Draft batch input is invalid." };
  }
  const runtimeSnapshot = parseForcedRuntimeSnapshot(input.runtimeSnapshot);
  if (!runtimeSnapshot) {
    return { ok: false, code: "invalid-input", error: "The selected runtime snapshot is invalid." };
  }
  const sql = await getSql();
  await ensureDraftBatchSchema(sql);
  const preflight = await inspectSelection(sql, input, runtimeSnapshot, false);
  if (!preflight.ok) return preflight;
  if (deps.accountRate !== false) {
    try {
      for (const _item of input.items) {
        await (deps.assertRate ?? assertRate)(
          input.context.userId,
          "draft",
          input.context.newsroomId,
        );
      }
    } catch (error) {
      return {
        ok: false,
        code: "rate-limited",
        error: error instanceof Error ? error.message : "Draft rate limit reached.",
      };
    }
  }
  try {
    const created = await withTransaction(async (tx) => {
      const checked = await inspectSelection(tx, input, runtimeSnapshot, true);
      if (!checked.ok) return checked;
      await deps.afterSelectionLocked?.();
      const [batch] = await tx.query<{ id: number }>(
        "insert into draft_batches(newsroom_id,user_id,runtime_snapshot) values($1,$2,$3::jsonb) returning id",
        [input.context.newsroomId, input.context.userId, JSON.stringify(runtimeSnapshot)],
      );
      for (const item of checked.items) {
        await tx.query(
          "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,draft_batch_id) values($1,$2,'draft',$3,$4,'editor',$5,'default','queued','Queued',$6)",
          [
            input.context.newsroomId,
            input.context.userId,
            item.leadId,
            runtimeSnapshot.modelChoice,
            item.researchScope,
            batch.id,
          ],
        );
      }
      return { ok: true as const, batchId: Number(batch.id) };
    });
    if (!created.ok) return created;
    if (deps.kick !== false) kickJobs();
    const view = await batchView(sql, input.context, created.batchId);
    if (!view.ok) return view;
    if (!view.batch) throw new Error("Draft batch disappeared after it was queued.");
    return { ok: true, batch: view.batch };
  } catch (error) {
    if (/unique|duplicate/i.test(String(error))) {
      const [open] = await sql.query<{ id: number; subject_id: number }>(
        "select id,subject_id from desk_jobs where newsroom_id=$1 and kind='draft' and subject_id=any($2::int[]) and status in ('queued','running') order by id limit 1",
        [input.context.newsroomId, input.items.map((item) => item.leadId)],
      );
      if (open) {
        return {
          ok: false,
          code: "already-running",
          error: "A selected lead is already drafting.",
          leadId: Number(open.subject_id),
          jobId: Number(open.id),
        };
      }
    }
    throw error;
  }
}

export async function assertDraftBatchCanContinue(
  sql: Sql,
  job: { id: number; newsroom_id: number; user_id: string; claim_token?: string | null },
): Promise<ForcedRuntimeSnapshot | null> {
  const [jobRow] = await sql.query<{ draft_batch_id: number | null }>(
    "select draft_batch_id from desk_jobs where id=$1 and newsroom_id=$2",
    [job.id, job.newsroom_id],
  );
  if (!jobRow?.draft_batch_id) return null;
  const [row] = await sql.query<{ runtime_snapshot: unknown }>(
    "select b.runtime_snapshot from desk_jobs j join draft_batches b on b.id=j.draft_batch_id and b.newsroom_id=j.newsroom_id and b.user_id=j.user_id join newsroom_members m on m.newsroom_id=j.newsroom_id and m.user_id=j.user_id and m.role in ('owner','editor') where j.id=$1 and j.newsroom_id=$2 and j.status='running' and j.claim_token=$3",
    [job.id, job.newsroom_id, job.claim_token],
  );
  if (!row) {
    const [batchJob] = await sql.query(
      "select 1 from desk_jobs where id=$1 and newsroom_id=$2 and draft_batch_id is not null",
      [job.id, job.newsroom_id],
    );
    if (batchJob) throw new Error("Draft batch permission or job lease was withdrawn.");
    return null;
  }
  const snapshot = parseForcedRuntimeSnapshot(row.runtime_snapshot);
  if (!snapshot) throw new Error("Draft batch runtime snapshot is invalid.");
  return snapshot;
}

/**
 * Persist a batch side effect only while the originating job lease and editor
 * membership are still current. The job row remains locked through `write`,
 * so a reclaimer cannot replace the claim between the check and the write.
 */
export async function withDraftBatchLease<T>(
  job: { id: number; newsroom_id: number; user_id: string; claim_token?: string | null },
  write: (sql: Sql) => Promise<T>,
): Promise<T> {
  return withTransaction(async (sql) => {
    const [row] = await sql.query<{ runtime_snapshot: unknown }>(
      "select b.runtime_snapshot from desk_jobs j join draft_batches b on b.id=j.draft_batch_id and b.newsroom_id=j.newsroom_id and b.user_id=j.user_id where j.id=$1 and j.newsroom_id=$2 and j.user_id=$3 and j.status='running' and j.claim_token=$4 for update of j",
      [job.id, job.newsroom_id, job.user_id, job.claim_token],
    );
    if (!row || !parseForcedRuntimeSnapshot(row.runtime_snapshot)) {
      throw new Error("Draft batch permission or job lease was withdrawn.");
    }
    const [member] = await sql.query(
      "select 1 from newsroom_members where newsroom_id=$1 and user_id=$2 and role in ('owner','editor') for share",
      [job.newsroom_id, job.user_id],
    );
    if (!member) throw new Error("Draft batch permission or job lease was withdrawn.");
    return write(sql);
  });
}
