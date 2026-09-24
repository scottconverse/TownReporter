/**
 * Loaded before every ordinary test process. The runner already blanks the
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
if (process.env.TEST_POSTGRES_ADMIN_URL?.trim()) {
  throw new Error("Refusing to start the ordinary test suite with TEST_POSTGRES_ADMIN_URL set.");
}
if (process.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION === "1" &&
    !process.env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL?.trim()) {
  throw new Error("PostgreSQL integration opt-in requires TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL.");
}
if (process.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION &&
    process.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION !== "1") {
  throw new Error("TOWNREPORTER_RUN_POSTGRES_INTEGRATION must be exactly 1 when set.");
}
if (process.env.RUN_LIVE_MODEL_TESTS === "1") {
  throw new Error("Refusing to start the ordinary test suite with live model evaluation enabled.");
}
// Preserve empty overrides even if a future caller omits them: Vite's env
// loader prioritizes existing process values, including empty strings.
// Deliberate per-test scratch Postgres opt-ins remain possible afterward.
for (const key of ["DATABASE_URL", "TEST_POSTGRES_ADMIN_URL", "VERCEL", "VERCEL_ENV", "RUN_LIVE_MODEL_TESTS"]) {
  process.env[key] = "";
}
