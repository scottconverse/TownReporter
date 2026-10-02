import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeExtractionMethod,
  chunksFromEvidence,
  discoverDocLinks,
  discoverStoryLinks,
  encodeOcrExtractionMethod,
  extractPdfBetter,
  extractPdfText,
  ingestDocument,
  ingestUrl,
  mapLimit,
  parseRssItems,
  setOcrImpl,
  withRetry,
} from "./ingest.ts";
import { setFetchImplForTests } from "./fetch-url.ts";
import { classifyRefusal, touchAfterFailure } from "./fetch-politeness.ts";

describe("PrimeGov API capture", () => {
  it("keeps the approved JSON endpoint on the raw-byte ingestion path", async () => {
    const raw = JSON.stringify([{ id: 3781, title: "Council", dateTime: "2026-09-11T18:00:00", location: "Chambers", documentList: [{ id: 1, templateId: 2, templateName: "Agenda" }] }]);
    setFetchImplForTests(async () => new Response(raw, { headers: { "content-type": "application/json" } }));
    try {
      const result = await ingestDocument("https://longmont.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings");
      assert.equal(result.rawBytes && new TextDecoder().decode(result.rawBytes), raw);
      assert.equal(result.extractionMethod, "heuristic");
    } finally {
      setFetchImplForTests(null);
    }
  });

  /*
    The portal's catalog, on its public page. Both halves of the read used to
    swallow their own failure (`.catch(() => [])`), so a 5xx, a timeout or a
    block produced "0 meetings on file" and `outcome: "fetched"` -- an outage
    recorded as a reading, and an empty catalog the rest of the desk could take
    as evidence that a meeting or a document does not exist.
  */
  const portal = "https://longmont.primegov.com/public/portal";
  const meetingRow = [
    { id: 3781, title: "City Council Regular Session", date: "2026-09-11", dateTime: "2026-09-11T18:00:00", location: "Chambers", documentList: [{ id: 1, templateId: 2, templateName: "Agenda" }] },
  ];

  it("records an unreachable portal as a failed read, never as an empty catalog", async () => {
    setFetchImplForTests(async () => new Response("gateway down", { status: 503 }));
    try {
      const result = await ingestDocument(portal);
      assert.equal(result.ok, false);
      assert.notEqual(result.outcome, "fetched");
      assert.equal(result.outcome, "fetch-failed");
      assert.equal(result.status, 503);
      assert.match(result.text, /503/, "the reason the read failed is recorded");
      assert.doesNotMatch(result.text, /0 meetings on file/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("records a portal timeout as a failure, not as an empty catalog", async () => {
    setFetchImplForTests(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    try {
      const result = await ingestDocument(portal);
      assert.equal(result.ok, false);
      assert.equal(result.outcome, "fetch-failed");
      assert.match(result.text, /timed out/, "the timeout is the recorded reason");
      assert.doesNotMatch(result.text, /0 meetings on file/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("keeps the list that answered, and says the catalog is partial", async () => {
    setFetchImplForTests(async (url) =>
      url.toString().includes("ListUpcomingMeetings")
        ? new Response(JSON.stringify(meetingRow), { headers: { "content-type": "application/json" } })
        : new Response("gateway down", { status: 503 }),
    );
    try {
      const result = await ingestDocument(portal);
      assert.equal(result.outcome, "fetched");
      assert.equal(result.ok, true);
      assert.match(result.text, /City Council Regular Session/, "the list that answered is kept");
      assert.match(result.text, /PARTIAL/);
      assert.match(result.text, /503/);
      assert.match(result.title, /^longmont\.primegov\.com /);
    } finally {
      setFetchImplForTests(null);
    }
  });
});

describe("ingestUrl HTML scanner path", () => {
  for (const contentType of [undefined, "application/json"]) {
    it(`preserves readable non-HTML responses with ${contentType ?? "no Content-Type"}`, async () => {
      const report = "Council will discuss the water contract Tuesday. Residents may comment in person. ".repeat(200);
      setFetchImplForTests(async () => new Response(new TextEncoder().encode(report), {
        headers: contentType ? { "content-type": contentType } : {},
      }));
      try {
        const result = await ingestUrl("https://93.184.216.34/report");
        assert.equal(result.text, report.trim().slice(0, 14000));
        assert.equal(result.text.length, 14000);
      } finally {
        setFetchImplForTests(null);
      }
    });
  }

  it("does not expand the existing unsupported content-type allowlist", async () => {
    setFetchImplForTests(async () => new Response("A sufficiently long markdown report that the fetch boundary does not accept.", {
      headers: { "content-type": "text/markdown" },
    }));
    try {
      await assert.rejects(() => ingestUrl("https://93.184.216.34/report"), /Unsupported content type/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("still extracts HTML navigation when its Content-Type is absent", async () => {
    const html = `<html><body><nav>${"Navigation menu item ".repeat(1000)}</nav><main><article><p>Council will discuss the water contract Tuesday. Residents may comment in person.</p></article></main></body></html>`;
    setFetchImplForTests(async () => new Response(new TextEncoder().encode(html)));
    try {
      const result = await ingestUrl("https://93.184.216.34/news");
      assert.match(result.text, /water contract Tuesday/);
      assert.doesNotMatch(result.text, /Navigation menu item/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("preserves text/plain reports without sending them through an HTML parser", async () => {
    const report = "Council will discuss the water contract Tuesday. Cost is < 500 dollars and attendance is open.\n\nResidents may comment.";
    setFetchImplForTests(async () => new Response(report, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }));
    try {
      const result = await ingestUrl("https://93.184.216.34/report.txt");
      assert.equal(result.text, report.replace(/\s+/g, " "));
      assert.equal(result.titleHint, "93.184.216.34");
      assert.deepEqual(result.extras, []);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("extracts dated news cards beyond a large navigation menu and keeps notices separate", async () => {
    // Reduced public news listing structure, with CMS navigation larger than
    // the scanner's text cap. Stub the real HTTP seam; no DNS/network/model.
    const html = `<html><head><title>News archive</title>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>
      <header><nav>${"Department services and information ".repeat(600)}</nav></header>
      <aside role="alert">City offices close Monday for scheduled maintenance.</aside>
      <main id="main-content" class="main h-header--mobile">
      <div>Email Signup<p>Sign up for our emails to receive the latest news and alerts.</p>Sign Up</div>
      <div>3018 results found</div><label>Sort news by</label>
      <div class="card-article"><a href="/news/clean-air/">Longmont Recognized as a Clean Air Champion</a><div>September 8, 2026</div></div>
      <div class="card-article"><a href="/news/cooling-parks/">New Cooling Features at Three City Parks</a><div>August 31, 2026</div></div>
      <div>Loading more news &amp; alerts...</div></main></body></html>`;
    let requests = 0;
    setFetchImplForTests(async () => {
      requests++;
      return new Response(html, { headers: { "content-type": "text/html" } });
    });
    try {
      const result = await ingestUrl("https://93.184.216.34/news/");
      assert.equal(requests, 1);
      assert.match(result.text, /Clean Air Champion/);
      assert.match(result.text, /September 8, 2026/);
      assert.match(result.text, /Cooling Features/);
      assert.doesNotMatch(result.text, /Department services/);
      assert.doesNotMatch(result.text, /City offices close/);
      assert.ok(result.notices?.some((notice) => notice.includes("City offices close Monday")));
      assert.ok(result.extras.includes("https://93.184.216.34/feed.xml"));
      assert.equal(result.titleHint, "News archive");
    } finally {
      setFetchImplForTests(null);
    }
  });
});

describe("extractPdfText", () => {
  it("pulls Tj strings from uncompressed civic packets", () => {
    const pdf = Buffer.from(
      "%PDF-1.4\nBT /F1 12 Tf (City Council voted 5-2 on the NextLight rate) Tj ET\n",
      "latin1",
    );
    assert.match(extractPdfText(pdf), /City Council voted 5-2 on the NextLight rate/);
  });
});

describe("extractPdfBetter", () => {
  it("lets a mechanical caller leave a scanned PDF for OCR without invoking a model", async () => {
    let ocrCalls = 0;
    setOcrImpl(async () => {
      ocrCalls += 1;
      return { text: "A model should never read this mechanical Pull fixture.", pages: [] };
    });
    setFetchImplForTests(async () =>
      new Response(new Uint8Array([0, 1, 2, 3, 4]), {
        headers: { "content-type": "application/pdf" },
      }),
    );
    try {
      const result = await ingestDocument("https://93.184.216.34/scanned.pdf", {
        allowModelOcr: false,
      });
      assert.equal(result.outcome, "needs-ocr");
      assert.equal(result.needsOcr, true);
      assert.equal(ocrCalls, 0);
    } finally {
      setFetchImplForTests(null);
      setOcrImpl(null);
    }
  });

  it("preserves the original Uint8Array for OCR after native parsing fails", async () => {
    const input = new Uint8Array([...Buffer.from("%PDF-invalid scanned image"), 1, 2, 3]);
    const expected = Uint8Array.from(input);
    let received = 0;
    await extractPdfBetter(input, async (bytes) => {
      received = bytes.byteLength;
      assert.deepEqual(bytes, expected);
      return {
        text: "A sufficiently long OCR transcription from the preserved original scan.",
        pages: [],
      };
    });
    assert.equal(received, expected.byteLength);
    assert.deepEqual(input, expected);
  });

  it("does not invent a page citation for regex-only PDF text", async () => {
    const extracted = await extractPdfBetter(
      Buffer.from(
        "%PDF-invalid\nBT (A complete unpaged council contract record with enough text for extraction.) Tj ET",
      ),
      null,
    );
    assert.equal(extracted.method, "tj-regex");
    assert.equal(chunksFromEvidence(extracted.text, extracted.pages)[0]?.page_number, null);
    assert.doesNotMatch(chunksFromEvidence(extracted.text, extracted.pages)[0]!.locator, /page:/);
  });

  it("prefers a real parser, then Tj regex, and flags scans that need OCR", async () => {
    const civic = Buffer.from(
      "%PDF-1.4\nBT /F1 12 Tf (City Council voted 5-2 on the NextLight rate) Tj ET\n",
      "latin1",
    );
    const ok = await extractPdfBetter(civic);
    assert.ok(ok.method === "unpdf" || ok.method === "tj-regex", ok.method);
    assert.equal(ok.needsOcr, false);
    assert.match(ok.text, /NextLight rate/);

    const empty = await extractPdfBetter(new Uint8Array([0, 1, 2, 3, 4]));
    assert.equal(empty.needsOcr, true);
    assert.equal(empty.method, "none");
  });

  it("runs injectable OCR only when native extraction is unusable", async () => {
    const scanned = await extractPdfBetter(new Uint8Array([0, 1, 2, 3, 4]), async () => ({
      text: "OCR recovered the scanned council packet award",
      pages: [
        { page: 1, text: "OCR recovered the scanned council packet award", confidence: 0.88 },
      ],
    }));
    assert.equal(scanned.method, "ocr");
    assert.equal(scanned.needsOcr, false);
    assert.match(scanned.text, /scanned council packet/);
    assert.equal(scanned.pages[0]?.page, 1);
  });

  it("carries the OCR provider and page counts through to the extract", async () => {
    const scanned = await extractPdfBetter(new Uint8Array([0, 1, 2, 3, 4]), async () => ({
      text: "OCR recovered the scanned council packet award",
      pages: [{ page: 1, text: "OCR recovered the scanned council packet award" }],
      provider: "Claude",
      pagesRead: 1,
      pagesTotal: 3,
    }));
    assert.equal(scanned.ocrProvider, "Claude");
    assert.equal(scanned.ocrPagesRead, 1);
    assert.equal(scanned.ocrPagesTotal, 3);
  });

  it("keeps a successful but incomplete page OCR explicit for persistence", async () => {
    const scanned = await extractPdfBetter(new Uint8Array([0, 1, 2, 3, 4]), async () => ({
      text: "OCR recovered the first page of a longer scanned council packet.",
      pages: [{ page: 1, text: "OCR recovered the first page of a longer scanned council packet." }],
      provider: "Claude",
      pagesRead: 1,
      pagesTotal: 3,
      reason: "OCR incomplete: pages 2-3 were not attempted (page limit).",
    }));
    assert.equal(scanned.method, "ocr");
    assert.equal(scanned.ocrIncompleteReason, "OCR incomplete: pages 2-3 were not attempted (page limit).");
  });

  it("stays needs-ocr, with the honest reason, below the 40-character floor", async () => {
    const scanned = await extractPdfBetter(new Uint8Array([0, 1, 2, 3, 4]), async () => ({
      text: "",
      pages: [],
      reason:
        "the chosen local model cannot read images — pick a vision model (marked · vision in the picker).",
    }));
    assert.equal(scanned.needsOcr, true);
    assert.equal(scanned.method, "none");
    assert.match(scanned.needsOcrReason ?? "", /vision model/);
  });
});

describe("encodeOcrExtractionMethod / describeExtractionMethod", () => {
  it("round-trips a stored OCR extraction method into the editor-facing sentence", () => {
    const stored = encodeOcrExtractionMethod("Claude", 3, 5);
    assert.equal(stored, "ocr:Claude:3/5");
    assert.equal(
      describeExtractionMethod(stored),
      "Read by OCR · Claude · 3 of 5 extracted images · PDF page order not established",
    );
  });

  it("labels page-aware partial OCR without changing legacy image labels", () => {
    assert.equal(
      describeExtractionMethod("ocr-pages-partial:Claude:1/3"),
      "Read by OCR · Claude · 1 of 3 PDF pages · incomplete",
    );
    assert.equal(
      describeExtractionMethod("ocr:Claude:1/3"),
      "Read by OCR · Claude · 1 of 3 extracted images · PDF page order not established",
    );
  });

  it("defaults a missing provider/page count without throwing", () => {
    const stored = encodeOcrExtractionMethod(undefined, undefined, undefined);
    assert.equal(stored, "ocr:unknown:0/0");
    assert.equal(
      describeExtractionMethod(stored),
      "Read by OCR · unknown · 0 of 0 extracted images · PDF page order not established",
    );
  });

  it("passes a non-OCR method through unchanged", () => {
    assert.equal(describeExtractionMethod("unpdf"), "unpdf");
    assert.equal(describeExtractionMethod("readability"), "readability");
  });

  it("says a blank or 'none' method plainly", () => {
    assert.equal(describeExtractionMethod(""), "Not read yet.");
    assert.equal(describeExtractionMethod("none"), "Not read yet.");
    assert.equal(describeExtractionMethod(null), "Not read yet.");
  });

  it("says a stored needs-ocr reason in words", () => {
    assert.equal(
      describeExtractionMethod("needs-ocr:the chosen local model cannot read images"),
      "Scanned PDF — not readable yet: the chosen local model cannot read images",
    );
    // No reason recorded (OCR never attempted) -- still honest, no dangling colon.
    assert.equal(describeExtractionMethod("needs-ocr:"), "Scanned PDF — not readable yet");
  });
});

describe("discoverDocLinks", () => {
  it("follows public agenda/pdf links across origins and drops javascript", () => {
    const html = [
      '<a href="/government/agendas/packet.pdf">packet</a>',
      '<a href="https://civicclerk.example/agenda.pdf">vendor packet</a>',
      '<a href="javascript:alert(1)">no</a>',
      '<a href="/about">no</a>',
      '<a href="minutes.html">minutes</a>',
    ].join("");
    const found = discoverDocLinks(html, new URL("https://www.longmontcolorado.gov/gov"));
    assert.ok(found.includes("https://www.longmontcolorado.gov/government/agendas/packet.pdf"));
    assert.ok(found.includes("https://www.longmontcolorado.gov/minutes.html"));
    assert.ok(found.includes("https://civicclerk.example/agenda.pdf"));
    assert.equal(
      found.some((u) => u.startsWith("javascript:")),
      false,
    );
  });
});

describe("discoverStoryLinks", () => {
  it("picks same-host article URLs off a Leader listing and skips the section index", () => {
    const story =
      "/local-news/why-longmont-cant-simply-ban-noisy-airplanes-at-vance-brand-airport-123";
    const html = [
      '<a href="/local-news">Local news</a>',
      `<a href="${story}">Why Longmont Can't Simply Ban Noisy Airplanes</a>`,
      '<a href="https://www.timescall.com/2026/08/other-longmont-airport-noise-story">no</a>',
      '<a href="/about">About</a>',
      '<a href="javascript:void(0)">no</a>',
    ].join("");
    const found = discoverStoryLinks(html, new URL("https://www.longmontleader.com/local-news"));
    assert.ok(
      found.some((u) => u.includes("why-longmont-cant-simply-ban-noisy-airplanes")),
      found.join(" "),
    );
    assert.equal(
      found.some((u) => u === "https://www.longmontleader.com/local-news"),
      false,
    );
    assert.equal(
      found.some((u) => u.includes("timescall.com")),
      false,
    );
  });
});

describe("parseRssItems", () => {
  it("reads rss item title, link, summary", () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>Budget hearing</title>
          <link>https://www.longmontcolorado.gov/b</link>
          <description>Council will take public comment.</description>
        </item>
      </channel></rss>`;
    const items = parseRssItems(xml);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.title, "Budget hearing");
    assert.equal(items[0]!.link, "https://www.longmontcolorado.gov/b");
    assert.match(items[0]!.summary, /public comment/);
  });
});

describe("mapLimit", () => {
  it("runs with a concurrency cap and preserves order", async () => {
    let inflight = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight -= 1;
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.ok(max <= 2);
  });
});

describe("withRetry", () => {
  it("does not retry SSRF / invalid URL", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withRetry(async () => {
          n += 1;
          throw new Error("That host is not fetchable");
        }),
      /not fetchable/,
    );
    assert.equal(n, 1);
  });

  it("retries a transient failure once", async () => {
    let n = 0;
    const v = await withRetry(async () => {
      n += 1;
      if (n === 1) throw new Error("fetch failed (503)");
      return "ok";
    });
    assert.equal(v, "ok");
    assert.equal(n, 2);
  });
});

/*
  SH-B item 2: a refusal that was aimed at us is not retried.

  The rule the owner asked for is "be polite and act like a human", and the one
  place the desk was not was here: `withRetry`'s flat 400 ms second attempt ran
  for every failure, including a 429 -- so a site that said "come back later"
  got asked again before a person could have read the sentence, and the desk
  recorded the site as broken. One request, then stop and record the wait.

  The status and `Retry-After` survive the throw as well, because the scan has
  to be able to tell "asked us to wait" from "blocked us" -- the two go on the
  row as different sentences and different next-try times.
*/
describe("politeness: a refusal aimed at us is not hammered", () => {
  const url = "https://example.com/news";

  it("asks a 429ing host exactly once", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls += 1;
      return new Response("Too many requests", { status: 429 });
    });
    try {
      await assert.rejects(
        () => withRetry(() => ingestUrl(url)),
        /Fetch failed \(429\)/,
      );
      assert.equal(calls, 1, "the second ask is the one that gets us blocked");
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("carries the status and the site's Retry-After out of the fetch", async () => {
    setFetchImplForTests(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } }),
    );
    try {
      const err = await ingestUrl(url).then(
        () => null,
        (e: unknown) => e as { status?: number; retryAfterMs?: number | null },
      );
      assert.equal(err?.status, 429);
      assert.equal(err?.retryAfterMs, 120_000);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("asks a 403ing host exactly once too", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls += 1;
      return new Response("Access Denied", { status: 403 });
    });
    try {
      await assert.rejects(
        () => withRetry(() => ingestUrl(url)),
        /Fetch failed \(403\)/,
      );
      assert.equal(calls, 1);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("still retries a 503 once -- a bad moment is not a rate limit", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls += 1;
      return new Response("gateway down", { status: 503 });
    });
    try {
      await assert.rejects(
        () => withRetry(() => ingestUrl(url)),
        /Fetch failed \(503\)/,
      );
      assert.equal(calls, 2);
    } finally {
      setFetchImplForTests(null);
    }
  });

  /*
    A STATUS IS NOT THE WHOLE ANSWER. A bare 503 is a server that had a bad
    moment and the single extra ask above is worth keeping. A 503 that came
    with `Retry-After` is not that: it is the server TELLING us when to come
    back, and a 400 ms second ask contradicts the one thing it actually said.

    The second request is what loses the wait. Here it SUCCEEDS, so under the
    old rule `withRetry` returned the page and threw nothing -- the 120 seconds
    the site asked for were never recorded anywhere, the source was written as
    a read, and the desk went on treating a host that had just asked for two
    minutes as a host that was fine.
  */
  it("does not retry a 503 that named a wait, so the wait reaches the row", async () => {
    let calls = 0;
    setFetchImplForTests(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("busy", { status: 503, headers: { "retry-after": "120" } });
      }
      return new Response("<html><body><p>ok</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    try {
      const err = await withRetry(() => ingestUrl(url)).then(
        () => null,
        (e: unknown) => e as { status?: number; retryAfterMs?: number | null },
      );
      assert.equal(calls, 1, "the site named a wait and was asked again 400 ms later anyway");
      assert.equal(err?.status, 503, "the 503 was swallowed by a retry that succeeded");
      assert.equal(err?.retryAfterMs, 120_000, "the wait the site named did not survive the throw");

      /* And what the scan does with it: the source row is parked until then,
         with the sentence that says the SITE asked rather than the desk. */
      const refusal = classifyRefusal({ status: err?.status, retryAfterMs: err?.retryAfterMs ?? null, nowMs: 0 });
      assert.ok(refusal, "a 503 with a named wait is not a refusal the desk has a rule for");
      const touch = touchAfterFailure({ refusal, nowMs: 0 });
      assert.equal(touch.outcome, "wait");
      assert.equal(touch.retry_after?.getTime(), 120_000, "the row was not parked for the wait the site asked for");
      assert.match(touch.retry_after_note ?? "", /^Asked us to come back at /);
      assert.equal(touch.last_error, null, "a site that asked us to wait was written as a failure");
    } finally {
      setFetchImplForTests(null);
    }
  });
});
