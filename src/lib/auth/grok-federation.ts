/**
 * Whether this app federates sign-in to the Grok auth broker, and with which
 * client. No Node built-ins, no `pg`, no Better Auth — so it can be read by a
 * test under `--experimental-strip-types` (which `server.ts` cannot) and by the
 * client if it ever needs to know.
 *
 * Two decisions live here, and they used to be one.
 *
 * ## 1. "Is auth enforced?" is not "is Grok configured?"
 *
 * `authConfigured` was `!disabled && Boolean(grokClientId && grokClientSecret)`.
 * That reads as though a paper with no Grok client has no auth. It never did:
 * `grokClientId` and `grokClientSecret` each fell back to a baked constant, so
 * the second half was always true and the whole expression was `!disabled` with
 * two extra steps. The cost was a sentence that says the wrong thing — in the
 * one file an auditor reads to find out how auth is turned on — and a plausible
 * "fix" that would have switched a real install's auth off by removing a Grok
 * variable. Auth is enforced unless `VITE_AUTH_ENABLED=false`, and this is now
 * the only thing that decides it.
 *
 * ## 2. The broker client is opt-in, not a default
 *
 * `GROK_AUTH_CLIENT_ID` + `GROK_AUTH_CLIENT_SECRET` were also a fallback PAIR:
 * missing, and the app silently used the shared LIVE-PREVIEW client whose id
 * and secret are committed in `preview.ts`. Measured on a built server started
 * with no Grok variable at all:
 *
 *   POST /api/auth/sign-in/oauth2 {"providerId":"grok-google"}
 *   -> 200 {"url":"https://auth.grok.me/api/auth/oauth2/authorize
 *           ?idp=google&prompt=login&client_id=grok_preview&…"}
 *
 * A self-hosted paper that never asked for federation was one click from
 * signing its editor in through a third party's broker, with a client secret
 * anybody can read in this repository. The preview client is legitimate for the
 * sandbox live preview — that is what it is for — but it is only ever used now
 * when the operator says so:
 *
 *   TOWNREPORTER_GROK_PREVIEW=1
 *
 * Explicit `GROK_AUTH_*` still wins and still needs no opt-in; that is a real
 * deployment naming its own client. Half a client (one of the two set) is not a
 * client and registers nothing.
 */

/** Explicit opt-in to the baked preview client. Only the sandbox sets it. */
export const GROK_PREVIEW_OPT_IN = "TOWNREPORTER_GROK_PREVIEW";

export type GrokFederation = {
  clientId: string;
  clientSecret: string;
  /** Which client this is. For the startup log; never the secret's value. */
  from: "explicit" | "preview";
};

type Env = Record<string, string | undefined>;

const trimmed = (env: Env, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value ? value : undefined;
};

/**
 * True when this process enforces auth at all.
 *
 * `VITE_AUTH_ENABLED=false` is the shipped off-switch, and the ONLY one. Grok
 * has no say: a paper with no broker client still has its own email/password
 * door, and that door is the one a self-hosted install uses.
 */
export function authEnforced(env: Env = process.env): boolean {
  return env.VITE_AUTH_ENABLED !== "false";
}

/**
 * The broker client to federate with, or null to register no OAuth provider.
 *
 * Callers pass the baked preview client in, so this stays free of the literal
 * and of `preview.ts`: the decision is here, the constant is where it lives.
 */
export function grokFederation(
  env: Env = process.env,
  previewClient?: () => { clientId: string; clientSecret: string },
): GrokFederation | null {
  const clientId = trimmed(env, "GROK_AUTH_CLIENT_ID");
  const clientSecret = trimmed(env, "GROK_AUTH_CLIENT_SECRET");
  if (clientId && clientSecret) {
    return { clientId, clientSecret, from: "explicit" };
  }
  // Half a client is not a client. Registering one would put the broker in the
  // sign-in list and fail at the callback, which is a worse way to find out.
  if (clientId || clientSecret) return null;
  if (trimmed(env, GROK_PREVIEW_OPT_IN) !== "1") return null;
  const preview = previewClient?.();
  if (!preview?.clientId || !preview.clientSecret) return null;
  return { clientId: preview.clientId, clientSecret: preview.clientSecret, from: "preview" };
}

/**
 * Whether the live-preview host allow-list is trusted at all.
 *
 * `PREVIEW_ALLOWED_HOSTS` names `*.grok-sandbox.com`, and `server.ts` spread it
 * into Better Auth's `trustedOrigins` and into the dynamic baseURL's
 * `allowedHosts` on every install, whatever the operator configured. That is
 * the same coupling §2 removes for the *client*, one layer down: a paper that
 * never asked for the sandbox still trusted a wildcard of hosts it does not own
 * for credentialed auth POSTs and for deriving its own origin from a request's
 * `Host` header.
 *
 * It is a host list, not a secret, and the wildcard only ever matches a sandbox
 * preview URL -- but "nothing here trusts a host the operator did not name
 * unless the operator asked for the sandbox" is the honest rule, and it is the
 * rule the preview client already follows. Same switch, so there is one thing
 * to set and one thing to read: `TOWNREPORTER_GROK_PREVIEW=1`.
 *
 * Email and password sign-in do not read this: loopback origins are appended by
 * `server.ts` independently, and they are what a self-hosted install uses.
 */
export function previewHostsTrusted(env: Env = process.env): boolean {
  return trimmed(env, GROK_PREVIEW_OPT_IN) === "1";
}

/**
 * The half-configured case, as a sentence, or null when there is nothing to say.
 *
 * Half a client is the one failure here that is silent by construction: the
 * operator set a variable, so they believe federation is on, and it is not.
 */
export function grokFederationWarning(env: Env = process.env): string | null {
  const hasId = Boolean(trimmed(env, "GROK_AUTH_CLIENT_ID"));
  const hasSecret = Boolean(trimmed(env, "GROK_AUTH_CLIENT_SECRET"));
  if (hasId === hasSecret) return null;
  const missing = hasId ? "GROK_AUTH_CLIENT_SECRET" : "GROK_AUTH_CLIENT_ID";
  return (
    `[auth] ${missing} is not set, so federated sign-in is off. ` +
    `Both GROK_AUTH_CLIENT_ID and GROK_AUTH_CLIENT_SECRET are needed. ` +
    `Email and password sign-in is unaffected.`
  );
}
