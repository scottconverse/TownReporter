/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Pre-wired for live preview + deploy — do not rewrite this file. To enable
 * local email/password, flip the flag in `./email-password` only (see auth skill).
 *
 * The app runs its own Better Auth at `/api/auth/*`, so the session cookie stays
 * on this app's own origin. Sign-in federates to the shared **Grok auth broker**
 * (`GROK_AUTH_ISSUER`) via the `genericOAuth` plugin — the broker brokers the
 * upstream sign-in methods (Google, X, …) and holds their shared secrets; this
 * app only holds its own client id/secret and names the upstream it wants via
 * each provider's `idp` hint.
 *
 * Tri-mode:
 *   - Deployed: the deployer injects a per-app `GROK_AUTH_*` + `BETTER_AUTH_URL`
 *     + `DATABASE_URL`, so real federated auth is persisted in Postgres.
 *   - Sandbox live preview: no injection -> falls back to the shared **preview
 *     client** (`./preview`) and derives the preview's `https://*.grok-sandbox.com`
 *     origin from the request, so real sign-in works (no demo users). Sessions
 *     and identities persist in the embedded PGLite DB (same DB as app data);
 *     the process restart wipes both. Live-preview iframe clients use a bearer
 *     token (partitioned cookies) — see `client.ts`.
 *   - Off (`VITE_AUTH_ENABLED=false`, the shipped default): no providers;
 *     `requireUserId` resolves a dev user with no database configured, and
 *     throws fail-closed once `DATABASE_URL` is set (see `verify.server.ts`).
 *
 * NEVER import this from client code — it pulls in `pg` + the preview secret +
 * server-only Better Auth internals. The client uses `@/lib/auth/client`;
 * components read the user via `@/lib/auth/use-current-user`; server functions get
 * a verified id via `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { bearer, genericOAuth } from "better-auth/plugins";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { accountSignInLockout } from "./account-lockout.server";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { GATE_PROVIDER_ID, gateIdentitySessions, safeTanstackStartCookies } from "./gate-session.server";
import { GROK_PROVIDERS } from "./providers";
import { pgliteDialect } from "./pglite-dialect";
import {
  GROK_ISSUER_DEFAULT,
  PREVIEW_ALLOWED_HOSTS,
  PREVIEW_CLIENT_ID,
  PREVIEW_CLIENT_SECRET,
} from "./preview";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/**
 * Preview secret must outlive module reloads: PGLite (and its session rows) is
 * stored on `globalThis`, so an HMR re-eval of this file must NOT mint a new
 * signing secret or every existing session becomes invalid mid-dev. Process
 * restart clears both the secret and PGLite together.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __grokAuthPreviewSecret__?: string;
};
/**
 * The signing secret, or a refusal.
 *
 * With no BETTER_AUTH_SECRET this minted a fresh random one per process. In a
 * preview that is right -- sessions live in an in-memory database that dies
 * with the process anyway, and a stable secret across a hot reload is the
 * whole point.
 *
 * On a real install it is a quiet trap. Every restart invalidates every
 * session, so the journalist is signed out with no message and no reason,
 * and on this product a watchdog restarts the app whenever it looks unwell.
 * The symptom -- 'it keeps logging me out' -- points nowhere near the cause,
 * and there is no password reset to fall back on. A gate audit filed it as
 * ENG-109.
 *
 * A real DATABASE_URL is what tells the two apart: sessions that outlive the
 * process need a secret that outlives it too. So that case refuses to start
 * and says how to fix it, rather than starting and behaving strangely later.
 * Refusing at boot is the kinder failure: it happens once, at the moment
 * somebody is already looking at the terminal.
 */
function previewAuthSecret(): string {
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
  globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__grokAuthPreviewSecret__;
}

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

// Explicit off-switch. The deployer sets `VITE_AUTH_ENABLED=true` when it
// provisions auth; set it to "false" to force auth off everywhere (dev user).
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

// Broker federation creds: the deployer injects a per-app client when deployed;
// otherwise fall back to the shared live-preview client, which the broker accepts
// for any `*.grok-sandbox.com` callback (see `./preview`).
const grokIssuer = env("GROK_AUTH_ISSUER") ?? GROK_ISSUER_DEFAULT;
const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;

/** True when federated sign-in is active (real auth is enforced). */
export const authConfigured =
  !authDisabled && Boolean(grokClientId && grokClientSecret);

// This app's own Better Auth origin. When deployed the deployer injects the
// public URL. In the sandbox live preview there's no fixed URL (each preview gets
// a dynamic `*.grok-sandbox.com` host), so we hand Better Auth a dynamic baseURL:
// it derives the origin per-request from the (proxied) host, validated against the
// preview allowlist, which makes the OAuth `redirect_uri` the concrete preview URL
// the broker's preview client accepts.
const explicitBaseURL = env("BETTER_AUTH_URL");
// Explicit `string[]` (not a readonly tuple) — Better Auth's DynamicBaseURLConfig
// requires a mutable `allowedHosts: string[]`.
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];
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
  // Include loopback hosts so dynamic baseURL resolves for local email/password
  // (not only the preview wildcard).
  allowedHosts: [...previewAllowedHosts, "localhost", "127.0.0.1", "[::1]"],
  // `auto` → trust both http:// and https:// expansions of allowedHosts
  // (preview is https; local dev is http).
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, etc.).
// Missing entries here surface as FORBIDDEN "Invalid origin".
const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...extraTrustedOrigins, ...LOCAL_DEV_ORIGINS]
  : [
      // Host wildcards (matched against Origin's host)
      ...previewAllowedHosts,
      // Full-origin wildcards (matched against Origin)
      ...previewAllowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
      ...extraTrustedOrigins,
      ...LOCAL_DEV_ORIGINS,
    ];

const databaseUrl = env("DATABASE_URL");

// Static broker OAuth endpoints (skip OIDC discovery on every sign-in / callback).
// Discovery would cost an extra network hop to the broker before the popup can
// even redirect to Google/X — the live-preview popup felt stuck on the app for
// that whole round-trip. These paths match the broker's discovery document.
const issuerBase = grokIssuer.replace(/\/+$/, "");
const grokAuthorizationUrl = `${issuerBase}/api/auth/oauth2/authorize`;
const grokTokenUrl = `${issuerBase}/api/auth/oauth2/token`;
const grokUserInfoUrl = `${issuerBase}/api/auth/oauth2/userinfo`;

// Real Postgres when `DATABASE_URL` is set (deployed apps), else the app's
// embedded PGLite (preview) via a Kysely dialect — so Better Auth persists to the
// SAME DB as app data, including email/password users. Both use the Better Auth
// schema from `migrations/auth/0001_auth.sql`, copied into `migrations/` when
// the app turns sign-in on.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie name — also read by the live-preview popup completion page. */
export const SESSION_TOKEN_COOKIE = "__Host-grok-auth.session_token";

// Built separately so the `betterAuth({...})` call stays easy to edit without
// breaking brackets (models often trip on the conditional plugin spread).
const grokOAuthPlugin = authConfigured
  ? genericOAuth({
      config: GROK_PROVIDERS.map(({ providerId, idp }) => ({
        providerId,
        clientId: grokClientId as string,
        clientSecret: grokClientSecret as string,
        // Prefer static endpoints over `discoveryUrl` so initiating (and
        // completing) OAuth does not wait on a broker discovery fetch.
        authorizationUrl: grokAuthorizationUrl,
        tokenUrl: grokTokenUrl,
        userInfoUrl: grokUserInfoUrl,
        scopes: ["openid", "profile", "email"],
        // `prompt: "login"` forces the broker to re-authenticate against the
        // upstream on every sign-in instead of silently reusing an existing
        // broker session. Combined with the broker sending Google
        // `prompt=select_account`, the user always gets the account chooser
        // and can pick (or switch) which account to sign in with.
        authorizationUrlParams: { idp, prompt: "login" },
      })),
    })
  : null;

export const auth = betterAuth({
  baseURL,
  // Deployed apps inject BETTER_AUTH_SECRET. Preview: process-stable secret on
  // globalThis so HMR doesn't invalidate PGLite-backed sessions (see above).
  secret: env("BETTER_AUTH_SECRET") ?? previewAuthSecret(),
  database,

  // CSRF / origin check for credentialed auth POSTs (email sign-up/sign-in, …).
  // See `trustedOrigins` construction above — must cover live preview hosts AND
  // local loopback variants, or clients get "Invalid origin".
  trustedOrigins,

  // Encrypt broker-issued OAuth tokens at rest, and treat the broker's upstreams
  // as trusted first-party identities. The broker owns identity and X emails are
  // synthetic/unverified, so WITHOUT this a login can fail with
  // `account_not_linked` (Better Auth refuses to attach an untrusted, unverified
  // identity to an existing user). Google and X carry DISTINCT emails, so this
  // never merges them into one user — they stay separate identities.
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [
        ...GROK_PROVIDERS.map((p) => p.providerId),
        GATE_PROVIDER_ID,
      ],
      // X's synthetic email is never "verified", so don't gate linking on the
      // local user's email-verified state.
      requireLocalEmailVerified: false,
    },
  },

  // Cache the session in the short-lived signed `session_data` cookie so reads
  // (incl. the client's `/get-session`) skip the DB — this shrinks the "loading"
  // window and reduces auth flicker. See the `auth` skill for the full
  // flicker-prevention guidance (gate on `isPending`; SSR the session).
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

  // After the newsroom has an owner, new Better Auth users (email or OAuth) are
  // a dead door. Existing editor sign-in is unchanged.
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          const { deskIsClaimed } = await import("../news/membership");
          if (await deskIsClaimed()) {
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
  // carries a `Domain` attribute, so a sibling `*.grok.me` app cannot "toss" a
  // `Domain=.grok.me` session cookie onto this app. `__Host-` requires Secure +
  // Path=/ + no Domain; Better Auth otherwise uses `__Secure-` (which permits
  // Domain), so we drop its auto prefix (`useSecureCookies: false`) and set
  // Secure + the names ourselves. (Browsers allow Secure cookies on
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
      session_data: { name: "__Host-grok-auth.session_data" },
      account_data: { name: "__Host-grok-auth.account_data" },
      dont_remember: { name: "__Host-grok-auth.dont_remember" },
    },
  },

  plugins: [
    gateIdentitySessions(),

    // Per-account sign-in lockout -- keys on the email being attacked, not on
    // any request header, so it still holds when `cf-connecting-ip` /
    // `x-forwarded-for` are attacker-chosen. See `account-lockout.server.ts`.
    accountSignInLockout(),

    // One genericOAuth provider per upstream (when auth is on), all federating
    // to the broker with the SAME client and differing only by the `idp` hint.
    ...(grokOAuthPlugin ? [grokOAuthPlugin] : []),

    // Accept `Authorization: Bearer <session-token>` as an alternative to the
    // cookie. Needed for the LIVE PREVIEW: the app runs in an embedded iframe
    // where cookies are partitioned, so after popup sign-in it authenticates with
    // a bearer token instead (see `client.ts` / the `auth` skill). The hook only
    // fires when an Authorization header is present, so the cookie path
    // (deployed apps) is unaffected.
    bearer(),

    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks. Safe wrapper: the stock
    // plugin throws when setCookie is missing and kills Redraft.
    safeTanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

// Re-exported for convenience; the array lives in the dependency-free
// `providers.ts` so the client can import it too.
export { GROK_PROVIDERS } from "./providers";
