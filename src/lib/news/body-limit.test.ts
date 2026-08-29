import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BODY_LIMIT, readBodyCapped } from "./body-limit.ts";

/**
 * How much of a stranger's response we are willing to hold in memory.
 *
 * The desk fetches URLs it discovered, from sites it does not control. Both
 * ingest paths called `res.arrayBuffer()` with no ceiling — and one of them did
 * it *before* checking `res.ok`, so a hostile error page was fully allocated
 * too. Text was truncated to 14,000 characters afterwards, which is protection
 * for the parser and none at all for the heap.
 *
 * The SSRF guard decides *where* we may connect. It says nothing about how
 * many bytes are safe to accept once connected. One URL, chosen by an editor
 * or discovered mid-investigation, could exhaust the worker.
 */

/** A Response whose body arrives in chunks, like a real one. */
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

const chunk = (n: number) => new Uint8Array(n).fill(65);

describe("capped body reads", () => {
  it("reads a normal body whole", async () => {
    const res = streamed([chunk(1000), chunk(500)]);
    const out = await readBodyCapped(res, BODY_LIMIT.html);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.bytes.length, 1500);
  });

  /**
   * The cheap check: a declared size over the ceiling is refused before a
   * single byte is read.
   */
  it("refuses an oversized declared length without reading the body", async () => {
    const res = streamed([chunk(10)], { "content-length": String(BODY_LIMIT.html + 1) });
    const out = await readBodyCapped(res, BODY_LIMIT.html);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.reason, "body-too-large");
    assert.equal(out.read, 0, "nothing should have been read");
  });

  /**
   * The one that matters: no Content-Length at all, bytes just keep coming.
   * A declared-size check alone would sail straight past this.
   */
  it("aborts a chunked body with no declared length once it crosses the ceiling", async () => {
    const big = Array.from({ length: 40 }, () => chunk(200_000)); // 8 MB
    const res = streamed(big);
    const out = await readBodyCapped(res, 1_000_000);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.reason, "body-too-large");
    assert.ok(out.read <= 1_000_000 + 200_000, `read ${out.read} — should stop near the ceiling`);
  });

  /** A 404's body is still a body. It was being buffered before the status check. */
  it("caps an error response too", async () => {
    const big = Array.from({ length: 20 }, () => chunk(200_000));
    const res = streamed(big, {}, 404);
    const out = await readBodyCapped(res, 500_000);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.reason, "body-too-large");
  });

  it("gives PDFs their own, larger ceiling", () => {
    assert.ok(BODY_LIMIT.pdf > BODY_LIMIT.html, "a packet PDF is legitimately bigger than a page");
    assert.ok(BODY_LIMIT.html >= 2_000_000, "a real civic page must still fit");
  });

  it("survives a body that is already gone", async () => {
    const res = new Response(null, { status: 204 });
    const out = await readBodyCapped(res, BODY_LIMIT.html);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.bytes.length, 0);
  });
});
