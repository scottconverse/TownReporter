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

/**
 * Split a batch of captures into readable-vs-blocked, and name the
 * dominant failure mode so the page can say WHY a dig is stuck instead of
 * rendering a failing round identically to a working one (Dark Desk F6).
 */
export function captureBatchStats(
  items: Array<{
    text: string;
    status?: number | null;
    outcome?: string | null;
    title?: string | null;
  }>,
): {
  total: number;
  ok: number;
  blocked: number;
  empty: number;
  blockedRatio: number;
  dominantReason: "rate-limited" | "blocked" | "not-found" | "empty" | "other" | null;
} {
  let ok = 0;
  let blocked = 0;
  let empty = 0;
  const reasons: Record<string, number> = {};
  for (const item of items) {
    const r = readableCapture(item);
    if (r.kind === "ok") {
      ok++;
      continue;
    }
    if (r.kind === "empty") {
      empty++;
      reasons.empty = (reasons.empty ?? 0) + 1;
      continue;
    }
    blocked++;
    const status = item.status ?? 0;
    const key =
      status === 429
        ? "rate-limited"
        : status === 403 || status === 401
          ? "blocked"
          : status === 404 || status === 410
            ? "not-found"
            : "other";
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  const total = items.length;
  const blockedRatio = total > 0 ? (blocked + empty) / total : 0;
  type Reason = "rate-limited" | "blocked" | "not-found" | "empty" | "other";
  let dominantReason: Reason | null = null;
  let max = 0;
  for (const [key, count] of Object.entries(reasons)) {
    if (count > max) {
      max = count;
      dominantReason = key as Reason;
    }
  }
  return { total, ok, blocked, empty, blockedRatio, dominantReason };
}
