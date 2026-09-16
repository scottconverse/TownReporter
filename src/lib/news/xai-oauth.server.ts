import type {
  AuthEvent,
  AuthInteraction,
  Context,
  Credential,
  CredentialInfo,
  CredentialStore,
  Model,
  OAuthCredential,
  AssistantMessage,
  AuthContext,
} from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { decryptApiKey, encryptApiKey } from "./custom-ai-connections.server.ts";
import { getSql, withTransaction, type Sql } from "../db.ts";

const XAI_PROVIDER = "xai";
const PUBLIC_IDENTITY = "Grok Build";
const XAI_MODELS_URL = "https://api.x.ai/v1/models";
const FALLBACK_MODEL_IDS = ["grok-4.5", "grok-build-0.1", "grok-4.3"] as const;
const OAUTH_ONLY_AUTH_CONTEXT: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

export type XaiOauthLoginState =
  | "signed_out"
  | "starting"
  | "awaiting_user"
  | "signed_in"
  | "failed"
  | "cancelled";

export type XaiOauthStatus = {
  connected: boolean;
  loginState: XaiOauthLoginState;
  url: string | null;
  code: string | null;
  models: string[];
  selectedModelId: string | null;
  expiresAt: string | null;
  detail: string | null;
  identity: typeof PUBLIC_IDENTITY;
};
export type XaiOAuthStatus = XaiOauthStatus;

/** A failed replacement login must leave a still-valid prior session usable. */
export function loginFailureState(hasCredential: boolean): XaiOauthLoginState {
  return hasCredential ? "signed_in" : "failed";
}

type XaiOauthRow = {
  newsroom_id: number;
  encrypted_credential: string | null;
  login_state: XaiOauthLoginState;
  login_url: string | null;
  login_code: string | null;
  login_detail: string | null;
  model_ids: string;
  selected_model_id: string | null;
  catalog_source: string;
};

type XaiOauthStatusInput = {
  newsroomId: number;
  loginState: XaiOauthLoginState;
  loginUrl?: string | null;
  loginCode?: string | null;
  loginDetail?: string | null;
  modelIds?: readonly string[];
  selectedModelId?: string | null;
  expiresAt?: number | null;
  hasCredential?: boolean;
};

function asNewsroomId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("A valid newsroom is required.");
  return value;
}

function parseModelIds(value: unknown): string[] {
  if (Array.isArray(value)) return filterXaiOauthModelIds(value);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? filterXaiOauthModelIds(parsed) : [];
  } catch {
    return [];
  }
}

/** Validate a canonical pi-ai OAuth credential before it enters encrypted storage. */
export function validateXaiOauthCredential(value: unknown): OAuthCredential {
  if (!value || typeof value !== "object") throw new Error("Invalid xAI OAuth credential.");
  const item = value as Partial<OAuthCredential>;
  if (item.type !== "oauth" || typeof item.access !== "string" || !item.access.trim())
    throw new Error("Invalid xAI OAuth credential.");
  if (typeof item.refresh !== "string" || !item.refresh.trim())
    throw new Error("Invalid xAI OAuth credential.");
  if (typeof item.expires !== "number" || !Number.isFinite(item.expires) || item.expires <= 0)
    throw new Error("Invalid xAI OAuth credential expiry.");
  return { ...item, type: "oauth", access: item.access.trim(), refresh: item.refresh.trim() } as OAuthCredential;
}

/** Keep model discovery useful for chat while excluding obvious media-only products. */
export function filterXaiOauthModelIds(ids: readonly unknown[]): string[] {
  const blocked = /(?:^|[-_])(image|video|audio|embedding|embed|tts|transcrib|whisper|rerank|moderation)(?:[-_]|$)/i;
  return [...new Set(ids.flatMap((raw) => {
    if (typeof raw !== "string") return [];
    const id = raw.trim();
    return id && id.length <= 200 && !blocked.test(id) ? [id] : [];
  }))].sort();
}

export function preferredXaiOauthModel(ids: readonly string[]): string {
  const models = filterXaiOauthModelIds(ids);
  for (const preferred of ["grok-4.6", "grok-4.5", "grok-4.3", "grok-build-0.1"])
    if (models.includes(preferred)) return preferred;
  return models[0] ?? "grok-4.5";
}

