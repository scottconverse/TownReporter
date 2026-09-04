import { looksLikeSoft404, type FetchOutcome } from "./fetch-outcome.ts";
import { assertPublicHttpUrl, fetchPublicHttp, fetchPublicHttpTracked } from "./fetch-url.ts";
import { htmlToPlainText } from "./html-text.ts";
import { extractArticleText } from "./article-extract.ts";
import { storableText } from "./storable-text.ts";
import { needsRenderedFetch } from "./render-detect.ts";
import { ingestYoutube, isYoutubeUrl, type YoutubeIngest } from "./youtube.ts";
import { ingestPrimeGov } from "./primegov.ts";
import { limitFor, readBodyCapped } from "./body-limit.ts";

/** Archive cap. Planner context is sliced at retrieval, never here. */
export const ARCHIVE_TEXT_CAP = 2_000_000;
export const CHUNK_SIZE = 2000;
export const PLANNER_TEXT_CAP = 1800;

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/not fetchable|Invalid URL|Only http/i.test(msg)) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return fn();
  }
}

/**
 * Decode one PDF literal string's escapes.
 *
 * Single pass, deliberately. Chained `.replace()` calls re-scan text they have
 * already produced, so `\\n` (an escaped backslash followed by the letter n)
 * was consumed by the `\n` rule and became a newline — `C:\\newdocs` came out
 * as `C:` + newline + `ewdocs` and went to the model as evidence that way.
 * Matching each backslash-escape exactly once removes the ordering question.
 */
export function decodePdfString(raw: string): string {
  return raw.replace(/\\(\d{1,3}|[\s\S])/g, (_, esc: string) => {
    if (/^\d{1,3}$/.test(esc)) return String.fromCharCode(parseInt(esc, 8) & 0xff);
    switch (esc) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "\n":
      case "\r":
        return ""; // line continuation inside a literal string
      default:
        // Covers \( \) \\ and, per spec, any other escaped char is itself.
        return esc;
    }
  });
}

/** Best-effort text from a PDF without a native parser. Civic packets are often uncompressed. */
export function extractPdfText(buf: Uint8Array): string {
  const latin = new TextDecoder("latin1").decode(buf);
  const chunks: string[] = [];
  const tj = /\((?:\\.|[^\\)]){2,}\)(?:\s*Tj|\s*TJ)/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(latin))) {
    const inner = m[0].slice(1, m[0].lastIndexOf(")"));
    chunks.push(decodePdfString(inner));
  }
  const hex = /<([0-9A-Fa-f]{4,})>\s*Tj/g;
  while ((m = hex.exec(latin))) {
    const hexStr = m[1]!;
    if (hexStr.length % 2) continue;
    const bytes = hexStr.match(/.{2}/g)!.map((h) => parseInt(h, 16));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const chars: string[] = [];
      for (let i = 2; i + 1 < bytes.length; i += 2) {
        chars.push(String.fromCharCode((bytes[i]! << 8) + bytes[i + 1]!));
      }
      chunks.push(chars.join(""));
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, ARCHIVE_TEXT_CAP);
}

export type PdfPage = { page: number; text: string; confidence?: number };
export type PdfExtract = {
  text: string;
  method: "unpdf" | "tj-regex" | "ocr" | "none";
  needsOcr: boolean;
  pages: PdfPage[];
};
export type OcrResult = { text: string; pages: PdfPage[] };
export type OcrImpl = (buf: Uint8Array) => Promise<OcrResult>;

let ocrImpl: OcrImpl | null = null;
export function setOcrImpl(impl: OcrImpl | null) {
  ocrImpl = impl;
}
export function getOcrImpl() {
  return ocrImpl;
}

async function loadDefaultOcr(): Promise<OcrImpl | null> {
  if (ocrImpl) return ocrImpl;
  try {
    const mod = (await import("./ocr.ts")) as { productionOcr: OcrImpl };
    ocrImpl = mod.productionOcr;
    return ocrImpl;
  } catch {
    return null;
  }
}

