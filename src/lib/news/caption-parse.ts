import { createHash } from "node:crypto";

export type CaptionFormat = "srv3" | "vtt";

export type ParsedCaptionFile = {
  text: string;
  format: CaptionFormat;
  sha256: string;
  sourcePath: string;
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

function paragraphs(xml: string): string[] {
  const out: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const raw = (match[1] ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (raw) out.push(decodeEntities(raw));
  }
  return out;
}

function parseSrv3(raw: string): string {
  const body = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw;
  const lines = paragraphs(body);
  if (!lines.length) throw new Error("srv3 caption file has no text");
  return lines.join("\n").trim();
}

function parseVtt(raw: string): string {
  const lines: string[] = [];
  for (const block of raw.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const parts = block.split("\n").filter((line) => line.trim());
    if (!parts.length || /^WEBVTT/i.test(parts[0]!)) continue;
    const body = /-->/.test(parts[0]!) ? parts.slice(1) : parts.slice(2);
    const text = body
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push(text);
  }
  if (!lines.length) throw new Error("VTT caption file has no text");
  return lines.join("\n").trim();
}

export function parseCaptionFile(raw: string, sourcePath: string): ParsedCaptionFile {
  const format: CaptionFormat = /<timedtext\b|<body\b|<p\b/i.test(raw) ? "srv3" : "vtt";
  const text = format === "srv3" ? parseSrv3(raw) : parseVtt(raw);
  return {
    text,
    format,
    sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    sourcePath,
  };
}
