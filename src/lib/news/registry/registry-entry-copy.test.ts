import { test } from "node:test";
import assert from "node:assert/strict";
import { registryEntryHeading } from "./registry-entry-copy.ts";

/*
  Scott, Nov 22 2026: a scan creates its organization with the same name as the
  service, so every heading read "Community Pantry — Community Pantry". The two
  names are one name when they match after trimming and ignoring case; any other
  pair is unchanged.
*/

test("two names that are the same are said once", () => {
  assert.equal(registryEntryHeading("Community Pantry", "Community Pantry"), "Community Pantry");
});

test("names that differ only by case or surrounding spaces are said once", () => {
  assert.equal(registryEntryHeading("community pantry", "Community Pantry"), "community pantry");
  assert.equal(registryEntryHeading("  Community Pantry  ", "community pantry "), "Community Pantry");
});

test("two different names are shown exactly as before", () => {
  assert.equal(
    registryEntryHeading("OUR Center", "Help with basic needs"),
    "OUR Center — Help with basic needs",
  );
  assert.equal(registryEntryHeading(" OUR Center ", "Food bank"), " OUR Center  — Food bank");
});
