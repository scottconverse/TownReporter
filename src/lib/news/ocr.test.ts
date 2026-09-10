import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractEmbeddedJpegs,
  extractEmbeddedPngs,
  extractEmbeddedPageImages,
  OCR_TOTAL_BUDGET_MS,
  productionOcr,
  renderPdfPages,
} from "./ocr.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import { resetLocalDiscoveryReachableForTests } from "./provider-registry.ts";
import { resetClaudeCliCache } from "./ai-claude-code.server.ts";
import { chunksFromEvidence, describeExtractionMethod } from "./ingest.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FAKE_CLAUDE = join(ROOT, "scripts/fakes/fake-claude-cli.mjs");

function fakeJpeg(bytes = 5000): Uint8Array {
  const buf = new Uint8Array(bytes);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[bytes - 2] = 0xff;
  buf[bytes - 1] = 0xd9;
  return buf;
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** A minimal, structurally valid PNG (chunk lengths correct; CRCs are not checked by this desk). */
function fakePng(dataSize = 4000): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [
    ...u32be(13),
    ...Buffer.from("IHDR"),
    ...new Array(13).fill(0),
    ...new Array(4).fill(0),
  ];
  const idat = [
    ...u32be(dataSize),
    ...Buffer.from("IDAT"),
    ...new Array(dataSize).fill(1),
    ...new Array(4).fill(0),
  ];
  const iend = [...u32be(0), ...Buffer.from("IEND"), ...new Array(4).fill(0)];
  return new Uint8Array([...sig, ...ihdr, ...idat, ...iend]);
}

