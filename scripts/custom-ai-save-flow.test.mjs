import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const component = await readFile(
  new URL("../src/components/custom-ai-connections.tsx", import.meta.url),
  "utf8",
);
const route = await readFile(new URL("../src/routes/desk.ops.tsx", import.meta.url), "utf8");
const settings = await readFile(
  new URL("../src/lib/news/custom-ai-settings.ts", import.meta.url),
  "utf8",
);

test("custom connection save clears after persistence even when refresh fails", () => {
  assert.match(component, /connectionSaveMessage\(/);
  assert.match(component, /setForm\(\{ name: "", baseUrl: "", apiKey: "", modelId: "" \}\)/);
  assert.match(route, /saveCustomAiConnectionAndCache\(/);
  assert.match(settings, /queryClient\.setQueryData<PublicCustomAiConnection\[\]\s*\|\s*undefined>/);
  assert.match(settings, /upsertCustomAiConnection\(current, saved\)/);
  assert.match(route, /invalidateQueries\(\{ queryKey: \["custom-ai-connections"\]\s*\}\)/);
  assert.match(route, /connections\.isError && !connections\.data/);
  assert.match(
    settings,
    /It is ready to choose in the writing model picker/,
    "a saved connection with a model should say it is ready without claiming the current picker changed",
  );
  assert.match(route, /updateCustomAiConnectionEnabled\(current, id, enabled\)/);
  assert.match(route, /removeCustomAiConnection\(current, id\)/);
});
