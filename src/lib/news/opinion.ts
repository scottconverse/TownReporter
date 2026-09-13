import { evidenceReviewToken, type EvidenceDecision } from "./draft-evidence.ts";
import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { audit } from "./ops";
import { latestJob, runLooksStalled } from "./jobs";
import { DEFAULT_NEWSROOM_ID } from "./membership";
import { opinionModelChoice } from "./model-choice.ts";
import { checkOpinionReadiness } from "./opinion-readiness.ts";

/**
 * The Opinion desk.
 *
 * Editorials live apart from news drafts on purpose: an unsigned piece stating
 * the paper's position must never be picked up mid-edit and mistaken for a
 * report. Separate page, separate list, OPINION in the headline.
 *
 * Every call here only ever ENQUEUES. Writing one takes ten to forty minutes
 * because the voice fetches its own records first, so nothing on this desk
 * waits on the model.
 */
function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

export type EditorialRow = {
  id: number;
  subject: string;
  source_kind: string;
  source_ref: string;
  model_choice: string;
  draft_id: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  headline: string | null;
  words: number | null;
  published_slug: string | null;
  /** Latest durable desk job stage for an open request (for live progress UI). */
  stage?: string;
  /**
   * True when the row looks like it is still being written (no finished_at,
   * no error) but the desk_jobs heartbeat behind it is cold or missing --
   * most likely the app restarted mid-piece. See `runLooksStalled`. Left
   * undefined on finished rows so the client's `!r.finished_at` checks stay
   * the source of truth for "is this open at all".
   */
  stalled?: boolean;
};

export const getFailedEditorialMaterial = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((requestId: number) => requestId)
  .handler(async ({ context, data: requestId }) => {
    const { ensureEditorialRequestSchema } = await import("./editorial.server");
    await ensureEditorialRequestSchema();
    const sql = await getSql();
    const [row] = await sql<{ source_text: string; asked_for: string; error: string | null; finished_at: string | null; draft_id: number | null }>`
      select source_text, asked_for, error, finished_at, draft_id from editorial_requests
      where id=${requestId} and newsroom_id=${owned(context)} limit 1
    `;
    if (!row || !row.finished_at || !row.error || row.draft_id !== null) return { ok: false as const, error: "That failed request has no restorable material." };
    const [docs] = await sql<{ count: number }>`select count(*) as count from story_documents where editorial_request_id=${requestId} and newsroom_id=${owned(context)}`;
    const attachmentCount = Number(docs?.count ?? 0);
    if (!row.source_text && !attachmentCount) return { ok: false as const, error: "This older request was saved before full-paste recovery existed; its missing text cannot be reconstructed." };
    return { ok: true as const, requestId, sourceText: row.source_text, askedFor: row.asked_for, attachmentCount };
  });

export const opinionReadiness = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((choice?: string) => opinionModelChoice(choice))
  .handler(async ({ context, data: choice }) => {
    return checkOpinionReadiness(choice, {}, owned(context));
  });

export const listEditorials = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<EditorialRow[]> => {
    const { ensureEditorialRequestSchema, ensureEditorialSchema } =
      await import("./editorial.server");
    await ensureEditorialRequestSchema();
    await ensureEditorialSchema();
    const sql = await getSql();
    const rows = await sql<EditorialRow>`
      select r.id, r.subject, r.source_kind, r.source_ref, r.model_choice,
             r.draft_id, r.error,
             r.created_at, r.finished_at,
             d.headline,
             case when d.body is null then null
                  else array_length(regexp_split_to_array(trim(d.body), '\\s+'), 1)
             end as words,
             a.slug as published_slug
      from editorial_requests r
      left join drafts d on d.id = r.draft_id and d.newsroom_id = r.newsroom_id
      left join articles a on a.headline = d.headline and a.status = 'published'
        and a.newsroom_id = r.newsroom_id
      where r.newsroom_id = ${owned(context)}
      order by r.id desc
    `.catch(() => []);
    /*
      Only rows that still look open are worth a job lookup. A piece writes
      for 10-40 minutes and this desk deliberately never polls faster than
      20s, so the `Elapsed` clock on `desk.opinion.tsx` was the only signal
      an editor had -- and it ticks forever whether the job is alive or the
      process that owned it died. `runLooksStalled` tells the two apart using
      the same heartbeat `executeJob` already keeps fresh for a live run.
    */
    for (const row of rows) {
      if (row.finished_at) continue;
      const job = await latestJob({
        newsroomId: owned(context),
        kind: "editorial",
        subjectId: row.id,
      });
      row.stage = job?.stage || undefined;
      row.stalled = runLooksStalled({ runOpen: true, job });
    }
    return rows;
  });

