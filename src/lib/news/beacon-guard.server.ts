/*
  The two bounds every public beacon sits behind: a body cap and a rate cap.

  WHAT PROBLEM THIS IS. `/api/view` and `/api/read` are unauthenticated by
  design -- there is nothing to authenticate with, which is the point of the
  whole Stats design -- and until this unit neither had a limit of any kind.
  The repo's own audit records the shape of it at
  artifacts/audit-townreporter-2026-08-29/01-engineering-deepdive.md:792: "None
  of these has a rate limit -- `assertRate` is only applied to desk actions."
  `assertRate` (src/lib/news/ops.ts) keys its counter on a `userId`, so it
  cannot be used here at all: a public beacon has no user to key on.

  THE HARM, STATED EXACTLY. It is volume, not content -- a beacon can only
  increment a bucket for a real published story (src/lib/news/views.ts) or
  write one of eight fixed class words (src/lib/news/reading.server.ts), so
  nothing a caller sends can put a value of its choosing into a table. What an
  unbounded flood can do is inflate every number an editor reads and grow the
  tables without limit.

  WHY THE RATE CAP HAS NO KEY. The obvious limiter is per-IP. It is the wrong
  one here: keying on an address means reading, holding and comparing an
  address, which is exactly the per-person handle this page exists to avoid,
  and it would need a store that outlives the request. A single bucket shared
  by every caller bounds the harm above without knowing anything about who is
  calling. The cost is that one noisy client can exhaust the budget for
  everyone -- for a small paper's traffic that is a far smaller problem than
  the one it replaces, and the budget is set an order of magnitude above real
  use.

  WHY THE BODY CAP DOES NOT READ `content-length`. Consulting the header would
  be an optimisation (refuse without reading), but it would also put a sixth
  name into a request-header contract that is deliberately five names long, and
  it would still need the streaming check below to cover a chunked body that
  lies. So the cap is enforced by counting bytes as they arrive and cancelling
  the stream the moment it goes over. The body is never buffered past the cap,
  which is the property the test asserts -- and no header is read to get it.

  Both bounds answer 204 and write nothing, like every other refusal on this
  path: a bound is not allowed to become a way for a reader's page to see an
  error, and a caller must not be able to tell a capped beacon from a working
  one.
*/

import {
  BEACON_BODY_LIMIT_BYTES,
  BEACON_RATE_BURST,
  BEACON_RATE_PER_SECOND,
} from "./stats-privacy.ts";

const BUCKET_KEY = "__trBeaconTokenBucket__";

type Bucket = { tokens: number; at: number };

function holder(): Record<string, Bucket | undefined> {
  return globalThis as unknown as Record<string, Bucket | undefined>;
}

/**
 * One token from the process-wide bucket, or false when the budget is spent.
 *
 * On `globalThis` for the same reason src/lib/news/reading-live.ts is: a Vite
 * HMR pass re-evaluates the module, and module scope would hand the new copy a
 * full bucket while the old copy's spent one was still live.
 */
export function takeBeaconToken(now: number = Date.now()): boolean {
  const store = holder();
  let bucket = store[BUCKET_KEY];
  if (!bucket) {
    bucket = { tokens: BEACON_RATE_BURST, at: now };
    store[BUCKET_KEY] = bucket;
  }
  // Clock jumps: a backwards jump must not mint tokens (hence the clamp at
  // zero), and a large forwards jump must not exceed the burst.
  const elapsedSeconds = Math.max(0, now - bucket.at) / 1000;
  bucket.at = now;
  bucket.tokens = Math.min(BEACON_RATE_BURST, bucket.tokens + elapsedSeconds * BEACON_RATE_PER_SECOND);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * The request body as text, or null when it is over the cap or cannot be read.
 *
 * Null is a refusal, never a partial body: a caller that gets null writes
 * nothing at all. A body with no stream at all (a synthetic request in a test)
 * is read through `text()` and then measured, which is the same rule applied
 * one step later.
 */
export async function readBeaconBody(request: Request): Promise<string | null> {
  const stream = request.body;
  if (!stream || typeof stream.getReader !== "function") {
    if (typeof request.text !== "function") return null;
    try {
      const text = await request.text();
      return byteLength(text) > BEACON_BODY_LIMIT_BYTES ? null : text;
    } catch {
      return null;
    }
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > BEACON_BODY_LIMIT_BYTES) {
        // Over the cap: stop reading, free the stream, write nothing.
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return new TextDecoder().decode(concat(chunks, total));
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * The parsed beacon body, or undefined for anything this endpoint will not
 * read: over the cap, unreadable, or not JSON. undefined is the one refusal
 * every caller already handles, and the answer is 204 either way.
 */
export async function readBeaconJson(request: Request): Promise<unknown> {
  const text = await readBeaconBody(request);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Tests only: refill the bucket, so one case cannot starve the next. */
export function resetBeaconBucket(): void {
  delete holder()[BUCKET_KEY];
}

/**
 * Tests only: how many tokens are left, so a case can prove the budget drains
 * and refills without spending it by guessing.
 */
export function beaconBucketTokens(now: number = Date.now()): number {
  const bucket = holder()[BUCKET_KEY];
  if (!bucket) return BEACON_RATE_BURST;
  const elapsedSeconds = Math.max(0, now - bucket.at) / 1000;
  return Math.min(BEACON_RATE_BURST, bucket.tokens + elapsedSeconds * BEACON_RATE_PER_SECOND);
}
