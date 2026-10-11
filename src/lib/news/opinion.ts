import { evidenceReviewToken, type EvidenceDecision } from "./draft-evidence.ts";
import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { audit } from "./ops";
import { latestJob, runLooksStalled } from "./jobs";
import { jobProgressView, type JobProgressView } from "./job-progress.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership";
import { opinionModelChoice } from "./model-choice.ts";
import { modelEffort, type ModelEffort } from "./provider-registry.ts";
import { checkOpinionReadiness } from "./opinion-readiness.ts";
import {
  cleanPublishId,
  editorialDraftInput,
  editorialStartInput,
  editorialText,
  rowId,
} from "./request-input.ts";

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
  /**
   * The same job, shaped for phase 3's card. Already fetched above for the
   * stalled check, so the Writing row gets a live progress card without a
   * second query and without widening `listStoryJobProgress` -- which is the
   * story desk's query and would leak editorial rows onto Today.
   */
  job?: JobProgressView | null;
  /**
   * `drafts.integrity_notes`: the sentence the writer's own source check
   * produced, stored when the piece was filed. Non-empty means the claims
   * appendix is incomplete, which is what blocks publication.
   */
  integrity_notes?: string | null;
  /**
   * `drafts.research_json`, carried so the finished row can say when the
   * material behind the piece was cut for length (unit B8P). The note lives in
   * that blob, written when the piece was filed, so the row shows it on every
   * load rather than only while the job is open.
   */
  research_json?: string | null;
};

export const getFailedEditorialMaterial = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((requestId: number) => rowId.parse(requestId))
  .handler(async ({ context, data: requestId }) => {
    const { ensureEditorialRequestSchema } = await import("./editorial.server");
    await ensureEditorialRequestSchema();
    const sql = await getSql();
    const [row] = await sql<{ source_text: string; asked_for: string; error: string | null; finished_at: string | null; draft_id: number | null;
    }>`
      select source_text, asked_for, error, finished_at, draft_id from editorial_requests
      where id=${requestId} and newsroom_id=${owned(context)} limit 1
    `;
    if (!row || !row.finished_at || !row.error || row.draft_id !== null) return { ok: false as const, error: "That failed request has no restorable material." };
    const [docs] = await sql<{
      count: number;
    }>`select count(*) as count from story_documents where editorial_request_id=${requestId} and newsroom_id=${owned(context)}`;
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
             d.integrity_notes,
             d.research_json,
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
      /*
        `row.id`, not a lead id: an editorial has no lead. `jobProgressView`'s
        second argument is only ever used to build a failover destination for
        the two story kinds, and an editorial job's `resultHref` stays null, so
        nothing on the card can navigate anywhere wrong.
      */
      row.job = job ? jobProgressView(job, row.id, row.draft_id) : null;
    }
    return rows;
  });

export const getEditorial = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((draftId: number) => rowId.parse(draftId))
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
    (input: { subject: string; askedFor?: string; articleSlug?: string; modelChoice?: string; modelEffort?: ModelEffort | null; documentIds?: string[]; retryRequestId?: number; override?: string[] }) =>
      editorialStartInput.parse(input),
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
      modelEffort: modelEffort(modelChoice, data.modelEffort),
      documentIds: data.documentIds,
      retryRequestId: data.retryRequestId,
      override: data.override,
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
  /**
   * When the piece was last saved. `select d.*` has always returned it; unit CW
   * names it because the drawn save line at the head of the STORY box says the
   * hour of the save the desk actually made, from the same `saveState` the
   * reported screen uses.
   */
  updated_at: string;
};

export const getEditorialDraft = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((draftId: number) => rowId.parse(draftId))
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
    const draft = rows[0];
    if (!draft) return null;
    if (draft.published_slug) {
      const printed = await sql<{headline: string; dek: string; body: string; topic: string}>`
        select headline,dek,body,topic from articles where slug=${draft.published_slug}
          and newsroom_id=${owned(context)} and status='published' limit 1`;
      if (printed[0]) return {...draft, ...printed[0], evidenceToken: evidenceReviewToken(draft)};
    }
    return {...draft, evidenceToken: evidenceReviewToken(draft)};
  });

