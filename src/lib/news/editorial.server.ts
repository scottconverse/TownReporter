import { getSql, withTransaction } from "../db.ts";
import { claudeCodeChat } from "./ai-claude-code.server.ts";
import { grokChat, probeProvider } from "./ai.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import {
  orchestrateEditorial,
  type EffectiveOpinionModelChoice,
  type FiledEditorialResult,
  type WriteEditorialInput,
  type WriteEditorialResult,
} from "./editorial-orchestration.ts";
import { findVoiceFile, readVoiceTextForLocalModel } from "./voice.server.ts";
import { getPaperConfig } from "./paper-settings.ts";
import { modelChoiceLabel, opinionModelChoice, OPINION_AUTOMATIC_LADDER } from "./model-choice.ts";
import { setJobFailoverNote, setJobModelRuntime, setJobStage } from "./jobs.ts";
import {
  persistEditorialCompletion,
  persistEditorialSuccess,
} from "./editorial-result-persistence.ts";
import {
  EDITORIAL_TOOLS,
  RESEARCH_INSTRUCTIONS,
  buildWritingPack,
  opinionHeadline,
  editorialSourcesError,
  type Editorial,
  type EditorialPointer,
} from "./editorial.ts";
import { modelEffort, plannerModelFor, providerEntry, providerModel } from "./provider-registry.ts";
import { failoverNoteSentence, failoverReasonPhrase } from "./automatic-failover.ts";
import { nameCheckText, type NameCheck } from "./name-check.ts";
import { officialDomains } from "./absence-gate.ts";
import { opinionFallbackRuntimeReceipt } from "./opinion-runtime-receipt.ts";

export type { WriteEditorialInput, WriteEditorialResult } from "./editorial-orchestration.ts";

/** Research supplies leads; the writer independently opens sources and files an
 * editorial with claims and sources. Both subscription writers retain web
 * research during writing. Both CLIs load the complete voice by file path,
 * never as prompt text in argv or application logs. */

/**
 * Editorials take tens of minutes, not seconds. The voice researches first.
 *
 * Three measured runs, not a guess:
 *
 *   9m53s   32 turns   $2.66    one document pointer
 *   24m06s             $23.76   one pointer, and it dispatched its own agents
 *   >30m                        the same subject again, killed at the cap
 *
 * Fifteen minutes killed the first real request on the desk with the work
 * already paid for; thirty killed the second. The spread is wide because the
 * voice decides for itself how much to go and read, so the cap has to sit well
 * above the slowest run seen rather than just above the fastest.
 *
 * This is a ceiling, not a target. Nothing waits on it: the desk enqueues a job
 * and returns at once, and the page counts up while it works.
 *
 * ENG-107 split research and writing into two calls (see `writeEditorial`),
 * so this ceiling now applies PER PASS, not once. The gathering pass is the
 * one these measurements describe; the writing pass verifies sources too
 * and reuses the same generous ceiling rather than a
 * separately tuned one — one knob for the operator, and the two runs above
 * were the whole spread this ceiling was set from in the first place. Worst
 * case, a piece now takes up to roughly double the wall-clock time this
 * comment's numbers describe; the operator accepted that as proportionate to
 * an editorial's existing ~$23 / ~24-minute cost.
 */
const EDITORIAL_TIMEOUT_DEFAULT_MS = 2_700_000;

/**
 * Overridable, because the manual told operators they could.
 *
 * docs/editor.md said "the operator can raise EDITORIAL_TIMEOUT_MS" and no
 * such variable existed — I invented it while writing the troubleshooting
 * table, and an audit caught it (TW-003). Implementing it is the better fix
 * than deleting the sentence: the spread between measured runs was 9m53s to
 * over 30 minutes, so a slower box genuinely may need more.
 *
 * Floored at a minute so a typo cannot make every editorial fail instantly.
 */
