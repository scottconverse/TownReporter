/**
 * The pure half of the editor's new dialogs.
 *
 * Everything in here is text-in / value-out with no React and no database, so
 * the parts of a dialog that can be silently wrong -- which rows a preview
 * marks as new, what "Add as an update" actually writes, what the model is
 * asked -- are testable with plain `node --test` instead of a browser.
 *
 * Kept out of the components for the same reason `source-lines.ts` is kept out
 * of `desk.ts`: a dialog that is only reachable through a portal in a browser
 * is a dialog whose logic is only reachable through a browser.
 */
import { parseSourceLines, type ParsedSourceLine } from "./source-lines.ts";
import { sourceIdentity } from "./url-guard.ts";

/* ------------------------------------------------------------------ sources -- */

export type SourcePreviewRow = {
  url: string;
  /** The name that will be stored: the pasted name, or the host. */
  name: string;
  /** The kind as the preview table prints it, or "Already watched". */
  kind: string;
  /** True when this row will be added. */
  isNew: boolean;
};

export type SourcePreview = {
  rows: SourcePreviewRow[];
  /** Rows in the pasted text that parsed to a real URL. */
  found: number;
  newCount: number;
  watchedCount: number;
};

/**
 * The design's human words for a parsed row's kind.
 *
 * `ParsedSourceLine.kind` is tier-derived and machine-facing ("official",
 * "news", "community", "youtube"); the preview table is read by an editor
 * deciding whether the paste is worth adding, so it prints nouns. An RSS or
 * Atom URL is called out first -- it behaves differently in a scan (there is
 * nothing to render) and that is the fact the editor needs at a glance.
 */
export function sourceKindLabel(row: ParsedSourceLine): string {
  if (/\.(rss|atom)$|\/(feed|rss|atom)\/?$/i.test(row.url)) return "RSS";
  switch (row.kind) {
    case "youtube":
      return "Video";
    case "news":
      return "News page";
    case "community":
      return "Community page";
    default:
      return "Official page";
  }
}

/**
 * What the preview table shows before anything is added.
 *
 * "Already watched" is decided by `sourceIdentity` -- host plus path, `www.`
 * stripped -- not by string equality of the URLs. That is the same identity the
 * desk uses to refuse a duplicate elsewhere, so a preview that says "new" for a
 * row the add would then skip would be worse than no preview at all. The
 * caller passes the identities it read from the watch list.
 *
 * `parseSourceLines` already de-duplicates within the paste, so a URL twice in
 * one paste is one row, and the count under the head line is the count of rows.
 */
export function previewSources(text: string, watchedIdentities: Iterable<string>): SourcePreview {
  const watched = new Set<string>();
  for (const value of watchedIdentities) {
    const identity = sourceIdentity(value);
    if (identity) watched.add(identity);
  }
  const rows: SourcePreviewRow[] = [];
  for (const row of parseSourceLines(text)) {
    const identity = sourceIdentity(row.url) ?? row.url;
    const isNew = !watched.has(identity);
    rows.push({
      url: row.url,
      name: row.title,
      kind: isNew ? sourceKindLabel(row) : "Already watched",
      isNew,
    });
  }
  const newCount = rows.filter((r) => r.isNew).length;
  return { rows, found: rows.length, newCount, watchedCount: rows.length - newCount };
}

/** "Add 5 sources" / "Add 1 source" -- the primary button's own count. */
export function addSourcesLabel(count: number): string {
  return count === 1 ? "Add 1 source" : `Add ${count} sources`;
}

/** The head line's split, e.g. "5 new · 1 already watched". */
export function previewSplit(preview: SourcePreview): string {
  const parts = [`${preview.newCount} new`];
  if (preview.watchedCount > 0) parts.push(`${preview.watchedCount} already watched`);
  return parts.join(" · ");
}

/* ---------------------------------------------------------------- dark desk -- */

/**
 * The Limits the design draws, and the dial depth each one means.
 *
 * The engine's unit is a *hop* (`budgetFor` in `dark-dials.ts` turns a dial
 * value into hops, searches per hop and fetches per hop); the design's copy is
 * in records and hours. There is no records-per-hop conversion in the codebase,
 * so these three are the dial values whose hop counts the desk's own estimate
 * (`estimateMinutes`) lands closest to the drawn times -- 2 hops ≈ 20 minutes,
 * 5 ≈ 2 hours, 10 ≈ the deep end. The copy is the design's, unchanged; the
 * mismatch is recorded in the unit's report rather than papered over with a
 * number the engine does not actually honour.
 */
