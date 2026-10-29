import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  modelChoiceHelp,
  ocrModelCanReadImages,
  ocrReaderModelChoice,
} from "./model-choice.ts";

describe("Dark Desk PDF reader model", () => {
  it("keeps a file's image-reading model as the reader default", () => {
    assert.equal(ocrModelCanReadImages("codex-frontier"), true);
    assert.deepEqual(ocrReaderModelChoice("codex-frontier"), {
      choice: "codex-frontier",
      fallbackFrom: null,
      note: null,
    });
  });

  it("names a text-only file model and falls back to OCR's own order", () => {
    const picked = ocrReaderModelChoice("deepseek-flash");
    assert.equal(picked.choice, "auto");
    assert.equal(picked.fallbackFrom, "deepseek-flash");
    assert.match(picked.note ?? "", /DeepSeek v4\.1 Flash 1017 cannot read page images/);
    assert.match(picked.note ?? "", /Codex Sol 6\.1 \(balanced\), then Claude Sonnet 5\.5/);
    assert.match(picked.note ?? "", /local vision model/);
  });

  it("describes a named OCR reader as an image reader, not a writer", () => {
    assert.equal(
      modelChoiceHelp("codex-frontier", "ocr"),
      "Uses Codex Sol 6.1 to read page images. If it cannot read a page, OCR moves to the next ready reader.",
    );
    assert.match(modelChoiceHelp("auto", "ocr"), /Codex Sol 6\.1 \(balanced\), then Claude Sonnet 5\.5/);
  });
});