function editorialTimeoutMs(): number {
  const raw = process.env.EDITORIAL_TIMEOUT_MS?.trim();
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : EDITORIAL_TIMEOUT_DEFAULT_MS;
}

export async function ensureEditorialSchema() {
  const sql = await getSql();
  /*
    The reader-facing parts live on the draft: the appendix is appended to the
    body because the operator asked for receipts at the end of the piece, where
    a reader who dislikes it can check them.

    The desk-facing parts do not belong in the story, so they live here.
  */
  await sql.query(`
    create table if not exists editorial_extras (
      draft_id integer primary key,
      newsroom_id integer not null default 1,
      fact_sheet text not null default '',
      image_prompt text not null default '',
      source_kind text not null default '',
      source_ref text not null default '',
      generated_at timestamptz not null default now()
    )
  `);
}

export async function writeEditorial(input: WriteEditorialInput): Promise<WriteEditorialResult> {
  const cfg = await getPaperConfig(input.newsroomId);
  input = {
    ...input,
    paper: {
      name: cfg.name,
      city: cfg.city,
      officialDomains: officialDomains(
        cfg.city,
        input.pointers.map((pointer) => pointer.url),
      ),
    },
  };
  // One completed gathering pass is a checkpoint. If the writer has a
  // technical failure, a fallback writer receives this saved research text
  // instead of repeating the searches and source opens already completed.
  let completedResearch: string | null = null;
  return orchestrateEditorial(input, {
    findVoiceFile,
    runClaudePair: async ({ input: editorialInput, found, researchPack }) => {
      const { resolveClaudeCode } = await import("./ai");
      if (!resolveClaudeCode()) {
        return {
          ok: false,
          error: "Claude is unavailable. Open Claude Code, sign in, then try again.",
        };
      }
      const choice = opinionModelChoice(editorialInput.modelChoice);
      const entry = providerEntry(choice);
      if (!entry || entry.kind !== "claude-code") {
        return { ok: false, error: "The selected Claude model is unavailable." };
      }
      if (completedResearch === null) {
        const research = await claudeCodeChat({
          system: RESEARCH_INSTRUCTIONS,
          user: researchPack,
          model: plannerModelFor(choice) || providerModel(entry),
          allowedTools: EDITORIAL_TOOLS,
          timeoutMs: editorialTimeoutMs(),
          reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
        });
        if (!research.ok) return research;
        completedResearch = research.text;
      }
      if (editorialInput.completion)
        await setJobStage(editorialInput.completion.jobId, "Writing the editorial");
      return claudeCodeChat({
        system: "",
        systemPromptFile: found.voice.path,
        allowedTools: EDITORIAL_TOOLS,
        user: buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: completedResearch,
        }),
        model: providerModel(entry),
        timeoutMs: editorialTimeoutMs(),
        reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
      });
    },
    runCodexPair: async ({ input: editorialInput, found, researchPack }) => {
      const { codexChat } = await import("./ai-codex.server.ts");
      const choice = opinionModelChoice(editorialInput.modelChoice);
      const entry = providerEntry(choice);
      if (!entry || entry.kind !== "codex") {
        return { ok: false, error: "The selected Codex model is unavailable." };
      }
      if (completedResearch === null) {
        const research = await codexChat({
          system: RESEARCH_INSTRUCTIONS,
          user: researchPack,
          model: plannerModelFor(choice),
          timeoutMs: editorialTimeoutMs(),
          webSearch: true,
          reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
        });
        if (!research.ok) return research;
        completedResearch = research.text;
      }
      if (editorialInput.completion)
        await setJobStage(editorialInput.completion.jobId, "Writing the editorial");
      return codexChat({
        system: "",
        systemPromptFile: found.voice.path,
        user: buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: completedResearch,
        }),
        model: providerModel(entry),
        timeoutMs: editorialTimeoutMs(),
        reasoningEffort: modelEffort(choice, editorialInput.modelEffort),
      });
    },
    /*
      The Local model pair. Unlike the Claude Code CLI, a local server has no
      WebSearch/WebFetch tool loop to run a separate gathering pass with (see
      EDITORIAL_TOOLS), so this is one call: it writes straight from the
      editor's own pointers via `buildWritingPack({ research: "" })`, which
      renders the honest "the gathering pass found nothing usable" note
      rather than pretending research happened. It has no `--system-prompt-
      file` equivalent either, so the voice travels as an ordinary system
      string through `readVoiceTextForLocalModel` -- the same destination-
      named-authorization idea voice.server.ts's other text export used for a
      withdrawn provider path, scoped to this one call site.
    */
    runLocalPair: async ({ input: editorialInput }) => {
      const voice = await readVoiceTextForLocalModel();
      if (!voice.ok) return voice;
      const { grokChat } = await import("./ai");
      // Same per-newsroom "which local server/model" pick every other
      // surface honours (Story, Scan, Dark Desk) -- see
      // ./provider-settings.ts's `resolveLocalModelChoice`. Failure here
      // (no database, discovery unreachable) falls back to the env-only
      // resolution `localGateway()` already does, exactly as before this
      // wiring existed.
      const localModel = await import("./provider-settings.ts")
        .then((m) => m.resolveLocalModelChoice(editorialInput.newsroomId, "opinion"))
        .then((r) => r.override)
        .catch(() => undefined);
      return grokChat(
        voice.text,
        buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: editorialInput.sourceText ?? "",
        }),
        4_000,
        {
          timeoutMs: editorialTimeoutMs(),
          choice: "local-model",
          localModel,
          reasoningEffort: modelEffort(
            "local-model",
            editorialInput.modelEffort,
            localModel?.id,
          ),
        },
      );
    },
    runCustomPair: async ({ input: editorialInput }) => {
      const voice = await readVoiceTextForLocalModel();
      if (!voice.ok) return voice;
      const { grokChat } = await import("./ai");
      return grokChat(
        voice.text,
        buildWritingPack({
          paper: editorialInput.paper,
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: editorialInput.sourceText ?? "",
        }),
        4_000,
        {
          timeoutMs: editorialTimeoutMs(),
          choice: editorialInput.modelChoice,
          newsroomId: editorialInput.newsroomId,
          // The custom resolver supplies the exact saved model to grokChat;
          // its transport performs the final model-specific validation.
          reasoningEffort: modelEffort(
            editorialInput.modelChoice,
            editorialInput.modelEffort,
          ),
        },
      );
    },
    fileEditorial,
    timeoutMs: editorialTimeoutMs,
    onTechnicalFallback: async ({ previous, next, reason }) => {
      if (!input.completion) return;
      const receipt = opinionFallbackRuntimeReceipt({
        requestedRuntime: opinionModelChoice(input.requestedModelChoice ?? input.modelChoice),
        requestedEffort: input.requestedModelEffort ?? input.modelEffort,
        previous,
        next,
        reason,
      });
      await setJobModelRuntime(
        input.completion.jobId,
        receipt.actualRuntime,
        receipt.actualEffort,
        receipt.requestedRuntime,
        receipt.requestedEffort,
        "writer",
      );
      await setJobStage(input.completion.jobId, receipt.stage);
      await setJobFailoverNote(input.completion.jobId, receipt.note);
    },
  });
}

