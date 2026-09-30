import { type StoryArea, cleanStoryArea } from "./story-area.ts";

export type ReaderTextSize = 21 | 25;

/** Keep old saved sizes readable while the reader exposes only Normal and Large. */
export function normalizeReaderSize(value: unknown): ReaderTextSize {
  return value === 25 ? 25 : 21;
}

export type ReaderStory = {
  id: number;
  slug: string;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  published_at: string | Date | null;
  /**
   * Which ground this story stands on, already read through `readStoryArea`:
   * one of the four keys, never null. A story with no stored area reads as the
   * home town by the owner's rule (2026-09-26).
   */
  area?: StoryArea;
};
export type ReaderSearch = {
  topic?: string;
  q?: string;
  view?: "archive" | "saved";
  sort?: "oldest";
  page?: number;
  /** The geography pill the reader pressed, if any. */
  area?: StoryArea;
};
export function readerSearch(s: Record<string, unknown>): ReaderSearch {
  const page = Number(s.page);
  const area = cleanStoryArea(s.area);
  return {
    topic: typeof s.topic === "string" ? s.topic.slice(0, 100) : undefined,
    q: typeof s.q === "string" ? s.q.trim().slice(0, 80) : undefined,
    view: s.view === "archive" || s.view === "saved" ? s.view : undefined,
    sort: s.sort === "oldest" ? "oldest" : undefined,
    page: Number.isSafeInteger(page) && page > 1 ? Math.min(page, 100000) : undefined,
    ...(area ? { area } : {}),
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
/**
 * The address a correction goes to: the PAPER's configured editor contact, and
 * nothing else (unit U24).
 *
 * There used to be a second rule here: a paper named "townreporter" was
 * hard-coded to `townreporter@gmail.com`, whatever its configured contact was.
 * On the stand-in editorial day `/corrections` said "To:
 * townreporter@gmail.com" while `/about` on the same install said "Write the
 * editor at editor@townreporter.test" -- the same paper, the same setting, two
 * different addresses, on two public pages whose whole job is to tell a reader
 * where to write.
 *
 * One source: `paper.editorEmail`, the value the operator sets in Paper setup
 * (`paper_settings.editor_email`, over the build-time
 * `VITE_TOWNREPORTER_EDITOR_EMAIL`) and the same value `/about` renders. Absent
 * means absent, and both screens say so in their own words.
 */
export function correctionRecipient(paper: { editorEmail: string | null }): string | null {
  return paper.editorEmail?.trim() || null;
}

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