export const saveEditorialDraft = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: {
      draftId: number;
      headline: string;
      dek: string;
      body: string;
      topic: string;
      evidenceDecision?: EvidenceDecision;
      evidenceToken?: string;
    }) => editorialDraftInput.parse(input),
  )
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
/**
 * A publish request for a standalone editorial: the draft, and the warning keys
 * the editor has acknowledged at the press.
 *
 * Two shapes are accepted, deliberately: the bare draft id every existing
 * caller sends (`desk.opinion.tsx`, the story workbench), and
 * `{draftId, acknowledgedWarningKeys}` once the confirmation dialog lists what
 * it is asking the editor to overrule. A non-array, or an array holding
 * anything but strings, is dropped to `[]` rather than refused: a request is
 * not the place to discover that a key is not text, and an empty acknowledgement
 * list is exactly "the editor acknowledged nothing", which the publish path
 * already answers with a refusal naming every current warning.
 *
 * This never refuses a request the old shape allowed; it only carries more.
 */
export function cleanEditorialPublishRequest(raw: unknown): {
  draftId: number | null;
  acknowledgedWarningKeys: string[];
} {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const o = raw as { draftId?: unknown; acknowledgedWarningKeys?: unknown };
    const keys = Array.isArray(o.acknowledgedWarningKeys)
      ? o.acknowledgedWarningKeys.filter(
          (k): k is string => typeof k === "string" && k.trim() !== "",
        )
      : [];
    return { draftId: cleanPublishId(o.draftId), acknowledgedWarningKeys: keys };
  }
  return { draftId: cleanPublishId(raw), acknowledgedWarningKeys: [] };
}

/**
 * The body of `publishEditorial`, pulled out so it can be called directly in
 * a test with a plain `{ userId, newsroomId }` context and a real (PGlite)
 * database -- the same shape `performPublish` (desk.ts) exposes for the same
 * reason. `publishEditorial` itself stays the RPC entry point, unwrapping the
 * validated `{draftId, acknowledgedWarningKeys}` and calling straight through.
 *
 * HUMAN OVERRIDE AT PUBLISH. Until now the editorial path only ever THREW its
 * gate (`assertOpinionEvidenceReady`), so an editor with a missing dek or stale
 * evidence had a dead button and no sentence. It now works like the reported
 * workbench (`performPublish`, `publish-overrides.behavior.test.ts`): the
 * refusal carries EVERY warning current inside this transaction, names the keys
 * the caller did not acknowledge, and stands aside for the ones it did --
 * printing over them with one `publish-override` audit row per warned key.
 *
 * The order is deliberate and load-bearing:
 *
 *   1. The true impossibilities first -- a draft that is not there, an empty
 *      headline, an empty body. These are refused however many keys arrive:
 *      they are not warnings, they are the absence of a piece to print.
 *   2. The warnings, recomputed INSIDE the locked transaction, so a key the
 *      client acknowledged for a draft version that has since moved does not
 *      carry: the current list comes back and the editor re-presses.
 *   3. Already-published short-circuit before any audit write, so a retry of a
 *      print that already happened writes no duplicate override rows.
 */
