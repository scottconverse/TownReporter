import { it } from "node:test";
import assert from "node:assert/strict";
import { parseSourceLines, sourceName } from "./source-lines.ts";

it("builds source names without the separator left behind by a URL", () => {
  const rows = parseSourceLines(
    "St. Vrain Valley Schools — https://www.svvsd.org/\n" +
    "TIER B\nLongmont Times-Call — https://www.timescall.com/\n" +
    "Board — meeting records | https://example.org/records",
  );
  assert.deepEqual(rows.map((row) => row.title), [
    "St. Vrain Valley Schools",
    "Longmont Times-Call",
    "Board — meeting records",
  ]);
  assert.equal(sourceName("St. Vrain Valley Schools —"), "St. Vrain Valley Schools");
  assert.equal(sourceName("Longmont Times-Call"), "Longmont Times-Call");
});
