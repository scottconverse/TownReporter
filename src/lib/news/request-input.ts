import { z } from "zod";

/*
  Bounded input for the server functions this unit was scoped to: publish,
  sign-in/sign-up, paper settings, and provider/model connections.

  WHY A SEPARATE MODULE. Nine of those functions live in modules that open a
  database connection at import time, and two of those cannot be loaded by
  `node --experimental-strip-types` at all -- so a check written inline in a
  `.validator()` cannot be tested for what it does. `provider-settings-input.ts`
  set this pattern first, for the same reason and with the same comment; this
  file is that idea for the rest of the scoped surface. Nothing here imports
  anything but zod, so it loads anywhere.

  THREE RULES THIS MODULE KEEPS.

  1. Nothing here throws unless the caller it replaces already threw. The
     connection form rejected a malformed body with an Error and still does;
     `saveLocalModelFn` degraded an unparseable pick to the shipped default and
     still does. Turning a recoverable form mistake into a 500 is a worse
     editor experience than the hole it closes.

  2. The bounds are ceilings far above any real value, and the numbers are
     stated once in `LIMITS` so a refusal reads as "this is 40 times the
     longest address I have ever stored", not as a magic number.

  3. It does NOT decide authorisation. Every function here is a shape check;
     `requireEditor` / `assertOwner` still run after it, in the handler.

  ON TRUNCATION. Where the value is a display string the oversize case is cut
  to the ceiling, which is the house style for display strings (`slice(0, 80)`
  on beat entities, `slice(0, 8)` on supplied URLs). Where the value must stay
  well-formed to be usable -- a URL, an email address -- the oversize case
  becomes blank instead, because half a URL is worse than none: both fields
  already document blank as a real answer (paper-settings.ts:459-462), so this
  loses no meaning that the editor did not already have.
*/

/** Ceilings, stated once. Every one is far above the longest real value. */
export const LIMITS = {
  /** A registry key or a provider id (`claude`, `codex`, a local provider). */
  providerId: 64,
  /** A local model server's base URL. `http://127.0.0.1:1234/v1` is 25. */
  modelBaseUrl: 500,
  /** A model id in a local catalog. The longest in the registry is under 40. */
  modelId: 300,
  /** A saved connection's display name. `normalizeConnectionInput` allows 80. */
  connectionName: 120,
  /** An API key. `normalizeConnectionInput` allows 4096. */
  apiKey: 5_000,
  paperName: 120,
  paperCity: 120,
  paperState: 120,
  timezone: 64,
  tagline: 300,
  /** A URL the paper prints or fetches. */
  url: 500,
  email: 320,
  watchlistEntries: 50,
  seedTitle: 200,
  channelOrKeywordEntries: 50,
  meetingKeywordEntries: 100,
  listItem: 200,
  meetingKeyword: 120,
} as const;

/*
  ---------------------------------------------------------------------------
  The model-use scope (provider/model connections)
  ---------------------------------------------------------------------------

  Moved here from provider-settings.ts:96-111, which kept it private -- so the
  allow-list that decides whether a scope is real could not be tested without
  loading the settings module and its database. `provider-settings.ts`
  re-exports both names, so every existing importer is unchanged.
*/

export const LOCAL_MODEL_SCOPES = ["story", "scan", "opinion", "dark", "forced"] as const;

export type LocalModelScope = (typeof LOCAL_MODEL_SCOPES)[number];

const modelScopeSchema = z.enum(LOCAL_MODEL_SCOPES);

/**
 * An allow-list, not a length check: an unknown scope is `undefined`, which
 * every caller reads as "the paper-wide default".
 */
export function cleanModelScope(value: unknown): LocalModelScope | undefined {
  const parsed = modelScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/*
  ---------------------------------------------------------------------------
  Publish (desk.ts publishLead, opinion.ts publishEditorial)
  ---------------------------------------------------------------------------

  Both were `.validator((leadId: number) => leadId)`. That is a TypeScript
  annotation and nothing else: at runtime the body arrived as whatever JSON
  the client sent, and the only thing between it and `where id = $1` was the
  driver. The queries are parameterised, so this was never injection -- it was
  a declared type that nothing enforced, which is the kind of guarantee that
  reads as a check to everyone who has not looked.
*/

const publishId = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN),
  z.number().int().positive().max(2_147_483_647),
);

