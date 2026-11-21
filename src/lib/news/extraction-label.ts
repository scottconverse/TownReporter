/*
  The editor-facing sentence for a stored `extraction_method` value.

  Pure string parsing only -- no fetch, DB, or Node-only imports -- so this
  module is safe to import from both server code (ingest.ts, investigate.ts)
  and browser route components (desk.dark.tsx, desk.story.$leadId.tsx) alike,
  unlike ingest.ts itself which pulls in the SSRF-guarded fetch stack.
*/

/** The editor-facing sentence for a stored `extraction_method` value. */
export function describeExtractionMethod(method: string | undefined | null): string {
  const raw = (method ?? "").trim();
  const pageOcr = /^ocr-pages(-partial)?:([^:]*):(\d+)\/(\d+)$/.exec(raw);
  if (pageOcr) {
    const [, partial, provider, read, total] = pageOcr;
    return `Read by OCR · ${provider} · ${read} of ${total} PDF pages${partial ? " · incomplete" : ""}`;
  }
  const ocr = /^ocr:([^:]*):(\d+)\/(\d+)$/.exec(raw);
  if (ocr) {
    const [, provider, read, total] = ocr;
    return `Read by OCR · ${provider} · ${read} of ${total} extracted images · PDF page order not established`;
  }
  const office = /^libreoffice:(sheets|slides|pages):(\d+)$/.exec(raw);
  if (office) {
    const count = Number(office[2]);
    const word = count === 1 ? office[1]!.slice(0, -1) : office[1];
    return `Read by LibreOffice: ${count} ${word}`;
  }
  if (raw === "libreoffice-missing") return "Install LibreOffice to read Excel and PowerPoint files";
  if (raw === "libreoffice-failed") return "LibreOffice could not read this file";
  const needsOcr = /^needs-ocr:([\s\S]*)$/.exec(raw);
  if (needsOcr) {
    const reason = needsOcr[1]!.trim();
    return `Scanned PDF — not readable yet${reason ? `: ${reason}` : ""}`;
  }
  const firecrawl = /^firecrawl-local:(.+)$/.exec(raw);
  if (firecrawl) return `Read by Firecrawl Local ${firecrawl[1]!.trim()} on this computer`;
  if (!raw || raw === "none") return "Not read yet.";
  return raw;
}

/**
 * The page-watch history line's text for a stored `extraction_method`.
 *
 * A Firecrawl Local capture stores a machine value (`firecrawl-local:0.1.1`);
 * the history row used to print it raw. It gets the same sentence the rest of
 * the desk shows for that method. Every OTHER method keeps the exact words the
 * row already printed -- the raw stored value, or "not recorded" -- so this
 * changes no editor's reading of a readability or PDF capture.
 */
export function describeWatchHistoryExtraction(method: string | undefined | null): string {
  const raw = (method ?? "").trim();
  if (raw.startsWith("firecrawl-local:")) return describeExtractionMethod(raw);
  return raw || "not recorded";
}