/** Convert internal DB state into the intentionally small public status contract. */
export function shapeXaiOauthStatus(input: XaiOauthStatusInput): XaiOauthStatus {
  const models = filterXaiOauthModelIds(input.modelIds ?? []);
  const selected = input.selectedModelId && models.includes(input.selectedModelId)
    ? input.selectedModelId
    : null;
  return {
    connected: input.hasCredential === true,
    loginState: input.loginState,
    url: input.loginUrl ?? null,
    code: input.loginCode ?? null,
    models,
    selectedModelId: selected,
    expiresAt: typeof input.expiresAt === "number" ? new Date(input.expiresAt).toISOString() : null,
    detail: input.loginDetail ?? null,
    identity: PUBLIC_IDENTITY,
  };
}

function credentialJson(credential: OAuthCredential): string {
  return encryptApiKey(JSON.stringify(validateXaiOauthCredential(credential)));
}

function parseCredential(value: string | null): OAuthCredential | undefined {
  if (!value) return undefined;
  try {
    return validateXaiOauthCredential(JSON.parse(decryptApiKey(value) ?? ""));
  } catch {
    throw new Error("Stored xAI OAuth credential is unreadable.");
  }
}

/** DB-backed pi-ai store. modify() locks the row, including OAuth refresh rotation. */
export class XaiOauthCredentialStore implements CredentialStore {
  readonly newsroomId: number;
  constructor(newsroomId: number) { asNewsroomId(newsroomId); this.newsroomId = newsroomId; }

  async read(providerId: string): Promise<Credential | undefined> {
    if (providerId !== XAI_PROVIDER) return undefined;
    const rows = await (await getSql()).query<Pick<XaiOauthRow, "encrypted_credential">>(
      "select encrypted_credential from xai_oauth_connections where newsroom_id = $1",
      [this.newsroomId],
    );
    return parseCredential(rows[0]?.encrypted_credential ?? null);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const credential = await this.read(XAI_PROVIDER);
    return credential ? [{ providerId: XAI_PROVIDER, type: "oauth" }] : [];
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== XAI_PROVIDER) return fn(undefined);
    const newsroomId = this.newsroomId;
    await ensureRow(newsroomId);
    return withTransaction(async (sql) => {
      const rows = await sql.query<Pick<XaiOauthRow, "encrypted_credential">>(
        "select encrypted_credential from xai_oauth_connections where newsroom_id = $1 for update",
        [newsroomId],
      );
      const current = parseCredential(rows[0]?.encrypted_credential ?? null);
      const next = await fn(current);
      if (next === undefined) return current;
      const validated = validateXaiOauthCredential(next);
      await sql.query(
        "update xai_oauth_connections set encrypted_credential = $2, updated_at = now() where newsroom_id = $1",
        [newsroomId, credentialJson(validated)],
      );
      return validated;
    });
  }

  async delete(providerId: string): Promise<void> {
    if (providerId !== XAI_PROVIDER) return;
    await ensureRow(this.newsroomId);
    await withTransaction(async (sql) => {
      await sql.query(
        "select newsroom_id from xai_oauth_connections where newsroom_id = $1 for update",
        [this.newsroomId],
      );
      await sql.query(
        "update xai_oauth_connections set encrypted_credential = null, updated_at = now() where newsroom_id = $1",
        [this.newsroomId],
      );
    });
  }
}
export const XaiOAuthCredentialStore = XaiOauthCredentialStore;
export const createXaiOauthCredentialStore = (newsroomId: number): CredentialStore =>
  new XaiOauthCredentialStore(newsroomId);

async function ensureRow(newsroomId: number, sql?: Sql): Promise<void> {
  const db = sql ?? await getSql();
  await db.query(
    "insert into xai_oauth_connections (newsroom_id) values ($1) on conflict (newsroom_id) do nothing",
    [newsroomId],
  );
}

async function readRow(newsroomId: number): Promise<XaiOauthRow | undefined> {
  const rows = await (await getSql()).query<XaiOauthRow>(
    "select newsroom_id, encrypted_credential, login_state, login_url, login_code, login_detail, model_ids, selected_model_id, catalog_source from xai_oauth_connections where newsroom_id = $1",
    [newsroomId],
  );
  return rows[0];
}