/** A row id, or `null` for anything that is not a positive 32-bit integer. */
export function cleanPublishId(raw: unknown): number | null {
  const parsed = publishId.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/*
  ---------------------------------------------------------------------------
  A local model choice (provider-settings.ts saveLocalModelFn)
  ---------------------------------------------------------------------------

  The base URL and id were taken as-is when both were non-empty strings, with
  no ceiling: `saveLocalModel` writes them into newsroom_local_model_choices
  (provider-settings.ts:284-317) and that module has no length check anywhere.
  A bound is added, and the oversize case is refused rather than truncated --
  a truncated model server address is a different server.
*/

export type SaveLocalModelInput = {
  choice: { baseUrl: string; id: string } | null;
  scope: LocalModelScope | undefined;
  /** A scope was supplied and is not one of the five. */
  invalidScope: boolean;
  /** Both halves were supplied as text, and one is longer than a real one. */
  invalidInput: boolean;
};

export function cleanLocalModelInput(raw: unknown): SaveLocalModelInput {
  const v = (raw ?? {}) as { baseUrl?: unknown; id?: unknown; scope?: unknown };
  const scope = cleanModelScope(v.scope);
  const invalidScope = v.scope !== undefined && !scope;
  if (typeof v.baseUrl === "string" && typeof v.id === "string" && v.baseUrl && v.id) {
    const invalidInput =
      v.baseUrl.length > LIMITS.modelBaseUrl || v.id.length > LIMITS.modelId;
    return { choice: invalidInput ? null : { baseUrl: v.baseUrl, id: v.id }, scope, invalidScope, invalidInput };
  }
  // Unchanged: anything else is the existing "reset to the shipped default".
  return { choice: null, scope, invalidScope, invalidInput: false };
}

/*
  ---------------------------------------------------------------------------
  Provider logins (provider-login.ts)
  ---------------------------------------------------------------------------

  `startProviderLogin` and `testProvider` were `.validator((provider: string)
  => provider)`, and the two id calls `.validator((id: number) => id)` -- again
  annotations. The handlers do check (`isProviderId`, `Number.isInteger`), so
  nothing unsafe got through; this moves the check to the boundary where the
  other four areas have it, and gives it a ceiling.

  `cleanWriteProvider` returns `""` rather than throwing, because the handler
  already answers an unknown provider with "There is no such writing model."
  and that is a better answer than a 500. `cleanLoginId` returns `null`, which
  the handlers already return for a non-integer.
*/

const WRITE_PROVIDERS = ["claude", "codex"] as const;
export type WriteProvider = (typeof WRITE_PROVIDERS)[number];

const writeProvider = z.preprocess(
  (v) => (typeof v === "string" ? v : ""),
  z.enum(WRITE_PROVIDERS),
);

/** One of the two provider ids, or `""` for anything else including oversize. */
export function cleanWriteProvider(raw: unknown): WriteProvider | "" {
  if (typeof raw === "string" && raw.length > LIMITS.providerId) return "";
  const parsed = writeProvider.safeParse(raw);
  return parsed.success ? parsed.data : "";
}

const loginId = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN),
  z.number().int().nonnegative().max(2_147_483_647),
);

