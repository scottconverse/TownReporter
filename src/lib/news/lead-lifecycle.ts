import type { SqlTag } from "./lead-filing.ts";

export interface LeadStatusRequest {
  id: number;
  status: "held" | "killed" | "new";
  killReason?: string;
  killReasonUrl?: string;
}

export interface LeadDuplicateResolutionRequest {
  id: number;
  action: "not-a-duplicate" | "reopen-prior";
}

export async function setLeadStatusForEditor(
  sql: SqlTag,
  newsroomId: number,
  data: LeadStatusRequest,
  notesJson?: string,
) {
  const reason = data.killReason?.trim();
  if (data.status === "killed") {
    await sql`
      update leads set status = 'killed', killed_at = now(),
              kill_reason = ${reason || null},
              kill_reason_url = ${data.killReasonUrl?.trim() || null}
      where id = ${data.id} and newsroom_id = ${newsroomId}
    `;
    return { ok: true as const };
  }
  const changed = await sql<{ id: number }>`
    update leads set status = ${data.status},
      notes_json = case when ${notesJson !== undefined} then ${notesJson ?? null} else notes_json end
    where id = ${data.id} and newsroom_id = ${newsroomId}
      and status not in ('drafted', 'published')
      and not exists (
        select 1 from drafts
        where drafts.lead_id = leads.id and drafts.newsroom_id = ${newsroomId}
          and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')
      )
      and not exists (
        select 1 from articles
        where articles.lead_id = leads.id and articles.newsroom_id = ${newsroomId}
          and articles.status = 'published'
      )
    returning id
  `;
  if (!changed.length) {
    const [lead] = await sql<{
      status: string;
      has_draft: boolean;
      has_published: boolean;
    }>`
      select leads.status,
        exists (select 1 from drafts where drafts.lead_id = leads.id and drafts.newsroom_id = ${newsroomId} and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')) as has_draft,
        exists (select 1 from articles where articles.lead_id = leads.id and articles.newsroom_id = ${newsroomId} and articles.status = 'published') as has_published
      from leads where id = ${data.id} and newsroom_id = ${newsroomId}
    `;
    if (!lead) return { ok: false as const, error: "That lead is no longer on the desk." };
    if (lead.status === "published" || lead.has_published) {
      return { ok: false as const, error: "This story is already published. Unpublish it first." };
    }
    if (lead.status === "drafted" || lead.has_draft) {
      return { ok: false as const, error: "This lead has a written draft. Kill or finish the draft instead." };
    }
    return { ok: false as const, error: "That lead's status changed. Refresh the desk and try again." };
  }
  return { ok: true as const };
}

export async function resolveLeadDuplicateForEditor(
  sql: SqlTag,
  newsroomId: number,
  data: LeadDuplicateResolutionRequest,
) {
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
      return { ok: false as const, error: "That earlier lead has a published story and cannot be reopened." };
    }
    if (link.prior_status === "drafted" || link.has_draft) {
      return { ok: false as const, error: "That earlier lead has a saved draft and cannot be reopened." };
    }
    if (link.prior_status !== "killed") {
      return { ok: false as const, error: "That earlier lead is no longer killed, so it cannot be reopened." };
    }
    return { ok: false as const, error: "That earlier lead changed. Refresh the desk and try again." };
  }
  return { ok: true as const, action: data.action, priorId: reopened[0]!.id };
}
