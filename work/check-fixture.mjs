import { getDocumentProxy } from "unpdf";
import { readFileSync } from "node:fs";
const bytes = new Uint8Array(await import("node:fs").then(fs => fs.readFileSync("src/lib/news/fixtures/story-documents/multi-batch-packet.pdf")));
const pdf = await getDocumentProxy(bytes);
console.log("numPages:", pdf.numPages);
const p = await pdf.getPage(37);
const c = await p.getTextContent();
console.log("page 37 text:", c.items.map(i => i.str).join(""));
