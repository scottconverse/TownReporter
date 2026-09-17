import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodePdfString } from "./ingest.ts";

/**
 * PDF literal strings escape with a backslash. The decoder used to run a chain
 * of `.replace()` calls, each re-scanning text an earlier one had produced, so
 * an escaped backslash could be re-read as the start of a new escape.
 */
describe("decodePdfString", () => {
  it("keeps an escaped backslash followed by n as backslash + n", () => {
    // Input is the two characters \\ then the letter n, i.e. an escaped
    // backslash. The old code turned this into a newline, so a Windows path in
    // a civic PDF reached the model split across two lines.
    const input = "C:\\\\newdocs";
    assert.equal(decodePdfString(input), "C:\\newdocs");
  });

  it("still decodes a real newline escape", () => {
    assert.equal(decodePdfString("line one\\nline two"), "line one\nline two");
  });

  it("decodes tab and carriage return", () => {
    assert.equal(decodePdfString("a\\tb\\rc"), "a\tb\rc");
  });

  it("decodes escaped parentheses", () => {
    assert.equal(decodePdfString("Item \\(9B\\)"), "Item (9B)");
  });

  it("decodes octal escapes", () => {
    assert.equal(decodePdfString("\\101\\102\\103"), "ABC");
  });

  it("handles short octal escapes", () => {
    assert.equal(decodePdfString("\\7"), String.fromCharCode(7));
  });

  it("drops a line continuation", () => {
    assert.equal(decodePdfString("long\\\nline"), "longline");
  });

  it("leaves an unknown escape as the bare character", () => {
    assert.equal(decodePdfString("\\q"), "q");
  });

  it("leaves text with no escapes untouched", () => {
    assert.equal(decodePdfString("Resolution R-2026-84"), "Resolution R-2026-84");
  });

  it("does not turn an escaped backslash before t or r into whitespace either", () => {
    assert.equal(decodePdfString("C:\\\\temp"), "C:\\temp");
    assert.equal(decodePdfString("C:\\\\records"), "C:\\records");
  });
});
