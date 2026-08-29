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
  const isPdf =
    /\.pdf(\?|#|$)/i.test(url) || contentType.toLowerCase().includes("application/pdf");
  return isPdf ? BODY_LIMIT.pdf : BODY_LIMIT.html;
}
