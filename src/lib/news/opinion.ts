import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { assertRate, audit } from "./ops";
import { enqueueJob } from "./jobs";
import { DEFAULT_NEWSROOM_ID } from "./membership";
import { assertHttpUrl } from "./url-guard";
import { siteUrl } from "@/lib/paper";

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
  draft_id: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  headline: string | null;
  words: number | null;
  published_slug: string | null;
};

export const listEditorials = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<EditorialRow[]> => {
    const { ensureEditorialRequestSchema, ensureEditorialSchema } = await import(
      "./editorial.server"
    );
    await ensureEditorialRequestSchema();
    await ensureEditorialSchema();
    const sql = await getSql();
    return sql<EditorialRow>`
      select r.id, r.subject, r.source_kind, r.source_ref, r.draft_id, r.error,
             r.created_at, r.finished_at,
             d.headline,
             case when d.body is null then null
                  else array_length(regexp_split_to_array(trim(d.body), '\\s+'), 1)
             end as words,
             a.slug as published_slug
      from editorial_requests r
      left join drafts d on d.id = r.draft_id
      left join articles a on a.headline = d.headline and a.status = 'published'
      where r.newsroom_id = ${owned(context)}
      order by r.id desc
      limit 30
    `.catch(() => []);
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
      fact_sheet: string | null;
      image_prompt: string | null;
      source_kind: string | null;
      source_ref: string | null;
    }>`
      select d.id, d.headline, d.body, d.topic,
             e.fact_sheet, e.image_prompt, e.source_kind, e.source_ref
      from drafts d
      left join editorial_extras e on e.draft_id = d.id
      where d.id = ${draftId} and d.newsroom_id = ${owned(context)}
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
  .validator((input: { subject: string; askedFor?: string; articleSlug?: string }) => input)
  .handler(async ({ context, data }) => {
    const { ensureEditorialRequestSchema } = await import("./editorial.server");
    const { findVoiceFile } = await import("./voice.server");

    // Fail before spending a job slot: without the voice there is no editorial.
    const voice = await findVoiceFile();
    if (!voice.ok) return { ok: false as const, error: voice.error };

    const subject = String(data.subject ?? "").trim().slice(0, 400);
    if (subject.length < 6) {
      return { ok: false as const, error: "Give it a subject, a URL, or a sentence to work from." };
    }

    await assertRate(context.userId, "editorial");
    await ensureEditorialRequestSchema();
    const sql = await getSql();

    const pointers: { what: string; url?: string }[] = [];
    let ourStory: { headline: string; url: string; dek?: string } | undefined;
    let sourceKind = "paste";
    let sourceRef = subject;

    // A pasted URL is a lead to open, not just a subject line.
    for (const m of subject.matchAll(/https?:\/\/\S+/g)) {
      try {
        pointers.push({ what: "pasted by the editor", url: assertHttpUrl(m[0]).toString() });
      } catch {
        /* not a usable URL */
      }
    }

    if (data.articleSlug) {
      const art = await sql<{ headline: string; dek: string; source_urls: string }>`
        select headline, dek, source_urls from articles
        where slug = ${data.articleSlug} and newsroom_id = ${owned(context)}
          and status = 'published' limit 1
      `;
      if (art[0]) {
        sourceKind = "article";
        sourceRef = data.articleSlug;
        ourStory = {
          headline: art[0].headline,
          dek: art[0].dek,
          url: siteUrl(`/articles/${data.articleSlug}`),
        };
        try {
          for (const u of JSON.parse(art[0].source_urls) as string[]) {
            pointers.push({ what: "cited by our story", url: u });
          }
        } catch {
          /* no usable source list */
        }
      }
    }

    const rows = await sql<{ id: number }>`
      insert into editorial_requests
        (user_id, newsroom_id, subject, source_kind, source_ref, asked_for, pointers_json, our_story_json)
      values (${context.userId}, ${owned(context)}, ${subject}, ${sourceKind}, ${sourceRef},
              ${String(data.askedFor ?? "").slice(0, 600)},
              ${JSON.stringify(pointers).slice(0, 8000)},
              ${ourStory ? JSON.stringify(ourStory) : null})
      returning id
    `;
    const requestId = rows[0]!.id;

    const job = await enqueueJob({
      userId: context.userId,
      newsroomId: owned(context),
      kind: "editorial",
      subjectId: requestId,
    });
    await audit(context.userId, "editorial", `request ${requestId} from ${sourceKind}`);
    return { ok: true as const, requestId, jobId: job.id };
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
      select d.id, d.headline, d.dek, d.body, d.topic, d.form,
             coalesce(e.fact_sheet, '') as fact_sheet,
             coalesce(e.image_prompt, '') as image_prompt,
             (select a.slug from articles a
               where a.headline = d.headline and a.status = 'published'
                 and a.newsroom_id = d.newsroom_id
               limit 1) as published_slug
      from drafts d
      left join editorial_extras e on e.draft_id = d.id
      where d.id = ${draftId} and d.newsroom_id = ${owned(context)}
      limit 1
    `;
    return rows[0] ?? null;
  });

export const saveEditorialDraft = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { draftId: number; headline: string; dek: string; body: string; topic: string }) => input)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const done = await sql<{ id: number }>`
      update drafts
      set headline = ${data.headline.slice(0, 300)},
          dek = ${data.dek.slice(0, 600)},
          body = ${data.body},
          topic = ${data.topic.slice(0, 40)},
          updated_at = now()
      where id = ${data.draftId} and newsroom_id = ${owned(context)}
      returning id
    `;
    if (!done[0]) return { ok: false as const, error: "That draft is gone." };
    return { ok: true as const };
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
    const { withTransaction } = await import("@/lib/db");
    const sql = await getSql();

    const rows = await sql<{
      headline: string;
      dek: string;
      body: string;
      topic: string;
      source_urls: string;
      form: string;
    }>`
      select headline, dek, body, topic, source_urls, form
      from drafts where id = ${draftId} and newsroom_id = ${owned(context)} limit 1
    `;
    const d = rows[0];
    if (!d) return { ok: false as const, error: "That draft is gone." };
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
    const slug = await withTransaction(async (tx) => {
      let candidate = baseSlug;
      for (let n = 0; n < 50; n += 1) {
        const clash = await tx<{ slug: string }>`select slug from articles where slug = ${candidate} limit 1`;
        if (!clash[0]) break;
        candidate = n === 0 ? `${baseSlug}-${draftId}` : `${baseSlug}-${draftId}-${n + 1}`;
      }
      await tx`
        insert into articles (
          user_id, lead_id, slug, headline, dek, body, topic, source_urls, status,
          published_at, form
        )
        values (
          ${context.userId}, ${null}, ${candidate}, ${d.headline}, ${d.dek}, ${d.body},
          ${d.topic || "opinion"}, ${d.source_urls || "[]"}, 'published', now(),
          ${d.form || "editorial"}
        )
      `;
      return candidate;
    });

    await audit(context.userId, "publish-editorial", slug);
    return { ok: true as const, slug };
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
    await audit(context.userId, "delete-editorial", gone[0].headline.slice(0, 120));
    return { ok: true as const, trashId };
  });
