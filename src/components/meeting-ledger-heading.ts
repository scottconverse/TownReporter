/*
  The Meeting ledger panel's heading, in a `.ts` file for the reason
  meeting-ledger-stats.ts gives: a file that exports both a component and a
  plain function trips eslint's react-refresh/only-export-components.

  D234 point 5. The report-local-news skill now writes ordinary news leads as
  well as meetings, and a news draft's editor file lands in the same columns
  the panel reads -- so the panel draws for it too. What is behind it is not a
  meeting's accounting: it is the writer's own notes. The heading says which
  one the editor is reading, and nothing else on the panel changes.
*/
export function ledgerHeading(fromMeeting: boolean): string {
  return fromMeeting ? "Meeting ledger" : "Writer's notes";
}

/*
  UX-5: the sentence above the editor file names what is in it. A news draft's
  editor file carries no ledger rows, so the sentence must not promise one. A
  meeting draft keeps its words exactly.
*/
export function editorNotesSentence(fromMeeting: boolean): string {
  return fromMeeting
    ? "The writer's own file: the claim checks, the fact sheet, the ledger and the legal notes. None of this is part of the story."
    : "The writer's own file: the claim checks, the fact sheet and the legal notes. None of this is part of the story.";
}
