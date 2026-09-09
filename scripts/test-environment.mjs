/** Return an isolated environment for the ordinary destructive fixture suite. */
export function safeTestEnvironment(source = process.env) {
  const env = { ...source };
  // Keep explicit empty overrides. Deleting these lets TanStack's Vite
  // configResolved/loadEnv hook rehydrate them from the checkout's .env.
  env.DATABASE_URL = "";
  env.VERCEL = "";
  env.VERCEL_ENV = "";
  // The ordinary suite is deterministic and free even when its parent shell
  // was previously used for an opt-in provider evaluation. Live model tests
  // have their own `npm run test:live-model` entry point.
  env.RUN_LIVE_MODEL_TESTS = "";
  env.TOWNREPORTER_TEST_ENV_VERIFIED = "1";
  return env;
}
