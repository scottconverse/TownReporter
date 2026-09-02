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
  type OpinionModelChoice,
  type StoryModelChoice,
} from "./model-choice.ts";

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
  },
  deps: StoryDraftCommitDeps = {},
) {
  const sql = await (deps.getSql ?? getSql)();
  const leads = await sql<{ id: number; status: string }>`
    select id, status from leads
    where id = ${input.leadId} and newsroom_id = ${input.context.newsroomId}
    limit 1
  `;
  if (!leads[0]) return { ok: false as const, error: "Lead not found" };
  if (leads[0].status === "killed") {
    return { ok: false as const, error: "Restore this lead before drafting." };
  }

  const providerProbe = await (deps.probeProvider ?? probeProvider)(input.modelChoice);
  const ready = scanPreflight(providerProbe);
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
  const open = await (deps.findOpenJob ?? findOpenJob)({
    newsroomId: input.context.newsroomId,
    kind: "draft",
    subjectId: input.leadId,
  });
  if (open) {
    const persistedChoice = effectiveStoryModelChoice(open.model_choice);
    if (persistedChoice !== effectiveChoice) {
      return {
        ok: false as const,
        kind: "model-conflict" as const,
        error: `This lead is already drafting with ${modelChoiceLabel(persistedChoice)}. Open it to watch that run finish before choosing another model.`,
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
    modelChoiceSource: input.modelChoice === "auto" ? "auto" : "editor",
  });
  const persistedChoice = effectiveStoryModelChoice(job.model_choice);
  if (persistedChoice !== effectiveChoice) {
    return {
      ok: false as const,
      kind: "model-conflict" as const,
      error: `This lead is already drafting with ${modelChoiceLabel(persistedChoice)}. Open it to watch that run finish before choosing another model.`,
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
  },
  deps: ScanCommitDeps = {},
) {
  const providerProbe = await (deps.probeProvider ?? probeProvider)(input.modelChoice);
  const ready = scanPreflight(providerProbe);
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
  const open = await (deps.findOpenJob ?? findOpenJob)({
    newsroomId: input.context.newsroomId,
    kind: "scan",
  });
  if (open) {
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
    insert into scan_runs (user_id, newsroom_id) values (${input.context.userId}, ${input.context.newsroomId}) returning id
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
    modelChoice: OpinionModelChoice;
  },
  deps: OpinionCommitDeps = {},
) {
  const subject = String(input.subject ?? "")
    .trim()
    .slice(0, 400);
  if (subject.length < 6) {
    return { ok: false as const, error: "Give it a subject, a URL, or a sentence to work from." };
  }

  const readiness = await (deps.checkReadiness ?? checkOpinionReadiness)(input.modelChoice);
  if (!readiness.ready) return { ok: false as const, error: readiness.why };
  const effectiveChoice = readiness.effectiveChoice;

  // OAuth is checked before schema setup or a database handle is requested.
  // A signed-out provider therefore cannot mutate even database metadata, let
  // alone spend rate budget, insert a request, write an audit row, or enqueue.
  await (deps.ensureEditorialRequestSchema ?? ensureEditorialRequestSchemaDefault)();
  const sql = await (deps.getSql ?? getSql)();
  const pointers: { what: string; url?: string }[] = [];
  let ourStory: { headline: string; url: string; dek?: string } | undefined;
  let sourceKind = "paste";
  let sourceRef = subject;

  for (const match of subject.matchAll(/https?:\/\/\S+/g)) {
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
      (user_id, newsroom_id, subject, source_kind, source_ref, asked_for,
       pointers_json, our_story_json, model_choice)
    values (${input.context.userId}, ${input.context.newsroomId}, ${subject}, ${sourceKind},
            ${sourceRef}, ${String(input.askedFor ?? "").slice(0, 600)},
            ${JSON.stringify(pointers).slice(0, 8000)},
            ${ourStory ? JSON.stringify(ourStory) : null}, ${effectiveChoice})
    returning id
  `;
  const requestId = rows[0]!.id;
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
