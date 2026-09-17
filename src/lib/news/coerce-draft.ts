import { parseJsonBlock } from "./ai.ts";
import { TOPICS } from "../paper.ts";

export type CoercedDraft = {
  headline: string;
  dek: string;
  body: string;
  topic: string;
  source_urls: unknown;
  integrity_notes: string;
  memory_entities: string[];
};

export function looksLikeJsonDraft(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") && /"headline"\s*:/.test(t) && /"body"\s*:/.test(t);
}

function asTopic(value: unknown, fallback: string): string {
  const s = String(value ?? fallback).trim();
  // A configured custom section is carried by the trusted lead fallback.
  // Server filing validates it again against this newsroom's current config.
  return s === fallback || (TOPICS as readonly string[]).includes(s) ? s : fallback;
}

export function normalizeIntegrityNotes(value: unknown): string {
  const text = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).join("\n")
    : String(value ?? "").trim();
  return text.slice(0, 2000);
}

/** New array notes use newlines; historical prose (including commas) stays intact. */
export function integrityNoteItems(value: string): string[] {
  return value.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
}

/** Pull a JSON string field even when the model left inner quotes unescaped. */
export function extractQuoted(raw: string, key: string): string | undefined {
  const startRe = new RegExp(`"${key}"\\s*:\\s*"`);
  const m = startRe.exec(raw);
  if (!m) return undefined;
  const rest = raw.slice(m.index + m[0].length);
  const term = rest.search(
    /"\s*,\s*"(?:headline|dek|body|topic|source_urls|integrity_notes|memory_entities)"|"\s*}/,
  );
  const chunk = term >= 0 ? rest.slice(0, term) : rest;
  return chunk
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function fromObject(
  obj: Record<string, unknown>,
  fallback: { headline: string; dek: string; topic: string },
): CoercedDraft {
  const headline =
    String(obj.headline ?? fallback.headline).trim().slice(0, 240) || fallback.headline;
  const dek = String(obj.dek ?? fallback.dek).trim().slice(0, 400);
  let body = String(obj.body ?? "").trim();
  if (looksLikeJsonDraft(body)) {
    const inner = parseJsonBlock<Record<string, unknown>>(body);
    if (inner && typeof inner.body === "string") body = String(inner.body).trim();
  }
  return {
    headline,
    dek,
    body,
    topic: asTopic(obj.topic, fallback.topic),
    source_urls: obj.source_urls,
    integrity_notes: normalizeIntegrityNotes(obj.integrity_notes),
    memory_entities: Array.isArray(obj.memory_entities)
      ? obj.memory_entities.map((x) => String(x).slice(0, 80)).slice(0, 16)
      : [],
  };
}

/**
 * Turn a Grok draft reply into fields. Never return the raw JSON blob as body.
 */
export function coerceDraft(
  raw: string,
  fallback: { headline: string; dek: string; topic: string },
): CoercedDraft {
  const parsed = parseJsonBlock<unknown>(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const out = fromObject(parsed as Record<string, unknown>, fallback);
    if (out.body && !looksLikeJsonDraft(out.body)) return out;
  }

  const headline = extractQuoted(raw, "headline")?.trim().slice(0, 240) || fallback.headline;
  const dek = extractQuoted(raw, "dek")?.trim().slice(0, 400) || fallback.dek;
  const body = extractQuoted(raw, "body")?.trim() ?? "";
  const topic = asTopic(extractQuoted(raw, "topic"), fallback.topic);
  const notes = extractQuoted(raw, "integrity_notes")?.trim().slice(0, 2000) ?? "";

  if (body && !looksLikeJsonDraft(body)) {
    return {
      headline,
      dek,
      body,
      topic,
      source_urls: [],
      integrity_notes: notes,
      memory_entities: [],
    };
  }

  return {
    headline,
    dek,
    body: body && !looksLikeJsonDraft(body) ? body : "",
    topic,
    source_urls: [],
    integrity_notes: notes,
    memory_entities: [],
  };
}

export function unpackStoredDraft<T extends { headline: string; dek: string; body: string; topic: string }>(
  draft: T,
): T {
  if (!looksLikeJsonDraft(draft.body)) return draft;
  const c = coerceDraft(draft.body, {
    headline: draft.headline,
    dek: draft.dek,
    topic: draft.topic,
  });
  if (!c.body) return draft;
  // The saved topic is authoritative after editor filing or section retirement.
  // Legacy JSON is decoded for text only; it cannot revive an old section key.
  return { ...draft, headline: c.headline, dek: c.dek, body: c.body };
}
