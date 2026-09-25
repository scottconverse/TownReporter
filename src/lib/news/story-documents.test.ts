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

it("reads a 15-page packet to the end in one redraft instead of stopping at the 12-page batch", async () => {
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

  /*
    One press. 0.6.64 (Unit AB): this fixture is two extraction calls -- the
    12-page batch, then the last 3 pages -- and both happen inside this one
    readStoryDocuments call, whose result is evidence rather than a throw.
    The old behaviour (assert.rejects /Read 12 of 15 pages... Retry to
    continue/) is gone on the owner's decision: an editor pressing Redraft once
    must get a draft, and a red "Retry to continue" with no draft reads as a
    crash.
  */
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

  const pageStages = (messages: string[]) =>
    messages
      .map((message) => /page (\d+) of 15/.exec(message)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number);
  assert.deepEqual(pageStages(stages), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  // Progress names the second batch without pretending the job ended.
  assert.deepEqual(
    stages
      .filter((message) => /continuing with the rest of this document/.test(message))
      .map((message) => /(\d+) of 15 pages read/.exec(message)?.[1]),
    ["12"],
  );
  assert.equal(stages.filter((message) => /Retry to continue/.test(message)).length, 0);

  const [after] = await sql.query<{
    status: string;
    full_text: string | null;
    pages: number | null;
    read_pages: number | null;
    detail: string;
  }>(
    "select status,full_text,pages,read_pages,detail from story_documents where newsroom_id=$1 and lead_id=$2",
    [room, lead.id],
  );
  assert.equal(after.status, "read");
  assert.equal(after.pages, 15);
  // A fully read document is not partial, so the desk offers no notice for it.
  assert.equal(after.read_pages, null);
  assert.match(after.full_text ?? "", /\[packet\.pdf, page 1, native text extraction\]/);
  assert.match(after.full_text ?? "", /FINAL PAGE DECISION: approve 731250 dollars/);
  assert.match(after.detail, /Read all .* across 15 pages/);
  assert.match(evidence, /fake document evidence/);
});

it("reads a 37-page packet to the end in one redraft, one 12-page batch per extraction call", async () => {
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

  /*
    This replaces "bounds one failed-extraction retry to a single 12-page
    batch", which pinned the OLD flow: three separate presses, each throwing
    "Retry to continue" after one more batch. The batch size is still a real
    protection (a vision request handles a small group of consecutive pages)
    and is still pinned below -- 12, 24, 36 -- but it no longer stops the job.
  */
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

  assert.deepEqual(
    stages
      .map((message) => /page (\d+) of 37/.exec(message)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number),
    Array.from({ length: 37 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    stages
      .filter((message) => /continuing with the rest of this document/.test(message))
      .map((message) => /(\d+) of 37 pages read/.exec(message)?.[1]),
    ["12", "24", "36"],
  );
  assert.equal(stages.filter((message) => /Retry to continue/.test(message)).length, 0);

  const [after] = await sql.query<{
    status: string;
    full_text: string | null;
    pages: number | null;
    read_pages: number | null;
    detail: string;
  }>(
    "select status,full_text,pages,read_pages,detail from story_documents where newsroom_id=$1 and lead_id=$2",
    [room, lead.id],
  );
  assert.equal(after.status, "read");
  assert.equal(after.pages, 37);
  assert.equal(after.read_pages, null);
  assert.match(after.full_text ?? "", /FINAL PAGE DECISION: approve 731250 dollars/);
  assert.match(after.detail, /Read all .* across 37 pages/);
  assert.doesNotMatch(after.detail, /Retry to continue/);
  assert.match(evidence, /fake document evidence/);
});

/**
 * The vision reader the scanned-fixture tests inject: one page per call, in
 * page order (the PDF path reads pages sequentially), answering like the fake
 * endpoint the browser walk uses. `control.failFrom` makes the reader vanish
 * from that page on -- and clearing it lets the reader answer again -- which
 * is how a test drives a PARTIAL read and then its "Read the rest" resume.
 */
function scannedPageReader(pages: number, control: { failFrom?: number } = {}) {
  let read = 0;
  return async () => {
    if (control.failFrom !== undefined && read + 1 >= control.failFrom)
      throw new Error("The vision reader vanished partway through this scan.");
    read += 1;
    return (
      `CITY COUNCIL PACKET - SCANNED COPY\nSCANNED PAGE ${read} OF ${pages}\n` +
      `Item ${read}: supporting exhibit\n` +
      "Staff recommends approval of the consent agenda as presented." +
      (read === pages ? "\nFINAL PAGE DECISION: approve 731250 dollars" : "")
    );
  };
}

/** An interpreter that names the document it was handed and the scanned page
 * labels inside it, so evidence proves WHICH pages reached the writer. */
const labelledChat = async (_system: string, user: string) => ({
  ok: true as const,
  text:
    `READ ${/^DOCUMENT: (.+)$/m.exec(user)?.[1] ?? "unknown"} ` +
    `[${[...user.matchAll(/SCANNED PAGE (\d+) OF \d+/g)].map((match) => match[1]).join(" ") || "no page labels"}]`,
});

async function attachDocuments(
  sql: Awaited<ReturnType<typeof getSql>>,
  room: number,
  user: string,
  lead: number,
  docs: { name: string; mime: string; bytes: Uint8Array; minutesAgo: number }[],
) {
  for (const doc of docs)
    await sql.query(
      `insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original,created_at)
       values($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' minutes')::interval)`,
      [`${doc.name}-${Date.now()}`, room, user, lead, doc.name, doc.mime, doc.bytes, doc.minutesAgo],
    );
}

it("reads a 13-page scanned PDF and both later documents in one redraft", async () => {
  const { getSql } = await import("../db.ts");
  const { ensureStoryDocuments, readStoryDocuments } = await import("./story-documents.server.ts");
  const sql = await getSql();
  await ensureStoryDocuments(sql);
  const room = 88409;
  const user = "document-scan-packet-editor";
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Scanned packet lead','Uploaded packet','council','new','[]','',1,'{}') returning id",
    [user, room],
  );
  /*
    The owner's case, in order: a 13-page SCANNED packet (image-only pages, so
    every page goes through the vision reader), then two ordinary documents
    behind it. Before 0.6.64 this read 12 pages and threw, and both later
    documents were never read at all.
  */
  await attachDocuments(sql, room, user, lead.id, [
    {
      name: "scanned-packet.pdf",
      mime: "application/pdf",
      bytes: readFileSync(new URL("./fixtures/story-documents/scanned-packet.pdf", import.meta.url)),
      minutesAgo: 2,
    },
    {
      name: "agenda-notes.md",
      mime: "text/markdown",
      bytes: Buffer.from("AGENDA NOTES: item 4 is a 731,250 dollar pavement contract."),
      minutesAgo: 1,
    },
    {
      name: "public-comment.md",
      mime: "text/markdown",
      bytes: Buffer.from("PUBLIC COMMENT: three residents asked for the Main Street crosswalk."),
      minutesAgo: 0,
    },
  ]);

  const routing = {
    modelEffort: "none" as const,
    source: "auto" as const,
    probe: async () => ({ ok: true as const, label: "Fake", choice: "codex-balanced" as const }),
    chat: labelledChat,
    ocrAdapters: { codex: scannedPageReader(13) },
  };
  const stages: string[] = [];
  const onStage = async (message: string) => {
    stages.push(message);
  };

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

  // Every page was read in this one press, 1 through 13.
  assert.deepEqual(
    stages
      .map((message) => /page (\d+) of 13/.exec(message)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number),
    Array.from({ length: 13 }, (_, index) => index + 1),
  );
  assert.equal(stages.filter((message) => /continuing with the rest of this document/.test(message)).length, 1);

  const rows = await sql.query<{
    filename: string;
    status: string;
    pages: number | null;
    read_pages: number | null;
    full_text: string | null;
  }>(
    "select filename,status,pages,read_pages,full_text from story_documents where newsroom_id=$1 and lead_id=$2 order by created_at,id",
    [room, lead.id],
  );
  assert.deepEqual(
    rows.map((row) => [row.filename, row.status, row.pages, row.read_pages]),
    [
      ["scanned-packet.pdf", "read", 13, null],
      ["agenda-notes.md", "read", null, null],
      ["public-comment.md", "read", null, null],
    ],
  );
  assert.match(rows[0]!.full_text ?? "", /SCANNED PAGE 13 OF 13/);
  assert.match(rows[0]!.full_text ?? "", /FINAL PAGE DECISION: approve 731250 dollars/);
  // The redraft's evidence covers the scanned packet AND both later documents,
  // and the scanned notes came from the text of pages 1-13.
  assert.match(evidence, /READ scanned-packet\.pdf \[1 2 3 4 5 6 7 8 9 10 11 12 13\]/);
  assert.match(evidence, /READ agenda-notes\.md/);
  assert.match(evidence, /READ public-comment\.md/);
});

it("redrafts from a partly read scan, still reads the later document, and resumes from the retained pages", async () => {
  const { getSql } = await import("../db.ts");
  const { ensureStoryDocuments, readStoryDocuments } = await import("./story-documents.server.ts");
  const sql = await getSql();
  await ensureStoryDocuments(sql);
  const room = 88410;
  const user = "document-partial-read-editor";
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Partial scan lead','Uploaded packet','council','new','[]','',1,'{}') returning id",
    [user, room],
  );
  await attachDocuments(sql, room, user, lead.id, [
    {
      name: "scanned-packet.pdf",
      mime: "application/pdf",
      bytes: readFileSync(new URL("./fixtures/story-documents/scanned-packet.pdf", import.meta.url)),
      minutesAgo: 1,
    },
    {
      name: "agenda-notes.md",
      mime: "text/markdown",
      bytes: Buffer.from("AGENDA NOTES: item 4 is a 731,250 dollar pavement contract."),
      minutesAgo: 0,
    },
  ]);

  // The reader answers pages 1-7, then vanishes: the document cannot be
  // finished inside this job, which is exactly the case the old code aborted.
  const reader: { failFrom?: number } = { failFrom: 8 };
  const routing = {
    modelEffort: "none" as const,
    source: "auto" as const,
    probe: async () => ({ ok: true as const, label: "Fake", choice: "codex-balanced" as const }),
    chat: labelledChat,
    ocrAdapters: { codex: scannedPageReader(13, reader) },
  };
  const stages: string[] = [];
  const onStage = async (message: string) => {
    stages.push(message);
  };

  // One press: no throw, a draft from the 7 pages read plus the later document.
  const first = await readStoryDocuments(
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
  /*
    Progress reaches "page 8 of 13" because the desk announces the page before
    it asks the reader for it; page 8 is where the reader vanished, so 8 was
    attempted and 7 were retained. Both numbers are shown to the editor.
  */
  assert.deepEqual(
    stages
      .map((message) => /page (\d+) of 13/.exec(message)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.match(first, /PARTIAL DOCUMENT: scanned-packet\.pdf — only 7 of 13 pages have been read/);
  assert.match(first, /READ scanned-packet\.pdf \[1 2 3 4 5 6 7\]/);
  assert.match(first, /READ agenda-notes\.md/);

  const partial = await sql.query<{
    filename: string;
    status: string;
    pages: number | null;
    read_pages: number | null;
    detail: string;
  }>(
    "select filename,status,pages,read_pages,detail from story_documents where newsroom_id=$1 and lead_id=$2 order by created_at,id",
    [room, lead.id],
  );
  assert.deepEqual(
    partial.map((row) => [row.filename, row.status, row.pages, row.read_pages]),
    [
      ["scanned-packet.pdf", "failed", 13, 7],
      ["agenda-notes.md", "read", null, null],
    ],
  );
  assert.match(partial[0]!.detail, /Read 7 of 13 pages; completed pages retained\./);
  assert.doesNotMatch(partial[0]!.detail, /Retry to continue/);

  // "Read the rest": the same press again, and it resumes at page 8.
  reader.failFrom = undefined;
  stages.length = 0;
  const second = await readStoryDocuments(
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
  assert.deepEqual(
    stages
      .map((message) => /page (\d+) of 13/.exec(message)?.[1])
      .filter((page): page is string => Boolean(page))
      .map(Number),
    [8, 9, 10, 11, 12, 13],
  );
  assert.match(second, /READ scanned-packet\.pdf \[1 2 3 4 5 6 7 8 9 10 11 12 13\]/);
  const complete = await sql.query<{
    status: string;
    pages: number | null;
    read_pages: number | null;
    full_text: string | null;
  }>(
    "select status,pages,read_pages,full_text from story_documents where newsroom_id=$1 and lead_id=$2 and filename='scanned-packet.pdf'",
    [room, lead.id],
  );
  assert.equal(complete[0]!.status, "read");
  assert.equal(complete[0]!.pages, 13);
  assert.equal(complete[0]!.read_pages, null);
  assert.match(complete[0]!.full_text ?? "", /SCANNED PAGE 13 OF 13/);
});
