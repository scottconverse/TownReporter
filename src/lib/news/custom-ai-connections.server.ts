import { isGeminiOpenAiEndpoint, normalizeProviderModelId } from "./provider-model-id.ts";
import { providerResponseDetail } from "./provider-error-detail.ts";

export type CustomAiConnectionInput = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelId?: string;
  removeApiKey?: boolean;
};

export type StoredCustomAiConnection = {
  id: string;
  newsroomId: number;
  name: string;
  baseUrl: string;
  encryptedApiKey: string | null;
  modelId: string | null;
  enabled: boolean;
};

export type PublicCustomAiConnection = Omit<
  StoredCustomAiConnection,
  "newsroomId" | "encryptedApiKey"
> & { hasApiKey: boolean; readinessError?: string };

export function normalizeConnectionInput(input: CustomAiConnectionInput) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Connection name must be 1 to 80 characters.");
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw new Error("Base URL must be a valid HTTP or HTTPS URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Base URL must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("Base URL must not include credentials.");
  if (url.search || url.hash) throw new Error("Base URL must not include a query or fragment.");
  const baseUrl = url.toString().replace(/\/$/, "");
  const apiKey = input.apiKey?.trim() || undefined;
  const modelId = normalizeProviderModelId(baseUrl, input.modelId?.trim() || "") || undefined;
  if (apiKey && apiKey.length > 4096) throw new Error("API key is too long.");
  if (modelId && modelId.length > 200) throw new Error("Model id is too long.");
  return {
    name,
    baseUrl,
    apiKey,
    modelId,
    ...(input.removeApiKey === true ? { removeApiKey: true } : {}),
  };
}

export function publicConnection(connection: StoredCustomAiConnection): PublicCustomAiConnection {
  const { newsroomId: _room, encryptedApiKey, ...safe } = connection;
  return { ...safe, hasApiKey: Boolean(encryptedApiKey) };
}

export function connectionReadinessError(connection: StoredCustomAiConnection): string | undefined {
  try {
    const key = decryptApiKey(connection.encryptedApiKey);
    if (isGeminiOpenAiEndpoint(connection.baseUrl) && !key) {
      return "Google Gemini requires an API key. Enter it in Server settings before drafting.";
    }
  } catch (error) {
    return error instanceof Error ? error.message : "The saved API key cannot be read. Re-enter it in Server settings.";
  }
  return undefined;
}

export function parseDiscoveredModels(body: unknown, baseUrl?: string): string[] {
  const data =
    body && typeof body === "object" && "data" in body ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  return [
    ...new Set(
      data.flatMap((row) => {
        if (!row || typeof row !== "object" || !("id" in row)) return [];
        const id = normalizeProviderModelId(
          baseUrl ?? "",
          String((row as { id: unknown }).id).trim(),
        );
        return id ? [id] : [];
      }),
    ),
  ].sort();
}

export type TestedCapabilities = {
  chatCompletions: boolean;
  responses: boolean | null;
  modelDiscovery: boolean | null;
};

/** Result of the chat-completions probe. Null means the protocol was not tested. */
export function inferCapabilities(body: unknown): TestedCapabilities {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    chatCompletions: Array.isArray(record.choices),
    responses: null,
    modelDiscovery: null,
  };
}
function hasAssistantText(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return false;
  return choices.some((choice) => {
    if (!choice || typeof choice !== "object") return false;
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== "object") return false;
    const content = (message as { content?: unknown }).content;
    return typeof content === "string" && content.trim().length > 0;
  });
}

function joinEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function safeError(status: number): string {
  if (status === 401 || status === 403) return "The server rejected the credentials.";
  if (status === 404) return "The endpoint is not supported by this server.";
  return `The server returned HTTP ${status}.`;
}

const DUPLICATE_CONNECTION_NAME_MESSAGE =
  "A connection with that name already exists. Choose a different name or edit the existing connection.";

function isDuplicateConnectionNameError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  const message = error instanceof Error ? error.message : String(error);
  const constraint = String(candidate.constraint ?? "");
  return (
    (candidate.code === "23505" || /duplicate key/i.test(message)) &&
    (/custom_ai_connections_newsroom_id_name_key/i.test(constraint) ||
      /custom_ai_connections_newsroom_id_name_key/i.test(message))
  );
}

export type ConnectionProbeResult = {
  ok: boolean;
  message: string;
  capabilities: ReturnType<typeof inferCapabilities>;
  latencyMs: number;
};

export async function discoverConnectionModels(
  connection: Pick<StoredCustomAiConnection, "baseUrl">,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetchImpl(joinEndpoint(connection.baseUrl, "models"), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await providerResponseDetail(response, apiKey);
    throw new Error(`${safeError(response.status)}${detail ? `\n\n${detail}` : ""}`);
  }
  return parseDiscoveredModels(await response.json(), connection.baseUrl);
}