export const getEditorial = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((draftId: number) => draftId)
  .handler(async ({ context, data: draftId }) => {
    const { ensureEditorialSchema } = await import("./editorial.server");
    await ensureEditorialSchema();
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      headline: string;
      body: string;
      topic: string;
      dek: string;
      research_json: string | null;
      fact_sheet: string | null;
      image_prompt: string | null;
      source_kind: string | null;
      source_ref: string | null;
    }>`
      select d.id, d.headline, d.body, d.topic, d.dek, d.research_json,
             e.fact_sheet, e.image_prompt, e.source_kind, e.source_ref
      from drafts d
      left join editorial_extras e on e.draft_id = d.id
      where d.id = ${draftId} and d.newsroom_id = ${owned(context)} and d.form = 'editorial' and d.lead_id is null
      limit 1
    `;
    return rows[0] ?? null;
  });

/**
 * Ask for an editorial. Returns immediately; the job does the work.
 *
 * `subject` is whatever the editor typed or the story it came from. A URL in
 * the box becomes a pointer as well as the subject, because the voice fetches
 * any URL it is given before it writes.
 */
export const startEditorial = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: { subject: string; askedFor?: string; articleSlug?: string; modelChoice?: string; documentIds?: string[]; retryRequestId?: number }) =>
      input,
  )
  .handler(async ({ context, data }) => {
    const modelChoice = opinionModelChoice(data.modelChoice);
    const { commitOpinionForAuthenticatedEditor } =
      await import("./model-request-commit.server.ts");
    return commitOpinionForAuthenticatedEditor({
      context: { userId: context.userId, newsroomId: owned(context) },
      subject: data.subject,
      askedFor: data.askedFor,
      articleSlug: data.articleSlug,
      modelChoice,
      documentIds: data.documentIds,
      retryRequestId: data.retryRequestId,
    });
  });

/**
 * Editing, printing and deleting an editorial.
 *
 * The story workbench opens by LEAD id, and an editorial has no lead — an
 * editor typed a subject and the paper stated its position. So until now a
 * finished editorial could be read on this desk and nothing else: not edited,
 * not published, not thrown away. The panel even told the editor to "edit it in
 * the story editor", which was a promise the software could not keep.
 *
 * These are the same three verbs the reported-story desk has, keyed by draft.
 */
export type EditorialDraft = {
  source_urls: string; provenance_json: string; found_note: string; unanswered: string; research_json: string; evidenceToken: string;
  id: number;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  form: string;
  fact_sheet: string;
  image_prompt: string;
  published_slug: string | null;
};

export const getEditorialDraft = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((draftId: number) => draftId)
  .handler(async ({ context, data: draftId }): Promise<EditorialDraft | null> => {
    const { ensureEditorialSchema } = await import("./editorial.server");
    await ensureEditorialSchema();
    const sql = await getSql();
    const rows = await sql<EditorialDraft>`
      select d.*,
             coalesce(e.fact_sheet, '') as fact_sheet,
             coalesce(e.image_prompt, '') as image_prompt,
             (select a.slug from articles a
               where a.headline = d.headline and a.status = 'published'
                 and a.newsroom_id = d.newsroom_id
               limit 1) as published_slug
      from drafts d
      left join editorial_extras e on e.draft_id = d.id
      where d.id = ${draftId} and d.newsroom_id = ${owned(context)} and d.form = 'editorial' and d.lead_id is null
      limit 1
    `;
    return rows[0] ? { ...rows[0], evidenceToken: evidenceReviewToken(rows[0]) } : null;
  });

export const saveEditorialDraft = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { draftId: number; headline: string; dek: string; body: string; topic: string; evidenceDecision?: EvidenceDecision; evidenceToken?: string }) => input)
  .handler(async ({ context, data }) => {
    const { saveOpinionDraft } = await import("./opinion-draft.server.ts");
    return saveOpinionDraft(owned(context), data);
  });

/**
 * Put an editorial on the paper.
 *
 * Deliberately not `performPublish`: that one reads a lead, refuses to print a
 * held or killed one, and marks the lead published afterwards. None of it
 * applies here. `articles.lead_id` has been nullable since the newsroom's
 * second migration, so the row is simply written without one.
 *
 * The slug loop is the same as the reported path, and for the same reason: the
 * column is unique, and a single retry could still collide.
 */
