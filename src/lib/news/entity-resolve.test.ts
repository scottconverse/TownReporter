import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { identityKey, isConfirmedSame, normalizeEntity, resolveEntityName } from "./entity-resolve.ts";

describe("normalizeEntity", () => {
  it("strips LLC/Inc noise without inventing identity", () => {
    assert.equal(normalizeEntity("Peak Range Holdings LLC"), "peak range holdings");
    assert.equal(normalizeEntity("The Peak Range Holdings, Inc."), "peak range holdings");
  });
});

describe("identityKey", () => {
  it("keeps legal suffixes so LLC and Inc stay distinct keys", () => {
    assert.equal(identityKey("Peak Range Holdings LLC"), "peak range holdings llc");
    assert.equal(identityKey("Peak Range Holdings Inc"), "peak range holdings inc");
    assert.notEqual(identityKey("Peak Range Holdings LLC"), identityKey("Peak Range Holdings Inc"));
  });
});

describe("resolveEntityName", () => {
  const known = [
    { canonical: "jane smith", name: "Jane Smith" },
    { canonical: "peak range holdings llc", name: "Peak Range Holdings LLC" },
  ];

  it("matches an exact canonical as same", () => {
    const r = resolveEntityName("Jane Smith", known);
    assert.equal(r.verdict, "same");
    assert.equal(r.canonical, "jane smith");
    assert.equal(isConfirmedSame(r.verdict), true);
  });

  it("does not auto-merge a possible person overlap", () => {
    const r = resolveEntityName("Jane A. Smith", known);
    assert.equal(isConfirmedSame(r.verdict), false);
    assert.ok(
      r.verdict === "possible" || r.verdict === "likely-same" || r.verdict === "possible-same",
      r.verdict,
    );
    assert.equal(r.matched, "Jane Smith");
  });

  it("does not collapse LLC and Inc into one entity", () => {
    const r = resolveEntityName("Peak Range Holdings Inc", known);
    assert.equal(isConfirmedSame(r.verdict), false);
    assert.ok(r.verdict === "possible-same" || r.verdict === "possible" || r.verdict === "likely-same", r.verdict);
    assert.equal(r.canonical, "peak range holdings llc");
  });

  it("leaves an unrelated name unresolved", () => {
    const r = resolveEntityName("Front Range Municipal Solutions LLC", known);
    assert.equal(r.verdict, "unresolved");
    assert.match(r.canonical, /front range municipal solutions/);
  });
});