/** Explicitly invoked only. It sends a minimal prompt and never includes the key in its result. */
export async function testConnection(
  connection: Pick<StoredCustomAiConnection, "baseUrl" | "modelId">,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionProbeResult> {
  if (!connection.modelId)
    return {
      ok: false,
      message: "Choose or enter a model before testing.",
      capabilities: inferCapabilities(null),
      latencyMs: 0,
    };
  const started = Date.now();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const response = await fetchImpl(joinEndpoint(connection.baseUrl, "chat/completions"), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: connection.modelId,
        messages: [{ role: "user", content: "Reply with TOWNREPORTER_OK." }],
        max_tokens: 128,
      }),
    });
    if (!response.ok) {
      const detail = await providerResponseDetail(response, apiKey);
      return {
        ok: false,
        message: `${safeError(response.status)}${detail ? `\n\n${detail}` : ""}`,
        capabilities: inferCapabilities(null),
        latencyMs: Date.now() - started,
      };
    }
    const body = await response.json();
    const capabilities = inferCapabilities(body);
    const answered = hasAssistantText(body);
    return {
      ok: answered,
      message: answered
        ? "Connection succeeded; chat completions are available."
        : "The server replied, but did not return assistant text.",
      capabilities,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Connection test timed out."
        : "Could not reach the server.";
    return {
      ok: false,
      message,
      capabilities: inferCapabilities(null),
      latencyMs: Date.now() - started,
    };
  }
}

const SCHEMA = [
  `create table if not exists custom_ai_connections (
  id text primary key, newsroom_id integer not null, name text not null,
  base_url text not null, encrypted_api_key text, model_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(newsroom_id, name)
)`,
];

/**
 * Goes through `ensureSchemaOnce` so a running server issues no DDL at all:
 * every caller below is a request path, and the `create table` here used to run
 * on each one. See `paper-settings-read-lock.test.ts` and `questions/BP.md`.
 */
export async function ensureCustomAiConnectionsSchema() {
  await ensureSchemaOnce(await getSql(), "custom-ai-connections", SCHEMA);
}
function encryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required before an API key can be saved.");
  return createHash("sha256").update(`townreporter-custom-ai:${secret}`).digest();
}
export function encryptApiKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
export function decryptApiKey(value: string | null): string | null {
  if (!value) return null;
  try {
    const [version, iv, tag, body] = value.split(".");
    if (version !== "v1" || !iv || !tag || !body) throw new Error("Stored API key is unreadable.");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("The saved API key cannot be decrypted with this server's secret. Re-enter the connection's API key in Server settings before drafting. A restored database needs the secret that encrypted its keys.");
  }
}

type Row = {
  id: string;
  newsroom_id: number;
  name: string;
  base_url: string;
  encrypted_api_key: string | null;
  model_id: string | null;
  enabled: boolean;
};
const fromRow = (r: Row): StoredCustomAiConnection => ({
  id: r.id,
  newsroomId: r.newsroom_id,
  name: r.name,
  baseUrl: r.base_url,
  encryptedApiKey: r.encrypted_api_key,
  modelId: r.model_id,
  enabled: r.enabled,
});

export async function listCustomAiConnections(userId: string): Promise<PublicCustomAiConnection[]> {
  const me = await requireEditor(userId);
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  return (
    await sql<Row>`select id,newsroom_id,name,base_url,encrypted_api_key,model_id,enabled from custom_ai_connections where newsroom_id=${me.newsroomId} order by name`
  )
    .map(fromRow)
    .map((connection) => {
      const readinessError = connectionReadinessError(connection);
      return { ...publicConnection(connection), ...(readinessError ? { readinessError } : {}) };
    });
}
/**
 * The owner, or a 403 with the one sentence every model-connection refusal
 * shares (`ONLY_OWNER_CHANGES_MODEL_CONNECTIONS`).
 *
 * A connection is an address the desk sends prompts to AND the place a stored
 * provider key is spent, so creating one, re-pointing one, switching one on or
 * off, deleting one, and asking one to answer are all the owner's decisions --
 * the same class as `savePaperConfig` or `createInvite`. Listing them stays
 * open to every editor (`listCustomAiConnections`), because knowing which
 * connections exist is not a way to change one.
 */
async function requireModelConnectionOwner(userId: string) {
  const me = await requireEditor(userId);
  if (me.role !== "owner") throw new ForbiddenError(ONLY_OWNER_CHANGES_MODEL_CONNECTIONS);
  return me;
}

