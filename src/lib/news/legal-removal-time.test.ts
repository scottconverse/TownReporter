import { it } from "node:test";
import assert from "node:assert/strict";
import { removalExpiry } from "./legal-removal-time.ts";
it("twelve calendar months clamp leap day without extending retention into March", () => {
  assert.equal(
    removalExpiry(new Date("2024-02-29T18:31:12.000Z")).toISOString(),
    "2025-02-28T18:31:12.000Z",
  );
  assert.equal(
    removalExpiry(new Date("2025-01-31T18:31:12.000Z")).toISOString(),
    "2026-01-31T18:31:12.000Z",
  );
});
