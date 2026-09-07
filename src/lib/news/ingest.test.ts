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
  mapLimit,
  parseRssItems,
  withRetry,
} from "./ingest.ts";

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
