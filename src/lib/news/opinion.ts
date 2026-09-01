import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { assertRate, audit } from "./ops";
import { enqueueJob, latestJob, runLooksStalled } from "./jobs";
import { DEFAULT_NEWSROOM_ID } from "./membership";
import { assertHttpUrl } from "./url-guard";
import { siteUrl } from "@/lib/paper";
import { opinionModelChoice, opinionProviderProblem, type OpinionModelChoice } from "./model-choice.ts";

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
  /**
   * True when the row looks like it is still being written (no finished_at,
   * no error) but the desk_jobs heartbeat behind it is cold or missing --
   * most likely the app restarted mid-piece. See `runLooksStalled`. Left
   * undefined on finished rows so the client's `!r.finished_at` checks stay
   * the source of truth for "is this open at all".
   */
  stalled?: boolean;
};

/**
 * Can the Opinion desk write at all, asked before anything is typed.
 *
 * The desk only revealed a missing voice file or a disabled CLI AFTER the
 * editor had written a subject and pressed the button — an audit called that
 * out (UIUX-05). A dependency you cannot satisfy should be visible while you
 * are deciding whether to start, not after you have.
 *
 * Cheap: a stat and an env read. No model call, nothing spent.
 */
async function checkOpinionReadiness(choice: OpinionModelChoice) {
  const problems: string[] = [];
  const { findVoiceFile } = await import("./voice.server");
  const voice = await findVoiceFile();
  if (!voice.ok) problems.push(voice.error);

  const { probeProvider } = await import("./ai");
  const codexOpinionDisabled =
    "Codex Opinion is not enabled yet because sending the private editorial voice to OpenAI needs explicit authorization. Choose Claude Opus for Opinion.";
  if (choice === "codex-frontier") problems.push(codexOpinionDisabled);
  const probes = choice === "auto"
    ? [await probeProvider("claude-frontier")]
    : choice === "codex-frontier"
      ? []
      : [await probeProvider(choice)];
  const selected = probes.find((probe) => probe.ok);
  if (!selected) {
    problems.push(...probes.flatMap((probe) => {
      if (probe.ok) return [];
      return [opinionProviderProblem(probe.error)];
    }));
  }
  const effectiveChoice = selected?.ok && selected.choice !== "configured"
    ? opinionModelChoice(selected.choice)
    : choice;
  return { ready: problems.length === 0, why: problems.join(" "), problems, effectiveChoice };
}

export const opinionReadiness = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((choice?: string) => opinionModelChoice(choice))
  .handler(async ({ data: choice }) => {
    return checkOpinionReadiness(choice);
  });

export const listEditorials = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<EditorialRow[]> => {
    const { ensureEditorialRequestSchema, ensureEditorialSchema } = await import(
      "./editorial.server"
    );
    await ensureEditorialRequestSchema();
    await ensureEditorialSchema();
    const sql = await getSql();
    const rows = await sql<EditorialRow>`
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
      const job = await latestJob({ newsroomId: owned(context), kind: "editorial", subjectId: row.id });
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
  .validator((input: { subject: string; askedFor?: string; articleSlug?: string; modelChoice?: string }) => input)
  .handler(async ({ context, data }) => {
    const { ensureEditorialRequestSchema } = await import("./editorial.server");
    const subject = String(data.subject ?? "").trim().slice(0, 400);
    const modelChoice = opinionModelChoice(data.modelChoice);
    if (subject.length < 6) {
      return { ok: false as const, error: "Give it a subject, a URL, or a sentence to work from." };
    }

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

    // Repeat the UI's cheap readiness check at the commit boundary. The
    // browser check can be stale, fail, or be bypassed; no request or job is
    // created unless both the voice and selected provider are ready now.
    const readiness = await checkOpinionReadiness(modelChoice);
    if (!readiness.ready) return { ok: false as const, error: readiness.why };
    const effectiveChoice = readiness.effectiveChoice;
    await assertRate(context.userId, "editorial");

    const rows = await sql<{ id: number }>`
      insert into editorial_requests
        (user_id, newsroom_id, subject, source_kind, source_ref, asked_for, pointers_json, our_story_json, model_choice)
      values (${context.userId}, ${owned(context)}, ${subject}, ${sourceKind}, ${sourceRef},
              ${String(data.askedFor ?? "").slice(0, 600)},
              ${JSON.stringify(pointers).slice(0, 8000)},
              ${ourStory ? JSON.stringify(ourStory) : null}, ${effectiveChoice})
      returning id
    `;
    const requestId = rows[0]!.id;

    const job = await enqueueJob({
      userId: context.userId,
      newsroomId: owned(context),
      kind: "editorial",
      subjectId: requestId,
      modelChoice: effectiveChoice,
    });
    await audit(context.userId, "editorial", `request ${requestId} from ${sourceKind}`);
    return { ok: true as const, requestId, jobId: job.id, modelChoice: effectiveChoice };
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
      return { ok: false as const, error: "That is too long to be a column. Trim it and try again." };
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

    await audit(context.userId, "file-written-editorial", (ed.headline || "").slice(0, 120));
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
    await audit(context.userId, "discard-editorial-request", (row.subject ?? "").slice(0, 120));
    return { ok: true as const };
  });