/** Real vector PDFs with no text layer; the renderer must preserve their page order. */
function blankPagePdf(pageCount: number): Uint8Array {
  const pageObjectStart = 3;
  const contentsObjectStart = pageObjectStart + pageCount;
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${pageObjectStart + i} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents ${contentsObjectStart + i} 0 R >>`,
    ),
    ...Array.from({ length: pageCount }, (_, i) => {
      const stream = `${i % 2} 0 ${1 - (i % 2)} rg 0 0 72 72 re f\n`;
      return `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`;
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function twoBlankPagePdf(): Uint8Array {
  return blankPagePdf(2);
}

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "TOWNREPORTER_CODEX",
  "TOWNREPORTER_CLAUDE_CODE",
  "CODEX_CLI_PATH",
  "CLAUDE_CLI_PATH",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "LLM_API_KEY",
  "TOWNREPORTER_LOCAL_DISCOVERY",
  "FAKE_CLAUDE_SIGNED_IN",
];

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  return fn().finally(() => {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

describe("extractEmbeddedJpegs", () => {
  it("pulls JPEG streams out of a scanned-looking PDF buffer", () => {
    const jpeg = fakeJpeg(4500);
    const pdf = new Uint8Array(80 + jpeg.byteLength);
    pdf.set(Buffer.from("%PDF-1.4 scan "), 0);
    pdf.set(jpeg, 16);
    const found = extractEmbeddedJpegs(pdf);
    assert.equal(found.length, 1);
    assert.ok(found[0]!.byteLength >= 4000);
    assert.equal(found[0]![0], 0xff);
    assert.equal(found[0]![1], 0xd8);
  });

  it("ignores tiny JPEG-like noise under the size floor", () => {
    const tiny = fakeJpeg(200);
    assert.equal(extractEmbeddedJpegs(tiny).length, 0);
  });

  it("finds two embedded JPEGs and honours the cap", () => {
    const j1 = fakeJpeg(4200);
    const j2 = fakeJpeg(4400);
    const pdf = new Uint8Array(20 + j1.byteLength + 20 + j2.byteLength);
    pdf.set(Buffer.from("%PDF-1.4 scan "), 0);
    pdf.set(j1, 20);
    pdf.set(j2, 20 + j1.byteLength + 20);
    assert.equal(extractEmbeddedJpegs(pdf).length, 2);
    assert.equal(extractEmbeddedJpegs(pdf, 1).length, 1);
  });
});

describe("extractEmbeddedPngs / extractEmbeddedPageImages", () => {
  it("pulls an embedded PNG page image out of a PDF", () => {
    const png = fakePng(4200);
    const pdf = new Uint8Array(20 + png.byteLength);
    pdf.set(Buffer.from("%PDF-1.4 scan "), 0);
    pdf.set(png, 20);
    const found = extractEmbeddedPngs(pdf);
    assert.equal(found.length, 1);
    assert.equal(found[0]![0], 0x89);
    assert.equal(found[0]![1], 0x50);
  });

  it("combines JPEGs and PNGs up to the shared cap", () => {
    const jpeg = fakeJpeg(4200);
    const png = fakePng(4200);
    const pdf = new Uint8Array(20 + jpeg.byteLength + 20 + png.byteLength);
    pdf.set(Buffer.from("%PDF-1.4 scan "), 0);
    pdf.set(jpeg, 20);
    pdf.set(png, 20 + jpeg.byteLength + 20);
    const images = extractEmbeddedPageImages(pdf, 12);
    assert.equal(images.length, 2);
    assert.equal(images[0]!.mime, "image/jpeg");
    assert.equal(images[1]!.mime, "image/png");
    assert.equal(extractEmbeddedPageImages(pdf, 1).length, 1);
  });
});

describe("productionOcr", () => {
  beforeEach(() => {
    resetLocalCatalogCacheForTests();
    resetLocalDiscoveryReachableForTests();
    resetClaudeCliCache();
  });
  afterEach(() => {
    resetLocalCatalogCacheForTests();
    resetLocalDiscoveryReachableForTests();
    resetClaudeCliCache();
  });

  it("keeps legacy embedded image labels unpaged", () => {
    const pdf = new Uint8Array([...fakePng(), ...fakeJpeg()]);
    const images = extractEmbeddedPageImages(pdf);
    assert.equal(images.length, 2);
    const chunks = chunksFromEvidence("", [
      { page: null, imageIndex: 1, text: "first legacy image" },
      { page: null, imageIndex: 2, text: "second legacy image" },
    ]);
    assert.deepEqual(
      chunks.map((c) => c.page_number),
      [null, null],
    );
    assert.deepEqual(
      chunks.map((c) => c.locator),
      ["image:1", "image:2"],
    );
    assert.match(describeExtractionMethod("ocr:Claude:2/2"), /2 of 2 extracted images/);
    assert.doesNotMatch(describeExtractionMethod("ocr:Claude:2/2"), /2 of 2 pages/);
    // Actual page associations from native PDF extraction still stay pages.
    assert.equal(
      chunksFromEvidence("text", [{ page: 7, text: "native page" }])[0]?.locator,
      "page:7",
    );
  });

  it("gives an honest reason when a PDF cannot be rendered", async () => {
    const noImages = new Uint8Array([...Buffer.from("%PDF-1.4\n"), 1, 2, 3, 4, 5]);
    const result = await withEnv({}, () => productionOcr(noImages));
    assert.equal(result.text, "");
    assert.equal(result.pages.length, 0);
    assert.match(result.reason ?? "", /could not be rendered/);
  });

  it("renders a real textless two-page PDF in PDF page order for citation", async () => {
    let call = 0;
    const renderedColors: number[][] = [];
    const result = await withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () =>
      productionOcr(twoBlankPagePdf(), {
        adapters: {
          anthropic: async (image) => {
            const { createCanvas, loadImage } = await import("@napi-rs/canvas");
            const decoded = await loadImage(Buffer.from(image.bytes));
            const canvas = createCanvas(1, 1);
            const context = canvas.getContext("2d");
            context.drawImage(decoded, 0, 0, 1, 1);
            renderedColors.push([...context.getImageData(0, 0, 1, 1).data]);
            call += 1;
            return `Rendered PDF page ${call} is readable.`;
          },
        },
      }),
    );
    assert.deepEqual(
      result.pages.map((page) => page.page),
      [1, 2],
    );
    assert.deepEqual(
      chunksFromEvidence(result.text, result.pages).map((chunk) => chunk.locator),
      ["page:1", "page:2"],
    );
    assert.deepEqual(renderedColors, [
      [0, 0, 255, 255],
      [255, 0, 0, 255],
    ]);
  });

  it("marks a rendered PDF over the page cap as incomplete instead of complete", async () => {
    const result = await withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () =>
      productionOcr(blankPagePdf(13), {
        adapters: { anthropic: async () => "Readable scanned packet page text for the test." },
      }),
    );
    assert.equal(result.pagesRead, 12);
    assert.equal(result.pagesTotal, 13);
    assert.match(result.reason ?? "", /pages 13-13 were not attempted \(page limit\)/);
  });

  it("renders only an editor-requested later PDF page range", async () => {
    const result = await withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () =>
      productionOcr(blankPagePdf(14), {
        pageRange: { start: 13, end: 14 },
        adapters: { anthropic: async () => "Readable requested PDF page text for the test." },
      }),
    );
    assert.deepEqual(result.pages.map((page) => page.page), [13, 14]);
    assert.equal(result.pagesRead, 2);
    assert.equal(result.pagesTotal, 14);
    assert.doesNotMatch(result.reason ?? "", /page limit/);
  });

  it("does not start page rendering after the whole-document budget expires", async () => {
    const result = await renderPdfPages(twoBlankPagePdf(), Date.now() - OCR_TOTAL_BUDGET_MS);
    assert.equal(result.images.length, 0);
    assert.match(result.reason ?? "", /pages 1-2 were not attempted \(time limit\)/);
  });

  it("reads images through a mocked Anthropic client and reports who read how many", async () => {
    const pdf = blankPagePdf(1);

    const result = await withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () =>
      productionOcr(pdf, {
        adapters: { anthropic: async () => "City Council voted 5-2 on the NextLight rate." },
      }),
    );
    assert.equal(result.provider, "Claude");
    assert.equal(result.pagesRead, 1);
    assert.equal(result.pagesTotal, 1);
    assert.match(result.text, /NextLight rate/);
    assert.equal(result.pages[0]?.page, 1);
    assert.equal(result.pages[0]?.imageIndex, undefined);
  });

  it("concatenates multiple rendered pages in PDF order", async () => {
    const pdf = twoBlankPagePdf();

    let call = 0;
    const result = await withEnv({ ANTHROPIC_API_KEY: "sk-ant-test" }, () =>
      productionOcr(pdf, {
        adapters: {
          anthropic: async () => {
            call += 1;
            return call === 1 ? "Page one text." : "Page two text.";
          },
        },
      }),
    );
    assert.equal(result.pagesRead, 2);
    assert.equal(result.pagesTotal, 2);
    assert.match(result.text, /Page one text\.[\s\S]*Page two text\./);
  });

  it("refuses a non-vision local model with the exact editor-facing reason", async () => {
    const pdf = blankPagePdf(1);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url === "http://127.0.0.1:9500/v1/models") {
        return new Response(JSON.stringify({ data: [{ id: "plain-chat-model" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    }) as typeof fetch;

    try {
      const result = await withEnv({ LLM_BASE_URL: "http://127.0.0.1:9500/v1" }, () =>
        productionOcr(pdf, { provider: "local-model" }),
      );
      assert.equal(result.text, "");
      assert.equal(
        result.reason,
        "the chosen local model cannot read images — pick a vision model (marked · vision in the picker).",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("says plainly when the chosen provider cannot read images at all", async () => {
    const pdf = blankPagePdf(1);

    // "configured" is the internal gateway id (an `openai`-kind entry never
    // offered a vision path) -- reaches the final "cannot read images"
    // branch deterministically, with no CLI or local-server probing at all.
    const result = await withEnv({}, () => productionOcr(pdf, { provider: "configured" }));
    assert.equal(result.text, "");
    assert.match(result.reason ?? "", /cannot read images/);
  });

  it("reads a page through the Claude Code CLI path and filters self-referential narration", async () => {
    const pdf = blankPagePdf(1);

    const result = await withEnv({ CLAUDE_CLI_PATH: FAKE_CLAUDE, FAKE_CLAUDE_SIGNED_IN: "1" }, () =>
      productionOcr(pdf, {
        provider: "claude-frontier",
        adapters: {
          "claude-code": async () =>
            [
              "City water rates rose 5% this quarter.",
              "This hop directly invoked the WebFetch tool against two distinct hosts.",
              "The nitrate level tested at 0.4 mg/L.",
            ].join("\n"),
        },
      }),
    );
    assert.equal(result.provider, "Claude");
    assert.equal(result.pagesRead, 1);
    assert.match(result.text, /water rates rose 5%/);
    assert.match(result.text, /nitrate level tested/);
    assert.doesNotMatch(result.text, /WebFetch/);
  });
});
