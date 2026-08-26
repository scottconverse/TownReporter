import { grokChat } from "./ai.ts";
import type { OcrImpl, OcrResult, PdfPage } from "./ingest.ts";

const JPEG_SOI = [0xff, 0xd8, 0xff];

/** Pull embedded JPEG streams from a PDF so a scanned packet can be OCRed without a rasterizer. */
export function extractEmbeddedJpegs(buf: Uint8Array, max = 4): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < buf.length - 4 && out.length < max; i++) {
    if (buf[i] === JPEG_SOI[0] && buf[i + 1] === JPEG_SOI[1] && buf[i + 2] === JPEG_SOI[2]) {
      let j = i + 2;
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const slice = buf.slice(i, j + 2);
          if (slice.byteLength > 4000) out.push(slice);
          i = j + 2;
          break;
        }
        j++;
      }
    }
  }
  return out;
}

async function grokVisionOcr(buf: Uint8Array): Promise<OcrResult> {
  const jpegs = extractEmbeddedJpegs(buf);
  if (!jpegs.length) return { text: "", pages: [] };
  const pages: PdfPage[] = [];
  const texts: string[] = [];
  for (let i = 0; i < jpegs.length; i++) {
    const b64 = Buffer.from(jpegs[i]!).toString("base64");
    const res = await grokChat(
      "You transcribe scanned civic documents. Return the readable text only. No commentary.",
      `Transcribe page ${i + 1} of a public PDF. Image is JPEG base64 (first 80k chars):\n${b64.slice(0, 80000)}`,
      1800,
    );
    if (!res.ok) continue;
    const text = res.text.trim();
    if (text.length < 20) continue;
    pages.push({ page: i + 1, text, confidence: 0.7 });
    texts.push(text);
  }
  return { text: texts.join("\n\n"), pages };
}

async function tesseractOcr(buf: Uint8Array): Promise<OcrResult> {
  const jpegs = extractEmbeddedJpegs(buf);
  if (!jpegs.length) return { text: "", pages: [] };
  try {
    const spec: string = "tesseract.js";
    const { createWorker } = (await import(spec)) as {
      createWorker: (lang?: string) => Promise<{
        recognize: (img: Buffer) => Promise<{ data: { text: string; confidence: number } }>;
        terminate: () => Promise<void>;
      }>;
    };
    const worker = await createWorker("eng");
    const pages: PdfPage[] = [];
    const texts: string[] = [];
    try {
      for (let i = 0; i < jpegs.length; i++) {
        const rec = await worker.recognize(Buffer.from(jpegs[i]!));
        const text = String(rec.data.text ?? "").replace(/\s+/g, " ").trim();
        if (text.length < 20) continue;
        pages.push({ page: i + 1, text, confidence: rec.data.confidence / 100 });
        texts.push(text);
      }
    } finally {
      await worker.terminate();
    }
    return { text: texts.join("\n\n"), pages };
  } catch {
    return { text: "", pages: [] };
  }
}

/** Production OCR: Grok vision when the key is present, then tesseract.js on embedded JPEGs. */
export const productionOcr: OcrImpl = async (buf) => {
  const viaGrok = await grokVisionOcr(buf);
  if (viaGrok.text.trim().length >= 40) return viaGrok;
  return tesseractOcr(buf);
};
