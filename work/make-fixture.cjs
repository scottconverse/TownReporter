"use strict";
const fs = require("node:fs");
const path = "src/lib/news/fixtures/story-documents/multi-batch-packet.pdf";
const pages = 37;
const kids = [];
const objs = [];
let next = 3;
for (let page = 1; page <= pages; page++) {
  const pageNum = next++;
  const contentNum = next++;
  kids.push(`${pageNum} 0 R`);
  objs.push(
    `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
  );
  const label = page === 37
    ? "Packet page 37 FINAL PAGE DECISION: approve 731250 dollars."
    : `Packet page ${page}: background discussion about the community water project and public services.`;
  const stream = `BT /F1 12 Tf 40 740 Td (${label}) Tj ET`;
  objs.push(
    `${contentNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  );
}
const head = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>\nendobj\n`;
let offset = head.length;
const offsets = [];
const parts = [];
for (const obj of objs) {
  parts.push(obj);
  offsets.push(offset);
  offset += obj.length;
}
const xrefStart = offset;
const xref = `xref\n0 ${next}\n0000000000 65535 f \n` +
  offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
const trailer = `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
fs.writeFileSync(path, Buffer.from(head + parts.join("") + xref + trailer, "latin1"));
console.log("wrote", path, fs.statSync(path).size, "bytes");
