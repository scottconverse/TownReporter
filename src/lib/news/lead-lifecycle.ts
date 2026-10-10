import type { AuditSqlTag } from "./ops.ts";
import { ensureAuditEventsSchema } from "./ops.ts";
import { editorWarning } from "./editor-override.ts";

/**
 * The editor-facing lifecycle edits (Hold/Kill, Compare's not-a-duplicate and
 * reopen-prior) now WARN instead of blocking, per Scott's rule (Oct 10, 2026).
 * The `sql` handle is threaded through so the override audit joins the same
 * connection the caller used (a hand-built PGlite in the tests, a transaction
 * in the desk) rather than the module-level `getSql()`.
 */
export interface LeadStatusRequest {
  id: number;
  status: "held" | "killed" | "new";
  killReason?: string;
  killReasonUrl?: string;
  /** The keys the editor has already approved this press. */
  override?: string[];
}

export interface LeadDuplicateResolutionRequest {
  id: number;
  action: "not-a-duplicate" | "reopen-prior";
  /** The keys the editor has already approved this press. */
  override?: string[];
}

/** The editor who is acting, so an override can be audited. `newsroomId` may
 * also be passed as a bare number (the pre-override shape) -- see below. */
export interface LeadLifecycleContext {
  userId: string;
  newsroomId: number;
}

function normalizeContext(
  context: LeadLifecycleContext | number,
): { context: LeadLifecycleContext; newsroomId: number } {
  if (typeof context === "number") {
    // Legacy shape retained for existing callers. There is no editor to audit
    // an override against, so the override keys are simply not honoured here --
    // a caller that wants Scott's rule passes `{ userId, newsroomId }`.
    return { context: { userId: "", newsroomId: context }, newsroomId: context };
  }
  return { context, newsroomId: context.newsroomId };
}

export async function setLeadStatusForEditor(
  sql: AuditSqlTag,
  context: LeadLifecycleContext | number,
  data: LeadStatusRequest,
  notesJson?: string,
) {
  const { context: ctx, newsroomId } = normalizeContext(context);
  const reason = data.killReason?.trim();
  // The override audit writes through `sql`, so the schema has to exist on that
  // same database before we write (the ensure is DDL and idempotent).
  await ensureAuditEventsSchema(sql as never);

  // A lead that is gone is HARD, for kill and hold alike, and checked first so
  // no policy warning can stand in front of it.
  const [lead] = await sql<{ status: string; has_draft: boolean; has_published: boolean }>`
    select leads.status,
      exists (select 1 from drafts where drafts.lead_id = leads.id and drafts.newsroom_id = ${newsroomId} and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')) as has_draft,
      exists (select 1 from articles where articles.lead_id = leads.id and articles.newsroom_id = ${newsroomId} and articles.status = 'published') as has_published
    from leads where id = ${data.id} and newsroom_id = ${newsroomId}
  `;
  if (!lead) return { ok: false as const, error: "That lead is no longer on the desk." };

  // Item 5: a published story or a saved draft WARNS (never blocks) -- and this
  // now runs for a KILL as well as a hold. The old code early-returned on kill
  // and so never checked either.
  const publishedWarning = lead.status === "published" || lead.has_published
    ? await editorWarning(
        { ...ctx, sql },
        typeof context === "number" ? undefined : data.override,
        "lead-status-published",
        "This lead has a published story. Changing the lead status will leave that story published.",
        { kind: "lead", id: data.id },
      )
    : null;
  if (publishedWarning) return publishedWarning;
  const draftedWarning = lead.status === "drafted" || lead.has_draft
    ? await editorWarning(
        { ...ctx, sql },
        typeof context === "number" ? undefined : data.override,
        "lead-status-drafted",
        "This lead has a written draft. Changing its status will keep the saved draft.",
        { kind: "lead", id: data.id },
      )
    : null;
  if (draftedWarning) return draftedWarning;

  if (data.status === "killed") {
    await sql`
      update leads set status = 'killed', killed_at = now(),
              kill_reason = ${reason || null},
              kill_reason_url = ${data.killReasonUrl?.trim() || null}
      where id = ${data.id} and newsroom_id = ${newsroomId}
    `;
    return { ok: true as const };
  }
  await sql`
    update leads set status = ${data.status},
      notes_json = case when ${notesJson !== undefined} then ${notesJson ?? null} else notes_json end
    where id = ${data.id} and newsroom_id = ${newsroomId}
  `;
  return { ok: true as const };
}

