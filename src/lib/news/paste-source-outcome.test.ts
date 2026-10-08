// guards: pasted source links could disappear without an explanation that survives reload.
import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { newStoryInitial, newStoryRequest } from "../../components/dialogs/editor-dialog-forms.ts";
import { draftEditInput } from "./request-input.ts";
import { saveDraftForEditor } from "./draft-edit.server.ts";

it("saving a pasted story keeps its public source and explains the dropped local link after reload", async () => {
  const plan = newStoryRequest({ ...newStoryInitial(), tab: "paste", section: "council",
    pastedStory: "Council approves library hours\n\nThe council approved longer hours for the library on Tuesday.\nSource: https://records.example/minutes\nSource: http://127.0.0.1/minutes",
  }, "primary");
  const file = plan.steps.find(step => step.call === "fileLead")!;
  const save = plan.steps.find(step => step.call === "saveDraft")!;
  assert.ok("input" in file && "input" in save);
  assert.deepEqual(file.input.urls, ["https://records.example/minutes"]);
  const sql = await getSql();
  const [lead] = await sql`insert into leads(user_id,newsroom_id,headline,why,topic)
    values('paste-editor',1,'Council approves library hours','Fixture','council') returning id`;
  await sql`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,research_json)
    values('paste-editor',1,${lead.id},'Council approves library hours','','','council',${JSON.stringify(file.input.urls)},'{"importedText":true}')`;
  const edit = draftEditInput.parse({ ...save.input, leadId: Number(lead.id) });
  await saveDraftForEditor({ userId: "paste-editor", newsroomId: 1 }, edit);
  await saveDraftForEditor({ userId: "paste-editor", newsroomId: 1 }, { ...edit, sourceAttachmentNote: undefined });
  const [draft] = await sql`select source_urls,research_json from drafts where lead_id=${lead.id}`;
  assert.deepEqual(JSON.parse(String(draft.source_urls)), ["https://records.example/minutes"]);
  const note = JSON.parse(String(draft.research_json)).sourceAttachmentNote;
  assert.match(note, /1 source link.*not attached.*local address/i);
  assert.equal(plan.done.split(note).length, 2);
});
