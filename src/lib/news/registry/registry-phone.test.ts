import { test } from "node:test";
import assert from "node:assert/strict";
import { telHref } from "./registry-phone.ts";

test("a formatted number becomes a tel link of digits only", () => {
  assert.equal(telHref("(303) 441-3700"), "tel:3034413700");
  assert.equal(telHref("303-441-3700"), "tel:3034413700");
  assert.equal(telHref("303.441.3700 ext. 2"), "tel:30344137002");
});

test("the crisis numbers link to tel:988 and tel:211", () => {
  assert.equal(telHref("988"), "tel:988");
  assert.equal(telHref("211"), "tel:211");
});

test("a value with no digits is not a phone number", () => {
  assert.equal(telHref(""), null);
  assert.equal(telHref("   "), null);
  assert.equal(telHref(null), null);
  assert.equal(telHref(undefined), null);
  assert.equal(telHref("call the office"), null);
});
