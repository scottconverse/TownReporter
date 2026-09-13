import { getSql } from "../db.ts";
import { siteUrl } from "../paper.ts";
import { probeProvider } from "./ai.ts";
import { assertHttpUrl } from "./url-guard.ts";
import { assertRate, audit } from "./ops.ts";
import { enqueueJob, findOpenJob, kickJobs } from "./jobs.ts";
import { scanPreflight } from "./preflight.ts";
import { checkOpinionReadiness } from "./opinion-readiness.ts";
import {
  effectiveStoryModelChoice,
  modelChoiceLabel,
  storyModelChoice,
  type OpinionModelChoice,
  type StoryModelChoice,
} from "./model-choice.ts";
import { parseWriteStoryInput } from "./write-story.ts";
import { appendScratch, packNotes, parseNotes } from "./notes.ts";
import { sectionScanSnapshot, ensureSectionsSchema, getSections, resolvedSectionKey } from "./sections.server.ts";

export type AuthenticatedEditorContext = {
  userId: string;
  newsroomId: number;
};

export type StoryDraftCommitDeps = {
  probeProvider?: typeof probeProvider;
  getSql?: typeof getSql;
  assertRate?: typeof assertRate;
  enqueueJob?: typeof enqueueJob;
  findOpenJob?: typeof findOpenJob;
};

/**
 * The Story commit boundary after deskMiddleware has authenticated the caller.
 * Provider readiness is intentionally checked before rate accounting or enqueue.
 */
export async function commitStoryDraftForAuthenticatedEditor(
  input: {
    context: AuthenticatedEditorContext;
    leadId: number;
    modelChoice: StoryModelChoice;
    researchScope?: "public" | "supplied";
  },
  deps: StoryDraftCommitDeps = {},
) {
  const sql = await (deps.getSql ?? getSql)();
  const leads = await sql<{ id: number; status: string; notes_json?: string }>`
    select id, status, to_jsonb(leads)->>'notes_json' as notes_json from leads
    where id = ${input.leadId} and newsroom_id = ${input.context.newsroomId}
    limit 1
  `;
  if (!leads[0]) return { ok: false as const, error: "Lead not found" };
  if (leads[0].status === "killed") {
    return { ok: false as const, error: "Restore this lead before drafting." };
  }

  const researchScope = input.researchScope ?? parseNotes(leads[0].notes_json).researchScope ?? "public";
  const providerProbe = await (deps.probeProvider ?? probeProvider)(input.modelChoice, input.context.newsroomId);
  const ready = scanPreflight(providerProbe, input.modelChoice);
  if (!ready.ok) {
    return {
      ok: false as const,
      kind: ready.kind,
      error: ready.guidance,
      detail: ready.detail,
      retryable: ready.retryable,
    };
  }

  const effectiveChoice = providerProbe.ok ? providerProbe.choice : input.modelChoice;
  if (researchScope === "supplied" && effectiveChoice.startsWith("codex")) {
    return { ok: false as const, error: "Use only supplied material requires Claude or a local/API model. Codex has external tools enabled. Choose another model or Research public sources." };
  }
  const open = await (deps.findOpenJob ?? findOpenJob)({
    newsroomId: input.context.newsroomId,
    kind: "draft",
    subjectId: input.leadId,
  });
  if (open) {
    const persistedChoice = effectiveStoryModelChoice(open.model_choice);
    if (persistedChoice !== effectiveChoice || (open.research_scope ?? "public") !== researchScope) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `This lead is already drafting with ${modelChoiceLabel(persistedChoice)}. Open it to watch that run finish before changing the model or drafting scope.`,
        modelChoice: persistedChoice,
        jobId: open.id,
      };
    }
    return {
      ok: true as const,
      pending: true as const,
      jobId: open.id,
      modelChoice: persistedChoice,
    };
  }
  await (deps.assertRate ?? assertRate)(input.context.userId, "draft");
  const job = await (deps.enqueueJob ?? enqueueJob)({
    userId: input.context.userId,
    newsroomId: input.context.newsroomId,
    kind: "draft",
    subjectId: input.leadId,
    modelChoice: effectiveChoice,
    researchScope,
    modelChoiceSource: input.modelChoice === "auto" ? "auto" : "editor",
  });
  const persistedChoice = effectiveStoryModelChoice(job.model_choice);
  if (persistedChoice !== effectiveChoice || (job.research_scope ?? "public") !== researchScope) {
    return {
      ok: false as const,
      kind: "model-conflict" as const,
      error: `This lead is already drafting with ${modelChoiceLabel(persistedChoice)}. Open it to watch that run finish before changing the model or drafting scope.`,
      modelChoice: persistedChoice,
      jobId: job.id,
    };
  }
  return {
    ok: true as const,
    pending: true as const,
    jobId: job.id,
    modelChoice: persistedChoice,
  };
}

