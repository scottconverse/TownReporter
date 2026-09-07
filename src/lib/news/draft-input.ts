import type { ReportingNotes } from "./notes.ts";
export function draftSourceInputs(leadUrls: string[], notes: ReportingNotes, _scope: "public" | "supplied") {
  const extraUrls = notes.opened.map(o => o.url);
  return { urls: [...leadUrls, ...extraUrls], extraUrls };
}
