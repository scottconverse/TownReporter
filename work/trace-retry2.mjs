import { getSql } from "../src/lib/db.ts";
import { ensureStoryDocuments, readStoryDocuments } from "../src/lib/news/story-documents.server.ts";
import { readFileSync } from "node:fs";

const sql = await getSql();
await sql.query(`create table if not exists leads(
  id serial primary key, user_id text not null default '', newsroom_id integer,
  headline text not null default '', why text not null default '', topic text not null default 'council',
  status text not null default 'new', source_urls text not null default '[]', evidence text not null default '',
  newsworthiness integer, notes_json text not null default '{}')`);
await ensureStoryDocuments(sql);
const room = 88409;
const user = "trace-editor";
await sql.query("delete from story_documents where newsroom_id=$1", [room]);
await sql.query("delete from leads where newsroom_id=$1", [room]);
const [lead] = await sql.query("insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Trace lead','Uploaded packet','council','new','[]','',1,'{}') returning id", [user, room]);
const bytes = readFileSync("src/lib/news/fixtures/story-documents/multi-batch-packet.pdf");
await sql.query("insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original) values($1,$2,$3,$4,'multi-batch-packet.pdf','application/pdf',$5)", [`trace-${Date.now()}`, room, user, lead.id, bytes]);
const routing = {
  modelEffort: "none", source: "auto",
  probe: async () => ({ ok: true, label: "Fake", choice: "codex-balanced" }),
  chat: async () => ({ ok: true, text: "fake document evidence" }),
};
const onStage = async () => {};
try {
  await readStoryDocuments(room, lead.id, "codex-balanced", "Check packet", onStage, [], user, true, undefined, routing);
  console.log("FIRST call unexpectedly resolved");
} catch (err) {
  console.log("FIRST REJECTED:", err.message.slice(0, 120));
}
console.log("--- retry call ---");
try {
  const evidence = await readStoryDocuments(room, lead.id, "codex-balanced", "Check packet", onStage, [], user, true, undefined, routing);
  console.log("RETRY RESOLVED, evidence:", evidence);
} catch (err) {
  console.log("RETRY REJECTED:", err.message.slice(0, 160));
}
const [row] = await sql.query("select status,detail,extraction_pages,read_parts from story_documents where newsroom_id=$1", [room]);
console.log("status:", row.status);
console.log("detail:", (row.detail ?? "").slice(0, 200));
const checkpoint = JSON.parse(row.extraction_pages || "[]");
console.log("checkpoint pages:", checkpoint.map(p => p.page).join(","));
