/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Do not rewrite this file. To enable local email/password, flip the flag in
 * `./email-password` only.
 *
 * The app runs its own Better Auth at `/api/auth/*`, so the session cookie stays
 * on this app's own origin, and the desk is signed in with the email and
 * password the owner set on it. There is no OAuth provider and no federated
 * sign-in of any kind: no broker holds this paper's identities, and the only
 * credential that leaves the box is the request the editor types into the form.
 *
 *   - Deployed / self-hosted: the owner sets `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`
 *     and `DATABASE_URL`, so sessions persist in Postgres.
 *   - Off (`VITE_AUTH_ENABLED=false`): no providers; `requireUserId` resolves a
 *     dev user with no database configured, and throws fail-closed once
 *     `DATABASE_URL` is set (see `verify.server.ts`).
 *
 * NEVER import this from client code — it pulls in `pg` + server-only Better
 * Auth internals. The client uses `@/lib/auth/client`; components read the user
 * via `@/lib/auth/use-current-user`; server functions get a verified id via
 * `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { accountSignInLockout } from "./account-lockout.server";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { pgliteDialect } from "./pglite-dialect";
import { safeTanstackStartCookies } from "./tanstack-cookies.server";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/**
 * The signing secret must outlive module reloads: PGLite (and its session rows)
 * is stored on `globalThis`, so an HMR re-eval of this file must NOT mint a new
 * signing secret or every existing session becomes invalid mid-dev. Process
 * restart clears both the secret and PGLite together.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __trAuthSecret__?: string;
};
/**
 * The signing secret, or a refusal.
 *
 * With no BETTER_AUTH_SECRET this mints a fresh random one per process. With no
 * database that is right -- sessions live in an in-memory PGLite that dies with
 * the process anyway, and a stable secret across a hot reload is the whole
 * point.
 *
 * On a real install it is a quiet trap. Every restart invalidates every
 * session, so the journalist is signed out with no message and no reason, and
 * on this product a watchdog restarts the app whenever it looks unwell. The
 * symptom -- 'it keeps logging me out' -- points nowhere near the cause, and
 * there is no password reset to fall back on. A gate audit filed it as ENG-109.
 *
 * A real DATABASE_URL is what tells the two apart: sessions that outlive the
 * process need a secret that outlives it too. So that case refuses to start
 * and says how to fix it, rather than starting and behaving strangely later.
 * Refusing at boot is the kinder failure: it happens once, at the moment
 * somebody is already looking at the terminal.
 */
function localAuthSecret(): string {
  const persistentDatabase = Boolean(process.env.DATABASE_URL?.trim());
  if (persistentDatabase) {
    // A template literal, so the message needs no escape sequences at all --
    // an earlier attempt at this block lost its newline escape three times to
    // the shell that wrote it, and the linter cannot see a mangled one.
    throw new Error(
      [
        `BETTER_AUTH_SECRET is not set.`,
        ``,
        `Sessions are signed with it. Without one this process invents a secret`,
        `that dies when it does, so every restart signs the editor out with no`,
        `explanation -- and the watchdog restarts this app on its own.`,
        ``,
        `Generate one and put it in .env:`,
        ``,
        `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
        ``,
        `  BETTER_AUTH_SECRET=<the value it printed>`,
      ].join(String.fromCharCode(10)),
    );
  }
  globalAuthRef.__trAuthSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__trAuthSecret__;
}

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/**
 * True when this process enforces auth.
 *
 * Auth is enforced unless `VITE_AUTH_ENABLED=false` -- that is the whole rule.
 * A self-hosted paper signs its editor in with email and password; there is no
 * broker to be configured or not configured, so there is no second question to
 * ask.
 */
export const authConfigured = process.env.VITE_AUTH_ENABLED !== "false";

// This app's own Better Auth origin. `BETTER_AUTH_URL` names the public URL the
// deployer or self-hoster reaches the paper on; with it unset the dynamic
// baseURL below derives the origin per-request from the (proxied) host, so a
// local `npm run dev` on any port still works.
const explicitBaseURL = env("BETTER_AUTH_URL");

