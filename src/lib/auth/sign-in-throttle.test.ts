import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import {
  ensureBuilt,
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  spawnBuiltServer,
  waitForServer,
  withDatabase,
  type ChildProcess,
} from "../test-support/pg-admin.ts";
import { join } from "node:path";

/**
 * Password guessing must actually be throttled. Executable contract, not text.
 *
 * The previous version of this file read server.ts and pattern-matched
 * `rateLimit: { enabled: true` and the customRules block. It went green when
 * `rateLimit.enabled` was flipped to `false` and the live block was preserved
 * verbatim inside a `/* previously: *\/` comment two lines below -- the regex
 * anchored on `rateLimit:\s*\{` and never looked at what came after `enabled:`
 * closely enough to notice the block it matched was dead. A comment satisfies
 * a grep. It does not satisfy an attacker.
 *
 * This version builds the app, boots the real compiled server (the one
 * `node .output/server/index.mjs` runs in production) against a disposable
 * scratch database, and sends it real `/api/auth/sign-in/email` requests. It
 * cannot be fooled by a comment, an import, or a nearby unrelated `enabled:
 * true`, because it never reads server.ts at all -- it reads the server's
 * responses. `src/lib/auth/server.ts` is unimportable directly under Node's
 * `--experimental-strip-types` (pglite-dialect.ts uses TypeScript parameter
 * properties, which strip-only mode explicitly rejects), so a real HTTP round
 * trip against the build is not a preference here, it is the only route in.
 *
 * This needs a real Postgres reachable at `TEST_POSTGRES_ADMIN_URL` (or the
 * local default -- see src/lib/test-support/pg-admin.ts). Without one it
 * skips, with a reason, rather than failing a machine that has no database at
 * all. CI runs it for real: see the `postgres-integration` job in
 * .github/workflows/ci.yml.
 *
 * Three things this proves, all from the wire, none from the source text:
 *
 *   1. throttling is actually on: a burst of wrong-password attempts against
 *      one account gets cut off well short of Better Auth's default 3-per-10s
 *      -- if it were not, either every attempt would keep returning 401, or
 *      the built server would 500 fetching a config it never enabled;
 *   2. the window is long enough to matter: Better Auth stamps a 429 with an
 *      `X-Retry-After` header equal to the configured window (see
 *      node_modules/better-auth/dist/api/rate-limiter/index.mjs,
 *      `getRetryAfter`), so the actual configured seconds are readable
 *      without waiting seconds for them;
 *   3. the limiter buckets by the header the tunnel sets, not by socket
 *      address: a second `cf-connecting-ip` gets its own budget. Every
 *      request in this file arrives from 127.0.0.1, so this is the one
 *      property that would be invisible without spoofing the header --
 *      which is exactly the situation the real Cloudflare Tunnel deployment
 *      is in.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
const PORT = 3861;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_throttle_${process.pid}_${Date.now()}`;

let server: ChildProcess | undefined;

/*
  Opt-in, because this file builds the app and boots a server.

  Five files do that. Node's test runner starts files concurrently, so on any
  machine with Postgres on the default port they all did it at once during an
  ordinary `npm test` -- and seven unrelated database tests then timed out,
  starved rather than broken. TEST_POSTGRES_ADMIN_URL is the switch; the
  postgres-integration CI job sets it and names this file, and a gate fails if
  it ever stops doing so.
*/
const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run the integration tests (they build the app and boot a server; the postgres-integration CI job runs them on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

async function signIn(email: string, password: string, ip: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email, password }),
  });
}

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    await ensureBuilt(repoRoot);
    await run(process.execPath, [join(repoRoot, "scripts", "migrate.mjs")], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });

    server = spawnBuiltServer(repoRoot, dbUrl, PORT);
    await waitForServer(BASE_URL, 30_000);
  }, 180_000);

  after(async () => {
    server?.kill();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }, 30_000);
}

describe("sign-in is throttled", () => {
  it(
    "cuts off a burst of wrong-password guesses well short of an unthrottled run",
    { skip },
    async () => {
      const ip = "10.60.1.1";
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) {
        const res = await signIn("nobody@example.com", "guess-the-password", ip);
        statuses.push(res.status);
        if (res.status === 429) break;
      }
      const blockedAt = statuses.indexOf(429);
      assert.ok(
        blockedAt >= 0,
        `sent ${statuses.length} rapid guesses and never got a 429 (statuses: ${statuses.join(",")}); ` +
          "rate limiting is not actually engaged",
      );
      // Better Auth's own default is 3 attempts per 10s; this app's custom rule
      // is meant to be more forgiving for a real operator (10 per 5 minutes)
      // but still bounded. Anything past 20 is the "no real limit" failure mode
      // the original audit found (eighty guesses, eighty 401s).
      assert.ok(
        blockedAt < 20,
        `${blockedAt} wrong-password attempts were allowed before a 429 -- too many for a desk ` +
          "with one account and no password reset",
      );
    },
  );

  it("sets a window long enough to stop a patient attacker, not just a burst", { skip }, async () => {
    const ip = "10.60.1.2";
    let last: Response | undefined;
    for (let i = 0; i < 20; i += 1) {
      last = await signIn("nobody@example.com", "guess-the-password", ip);
      if (last.status === 429) break;
    }
    assert.equal(last?.status, 429, "could not reach a throttled state to read its window");
    // Better Auth stamps X-Retry-After with the configured rule's window in
    // seconds (see getRetryAfter in the rate-limiter source) -- reading it
    // off a live 429 proves the actual configured value without waiting the
    // window out.
    const retryAfter = Number(last?.headers.get("x-retry-after"));
    assert.ok(
      Number.isFinite(retryAfter) && retryAfter >= 60,
      `X-Retry-After was ${last?.headers.get("x-retry-after")}; a window under 60s stops a ` +
        "burst but not the patient attack that works against one known account",
    );
  });

  it("reads the visitor's real address, so an attacker cannot lock out the operator", { skip }, async () => {
    const attackerIp = "10.60.1.3";
    let attackerBlocked = false;
    for (let i = 0; i < 20; i += 1) {
      const res = await signIn("nobody@example.com", "guess-the-password", attackerIp);
      if (res.status === 429) {
        attackerBlocked = true;
        break;
      }
    }
    assert.ok(attackerBlocked, "could not exhaust the attacker IP's budget to set up this check");

    // Behind the tunnel every socket connection is 127.0.0.1; if the limiter
    // ever stopped reading cf-connecting-ip and fell back to the socket
    // address, every visitor -- attacker and operator alike -- would share
    // one bucket, and the attacker above would have just locked everyone out.
    const operatorRes = await signIn(
      "operator@example.com",
      "guess-the-password",
      "10.60.1.200",
    );
    assert.notEqual(
      operatorRes.status,
      429,
      "a different cf-connecting-ip got throttled by another address's attempts -- the limiter " +
        "is not reading the header, so behind the tunnel the whole internet shares one bucket",
    );
  });
});
