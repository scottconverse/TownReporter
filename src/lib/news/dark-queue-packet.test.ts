// guards: the queue could lose the headline and evidence the editor approved or accept unchecked client text
import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { openInvestigationForEditor, queuePacketFor, queueInvestigationFor } from "./dark.ts";
it("queues the previewed packet and rejects a changed preview", async () => {
  const sql = await getSql();
  const user = "packet-queue"; const room = 98334;
  const file = await openInvestigationForEditor(user, { title: "Original question", paste: "Council records" }, room);
  await sql`insert into investigation_briefs(investigation_id, newsroom_id, brief_json)
    values (${file.investigationId}, ${room}, ${JSON.stringify({ headline: "Revised meeting date" })})`;
  await sql`insert into claims(user_id, newsroom_id, investigation_id, body, kind, evidence, source_url)
    values (${user}, ${room}, ${file.investigationId}, 'The meeting moved to Thursday.', 'FACT', 'Notice', 'https://records.example/notice')`;
  const packet = await queuePacketFor(room, file.investigationId);
  assert.ok(packet);
  const forged = await queueInvestigationFor(user, room, file.investigationId, { preview: { ...packet, suggestedHeadline: "Unchecked accusation" } });
  assert.equal(forged.ok, false);
  const result = await queueInvestigationFor(user, room, file.investigationId, { preview: packet });
  assert.ok(result.ok);
  const [lead] = await sql<{ headline: string; evidence: string; notes_json: string }>`select headline, evidence, notes_json from leads where id = ${result.leadId}`;
  assert.equal(lead.headline, packet.suggestedHeadline);
  assert.ok(lead.evidence.includes(packet.evidence[0].text));
  assert.deepEqual(JSON.parse(lead.notes_json).darkPacket, packet);
});
