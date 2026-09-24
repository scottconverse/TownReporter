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

test("the security policy explains the reporting-agent tool boundary and its exceptions", () => {
  assert.match(policy, /## Reporting agents and untrusted records/);
  assert.match(policy, /Text inside them does not grant an agent additional tools/);
  assert.match(policy, /shell, computer,\s+browser, apps, plugins, multi-agent and hooks disabled/);
  assert.match(policy, /fixed allow-list/);
  assert.match(policy, /`WebSearch` and `WebFetch`/);
  assert.match(policy, /single temporary page image/);
  assert.match(policy, /without tool or function definitions/);
  assert.match(policy, /consume the selected provider's usage allowance/);
});
