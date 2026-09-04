import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { captureBatchStats, htmlToPlainText, readableCapture } from "./html-text.ts";

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

describe("captureBatchStats (Dark Desk F6 — real-vs-blocked counts)", () => {
  it("counts a mixed batch as readable vs blocked, not one raw total", () => {
    const stats = captureBatchStats([
      { text: "The council approved the rezoning on a 5-2 vote.", status: 200, outcome: "fetched" },
      { text: "<html><body>Too Many Requests</body></html>", status: 429 },
      { text: "<html><body>Forbidden</body></html>", status: 403 },
      { text: "", status: 200, outcome: "fetched" },
    ]);
    assert.equal(stats.total, 4);
    assert.equal(stats.ok, 1);
    assert.equal(stats.blocked, 2);
    assert.equal(stats.empty, 1);
    assert.equal(stats.blockedRatio, 0.75);
  });

  it("names 429 rate-limiting as the dominant reason when it is most of the blocks", () => {
    const stats = captureBatchStats([
      { text: "<html><body>Too Many Requests</body></html>", status: 429 },
      { text: "<html><body>Too Many Requests</body></html>", status: 429 },
      { text: "Real article text goes here, long enough to pass.", status: 200, outcome: "fetched" },
    ]);
    assert.equal(stats.dominantReason, "rate-limited");
  });

  it("returns an all-ok batch with zero blocked and no dominant reason", () => {
    const stats = captureBatchStats([
      { text: "First real article, plenty of readable text here.", status: 200, outcome: "fetched" },
      { text: "Second real article, also plenty of readable text.", status: 200, outcome: "fetched" },
    ]);
    assert.equal(stats.blocked, 0);
    assert.equal(stats.blockedRatio, 0);
    assert.equal(stats.dominantReason, null);
  });
});
