import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resolveFetch, setFetchImplForTests } from "./fetch-url.ts";
import { BODY_LIMIT } from "./body-limit.ts";
import { ingestDocument } from "./ingest.ts";

afterEach(() => setFetchImplForTests(null));

async function request(response: Response, path = "/page") {
  setFetchImplForTests(async () => response);
  return (await resolveFetch())(new URL(`https://1.1.1.1${path}`), {});
}

for (const declared of [null, "1", "invalid", String(BODY_LIMIT.html + 1)]) {
  test(`caps streaming response with content-length ${declared}`, async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(1_000_000));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const headers = new Headers({ "content-type": "text/html" });
    if (declared !== null) headers.set("content-length", declared);
    await assert.rejects(async () => {
      const response = await request(new Response(body, { headers }));
      // Explicitly stop the old unbounded implementation after six chunks.
      const reader = response.body!.getReader();
      for (let i = 0; i < 6; i++) await reader.read();
      await reader.cancel();
    }, /response.*larger|body.*limit/i);
    assert.equal(cancelled, true);
  });
}

test("rejects unsupported successful content before reading and cancels it", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    request(new Response(body, { headers: { "content-type": "image/png" } })),
    /Unsupported content type/,
  );
  assert.equal(cancelled, true);
});

test("discards redirect and error bodies while retaining routing and rate-limit status", async () => {
  for (const status of [302, 404, 429, 500]) {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const res = await request(
      new Response(body, {
        status,
        headers: { location: "/next", "content-type": "application/zip" },
      }),
    );
    assert.equal(res.status, status);
    assert.equal(res.headers.get("location"), "/next");
    assert.equal(res.body, null);
    assert.equal(cancelled, true);
  }
});

test("accepts supported newsroom formats and missing MIME without changing bytes", async () => {
  for (const mime of [
    "text/html; charset=utf-8",
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
    "",
  ]) {
    const bytes = new TextEncoder().encode("newsroom source");
    const response = await request(
      new Response(bytes, { headers: mime ? { "content-type": mime } : {} }),
    );
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes, mime);
  }
});

test("PDF uses existing larger cap; octet stream is only accepted at a PDF path", async () => {
  const bytes = new Uint8Array(BODY_LIMIT.html + 1);
  for (const mime of ["application/pdf", "application/octet-stream"]) {
    const response = await request(
      new Response(bytes, { headers: { "content-type": mime } }),
      "/packet.pdf",
    );
    assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
  }
  await assert.rejects(
    request(new Response(bytes, { headers: { "content-type": "application/octet-stream" } })),
    /Unsupported content type/,
  );
});

test("text limit is inclusive and missing MIME cannot bypass it", async () => {
  const exact = await request(new Response(new Uint8Array(BODY_LIMIT.html)));
  assert.equal((await exact.arrayBuffer()).byteLength, BODY_LIMIT.html);
  await assert.rejects(
    async () => (await request(new Response(new Uint8Array(BODY_LIMIT.html + 1)))).arrayBuffer(),
    /response.*larger|body.*limit/i,
  );
});

test("ingestion retains the explicit refusal reason, HTTP status and source identity", async () => {
  for (const [headers, method] of [
    [
      { "content-type": "text/html", "content-length": String(BODY_LIMIT.html + 1) },
      "refused-too-large",
    ],
    [{ "content-type": "image/png" }, "refused-content-type"],
  ] as const) {
    setFetchImplForTests(async () => new Response("unread", { headers }));
    const doc = await ingestDocument("https://1.1.1.1/page");
    assert.equal(doc.ok, false);
    assert.equal(doc.status, 200);
    assert.equal(doc.extractionMethod, method);
    assert.deepEqual(doc.redirectChain, ["https://1.1.1.1/page"]);
    assert.match(doc.text, /larger|Unsupported content type/);
  }
});

test("ingestion preserves every redirect on header and streamed refusals", async () => {
  for (const declared of [true, false]) {
    setFetchImplForTests(async (url) => {
      if (url.pathname !== "/final")
        return new Response(null, {
          status: 302,
          headers: { location: url.pathname === "/start" ? "/middle" : "/final" },
        });
      return new Response(new Uint8Array(BODY_LIMIT.html + 1), {
        headers: declared ? { "content-length": String(BODY_LIMIT.html + 1) } : {},
      });
    });
    const doc = await ingestDocument("https://1.1.1.1/start");
    assert.equal(doc.extractionMethod, "refused-too-large");
    assert.deepEqual(doc.redirectChain, [
      "https://1.1.1.1/start",
      "https://1.1.1.1/middle",
      "https://1.1.1.1/final",
    ]);
  }
});
