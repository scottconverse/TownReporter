export type NameCheckRow = {
  name: string;
  role: string;
  status: "matched" | "corrected" | "unresolved";
  spelling: string;
  reason: string;
  url: string;
  excerpt: string;
  captureId: number | null;
  evidenceKind?: "public-capture" | "uploaded-document";
  documentId?: string;
  filename?: string;
  locator?: string;
};
export type NameCheck = {
  version: 1;
  checkedAt: string;
  checkedText: string;
  complete: boolean;
  note: string;
  rows: NameCheckRow[];
};
export const nameCheckText = (draft: { headline: string; dek: string; body: string }) =>
  [draft.headline, draft.dek, draft.body].join("\n\n");
export function readNameCheck(raw: string | null | undefined): NameCheck | null {
  try {
    const check = JSON.parse(raw ?? "{}").nameCheck;
    if (check?.version !== 1 || !Array.isArray(check.rows) || typeof check.checkedText !== "string") return null;
    return check;
  } catch { return null; }
}
export function nameCheckNotes(check: NameCheck): string {
  return ["NAME CHECK: " + check.note, ...check.rows.map(row =>
    row.status === "unresolved" ? `Name needs review: ${row.name} (${row.role || "person"}). ${row.reason}` :
      `Name ${row.status}: ${row.name}${row.name !== row.spelling ? ` → ${row.spelling}` : ""}. ${row.evidenceKind === "uploaded-document" ? `${row.filename}, ${row.locator}` : row.url} — ${row.excerpt}`,
  )].join("\n");
}