export async function extractPdfBetter(
  buf: Uint8Array,
  impl: OcrImpl | undefined | null = undefined,
): Promise<PdfExtract> {
  const ocr = impl === undefined ? ocrImpl ?? (await loadDefaultOcr()) : impl;
  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(buf, { mergePages: false });
    const pagesRaw = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
    const pages: PdfPage[] = pagesRaw.map((t, i) => ({
      page: i + 1,
      text: String(t ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    }));
    const text = pages
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text.length >= 40) {
      return { text: text.slice(0, ARCHIVE_TEXT_CAP), method: "unpdf", needsOcr: false, pages };
    }
  } catch {
    /* fall through to regex */
  }
  const fallback = extractPdfText(buf);
  if (fallback.length >= 40) {
    return {
      text: fallback.slice(0, ARCHIVE_TEXT_CAP),
      method: "tj-regex",
      needsOcr: false,
      pages: [{ page: 1, text: fallback.slice(0, ARCHIVE_TEXT_CAP) }],
    };
  }
  if (ocr) {
    try {
      const ocrResult = await ocr(buf);
      if (ocrResult.text.trim().length >= 40) {
        return {
          text: ocrResult.text.slice(0, ARCHIVE_TEXT_CAP),
          method: "ocr",
          needsOcr: false,
          pages: ocrResult.pages.length
            ? ocrResult.pages
            : [{ page: 1, text: ocrResult.text.slice(0, ARCHIVE_TEXT_CAP) }],
        };
      }
    } catch {
      /* OCR failed — still report needs-ocr */
    }
  }
  return { text: fallback, method: "none", needsOcr: true, pages: [] };
}

export type TextChunk = {
  index: number;
  excerpt: string;
  locator: string;
  page_number: number | null;
  section: string;
};

export function chunkText(text: string, size = CHUNK_SIZE): TextChunk[] {
  const out: TextChunk[] = [];
  if (!text) return out;
  for (let i = 0, idx = 0; i < text.length; i += size, idx += 1) {
    const excerpt = text.slice(i, i + size);
    out.push({
      index: idx,
      excerpt,
      locator: `char:${i}-${i + excerpt.length}`,
      page_number: null,
      section: "",
    });
  }
  return out;
}

export function chunksFromEvidence(text: string, pages?: PdfPage[]): TextChunk[] {
  if (pages && pages.some((p) => p.text.trim())) {
    const out: TextChunk[] = [];
    let idx = 0;
    for (const p of pages) {
      const body = p.text.trim();
      if (!body) continue;
      if (body.length <= CHUNK_SIZE) {
        out.push({
          index: idx++,
          excerpt: body,
          locator: `page:${p.page}`,
          page_number: p.page,
          section: "",
        });
      } else {
        for (const c of chunkText(body)) {
          out.push({
            ...c,
            index: idx++,
            page_number: p.page,
            locator: `page:${p.page}:${c.locator}`,
          });
        }
      }
    }
    return out;
  }
  return chunkText(text);
}

export function parseRssItems(xml: string): { title: string; link: string; summary: string }[] {
  const items: { title: string; link: string; summary: string }[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  const entries = blocks.length ? blocks : xml.split(/<entry[\s>]/i).slice(1);
  for (const block of entries.slice(0, 8)) {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    const link =
      block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ??
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ??
      "";
    const summary = (block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] ?? "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);
    if (title || link) items.push({ title, link, summary });
  }
  return items;
}

const DOC_HREF =
  /\.pdf(?:$|[?#])|agenda|minutes|packet|staff.?report|ordinance|resolution|budget|attachment/i;

export function discoverDocLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]!;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    try {
      const abs = new URL(href, base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (!DOC_HREF.test(abs.pathname + abs.search) && !abs.pathname.toLowerCase().endsWith(".pdf")) continue;
      const key = abs.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      /* skip */
    }
    if (out.length >= 10) break;
  }
  return out;
}

export function looksLikeArticlePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return false;
  if (/^\/(local-news|local|news|newsroom|stories|latest|section|category|tag|topics?)(\/)?$/i.test(path)) {
    return false;
  }
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1] ?? "";
  if (last.length < 12) return false;
  return /[-_]/.test(last) || /\d{4}/.test(path) || last.length >= 24;
}

