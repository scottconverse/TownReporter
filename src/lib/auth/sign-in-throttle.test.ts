import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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

/*
  A second server, on its own scratch database and its own port, with a
  SHRUNK account-lockout window (`ACCOUNT_LOCKOUT_WINDOW_SECONDS` /
  `ACCOUNT_LOCKOUT_MAX_ATTEMPTS` -- see account-lockout.server.ts). The
  production defaults (10 attempts / 15 minutes) are deliberately
  conservative for a desk with no password reset; a test cannot honestly wait
  15 real minutes for a window to lapse, so this server gets a 3-second one
  instead, purely so "the lock lifts on its own" is something this file can
  actually observe rather than assert about the source text.
*/
const PORT_LOCKOUT = 3863;
const BASE_URL_LOCKOUT = `http://127.0.0.1:${PORT_LOCKOUT}`;
const dbNameLockout = `townreporter_test_throttle_lockout_${process.pid}_${Date.now()}`;
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 3;
const OPERATOR_EMAIL = "editor@townreporter.test";
const OPERATOR_PASSWORD = "correct horse battery staple 42";

let server: ChildProcess | undefined;
let serverLockout: ChildProcess | undefined;

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

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; text: string };

/**
 * A plain `POST`, deliberately NOT the global `fetch()`.
 *
 * Node's `fetch()` (undici) always sends `Sec-Fetch-Mode: cors` on every
 * request, browser or not. Better Auth's CSRF middleware (`formCsrfMiddleware`
 * in origin-check.mjs) treats the presence of any `Sec-Fetch-*` header as
 * proof a browser is asking, and then REQUIRES an `Origin` header -- which
 * this test, deliberately simulating a direct client with no page or Origin
 * of its own (the same shape of client the original audit used), does not
 * send. Sent through `fetch()`, that combination gets 403 "Missing or null
 * Origin" on every single attempt, wrong password or right, and would make
 * this file measure Node's fetch implementation instead of the throttle.
 * `node:http` sends none of that, matching how the audit's own tool (curl)
 * behaves, and how a script hitting `/api/auth/sign-in/email` directly (not
 * through a browser page) behaves.
 */