export const publishEditorial = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((draftId: number) => draftId)
  .handler(async ({ context, data: draftId }) => {
    const { slugify } = await import("@/lib/paper");
    const { withEditorialDraft, assertOpinionEvidenceReady } = await import("./opinion-draft.server.ts");
    const result = await withEditorialDraft(owned(context), draftId, async (sql, d) => {
    assertOpinionEvidenceReady(d);
    if (!d.headline.trim() || !d.body.trim()) {
      return { ok: false as const, error: "An editorial needs a headline and a body." };
    }

    const already = await sql<{ slug: string }>`
      select slug from articles
      where headline = ${d.headline} and status = 'published' and newsroom_id = ${owned(context)}
      limit 1
    `;
    if (already[0]) return { ok: true as const, slug: already[0].slug };

    const baseSlug = slugify(d.headline);
    const printed = await (async () => {
      const tx = sql;
      let candidate = baseSlug;
      for (let n = 0; n < 50; n += 1) {
        const clash = await tx<{
          slug: string;
        }>`select slug from articles where slug = ${candidate} limit 1`;
        if (!clash[0]) break;
        candidate = n === 0 ? `${baseSlug}-${draftId}` : `${baseSlug}-${draftId}-${n + 1}`;
      }
      const [article] = await tx<{id:number}>`
        insert into articles (
          user_id, newsroom_id, lead_id, slug, headline, dek, body, topic, source_urls, status,
          published_at, form, origin_draft_id
        )
        values (
          ${context.userId}, ${owned(context)}, ${null}, ${candidate}, ${d.headline}, ${d.dek}, ${d.body},
          ${d.topic || "opinion"}, ${d.source_urls || "[]"}, 'published', now(),
          ${d.form || "editorial"}, ${draftId}
        ) returning id
      `;
      return {slug:candidate,id:article.id};
    })();

    return { ok: true as const, slug:printed.slug, articleId:printed.id };
    });
    if (result.ok && typeof result.articleId === "number") await audit(context.userId, "publish-editorial", `Article ${result.articleId}`, owned(context), {kind:"articles",id:result.articleId});
    return result;
  });

/**
 * Throw an editorial away.
 *
 * A real delete, because the operator asked for one: an editor must be able to
 * remove anything, before or after it prints. `editorial_extras` and the
 * request row that points here are plain integer columns with no foreign key,
 * so they are cleaned up by hand rather than by a cascade.
 *
 * A published editorial is a separate object; deleting the draft leaves the
 * printed piece alone. Removing that is `deleteArticle`.
 */
export const deleteEditorial = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((draftId: number) => draftId)
  .handler(async ({ context, data: draftId }) => {
    const sql = await getSql();
    const { keepACopy, snapshotDraft } = await import("./trash");
    const [ownedEditorial] = await sql<{id:number}>`select id from drafts where id=${draftId} and newsroom_id=${owned(context)} and form='editorial' and lead_id is null`;
    if (!ownedEditorial) return { ok: false as const, error: "That standalone editorial is gone." };
    const snapshot = await snapshotDraft(sql, draftId);
    if (!snapshot) return { ok: false as const, error: "That draft is already gone." };

    // Copy first. An editorial draft has no copy anywhere else — not a lead,
    // not a printed piece — so losing it to a mis-click is losing the piece.
    const trashId = await keepACopy({
      sql,
      newsroomId: owned(context),
      userId: context.userId,
      kind: "draft",
      refId: draftId,
      label: String(snapshot.row.headline ?? "An editorial"),
      snapshot,
    });

    const gone = await sql<{ id: number; headline: string }>`
      delete from drafts
      where id = ${draftId} and newsroom_id = ${owned(context)}
      returning id, headline
    `;
    if (!gone[0]) {
      await sql`delete from deleted_items where id = ${trashId}`.catch(() => undefined);
      return { ok: false as const, error: "That draft is already gone." };
    }
    await sql`delete from editorial_extras where draft_id = ${draftId}`.catch(() => undefined);
    await sql`
      update editorial_requests set draft_id = null
      where draft_id = ${draftId} and newsroom_id = ${owned(context)}
    `.catch(() => undefined);
    await audit(context.userId, "delete-editorial", gone[0].headline.slice(0, 120), owned(context));
    return { ok: true as const, trashId };
  });

/**
 * File a piece the editor wrote somewhere else.
 *
 * The Opinion desk could only ever GENERATE. An editor who wrote a column in
 * their own editor -- or in another session, in their own voice, which is the
 * whole point of a voice file living outside this repository -- had no way to
 * get it onto the desk. The only route in was a recovery script that wanted a
 * model CLI output envelope and a user id read out of the database.
 *
 * Nothing new is parsed here. `parseEditorial` already understands the shape
 * the desk itself produces -- body, then CLAIMS AND SOURCES, then EDITOR'S
 * FACT SHEET, then the image prompt -- so a piece written elsewhere in that
 * shape arrives with its receipts attached and its fact sheet intact.
 *
 * It lands as a DRAFT, always. Publishing is a person's deliberate click, and
 * a paste box is exactly the wrong place to weaken that.
 */
