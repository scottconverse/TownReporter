import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHsdsJson } from "./hsds-validate.ts";

/**
 * The large Longmont community-resource list, read from official and
 * first-party pages on 2026-11-20. Each service keeps the URL of the page that
 * states its facts; the validator is the same one the upload screen uses.
 */
const directoryText = readFileSync(
  new URL("./__fixtures__/longmont-directory-2026-11.json", import.meta.url),
  "utf8",
);

test("the Longmont directory passes the HSDS validator", () => {
  const result = parseHsdsJson(directoryText);
  assert.equal(
    result.ok,
    true,
    result.ok ? "" : `validator problems:\n${result.problems.join("\n")}`,
  );
});

test("the directory has at least 100 services", () => {
  const result = parseHsdsJson(directoryText);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const services = result.bundle.organizations.flatMap((org) => org.services ?? []);
  assert.ok(services.length >= 100, `found ${services.length} services`);
});

test("every service names a page it came from", () => {
  const result = parseHsdsJson(directoryText);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const org of result.bundle.organizations) {
    for (const service of org.services ?? []) {
      assert.match(service.url ?? "", /^https:\/\//, `${org.name}: ${service.name} has a source page`);
    }
  }
});

test("the directory does not repeat the starter list's service ids", () => {
  const result = parseHsdsJson(directoryText);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const org of result.bundle.organizations) {
    for (const service of org.services ?? []) {
      assert.ok(!service.id.startsWith("starter-svc-"), `${service.id} is not a starter id`);
    }
  }
});
