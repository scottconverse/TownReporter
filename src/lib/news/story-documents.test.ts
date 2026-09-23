import { before, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { documentChunks, documentKind, validateDocumentText } from "./story-document-text.ts";
import { extractStoryDocument } from "./story-documents.server.ts";
import { readFileSync } from "node:fs";

before(async () => {
  const sql = await getSql();
  await sql.query(`create table if not exists leads(
  id serial primary key,
  user_id text not null default '',
  newsroom_id integer,
  headline text not null default '',
  why text not null default '',
  topic text not null default 'council',
  status text not null default 'new',
  source_urls text not null default '[]',
  evidence text not null default '',
  newsworthiness integer,
  notes_json text not null default '{}'
)`);
});

it("reads a 15-page PDF through its final page, beyond the old 12-page OCR limit", async () => {
  const bytes = readFileSync(
    new URL("./fixtures/story-documents/packet.pdf", import.meta.url),
  );
  const result = await extractStoryDocument(
    {
      id: "test",
      filename: "packet.pdf",
      mime: "application/pdf",
      original: bytes,
      full_text: null,
      pages: null,
    },
    "codex-frontier",
    1,
    async () => {},
  );
  assert.equal(result.pages, 15);
  assert.match(result.text ?? "", /FINAL PAGE DECISION: approve 731250 dollars/);
});
it("preserves every character in a long transcript and every reading chunk", async () => {
  const original =
    "First statement.\n" +
    "Meeting discussion about operations.\n".repeat(5000) +
    "FINAL MOTION: funding is 642198 dollars.";
  const result = await extractStoryDocument(
    {
      id: "test",
      filename: "meeting.md",
      mime: "text/markdown",
      original: Buffer.from(original),
      full_text: null,
      pages: null,
    },
    "codex-frontier",
    1,
    async () => {},
  );
  assert.equal(result.text, original);
  const chunks = documentChunks(result.text);
  assert.ok(chunks.length > 5);
  assert.equal(chunks.map((c) => c.text).join(""), original);
  assert.match(chunks.at(-1)!.text, /642198/);
});
it("extracts Word body text without dropping the final paragraph", async () => {
  const bytes = readFileSync(
    new URL("./fixtures/story-documents/word-notes.docx", import.meta.url),
  );
  const result = await extractStoryDocument(
    {
      id: "test",
      filename: "word-notes.docx",
      mime: "",
      original: bytes,
      full_text: null,
      pages: null,
    },
    "codex-frontier",
    1,
    async () => {},
  );
  assert.match(result.text ?? "", /WORD DOCUMENT DECISION: library opens October 23/);
});
it("validates supported file types and fails visibly instead of truncating oversized text", () => {
  for (const ext of ["md", "txt", "pdf", "png", "jpg", "webp", "doc", "docx", "srt", "vtt", "csv"])
    assert.doesNotThrow(() => documentKind(`source.${ext}`));
  assert.throws(() => documentKind("source.exe"));
  assert.throws(() => validateDocumentText("x".repeat(20_000_001)), /exceeds/);
});

it("retains multipart bytes exactly and rejects cross-newsroom, skipped and repeated parts", async () => {
  const { getSql, getPglite } = await import("../db.ts");
  const { storeStoryDocumentPart, linkStoryDocuments } =
    await import("./story-documents.server.ts");
  const pg = await getPglite();
  await pg.exec(`create table if not exists leads(
  id serial primary key,
  user_id text not null default '',
  newsroom_id integer,
  headline text not null default '',
  why text not null default '',
  topic text not null default 'council',
  status text not null default 'new',
  source_urls text not null default '[]',
  evidence text not null default '',
  newsworthiness integer,
  notes_json text not null default '{}'
)`);
  const sql = await getSql();
  const first = Buffer.alloc(4 * 1024 * 1024, 65),
    last = Buffer.from("FINAL BYTES 642198");
  const total = first.length + last.length;
  const saved = await storeStoryDocumentPart(
    901,
    "editor",
    "large.md",
    "text/markdown",
    first,
    total,
    0,
    "",
  );
  await assert.rejects(
    () =>
      storeStoryDocumentPart(
        902,
        "editor",
        "large.md",
        "text/markdown",
        last,
        total,
        first.length,
        saved.id,
      ),
    /interrupted/,
  );
  await assert.rejects(
    () =>
      storeStoryDocumentPart(
        901,
        "other-editor",
        "large.md",
        "text/markdown",
        last,
        total,
        first.length,
        saved.id,
      ),
    /interrupted/,
  );
  await assert.rejects(
    () =>
      storeStoryDocumentPart(901, "editor", "large.md", "text/markdown", last, total, 5, saved.id),
    /interrupted/,
  );
  await assert.rejects(() => linkStoryDocuments(sql, 901, "editor", 1, [saved.id]), /unavailable/);
  await storeStoryDocumentPart(
    901,
    "editor",
    "large.md",
    "text/markdown",
    last,
    total,
    first.length,
    saved.id,
  );
  const rows = await sql.query("select original,status from story_documents where id=$1", [
    saved.id,
  ]);
  assert.deepEqual(Buffer.from((rows[0] as any).original), Buffer.concat([first, last]));
  assert.equal(rows[0].status, "uploaded");
  await assert.rejects(
    () =>
      storeStoryDocumentPart(
        901,
        "editor",
        "large.md",
        "text/markdown",
        last,
        total,
        first.length,
        saved.id,
      ),
    /interrupted/,
  );
});

it("checkpoints PDF pages and resumes a retry without rereading completed pages", async () => {
  const { getSql } = await import("../db.ts");
  const { ensureStoryDocuments, readStoryDocuments } = await import("./story-documents.server.ts");
  const sql = await getSql();
  await ensureStoryDocuments(sql);
  const room = 88407;
  const user = "document-page-checkpoint-editor";
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Page checkpoint lead','Uploaded packet','council','new','[]','',1,'{}') returning id",
    [user, room],
  );
  const bytes = readFileSync(
    new URL("./fixtures/story-documents/packet.pdf", import.meta.url),
  );
  await sql.query(
    "insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original) values($1,$2,$3,$4,'packet.pdf','application/pdf',$5)",
    [`page-checkpoint-${Date.now()}`, room, user, lead.id, bytes],
  );
  const stages: string[] = [];
  const routing = {
    modelEffort: "none" as const,
    source: "auto" as const,
    probe: async () => ({ ok: true as const, label: "Fake", choice: "codex-balanced" as const }),
    chat: async () => ({ ok: true as const, text: "fake document evidence" }),
  };
  const onStage = async (message: string) => {
    stages.push(message);
  };

  await assert.rejects(
    () => readStoryDocuments(room, lead.id, "codex-balanced", "Check packet", onStage, [], user, true, undefined, routing),
    /Read 12 of 15 pages; completed pages retained\. Retry to continue\./i,
  );

  const [afterFirst] = await sql.query<{
    status: string;
    full_text: string | null;
    pages: number | null;
    detail: string;
  }>(
    "select status,full_text,pages,detail from story_documents where newsroom_id=$1 and lead_id=$2",
    [room, lead.id],
  );
  assert.equal(afterFirst.status, "failed");
  assert.match(afterFirst.full_text ?? "", /\[packet\.pdf, page 1, native text extraction\]/);
  assert.doesNotMatch(afterFirst.full_text ?? "", /FINAL PAGE DECISION/);
  assert.equal(afterFirst.pages, 12);
  assert.match(afterFirst.detail, /Read 12 of 15 pages; completed pages retained\. Retry to continue\./i);
  const firstStages = stages.length;
  const pageStages = (messages: string[]) =>
    messages
      .map((message) => /page (\d+) of 15/.exec(message)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number);
  assert.deepEqual(pageStages(stages), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const evidence = await readStoryDocuments(
    room,
    lead.id,
    "codex-balanced",
    "Check packet",
    onStage,
    [],
    user,
    true,
    undefined,
    routing,
  );

  assert.deepEqual(pageStages(stages.slice(firstStages)), [13, 14, 15]);
  const [afterSecond] = await sql.query<{ status: string; full_text: string | null }>(
    "select status,full_text from story_documents where newsroom_id=$1 and lead_id=$2",
    [room, lead.id],
  );
  assert.equal(afterSecond.status, "read");
  assert.match(afterSecond.full_text ?? "", /FINAL PAGE DECISION: approve 731250 dollars/);
  assert.match(evidence, /fake document evidence/);
});

it("bounds one failed-extraction retry to a single 12-page batch", async () => {
  const { getSql } = await import("../db.ts");
  const { ensureStoryDocuments, readStoryDocuments } = await import("./story-documents.server.ts");
  const sql = await getSql();
  await ensureStoryDocuments(sql);
  const room = 88408;
  const user = "document-retry-budget-editor";
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Retry budget lead','Uploaded packet','council','new','[]','',1,'{}') returning id",
    [user, room],
  );
  const bytes = readFileSync(
    new URL("./fixtures/story-documents/multi-batch-packet.pdf", import.meta.url),
  );
  await sql.query(
    "insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original) values($1,$2,$3,$4,'multi-batch-packet.pdf','application/pdf',$5)",
    [`retry-budget-${Date.now()}`, room, user, lead.id, bytes],
  );
  const routing = {
    modelEffort: "none" as const,
    source: "auto" as const,
    probe: async () => ({ ok: true as const, label: "Fake", choice: "codex-balanced" as const }),
    chat: async () => ({ ok: true as const, text: "fake document evidence" }),
  };
  const stages: string[] = [];
  const onStage = async (message: string) => {
    stages.push(message);
  };

  // First request reads the first 12-page batch and stops.
  await assert.rejects(
    () => readStoryDocuments(room, lead.id, "codex-balanced", "Check packet", onStage, [], user, true, undefined, routing),
    /Read 12 of 37 pages; completed pages retained\. Retry to continue\./i,
  );

  // One retry request may consume at most ONE more 12-page batch.
  await assert.rejects(
    () => readStoryDocuments(room, lead.id, "codex-balanced", "Check packet", onStage, [], user, true, undefined, routing),
    /Read 24 of 37 pages; completed pages retained\. Retry to continue\./i,
  );

  const [afterRetry] = await sql.query<{ status: string; detail: string }>(
    "select status,detail from story_documents where newsroom_id=$1 and lead_id=$2",
    [room, lead.id],
  );
  assert.equal(afterRetry.status, "failed");
  assert.match(afterRetry.detail, /Read 24 of 37 pages; completed pages retained\. Retry to continue\./i);
  assert.match(afterRetry.detail, /Retry to continue\./i);

  // A later retry finishes the remaining pages without rereading them.
  const evidence = await readStoryDocuments(
    room,
    lead.id,
    "codex-balanced",
    "Check packet",
    onStage,
    [],
    user,
    true,
    undefined,
    routing,
  );
  assert.match(evidence, /fake document evidence/);
  const [afterFinal] = await sql.query<{ status: string; full_text: string | null }>(
    "select status,full_text from story_documents where newsroom_id=$1 and lead_id=$2",
    [room, lead.id],
  );
  assert.equal(afterFinal.status, "read");
  assert.match(afterFinal.full_text ?? "", /FINAL PAGE DECISION: approve 731250 dollars/);
});