function rawPost(
  baseUrl: string,
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...extraHeaders,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function signIn(email: string, password: string, ip: string, baseUrl = BASE_URL): Promise<RawResponse> {
  return rawPost(baseUrl, "/api/auth/sign-in/email", { email, password }, { "cf-connecting-ip": ip });
}

async function dropDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: PSQL_ADMIN_URL });
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbNameLockout}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    const dbUrlLockout = withDatabase(PSQL_ADMIN_URL, dbNameLockout);
    await ensureBuilt(repoRoot);
    await run(process.execPath, [join(repoRoot, "scripts", "migrate.mjs")], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });
    await run(process.execPath, [join(repoRoot, "scripts", "migrate.mjs")], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrlLockout,
    });

    server = spawnBuiltServer(repoRoot, dbUrl, PORT);
    serverLockout = spawnBuiltServer(repoRoot, dbUrlLockout, PORT_LOCKOUT, {
      ACCOUNT_LOCKOUT_MAX_ATTEMPTS: String(LOCKOUT_MAX_ATTEMPTS),
      ACCOUNT_LOCKOUT_WINDOW_SECONDS: String(LOCKOUT_WINDOW_SECONDS),
    });
    await Promise.all([
      waitForServer(BASE_URL, 30_000),
      waitForServer(BASE_URL_LOCKOUT, 30_000),
    ]);

    // The one editor account this desk will ever have -- created here so the
    // lockout tests below have a real password to sign in with, not just a
    // nonexistent email that always 401s.
    const signUpRes = await rawPost(
      BASE_URL_LOCKOUT,
      "/api/auth/sign-up/email",
      { name: "The Editor", email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD },
      // sign-up (unlike sign-in) goes through Better Auth's CSRF origin
      // check, which rejects a request with no Origin header at all.
      { origin: BASE_URL_LOCKOUT },
    );
    if (signUpRes.status !== 200) {
      throw new Error(
        `could not create the test operator account (status ${signUpRes.status}): ${signUpRes.text}`,
      );
    }
  }, 180_000);

  after(async () => {
    server?.kill();
    serverLockout?.kill();
    await dropDatabase(dbName);
    await dropDatabase(dbNameLockout);
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
    let last: RawResponse | undefined;
    for (let i = 0; i < 20; i += 1) {
      last = await signIn("nobody@example.com", "guess-the-password", ip);
      if (last.status === 429) break;
    }
    assert.equal(last?.status, 429, "could not reach a throttled state to read its window");
    // Better Auth (and this app's own account-level lock) stamp X-Retry-After
    // with the rule's window in seconds (see getRetryAfter in the
    // rate-limiter source, and account-lockout.server.ts) -- reading it off a
    // live 429 proves the actual configured value without waiting the window
    // out.
    const retryAfterHeader = last?.headers["x-retry-after"];
    const retryAfter = Number(retryAfterHeader);
    assert.ok(
      Number.isFinite(retryAfter) && retryAfter >= 60,
      `X-Retry-After was ${retryAfterHeader}; a window under 60s stops a ` +
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

/**
 * The bug the rest of this file cannot see: every test above sends its whole
 * burst from ONE `cf-connecting-ip`, so the network-address throttle alone
 * is enough to pass them. A gate audit found that rotating the header defeats
 * that throttle -- measured at 24 of 25 wrong passwords reaching the password
 * check -- because the bucket key is the header value, which is ordinary
 * client-supplied text to anything not behind a genuine Cloudflare edge.
 *
 * `accountSignInLockout()` (src/lib/auth/account-lockout.server.ts) is the
 * fix: it buckets by the account being attacked, which no header rotates.
 * This describe block runs the SAME experiment the audit ran -- 25 wrong
 * passwords, 25 different `cf-connecting-ip` values -- against the second
 * server (shrunk lockout window, see above) and shows what happens now.
 */
describe("a rotating cf-connecting-ip cannot move the account-level lock", () => {
  it("stops a burst of wrong-password guesses well short of 25, even though every request uses a fresh address", { skip }, async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 25; i += 1) {
      const res = await signIn(OPERATOR_EMAIL, "guess-the-password", `203.0.113.${i}`, BASE_URL_LOCKOUT);
      statuses.push(res.status);
    }
    const reachedPasswordCheck = statuses.filter((s) => s === 401).length;
    const blocked = statuses.filter((s) => s === 429).length;
    assert.ok(
      reachedPasswordCheck <= LOCKOUT_MAX_ATTEMPTS,
      `${reachedPasswordCheck} of 25 rotating-address guesses reached the password check ` +
        `(statuses: ${statuses.join(",")}); the account lock allows at most ${LOCKOUT_MAX_ATTEMPTS} ` +
        "before it should start blocking regardless of address",
    );
    assert.ok(
      blocked >= 25 - LOCKOUT_MAX_ATTEMPTS,
      `only ${blocked} of 25 rotating-address guesses were blocked (statuses: ${statuses.join(",")}); ` +
        "this is the exact scenario the audit measured at 24-of-25 getting through",
    );
  });

  it(
    "locks the real operator out too while the attack is live, and lets her in once the window passes",
    { skip },
    async () => {
      // This reuses the operator account the previous test just locked (a
      // desk has exactly one editor, so signing up a second is impossible
      // once claimed). Wait out a full window first so this test starts from
      // an unlocked account rather than inheriting the previous test's state.
      await new Promise((r) => setTimeout(r, (LOCKOUT_WINDOW_SECONDS + 1) * 1000));

      const attackerStatuses: number[] = [];
      for (let i = 1; i <= LOCKOUT_MAX_ATTEMPTS + 2; i += 1) {
        const res = await signIn(
          OPERATOR_EMAIL,
          "guess-the-password",
          `198.51.100.${i}`,
          BASE_URL_LOCKOUT,
        );
        attackerStatuses.push(res.status);
      }
      assert.ok(
        attackerStatuses.includes(429),
        `never got blocked after ${attackerStatuses.length} rotating-address guesses ` +
          `(statuses: ${attackerStatuses.join(",")})`,
      );

      // The design choice this test exists to make explicit: a lockout keyed
      // on the account cannot tell the attacker's request from the real
      // journalist's, so while the account is locked, the CORRECT password
      // from a brand new address is blocked too. That is the tradeoff
      // documented in account-lockout.server.ts -- bounded and self-healing
      // beats "the attacker can sign in as the operator", but it is still a
      // real cost, and this asserts it happens rather than hoping it doesn't.
      const duringAttack = await signIn(
        OPERATOR_EMAIL,
        OPERATOR_PASSWORD,
        "198.51.100.250",
        BASE_URL_LOCKOUT,
      );
      assert.equal(
        duringAttack.status,
        429,
        "the correct password from an address the attacker never touched should still be " +
          "blocked while the account lock is tripped -- this is the documented tradeoff, not a bug",
      );

      // Wait out the (shrunk, test-only) window. In production this is 15
      // minutes with no operator action required; here it is a few seconds
      // so the test can actually observe the self-healing rather than assert
      // it exists.
      await new Promise((r) => setTimeout(r, (LOCKOUT_WINDOW_SECONDS + 1.5) * 1000));

      const afterAttack = await signIn(
        OPERATOR_EMAIL,
        OPERATOR_PASSWORD,
        "198.51.100.251",
        BASE_URL_LOCKOUT,
      );
      assert.equal(
        afterAttack.status,
        200,
        "the real operator, with the correct password, from an address never used in the " +
          "attack, must be able to sign in once the lockout window has passed on its own -- " +
          `a desk with no password reset cannot depend on anyone noticing and intervening ` +
          `(body: ${afterAttack.text})`,
      );
    },
  );
});
