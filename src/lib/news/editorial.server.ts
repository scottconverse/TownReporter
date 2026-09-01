import { getSql } from "@/lib/db";
import { claudeCodeChat } from "./ai-claude-code.server";
import { findVoiceFile } from "./voice.server";
import { opinionModelChoice, type OpinionModelChoice } from "./model-choice.ts";
import {
  EDITORIAL_TOOLS,
  RESEARCH_INSTRUCTIONS,
  buildEditorialPack,
  buildWritingPack,
  opinionHeadline,
  parseEditorial,
  type Editorial,
  type EditorialPointer,
} from "./editorial";

/**
 * Writing an editorial, and filing it as a draft.
 *
 * Two model calls, not one — ENG-107. Research and writing used to be a
 * single call with WebSearch/WebFetch on AND the voice file loaded, which put
 * the operator's private editorial voice in the same context as pages an
 * editor — or the piece's own subject — pointed it at, while it held a tool
 * that could send data back out. Now: a gathering pass has the tools and
 * never sees the voice, on the cheap planner model; its plain-text output
 * feeds a writing pass that has the voice and no tools at all, on the
 * expensive model. `claudeCodeChat` in ai-claude-code.server.ts refuses to
 * run a call that combines `systemPromptFile` with any `allowedTools` — that
 * is the structural half of this fix; this file is the shape half.
 *
 * The voice file is never read into this process either way. Only its path
 * goes to the CLI, which reads it directly. See `voice.server.ts` for why
 * that matters.
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
 * one these measurements describe; the writing pass has no tools and is
 * expected to be faster, but reuses the same generous ceiling rather than a
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

export type WriteEditorialInput = {
  userId: string;
  newsroomId: number;
  subject: string;
  pointers: EditorialPointer[];
  ourStory?: { headline: string; url: string; dek?: string };
  askedFor?: string;
  /** For the record on the draft: what this was written from. */
  sourceKind: string;
  sourceRef: string;
  leadId?: number | null;
  modelChoice?: OpinionModelChoice;
};

export type WriteEditorialResult =
  | { ok: true; draftId: number; headline: string; words: number; hadAppendix: boolean }
  | { ok: false; error: string };

export async function writeEditorial(input: WriteEditorialInput): Promise<WriteEditorialResult> {
  /*
    Opinion is the one feature that genuinely needs the Claude Code CLI. The
    voice is passed as --system-prompt-file so the file never becomes a
    command-line argument, and the piece is written with WebSearch and
    WebFetch; no OpenAI-compatible endpoint offers either.

    That exception is legitimate. Ignoring the operator is not. This module
    called claudeCodeChat directly, so somebody who had explicitly set
    TOWNREPORTER_CLAUDE_CODE=0 still got the CLI used behind their back —
    audit finding TW-001. Refuse, and say why.

    Checked before the voice file is read: no point looking up a file we
    cannot use.
  */
  const found = await findVoiceFile();
  if (!found.ok) return { ok: false, error: found.error };

  /*
    Pass one: gathering. Tools on, voice absent — this call never receives
    `systemPromptFile`, so it cannot see the voice at all. It runs on the
    cheap planner model, because it is retrieval, not the product.

    `plannerModel()` returns "" when the app's *general* provider is not
    Claude (an OpenAI-compatible gateway, say) — that means "no opinion,
    keep the caller's model" for callers that pass a provider-native model
    id. This call always goes straight to the `claude` CLI regardless of
    what `resolveProvider()` picked elsewhere, so an empty answer has to
    fall back to a real Claude model id here rather than an empty string.
  */
  const researchPack = buildEditorialPack({
    subject: input.subject,
    pointers: input.pointers,
    ourStory: input.ourStory,
    askedFor: input.askedFor,
  });

  const runPair = async (choice: "claude-frontier" | "codex-frontier") => {
    if (choice === "claude-frontier") {
      const { resolveClaudeCode, plannerModel } = await import("./ai");
      if (!resolveClaudeCode()) {
        return { ok: false as const, error: "Claude is unavailable. Open Claude Code, sign in, then try again." };
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
          subject: input.subject,
          ourStory: input.ourStory,
          askedFor: input.askedFor,
          research: research.text,
        }),
        model: process.env.TOWNREPORTER_EDITORIAL_MODEL?.trim() || "claude-opus-5",
        timeoutMs: editorialTimeoutMs(),
      });
    }

    /*
      Codex research support is implemented by codexChat({ webSearch: true }),
      with every local capability disabled. The private voice cannot be handed
      to Codex by path: that would give an untrusted agent local file access.
      Sending the voice text to OpenAI requires the operator's explicit
      payload-and-destination authorization, which is not inferred here.
      Refuse before spending the research pass until that authorization is
      represented by an explicit product setting.
    */
    return {
      ok: false as const,
      error:
        "Codex Opinion is not enabled yet. Its research boundary is ready, but sending the private editorial voice to OpenAI requires explicit authorization. Choose Claude Opus for Opinion.",
    };
  };

  const choice = opinionModelChoice(input.modelChoice);
  let out = await runPair(choice === "auto" ? "claude-frontier" : choice);
  if (!out.ok && choice === "auto") out = await runPair("codex-frontier");
  if (!out.ok) return { ok: false, error: out.error };

  const ed = parseEditorial(out.text);
  if (!ed.body.trim()) return { ok: false, error: "The voice returned nothing usable." };

  return fileEditorial(input, ed);
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
): Promise<WriteEditorialResult> {
  await ensureEditorialSchema();
  const sql = await getSql();

  // Receipts at the end of the piece, where the reader can reach them.
  const body = ed.appendix
    ? `${ed.body}\n\n---\n\nCLAIMS AND SOURCES\n\n${ed.appendix}`
    : ed.body;

  const headline = opinionHeadline(ed.headline);

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

  return {
    ok: true,
    draftId,
    headline,
    words: ed.body.split(/\s+/).filter(Boolean).length,
    hadAppendix: Boolean(ed.appendix),
  };
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
  await sql.query(`alter table editorial_requests add column if not exists model_choice text not null default 'auto'`);
}

export async function performEditorialWork(job: {
  id: number;
  user_id: string;
  newsroom_id: number;
  subject_id: number;
}) {
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
  }>`
    select id, subject, source_kind, source_ref, asked_for, pointers_json, our_story_json, model_choice
    from editorial_requests
    where id = ${job.subject_id} and newsroom_id = ${job.newsroom_id} limit 1
  `;
  const req = rows[0];
  if (!req) throw new Error("Editorial request not found");

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

  const result = await writeEditorial({
    userId: job.user_id,
    newsroomId: job.newsroom_id,
    subject: req.subject,
    pointers,
    ourStory,
    askedFor: req.asked_for,
    sourceKind: req.source_kind,
    sourceRef: req.source_ref,
    modelChoice: opinionModelChoice(req.model_choice),
  });

  if (!result.ok) {
    await sql`
      update editorial_requests set error = ${result.error.slice(0, 800)}, finished_at = now()
      where id = ${req.id}
    `;
    throw new Error(result.error);
  }

  await sql`
    update editorial_requests set draft_id = ${result.draftId}, error = null, finished_at = now()
    where id = ${req.id}
  `;
}
