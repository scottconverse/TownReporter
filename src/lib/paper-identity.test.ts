import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAPER_IDENTITY, resolvePaperIdentity, type PaperIdentity } from "./paper-identity.ts";

/**
 * A public-page white-screen incident: `__root.tsx`'s loader could resolve
 * `paper` to `undefined` (a DB hiccup that doesn't throw, not just one that
 * does), and `<PaperProvider value={undefined}>` overrides the context's own
 * default -- so every `usePaper()`/`usePaperDateFormatters()` call downstream
 * threw "Cannot destructure property 'timezone' of undefined" instead of
 * rendering the shipped default identity. `resolvePaperIdentity` is the fix,
 * called at every boundary where a fetched identity enters route context or
 * a `<PaperProvider>` value in `src/routes/__root.tsx`. This proves the
 * fallback itself, independent of the router.
 */
describe("resolvePaperIdentity", () => {
  it("falls back to the shipped default when the fetch resolved to undefined", () => {
    assert.equal(resolvePaperIdentity(undefined), DEFAULT_PAPER_IDENTITY);
  });

  it("falls back to the shipped default when the fetch resolved to null", () => {
    assert.equal(resolvePaperIdentity(null), DEFAULT_PAPER_IDENTITY);
  });

  it("passes through a real identity untouched", () => {
    const configured: PaperIdentity = {
      ...DEFAULT_PAPER_IDENTITY,
      name: "The Configured Gazette",
      timezone: "America/Chicago",
    };
    assert.equal(resolvePaperIdentity(configured), configured);
  });

  it("never returns undefined or null for any input", () => {
    for (const input of [undefined, null, DEFAULT_PAPER_IDENTITY]) {
      const result = resolvePaperIdentity(input);
      assert.notEqual(result, undefined);
      assert.notEqual(result, null);
      assert.equal(typeof result.timezone, "string");
    }
  });
});
