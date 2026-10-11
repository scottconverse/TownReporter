/*
  The public page has three honest outcomes: a story with AI work gets a line
  derived from saved authoring receipts, a manual-only story carries no AI
  claim, and a routine notice names its fixed-template path. AI_DISCLOSURE is
  the example line for a story where both the research and draft model ran.
*/
export const AI_DISCLOSURE =
  "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";

export const ROUTINE_NOTICE_DISCLOSURE =
  "A fixed template assembled this routine notice from owner-approved public sources. No AI wrote it and no reporter rewrote it. The sources are listed under Sources.";

export function AiDisclosure({ routine = false, text = "" }: { routine?: boolean; text?: string }) {
  /*
    An imported story gets its own line. The editor chose the wording on the
    import screen (src/routes/desk.import.tsx) and it is stored on the article,
    because a line cannot be inferred honestly from the article alone. Reported
    stories receive a line derived from their authoring receipts; an empty line
    means there is no supported AI claim. Routine notices have a separate true
    description because their fixed template has no model-authored draft.
  */
  const line = text.trim() || (routine ? ROUTINE_NOTICE_DISCLOSURE : "");
  if (!line) return null;
  return <p className="ai-disclosure">{line}</p>;
}