/** A login-token id, or `null` for anything that is not a non-negative integer. */
export function cleanLoginId(raw: unknown): number | null {
  const parsed = loginId.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/*
  ---------------------------------------------------------------------------
  Connections (custom-ai-settings.ts)
  ---------------------------------------------------------------------------

  These already threw, and they still do -- a malformed connection body was an
  Error before this file existed and the same Error comes out now, which is why
  `custom-ai-settings.test.ts` keeps passing.

  WHAT IS NEW is what the check returns and what it bounds. It used to return
  the raw object cast to the input type (`return v as ...`), so every key the
  client sent was carried through to the store; it now returns the six keys the
  type names, and nothing else. And the string ceilings are applied at the
  boundary.

  Honest note: the STORE already bounded these -- `normalizeConnectionInput`
  (custom-ai-connections.server.ts:26-47) refuses a name over 80, an API key
  over 4096 and a model id over 200. So this is not a hole being closed, it is
  the same decision made earlier: 4 MB of name was parsed, passed through
  `new URL` and only then refused.
*/

export type CleanConnectionInput = {
  name: string;
  baseUrl: string;
  id?: string;
  apiKey?: string;
  modelId?: string;
  removeApiKey?: boolean;
};

export function cleanConnectionInput(raw: unknown): CleanConnectionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid connection request.");
  }
  const v = raw as Record<string, unknown>;
  for (const key of ["name", "baseUrl"] as const) {
    if (typeof v[key] !== "string") throw new Error(`${key} is required.`);
  }
  for (const key of ["id", "apiKey", "modelId"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "string") throw new Error(`${key} must be text.`);
  }
  if (v.removeApiKey !== undefined && typeof v.removeApiKey !== "boolean") {
    throw new Error("removeApiKey must be true or false.");
  }
  const name = v.name as string;
  const baseUrl = v.baseUrl as string;
  if (name.length > LIMITS.connectionName) {
    throw new Error(`A connection name must be ${LIMITS.connectionName} characters or fewer.`);
  }
  if (baseUrl.length > LIMITS.modelBaseUrl) {
    throw new Error(`A base URL must be ${LIMITS.modelBaseUrl} characters or fewer.`);
  }
  for (const [key, max] of [["id", LIMITS.modelId], ["apiKey", LIMITS.apiKey], ["modelId", LIMITS.modelId]] as const) {
    const value = v[key] as string | undefined;
    if (value !== undefined && value.length > max) {
      throw new Error(`A connection ${key} must be ${max} characters or fewer.`);
    }
  }
  return {
    name,
    baseUrl,
    ...(v.id !== undefined ? { id: v.id as string } : {}),
    ...(v.apiKey !== undefined ? { apiKey: v.apiKey as string } : {}),
    ...(v.modelId !== undefined ? { modelId: v.modelId as string } : {}),
    ...(v.removeApiKey !== undefined ? { removeApiKey: v.removeApiKey as boolean } : {}),
  };
}

/** The connection id the enable / delete / discover / test calls send. */
export function cleanConnectionId(raw: unknown): { id: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid connection request.");
  }
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Connection id is required.");
  const trimmed = id.trim();
  if (trimmed.length > LIMITS.modelId) {
    throw new Error(`A connection id must be ${LIMITS.modelId} characters or fewer.`);
  }
  return { id: trimmed };
}

export function cleanConnectionEnabled(raw: unknown): { id: string; enabled: boolean } {
  const enabled = (raw && typeof raw === "object" ? (raw as { enabled?: unknown }).enabled : undefined);
  if (typeof enabled !== "boolean") throw new Error("Enabled must be true or false.");
  return { ...cleanConnectionId(raw), enabled };
}

/*
  ---------------------------------------------------------------------------
  The sign-in / sign-up route (src/routes/api/auth/$.ts)
  ---------------------------------------------------------------------------

  There is no app-owned sign-in or sign-up server function: Better Auth owns
  those routes. The only app code on that path is the route handler, which
  clones the request and parses its JSON to read `email` before deciding
  whether the desk is closed. It parsed the body first and asked questions
  afterwards, so a sign-up POST of any size was deserialised in full.

  The handler cannot be imported by a plain node test -- it reaches
  `@/lib/auth/server`, which `--experimental-strip-types` rejects (see
  grok-federation.test.ts:38-44) -- so the cap and its predicate live here,
  where that decision can be stated and tested.

  256 KB is roughly a thousand times the largest real auth body (a sign-up is
  a name, an address and a password, a few hundred bytes). It is generous on
  purpose: the goal is that the size is bounded at all, not that the limit is
  tight, because a limit set too close to a real request breaks sign-in.
*/

export const MAX_AUTH_BODY_BYTES = 256 * 1024;

/**
 * True when the request declares a body larger than the cap. An absent or
 * unparseable `Content-Length` (a chunked upload) is NOT treated as large --
 * the body cannot be measured from the header, and better-auth applies its own
 * limit downstream. Refusing on an unmeasurable header would break a legitimate
 * flow for no gain.
 */
export function authBodyTooLarge(contentLength: string | null): boolean {
  if (contentLength === null || contentLength === "") return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_AUTH_BODY_BYTES;
}