// Local `npm run dev` (port 8080 contract). Browsers may send Origin as any of
// these for the same server — trusting only `localhost` rejects `127.0.0.1` and
// breaks email/password with "Invalid origin".
// `npm run dev` uses 8080; a self-hosted `npm start` uses whatever PORT says
// (3000 by default). Trust both, or signing in on the deployed port fails with
// "Invalid origin" even though the site loads fine.
const localPort = process.env.PORT?.trim() || "3000";
const LOCAL_DEV_ORIGINS: string[] = [
  ...new Set([
    `http://localhost:${localPort}`,
    `http://127.0.0.1:${localPort}`,
    `http://[::1]:${localPort}`,
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ]),
];

/**
 * Extra origins the operator explicitly trusts, comma-separated.
 *
 * `BETTER_AUTH_URL` names ONE origin. A self-hosted paper is reached from more
 * than one — the public domain, `www`, and localhost on the box itself — and an
 * origin missing here is rejected at sign-in with "Invalid origin" while every
 * page still renders, which reads like a broken password rather than config.
 */
const extraTrustedOrigins: string[] = (env("BETTER_AUTH_TRUSTED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const baseURL = explicitBaseURL ?? {
  // Include loopback hosts so dynamic baseURL resolves for local email/password.
  allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
  // `auto` → trust both http:// and https:// expansions of allowedHosts
  // (local dev is http, a tunnel in front of it is https).
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, etc.).
// Missing entries here surface as FORBIDDEN "Invalid origin". The entries are
// full origins, not bare hosts: a host-only entry would trust every port on it,
// and the loopback contract is the two ports above and no others.
const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...extraTrustedOrigins, ...LOCAL_DEV_ORIGINS]
  : [...extraTrustedOrigins, ...LOCAL_DEV_ORIGINS];

const databaseUrl = env("DATABASE_URL");

// Real Postgres when `DATABASE_URL` is set (deployed apps), else the app's
// embedded PGLite via a Kysely dialect — so Better Auth persists to the SAME DB
// as app data, including email/password users. Both use the Better Auth schema
// from `migrations/auth/0001_auth.sql`, copied into `migrations/` when the app
// turns sign-in on.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/**
 * Session token cookie name, and the only cookie this app's browser session
 * lives in.
 *
 * Renamed in 0.6.83 (see CHANGELOG.md for the name it replaced): the old name
 * was inherited from the sandbox this repository was exported out of, and every
 * operator who opened dev-tools saw another product's name on their own paper's
 * cookie. A rename invalidates existing sessions — the browser simply does not
 * send the old cookie name any more, and a stale one sitting in a visitor's
 * cookie jar is ignored rather than acted on, so the request is merely
 * unauthenticated and lands on /login — which is why every editor signs in once
 * after updating. That one-time cost is the whole reason this shipped on its
 * own.
 *
 * `__Host-` is load-bearing, not decoration: a browser REFUSES any same-named
 * cookie carrying a `Domain` attribute, so no sibling host can toss a
 * `Domain=.example.com` session cookie onto this app's origin.
 */
export const SESSION_TOKEN_COOKIE = "__Host-tr-auth.session_token";
const SESSION_DATA_COOKIE = "__Host-tr-auth.session_data";
const ACCOUNT_DATA_COOKIE = "__Host-tr-auth.account_data";
const DONT_REMEMBER_COOKIE = "__Host-tr-auth.dont_remember";