export const fileWrittenEditorial = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((text: string) => text)
  .handler(async ({ context, data: text }) => {
    const body = String(text ?? "").trim();
    if (!body) return { ok: false as const, error: "Nothing to file yet." };
    // A whole column is tens of kilobytes; a megabyte is a mistake or an
    // attack, and either way the honest answer is to refuse before parsing.
    if (body.length > 400_000) {
      return {
        ok: false as const,
        error: "That is too long to be a column. Trim it and try again.",
      };
    }

    const { parseEditorial } = await import("./editorial");
    const { fileEditorial } = await import("./editorial.server");
    const ed = parseEditorial(body);
    if (!ed.body.trim()) {
      return {
        ok: false as const,
        error: "No article text found. Paste the piece itself, headline first.",
      };
    }

    const result = await fileEditorial(
      {
        userId: context.userId,
        newsroomId: context.newsroomId ?? DEFAULT_NEWSROOM_ID,
        subject: ed.headline || "Filed by the editor",
        pointers: [],
        // Kept on the draft so the record says a person wrote this, not a model.
        sourceKind: "written-by-the-editor",
        sourceRef: "pasted into the Opinion desk",
      },
      ed,
    );
    if (!result.ok) return { ok: false as const, error: result.error };

    /*
      The desk lists editorial REQUESTS, not drafts.

      `fileEditorial` writes the draft and stops there; the request row is
      created by the job path and updated when the model finishes. Filing
      without one produced a draft that existed in the database, reported
      success to the editor, and appeared nowhere on the screen -- the walk
      caught it on its first run, four steps in, which is precisely the class
      of defect a green unit test would have missed.

      Written as already finished, because it is: a person wrote it, and there
      is no work outstanding for anything to wait on.
    */
    const sql = await getSql();
    await sql`
      insert into editorial_requests
        (user_id, newsroom_id, subject, source_kind, source_ref, draft_id, finished_at)
      values (${context.userId}, ${context.newsroomId ?? DEFAULT_NEWSROOM_ID},
              ${ed.headline || "Filed by the editor"}, ${"written-by-the-editor"},
              ${"pasted into the Opinion desk"}, ${result.draftId}, now())
    `;

    await audit(context.userId, "file-written-editorial", (ed.headline || "").slice(0, 120), owned(context));
    return { ok: true as const, draftId: result.draftId, headline: ed.headline };
  });

/**
 * Throw away a request that never produced anything.
 *
 * Deleting an editorial has always meant deleting its DRAFT -- which snapshots
 * it to the trash first, so it can come back. That is right when there is a
 * draft. A request that finished without one has nothing to snapshot and
 * nothing to restore, and the desk keyed its Delete button on the draft, so
 * those rows could not be removed at all.
 *
 * The operator found two on the live desk: one that timed out, and a worse one
 * that finished with no draft AND no error, so it sat there looking like work
 * in progress that had actually stopped. Neither could be cleared. A desk you
 * cannot tidy accumulates things you have to mentally skip past forever.
 *
 * Refuses when a draft exists, rather than quietly doing something different
 * from what the caller asked: that path must go through deleteEditorial so the
 * writing is kept for thirty days.
 */
export const discardEditorialRequest = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((requestId: number) => requestId)
  .handler(async ({ context, data: requestId }) => {
    const { ensureEditorialRequestSchema } = await import("./editorial.server");
    await ensureEditorialRequestSchema();
    const sql = await getSql();
    const rows = await sql<{ draft_id: number | null; subject: string }>`
      select draft_id, subject from editorial_requests
      where id = ${requestId} and newsroom_id = ${owned(context)} limit 1
    `;
    const row = rows[0];
    if (!row) return { ok: false as const, error: "That is not on the desk any more." };
    if (row.draft_id) {
      return {
        ok: false as const,
        error: "That one has a piece written. Delete it from the piece, so a copy is kept.",
      };
    }
    await sql`
      delete from editorial_requests
      where id = ${requestId} and newsroom_id = ${owned(context)} and draft_id is null
    `;
    await audit(context.userId, "discard-editorial-request", (row.subject ?? "").slice(0, 120), owned(context));
    return { ok: true as const };
  });