function rowStatus(row: XaiOauthRow | undefined): XaiOauthStatus {
  if (!row) return shapeXaiOauthStatus({ newsroomId: 0, loginState: "signed_out" });
  const credential = parseCredential(row.encrypted_credential);
  return shapeXaiOauthStatus({
    newsroomId: row.newsroom_id,
    loginState: row.login_state,
    loginUrl: row.login_url,
    loginCode: row.login_code,
    loginDetail: row.login_detail,
    modelIds: parseModelIds(row.model_ids),
    selectedModelId: row.selected_model_id,
    expiresAt: credential?.expires ?? null,
    hasCredential: Boolean(credential),
  });
}

async function patchState(newsroomId: number, patch: Record<string, unknown>): Promise<void> {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 2}`).join(", ");
  await (await getSql()).query(
    `update xai_oauth_connections set ${assignments}, updated_at = now() where newsroom_id = $1`,
    [newsroomId, ...fields.map((field) => patch[field])],
  );
}

async function patchLoginProgress(newsroomId: number, patch: Record<string, unknown>): Promise<void> {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 2}`).join(", ");
  await (await getSql()).query(
    `update xai_oauth_connections set ${assignments}, updated_at = now() where newsroom_id = $1 and login_state in ('starting', 'awaiting_user')`,
    [newsroomId, ...fields.map((field) => patch[field])],
  );
}

type LoginOperation = { controller: AbortController; promise: Promise<void> };
const operations = new Map<number, LoginOperation>();

function loginError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Login cancelled.";
  return "Grok Build sign-in failed. Try again.";
}

async function runLogin(newsroomId: number, operation: LoginOperation): Promise<void> {
  const store = new XaiOauthCredentialStore(newsroomId);
  const models = createModels({ credentials: store });
  models.setProvider(xaiProvider());
  const interaction: AuthInteraction = {
    signal: operation.controller.signal,
    prompt: async () => { throw new Error("Grok Build OAuth did not request a prompt."); },
    notify: (event: AuthEvent) => {
      if (event.type === "device_code") {
        void patchLoginProgress(newsroomId, {
          login_state: "awaiting_user",
          login_url: event.verificationUri,
          login_code: event.userCode,
          login_detail: "Open the URL and enter the code to sign in to Grok Build.",
        });
      } else if (event.type === "progress" || event.type === "info") {
        void patchLoginProgress(newsroomId, { login_detail: event.message });
      }
    },
  };
  try {
    await models.login(XAI_PROVIDER, "oauth", interaction);
    if (operation.controller.signal.aborted) throw new DOMException("Login cancelled", "AbortError");
    await patchState(newsroomId, {
      login_state: "signed_in", login_url: null, login_code: null,
      login_detail: "Signed in to Grok Build. Refresh models to choose a model.",
    });
    try {
      await refreshXaiOauthModels(newsroomId);
    } catch {
      // Login is complete even when the optional catalog request is unavailable.
      await patchState(newsroomId, { login_detail: "Signed in to Grok Build. Model discovery is temporarily unavailable." });
    }
  } catch (error) {
    const retained = Boolean(await store.read(XAI_PROVIDER));
    if (!operation.controller.signal.aborted) await patchState(newsroomId, {
      login_state: loginFailureState(retained), login_url: null, login_code: null,
      login_detail: retained
        ? `${loginError(error)} The previous Grok Build session remains connected.`
        : loginError(error),
    });
  }
}

export async function getXaiOauthStatus(newsroomId: number): Promise<XaiOauthStatus> {
  asNewsroomId(newsroomId);
  return rowStatus(await readRow(newsroomId));
}

export async function startXaiOauthLogin(newsroomId: number): Promise<XaiOauthStatus> {
  asNewsroomId(newsroomId);
  await ensureRow(newsroomId);
  const active = operations.get(newsroomId);
  if (active) return getXaiOauthStatus(newsroomId);
  await patchState(newsroomId, {
    login_state: "starting", login_url: null, login_code: null,
    login_detail: "Starting Grok Build sign-in…",
  });
  const controller = new AbortController();
  const operation = {} as LoginOperation;
  operation.controller = controller;
  operation.promise = runLogin(newsroomId, operation).finally(() => {
    if (operations.get(newsroomId) === operation) operations.delete(newsroomId);
  });
  operations.set(newsroomId, operation);
  void operation.promise;
  return getXaiOauthStatus(newsroomId);
}

export async function pollXaiOauthLogin(newsroomId: number): Promise<XaiOauthStatus> {
  return getXaiOauthStatus(newsroomId);
}

