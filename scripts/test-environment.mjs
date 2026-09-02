/** Return an isolated environment for the ordinary destructive fixture suite. */
export function safeTestEnvironment(source = process.env) {
  const env = { ...source };
  delete env.DATABASE_URL;
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  // The ordinary suite is deterministic and free even when its parent shell
  // was previously used for an opt-in provider evaluation. Live model tests
  // have their own `npm run test:live-model` entry point.
  delete env.RUN_LIVE_MODEL_TESTS;
  env.TOWNREPORTER_TEST_ENV_VERIFIED = "1";
  return env;
}
