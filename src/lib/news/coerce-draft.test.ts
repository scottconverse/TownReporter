import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coerceDraft, extractQuoted, looksLikeJsonDraft, unpackStoredDraft } from "./coerce-draft.ts";

/*
  Converted from vitest to node:test.

  This file was written against vitest, which this repository does not
  install. It therefore could not run at all — and instead of being fixed it
  was left out of the hand-maintained test list in package.json, where its
  absence was invisible. An audit found it (TE-02).

  What it covers is not incidental: coerceDraft is what stops a model's raw
  JSON reaching the page as the story body. A regression here prints
  `{"headline": ...}` to readers.
*/

const FALLBACK = {
  headline: "Lead headline",
  dek: "Lead why",
  topic: "council",
};

describe("coerceDraft", () => {
  it("uses parsed JSON when valid", () => {
    const raw = JSON.stringify({
      headline: "Council votes on water",
      dek: "A recap.",
      body: "First paragraph.\n\nSecond paragraph.",
      topic: "utilities",
    });
    const d = coerceDraft(raw, FALLBACK);
    assert.equal(d.headline, "Council votes on water");
    assert.ok(String(d.body).includes("First paragraph"), `expected to contain "First paragraph"`);
    assert.equal(d.topic, "utilities");
  });

  it("pulls body out of JSON with unescaped inner quotes", () => {
    const raw = `{
  "headline": "City roundup cites Vision Zero",
  "dek": "Homepage news blurb.",
  "body": "The site listed a news item titled "What is Vision Zero" and other alerts.\\n\\nMore copy.",
  "topic": "infrastructure"
}`;
    const d = coerceDraft(raw, FALLBACK);
    assert.equal(d.headline, "City roundup cites Vision Zero");
    assert.equal(d.body.startsWith("{"), false);
    assert.ok(String(d.body).includes("Vision Zero"), `expected to contain "Vision Zero"`);
    assert.ok(String(d.body).includes("More copy."), `expected to contain "More copy."`);
    assert.equal(d.topic, "infrastructure");
  });

  it("never returns the raw JSON blob as body", () => {
    const raw = `{ "headline": "X", "dek": "Y", "body": "broken "quotes" inside" }`;
    const d = coerceDraft(raw, FALLBACK);
    assert.equal(looksLikeJsonDraft(d.body), false);
  });
});

describe("unpackStoredDraft", () => {
  it("unpacks a draft that stored the whole JSON in body", () => {
    const body = `{
  "headline": "City roundup cites Vision Zero, rec center closure among recent items",
  "dek": "The City of Longmont homepage lists a multi-topic news roundup.",
  "body": "The City of Longmont website lists a news item dated August 20, 2026.\\n\\nOther items shown include a traffic advisory."
}`;
    const unpacked = unpackStoredDraft({
      headline: "City roundup cites Vision Zero, rec center closure among recent items",
      dek: "Homepage news blurb points to multiple items",
      body,
      topic: "infrastructure",
    });
    assert.equal(unpacked.body.startsWith("{"), false);
    assert.ok(String(unpacked.body).includes("August 20, 2026"), `expected to contain "August 20, 2026"`);
    assert.ok(String(unpacked.dek).includes("multi-topic"), `expected to contain "multi-topic"`);
  });
});

describe("extractQuoted", () => {
  it("reads until the next known key", () => {
    const raw = `"body": "Hello\\n\\nWorld", "topic": "council"`;
    assert.equal(extractQuoted(raw, "body"), "Hello\n\nWorld");
  });
});
