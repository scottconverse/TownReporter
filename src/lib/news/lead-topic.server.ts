import { draftEditInput } from "./request-input.ts";
import { withLeadDraftLock } from "./draft-order.server.ts";

export const leadTopicInput = draftEditInput.pick({ leadId: true, topic: true });

export async function saveLeadTopicForEditor(
  context: { userId: string; newsroomId: number },
  input: { leadId: number; topic: string },
) {
  const data = leadTopicInput.parse(input);
  return withLeadDraftLock(context, data.leadId, async (sql) => {
    const drafts = await sql<{ id: number }>`
      select id from drafts where lead_id = ${data.leadId} and newsroom_id = ${context.newsroomId} limit 1
    `;
    if (drafts.length) throw new Error("A draft arrived. Save the section with the draft.");
    await sql`
      update leads set topic = ${data.topic}, topic_unchosen = false,
        edited_at = now(), edited_by = ${context.userId}
      where id = ${data.leadId} and newsroom_id = ${context.newsroomId}
    `;
    return { ok: true as const, topic: data.topic };
  });
}
