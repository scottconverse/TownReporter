import { test } from "node:test";
import assert from "node:assert/strict";
import { registryCardFacts, registryCategoryHue, registryDirectionsHref } from "./registry-card.ts";

test("a known category gets its group colour, any case", () => {
  assert.equal(registryCategoryHue("Food"), registryCategoryHue("  food "));
  assert.notEqual(registryCategoryHue("Food"), registryCategoryHue("Housing and shelter"));
});

test("two category names for the same need share one colour", () => {
  assert.equal(registryCategoryHue("Crisis"), registryCategoryHue("Crisis lines"));
  assert.equal(
    registryCategoryHue("Families and children"),
    registryCategoryHue("Children, youth and families"),
  );
});

test("an unknown or empty category gets the neutral colour", () => {
  assert.equal(registryCategoryHue(null), registryCategoryHue("Pets"));
  assert.equal(registryCategoryHue(""), registryCategoryHue("Something new"));
});

test("a street address becomes a map link; text that is not a street address does not", () => {
  const href = registryDirectionsHref("515 Coffman St., Longmont, CO, 80501");
  assert.ok(href?.startsWith("https://www.google.com/maps/search/?api=1&query="));
  assert.ok(href?.includes(encodeURIComponent("515 Coffman St., Longmont, CO, 80501")));
  assert.equal(registryDirectionsHref("Online only"), null);
  assert.equal(registryDirectionsHref(null), null);
  assert.equal(registryDirectionsHref("   "), null);
});

test("card facts take the service phone first, then a place phone, then the organization phone", () => {
  const base = { locations: [], servicePhones: [], serviceHours: [], organizationPhones: [] };
  assert.equal(
    registryCardFacts({ ...base, servicePhones: ["211"], organizationPhones: ["303-000-0000"] })
      .phone,
    "211",
  );
  assert.equal(
    registryCardFacts({
      ...base,
      locations: [{ address: null, phones: ["303-111-2222"], hours: [] }],
      organizationPhones: ["303-000-0000"],
    }).phone,
    "303-111-2222",
  );
  assert.equal(
    registryCardFacts({ ...base, organizationPhones: ["303-000-0000"] }).phone,
    "303-000-0000",
  );
});

test("card facts never invent a missing fact", () => {
  const facts = registryCardFacts({
    locations: [],
    servicePhones: [],
    serviceHours: [],
    organizationPhones: [],
  });
  assert.deepEqual(facts, { phone: null, address: null, hours: null });
});

test("card facts take the first address and the first hours that are not blank", () => {
  const facts = registryCardFacts({
    locations: [
      { address: "  ", phones: [], hours: [] },
      { address: "1 Main St, Longmont, CO", phones: [], hours: ["Mon-Fri 8-5"] },
    ],
    servicePhones: [],
    serviceHours: [],
    organizationPhones: [],
  });
  assert.equal(facts.address, "1 Main St, Longmont, CO");
  assert.equal(facts.hours, "Mon-Fri 8-5");
});
