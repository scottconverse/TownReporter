import assert from "node:assert/strict";
import { after, it } from "node:test";
import { getSql, getPglite, withTransaction } from "../db.ts";
import { receiveTownrecordEvidence } from "./townrecord-handoff.ts";

const actor = { userId: "townrecord-editor", newsroomId: 1, role: "editor" };
const packet = {
  schema: "townrecord-evidence-v1", instance_id: "a".repeat(32), meeting_id: 42, revision: 1,
  public_url: "https://records.example.org/?meeting=42",
  evidence: { detail: { meeting: { title: "Council sidewalk hearing", documents: [
    { citation_url: "https://city.example.org/agenda.pdf" },
  ] } }, document_text: [{ text: "The sidewalk hearing is scheduled, not an adopted decision." }] },
};
after(async () => { await (await getPglite()).close(); });
it("receives a lead, preserves editorial changes on retry, and keeps revised evidence separate", async () => {
  const sql = await getSql();
  const receive = (value: unknown) => withTransaction(tx => receiveTownrecordEvidence(tx, actor, value));
  const first = await receive(packet);
  const [row] = await sql.query<{ status: string; source_urls: string; evidence: string; notes_json: string }>(
    "select status,source_urls,evidence,notes_json from leads where id=$1", [first.leadId]);
  assert.equal(row!.status, "new");
  assert.ok(row!.source_urls.includes("agenda.pdf"));
  assert.ok(row!.evidence.includes("not an adopted decision"));
  const notes = JSON.parse(row!.notes_json);
  assert.ok(notes.townrecord.versionId && notes.townrecord.captureEventId);
  await sql.query("update leads set headline='Edited by newsroom',evidence='Editorial notes' where id=$1", [first.leadId]);
  assert.deepEqual(await receive(packet), { leadId: first.leadId, unchanged: true });
  const [edited] = await sql.query<{ headline: string; evidence: string }>("select headline,evidence from leads where id=$1", [first.leadId]);
  assert.equal(edited!.headline, "Edited by newsroom");
  assert.equal(edited!.evidence, "Editorial notes");
  await assert.rejects(receive({ ...packet, evidence: { detail: { meeting: { title: "Changed" } } } }), /different evidence/);
  const revision = await receive({ ...packet, revision: 2 });
  assert.notEqual(revision.leadId, first.leadId);
  const independent = await receive({ ...packet, instance_id: "b".repeat(32) });
  assert.notEqual(independent.leadId, first.leadId);
  await assert.rejects(withTransaction(tx => receiveTownrecordEvidence(tx, { ...actor, role: "reader" }, packet)), /editor access/);
  await assert.rejects(receive({ ...packet, public_url: "javascript:alert(1)" }));
  assert.deepEqual(await receive(packet), { leadId: first.leadId, unchanged: true });
});
