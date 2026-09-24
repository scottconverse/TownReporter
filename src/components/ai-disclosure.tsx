/*
  How the story in front of you was made, said plainly on the page.

  Two shapes of published article exist in this paper and they were produced in
  different ways, so one sentence cannot honestly cover both:

    - a reported story is drafted by AI tools from records an editor supplied,
      then reviewed and edited by a person (see the desk's Draft with AI path);
    - a routine notice (Today / Weekend / Deadlines) is assembled by a fixed
      template from owner-approved public sources, with no model in the loop at
      all (routine-notice-editions.ts planRoutineEditions).

  Saying the AI sentence over a template roundup would claim a person reviewed
  and edited writing that no person and no model wrote, so the roundup gets its
  own sentence instead of silence: a reader who sees no disclosure cannot tell
  a considered omission from an oversight.
*/
export const AI_DISCLOSURE =
  "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";

export const ROUTINE_NOTICE_DISCLOSURE =
  "A fixed template assembled this routine notice from owner-approved public sources. No AI wrote it and no reporter rewrote it. The sources are listed under Sources.";

export function AiDisclosure({ routine = false }: { routine?: boolean }) {
  return (
    <p className="ai-disclosure">{routine ? ROUTINE_NOTICE_DISCLOSURE : AI_DISCLOSURE}</p>
  );
}