export const DARK_LIMITS = [
  { key: "quick", label: "Quick look · up to 10 records, 20 minutes", hops: 2 },
  { key: "standard", label: "Standard · up to 30 records, 2 hours or $3", hops: 5 },
  { key: "deep", label: "Deep · up to 100 records, 8 hours or $15", hops: 10 },
] as const;

export type DarkLimitKey = (typeof DARK_LIMITS)[number]["key"];

export function hopsForLimit(key: string): number {
  return DARK_LIMITS.find((l) => l.key === key)?.hops ?? 5;
}

/* ------------------------------------------------------------- add to story -- */

/**
 * The three How choices. Two of them never touch a model.
 *
 * `mode` is what the dialog switches on; `ai` is what tells the caller whether
 * a model call is about to happen, so the "no AI" path is a property of the
 * data rather than a second `if` that can drift from the label.
 */
export const ADD_TO_MODES = [
  { key: "weave", label: "AI weaves it in", note: "Rewrites around it; you review the change", ai: true },
  { key: "update", label: "Add as an update at the top", note: "Marked Updated with the time", ai: false },
  { key: "as-is", label: "Paste in as-is at the end", note: "No AI", ai: false },
] as const;

export type AddToModeKey = (typeof ADD_TO_MODES)[number]["key"];

