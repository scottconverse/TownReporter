import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanSourceExcerpt } from "./scan-source-excerpt.ts";

describe("scanSourceExcerpt", () => {
  it("keeps all six extra URLs while staying within the character limit", () => {
    const extras = Array.from({ length: 6 }, (_, index) => ({
      url: `https://www.svvsd.org/documents/extra-${index + 1}.pdf`,
      text: `Document ${index + 1} ` + "district update ".repeat(400),
    }));
    const excerpt = scanSourceExcerpt("Page excerpt ".repeat(400), extras, 6000);
    assert.ok(excerpt.length <= 6000, `excerpt was ${excerpt.length} characters`);
    for (const extra of extras) {
      assert.ok(excerpt.includes(extra.url), `missing ${extra.url}`);
    }
  });
});
