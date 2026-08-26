import { z } from "zod";
import { TOPICS } from "../paper.ts";
import { assertHttpUrl } from "./fetch-url.ts";

export const TopicSchema = z.enum(TOPICS);

export const ScanLeadSchema = z.object({
  headline: z.string().min(1).max(180),
  why: z.string().max(800).optional().default(""),
  topic: TopicSchema.optional().default("council"),
  source_urls: z.array(z.string()).max(16).optional().default([]),
  evidence: z.string().max(2000).optional().default(""),
  newsworthiness: z.coerce.number().min(0).max(20).optional().default(0),
});

export const ScanResultSchema = z.object({
  editor_summary: z.string().max(2000).optional().default(""),
  leads: z.array(ScanLeadSchema).max(8).optional().default([]),
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