export async function resolveLeadDuplicateForEditor(
  sql: AuditSqlTag,
  context: LeadLifecycleContext | number,
  data: LeadDuplicateResolutionRequest,
) {
  const { context: ctx, newsroomId } = normalizeContext(context);
  await ensureAuditEventsSchema(sql as never);
  if (data.action === "not-a-duplicate") {
    const rows = await sql<{ id: number }>`
      update leads
      set possible_duplicate_of = null, dup_kind = null,
          status = case when status = 'held' then 'new' else status end
      where id = ${data.id} and newsroom_id = ${newsroomId}
      returning id
    `;
    if (!rows.length) return { ok: false as const, error: "That lead is no longer on the desk." };
    return { ok: true as const, action: data.action };
  }
  const reopened = await sql<{ id: number }>`
    update leads as prior
    set status = 'new'
    where prior.newsroom_id = ${newsroomId}
      and prior.id = (select possible_duplicate_of from leads
                      where id = ${data.id} and newsroom_id = ${newsroomId})
      and prior.status = 'killed'
      and not exists (
        select 1 from drafts
        where drafts.lead_id = prior.id and drafts.newsroom_id = ${newsroomId}
          and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')
      )
      and not exists (
        select 1 from articles
        where articles.lead_id = prior.id and articles.newsroom_id = ${newsroomId}
          and articles.status = 'published'
      )
    returning prior.id as id
  `;
  if (!reopened.length) {
    const [link] = await sql<{
      prior_id: number | null;
      prior_status: string | null;
      has_draft: boolean;
      has_published: boolean;
    }>`
      select prior.id as prior_id, prior.status as prior_status,
        exists (select 1 from drafts where drafts.lead_id = prior.id and drafts.newsroom_id = ${newsroomId} and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')) as has_draft,
        exists (select 1 from articles where articles.lead_id = prior.id and articles.newsroom_id = ${newsroomId} and articles.status = 'published') as has_published
      from leads current
      left join leads prior on prior.id = current.possible_duplicate_of and prior.newsroom_id = ${newsroomId}
      where current.id = ${data.id} and current.newsroom_id = ${newsroomId}
    `;
    if (!link) return { ok: false as const, error: "That lead is no longer on the desk." };
    if (link.prior_id === null) {
      return { ok: false as const, error: "There is no earlier lead to reopen for this one." };
    }
    if (link.prior_status === "published" || link.has_published) {
      const pub = await editorWarning(
        { ...ctx, sql },
        typeof context === "number" ? undefined : data.override,
        "lead-duplicate-published",
        "That earlier lead has a published story. Reopening the lead will keep that story published.",
        { kind: "lead", id: link.prior_id },
      );
      if (pub) return pub;
      return await reopenPrior(sql, newsroomId, data.id);
    }
    if (link.prior_status === "drafted" || link.has_draft) {
      const drafted = await editorWarning(
        { ...ctx, sql },
        typeof context === "number" ? undefined : data.override,
        "lead-duplicate-drafted",
        "That earlier lead has a saved draft. Reopening the lead will keep its draft.",
        { kind: "lead", id: link.prior_id },
      );
      if (drafted) return drafted;
      return await reopenPrior(sql, newsroomId, data.id);
    }
    if (link.prior_status !== "killed") {
      const moved = await editorWarning(
        { ...ctx, sql },
        typeof context === "number" ? undefined : data.override,
        "lead-duplicate-moved",
        "That earlier lead is no longer killed. Reopening it will set its status to New.",
        { kind: "lead", id: link.prior_id },
      );
      if (moved) return moved;
      return await reopenPrior(sql, newsroomId, data.id);
    }
    return { ok: false as const, error: "That earlier lead changed. Refresh the desk and try again." };
  }
  return { ok: true as const, action: data.action, priorId: reopened[0]!.id };
}

/**
 * The reopen an approved override asked for: reopen the prior lead regardless of
 * the policy conditions that would otherwise hold it back (a saved draft or a
 * published story). It is the second press, so it does what it says.
 */
async function reopenPrior(sql: AuditSqlTag, newsroomId: number, id: number) {
  const rows = await sql<{ id: number }>`
    update leads as prior
    set status = 'new'
    where prior.newsroom_id = ${newsroomId}
      and prior.id = (select possible_duplicate_of from leads
                      where id = ${id} and newsroom_id = ${newsroomId})
    returning prior.id as id
  `;
  return { ok: true as const, action: "reopen-prior" as const, priorId: rows[0]?.id ?? null };
}
