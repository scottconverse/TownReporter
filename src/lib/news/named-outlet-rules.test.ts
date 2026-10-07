// guards: editing a saved outlet could discard the name and block review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOutletEdit } from "./named-outlet-rules.ts";

test("editing a saved outlet starts a draft holding the new name", () => {
  const savedRows = [{ name: "Old Gazette", aliases: [], domains: ["gazette.test"] }];
  assert.equal(applyOutletEdit(null, savedRows, 0, { name: "New Gazette" })?.rows[0].name, "New Gazette");
});
