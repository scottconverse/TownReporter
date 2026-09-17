/**
 * How much of a stranger's response the desk will hold in memory.
 *
 * Both ingest paths called `res.arrayBuffer()` with no ceiling, and one did it
 * *before* checking `res.ok`, so a hostile error page was fully allocated too.
 * The text was truncated to 14,000 characters afterwards — protection for the
 * parser, none at all for the heap.
 *
 * The SSRF guard decides *where* the desk may connect. It says nothing about
 * how many bytes are safe to accept once connected, and the desk fetches URLs
 * it discovered from sites it does not control. One URL — chosen by an editor
 * or turned up mid-investigation — could exhaust the worker and take every
 * queued job with it.
 *
 * Two checks, because either alone is porous: refuse an oversized declared
 * length before reading a byte, and stop mid-stream when a body with no
 * declared length keeps coming.
 */

/**
 * Ceilings by kind. Generous on purpose — a civic page is small, but a council
 * packet PDF legitimately runs to tens of megabytes, and refusing real work is
 * a worse failure than allowing a big honest download.
 */
export const BODY_LIMIT = {
  /** HTML, feeds, JSON, plain text. */
  html: 5_000_000,
  /** Agendas, packets, minutes. Scanned packets get large. */
  pdf: 25_000_000,
} as const;

export type CappedRead =
  | { ok: true; bytes: Uint8Array }
  | {
      ok: false;
      reason: "body-too-large";
      /** What the server said it would send, when it said. */
      declared: number | null;
      /** How much was actually read before stopping. */
      read: number;
    };

/**
 * Read a response body, stopping at `limit`.
 *
 * Returns a typed refusal rather than throwing, so a caller can record
 * "body-too-large" as a fetch outcome the editor can see, instead of a generic
 * failure that looks like the site was down.
 */
export async function readBodyCapped(res: Response, limit: number): Promise<CappedRead> {
  const declaredRaw = res.headers.get("content-length");
  const declared = declaredRaw != null && /^\d+$/.test(declaredRaw) ? Number(declaredRaw) : null;

  // Cheap refusal: it told us it was too big, so never open the tap.
  if (declared != null && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "body-too-large", declared, read: 0 };
  }

  // 204s and HEADs have no body at all.
  if (!res.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      read += value.byteLength;
      if (read > limit) {
        // Stop the transfer rather than draining a hostile stream politely.
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "body-too-large", declared, read };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const bytes = new Uint8Array(read);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, bytes };
}

/** Which ceiling applies, from the URL and what the server claims it sent. */
export function limitFor(url: string, contentType: string): number {
  const isPdf = /\.pdf(\?|#|$)/i.test(url) || contentType.toLowerCase().includes("application/pdf");
  return isPdf ? BODY_LIMIT.pdf : BODY_LIMIT.html;
}

const READABLE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/xml",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/json",
  "text/event-stream",
  "text/csv",
  "application/pdf",
]);

export class FetchResponseRefusal extends Error {
  readonly status: number;
  readonly contentType: string;
  readonly url: string;
  redirectChain: string[];
  readonly reason: "refused-too-large" | "refused-content-type";
  constructor(
    message: string,
    reason: "refused-too-large" | "refused-content-type",
    res: Response,
    url: URL,
  ) {
    super(message);
    this.reason = reason;
    this.name = "FetchResponseRefusal";
    this.status = res.status;
    this.contentType = res.headers.get("content-type") ?? "";
    this.url = url.toString();
    this.redirectChain = [this.url];
  }
}

/** Apply the same limits before any consumer can buffer an outbound response.
 * Missing MIME is tolerated for older civic servers, with the byte ceiling still
 * enforced. An explicitly binary type is refused; octet-stream PDFs are allowed
 * only on a .pdf path. This validates declared formats, not the truth of a MIME label.
 */
export async function capFetchResponse(res: Response, url: URL): Promise<Response> {
  const init = { status: res.status, statusText: res.statusText, headers: res.headers };
  // Consumers use the status/Location, never error bodies as reporting evidence.
  // Preserve 429 so the Reddit scheduler can apply its cooldown before retrying.
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return new Response(null, init);
  }
  const mime = (res.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  const octetPdf = mime === "application/octet-stream" && /\.pdf$/i.test(url.pathname);
  if (mime && !READABLE_TYPES.has(mime) && !octetPdf) {
    await res.body?.cancel().catch(() => undefined);
    throw new FetchResponseRefusal(
      `Unsupported content type: ${mime}. This desk reads web pages, feeds, text and PDFs.`,
      "refused-content-type",
      res,
      url,
    );
  }
  const limit = limitFor(url.toString(), mime);
  const tooLarge = () =>
    new FetchResponseRefusal(
      `The response was larger than this desk will read (${limit} byte limit).`,
      "refused-too-large",
      res,
      url,
    );
  const declared = res.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) return res;
  const reader = res.body.getReader();
  let read = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            controller.close();
            return;
          }
          read += value.byteLength;
          if (read > limit) {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
            controller.error(tooLarge());
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, init);
}
