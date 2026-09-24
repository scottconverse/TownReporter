/** Return an isolated environment for the ordinary destructive fixture suite. */
export function safeTestEnvironment(source = process.env) {
  const env = { ...source };
  // Keep explicit empty overrides. Deleting these lets TanStack's Vite
  // configResolved/loadEnv hook rehydrate them from the checkout's .env.
  env.DATABASE_URL = "";
  // A globally inherited real-Postgres admin URL must not opt the ordinary
  // suite into destructive scratch-database integration tests. An explicitly
  // opted-in integration runner may carry it under a separate name; its late
  // preload restores it only after this environment's safety guard runs.
  const postgresIntegrationOptIn = source.TOWNREPORTER_RUN_POSTGRES_INTEGRATION === "1";
  env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL = postgresIntegrationOptIn
    ? (source.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL || source.TEST_POSTGRES_ADMIN_URL || "")
    : "";
  env.TEST_POSTGRES_ADMIN_URL = "";
  env.VERCEL = "";
  env.VERCEL_ENV = "";
  // The ordinary suite is deterministic and free even when its parent shell
  // was previously used for an opt-in provider evaluation. Live model tests
  // have their own `npm run test:live-model` entry point.
  env.RUN_LIVE_MODEL_TESTS = "";
  env.TOWNREPORTER_TEST_ENV_VERIFIED = "1";
  return env;
}
