/**
 * Late preload for an explicitly requested PostgreSQL integration run.
 * Ordinary runners clear TEST_POSTGRES_ADMIN_URL first; this restores the
 * separately carried admin URL only after test-environment-guard has run.
 */
if (process.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION !== "1") {
  throw new Error("PostgreSQL integration preload requires TOWNREPORTER_RUN_POSTGRES_INTEGRATION=1.");
}

const raw = process.env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL?.trim();
if (!raw) {
  throw new Error("PostgreSQL integration preload requires TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL.");
}

let admin;
try {
  admin = new URL(raw);
} catch {
  throw new Error("PostgreSQL integration admin URL is invalid.");
}
if (!(["postgres:", "postgresql:"].includes(admin.protocol)) ||
    !["127.0.0.1", "localhost", "[::1]", "postgres"].includes(admin.hostname) ||
    !["/postgres", "/townreporter_dev"].includes(admin.pathname) ||
    admin.search || admin.hash) {
  throw new Error(
    "Refusing PostgreSQL integration admin URL outside the approved disposable targets " +
      "(loopback or CI service host, database postgres or townreporter_dev).",
  );
}

process.env.TEST_POSTGRES_ADMIN_URL = raw;
process.env.TOWNREPORTER_POSTGRES_INTEGRATION_ENABLED = "1";
