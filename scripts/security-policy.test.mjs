import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const policy = readFileSync(new URL("../SECURITY.md", import.meta.url), "utf8");

test("the security policy supports the current 0.6 release line", () => {
  assert.match(policy, /\| 0\.6\.x \| Yes/);
  assert.doesNotMatch(policy, /\| 0\.5\.x \| Yes/);
});

test("the security policy names the real private-reporting route without a placeholder", () => {
  assert.match(policy, /GitHub's private vulnerability reporting/);
  assert.match(policy, /\*\*Security\*\* tab, then \*\*Report a vulnerability\*\*/);
  assert.doesNotMatch(policy, /reporting address above is a placeholder/i);
});