export async function cancelXaiOauthLogin(newsroomId: number): Promise<XaiOauthStatus> {
  asNewsroomId(newsroomId);
  const operation = operations.get(newsroomId);
  operation?.controller.abort();
  if (operation) await operation.promise.catch(() => undefined);
  const retained = Boolean(await new XaiOauthCredentialStore(newsroomId).read(XAI_PROVIDER));
  await patchState(newsroomId, {
    login_state: loginFailureState(retained), login_url: null, login_code: null,
    login_detail: retained
      ? "Grok Build sign-in cancelled. The previous session remains connected."
      : "Grok Build sign-in cancelled.",
  });
  return getXaiOauthStatus(newsroomId);
}

export async function disconnectXaiOauth(newsroomId: number): Promise<XaiOauthStatus> {
  asNewsroomId(newsroomId);
  const operation = operations.get(newsroomId);
  operation?.controller.abort();
  if (operation) await operation.promise.catch(() => undefined);
  await ensureRow(newsroomId);
  await new XaiOauthCredentialStore(newsroomId).delete(XAI_PROVIDER);
  await patchState(newsroomId, {
    login_state: "signed_out", login_url: null, login_code: null, login_detail: null,
    model_ids: "[]", selected_model_id: null, catalog_source: "fallback",
  });
  return getXaiOauthStatus(newsroomId);
}

function parseModelsResponse(body: unknown): string[] {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
    ? (body as { data: unknown[] }).data
    : [];
  return filterXaiOauthModelIds(data.flatMap((row) =>
    row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
      ? [(row as { id: string }).id] : []));
}

export type XaiOauthRefreshDeps = { store?: CredentialStore };

