import { it } from "node:test";
import assert from "node:assert/strict";
import { documentChunks, documentKind, validateDocumentText } from "./story-document-text.ts";
import { extractStoryDocument } from "./story-documents.server.ts";
import { readFileSync } from "node:fs";
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
  assert.match(result.text, /FINAL PAGE DECISION: approve 731250 dollars/);
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
  assert.match(result.text, /WORD DOCUMENT DECISION: library opens October 23/);
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
  await pg.exec("create table if not exists leads(id integer primary key)");
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
  assert.deepEqual(Buffer.from(rows[0].original), Buffer.concat([first, last]));
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
