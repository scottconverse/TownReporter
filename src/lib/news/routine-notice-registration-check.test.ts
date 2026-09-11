import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "vite";

// A real text-layer PDF, not text substituted for the original document bytes.
function brochurePdf() {
  const text = "Fall 2026 Youth Basketball League: Grades 3-12. Registration deadline is Dec 13. bit.ly/recreationregistration";
  const stream = `BT /F1 10 Tf 20 100 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  return Buffer.from(`${pdf}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test("saves and reopens a PDF registration deadline while preserving the original PDF", async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  let db: any;
  try {
    db = await vite.ssrLoadModule("/src/lib/db.ts");
    assert.equal(db.getDbSource(), "pglite");
    const sql = await db.getSql();
    const checks = await vite.ssrLoadModule("/src/lib/news/routine-notice-checks.server.ts");
    const automation = await vite.ssrLoadModule("/src/lib/news/routine-notice-automation.ts");
    await checks.ensureRoutineNoticeCheckSchema();
    await automation.ensureRoutineNoticeAutomationSchema();
    const room = 98123, owner = "registration-copy-owner";
    const url = "https://longmontcolorado.gov/wp-content/uploads/2026/07/f26_sports.pdf";
    await sql.query("insert into newsrooms(id,name) values($1,'Registration acceptance')", [room]);
    await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')", [owner, room]);
    const [source] = await sql.query("insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,'Sports brochure','accepted') returning id", [owner, room, url]);
    await sql.query("insert into routine_notice_policies(newsroom_id,revision,paused,updated_by) values($1,1,false,$2)", [room, owner]);
    await sql.query("insert into routine_notice_approvals(newsroom_id,source_id,source_url,format_key) values($1,$2,$3,'registration-deadline')", [room, source.id, url]);
    const bytes = brochurePdf();
    const result = await checks.checkRoutineNoticeSourceForOwner({ userId: owner, newsroomId: room }, {
      requestId: randomUUID(), sourceId: source.id, sourceUrl: url, formatKey: "registration-deadline", expectedPolicyRevision: 1,
    }, { ingest: async () => ({ ok: true, status: 200, outcome: "fetched", text: "Extracted brochure", title: "Sports brochure", extras: [], contentType: "application/pdf", needsOcr: false, redirectChain: [], extractionMethod: "unpdf", pages: [], rawBytes: bytes }) });
    assert.equal(result.check.state, "parsed");
    assert.equal(result.check.candidates[0].fields.deadline.value, "2026-12-13");
    const reloaded = await checks.listRoutineNoticeChecksForOwner({ userId: owner, newsroomId: room }, { sourceId: source.id });
    assert.deepEqual(reloaded[0].candidates, result.check.candidates);
    const [blob] = await sql.query("select ab.body_b64,ab.sha256 from artifact_blobs ab join routine_notice_checks c on c.artifact_blob_id=ab.id where c.id=$1", [result.check.checkId]);
    assert.deepEqual(Buffer.from(blob.body_b64, "base64"), bytes);
    assert.equal(blob.sha256, createHash("sha256").update(bytes).digest("hex"));
  } finally {
    if (db) await db.closePoolForTests();
    await vite.close();
  }
});
