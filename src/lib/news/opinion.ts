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
 * Every call here only ever ENQUEUES. Writing one takes ten to twenty minutes
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