/** The stamp a timed update carries. Local time, because the desk is local. */
export function updateStamp(at: Date): string {
  return at.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The update paragraph, put at the top of the body.
 *
 * `UPDATED_TEXT` is the desk's existing marker word for a timed update and the
 * story page already renders a leading "Updated <time>" line, so the shape here
 * is the one the reader-facing page expects: a labelled first paragraph, then
 * the editor's material, then the story as it was.
 */
export const UPDATED_TEXT = "Updated";

export function insertUpdateAtTop(body: string, material: string, at: Date): string {
  const lead = `${UPDATED_TEXT} ${updateStamp(at)}: ${material.trim()}`;
  const rest = body.trim();
  return rest ? `${lead}\n\n${rest}` : lead;
}

/** The as-is paste: the editor's material appended after the story. */
export function appendPastedText(body: string, material: string): string {
  const rest = body.trim();
  return rest ? `${rest}\n\n${material.trim()}` : material.trim();
}

/* ------------------------------------------------------------- find sources -- */

export const FIND_SOURCE_SCOPES = [
  { key: "records", label: "Government and public-record sites" },
  { key: "organizations", label: "Local organizations and nonprofits" },
  { key: "everything", label: "Everything, including local news and forums" },
] as const;

export function scopeFromKey(key: string): (typeof FIND_SOURCE_SCOPES)[number] {
  return FIND_SOURCE_SCOPES.find((s) => s.key === key) ?? FIND_SOURCE_SCOPES[0];
}

/**
 * What the model is asked when the editor presses "Find sources".
 *
 * The answer is parsed, not trusted: `parseProposedSources` drops anything that
 * is not a URL, and every survivor still goes through
 * `insertProposedNewsroomSource`, which refuses search-result URLs, social
 * posts and pages it cannot identify. This prompt exists so the model's output
 * is a list shape rather than prose.
 */
export function findSourcesPrompt(topic: string, scopeKey: string): { system: string; user: string } {
  const scope = scopeFromKey(scopeKey);
  return {
    system:
      "You suggest pages a small local newspaper should watch for public records. " +
      "Answer with one row per source and nothing else, in the form: URL | name | why. " +
      "URLs must be the site's own listing or landing page, never a search-result page, " +
      "never a social post, and never a page you have not seen in training data or the " +
      "material given to you. Three to ten rows.",
    user: [
      `What the paper covers: ${topic.trim().slice(0, 400)}`,
      `Kind of source: ${scope.label}`,
      "Give the sources with a short reason for each. The editor accepts or rejects them.",
    ].join("\n"),
  };
}

export type ProposedSource = { url: string; name: string; reason: string };

/**
 * The rows out of a model answer, or fewer when it gave fewer.
 *
 * Accepts both the `URL | name | why` rows the prompt asks for and a JSON array,
 * because the story model has been seen to answer either way. Only rows with a
 * real http(s) URL survive; the name falls back to the URL's host and the reason
 * is trimmed to the ceiling `insertProposedNewsroomSource` enforces.
 */
export function parseProposedSources(text: string, max = 12): ProposedSource[] {
  const out: ProposedSource[] = [];
  const seen = new Set<string>();
  const push = (rawUrl: string, name: string, reason: string) => {
    const url = String(rawUrl ?? "").trim().replace(/[.,;:]+$/, "");
    if (!/^https?:\/\//i.test(url)) return;
    const identity = sourceIdentity(url) ?? url;
    if (seen.has(identity)) return;
    seen.add(identity);
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep the raw url as the name */
    }
    out.push({
      url,
      name: String(name ?? "").replace(/["'`]/g, "").trim().slice(0, 160) || host,
      reason: String(reason ?? "").replace(/["'`]/g, "").trim().slice(0, 400),
    });
  };

  const body = String(text ?? "");
  const asJson = body.match(/\[[\s\S]*\]/);
  if (asJson) {
    try {
      const rows = JSON.parse(asJson[0]) as unknown;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const r = row as { url?: unknown; name?: unknown; reason?: unknown; why?: unknown };
          push(String(r.url ?? ""), String(r.name ?? ""), String(r.reason ?? r.why ?? ""));
          if (out.length >= max) return out;
        }
        if (out.length) return out;
      }
    } catch {
      /* fall through to the row form */
    }
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+\s*[.)])\s*/, "").trim();
    if (!line || /^```/.test(line)) continue;
    const urlMatch = line.match(/https?:\/\/[^\s<>"'|]+/i);
    if (!urlMatch) continue;
    const parts = line.split("|").map((p) => p.trim());
    const urlAt = parts.findIndex((p) => /^https?:\/\//i.test(p));
    const name = urlAt > 0 ? parts[urlAt - 1] ?? "" : "";
    const reason = urlAt >= 0 && parts.length > urlAt + 1 ? parts.slice(urlAt + 1).join(" ") : "";
    push(urlMatch[0], name, reason);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------- weaving -- */

/**
 * What the model is asked when the editor drops new material into a story.
 *
 * The instruction that matters is the last one: the answer is the whole body,
 * not a diff, because the desk compares the saved version with the returned one
 * and shows the editor both (`astra-compare`). A model that returned only the
 * new paragraph would produce a comparison the editor cannot read.
 */
export function weavePrompt(input: { headline: string; body: string; material: string }): { system: string; user: string } {
  return {
    system:
      "You are a newspaper editor folding new material into a story already written. " +
      "Keep the story's voice and every fact it already states. Weave the new material " +
      "in where it belongs, not at the end. Return the whole story text and nothing else -- " +
      "no notes, no markdown, no explanation of what you changed.",
    user: [
      `Headline: ${input.headline.slice(0, 300)}`,
      `The story as it stands:\n${input.body.trim().slice(0, 12000)}`,
      `New material to fold in:\n${input.material.trim().slice(0, 8000)}`,
    ].join("\n\n"),
  };
}

/* -------------------------------------------------------------------- scoring -- */

/**
 * "Research and score it" for a lead.
 *
 * The score is the desk's own 0-100 usefulness number and the reason is what the
 * Queue prints under the lead. Asking for one line of JSON keeps the parse
 * honest: `parseScore` refuses anything else, and the caller leaves the lead as
 * it was rather than writing half a score.
 */
export function scorePrompt(input: { headline: string; text: string }): { system: string; user: string } {
  return {
    system:
      "You score news leads for a small local newspaper. Answer with one JSON object and " +
      'nothing else: {"score": <0-100>, "reason": "<one sentence>"}. Score for public ' +
      "interest, whether it is new, and whether the paper can verify it from records. " +
      "A routine notice scores low even when it is genuine news to someone.",
    user: [`Lead: ${input.headline.slice(0, 300)}`, `What we have:\n${input.text.trim().slice(0, 4000)}`].join("\n\n"),
  };
}

export function parseScore(text: string): { score: number; reason: string } | null {
  const match = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const row = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
    const score = Math.round(Number(row.score));
    if (!Number.isFinite(score)) return null;
    return {
      score: Math.max(0, Math.min(100, score)),
      reason: String(row.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- kill pattern -- */

/**
 * Does this lead's `source_urls` include this source?
 *
 * `leads` has no `source_id`. The only link between a lead and a source is the
 * JSON array of URLs the lead was filed with, so the count of "leads killed
 * from this source" has to compare identities rather than join a column. The
 * comparison is `sourceIdentity` (host + path), which is what makes
 * `https://www.longmontcolorado.gov/news` and
 * `https://longmontcolorado.gov/news` the same source here -- the same rule the
 * watch list uses -- and what keeps a substring test from counting
 * `.../news-archive` as `.../news`.
 *
 * A malformed or absent array answers false: it is not evidence of a kill.
 */
export function sourceUrlsContain(sourceUrlsJson: string | null | undefined, identity: string | null): boolean {
  if (!identity) return false;
  const raw = String(sourceUrlsJson ?? "").trim();
  if (!raw) return false;
  let urls: unknown;
  try {
    urls = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(urls)) return false;
  return urls.some((value) => typeof value === "string" && sourceIdentity(value) === identity);
}
