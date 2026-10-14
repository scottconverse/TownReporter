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
    // DHC06: the first kill remembers the status the lead held before it, so
    // Undo and "Bring back" put it back. DHC09: a kill on a lead that is already
    // killed keeps the first kill record (its time, its status, its reason) and
    // only adds the new note to the reason, after a " · " separator (DHD2-8).
    // DHD2-3: a kill with no reason typed keeps the reason the lead already has,
    // and the first kill remembers that reason so Undo can put it back.
    await sql`
      update leads set status = 'killed',
              kill_prior_status = case when status = 'killed' then kill_prior_status else status end,
              kill_prior_reason = case when status = 'killed' then kill_prior_reason else kill_reason end,
              killed_at = case when status = 'killed' then killed_at else now() end,
              kill_reason = case
                when ${reason || null}::text is null then kill_reason
                when status <> 'killed' then ${reason || null}::text
                when coalesce(btrim(kill_reason), '') = '' then ${reason || null}::text
                else kill_reason || ' · Killed again: ' || ${reason || null}::text
              end,
              kill_reason_url = case
                when status = 'killed' then coalesce(kill_reason_url, ${data.killReasonUrl?.trim() || null}::text)
                else ${data.killReasonUrl?.trim() || null}::text
              end
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
    const [lead] = await sql<{ status: string; has_draft: boolean; has_published: boolean }>`
      select leads.status,
        exists (select 1 from drafts where drafts.lead_id = leads.id and drafts.newsroom_id = ${newsroomId} and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')) as has_draft,
        exists (select 1 from articles where articles.lead_id = leads.id and articles.newsroom_id = ${newsroomId} and articles.status = 'published') as has_published
      from leads where id = ${data.id} and newsroom_id = ${newsroomId}
    `;
    if (!lead) return { ok: false as const, error: "That lead is no longer on the desk." };

    const publishedWarning = lead.status === "published" || lead.has_published
      ? await editorWarning(
          { ...ctx, sql },
          typeof context === "number" ? undefined : data.override,
          "lead-duplicate-new-published",
          "This lead has a published story. Moving it to New will leave that story published.",
          { kind: "lead", id: data.id },
        )
      : null;
    if (publishedWarning) return publishedWarning;
    const draftedWarning = lead.status === "drafted" || lead.has_draft
      ? await editorWarning(
          { ...ctx, sql },
          typeof context === "number" ? undefined : data.override,
          "lead-duplicate-new-drafted",
          "This lead has a written draft. Moving it to New will keep the saved draft.",
          { kind: "lead", id: data.id },
        )
      : null;
    if (draftedWarning) return draftedWarning;

    // DHD2-6: the duplicate kill reason goes with the duplicate call. A reason
    // the editor wrote in their own words stays.
    const rows = await sql<{ id: number }>`
      update leads
      set possible_duplicate_of = null, dup_kind = null,
          status = 'new',
          kill_reason = case when kill_reason like 'Duplicate of %' then null else kill_reason end
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

/** The way back from a kill or a hold: an Undo, or a Bring back from the Killed pile. */
export interface LeadRestoreRequest {
  id: number;
  status?: "new" | "held" | "drafted";
  /**
   * Bring back keeps the kill record (its time and its reason). An Undo does
   * not: it takes the kill off the lead, so the lead is as it was before the press.
   */
  keepRecord?: boolean;
  /** The keys the editor has already approved, for the warnings a Hold's Undo may raise. */
  override?: string[];
}

/**
 * The way back from a kill or a hold (`restoreKilledLead` in desk.ts is the thin
 * wrapper).
 *
 * With no status asked for, the lead goes back to the status it held when the
 * kill was pressed (`kill_prior_status`). `drafted` is allowed only when the
 * lead still has a draft; a lead remembered as drafted whose draft is gone
 * comes back as `new`, and an explicit ask for `drafted` with no draft is refused
 * before anything is written.
 *
 * An Undo (no `keepRecord`) also clears what the kill wrote: `killed_at`, the
 * kill's reason (back to the reason the lead had before, `kill_prior_reason`)
 * and its reason link. A Bring back keeps `killed_at` and the kill's reason, so
 * the lead's history line still says when it was killed and why.
 *
 * THE HOLD'S WAY BACK (TIA-2, walk step TIA-2). A HOLD had no undo of its own:
 * the toast's Undo re-sent the Hold's own write in reverse (`setLeadStatus` with
 * `new`), which is the ordinary status path -- so on the ordinary held lead the
 * WALKER had in front of them, a lead with a written draft, `setLeadStatusForEditor`
 * raised its drafted warning, refused the write, and the optimistic move rolled
 * back. The lead stayed held and nothing said so.
 *
 * A hold is put back by the same write a kill is, because it is the same shape of
 * undoing: a lead that is not `new` right now and has to become `new` again,
 * exactly, with nothing else written on it. This function is therefore that write
 * made general -- it takes the status a HOLD is undoing from as well as `killed`.
 * The reasons for the two conditions are unchanged for both:
 *
 *   - the lead must be `killed` or `held` right now. An Undo is the way back from
 *     one of those presses and nothing else; without this the call would be a
 *     general "set any status" door with a friendly name, and `drafted` would be
 *     reachable from any row.
 *   - a lead going back to `drafted` must still have its draft.
 *
 * A HOLD IS NOT WRITABLE TO `drafted`, which is why the `held` branch below runs
 * the same warning gate a Hold does and refuses `drafted` outright: the only
 * statuses a Hold can be taken back to are `new` (it was an open lead) and
 * `drafted` (the desk had already drafted it, and a Hold does not remove the
 * draft). The gate is what keeps the shape of this call from being a way around
 * the published story or the saved draft; it WARNs and never blocks, and the
 * keys the editor already approved come in on `override` (TIA-2).
 */
export async function restoreKilledLeadForEditor(
  sql: AuditSqlTag,
  context: LeadLifecycleContext | number,
  data: LeadRestoreRequest,
) {
  const { context: ctx, newsroomId } = normalizeContext(context);
  /*
    The lead is read twice on purpose. This first read answers the two questions
    every way back asks -- is it `killed` or `held`, and if killed, where does it
    go -- and touches nothing else, so the kill path costs exactly what it did
    before (two tables, no joins). The draft and published facts below are read
    only for a HELD lead, which is the only status whose warnings are raised here;
    a query that carried them for every call would make the kill path depend on
    `drafts` and `articles` being there, which three of this file's own callers
    do not stand up.
  */
  const [current] = await sql<{ prior: string | null; status: string }>`
    select kill_prior_status as prior, leads.status from leads
    where id = ${data.id} and newsroom_id = ${newsroomId} and status in ('killed', 'held')
  `;
  if (!current) return { ok: false as const, error: "That lead is not killed or held." };

  /*
    A kill remembers where it came from (`kill_prior_status`, DHC06) and is put
    back there. A hold has nothing to remember and does not need to: the two
    statuses a Hold can hide are both still visible on the lead -- `drafted` is
    the status it kept, and `new` is what an open lead answers to -- so the write
    the press carried (`data.status`) is the answer, and a caller that names
    nothing gets `new`, where the toast's Undo has always sent it.
  */
  const remembered = current.status === "killed"
    ? current.prior === "held" || current.prior === "drafted" ? current.prior : "new"
    : "new";
  let back: "new" | "held" | "drafted" = data.status ?? remembered;

  /*
    HOLDING IS REVERSIBLE AND ONLY INTO AN OPEN LEAD. A held lead taken back goes
    to `new` or to `drafted`; anything else -- `held` again, which is no way back
    at all -- is refused rather than written, and the refusal is the desk's
    ordinary `{ok:false, error}` so the row rolls back and the toast says why.
  */
  if (current.status === "held" && back !== "new" && back !== "drafted") {
    return { ok: false as const, error: "A held lead goes back to New." };
  }

  if (current.status === "held") {
    /*
      The warnings a Hold itself would raise, raised here instead: this write
      undoes a Hold and is otherwise the same status change. It is the same pair
      of keys, the same sentences and the same "warn, never block" answer, so an
      editor who approved the Hold is asked once and not twice (`override`).

      The two facts come from the same expressions `setLeadStatusForEditor`
      reads, so the same lead raises the same warning here as it did on the way in.
    */
    await ensureAuditEventsSchema(sql as never);
    const [facts] = await sql<{ has_draft: boolean; has_published: boolean }>`
      select
        exists (select 1 from drafts where drafts.lead_id = ${data.id} and drafts.newsroom_id = ${newsroomId} and (drafts.body ~ '[^[:space:]]' or coalesce(nullif(btrim(drafts.research_json), ''), '{}')::jsonb->>'importedText' = 'true')) as has_draft,
        exists (select 1 from articles where articles.lead_id = ${data.id} and articles.newsroom_id = ${newsroomId} and articles.status = 'published') as has_published
    `;
    const publishedWarning = facts?.has_published
      ? await editorWarning(
          { ...ctx, sql },
          typeof context === "number" ? undefined : data.override,
          "lead-status-published",
          "This lead has a published story. Changing the lead status will leave that story published.",
          { kind: "lead", id: data.id },
        )
      : null;
    if (publishedWarning) return publishedWarning;
    const draftedWarning = facts?.has_draft
      ? await editorWarning(
          { ...ctx, sql },
          typeof context === "number" ? undefined : data.override,
          "lead-status-drafted",
          "This lead has a written draft. Changing its status will keep the saved draft.",
          { kind: "lead", id: data.id },
        )
      : null;
    if (draftedWarning) return draftedWarning;
  }

  if (back === "drafted") {
    const [draft] = await sql<{ id: number }>`
      select id from drafts where lead_id = ${data.id} and newsroom_id = ${newsroomId} limit 1
    `;
    if (!draft) {
      if (data.status === "drafted") return { ok: false as const, error: "That lead has no draft to go back to." };
      back = "new";
    }
  }
  const keep = data.keepRecord === true;
  const rows = await sql<{ id: number }>`
    update leads set status = ${back},
      kill_reason = case when ${keep}::boolean then kill_reason else kill_prior_reason end,
      kill_reason_url = case when ${keep}::boolean then kill_reason_url else null end,
      killed_at = case when ${keep}::boolean then killed_at else null end,
      kill_prior_status = null,
      kill_prior_reason = null
    where id = ${data.id} and newsroom_id = ${newsroomId} and status in ('killed', 'held')
    returning id
  `;
  if (!rows.length) return { ok: false as const, error: "That lead is not killed or held." };
  return { ok: true as const, status: back };
}
