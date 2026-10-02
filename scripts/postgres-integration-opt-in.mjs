/**
 * Late preload for an explicitly requested PostgreSQL integration run.
 * Ordinary runners clear TEST_POSTGRES_ADMIN_URL first; this restores the
 * separately carried admin URL only after test-environment-guard has run.
 *
 * THE PORT CHECK BELOW IS NOT DECORATION. Everything this lane does is
 * destructive to databases -- it creates them, migrates them, drops them, and
 * sweeps leftovers by name -- and port 5433 is the live paper's Postgres on
 * the machine that runs it. The host check says "loopback or the CI service",
 * and on that machine loopback IS the live paper, so a guard that stops at the
 * host lets the lane loose on the real data.
 *
 * It also has to read the port the way `pg` does, not the way the URL text
 * looks: `?port=5433` and an inherited `PGPORT=5433` both dial 5433 while the
 * string itself says nothing about a port. ops\lib-postgres-url.mjs is the one
 * implementation of that, and the promotion's own guard uses the same one.
 */
import { LIVE_POSTGRES_PORT, targetsLivePostgres } from "../ops/lib-postgres-url.mjs";

if (process.env.TOWNREPORTER_RUN_POSTGRES_INTEGRATION !== "1") {
  throw new Error("PostgreSQL integration preload requires TOWNREPORTER_RUN_POSTGRES_INTEGRATION=1.");
}

const raw = process.env.TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL?.trim();
if (!raw) {
  throw new Error("PostgreSQL integration preload requires TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL.");
}

if (targetsLivePostgres(raw)) {
  throw new Error(
    `Refusing a PostgreSQL integration admin URL on port ${LIVE_POSTGRES_PORT}: that is the live paper's ` +
      "database on the machine that runs it, and this lane creates and drops databases. Point " +
      "TEST_POSTGRES_ADMIN_URL at a throwaway server.",
  );
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
