export const DOCUMENT_FILE_LIMIT = 100 * 1024 * 1024;
export const DOCUMENT_TEXT_LIMIT = 20_000_000;
export const DOCUMENT_COUNT_LIMIT = 20;
/** What LibreOffice reads for the desk: spreadsheets, slides and Writer files. */
export type LibreOfficeKind = "sheet" | "slides" | "writer";
const LIBREOFFICE_EXTENSIONS: Record<string, LibreOfficeKind> = {
  xlsx: "sheet",
  xls: "sheet",
  ods: "sheet",
  pptx: "slides",
  ppt: "slides",
  odp: "slides",
  odt: "writer",
};
const LIBREOFFICE_MIME: Record<string, LibreOfficeKind> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.oasis.opendocument.spreadsheet": "sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides",
  "application/vnd.ms-powerpoint": "slides",
  "application/vnd.oasis.opendocument.presentation": "slides",
  "application/vnd.oasis.opendocument.text": "writer",
};
/** The LibreOffice kind for a file name or URL path, or null. */
export function libreOfficeKindForName(name: string): LibreOfficeKind | null {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? (LIBREOFFICE_EXTENSIONS[ext] ?? null) : null;
}
/** The LibreOffice kind for a content type, or null. */
export function libreOfficeKindForMime(mime: string): LibreOfficeKind | null {
  return LIBREOFFICE_MIME[mime.split(";", 1)[0]!.trim().toLowerCase()] ?? null;
}
export function documentKind(
  name: string,
): "pdf" | "image" | "text" | "word" | "sheet" | "slides" | "writer" {
  if (/\.pdf$/i.test(name)) return "pdf";
  const office = libreOfficeKindForName(name);
  if (office) return office;
  if (/\.(png|jpe?g|webp)$/i.test(name)) return "image";
  if (/\.docx?$/i.test(name)) return "word";
  if (/\.(txt|md|markdown|csv|tsv|srt|vtt|json|log)$/i.test(name)) return "text";
  throw new Error(
    "Choose PDF, Word DOC/DOCX, Excel, PowerPoint, LibreOffice ODS/ODP/ODT, PNG, JPG, WebP, TXT, Markdown, CSV, SRT or VTT files.",
  );
}
/** One attached document a redraft could not finish reading (0.6.64, Unit AB). */
export type PartialStoryDocument = { filename: string; readPages: number; pages: number };
/**
 * Which attached documents were left partly read. `read_pages < pages` is the
 * whole test, and it is deliberately the same test the desk shows the editor:
 * the server writes both numbers, so the notice names the document and the
 * pages the draft actually used instead of asking for faith.
 */
export function partialStoryDocuments(
  rows: readonly {
    filename: string;
    status: string;
    pages: number | null;
    read_pages: number | null;
  }[],
): PartialStoryDocument[] {
  return rows
    .filter(
      (row) =>
        row.status === "failed" &&
        typeof row.read_pages === "number" &&
        typeof row.pages === "number" &&
        row.read_pages < row.pages,
    )
    .map((row) => ({ filename: row.filename, readPages: row.read_pages!, pages: row.pages! }));
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
