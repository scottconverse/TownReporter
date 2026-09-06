import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureDarkSchema, readDarkPlace, saveDarkCountyFor } from "./dark.ts";
import { locationTerms, queryVariations } from "./dark-gates.ts";

/**
 * Owner request 2026-09-06: the restored Dark Desk (86811ca) scopes its
 * searches to city + county and reads `dark_settings.county` via
 * `readDarkPlace`, but until this change nothing ever wrote that column, so
 * every install's county-scoped variations silently fell back to the city
 * alone. `saveDarkCountyFor` is the plain function Paper setup's new County
 * field calls through the `saveDarkCounty` server fn -- exercised here
 * directly against PGLite, the same pattern reddit-tip-filing.test.ts uses
 * for `fileRedditTipFor`.
 */
describe("saveDarkCountyFor + readDarkPlace", () => {
  it("writes dark_settings.county for the right newsroom and readDarkPlace returns it", async () => {
    await ensureDarkSchema();
    const nr = Date.now() % 100000;
    const saved = await saveDarkCountyFor(nr, "  Boulder County  ");
    assert.equal(saved, "Boulder County", "stored value is trimmed");

    const { place } = await readDarkPlace(nr);
    assert.equal(place.county, "Boulder County");
  });

  it("does not cross newsrooms: a county set for one newsroom does not appear in another", async () => {
    await ensureDarkSchema();
    const nrA = (Date.now() % 100000) + 1;
    const nrB = nrA + 1;
    await saveDarkCountyFor(nrA, "Weld County");

    const a = await readDarkPlace(nrA);
    const b = await readDarkPlace(nrB);
    assert.equal(a.place.county, "Weld County");
    assert.notEqual(b.place.county, "Weld County");
  });

  it("a blank county clears the column and readDarkPlace reports it unset (city-only scoping)", async () => {
    await ensureDarkSchema();
    const nr = (Date.now() % 100000) + 2;
    await saveDarkCountyFor(nr, "Larimer County");
    assert.equal((await readDarkPlace(nr)).place.county, "Larimer County");

    const cleared = await saveDarkCountyFor(nr, "   ");
    assert.equal(cleared, "");
    const { place } = await readDarkPlace(nr);
    assert.equal(place.county, null);

    // The behavioral point of "unset": the location-scoping helpers the Dark
    // Signal Desk actually searches with fall back to the city alone rather
    // than appending "null County" or an empty-string clause.
    const terms = locationTerms(place);
    assert.ok(terms.every((t) => !/county/i.test(t)), `expected no county term, got ${JSON.stringify(terms)}`);

    const variations = queryVariations("zoning variance request", place);
    assert.ok(
      variations.some((v) => v.includes(`agenda OR minutes OR ordinance`) && v.includes(place.city)),
      "the county-slot query variation should fall back to the city",
    );
    assert.ok(
      variations.every((v) => !/county/i.test(v)),
      `expected no "County" text once county is unset, got ${JSON.stringify(variations)}`,
    );
  });
});