export async function refreshXaiOauthModels(
  newsroomId: number,
  fetchImpl: typeof fetch = fetch,
  deps: XaiOauthRefreshDeps = {},
): Promise<XaiOauthStatus> {
  asNewsroomId(newsroomId);
  if (!deps.store) await ensureRow(newsroomId);
  const store = deps.store ?? new XaiOauthCredentialStore(newsroomId);
  if (!(await store.read(XAI_PROVIDER))) throw new Error("Sign in to Grok Build before refreshing models.");
  const models = createModels({ credentials: store, authContext: OAUTH_ONLY_AUTH_CONTEXT });
  models.setProvider(xaiProvider());
  const auth = await models.getAuth(XAI_PROVIDER);
  if (!auth?.auth.apiKey) throw new Error("Grok Build authentication is unavailable.");
  let ids: string[] = [];
  try {
    const response = await fetchImpl(XAI_MODELS_URL, {
      headers: { Accept: "application/json", Authorization: `Bearer ${auth.auth.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) ids = parseModelsResponse(await response.json());
  } catch {
    ids = [];
  }
  const modelIds = ids.length ? ids : [...FALLBACK_MODEL_IDS];
  const current = await readRow(newsroomId);
  const selected = current?.selected_model_id && modelIds.includes(current.selected_model_id)
    ? current.selected_model_id : preferredXaiOauthModel(modelIds);
  await patchState(newsroomId, {
    model_ids: JSON.stringify(modelIds), selected_model_id: selected,
    catalog_source: ids.length ? "live" : "fallback", login_state: "signed_in",
    login_detail: "Signed in to Grok Build.",
  });
  return getXaiOauthStatus(newsroomId);
}

export async function selectXaiOauthModel(newsroomId: number, modelId: string): Promise<XaiOauthStatus> {
  asNewsroomId(newsroomId);
  const id = modelId.trim();
  if (!id || !filterXaiOauthModelIds([id]).includes(id)) throw new Error("Choose a supported Grok Build chat model.");
  const row = await readRow(newsroomId);
  const models = parseModelIds(row?.model_ids);
  if (!models.includes(id)) throw new Error("Refresh Grok Build models before selecting this model.");
  await patchState(newsroomId, { selected_model_id: id });
  return getXaiOauthStatus(newsroomId);
}

export type XaiOauthConnection = { modelId: string; label: typeof PUBLIC_IDENTITY };

export async function resolveXaiOauthConnection(newsroomId: number): Promise<XaiOauthConnection> {
  const status = await getXaiOauthStatus(newsroomId);
  if (!status.connected || status.loginState !== "signed_in") throw new Error("Sign in to Grok Build first.");
  return { modelId: status.selectedModelId ?? preferredXaiOauthModel(status.models), label: PUBLIC_IDENTITY };
}

export function materializeXaiOauthModel(modelId: string): Model<any> {
  const provider = xaiProvider();
  const known = provider.getModels().find((model) => model.id === modelId);
  if (known) return known as Model<any>;
  // The live endpoint can advertise a newer model before pi-ai ships its
  // catalog entry. Keep build/code variants on the completions transport and
  // use the responses transport for the general Grok family.
  const templateId = /(?:build|code|fast)/i.test(modelId) ? "grok-build-0.1" : "grok-4.5";
  const template = provider.getModels().find((model) => model.id === templateId) ?? provider.getModels()[0];
  if (!template) throw new Error("The pi-ai xAI model catalog is unavailable.");
  return { ...template, id: modelId, name: modelId } as Model<any>;
}

export async function xaiOauthChat(input: {
  newsroomId: number;
  system?: string;
  user: string;
  maxTokens?: number;
  model?: string;
  timeoutMs?: number;
}, deps: XaiOauthChatDeps = {}): Promise<{ text: string; modelId: string; label: typeof PUBLIC_IDENTITY }> {
  const connection = await (deps.resolveConnection ?? resolveXaiOauthConnection)(input.newsroomId);
  const modelId = input.model?.trim() || connection.modelId;
  const store = deps.store ?? new XaiOauthCredentialStore(input.newsroomId);

  /*
   * Resolve OAuth once, then pin the resulting access token to this request.
   * pi-ai's normal auth resolver deliberately falls back to XAI_API_KEY when
   * its credential store is empty. That is correct for the ordinary xAI API
   * provider, but an explicit Grok OAuth pick must never cross that boundary:
   * a concurrent disconnect between preflight and completion must fail closed.
   * The empty auth context prevents ambient env lookup, and the explicit key
   * makes the completion independent of a later store read. OAuth refresh and
   * encrypted persistence still happen inside models.getAuth().
   */
  const oauthModels = createModels({ credentials: store, authContext: OAUTH_ONLY_AUTH_CONTEXT });
  oauthModels.setProvider(xaiProvider());
  const auth = await oauthModels.getAuth(XAI_PROVIDER);
  if (!auth?.auth.apiKey) throw new Error("Sign in to Grok Build first.");
  const context: Context = {
    ...(input.system ? { systemPrompt: input.system } : {}),
    messages: [{ role: "user", content: input.user, timestamp: Date.now() }],
  };
  const result: AssistantMessage = await oauthModels.complete(materializeXaiOauthModel(modelId), context, {
    maxTokens: input.maxTokens ?? 1400,
    timeoutMs: input.timeoutMs,
    apiKey: auth.auth.apiKey,
  });
  const text = result.content.filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text).join("").trim();
  return { text, modelId, label: PUBLIC_IDENTITY };
}

export type XaiOauthChatDeps = {
  /** Hermetic seam for proving a disconnected OAuth store cannot use ambient auth. */
  store?: CredentialStore;
  resolveConnection?: (newsroomId: number) => Promise<XaiOauthConnection>;
};

export type XaiOauthTestDeps = {
  chat?: (input: Parameters<typeof xaiOauthChat>[0]) => Promise<{ text: string }>;
};

export async function testXaiOauthConnection(
  newsroomId: number,
  expectedText = "TOWNREPORTER_OK",
  deps: XaiOauthTestDeps = {},
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await (deps.chat ?? xaiOauthChat)({ newsroomId, user: `Reply with ${expectedText}.`, maxTokens: 12 });
    const ok = result.text.includes(expectedText);
    return { ok, message: ok ? "Grok Build connection succeeded." : "Grok Build returned unexpected text." };
  } catch {
    return { ok: false, message: "Could not reach Grok Build." };
  }
}

// Names with the lower-case OAuth spelling are the stable integration surface.
export const getXaiOAuthStatus = getXaiOauthStatus;
export const startXaiOAuthLogin = startXaiOauthLogin;
export const pollXaiOAuthLogin = pollXaiOauthLogin;
export const cancelXaiOAuthLogin = cancelXaiOauthLogin;
export const disconnectXaiOAuth = disconnectXaiOauth;
export const refreshXaiOAuthModels = refreshXaiOauthModels;
export const selectXaiOAuthModel = selectXaiOauthModel;
export const filterXaiOAuthModelIds = filterXaiOauthModelIds;
export const preferredXaiOAuthModel = preferredXaiOauthModel;
export const materializeXaiOAuthModel = materializeXaiOauthModel;
