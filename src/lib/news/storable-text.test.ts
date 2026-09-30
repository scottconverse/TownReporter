import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postgresText, storableText } from "./storable-text.ts";

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);
const REPLACEMENT = String.fromCharCode(0xfffd);

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

describe("postgresText", () => {
  /*
    The sibling policy, pinned so the two cannot quietly become one.

    `storableText` DELETES the byte; `postgresText` REPLACES it with U+FFFD.
    That difference is load-bearing: captured page text feeds the content hash
    that decides whether a monitored page changed, so deleting the byte would
    move the hash of every page captured from then on. The two are asserted
    against the SAME input here on purpose -- if a later refactor routes one
    through the other, one of these lines fails.
  */
  it("replaces NUL with U+FFFD rather than deleting it", () => {
    assert.equal(postgresText(`a${NUL}b`), `a${REPLACEMENT}b`);
    assert.equal(storableText(`a${NUL}b`), "ab");
  });

  it("keeps the other C0 controls Postgres accepts", () => {
    // Only NUL is a hard error for a text column, and removing anything else
    // would change the stored bytes of a page whose bytes did not change.
    const raw = `a${BEL}b\r\nc\td`;
    assert.equal(postgresText(raw), raw);
  });

  it("survives a long document with NULs scattered through it", () => {
    const raw = Array.from({ length: 5000 }, (_, i) => `word${i}${NUL}`).join(" ");
    const out = postgresText(raw);
    assert.equal(out.includes(NUL), false);
    assert.ok(out.length > 10_000, "the document itself must survive");
  });
});
