import type { OcrImpl } from "./ingest.ts";

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

/** Image-only PDFs stay unread. JPEG-as-text-chat is not OCR. Real OCR is 0.4.1. */
export const productionOcr: OcrImpl = async () => ({ text: "", pages: [] });