export async function saveCustomAiConnection(
  userId: string,
  input: CustomAiConnectionInput & { id?: string },
): Promise<PublicCustomAiConnection> {
  const me = await requireModelConnectionOwner(userId);
  const value = normalizeConnectionInput(input);
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  const id = input.id?.trim() || randomUUID();
  const existing = input.id
    ? (
        await sql<Row>`select * from custom_ai_connections where id=${id} and newsroom_id=${me.newsroomId}`
      )[0]
    : undefined;
  if (input.id && !existing) throw new Error("Connection not found.");
  /*
    Key follows the address. The stored key was entered for the address that
    was stored with it, so editing the address without supplying a key CLEARS
    it rather than carrying it to a new host -- otherwise an edit that only
    looked like a rename would post the newsroom's provider key to whatever
    address was typed in. `removeApiKey` still clears explicitly, and a new key
    replaces the old one.
  */
  const keyStillMatchesAddress = existing ? existing.base_url === value.baseUrl : false;
  const encrypted = value.removeApiKey
    ? null
    : value.apiKey
      ? encryptApiKey(value.apiKey)
      : keyStillMatchesAddress
        ? (existing?.encrypted_api_key ?? null)
        : null;
  if (isGeminiOpenAiEndpoint(value.baseUrl) && !encrypted)
    throw new Error("Google Gemini requires an API key. Enter it before saving this connection.");
  let rows: Row[];
  try {
    rows =
      await sql<Row>`insert into custom_ai_connections(id,newsroom_id,name,base_url,encrypted_api_key,model_id,enabled) values(${id},${me.newsroomId},${value.name},${value.baseUrl},${encrypted},${value.modelId ?? null},${existing?.enabled ?? true}) on conflict(id) do update set name=excluded.name,base_url=excluded.base_url,encrypted_api_key=excluded.encrypted_api_key,model_id=excluded.model_id,updated_at=now() returning id,newsroom_id,name,base_url,encrypted_api_key,model_id,enabled`;
  } catch (error) {
    if (isDuplicateConnectionNameError(error)) {
      throw new Error(DUPLICATE_CONNECTION_NAME_MESSAGE);
    }
    throw error;
  }
  return publicConnection(fromRow(rows[0]));
}
export async function setCustomAiConnectionEnabled(userId: string, id: string, enabled: boolean) {
  const me = await requireModelConnectionOwner(userId);
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  await sql.query(
    `update custom_ai_connections set enabled=$1, updated_at=now() where id=$2 and newsroom_id=$3`,
    [enabled, id, me.newsroomId],
  );
}
export async function deleteCustomAiConnection(userId: string, id: string) {
  const me = await requireModelConnectionOwner(userId);
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  await sql.query(`delete from custom_ai_connections where id=$1 and newsroom_id=$2`, [
    id,
    me.newsroomId,
  ]);
}
export async function resolveCustomAiChoice(
  newsroomId: number,
  id: string,
): Promise<{ baseUrl: string; modelId: string; apiKey: string | null; name?: string }> {
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  const row = (
    await sql.query<Row>(
      `select * from custom_ai_connections where id=$1 and newsroom_id=$2 and enabled=true`,
      [id, newsroomId],
    )
  )[0];
  if (!row?.model_id)
    throw new Error(
      "The selected custom AI connection is disabled, deleted, or has no model. TownReporter will try the next ready model for this unfinished call.",
    );
  const readinessError = connectionReadinessError(fromRow(row));
  if (readinessError) throw new Error(readinessError);
  return {
    name: row.name,
    baseUrl: row.base_url,
    modelId: row.model_id,
    apiKey: decryptApiKey(row.encrypted_api_key),
  };
}
/**
 * One connection this newsroom owns, for a caller who may use its key.
 *
 * Owner-only, because both callers below decrypt the stored key and PUT it on
 * the wire to whatever address the row currently names -- `discoverCustomAiModels`
 * sends it as a bearer token to `<baseUrl>/models`, and `testCustomAiConnection`
 * sends it with a real prompt to `<baseUrl>/chat/completions`. An editor who
 * could re-point the row (`saveCustomAiConnection`) and then press Discover
 * would be an editor spending the owner's key at an address of their choosing,
 * which is the whole reason the address edit is owner-only too.
 */
async function ownedConnection(userId: string, id: string): Promise<StoredCustomAiConnection> {
  const me = await requireModelConnectionOwner(userId);
  await ensureCustomAiConnectionsSchema();
  const sql = await getSql();
  const row = (
    await sql.query<Row>(`select * from custom_ai_connections where id=$1 and newsroom_id=$2`, [
      id,
      me.newsroomId,
    ])
  )[0];
  if (!row) throw new Error("Connection not found.");
  if (!row.enabled)
    throw new Error("Enable this connection before discovering models or testing it.");
  return fromRow(row);
}
export async function discoverCustomAiModels(
  userId: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
) {
  const row = await ownedConnection(userId, id);
  return discoverConnectionModels(row, decryptApiKey(row.encryptedApiKey), fetchImpl);
}
export async function testCustomAiConnection(
  userId: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
) {
  const row = await ownedConnection(userId, id);
  return testConnection(row, decryptApiKey(row.encryptedApiKey), fetchImpl);
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { ensureSchemaOnce, getSql } from "../db.ts";
import { requireEditor, ForbiddenError, ONLY_OWNER_CHANGES_MODEL_CONNECTIONS } from "./membership.ts";
