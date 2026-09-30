import { correctionIsAutomatic, ROUTINE_EDITION_UPDATE_LABEL } from "@/lib/news/correction-origin";

/**
 * The chip that says a correction was written by a machine, not an editor.
 *
 * The only reason this is a component and not two lines copied into each page:
 * a correction prints in two places -- the public corrections feed
 * (`/corrections`) and the story it corrects (`/articles/$slug`, under
 * "Corrections & accountability") -- and the whole point of the mark is that a
 * reader learns ONE convention. Two copies of the same three lines would let
 * one page drift, and the reader would meet two different labels for the same
 * row. `correction-origin.ts` owns which rows are automatic and what the label
 * says; this owns where it sits.
 *
 * Renders nothing at all for an editor's correction, so a caller can drop it
 * into a card unconditionally.
 */
export function CorrectionOriginMark({ body }: { body: string }) {
  if (!correctionIsAutomatic(body)) return null;
  return <span className="correctionauto">{ROUTINE_EDITION_UPDATE_LABEL}</span>;
}
