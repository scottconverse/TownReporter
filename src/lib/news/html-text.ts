export function looksLikeHtml(text: string): boolean {
  const head = text.trim().slice(0, 900);
  if (/^\s*<!doctype html/i.test(head) || /^\s*<html[\s>]/i.test(head)) return true;
  if (/<(html|head|body|meta charset|div|script|style|link rel)\b/i.test(head)) return true;
  const tags = head.match(/<[^>]+>/g);
  return Boolean(tags && tags.length >= 4);
}

export function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h[1-6]|li|tr|td|th|section|article|header|footer|blockquote|pre|ul|ol|table|hr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, '"')
    .replace(/&#39;|'/gi, "'")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c > 0 && c < 0x110000 ? String.fromCharCode(c) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const c = parseInt(h, 16);
      return c > 0 && c < 0x110000 ? String.fromCharCode(c) : " ";
    });
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readableCapture(input: {
  text: string;
  status?: number | null;
  outcome?: string | null;
  title?: string | null;
}): { kind: "ok" | "blocked" | "empty"; body: string; note: string | null } {
  const raw = input.text ?? "";
  const title = input.title ?? "";
  const status = input.status ?? 0;
  const outcome = input.outcome ?? "";
  const cleaned = looksLikeHtml(raw) ? htmlToPlainText(raw) : raw.trim();
  const blob = `${title}\n${cleaned.slice(0, 400)}\n${raw.slice(0, 400)}`.toLowerCase();
  const rateLimited = status === 429 || (looksLikeHtml(raw) && /too many requests|\b429\b/.test(blob));

  if (rateLimited) {
    return {
      kind: "blocked",
      body: "",
      note: "The site refused the request — too many requests. This is not the article. Open original, or Keep digging later.",
    };
  }
  if (status === 403 || status === 401) {
    return {
      kind: "blocked",
      body: "",
      note: "The site blocked the capture. This is not the article. Open original.",
    };
  }
  if (status === 404 || status === 410 || outcome === "not-found" || outcome === "soft-404") {
    return {
      kind: "blocked",
      body: "",
      note: "This page was gone or not found. It is not an article.",
    };
  }
  if (status >= 400 || outcome === "fetch-failed" || outcome === "parse-failed") {
    return {
      kind: "blocked",
      body: "",
      note: `Capture failed${status ? ` (${status})` : ""}. This is not the article. Open original.`,
    };
  }
  if (cleaned.length < 40) {
    return {
      kind: "empty",
      body: "",
      note: "Opened, but no readable text was extracted. Use Open original.",
    };
  }
  return { kind: "ok", body: cleaned, note: null };
}
