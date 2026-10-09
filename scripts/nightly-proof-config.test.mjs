// guards: a nightly scan or draft could write into the live or dev paper instead of Test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDevDatabase, resolveProofTarget } from "./nightly-proof-config.mjs";

test("allows the Test database and refuses live or redirected connections", async () => {
  const target = "postgres://tr_test_admin@127.0.0.1:5547/townreporter_test_20261008_145822";
  assert.doesNotThrow(() => assertDevDatabase(target));
  for (const url of [
    "postgres://postgres@127.0.0.1:5433/townreporter",
    target.replace("5547", "5433"),
    `${target}?database=townreporter`,
    target.replace("127.0.0.1", "example.com"),
    target.replace("tr_test_admin", "postgres"),
  ]) {
    assert.throws(() => assertDevDatabase(url), /Refusing/);
  }
  const config = await resolveProofTarget({}, async (_file, args, options) => {
    assert.ok(args.includes("-w"));
    assert.equal(options.env.PGOPTIONS, "-c default_transaction_read_only=on");
    return { stdout: "townreporter_test_20261008_145822\n" };
  });
  assert.equal(config.databaseUrl, target);
  assert.equal(config.base, "http://127.0.0.1:3400");
  await assert.rejects(
    resolveProofTarget({ DATABASE_URL: target.replace("5547", "5433") }),
    /Refusing/,
  );
});
