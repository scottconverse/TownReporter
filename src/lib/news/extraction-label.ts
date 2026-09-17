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
  const needsOcr = /^needs-ocr:([\s\S]*)$/.exec(raw);
  if (needsOcr) {
    const reason = needsOcr[1]!.trim();
    return `Scanned PDF — not readable yet${reason ? `: ${reason}` : ""}`;
  }
  if (!raw || raw === "none") return "Not read yet.";
  return raw;
}
