import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanEventDescription,
  decodeRoutineSourceBytes,
  plainEventText,
} from "./routine-notice-text.ts";

test("descriptions become plain text with entities decoded and whitespace flattened", () => {
  assert.equal(
    cleanEventDescription(
      "  Description: <p>Join <strong>us &amp; friends</strong><br>Saturday&nbsp;night.</p>\uFFFD  ",
    ),
    "Join us & friends Saturday night.",
  );
});

test("long descriptions cut on a word boundary at 600 characters", () => {
  const source = Array.from({ length: 160 }, (_, index) => `word${index}`).join(" ");
  const description = cleanEventDescription(source);
  assert.ok(description.length <= 600);
  assert.ok(description.length > 500);
  assert.ok(description.endsWith("…"));
  const beforeEllipsis = description.slice(0, -1);
  assert.match(beforeEllipsis, /word\d+$/);
  assert.equal(source.startsWith(beforeEllipsis), true);
});

test("invalid UTF-8 falls back to Windows-1252 instead of producing U+FFFD", () => {
  const cafe = new Uint8Array([0x43, 0x61, 0x66, 0xe9]);
  assert.equal(decodeRoutineSourceBytes(cafe), "Café");
  assert.equal(decodeRoutineSourceBytes(new TextEncoder().encode("Café")), "Café");
});

test("display text removes replacement characters but preserves legitimate text", () => {
  assert.equal(plainEventText("Halloween\uFFFD Party"), "Halloween Party");
  assert.equal(plainEventText("  <em>Gallery Hours</em>  "), "Gallery Hours");
});
