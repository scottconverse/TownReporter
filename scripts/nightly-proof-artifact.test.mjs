// guards: a scan receipt could misidentify the paper and daily scope the editor proved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { proofArtifact } from "./nightly-proof-artifact.mjs";

test("receipt identifies the daily twelve and Test database", () => {
  const receipt = proofArtifact(
    { databaseUrl: "postgres://tr_test_admin@127.0.0.1:5547/townreporter_test_20261008_145822" },
    "v",
    { ok: true },
    {},
    [],
  );
  assert.deepEqual(
    [receipt.scan.kind, receipt.scan.policySize, receipt.testDatabase],
    ["daily policy", 12, "townreporter_test_20261008_145822"],
  );
});