export type ScanCommitDeps = {
  probeProvider?: typeof probeProvider;
  getSql?: typeof getSql;
  assertRate?: typeof assertRate;
  enqueueJob?: typeof enqueueJob;
  findOpenJob?: typeof findOpenJob;
  kickJobs?: typeof kickJobs;
};

/**
 * The Scan commit boundary after deskMiddleware has authenticated the caller.
 * Same shape as `commitStoryDraftForAuthenticatedEditor`: readiness is
 * checked before a scan_runs row, rate accounting, or a job exist. A scan
 * already open for this newsroom on a different model reports the same
 * `model-conflict` guidance Story gives for a lead already drafting.
 */
export async function commitScanForAuthenticatedEditor(
  input: {
    context: AuthenticatedEditorContext;
    modelChoice: StoryModelChoice;
    sectionKey?: string;
  },
  deps: ScanCommitDeps = {},
) {
  const providerProbe = await (deps.probeProvider ?? probeProvider)(input.modelChoice, input.context.newsroomId);
  const ready = scanPreflight(providerProbe, input.modelChoice);
  if (!ready.ok) {
    return {
      ok: false as const,
      kind: ready.kind,
      error: ready.guidance,
      detail: ready.detail,
      retryable: ready.retryable,
    };
  }

  const effectiveChoice = providerProbe.ok ? providerProbe.choice : input.modelChoice;
  let sectionSnapshot;
  try {sectionSnapshot=await sectionScanSnapshot(input.context.newsroomId,input.sectionKey);}
  catch(error) {return {ok:false as const,error:error instanceof Error?error.message:"Invalid section.",detail:"Open Paper setup to review the section and its assigned sources.",retryable:true};}
  await ensureSectionsSchema();
  const open = await (deps.findOpenJob ?? findOpenJob)({
    newsroomId: input.context.newsroomId,
    kind: "scan",
  });
  if (open) {
    const scanSql=await (deps.getSql??getSql)();
    const [existing]=await scanSql<{section_snapshot:string|null}>`select section_snapshot from scan_runs where id=${open.subject_id} and newsroom_id=${input.context.newsroomId}`;
    const existingKey=existing?.section_snapshot?JSON.parse(existing.section_snapshot).key:null;
    if(existingKey!==(sectionSnapshot?.key??null)) return {ok:false as const,error:"A scan with a different section scope is already running. Wait for it to finish before starting this scan.",detail:"Open the current scan below.",retryable:true};
    const persistedChoice = effectiveStoryModelChoice(open.model_choice);
    if (persistedChoice !== effectiveChoice) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `A scan is already running with ${modelChoiceLabel(persistedChoice)}. Open the scan page to watch that run finish before choosing another model.`,
        modelChoice: persistedChoice,
        jobId: open.id,
      };
    }
    (deps.kickJobs ?? kickJobs)();
    return {
      ok: true as const,
      pending: true as const,
      jobId: open.id,
      modelChoice: persistedChoice,
    };
  }

  await (deps.assertRate ?? assertRate)(input.context.userId, "scan");
  const sql = await (deps.getSql ?? getSql)();
  const runRows = await sql<{ id: number }>`
    insert into scan_runs (user_id, newsroom_id, section_snapshot) values (${input.context.userId}, ${input.context.newsroomId}, ${sectionSnapshot?JSON.stringify(sectionSnapshot):null}) returning id
  `;
  const runId = runRows[0]!.id;
  const job = await (deps.enqueueJob ?? enqueueJob)({
    userId: input.context.userId,
    newsroomId: input.context.newsroomId,
    kind: "scan",
    subjectId: runId,
    modelChoice: effectiveChoice,
    modelChoiceSource: input.modelChoice === "auto" ? "auto" : "editor",
  });
  if (job.subject_id !== runId) {
    await sql`update scan_runs set finished_at=now(),error='Another scan was queued first. This request did not run.' where id=${runId} and newsroom_id=${input.context.newsroomId}`;
    const [existing]=await sql<{section_snapshot:string|null}>`select section_snapshot from scan_runs where id=${job.subject_id} and newsroom_id=${input.context.newsroomId}`;
    const existingKey=existing?.section_snapshot?JSON.parse(existing.section_snapshot).key:null;
    if(existingKey!==(sectionSnapshot?.key??null)) return {ok:false as const,error:"A scan with a different section scope was queued first. Wait for it to finish before starting this scan.",detail:"Your requested section scan did not run.",retryable:true};
  }
  const persistedChoice = effectiveStoryModelChoice(job.model_choice);
  if (persistedChoice !== effectiveChoice) {
    return {
      ok: false as const,
      kind: "model-conflict" as const,
      error: `A scan is already running with ${modelChoiceLabel(persistedChoice)}. Open the scan page to watch that run finish before choosing another model.`,
      modelChoice: persistedChoice,
      jobId: job.id,
    };
  }
  return {
    ok: true as const,
    pending: true as const,
    jobId: job.id,
    modelChoice: persistedChoice,
  };
}

