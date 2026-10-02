/*
  The first-run writing-model marker, and the one rule that retires it.

  `paper_settings.model_prompt_state` is the whole of the first-run feature's
  memory: `stored` means "the pages seed from the model the first run chose",
  `offered` means "the card is on screen", `answered` means "the owner has
  answered, or has since decided for themselves", and NULL means "this paper
  never ran the hook" -- which is what the live paper reads.

  WHY THIS IS ITS OWN MODULE. Three writers need it and they would otherwise
  have to import each other: the first-run hook and the card
  (./first-run-model-settings.ts), the Models page's assignment save
  (./model-assignments-store.ts), and the local-model picker's save
  (./provider-settings.ts). The rule itself -- `stored` -> `answered`, nothing
  else -- is pure and lives in ./first-run-model.ts beside the picker rule it
  explains; this file is only the two queries and the one write.
*/

import { getSql } from "../db.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { supersededModelPromptState, type ModelPromptState } from "./first-run-model.ts";

export async function readModelPromptState(newsroomId: number): Promise<ModelPromptState> {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const rows = await sql<{ model_prompt_state: string | null }>`
    select model_prompt_state from paper_settings where newsroom_id = ${newsroomId} limit 1
  `;
  const value = rows[0]?.model_prompt_state ?? null;
  return value === "stored" || value === "offered" || value === "answered" ? value : null;
}

export async function writeModelPromptState(
  newsroomId: number,
  state: Exclude<ModelPromptState, null>,
) {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`
    update paper_settings set model_prompt_state = ${state}, updated_at = now()
    where newsroom_id = ${newsroomId}
  `;
}

/**
 * Retire the first-run seed because the owner has changed something of their
 * own. Answers whether it moved: `false` for every marker but `stored`, which
 * is every paper except one whose first run this build did.
 *
 * Callers write the marker they MEAN after calling this (`stored` at the end
 * of a card pick, `offered` before the card is drawn), so this can never
 * undo an answer that was just given.
 */
export async function supersedeFirstRunModelDefault(newsroomId: number): Promise<boolean> {
  const state = await readModelPromptState(newsroomId);
  const next = supersededModelPromptState(state);
  if (next === state) return false;
  await writeModelPromptState(newsroomId, "answered");
  return true;
}
