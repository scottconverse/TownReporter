/**
 * The style audit where the desk actually writes: the server half.
 *
 * The measurement and the guard are pure (`draft-audit.ts`,
 * `draft-audit-repair.ts`) and know nothing about providers, rows or clocks.
 * This file is the small amount of I/O around them:
 *
 * 1. ONE repair call, wired like every other AI call in this desk -- the
 *    newsroom's own picker, `probeProvider` preflight, and
 *    `runPinnedCallWithFailover` over `planAutomaticFailover` -- so a lapsed
 *    login moves the call one rung instead of losing the editor's text.
 *
 * 2. The record merged into the row's `research_json` without disturbing any
 *    other key in it. Ten writers share that column (evidence review, manual
 *    claims, transcript links, the name check); this one adds a key and
 *    rewrites nothing else.
 *
 * 3. The reply, read as a draft rather than as prose. A model that answers
 *    "Here is the corrected draft:" and then the draft would otherwise have
 *    that line saved as the story's first paragraph.
 */

import { getSql } from "../db.ts";
import { grokChat, probeProvider } from "./ai.ts";
import type { ReportChat } from "./report.ts";
import { runPinnedCallWithFailover } from "./desk-model-run.ts";
import { modelChoiceLabel, storyModelChoice, type StoryModelChoice } from "./model-choice.ts";
import { modelEffort, type ModelEffort } from "./provider-registry.ts";
import { buildDraftRepairPrompt, repairDraftStyle, type DraftRepairCall } from "./draft-audit-repair.ts";
import { styleRecordFromRepair, type DraftStyleRecord } from "./draft-audit-record.ts";
import { saveDraftForEditor, type DraftEditInput } from "./draft-edit.server.ts";

/**
 * How long the desk waits for a rewrite. Longer than a name check, shorter
 * than a draft: the model is editing words that already exist, and the editor
 * is sitting in front of the button.
 */
export const DRAFT_STYLE_TIMEOUT_MS = 120_000;

/**
 * Room for the whole draft back. A rewrite is never longer than the draft it
 * corrects, and the guard refuses one that loses most of it, so this is a
 * ceiling rather than a target.
 */
const REPAIR_MAX_TOKENS = 8000;

/**
 * The chat the repair loop calls, in the form `reportDeps.chat` already has.
 *
 * It IS `ReportChat`, named rather than copied: when the desk repairs the
 * draft it has just written, the repair rides the same chat the draft came
 * through -- which already carries the picker, the preflight and the fail-over.
 * A second copy of that signature here would be a second thing to keep in step.
 */
export type DraftStyleChat = ReportChat;

/* ------------------------------------------------------------------ *
 * The reply, read as a draft.
 * ------------------------------------------------------------------ */

/**
 * The corrected draft out of a model's reply.
 *
 * Three shapes arrive in practice: the draft alone, the draft in a fenced
 * block, and a one-line preamble ending in a colon followed by the draft. The
 * first two are mechanical. The third is handled narrowly on purpose -- a
 * first line that ends in a colon AND is followed by a blank line is a label,
 * not a sentence in the story, and leaving it in would put "Here is the
 * corrected draft:" on the page as the opening paragraph.
 */