export const auth = betterAuth({
  baseURL,
  // Deployed apps inject BETTER_AUTH_SECRET. With no database: a
  // process-stable secret on globalThis so HMR doesn't invalidate
  // PGLite-backed sessions (see above).
  secret: env("BETTER_AUTH_SECRET") ?? localAuthSecret(),
  database,

  // CSRF / origin check for credentialed auth POSTs (email sign-up/sign-in, …).
  // See `trustedOrigins` construction above — must cover local loopback
  // variants, or clients get "Invalid origin".
  trustedOrigins,

  // Cache the session in the short-lived signed `session_data` cookie so reads
  // (incl. the client's `/get-session`) skip the DB — this shrinks the "loading"
  // window and reduces auth flicker.
  session: { cookieCache: { enabled: true, maxAge: 300 } },

  /*
    Sign-in throttling, on by default rather than by environment.

    An audit sent eighty wrong passwords in 6.3 seconds against a built server
    and got eighty 401s with no delay and no lockout. Better Auth does ship a
    rule for this -- three attempts per ten seconds on /sign-in and /sign-up --
    but `enabled` defaults to `isProduction`, and this app is started by a
    Windows scheduled task running `node .output/server/index.mjs`, which sets
    no NODE_ENV. So the protection existed and was switched off on the one
    deployment that is actually exposed to the internet.

    Not left to an environment variable. The desk is a single account with no
    password reset, reachable through a Cloudflare Tunnel, and it carries
    controls that restart services on the operator's own machine. A guess-rate
    limit there should not depend on a variable someone has to remember to set.

    The custom rule is the slow half. The built-in ten-second window stops a
    burst; ten attempts per five minutes stops the patient version, which is
    the one that works against a single known account.

    Storage is in memory, so a restart clears the counters. That is a real
    limit, written down rather than papered over: it is bounded by how often
    the process restarts, not by anything an attacker controls.

    All of the above buckets by the visitor's address (see the `ipAddress`
    comment in `advanced` below), so it is only as strong as that address is
    genuine. `accountSignInLockout()` in the plugins list is the backstop
    that does not depend on it: it buckets by the account being attacked, not
    by anything the caller sends, so rotating a header cannot move it. See
    `account-lockout.server.ts` for the full design and why it locks out the
    real operator too rather than only the attacker.
  */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 200,
    customRules: {
      "/sign-in/email": { window: 300, max: 10 },
      "/sign-up/email": { window: 3600, max: 5 },
    },
  },

  // Local email/password — toggled only via `./email-password` (not a plugin).
  ...(emailAndPasswordEnabled ? { emailAndPassword: { enabled: true } } : {}),

  // After the newsroom has an owner, new Better Auth users are a dead door --
  // with one keyed opening: an unexpired, unused invite minted by the owner FOR
  // THIS EXACT ADDRESS lets the signup through. The invite is burned (and the
  // editor seat written) in acceptInvite, after sign-in.
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          const { signupOpenFor } = await import("../news/membership");
          if (!(await signupOpenFor(user.email ?? ""))) {
            throw new Error(
              "This desk already has an editor. Sign in if that's you.",
            );
          }
          return { data: user };
        },
      },
    },
  },

  // `__Host-` prefixed cookies: the browser REFUSES any same-named cookie that
  // carries a `Domain` attribute, so no sibling app on a shared parent domain
  // can "toss" a `Domain=` session cookie onto this app. `__Host-` requires
  // Secure + Path=/ + no Domain; Better Auth otherwise uses `__Secure-` (which
  // permits Domain), so we drop its auto prefix (`useSecureCookies: false`) and
  // set Secure + the names ourselves. (Browsers allow Secure cookies on
  // `http://localhost`, so local dev still works.)
  advanced: {
    /*
      Who the throttle counts, when the paper is behind a tunnel.

      The rate limiter buckets by client IP, which is the property that keeps it
      a defence rather than a weapon: an attacker exhausts their own bucket, not
      the operator's. That only holds if the real visitor address can be read.

      This deployment serves the public through a Cloudflare Tunnel, so every
      request arrives at 127.0.0.1 from cloudflared. Left at the default the
      limiter would file the whole internet under one key, and ten wrong
      passwords from a stranger would lock the journalist out of their own desk
      -- turning the fix into the outage.

      `cf-connecting-ip` is set by Cloudflare's edge and cannot be forged by a
      visitor coming through the tunnel; `x-forwarded-for` is the fallback for
      any other front end. Something on the same LAN hitting the port directly
      could spoof either header -- and, having done so, is no longer "no worse
      off than before this existed": a forged header lets it pick a fresh
      bucket on every request, which is a way *around* this throttle, not
      merely a way to be as unguarded as if it were absent. Measured: 25 wrong
      passwords from a fixed header gets 10 refusals then blocked; the same 25
      rotating the header through 25 values gets 24 through. `account-lockout
      .server.ts`'s per-account lock is the backstop for exactly that case --
      it keys on the email being attacked, which no header can rotate.
    */
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    },
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: SESSION_DATA_COOKIE },
      account_data: { name: ACCOUNT_DATA_COOKIE },
      dont_remember: { name: DONT_REMEMBER_COOKIE },
    },
  },

  plugins: [
    // Per-account sign-in lockout -- keys on the email being attacked, not on
    // any request header, so it still holds when `cf-connecting-ip` /
    // `x-forwarded-for` are attacker-chosen. See `account-lockout.server.ts`.
    accountSignInLockout(),

    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks. Safe wrapper: the stock
    // plugin throws when setCookie is missing and kills Redraft.
    safeTanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}
