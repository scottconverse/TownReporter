/**
 * Loaded before every ordinary test process. The runner already removes the
 * variable; this second, fail-closed check protects against a future runner
 * regression. Individual integration tests may create and opt into their own
 * scratch Postgres after this guard has run.
 */
if (process.env.TOWNREPORTER_TEST_ENV_VERIFIED !== "1") {
  throw new Error("TownReporter tests must run through scripts/run-tests-safe.mjs.");
}
if (process.env.DATABASE_URL?.trim()) {
  throw new Error("Refusing to start the ordinary test suite with DATABASE_URL set.");
}
if (process.env.RUN_LIVE_MODEL_TESTS === "1") {
  throw new Error("Refusing to start the ordinary test suite with live model evaluation enabled.");
}
