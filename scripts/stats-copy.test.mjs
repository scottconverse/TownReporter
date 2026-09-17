import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/routes/desk.stats.tsx", import.meta.url), "utf8");

test("Stats names anonymous page loads and the two covered public page types honestly", () => {
  assert.match(source, /anonymous page loads/i);
  assert.match(source, /home page.*published story page/i);
  assert.match(source, /not unique people/i);
  assert.match(source, /not completed reads/i);
  assert.doesNotMatch(source, /Every public page view/);
  assert.doesNotMatch(source, /ranked by all-time views/);
});