export function draftFromReply(text: string): string {
  const raw = String(text ?? "");
  const fenced = raw.match(/```[a-z]*\s*\n?([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const lines = candidate.split("\n");
  const head = lines[0] ?? "";
  if (lines.length > 1 && /:\s*$/.test(head) && !(lines[1] ?? "").trim()) {
    return lines.slice(1).join("\n").trim();
  }
  return candidate;
}

/**
 * The repair call the loop in `draft-audit-repair.ts` drives, backed by a chat
 * that has already been through the picker and the fail-over. Nothing here
 * decides when to call: the loop asks for a rewrite only when the audit found
 * something to fix, and at most twice.
 */
export function styleRepairCall(input: { chat: DraftStyleChat }): DraftRepairCall {
  return async (request) => {
    const { system, user } = buildDraftRepairPrompt(request);
    const answer = await input.chat(system, user, REPAIR_MAX_TOKENS, undefined, {
      timeoutMs: DRAFT_STYLE_TIMEOUT_MS,
    });
    if (!answer.ok) {
      return { ok: false, error: answer.error || "The writing provider did not answer." };
    }
    return { ok: true, body: draftFromReply(answer.text) };
  };
}

/* ------------------------------------------------------------------ *
 * The editor's button: one round, on demand.
 * ------------------------------------------------------------------ */

export type DraftStyleFixInput = {
  leadId: number;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  modelChoice?: unknown;
  modelEffort?: unknown;
};

export type DraftStyleFixResult = {
  ok: true;
  /** The text that was saved: the rewrite when it was used, otherwise
   *  exactly what the editor had. */
  body: string;
  status: DraftStyleRecord["status"];
  /** One plain sentence for the editor. */
  note: string;
  record: DraftStyleRecord;
};

/**
 * "Fix these with the model", on the text the editor is looking at.
 *
 * ONE round, because the editor asked for one and is waiting. The result is
 * saved as a draft revision (never published) so the row and the record agree
 * with what the page shows; a rewrite the guard refuses is not written, and
 * the refusal is recorded with the draft so the editor can read why.
 *
 * `chat` and `probe` are injectable so a test can drive this without a real
 * provider; everything else about the path is the real one. The seam is
 * `typeof grokChat`, the same one the desk's other one-off calls take
 * (`import-stories.server.ts`): this path has no draft-writing chat to borrow,
 * so it brings its own picker and fail-over, and that call shape is the one
 * they are written for.
 */
export async function fixDraftStyleForEditor(
  context: { userId: string; newsroomId: number },
  data: DraftStyleFixInput,
  deps: { chat?: typeof grokChat; probe?: typeof probeProvider } = {},
): Promise<DraftStyleFixResult> {
  const sql = await getSql();
  const [row] = await sql<{ form: string | null; research_json: string | null }>`
    select form, research_json from drafts
    where lead_id = ${data.leadId} and newsroom_id = ${context.newsroomId}
    order by updated_at desc, id desc limit 1
  `;
  if (!row) throw new Error("There is no saved draft to check.");

  const chat = deps.chat ?? grokChat;
  const probe = deps.probe ?? probeProvider;
  const choice = storyModelChoice(data.modelChoice);
  const effort: ModelEffort | null =
    choice === "auto" ? null : modelEffort(choice, data.modelEffort);
  let switchedTo = "";
  const call = styleRepairCall({
    chat: async (system, user, maxTokens) => {
      const attempt = await runPinnedCallWithFailover<
        { modelChoice: StoryModelChoice; modelEffort: ModelEffort | null },
        Awaited<ReturnType<typeof grokChat>>
      >({
        snapshot: { modelChoice: choice, modelEffort: effort },
        source: choice === "auto" ? "auto" : "editor",
        probe: (next) => probe(next, context.newsroomId, undefined, "story"),
        run: (snapshot) =>
          chat(system, user, maxTokens, {
            choice: snapshot.modelChoice,
            newsroomId: context.newsroomId,
            timeoutMs: DRAFT_STYLE_TIMEOUT_MS,
            noTools: true,
            reasoningEffort: snapshot.modelEffort,
          }),
        resolve: async (next) => ({ modelChoice: next, modelEffort: modelEffort(next, effort) }),
        onSwitch: async ({ nextChoice }) => {
          switchedTo = modelChoiceLabel(nextChoice);
        },
      });
      return attempt.result;
    },
  });

  const outcome = await repairDraftStyle({
    headline: data.headline,
    dek: data.dek,
    body: data.body,
    form: String(row.form ?? ""),
    repair: call,
    maxRounds: 1,
  });

  const record = styleRecordFromRepair(outcome, {
    checkedAt: new Date().toISOString(),
    requested: true,
  });
  if (switchedTo) {
    record.note = `${record.note} The call moved to ${switchedTo} after the first provider did not answer.`;
  }
  /*
    The save is the ordinary editor save with the record already decided: the
    body is the rewrite when the guard accepted it and the editor's own text
    when it did not, so a refusal cannot touch the story.
  */
  const edit: DraftEditInput = {
    leadId: data.leadId,
    headline: data.headline,
    dek: data.dek,
    body: outcome.body,
    topic: data.topic,
  };
  await saveDraftForEditor(context, edit, record);

  return { ok: true, body: outcome.body, status: outcome.status, note: record.note, record };
}