/**
 * File the five parts.
 *
 * Split deliberately from the writing so the parse and the storage can be
 * tested without spending ten minutes and several dollars on a model call.
 */
export async function fileEditorial(
  input: WriteEditorialInput,
  ed: Editorial,
  modelChoice?: EffectiveOpinionModelChoice,
  deps: {
    checkEditorialNames?: typeof import("./editorial-name-check.ts").checkEditorialNames;
    setJobStage?: typeof setJobStage;
  } = {},
): Promise<FiledEditorialResult> {
  await ensureEditorialSchema();
  if (input.completion && !modelChoice) {
    throw new Error("A queued editorial completion requires the provider that produced it.");
  }

  let nameCheck: NameCheck | undefined;
  let integrityNotes = editorialSourcesError(ed.appendix) ?? "";
  if (input.completion && modelChoice) {
    await (deps.setJobStage ?? setJobStage)(input.completion.jobId, "Checking names and spellings");
    const checkEditorialNames =
      deps.checkEditorialNames ?? (await import("./editorial-name-check.ts")).checkEditorialNames;
    let nameRuntime = {
      modelChoice,
      modelEffort: modelEffort(modelChoice, input.modelEffort),
    };
    const requestedRuntime = opinionModelChoice(input.requestedModelChoice ?? input.modelChoice);
    const requestedEffort = input.requestedModelEffort ?? input.modelEffort ?? null;
    // The provider that produced the saved prose and the provider that checks
    // it are separate facts. Record the writer before a checker can switch.
    await setJobModelRuntime(
      input.completion.jobId,
      nameRuntime.modelChoice,
      nameRuntime.modelEffort,
      requestedRuntime,
      requestedEffort,
      "writer",
    );
    await setJobModelRuntime(
      input.completion.jobId,
      nameRuntime.modelChoice,
      nameRuntime.modelEffort,
      requestedRuntime,
      requestedEffort,
      "checker",
    );
    const recordNameSwitch = async (
      nextChoice: EffectiveOpinionModelChoice,
      reason: import("./automatic-failover.ts").AutomaticFailoverReason,
      suppliedNextLabel?: string,
    ) => {
      if (nextChoice === nameRuntime.modelChoice) return;
      const previousLabel = modelChoiceLabel(nameRuntime.modelChoice);
      const nextLabel = suppliedNextLabel ?? modelChoiceLabel(nextChoice);
      const nextEffort = modelEffort(nextChoice, nameRuntime.modelEffort);
      await setJobModelRuntime(
        input.completion!.jobId,
        nextChoice,
        nextEffort,
        requestedRuntime,
        requestedEffort,
        "checker",
      );
      await setJobStage(input.completion!.jobId, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
      await setJobFailoverNote(input.completion!.jobId, failoverNoteSentence(nextLabel, previousLabel, reason));
      // The request's model_choice is author attribution. A checker-only
      // fallback is recorded on runtimeByStage.checker and must not relabel
      // the already-written editorial as the checker provider's work.
      nameRuntime = { modelChoice: nextChoice, modelEffort: nextEffort };
    };
    const nameChat: import("./report.ts").ReportChat = async (
      system,
      user,
      maxTokens,
      _choice,
      options,
    ) => {
      const attempted = await runPinnedCallWithFailover({
        snapshot: nameRuntime,
        source: "editor",
        ladder: OPINION_AUTOMATIC_LADDER,
        run: (snapshot) => grokChat(system, user, maxTokens, {
          choice: snapshot.modelChoice,
          newsroomId: input.newsroomId,
          timeoutMs: options?.timeoutMs,
          noTools: true,
          reasoningEffort: snapshot.modelEffort,
        }),
        probe: (choice) => probeProvider(choice, input.newsroomId),
        resolve: async (choice) => ({
          modelChoice: choice as EffectiveOpinionModelChoice,
          modelEffort: modelEffort(choice, nameRuntime.modelEffort),
        }),
        onSwitch: async ({ previousLabel, nextLabel, nextChoice, reason }) => {
          void previousLabel;
          await recordNameSwitch(nextChoice as EffectiveOpinionModelChoice, reason, nextLabel);
        },
      });
      nameRuntime = attempted.snapshot;
      return attempted.result;
    };
    const checked = await checkEditorialNames({
      newsroomId: input.newsroomId,
      editorialRequestId: input.completion.requestId,
      modelChoice: nameRuntime.modelChoice,
      modelEffort: nameRuntime.modelEffort,
      onProviderSwitch: async ({ transport, model, reason }) => {
        const nextChoice: EffectiveOpinionModelChoice | null = transport === "codex"
          ? "codex-balanced"
          : transport === "anthropic" || transport === "claude-code"
            ? (/haiku/i.test(model) ? "claude-haiku" : "claude-sonnet")
            : null;
        if (nextChoice) await recordNameSwitch(nextChoice, reason);
      },
      chat: nameChat,
      userId: input.userId,
      publicResearchAllowed: true,
      officialDomains: input.paper?.officialDomains ?? [],
      editorial: ed,
      integrityNotes,
      city: input.paper?.city ?? "",
    });
    ed = checked.editorial;
    nameCheck = checked.nameCheck;
    integrityNotes = checked.integrityNotes;
  }

  // Receipts at the end of the piece, where the reader can reach them.
  const body = ed.appendix ? `${ed.body}\n\n---\n\nCLAIMS AND SOURCES\n\n${ed.appendix}` : ed.body;

  const headline = opinionHeadline(ed.headline);
  if (nameCheck)
    nameCheck = { ...nameCheck, checkedText: nameCheckText({ headline, dek: "", body }) };
  return withTransaction(async (sql) => {
    if (input.completion) {
      const [request] = await sql<{
        draft_id: number | null;
        model_choice: string;
        source_kind: string;
      }>`
        select draft_id, model_choice, source_kind from editorial_requests
        where id = ${input.completion.requestId} and newsroom_id = ${input.newsroomId}
        for update
      `;
      if (!request) {
        throw new Error(
          `Editorial request ${input.completion.requestId} was not found during filing.`,
        );
      }

      if (request.source_kind === "legal-removed") {
        throw new Error(
          "The request's source was legally removed. Review sources and start a new request; stale output was not filed.",
        );
      }

      if (request.draft_id !== null) {
        const [existing] = await sql<{ id: number; headline: string; body: string }>`
          select id, headline, body from drafts
          where id = ${request.draft_id} and newsroom_id = ${input.newsroomId}
          limit 1
        `;
        if (existing) {
          const storedChoice = opinionModelChoice(request.model_choice);
          await persistEditorialCompletion(sql, {
            requestId: input.completion.requestId,
            jobId: input.completion.jobId,
            newsroomId: input.newsroomId,
            draftId: existing.id,
            modelChoice: storedChoice === "auto" ? modelChoice! : storedChoice,
          });
          return {
            ok: true,
            draftId: existing.id,
            headline: existing.headline,
            words: existing.body.split(/\s+/).filter(Boolean).length,
            hadAppendix: existing.body.includes("\nCLAIMS AND SOURCES\n"),
          };
        }
      }
    }

    const rows = await sql<{ id: number }>`
      insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, form, integrity_notes, research_json)
      values (
        ${input.userId}, ${input.newsroomId}, ${input.leadId ?? null},
        ${headline}, ${""}, ${body}, ${"opinion"}, ${"[]"}, ${"editorial"},
        ${integrityNotes}, ${JSON.stringify(nameCheck ? { nameCheck } : {})}
      )
      returning id
    `;
    const draftId = rows[0]!.id;

    await sql`
      insert into editorial_extras (draft_id, newsroom_id, fact_sheet, image_prompt, source_kind, source_ref)
      values (${draftId}, ${input.newsroomId}, ${ed.factSheet.slice(0, 8000)},
              ${ed.imagePrompt.slice(0, 4000)}, ${input.sourceKind}, ${input.sourceRef})
      on conflict (draft_id) do update
        set fact_sheet = excluded.fact_sheet, image_prompt = excluded.image_prompt,
            generated_at = now()
    `;

    const filed = {
      ok: true as const,
      draftId,
      headline,
      words: ed.body.split(/\s+/).filter(Boolean).length,
      hadAppendix: editorialSourcesError(ed.appendix) === null,
    };
    if (input.completion) {
      await persistEditorialSuccess(sql, {
        requestId: input.completion.requestId,
        jobId: input.completion.jobId,
        newsroomId: input.newsroomId,
        result: { ...filed, modelChoice: modelChoice! },
      });
    }
    return filed;
  });
}

/**
 * A request to write one, and the job that does it.
 *
 * The request is a row rather than a job argument because a job carries only an
 * integer subject, and an editorial needs a subject line, pointers, and what
 * the editor asked for. The row is also where the result lands, so the desk can
 * show "writing…" and then the piece without polling the model.
 */
export async function ensureEditorialRequestSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists editorial_requests (
      id serial primary key,
      user_id text not null,
      newsroom_id integer not null default 1,
      subject text not null,
      source_text text not null default '',
      source_kind text not null default 'paste',
      source_ref text not null default '',
      asked_for text not null default '',
      pointers_json text not null default '[]',
      our_story_json text,
      model_choice text not null default 'auto',
      draft_id integer,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )
  `);
  await sql.query(
    `alter table editorial_requests add column if not exists model_choice text not null default 'auto'`,
  );
  await sql.query(
    `alter table editorial_requests add column if not exists source_text text not null default ''`,
  );
}

type EditorialWorkDeps = {
  writeEditorial?: (input: WriteEditorialInput) => Promise<WriteEditorialResult>;
  readEditorialDocuments?: typeof import("./story-documents.server.ts").readEditorialDocuments;
  documentProbe?: typeof probeProvider;
  documentChat?: typeof grokChat;
};

export async function performEditorialWork(
  job: {
    id: number;
    user_id: string;
    newsroom_id: number;
    subject_id: number;
    model_choice: string;
    model_choice_source?: "editor" | "auto" | "scheduled";
    result_json?: string;
  },
  deps: EditorialWorkDeps = {},
) {
  await ensureEditorialRequestSchema();
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    subject: string;
    source_text: string;
    source_kind: string;
    source_ref: string;
    asked_for: string;
    pointers_json: string;
    our_story_json: string | null;
    model_choice: string;
    draft_id: number | null;
  }>`
    select id, subject, source_text, source_kind, source_ref, asked_for, pointers_json, our_story_json,
           model_choice, draft_id
    from editorial_requests
    where id = ${job.subject_id} and newsroom_id = ${job.newsroom_id} limit 1
  `;
  const req = rows[0];
  if (!req) throw new Error("Editorial request not found");
  let jobReceipt: {
    modelEffort?: unknown;
    requestedRuntime?: unknown;
    requestedEffort?: unknown;
  } = {};
  try {
    jobReceipt = JSON.parse(job.result_json || "{}") as typeof jobReceipt;
  } catch {
    jobReceipt = {};
  }

  if (req.source_kind === "legal-removed") {
    throw new Error(
      "The request's source was legally removed. Review sources and start a new request.",
    );
  }

  if (req.draft_id !== null) {
    const reused = await withTransaction(async (tx) => {
      const [current] = await tx<{ draft_id: number | null; model_choice: string }>`
        select draft_id, model_choice from editorial_requests
        where id = ${req.id} and newsroom_id = ${job.newsroom_id}
        for update
      `;
      if (!current || current.draft_id === null) return false;
      const [draft] = await tx<{ id: number }>`
        select id from drafts
        where id = ${current.draft_id} and newsroom_id = ${job.newsroom_id}
        limit 1
      `;
      if (!draft) return false;
      await persistEditorialCompletion(tx, {
        requestId: req.id,
        jobId: job.id,
        newsroomId: job.newsroom_id,
        draftId: draft.id,
        modelChoice: opinionModelChoice(current.model_choice),
      });
      return true;
    });
    if (reused) return;
  }

  let pointers: EditorialPointer[] = [];
  let ourStory: { headline: string; url: string; dek?: string } | undefined;
  try {
    pointers = JSON.parse(req.pointers_json) as EditorialPointer[];
  } catch {
    pointers = [];
  }
  try {
    ourStory = req.our_story_json ? JSON.parse(req.our_story_json) : undefined;
  } catch {
    ourStory = undefined;
  }

  let documentEvidence = "";
  const readEditorialDocuments =
    deps.readEditorialDocuments ??
    (await import("./story-documents.server.ts")).readEditorialDocuments;
  const requestedChoice = opinionModelChoice(
    typeof jobReceipt.requestedRuntime === "string"
      ? jobReceipt.requestedRuntime
      : req.model_choice,
  );
  const requestedEffort = modelEffort(
    requestedChoice,
    jobReceipt.requestedEffort ?? jobReceipt.modelEffort,
  );
  const currentChoice = opinionModelChoice(req.model_choice);
  let activeChoice = (currentChoice === "auto" ? OPINION_AUTOMATIC_LADDER[0] : currentChoice) as EffectiveOpinionModelChoice;
  let activeEffort = modelEffort(activeChoice, jobReceipt.modelEffort);
  try {
    documentEvidence = await readEditorialDocuments(
        job.newsroom_id,
        req.id,
        activeChoice as Parameters<typeof readEditorialDocuments>[2],
        [req.subject, req.asked_for].filter(Boolean).join("\n"),
        (stage) => setJobStage(job.id, stage),
        job.user_id,
        {
          modelEffort: activeEffort,
          source: requestedChoice === "auto" ? "auto" : (job.model_choice_source ?? "editor"),
          ladder: OPINION_AUTOMATIC_LADDER,
          probe: (choice) => (deps.documentProbe ?? probeProvider)(choice, job.newsroom_id),
          chat: deps.documentChat,
          onSwitch: async ({ previousLabel, nextLabel, nextChoice, nextEffort, reason }) => {
            activeChoice = nextChoice as EffectiveOpinionModelChoice;
            activeEffort = nextEffort;
            await setJobModelRuntime(
              job.id,
              nextChoice,
              nextEffort,
              requestedChoice,
              requestedEffort,
              "documents",
            );
            await setJobStage(job.id, `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, reason)}`);
            await setJobFailoverNote(job.id, failoverNoteSentence(nextLabel, previousLabel, reason));
            await sql`update editorial_requests set model_choice=${nextChoice} where id=${req.id} and newsroom_id=${job.newsroom_id}`;
          },
        },
      );
  } catch (readingFailure) {
    const detail =
      readingFailure instanceof Error ? readingFailure.message : String(readingFailure);
    await sql`update editorial_requests set error=${detail.slice(0, 800)},finished_at=now()
      where id=${req.id} and newsroom_id=${job.newsroom_id} and draft_id is null`;
    throw readingFailure;
  }
  await setJobStage(job.id, "Researching the editorial");
  const result = await (deps.writeEditorial ?? writeEditorial)({
    userId: job.user_id,
    newsroomId: job.newsroom_id,
    subject: req.subject,
    sourceText: documentEvidence || req.source_text || req.subject,
    pointers,
    ourStory,
    askedFor: req.asked_for,
    sourceKind: req.source_kind,
    sourceRef: req.source_ref,
    modelChoice: activeChoice,
    modelEffort: activeEffort,
    requestedModelChoice: requestedChoice,
    requestedModelEffort: requestedEffort,
    completion: { requestId: req.id, jobId: job.id },
  });

  if (!result.ok) {
    // A reclaimed job can finish while its old provider call is still alive.
    // That old call's failure must not turn the successfully filed piece
    // back into a failed request; executeJob separately guards the job claim.
    await sql`
      update editorial_requests set error = ${result.error.slice(0, 800)}, finished_at = now()
      where id = ${req.id} and newsroom_id = ${job.newsroom_id} and draft_id is null
    `;
    throw new Error(result.error);
  }
}
