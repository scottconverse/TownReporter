import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { provenanceHost } from "./findings.ts";

describe("the public story's source line", () => {
  it("shows the host when a writer checkpoint saved no organization (Test walk, Oct 20 2026)", () => {
    // The shape desk.ts onWriterDraft stores: no organization key.
    const item = { url: "https://www.longmontleader.com/local-news/recovery-cafe-comes-to-longmont-2385350" };
    assert.equal(provenanceHost(item), "longmontleader.com");
  });

  it("still pairs a real newsroom name with its host", () => {
    assert.equal(
      provenanceHost({ url: "https://www.longmontleader.com/x", organization: "Longmont Leader" }),
      "Longmont Leader · longmontleader.com",
    );
  });
});
