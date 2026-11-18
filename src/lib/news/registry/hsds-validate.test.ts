import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_HSDS_JSON_BYTES, parseHsdsJson, validateHsdsBundle } from "./hsds-validate.ts";

const sampleText = readFileSync(
  new URL("./__fixtures__/sample-bundle.json", import.meta.url),
  "utf8",
);

function sample(): any {
  return JSON.parse(sampleText);
}

function problemsOf(value: unknown): string[] {
  const result = validateHsdsBundle(value);
  assert.equal(result.ok, false, "expected the file to be rejected");
  return result.ok ? [] : result.problems;
}

test("the sample fixture is valid", () => {
  const result = parseHsdsJson(sampleText);
  assert.equal(result.ok, true);
});

test("malformed JSON is rejected with a message", () => {
  const result = parseHsdsJson('{"organizations": [');
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problems[0]!, /not valid JSON/);
});

test("an empty file and a non-object are rejected", () => {
  assert.equal(parseHsdsJson("   ").ok, false);
  assert.match(problemsOf([1, 2])[0]!, /JSON object/);
  assert.match(problemsOf({})[0]!, /organizations: is missing/);
});

test("a file over 8 MiB is rejected before it is parsed", () => {
  const big = `{"organizations":[],"pad":"${"x".repeat(MAX_HSDS_JSON_BYTES)}"}`;
  const result = parseHsdsJson(big);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problems[0]!, /larger than 8 MiB/);
});

test("a missing name names the record", () => {
  const bundle = sample();
  delete bundle.organizations[1].services[0].name;
  assert.ok(problemsOf(bundle).includes("organizations[1].services[0]: name is missing"));
});

test("a missing id and a missing organization name are named", () => {
  const bundle = sample();
  delete bundle.organizations[0].id;
  delete bundle.organizations[1].name;
  const problems = problemsOf(bundle);
  assert.ok(problems.includes("organizations[0]: id is missing"));
  assert.ok(problems.includes("organizations[1]: name is missing"));
});

test("duplicate ids within a kind are named", () => {
  const bundle = sample();
  bundle.organizations[1].id = bundle.organizations[0].id;
  const problems = problemsOf(bundle);
  assert.ok(problems.some((p) => p.startsWith("organizations[1]:") && /used twice/.test(p)));
});

test("an unknown taxonomy parent, service taxonomy and location reference are named", () => {
  const bundle = sample();
  bundle.taxonomies = [{ id: "t1", name: "Food", parent_id: "t-missing" }];
  bundle.organizations[0].services[0].taxonomy_id = "t-nope";
  bundle.organizations[0].services[0].service_at_locations[0].location_id = "loc-missing";
  const problems = problemsOf(bundle);
  assert.ok(problems.some((p) => p.startsWith("taxonomies[0]:") && /t-missing/.test(p)));
  assert.ok(problems.some((p) => p.startsWith("organizations[0].services[0]:") && /t-nope/.test(p)));
  assert.ok(
    problems.some(
      (p) =>
        p.startsWith("organizations[0].services[0].service_at_locations[0]:") &&
        /loc-missing/.test(p),
    ),
  );
});

test("a status outside the allowed three is rejected", () => {
  const bundle = sample();
  bundle.organizations[0].services[0].status = "open";
  const problems = problemsOf(bundle);
  assert.ok(problems.some((p) => /status "open" is not one of/.test(p)));
});

test("latitude and longitude outside their ranges are rejected", () => {
  const bundle = sample();
  bundle.organizations[0].locations[0].latitude = 91;
  bundle.organizations[0].locations[0].longitude = -181;
  const problems = problemsOf(bundle);
  assert.ok(problems.some((p) => /latitude 91 is outside/.test(p)));
  assert.ok(problems.some((p) => /longitude -181 is outside/.test(p)));
});

test("a malformed opens_at is rejected and a null one is fine", () => {
  const bundle = sample();
  const schedule = bundle.organizations[0].services[0].schedules[0];
  schedule.opens_at = "9am";
  assert.ok(problemsOf(bundle).some((p) => /opens_at "9am"/.test(p)));
  schedule.opens_at = null;
  assert.equal(validateHsdsBundle(bundle).ok, true);
});

test("a file whose text is over the cap is refused before anything is encoded", (t) => {
  const encode = t.mock.method(TextEncoder.prototype, "encode");
  const result = parseHsdsJson(`{"organizations":[],"pad":"${"x".repeat(MAX_HSDS_JSON_BYTES)}"}`);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problems[0]!, /larger than 8 MiB/);
  assert.equal(encode.mock.callCount(), 0);
});
