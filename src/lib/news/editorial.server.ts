import { getSql, withTransaction } from "../db.ts";
import { claudeCodeChat } from "./ai-claude-code.server.ts";
import {
  orchestrateEditorial,
  type EffectiveOpinionModelChoice,
  type FiledEditorialResult,
  type WriteEditorialInput,
  type WriteEditorialResult,
} from "./editorial-orchestration.ts";
import { findVoiceFile, readVoiceTextForOpenAiCodex } from "./voice.server.ts";
import { opinionModelChoice } from "./model-choice.ts";
import {
  persistEditorialCompletion,
  persistEditorialSuccess,
} from "./editorial-result-persistence.ts";
import {
  EDITORIAL_TOOLS,
  RESEARCH_INSTRUCTIONS,
  buildWritingPack,
  opinionHeadline,
  type Editorial,
  type EditorialPointer,
} from "./editorial.ts";

export type { WriteEditorialInput, WriteEditorialResult } from "./editorial-orchestration.ts";

/**
 * Writing an editorial, and filing it as a draft.
 *
 * Two model calls, not one — ENG-107. Research and writing used to be a
 * single call with WebSearch/WebFetch on AND the voice file loaded, which put
 * the operator's private editorial voice in the same context as pages an
 * editor — or the piece's own subject — pointed it at, while it held a tool
 * that could send data back out. Now: a gathering pass has the tools and
 * never sees the voice, on the cheap planner model; its plain-text output
 * feeds a writing pass on the expensive model. On the Claude path,
 * `claudeCodeChat` in ai-claude-code.server.ts refuses to combine
 * `systemPromptFile` with Claude's explicitly allowed research tools.
 *
 * Claude receives only the voice path. The operator has separately authorized
 * OpenAI Codex Opinion, so that path reads the validated voice text and sends
 * it through stdin. Codex keeps the signed-in Windows user's native config,
 * rules, search, skills, plugins, and local-machine capabilities in both
 * passes; TownReporter does not impose a second capability policy. The voice
 * is never placed in argv or TownReporter logs.
 */

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
 * one these measurements describe; the Claude writing pass has no research
 * tools and is expected to be faster, but reuses the same generous ceiling rather than a
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
  return orchestrateEditorial(input, {
    findVoiceFile,
    readVoiceTextForOpenAiCodex,
    codexChat: async (request) => {
      const { codexChat } = await import("./ai-codex.server.ts");
      return codexChat(request);
    },
    runClaudePair: async ({ input: editorialInput, found, researchPack }) => {
      const { resolveClaudeCode, plannerModel } = await import("./ai");
      if (!resolveClaudeCode()) {
        return {
          ok: false,
          error: "Claude is unavailable. Open Claude Code, sign in, then try again.",
        };
      }
      const research = await claudeCodeChat({
        system: RESEARCH_INSTRUCTIONS,
        user: researchPack,
        model: plannerModel() || "claude-haiku-4-5-20251001",
        allowedTools: EDITORIAL_TOOLS,
        timeoutMs: editorialTimeoutMs(),
      });
      if (!research.ok) return research;
      return claudeCodeChat({
        system: "",
        systemPromptFile: found.voice.path,
        user: buildWritingPack({
          subject: editorialInput.subject,
          ourStory: editorialInput.ourStory,
          askedFor: editorialInput.askedFor,
          research: research.text,
        }),
        model: process.env.TOWNREPORTER_EDITORIAL_MODEL?.trim() || "claude-opus-5",
        timeoutMs: editorialTimeoutMs(),
      });
    },
    fileEditorial,
    timeoutMs: editorialTimeoutMs,
    codexModel: process.env.TOWNREPORTER_CODEX_SOL_MODEL?.trim() || "gpt-5.6-sol",
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
): Promise<FiledEditorialResult> {
  await ensureEditorialSchema();
  if (input.completion && !modelChoice) {
    throw new Error("A queued editorial completion requires the provider that produced it.");
  }

  // Receipts at the end of the piece, where the reader can reach them.
  const body = ed.appendix ? `${ed.body}\n\n---\n\nCLAIMS AND SOURCES\n\n${ed.appendix}` : ed.body;

  const headline = opinionHeadline(ed.headline);
  return withTransaction(async (sql) => {
    if (input.completion) {
      const [request] = await sql<{ draft_id: number | null; model_choice: string }>`
        select draft_id, model_choice from editorial_requests
        where id = ${input.completion.requestId} and newsroom_id = ${input.newsroomId}
        for update
      `;
      if (!request) {
        throw new Error(
          `Editorial request ${input.completion.requestId} was not found during filing.`,
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
      insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, form)
      values (
        ${input.userId}, ${input.newsroomId}, ${input.leadId ?? null},
        ${headline}, ${""}, ${body}, ${"opinion"}, ${"[]"}, ${"editorial"}
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
      hadAppendix: Boolean(ed.appendix),
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
}

type EditorialWorkDeps = {
  writeEditorial?: (input: WriteEditorialInput) => Promise<WriteEditorialResult>;
};

export async function performEditorialWork(
  job: {
    id: number;
    user_id: string;
    newsroom_id: number;
    subject_id: number;
  },
  deps: EditorialWorkDeps = {},
) {
  await ensureEditorialRequestSchema();
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    subject: string;
    source_kind: string;
    source_ref: string;
    asked_for: string;
    pointers_json: string;
    our_story_json: string | null;
    model_choice: string;
    draft_id: number | null;
  }>`
    select id, subject, source_kind, source_ref, asked_for, pointers_json, our_story_json,
           model_choice, draft_id
    from editorial_requests
    where id = ${job.subject_id} and newsroom_id = ${job.newsroom_id} limit 1
  `;
  const req = rows[0];
  if (!req) throw new Error("Editorial request not found");

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

  const result = await (deps.writeEditorial ?? writeEditorial)({
    userId: job.user_id,
    newsroomId: job.newsroom_id,
    subject: req.subject,
    pointers,
    ourStory,
    askedFor: req.asked_for,
    sourceKind: req.source_kind,
    sourceRef: req.source_ref,
    modelChoice: opinionModelChoice(req.model_choice),
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