export async function performPublishEditorial(
  context: { userId: string; newsroomId?: number },
  draftId: number | null,
  acknowledgedWarningKeys: readonly string[] = [],
) {
  if (draftId === null) return { ok: false as const, error: "There is no such draft." };
  const { slugify } = await import("@/lib/paper");
  const { withEditorialDraftOrNull, opinionPublishWarnings } =
    await import("./opinion-draft.server.ts");
  const { ensureAuditEventsSchema } = await import("./ops.ts");

  /*
      The audit schema is DDL, so it cannot join the transaction below; ensure it
      once here, the same way `audit()` would before writing an ordinary event.
    */
  await ensureAuditEventsSchema();

  const ack = new Set(
    acknowledgedWarningKeys.filter(
      (key): key is string => typeof key === "string" && key.trim() !== "",
    ),
  );

  const result = await withEditorialDraftOrNull(owned(context), draftId, async (sql, d) => {
    /*
        The true impossibilities. A missing headline or body is not a warning a
        person can accept -- there is nothing to print -- so an acknowledgement
        of any key does not move it.
      */
    if (!(d.headline ?? "").trim()) {
      return { ok: false as const, error: "An editorial needs a headline before it can publish." };
    }
    if (!(d.body ?? "").trim()) {
      return { ok: false as const, error: "An editorial needs a headline and a body." };
    }

    /*
        Already on the paper: resolve to the printed piece before the warning
        gate. A retry of a print that happened -- with or without an
        acknowledgement -- must not append a second set of override rows, and a
        second refusal for a piece the editor can see is the piece itself would
        be the desk contradicting it. Nothing new is written, so there is
        nothing to audit.
      */
    const already = await sql<{ slug: string }>`
        select slug from articles
      where headline = ${d.headline} and status = 'published' and newsroom_id = ${owned(context)}
      limit 1
      `;
    if (already[0]) return { ok: true as const, slug: already[0].slug };

    /*
        Recompute the warnings inside the locked transaction. A refusal must name
        what is true of THIS row, not what the client last saw, or a stale
        acknowledgement would print over a warning nobody read.
      */
    const warnings = opinionPublishWarnings(d);
    const unacknowledged = warnings.filter((warning) => !ack.has(warning.key));
    if (unacknowledged.length > 0) {
      /*
          The error is the FIRST unacknowledged warning's own sentence -- the
          desk's words for what the editor must read, not an internal key list.
          The whole list rides along in `warnings`, and `unacknowledged` names
          the keys, so the client can list every reason before it asks the
          editor to confirm. An empty acknowledgement therefore reproduces the
          single-warning refusal this path always gave.
        */
      return {
        ok: false as const,
        error: unacknowledged[0].sentence,
        warnings,
        unacknowledged: unacknowledged.map((w) => w.key),
      };
    }

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
      const [article] = await tx<{ id: number }>`
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
      return { slug: candidate, id: article.id };
    })();

    /*
        One override row per warning this print stands over. The detail names the
        warning key, the draft and the editor; the entity is the draft, so an
        override is traceable to the piece it was made for. Written INSIDE the
        transaction (`auditWithSql`), so a print that rolls back leaves no
        record of an override that never happened.
      */
    const { recordEditorOverrides } = await import("./editor-override.ts");
    await recordEditorOverrides({ userId: context.userId, newsroomId: owned(context), sql }, warnings, { kind: "drafts", id: draftId });

    return { ok: true as const, slug:printed.slug, articleId:printed.id };
  });

  /*
      No row: the draft is gone, or it was never an editorial the caller owns
      (a reporting draft, or another newsroom's). Answered, not thrown -- the
      caller is a person who pressed a button.
    */
  if (result === null) {
    return {
      ok: false as const,
      error: "That standalone editorial is gone. Open reporting drafts from the story queue.",
    };
  }
  if (result.ok && typeof result.articleId === "number") {
    await audit(context.userId, "publish-editorial", `Article ${result.articleId}`, owned(context), {kind:"articles",id:result.articleId});
  }
  return result;
}

export const publishEditorial = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => cleanEditorialPublishRequest(raw))
  .handler(async ({ context, data }) =>
    performPublishEditorial(context, data.draftId, data.acknowledgedWarningKeys),
  );

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
  .validator((draftId: number) => rowId.parse(draftId))
  .handler(async ({ context, data: draftId }) => {
    const sql = await getSql();
    const { keepACopy, snapshotDraft } = await import("./trash");
    const [ownedEditorial] = await sql<{
      id: number;
    }>`select id from drafts where id=${draftId} and newsroom_id=${owned(context)} and form='editorial' and lead_id is null`;
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
  .validator((text: string) => editorialText.parse(text))
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
  .validator((requestId: number) => rowId.parse(requestId))
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
