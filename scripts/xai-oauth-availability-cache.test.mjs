import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../src/components/xai-oauth-connection.tsx", import.meta.url),
  "utf8",
);
const pickerSource = await readFile(
  new URL("../src/components/model-picker.tsx", import.meta.url),
  "utf8",
);
const availabilityClientSource = await readFile(
  new URL("../src/lib/news/provider-availability.ts", import.meta.url),
  "utf8",
);

test("XAI OAuth state changes invalidate the shared provider availability query", () => {
  assert.match(source, /PROVIDER_AVAILABILITY_QUERY_KEY/);
  assert.match(
    source,
    /invalidateQueries\(\{\s*queryKey:\s*PROVIDER_AVAILABILITY_QUERY_KEY,\s*refetchType:\s*["']all["']/,
  );
  assert.equal(
    source.match(/\bupdate\(next(?:,|\))/g)?.length,
    6,
    "start, poll, cancel, refresh, select, and disconnect must share the invalidating update",
  );
  assert.match(source, /provider-availability-key/);
  assert.doesNotMatch(source, /@\/lib\/news\/provider-availability["']/);
  assert.match(pickerSource, /provider-availability-key/);
  assert.doesNotMatch(availabilityClientSource, /xai-oauth\.server|from ["']\.\/provider-registry/);
});
