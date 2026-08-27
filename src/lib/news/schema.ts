import { z } from "zod";
import { TOPICS } from "../paper.ts";
import { assertHttpUrl } from "./url-guard.ts";

export const TopicSchema = z.enum(TOPICS);

export function coerceScanTopic(value: unknown): (typeof TOPICS)[number] {
  if (typeof value !== "string") return "council";
  const t = value.toLowerCase().trim();
  if ((TOPICS as readonly string[]).includes(t)) return t as (typeof TOPICS)[number];
  const hit = TOPICS.find((topic) => topic !== "about" && t.includes(topic));
  return hit ?? "council";
}

export const ScanLeadSchema = z.object({
  headline: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().slice(0, 180) : ""),
    z.string().min(1).max(180),
  ),
  why: z.preprocess(
    (v) => (typeof v === "string" ? v.slice(0, 800) : ""),
    z.string().max(800).optional().default(""),
  ),
  topic: z.preprocess(coerceScanTopic, TopicSchema),
  source_urls: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((u) => typeof u === "string").slice(0, 16) : []),
    z.array(z.string()).max(16).optional().default([]),
  ),
  evidence: z.preprocess(
    (v) => (typeof v === "string" ? v.slice(0, 2000) : ""),
    z.string().max(2000).optional().default(""),
  ),
  newsworthiness: z.preprocess((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(20, n));
  }, z.number().min(0).max(20)),
});

export const ScanResultSchema = z.object({
  editor_summary: z.string().max(2000).optional().default(""),
  leads: z.array(ScanLeadSchema).max(12).optional().default([]),
  proposed_sources: z
    .array(
      z.object({
        url: z.string().max(500),
        title: z.string().max(200).optional().default(""),
        why: z.string().max(400).optional().default(""),
      }),
    )
    .max(12)
    .optional()
    .default([]),
});

export type ParsedScanLead = z.infer<typeof ScanLeadSchema>;

export type ParsedScanResult = {
  editor_summary: string;
  leads: ParsedScanLead[];
  proposed_sources: { url: string; title: string; why: string }[];
  parseError: string | null;
};

/** One bad lead must not dump the whole scan. */
export function parseScanResult(raw: unknown): ParsedScanResult {
  const empty: ParsedScanResult = {
    editor_summary: "",
    leads: [],
    proposed_sources: [],
    parseError: "Writing pass returned no usable JSON.",
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, unknown>;
  const hasShape = "leads" in obj || "editor_summary" in obj || "proposed_sources" in obj;
  if (!hasShape) return empty;

  const editor_summary =
    typeof obj.editor_summary === "string" ? obj.editor_summary.trim().slice(0, 2000) : "";
  const leadsIn = Array.isArray(obj.leads) ? obj.leads : [];
  const leads: ParsedScanLead[] = [];
  for (const item of leadsIn) {
    const parsed = ScanLeadSchema.safeParse(item);
    if (parsed.success) leads.push(parsed.data);
    if (leads.length >= 12) break;
  }
  if (leadsIn.length > 0 && leads.length === 0) {
    return { ...empty, editor_summary, parseError: "Writing pass returned leads the desk could not read." };
  }

  const proposedIn = Array.isArray(obj.proposed_sources) ? obj.proposed_sources : [];
  const proposed_sources: { url: string; title: string; why: string }[] = [];
  for (const item of proposedIn) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url.trim()) continue;
    proposed_sources.push({
      url: row.url.trim().slice(0, 500),
      title: typeof row.title === "string" ? row.title.slice(0, 200) : "",
      why: typeof row.why === "string" ? row.why.slice(0, 400) : "",
    });
    if (proposed_sources.length >= 12) break;
  }

  return { editor_summary, leads, proposed_sources, parseError: null };
}

export function previousScanNeedsReread(
  prev: { leads_created: number; sources_fetched: number } | null | undefined,
): boolean {
  return Boolean(prev && prev.sources_fetched > 0 && prev.leads_created === 0);
}

export function shouldCommitFetchHashes(input: {
  aiOk: boolean;
  parseError: string | null;
}): boolean {
  return input.aiOk && !input.parseError;
}

export const DraftResultSchema = z.object({
  headline: z.string().min(1).max(240),
  dek: z.string().max(400).optional().default(""),
  body: z.string().min(1).max(20000),
  topic: TopicSchema.optional().default("council"),
  source_urls: z.array(z.string()).max(16).optional().default([]),
  integrity_notes: z.string().max(2000).optional().default(""),
  memory_entities: z.array(z.string().max(80)).max(16).optional().default([]),
});

/** Watch origins — for display only. Never a journalism boundary. */
export function originAllowlist(watchUrls: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of watchUrls) {
    try {
      set.add(new URL(raw).origin);
    } catch {
      /* skip */
    }
  }
  return set;
}

/**
 * Keep reachable public http(s) URLs. Drop javascript/file/SSRF literals.
 * Do not filter by the watch-list origin. Discovery is the point.
 */
export function sanitizePublicUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    try {
      const u = assertHttpUrl(raw.trim());
      const s = u.toString();
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    } catch {
      /* invalid or blocked host */
    }
  }
  return out;
}

/** @deprecated origin fence — kept as alias so old tests fail loudly if reintroduced */
export function filterToAllowlist(urls: unknown, _allowed?: Set<string>): string[] {
  return sanitizePublicUrls(urls);
}
