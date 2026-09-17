import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { storableText } from "./storable-text.ts";

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);

describe("storableText", () => {
  /**
   * The crash this exists for. One NUL byte in one fetched PDF ended a dark
   * desk round after twenty-one documents had been read: Postgres refuses with
   * "invalid byte sequence for encoding UTF8: 0x00" and the whole investigation
   * went down with it.
   */
  it("removes the NUL byte that killed a dark round", () => {
    const out = storableText(`Longmont packet${NUL} page 2`);
    assert.equal(out.includes(NUL), false);
    assert.equal(out, "Longmont packet page 2");
  });

  it("keeps the whitespace real documents need", () => {
    const raw = "line one\nline two\r\n\tindented";
    assert.equal(storableText(raw), raw);
  });

  it("removes the other control characters that cannot be text", () => {
    assert.equal(storableText(`a${BEL}b${DEL}c`), "abc");
  });

  it("leaves ordinary text, punctuation, accents and emoji alone", () => {
    const raw = "CO 119 — Hover Street · café · 🚧 · $42.5M";
    assert.equal(storableText(raw), raw);
  });

  it("handles nothing without throwing", () => {
    assert.equal(storableText(null), "");
    assert.equal(storableText(undefined), "");
    assert.equal(storableText(""), "");
  });

  it("survives a long document with NULs scattered through it", () => {
    const raw = Array.from({ length: 5000 }, (_, i) => `word${i}${NUL}`).join(" ");
    const out = storableText(raw);
    assert.equal(out.includes(NUL), false);
    assert.ok(out.length > 10_000, "the document itself must survive");
  });
});
