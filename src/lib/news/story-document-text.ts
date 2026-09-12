export const DOCUMENT_FILE_LIMIT = 100 * 1024 * 1024;
export const DOCUMENT_TEXT_LIMIT = 20_000_000;
export const DOCUMENT_COUNT_LIMIT = 20;
export function documentKind(name: string): "pdf" | "image" | "text" | "word" {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(png|jpe?g|webp)$/i.test(name)) return "image";
  if (/\.docx?$/i.test(name)) return "word";
  if (/\.(txt|md|markdown|csv|tsv|srt|vtt|json|log)$/i.test(name)) return "text";
  throw new Error(
    "Choose PDF, Word DOC/DOCX, PNG, JPG, WebP, TXT, Markdown, CSV, SRT or VTT files.",
  );
}
export function documentChunks(
  text: string,
  size = 24000,
): { start: number; end: number; text: string }[] {
  const chunks = [];
  for (let start = 0; start < text.length; start += size) {
    const end = Math.min(start + size, text.length);
    chunks.push({ start, end, text: text.slice(start, end) });
  }
  return chunks;
}
export function validateDocumentText(text: string): string {
  if (!text.trim()) throw new Error("This document contains no readable text.");
  if (text.length > DOCUMENT_TEXT_LIMIT)
    throw new Error(
      "Extracted text exceeds 20 million characters. The original is retained; split this document into volumes before drafting.",
    );
  return text;
}