/** Same-host article URLs on a listing page — not PDFs, not section indexes. */
export function discoverStoryLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]!;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
    try {
      const abs = new URL(href, base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (abs.hostname.replace(/^www\./i, "") !== base.hostname.replace(/^www\./i, "")) continue;
      if (!looksLikeArticlePath(abs.pathname)) continue;
      const key = `${abs.origin}${abs.pathname}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(abs.toString());
    } catch {
      /* skip */
    }
    if (out.length >= 12) break;
  }
  return out;
}

function mergePageExtras(html: string, base: URL, into: string[] = []): string[] {
  for (const u of discoverDocLinks(html, base)) {
    if (!into.includes(u)) into.push(u);
  }
  for (const u of discoverStoryLinks(html, base)) {
    if (!into.includes(u)) into.push(u);
  }
  return into.slice(0, 16);
}

async function ingestYoutubeIfNeeded(url: URL): Promise<YoutubeIngest | null> {
  if (!isYoutubeUrl(url)) return null;
  return ingestYoutube(url);
}

type RedditIngest = {
  ok: boolean;
  status: number;
  text: string;
  title: string;
  contentType: string;
  extractionMethod: string;
  redirectChain: string[];
};

/**
 * Dark Desk F5: route any reddit.com/redd.it URL through the `.rss`/
 * browser-UA technique (`reddit.server.ts`'s `fetchRedditDocument`) instead
 * of the generic tracked-fetch-and-strip-tags path below, which gets
 * reddit's JS app shell rather than content — the same gap the "dig"
 * planner tried (and failed) to route around itself by proposing
 * old.reddit.com URLs, documented in the Dark Desk review.
 *
 * `reddit.server.ts` is a `.server.ts` module (see fetch-url.ts's doc
 * comment on the same constraint) and this file is reachable from client
 * code, so the import is dynamic and gated the same way `render-fetch.ts`
 * is used further down in this file: server-side only.
 */
async function ingestRedditIfNeeded(url: URL): Promise<RedditIngest | null> {
  if (typeof window !== "undefined") return null;
  const { isRedditUrl } = await import("./reddit.ts");
  if (!isRedditUrl(url)) return null;
  const { fetchRedditDocument } = await import("./reddit.server.ts");
  return fetchRedditDocument(url);
}

export type IngestResult = { text: string; titleHint: string; extras: string[] };

export type IngestDocument = {
  ok: boolean;
  status: number;
  outcome: FetchOutcome;
  text: string;
  title: string;
  extras: string[];
  contentType: string;
  needsOcr: boolean;
  redirectChain: string[];
  extractionMethod: string;
  pages: PdfPage[];
  rawBytes?: Uint8Array;
};

/**
 * Every string this module hands out passes through here first.
 *
 * A NUL byte in one fetched PDF is enough for Postgres to reject the insert,
 * and the dark desk lost a whole round to exactly that after reading 21
 * documents. Cleaning at the door means no downstream writer has to remember.
 */
function clean(doc: IngestDocument): IngestDocument {
  return {
    ...doc,
    text: storableText(doc.text),
    title: storableText(doc.title),
    extras: doc.extras.map((e) => storableText(e)),
  };
}

export async function ingestDocument(raw: string): Promise<IngestDocument> {
  return clean(await ingestDocumentRaw(raw));
}

async function ingestDocumentRaw(raw: string): Promise<IngestDocument> {
  const empty = (over: Partial<IngestDocument>): IngestDocument => ({
    ok: false,
    status: 0,
    outcome: "fetch-failed",
    text: "",
    title: "",
    extras: [],
    contentType: "",
    needsOcr: false,
    redirectChain: [],
    extractionMethod: "",
    pages: [],
    rawBytes: undefined,
    ...over,
  });
  try {
    const url = await assertPublicHttpUrl(raw);
    const yt = await ingestYoutubeIfNeeded(url);
    if (yt) {
      return empty({
        ok: yt.text.length >= 40,
        status: 200,
        outcome: yt.text.length >= 40 ? "fetched" : "parse-failed",
        text: yt.text,
        title: yt.title,
        contentType: "text/plain",
        redirectChain: [url.toString()],
        extractionMethod: "youtube",
        extras: yt.extras ?? [],
      });
    }
    const pg = await ingestPrimeGov(url);
    if (pg) {
      return empty({
        ok: pg.text.length >= 40,
        status: 200,
        outcome: "fetched",
        text: pg.text,
        title: pg.title,
        contentType: "text/plain",
        redirectChain: [url.toString()],
        extractionMethod: "primegov",
        extras: pg.extras,
      });
    }
    const reddit = await ingestRedditIfNeeded(url);
    if (reddit) {
      const outcome: FetchOutcome = reddit.ok
        ? "fetched"
        : reddit.status === 429 || reddit.status === 0
          ? "fetch-failed"
          : "parse-failed";
      return empty({
        ok: reddit.ok,
        status: reddit.status,
        outcome,
        text: reddit.text,
        title: reddit.title,
        contentType: reddit.contentType,
        redirectChain: reddit.redirectChain,
        extractionMethod: reddit.extractionMethod,
        extras: [],
      });
    }
    const tracked = await fetchPublicHttpTracked(url);
    const res = tracked.response;
    const status = res.status;
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    /*
      Capped, and capped before the status check.

      This used to be `await res.arrayBuffer()` with no ceiling, sitting above
      the `!res.ok` branch — so a hostile 500 with a gigabyte of body was fully
      allocated before anyone looked at the status. The SSRF guard says where
      we may connect; it says nothing about how much we may accept.
    */
    const capped = await readBodyCapped(res, limitFor(url.toString(), ctype));
    if (!capped.ok) {
      return {
        ok: false,
        status,
        outcome: "fetch-failed" as FetchOutcome,
        // The reason belongs where an editor can read it, not in a thrown error.
        text: `The response was larger than this desk will read (${capped.declared ?? capped.read} bytes).`,
        title: url.toString(),
        extras: [],
        contentType: ctype,
        needsOcr: false,
        redirectChain: tracked.chain,
        extractionMethod: "refused-too-large",
        pages: [],
      };
    }
    const buf = capped.bytes;
    const path = url.pathname.toLowerCase();

    if (!res.ok) {
      const outcome: FetchOutcome =
        status === 404 || status === 410 ? "not-found" : "fetch-failed";
      const why =
        status === 429
          ? "The site returned 429 Too Many Requests. No article was captured."
          : `The site returned HTTP ${status}. No article was captured.`;
      return empty({
        ok: false,
        status,
        outcome,
        text: why,
        title: status === 429 ? "Too many requests" : url.hostname,
        contentType: ctype,
        redirectChain: tracked.chain,
        extractionMethod: "http-error",
      });
    }

    if (ctype.includes("pdf") || path.endsWith(".pdf")) {
      const pdf = await extractPdfBetter(buf);
      const title = url.pathname.split("/").pop() ?? "pdf";
      if (pdf.needsOcr) {
        return empty({
          ok: true,
          status,
          outcome: "needs-ocr",
          text: pdf.text,
          title,
          contentType: "application/pdf",
          needsOcr: true,
          redirectChain: tracked.chain,
          extractionMethod: pdf.method,
          pages: pdf.pages,
          rawBytes: buf,
        });
      }
      return empty({
        ok: true,
        status,
        outcome: "fetched",
        text: `PDF ${url.toString()}\n\n${pdf.text}`.slice(0, ARCHIVE_TEXT_CAP),
        title,
        contentType: "application/pdf",
        redirectChain: tracked.chain,
        extractionMethod: pdf.method,
        pages: pdf.pages,
        rawBytes: buf,
      });
    }

    const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140)
      : url.hostname;
    const text = htmlToPlainText(body).slice(0, ARCHIVE_TEXT_CAP);
    if (looksLikeSoft404(title, text)) {
      return empty({
        ok: false,
        status,
        outcome: "soft-404",
        text,
        title,
        contentType: ctype,
        redirectChain: tracked.chain,
        extractionMethod: "html",
        rawBytes: buf.byteLength <= 4_000_000 ? buf : undefined,
      });
    }
    const extras = mergePageExtras(body, url);
    // Dark Desk F2: extract the article body, not the whole page. `text`
    // above (the raw tag-strip) still keeps everything including nav/footer
    // — it's only used for the soft-404 sniff above, which wants the whole
    // page. Everything downstream — the render decision, the stored text,
    // and the "capture failed" classification — is driven off the EXTRACTED
    // article, so a nav-heavy page with a small real article is kept, and a
    // nav-only app-shell page with a huge raw stripped length is not
    // mistaken for a successful capture.
    const extracted = extractArticleText(body, url.toString());
    let outText = extracted.text;
    let outTitle = extracted.title || title;
    let method = extracted.method === "readability" ? "readability" : "heuristic";
    if (needsRenderedFetch(url, text, body, outText.length) && typeof window === "undefined") {
      const { fetchRenderedPage } = await import("./render-fetch.ts");
      const rendered = await fetchRenderedPage(url.toString());
      if (rendered && rendered.text.length > Math.min(outText.length, 400)) {
        const renderedExtracted = extractArticleText(rendered.html, rendered.finalUrl);
        const renderedText = renderedExtracted.text || rendered.text;
        outText = renderedText.slice(0, ARCHIVE_TEXT_CAP);
        outTitle = renderedExtracted.title || rendered.title || outTitle;
        method = renderedExtracted.text ? `playwright+${renderedExtracted.method}` : "playwright";
        mergePageExtras(rendered.html, new URL(rendered.finalUrl), extras);
      }
    }
    outText = outText.slice(0, ARCHIVE_TEXT_CAP);
    return empty({
      ok: outText.length >= 40,
      status,
      outcome: outText.length >= 40 ? "fetched" : "parse-failed",
      text: outText,
      title: outTitle,
      extras,
      contentType: ctype || "text/html",
      redirectChain: tracked.chain,
      extractionMethod: method,
      rawBytes: buf.byteLength <= 4_000_000 ? buf : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    const timeout = /timeout|aborted/i.test(msg);
    return empty({
      ok: false,
      status: 0,
      outcome: "fetch-failed",
      text: timeout ? "timeout" : msg,
    });
  }
}

export async function ingestUrl(raw: string): Promise<IngestResult> {
  const url = await assertPublicHttpUrl(raw);
  const yt = await ingestYoutubeIfNeeded(url);
  if (yt) return { text: yt.text, titleHint: yt.title, extras: yt.extras ?? [] };
  const pg = await ingestPrimeGov(url);
  if (pg) return { text: pg.text, titleHint: pg.title, extras: pg.extras };
  const path = url.pathname.toLowerCase();

  const res = await fetchPublicHttp(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  const capped = await readBodyCapped(res, limitFor(url.toString(), ctype));
  if (!capped.ok) {
    throw new Error(
      `Response too large to read (${capped.declared ?? capped.read} bytes)`,
    );
  }
  const buf = capped.bytes;

  if (ctype.includes("pdf") || path.endsWith(".pdf")) {
    const pdf = await extractPdfBetter(buf);
    if (pdf.needsOcr || pdf.text.length < 40) throw new Error("PDF had no extractable text");
    return { text: `PDF ${url.toString()}\n\n${pdf.text.slice(0, 40000)}`, titleHint: url.pathname.split("/").pop() ?? "pdf", extras: [] };
  }

  const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (
    ctype.includes("xml") ||
    ctype.includes("rss") ||
    ctype.includes("atom") ||
    /\/(rss|atom|feed)(\.xml)?$/i.test(path)
  ) {
    const items = parseRssItems(body);
    const text = items
      .map((it) => `${it.title}\n${it.link}\n${it.summary}`)
      .join("\n\n")
      .slice(0, 14000);
    if (text.length < 40) throw new Error("Feed had almost no readable text");
    return { text: `RSS ${url.toString()}\n\n${text}`, titleHint: url.hostname, extras: [] };
  }

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleHint = titleMatch
    ? titleMatch[1]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140)
    : url.hostname;
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14000);
  if (text.length < 40) throw new Error("Page had almost no readable text");
  const extras = mergePageExtras(body, url);
  const alt = body.match(/rel=["']alternate["'][^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)/i);
  if (alt?.[2]) {
    try {
      extras.unshift(new URL(alt[2], url).toString());
    } catch {
      /* skip */
    }
  }
  return { text, titleHint, extras };
}
