import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_BODY_PARTS_MAX,
  DOCUMENT_PARTS_MAX,
  articleParts,
  chunkText,
  documentParts,
} from "./story-meaning-parts.ts";

/**
 * DEF-1: how a published story and an uploaded file are cut into pieces for
 * meaning search. The search cuts a file a second time to show the matching
 * part, so the cut must be the same every time.
 */

const paragraph = (label: string, chars: number) =>
  `${label} ` + "word ".repeat(Math.ceil(chars / 5)).slice(0, chars - label.length - 1);

describe("articleParts", () => {
  it("puts the headline and the summary together as part 0, then the body", () => {
    const parts = articleParts({
      headline: "Council raises water rates",
      dek: "Rates rise 4 percent in January.",
      body: `${paragraph("First", 600)}\n\n${paragraph("Second", 600)}\n\n${paragraph("Third", 600)}`,
    });
    assert.equal(parts[0], "Council raises water rates. Rates rise 4 percent in January.");
    // 600-character paragraphs do not fit two to a part (target is about 900).
    assert.equal(parts.length, 4);
    assert.ok(parts[1]!.startsWith("First"));
    assert.ok(parts[3]!.startsWith("Third"));
  });

  it("keeps a headline-only story searchable and drops a story with nothing", () => {
    assert.deepEqual(articleParts({ headline: "Bridge closes", dek: "", body: "" }), [
      "Bridge closes",
    ]);
    assert.deepEqual(articleParts({ headline: "", dek: "", body: "" }), []);
  });

  it("groups short paragraphs into one part", () => {
    const parts = articleParts({
      headline: "H",
      dek: "D",
      body: [paragraph("A", 250), paragraph("B", 250), paragraph("C", 250)].join("\n\n"),
    });
    assert.equal(parts.length, 2);
    assert.match(parts[1]!, /^A[\s\S]*B[\s\S]*C/);
  });

  it("cuts one very long paragraph at sentence ends, never past the limit", () => {
    const sentence = "The city will repair the road in spring. ";
    const parts = articleParts({
      headline: "H",
      dek: "",
      body: sentence.repeat(120),
    });
    assert.ok(parts.length > 2);
    for (const part of parts.slice(1)) {
      assert.ok(part.length <= 1_200, `part is ${part.length} characters`);
      assert.ok(part.endsWith("."), "cut at a sentence end");
    }
  });

  it("stops at the body-part cap", () => {
    const body = Array.from({ length: 200 }, (_, i) => paragraph(`P${i}`, 950)).join("\n\n");
    const parts = articleParts({ headline: "H", dek: "D", body });
    assert.equal(parts.length, 1 + ARTICLE_BODY_PARTS_MAX);
  });

  it("does not embed a body that is mostly control characters", () => {
    const parts = articleParts({
      headline: "Real headline",
      dek: "",
      body: "\u0001\u0002\u0003 ".repeat(200),
    });
    assert.deepEqual(parts, ["Real headline"]);
  });
});

describe("documentParts", () => {
  it("cuts the same text the same way every time", () => {
    const text = Array.from({ length: 30 }, (_, i) => paragraph(`Page${i}`, 700)).join("\n\n");
    assert.deepEqual(documentParts(text), documentParts(text));
    assert.ok(documentParts(text).length >= 20);
  });

  it("returns nothing for empty, tiny or broken text", () => {
    assert.deepEqual(documentParts(null), []);
    assert.deepEqual(documentParts(""), []);
    assert.deepEqual(documentParts("tiny"), []);
    assert.deepEqual(documentParts("\u0001\u0002\u0003".repeat(100)), []);
  });

  it("stops at the part cap so one huge file cannot flood the fill", () => {
    const text = Array.from({ length: 400 }, (_, i) => paragraph(`S${i}`, 990)).join("\n\n");
    assert.equal(documentParts(text).length, DOCUMENT_PARTS_MAX);
  });
});

describe("chunkText", () => {
  it("handles Windows line breaks", () => {
    const parts = chunkText(`${paragraph("A", 500)}\r\n\r\n${paragraph("B", 500)}`, 900, 1200, 10);
    assert.equal(parts.length, 2);
  });
});
