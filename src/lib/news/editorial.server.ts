import { getSql } from "@/lib/db";
import { claudeCodeChat } from "./ai-claude-code.server";
import { findVoiceFile } from "./voice.server";
import {
  EDITORIAL_TOOLS,
  buildEditorialPack,
  opinionHeadline,
  parseEditorial,
  type Editorial,
  type EditorialPointer,
} from "./editorial";

/**
 * Writing an editorial, and filing it as a draft.
 *
 * The voice does its own research — that is its whole posture — so this is a
 * long call with web tools on, not the usual text-in/text-out. Everything else
 * here is plumbing: assemble pointers, hand them over, file the five parts.
 *
 * The voice file is never read into this process. Only its path goes to the
 * CLI, which reads it directly. See `voice.server.ts` for why that matters.
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
 */
const EDITORIAL_TIMEOUT_MS = 2_700_000;

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
};

export type WriteEditorialResult =
  | { ok: true; draftId: number; headline: string; words: number; hadAppendix: boolean }
  | { ok: false; error: string };

export async function writeEditorial(input: WriteEditorialInput): Promise<WriteEditorialResult> {
  const found = await findVoiceFile();
  if (!found.ok) return { ok: false, error: found.error };

  const pack = buildEditorialPack({
    subject: input.subject,
    pointers: input.pointers,
    ourStory: input.ourStory,
    askedFor: input.askedFor,
  });

  const out = await claudeCodeChat({
    system: "",
    systemPromptFile: found.voice.path,
    user: pack,
    // Opus, deliberately. This is the one call in the newsroom where the
    // writing IS the product; it is not the place to save four dollars.
    model: process.env.TOWNREPORTER_EDITORIAL_MODEL?.trim() || "claude-opus-5",
    allowedTools: EDITORIAL_TOOLS,
    timeoutMs: EDITORIAL_TIMEOUT_MS,
  });
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
      draft_id integer,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )
  `);
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
  }>`
    select id, subject, source_kind, source_ref, asked_for, pointers_json, our_story_json
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
