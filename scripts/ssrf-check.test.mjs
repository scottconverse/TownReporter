import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("SSRF cases live on the production guard, not a copy of the function", () => {
  const here = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(here, /function isBlockedAddress\(/);
  const guard = readFileSync(join(root, "src/lib/news/url-guard.ts"), "utf8");
  assert.match(guard, /v4FromMapped6/);
  const tests = readFileSync(join(root, "src/lib/news/fetch-url.test.ts"), "utf8");
  assert.match(tests, /::ffff:7f00:1/);
  assert.match(tests, /\[::ffff:7f00:1\]/);
  assert.match(tests, /\[::ffff:a9fe:a9fa\]/);
});
