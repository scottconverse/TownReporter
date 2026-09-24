import { createHash } from "node:crypto";

export type CaptionFormat = "srv3" | "vtt";

export type ParsedCaptionFile = {
  text: string;
  format: CaptionFormat;
  sha256: string;
  sourcePath: string;
  segments?: ParsedCaptionSegment[];
};

export type ParsedCaptionSegment = {
  startSeconds: number;
  endSeconds: number;
  excerpt: string;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function visibleCaptionText(value: string): string {
  return decodeEntities(value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim());
}

function srv3Segments(xml: string): ParsedCaptionSegment[] {
  const out: ParsedCaptionSegment[] = [];
  const body = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? xml;
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const attrs = match[1] ?? "";
    const excerpt = visibleCaptionText(match[2] ?? "");
    const startMs = Number(attrs.match(/\bt="(\d+)"/i)?.[1]);
    const durationMs = Number(attrs.match(/\bd="(\d+)"/i)?.[1]);
    if (!excerpt || !Number.isFinite(startMs)) continue;
    const startSeconds = startMs / 1000;
    const endSeconds = Number.isFinite(durationMs) && durationMs > 0
      ? (startMs + durationMs) / 1000
      : startSeconds + 4;
    out.push({ startSeconds, endSeconds, excerpt });
  }
  return out;
}

function parseTimestamp(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return null;
  const seconds = parts.length === 3
    ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
    : parts[0]! * 60 + parts[1]!;
  return Number.isFinite(seconds) ? seconds : null;
}

function vttSegments(raw: string): ParsedCaptionSegment[] {
  const out: ParsedCaptionSegment[] = [];
  for (const block of raw.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const parts = block.split("\n").filter((line) => line.trim());
    if (!parts.length || /^WEBVTT/i.test(parts[0]!)) continue;
    const timingIndex = parts.findIndex((line) => /-->/.test(line));
    if (timingIndex < 0) continue;
    const timing = parts[timingIndex]!.match(/^(\S+)\s+-->\s+(\S+)/);
    const startSeconds = timing ? parseTimestamp(timing[1]!) : null;
    const endSeconds = timing ? parseTimestamp(timing[2]!) : null;
    const excerpt = visibleCaptionText(parts.slice(timingIndex + 1).join(" "));
    if (!excerpt || startSeconds == null || endSeconds == null) continue;
    out.push({ startSeconds, endSeconds: Math.max(startSeconds, endSeconds), excerpt });
  }
  return out;
}

export function parseCaptionFile(raw: string, sourcePath: string): ParsedCaptionFile {
  const format: CaptionFormat = /<timedtext\b|<body\b|<p\b/i.test(raw) ? "srv3" : "vtt";
  const segments = format === "srv3" ? srv3Segments(raw) : vttSegments(raw);
  if (!segments.length) throw new Error(`${format} caption file has no timestamped text`);
  const text = segments.map((segment) => segment.excerpt).join("\n").trim();
  return {
    text,
    format,
    sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    sourcePath,
    segments,
  };
}
