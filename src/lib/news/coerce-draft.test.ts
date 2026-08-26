import { describe, expect, it } from "vitest";
import { coerceDraft, extractQuoted, looksLikeJsonDraft, unpackStoredDraft } from "./coerce-draft";

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
    expect(d.headline).toBe("Council votes on water");
    expect(d.body).toContain("First paragraph");
    expect(d.topic).toBe("utilities");
  });

  it("pulls body out of JSON with unescaped inner quotes", () => {
    const raw = `{
  "headline": "City roundup cites Vision Zero",
  "dek": "Homepage news blurb.",
  "body": "The site listed a news item titled "What is Vision Zero" and other alerts.\\n\\nMore copy.",
  "topic": "infrastructure"
}`;
    const d = coerceDraft(raw, FALLBACK);
    expect(d.headline).toBe("City roundup cites Vision Zero");
    expect(d.body.startsWith("{")).toBe(false);
    expect(d.body).toContain("Vision Zero");
    expect(d.body).toContain("More copy.");
    expect(d.topic).toBe("infrastructure");
  });

  it("never returns the raw JSON blob as body", () => {
    const raw = `{ "headline": "X", "dek": "Y", "body": "broken "quotes" inside" }`;
    const d = coerceDraft(raw, FALLBACK);
    expect(looksLikeJsonDraft(d.body)).toBe(false);
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
    expect(unpacked.body.startsWith("{")).toBe(false);
    expect(unpacked.body).toContain("August 20, 2026");
    expect(unpacked.dek).toContain("multi-topic");
  });
});

describe("extractQuoted", () => {
  it("reads until the next known key", () => {
    const raw = `"body": "Hello\\n\\nWorld", "topic": "council"`;
    expect(extractQuoted(raw, "body")).toBe("Hello\n\nWorld");
  });
});
