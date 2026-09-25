#!/usr/bin/env node
/**
 * Build the image-only ("scanned") council-packet fixture used by the
 * document-reading tests and the redraft walk (0.6.64, Unit AB).
 *
 * `packet.pdf` and `multi-batch-packet.pdf` carry a real text layer, so they
 * exercise `getTextContent` and never reach the vision path. The defect Unit
 * AB fixes is about a SCAN: a packet with no text layer, where every page
 * costs one vision call and a 13-page packet therefore needs two 12-page
 * batches. That case had no fixture at all.
 *
 * Each page is drawn to a JPEG with @napi-rs/canvas and embedded as a
 * `/DCTDecode` image XObject -- the same encoding PDF.js decodes for a real
 * faxed or scanned packet. No text operators are written, so
 * `getTextContent()` returns nothing and the page can only be read by OCR.
 *
 *   node scripts/make-scanned-packet-fixture.mjs [pages] [out]
 *
 * Defaults: 13 pages (the live lead 215 packet's size) written to
 * src/lib/news/fixtures/story-documents/scanned-packet.pdf.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const PAGES = Number(process.argv[2] || 13);
const OUT = process.argv[3]
  ? fileURLToPath(new URL(process.argv[3], `file://${process.cwd()}/`))
  : fileURLToPath(
      new URL("../src/lib/news/fixtures/story-documents/scanned-packet.pdf", import.meta.url),
    );

/** Portrait Letter at ~96 dpi: small enough to keep the fixture under a MB. */
const PAGE_W = 612;
const PAGE_H = 792;
const IMG_W = 816;
const IMG_H = 1056;

/**
 * Every page names itself in the drawing ("SCANNED PAGE 7 OF 13") and carries
 * one marker sentence the walk can look for in the retained text, so a test
 * can tell a page that was actually read from one that was skipped.
 */
function pageImage(page, pages) {
  const canvas = createCanvas(IMG_W, IMG_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fdfdfb";
  ctx.fillRect(0, 0, IMG_W, IMG_H);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("CITY COUNCIL PACKET — SCANNED COPY", 56, 96);
  ctx.font = "20px sans-serif";
  ctx.fillText(`SCANNED PAGE ${page} OF ${pages}`, 56, 140);
  ctx.fillText(`Item ${page}: ${page === pages ? "final decision" : "supporting exhibit"}`, 56, 180);
  ctx.font = "17px sans-serif";
  const lines = [
    "This page is a scan: it carries no selectable text layer.",
    "It can only be read by a vision model looking at the image.",
    "Staff recommends approval of the consent agenda as presented.",
    "The council asked whether the setback matches the adopted plan.",
    "Public comment closed at 8:40 p.m. with three speakers heard.",
  ];
  lines.forEach((line, index) => ctx.fillText(line, 56, 236 + index * 30));
  if (page === pages)
    ctx.fillText("FINAL PAGE DECISION: approve 731250 dollars", 56, 236 + lines.length * 30 + 20);
  ctx.strokeStyle = "#c9c9c9";
  ctx.strokeRect(48, 60, IMG_W - 96, IMG_H - 120);
  return canvas.toBuffer("image/jpeg", 55);
}

const pages = [];
for (let page = 1; page <= PAGES; page += 1) pages.push(pageImage(page, PAGES));

/** PDF objects, in order; object numbers are the array index + 1. */
const objects = [];
objects.push("<< /Type /Catalog /Pages 2 0 R >>");
objects.push(
  `<< /Type /Pages /Count ${PAGES} /Kids [${pages
    .map((_, index) => `${3 + index * 3} 0 R`)
    .join(" ")}] >>`,
);
pages.forEach((jpeg, index) => {
  const pageObj = 3 + index * 3;
  const contentObj = pageObj + 1;
  const imageObj = pageObj + 2;
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`,
  );
  const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`;
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  objects.push(
    `<< /Type /XObject /Subtype /Image /Width ${IMG_W} /Height ${IMG_H} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n` +
      jpeg.toString("latin1") +
      "\nendstream",
  );
});

let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((body, index) => {
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefAt = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let index = 1; index <= objects.length; index += 1)
  pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

const bytes = Buffer.from(pdf, "latin1");
writeFileSync(OUT, bytes);
console.log(`${OUT}: ${PAGES} image-only pages, ${bytes.length.toLocaleString()} bytes`);