export type OpinionCommitDeps = {
  checkReadiness?: typeof checkOpinionReadiness;
  ensureEditorialRequestSchema?: () => Promise<void>;
  getSql?: typeof getSql;
  assertRate?: typeof assertRate;
  enqueueJob?: typeof enqueueJob;
  findOpenJob?: typeof findOpenJob;
  audit?: typeof audit;
};

async function ensureEditorialRequestSchemaDefault() {
  const { ensureEditorialRequestSchema } = await import("./editorial.server.ts");
  await ensureEditorialRequestSchema();
}

/**
 * The Opinion commit boundary after deskMiddleware has authenticated the caller.
 * A request row, rate entry, audit entry, or job may only exist after readiness.
 */
export async function commitOpinionForAuthenticatedEditor(
  input: {
    context: AuthenticatedEditorContext;
    subject: string;
    askedFor?: string;
    articleSlug?: string;
    documentIds?: string[];
    retryRequestId?: number;
    modelChoice: OpinionModelChoice;
  },
  deps: OpinionCommitDeps = {},
) {
  if ((input.documentIds?.length ?? 0) > 20 || new Set(input.documentIds ?? []).size !== (input.documentIds?.length ?? 0)) {
    return { ok: false as const, error: "Choose up to 20 different documents." };
  }
  const sourceText = String(input.subject ?? "").trim();
  const askedFor = String(input.askedFor ?? "").trim();
  if (sourceText.length > 20_000_000 || askedFor.length > 20_000_000) {
    return { ok: false as const, error: "Opinion material exceeds 20 million characters. Split it into separate volumes before starting." };
  }
  if (sourceText.length < 6 && !input.documentIds?.length && !input.retryRequestId) {
    return { ok: false as const, error: "Give it a subject, a URL, or a sentence to work from." };
  }
  // Keep the card/list label compact without confusing it with the source.
  // The complete editor-authored material lives in source_text below.
  const subject = (sourceText.split(/\r?\n/).find((line) => line.trim())?.trim() || "Editorial from attached documents").slice(0, 400);

  const readiness = await (deps.checkReadiness ?? checkOpinionReadiness)(input.modelChoice, {}, input.context.newsroomId);
  if (!readiness.ready) return { ok: false as const, error: readiness.why };
  const effectiveChoice = readiness.effectiveChoice;

  // OAuth is checked before schema setup or a database handle is requested.
  // A signed-out provider therefore cannot mutate even database metadata, let
  // alone spend rate budget, insert a request, write an audit row, or enqueue.
  await (deps.ensureEditorialRequestSchema ?? ensureEditorialRequestSchemaDefault)();
  const sql = await (deps.getSql ?? getSql)();
  if (input.retryRequestId) {
    const retryable = await sql.query(
      `select old.id from editorial_requests old
       where old.id=$1 and old.newsroom_id=$2 and old.user_id=$3
         and old.finished_at is not null and old.error is not null and old.draft_id is null
         and exists (select 1 from story_documents d where d.editorial_request_id=old.id
           and d.newsroom_id=old.newsroom_id and d.user_id=old.user_id)
       limit 1`,
      [input.retryRequestId, input.context.newsroomId, input.context.userId],
    );
    if (!retryable.length) {
      return { ok: false as const, error: "That failed request has no retained attachments to restore." };
    }
  }
  const pointers: { what: string; url?: string }[] = [];
  let ourStory: { headline: string; url: string; dek?: string } | undefined;
  let sourceKind = "paste";
  let sourceRef = "pasted into the Opinion desk";

  for (const match of sourceText.matchAll(/https?:\/\/\S+/g)) {
    try {
      pointers.push({ what: "pasted by the editor", url: assertHttpUrl(match[0]).toString() });
    } catch {
      /* not a usable URL */
    }
  }

  if (input.articleSlug) {
    const article = await sql<{ headline: string; dek: string; source_urls: string }>`
      select headline, dek, source_urls from articles
      where slug = ${input.articleSlug} and newsroom_id = ${input.context.newsroomId}
        and status = 'published'
      limit 1
    `;
    if (article[0]) {
      sourceKind = "article";
      sourceRef = input.articleSlug;
      ourStory = {
        headline: article[0].headline,
        dek: article[0].dek,
        url: siteUrl(`/articles/${input.articleSlug}`),
      };
      try {
        for (const url of JSON.parse(article[0].source_urls) as string[]) {
          pointers.push({ what: "cited by our story", url });
        }
      } catch {
        /* no usable source list */
      }
    }
  }

  await (deps.assertRate ?? assertRate)(input.context.userId, "editorial");

  const rows = await sql<{ id: number }>`
    insert into editorial_requests
      (user_id, newsroom_id, subject, source_text, source_kind, source_ref, asked_for,
       pointers_json, our_story_json, model_choice)
    values (${input.context.userId}, ${input.context.newsroomId}, ${subject}, ${sourceText}, ${sourceKind},
            ${sourceRef}, ${askedFor},
            ${JSON.stringify(pointers)},
            ${ourStory ? JSON.stringify(ourStory) : null}, ${effectiveChoice})
    returning id
  `;
  const requestId = rows[0]!.id;
  const documentIds = [...(input.documentIds ?? [])];
  let generatedPasteId: string | undefined;
  if (sourceKind === "paste" && sourceText) {
    const { storeStoryDocument } = await import("./story-documents.server.ts");
    const pasted = await storeStoryDocument(input.context.newsroomId, input.context.userId,
      "Opinion desk pasted material.txt", "text/plain", new TextEncoder().encode(sourceText));
    documentIds.push(pasted.id);
    generatedPasteId = pasted.id;
  }
  if (documentIds.length) {
    const { linkEditorialDocuments } = await import("./story-documents.server.ts");
    try {
      await linkEditorialDocuments(sql, input.context.newsroomId, input.context.userId, requestId, documentIds);
    } catch (error) {
      if (generatedPasteId) await sql`delete from story_documents where id=${generatedPasteId} and newsroom_id=${input.context.newsroomId} and user_id=${input.context.userId} and lead_id is null and editorial_request_id is null`;
      await sql`delete from editorial_requests where id=${requestId} and newsroom_id=${input.context.newsroomId}`;
      return { ok: false as const, error: error instanceof Error ? error.message : "Documents could not be attached." };
    }
  }
  if (input.retryRequestId) {
    const moved = await sql.query(
      `update story_documents set editorial_request_id=$1 where editorial_request_id=$2
       and newsroom_id=$3 and user_id=$4 and exists (
         select 1 from editorial_requests old where old.id=$2 and old.newsroom_id=$3
           and old.user_id=$4 and old.finished_at is not null and old.error is not null and old.draft_id is null
       ) and not (
         filename = 'Opinion desk pasted material.txt' and mime = 'text/plain'
         and original = convert_to((select old.source_text from editorial_requests old where old.id=$2), 'UTF8')
       ) returning id`,
      [requestId, input.retryRequestId, input.context.newsroomId, input.context.userId],
    );
    if (!moved.length && !generatedPasteId) {
      await sql`delete from editorial_requests where id=${requestId} and newsroom_id=${input.context.newsroomId}`;
      return { ok: false as const, error: "The saved attachments could not be restored. Open the failed request and restore them again." };
    }
  }
  let job: Awaited<ReturnType<typeof enqueueJob>>;
  try {
    job = await (deps.enqueueJob ?? enqueueJob)({
      userId: input.context.userId,
      newsroomId: input.context.newsroomId,
      kind: "editorial",
      subjectId: requestId,
      modelChoice: effectiveChoice,
    });
  } catch (error) {
    // If enqueue committed and only its return path failed, recover the real
    // open job rather than turning live work into an orphan. Otherwise leave
    // the request terminal and visible, never pretending it is still writing.
    const recovered = await (deps.findOpenJob ?? findOpenJob)({
      newsroomId: input.context.newsroomId,
      kind: "editorial",
      subjectId: requestId,
    }).catch(() => null);
    if (recovered) {
      job = recovered;
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      const stored = `Editorial could not be queued: ${detail}`.slice(0, 800);
      await sql`
        update editorial_requests set error = ${stored}, finished_at = now()
        where id = ${requestId} and newsroom_id = ${input.context.newsroomId}
      `;
      return {
        ok: false as const,
        error: "That editorial could not be queued. Nothing is writing; try again.",
      };
    }
  }
  try {
    await (deps.audit ?? audit)(
      input.context.userId,
      "editorial",
      `request ${requestId} from ${sourceKind}`,
    );
  } catch (error) {
    // The job is already durable. Reporting the request as failed here would
    // invite a duplicate paid run, so audit is explicitly best-effort.
    console.error("[opinion] queued request but could not write audit event", error);
  }
  return { ok: true as const, requestId, jobId: job.id, modelChoice: effectiveChoice };
}

