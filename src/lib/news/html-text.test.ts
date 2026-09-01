import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { htmlToPlainText, readableCapture } from "./html-text.ts";

describe("htmlToPlainText", () => {
  it("turns a page into sentences, not tags", () => {
    const html = `<!DOCTYPE html><html><head><title>Council vote</title><style>body{color:red}</style></head>
      <body><h1>Council vote</h1><p>The board approved the merger 5–2.</p><script>alert(1)</script></body></html>`;
    const text = htmlToPlainText(html);
    assert.doesNotMatch(text, /<html|<style|DOCTYPE|alert/i);
    assert.match(text, /Council vote/);
    assert.match(text, /approved the merger/);
  });
});

describe("readableCapture", () => {
  it("does not present a 429 HTML body as the article", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>429 Too Many Requests</title></head>
      <body>Too Many Requests</body></html>`;
    const r = readableCapture({ text: html, status: 429, title: "coloradosun.com" });
    assert.equal(r.kind, "blocked");
    assert.equal(r.body, "");
    assert.match(r.note!, /too many requests/i);
    assert.doesNotMatch(r.note!, /DOCTYPE/i);
  });

  it("strips leftover HTML on an otherwise good capture", () => {
    const html = `<article><h1>BVSD closure</h1><p>The school board meets Sept. 22 on the closure recommendations.</p></article>`;
    const r = readableCapture({ text: html, status: 200, outcome: "fetched", title: "BVSD closure" });
    assert.equal(r.kind, "ok");
    assert.match(r.body, /school board meets Sept\. 22/);
    assert.doesNotMatch(r.body, /<article/);
  });
});
