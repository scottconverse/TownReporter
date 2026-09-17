import { modelChoiceLabel } from "./model-choice.ts";

export function editorialAttribution(row: { source_kind: string; model_choice: unknown }): string {
  return row.source_kind === "written-by-the-editor"
    ? "Written by the editor"
    : modelChoiceLabel(row.model_choice);
}

/** The reader stores a draft ID, not the ID of the request that created it. */
export function openedEditorial<T extends { id: number; draft_id: number | null }>(
  rows: readonly T[],
  draftId: number,
): T | undefined {
  return rows.find((row) => row.draft_id === draftId);
}

export function toggleEditorialReader(current: number | null, draftId: number): number | null {
  return current === draftId ? null : draftId;
}

export function editorialRemovalCopy(hasDraft: boolean, published: boolean): string {
  if (!hasDraft) return "This clears the request from the desk. No draft has been filed to keep.";
  return (
    "This removes the draft from the desk and keeps a copy for 30 days. Undo is available after deletion." +
    (published ? " The published piece stays on the paper — remove that under Published." : "")
  );
}