export type WriteStoryCommitDeps = StoryDraftCommitDeps & {
  audit?: typeof audit;
  getSections?: typeof getSections;
};

/**
 * "Write a story" — the one-box path on the Desk landing page. Parses free
 * text into a lead (see `write-story.ts`), files it with the pasted text kept
 * as Reporting notes scratch so the draft reads it as evidence, then hands
 * off to `commitStoryDraftForAuthenticatedEditor` so a provider refusal comes
 * back structured and nothing is spent. A lead, its draft row and an audit
 * entry may only exist once the text has parsed into something fileable —
 * same ordering discipline as the other commit boundaries in this file.
 *
 * Deliberately last in the file: `scripts/model-preflight.test.mjs` slices
 * each `export async function` from its own marker to the NEXT one, and a
 * function placed ahead of `ScanCommitDeps` (which spells out `enqueueJob`
 * in its own type) would have that literal text folded into its slice and
 * get misread as an unguarded spender. This function never calls
 * `enqueueJob` itself -- it delegates to `commitStoryDraftForAuthenticatedEditor`,
 * which already carries its own preflight -- exactly the same shape
 * `draftLead` in desk.ts already has, and that tripwire correctly leaves
 * `draftLead` alone for the same reason.
 */
export async function writeStoryForAuthenticatedEditor(
  input: {
    context: AuthenticatedEditorContext;
    text: string;
    documentIds?: string[];
    researchScope?: "public" | "supplied";
    modelChoice?: string;
    sectionKey?: string;
  },
  deps: WriteStoryCommitDeps = {},
) {
  if ((input.documentIds?.length??0)>20 || new Set(input.documentIds??[]).size!==(input.documentIds?.length??0)) return {ok:false as const,error:"Choose up to 20 different documents."};
  if (input.text.length > 20_000_000) return {ok:false as const,error:"Pasted text exceeds 20 million characters. Attach it in separate volumes."};
  const parsed = parseWriteStoryInput(input.text || (input.documentIds?.length ? "Write a story from the attached documents." : ""));
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  const { headline, why, urls, scratch, editorialAssignment } = parsed.value;
  let topic = parsed.value.topic;
  if (input.sectionKey !== undefined) {
    try {
      if (typeof input.sectionKey !== "string" || !input.sectionKey.trim()) throw new Error("Choose an active reporting section.");
      const config = await (deps.getSections ?? getSections)(input.context.newsroomId);
      const key = resolvedSectionKey(config.sections, input.sectionKey);
      if (key !== input.sectionKey || key === "about" || key === "opinion") throw new Error("Choose an active reporting section.");
      topic = key;
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not validate the selected section. Reload sections and retry." };
    }
  }

  const sql = await (deps.getSql ?? getSql)();
  await sql.query(
    "alter table leads add column if not exists notes_json text not null default '{}'",
  );
  if(input.documentIds?.length){
    const {ensureStoryDocuments}=await import('./story-documents.server.ts');await ensureStoryDocuments(sql);
    const available=await sql.query("select id from story_documents where id=any($1) and newsroom_id=$2 and user_id=$3 and lead_id is null and editorial_request_id is null and status='uploaded'",[input.documentIds,input.context.newsroomId,input.context.userId]);
    if(available.length!==input.documentIds.length)return {ok:false as const,error:"One of these uploads is incomplete or already attached. Select it again before writing."};
  }
  const notesJson = packNotes({ ...appendScratch(parseNotes(null), scratch), editorialAssignment, suppliedUrls: urls, researchScope: input.researchScope === "supplied" ? "supplied" : "public" });
  const urlsJson = JSON.stringify(urls);
  const rows = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, source_urls, evidence, newsworthiness, status, notes_json)
    values (
      ${input.context.userId}, ${input.context.newsroomId}, ${headline}, ${why}, ${topic},
      ${urlsJson}, ${why.slice(0, 400)}, 0, 'new', ${notesJson}
    )
    returning id
  `;
  const leadId = rows[0]?.id;
  if (!leadId) return { ok: false as const, error: "Could not file that lead." };
  /*
    Same reason `fileLead` writes both rows: `publishLead` reads the DRAFT's
    source_urls, not the lead's, so a story filed here without this row would
    print with no sources section at all.
  */
  await sql`
    insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls)
    values (
      ${input.context.userId}, ${input.context.newsroomId}, ${leadId}, ${headline}, ${why.slice(0, 220)}, '', ${topic}, ${urlsJson}
    )
  `;
  await (deps.audit ?? audit)(
    input.context.userId,
    "lead",
    `filed ${leadId}`,
    input.context.newsroomId,
  );

  const {linkStoryDocuments,storeStoryDocument}=await import("./story-documents.server.ts");
  const documentIds=[...(input.documentIds??[])];
  if(input.text.length>4000){
    const stored=await storeStoryDocument(input.context.newsroomId,input.context.userId,"Pasted source text.txt","text/plain",new TextEncoder().encode(input.text));
    documentIds.push(stored.id);
  }
  if(urls.length){
    const links=await storeStoryDocument(input.context.newsroomId,input.context.userId,"Supplied source links.txt","application/x-townreporter-source-links",new TextEncoder().encode(urls.join('\n')));
    documentIds.push(links.id);
  }
  await linkStoryDocuments(sql,input.context.newsroomId,input.context.userId,leadId,documentIds);
  const modelChoice = storyModelChoice(input.modelChoice);
  const commit = await commitStoryDraftForAuthenticatedEditor(
    { context: input.context, leadId, modelChoice, researchScope: input.researchScope },
    deps,
  );
  return { ...commit, leadId };
}
