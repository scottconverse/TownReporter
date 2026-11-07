import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STARTER_CHECKED_ON_BY_SERVICE_ID,
  STARTER_ENTRIES,
  checkedOnLabel,
  starterBundle,
  starterServiceId,
} from "./starter-list.ts";

test("the starter bundle has eleven organizations and eleven services", () => {
  const bundle = starterBundle();
  assert.equal(bundle.organizations.length, 11);
  const services = bundle.organizations.flatMap((org) => org.services ?? []);
  assert.equal(services.length, 11);
});

test("every entry names the page it came from and the day it was read", () => {
  for (const entry of STARTER_ENTRIES) {
    assert.match(entry.sourceUrl, /^https:\/\//, `${entry.key} has a source page`);
    assert.match(entry.sourceTitle, /\S/, `${entry.key} has a source title`);
    assert.equal(entry.checkedOn, "2026-11-05", `${entry.key} records the day it was read`);
  }
});

test("HSDS ids are unique and stable across loads", () => {
  const first = starterBundle();
  const second = starterBundle();
  assert.deepEqual(first, second, "the bundle is the same every time it is built");

  const ids = first.organizations.flatMap((org) => [
    org.id,
    ...(org.services ?? []).map((service) => service.id),
  ]);
  assert.equal(new Set(ids).size, ids.length, "every organization and service id is unique");

  for (const entry of STARTER_ENTRIES) {
    assert.ok(
      first.organizations.some((org) => org.id === `starter-org-${entry.key}`),
      `${entry.key} has a stable organization id`,
    );
    assert.ok(
      first.organizations.some((org) =>
        (org.services ?? []).some((service) => service.id === starterServiceId(entry.key)),
      ),
      `${entry.key} has a stable service id`,
    );
    assert.equal(
      STARTER_CHECKED_ON_BY_SERVICE_ID[starterServiceId(entry.key)],
      "2026-11-05",
      `${entry.key} has a read date the desk can look up`,
    );
  }
});

test("only the facts in the approved list reach the bundle", () => {
  const bundle = starterBundle();
  for (const org of bundle.organizations) {
    for (const service of org.services ?? []) {
      const entry = STARTER_ENTRIES.find((item) => starterServiceId(item.key) === service.id);
      assert.ok(entry, "every service belongs to an approved entry");
      assert.equal(service.description, entry.description);
      assert.equal((service.phones ?? []).length, entry.phone ? 1 : 0);
      if (entry.phone) assert.equal(service.phones![0]!.phone, entry.phone);
      assert.deepEqual(
        (service.languages ?? []).map((row) => row.language),
        entry.languages,
      );
      // No entry in the approved table gives an address.
      assert.deepEqual(org.locations ?? [], []);
      assert.deepEqual(service.service_at_locations ?? [], []);
    }
  }
});

test("a read date prints in the paper's words", () => {
  assert.equal(checkedOnLabel("2026-11-05"), "Page read on Nov. 5, 2026");
});
