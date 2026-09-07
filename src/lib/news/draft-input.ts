import type { ReportingNotes } from "./notes.ts";
import { sanitizePublicUrls } from "./schema.ts";
export function suppliedUrlsFromText(text: string): string[] {
  return sanitizePublicUrls(text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).slice(0, 8);
}
export function draftSourceInputs(leadUrls: string[], notes: ReportingNotes, scope: "public" | "supplied") {
  if (scope === "supplied") return { urls: sanitizePublicUrls(notes.suppliedUrls ?? []), extraUrls: [] };
  const extraUrls = notes.opened.map(o => o.url);
  return { urls: [...leadUrls, ...extraUrls], extraUrls };
}
