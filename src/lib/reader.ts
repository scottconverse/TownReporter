export type ReaderStory = {
  id: number;
  slug: string;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  published_at: string | Date | null;
};
export type ReaderSearch = {
  topic?: string;
  q?: string;
  view?: "archive" | "saved";
  sort?: "oldest";
  page?: number;
};
export function readerSearch(s: Record<string, unknown>): ReaderSearch {
  const page = Number(s.page);
  return {
    topic: typeof s.topic === "string" ? s.topic.slice(0, 100) : undefined,
    q: typeof s.q === "string" ? s.q.trim().slice(0, 80) : undefined,
    view: s.view === "archive" || s.view === "saved" ? s.view : undefined,
    sort: s.sort === "oldest" ? "oldest" : undefined,
    page: Number.isSafeInteger(page) && page > 1 ? Math.min(page, 100000) : undefined,
  };
}
export function readMinutes(body: string) {
  return Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 220));
}
export function readerStorageKey(name: string, city: string) {
  return `townreporter:reader:${encodeURIComponent(name)}:${encodeURIComponent(city)}`;
}
export type CorrectionDraft = {
  article: string;
  details: string;
  evidence: string;
  name: string;
  email: string;
};
export function correctionMailto(recipient: string, paper: string, d: CorrectionDraft) {
  const body = [
    "CORRECTION REQUEST",
    "",
    `Story: ${d.article.trim() || "Not specified"}`,
    "",
    "What needs correcting:",
    d.details.trim(),
    "",
    "Supporting source or explanation:",
    d.evidence.trim() || "Not provided",
    "",
    `From: ${d.name.trim() || "Not provided"}`,
    `Reply email: ${d.email.trim() || "Use sender email"}`,
  ].join("\r\n");
  return `mailto:${recipient}?subject=${encodeURIComponent(`Correction request — ${paper}`)}&body=${encodeURIComponent(body)}`;
}
