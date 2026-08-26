import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractEmbeddedJpegs } from "./ocr.ts";

function fakeJpeg(bytes = 5000): Uint8Array {
  const buf = new Uint8Array(bytes);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[bytes - 2] = 0xff;
  buf[bytes - 1] = 0xd9;
  return buf;
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
});
