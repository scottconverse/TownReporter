import test from "node:test";
import assert from "node:assert/strict";
import type { CredentialStore } from "@earendil-works/pi-ai";
import {
  filterXaiOauthModelIds,
  preferredXaiOauthModel,
  shapeXaiOauthStatus,
  validateXaiOauthCredential,
  materializeXaiOauthModel,
  loginFailureState,
  xaiOauthLoginError,
  xaiOauthChat,
  refreshXaiOauthModels,
} from "./xai-oauth.server.ts";

test("validates OAuth credentials without accepting malformed tokens", () => {
  const credential = {
    type: "oauth" as const,
    access: "access-token",
    refresh: "refresh-token",
    expires: Date.now() + 60_000,
  };
  assert.deepEqual(validateXaiOauthCredential(credential), credential);
  assert.throws(
    () => validateXaiOauthCredential({ ...credential, access: "" }),
    /credential/i,
  );
});

test("filters obvious non-chat XAI model ids and deduplicates", () => {
  assert.deepEqual(
    filterXaiOauthModelIds([
      "grok-4.5",
      "grok-4.5",
      "grok-build-0.1",
      "grok-image-1",
      "grok-video-gen",
      "text-embedding-3",
      "",
    ]),
    ["grok-4.5", "grok-build-0.1"],
  );
});

test("prefers the strongest known discovered model", () => {
  assert.equal(preferredXaiOauthModel(["grok-build-0.1", "grok-4.5"]), "grok-4.5");
  assert.equal(preferredXaiOauthModel([]), "grok-4.5");
});

test("materializes an undiscovered model with the xAI chat descriptor", () => {
  const model = materializeXaiOauthModel("grok-4.6");
  assert.equal(model.id, "grok-4.6");
  assert.equal(model.provider, "xai");
  assert.equal(model.api, "openai-responses");
  assert.equal(materializeXaiOauthModel("grok-build-0.2").api, "openai-completions");
});

test("shapes public status with Grok Build identity and no credential", () => {
  const status = shapeXaiOauthStatus({
    newsroomId: 9,
    loginState: "awaiting_user",
    loginUrl: "https://auth.x.ai/verify",
    loginCode: "ABCD-EFGH",
    loginDetail: "Open the URL and enter the code.",
    modelIds: ["grok-4.5"],
    selectedModelId: "grok-4.5",
    expiresAt: 123,
    hasCredential: true,
  });
  assert.deepEqual(status, {
    connected: true,
    loginState: "awaiting_user",
    url: "https://auth.x.ai/verify",
    code: "ABCD-EFGH",
    models: ["grok-4.5"],
    selectedModelId: "grok-4.5",
    expiresAt: new Date(123).toISOString(),
    detail: "Open the URL and enter the code.",
    identity: "Grok Build",
  });
  assert.equal("access" in status, false);
  assert.equal("refresh" in status, false);
});

test("failed replacement login keeps a prior credential signed in", () => {
  assert.equal(loginFailureState(true), "signed_in");
  assert.equal(loginFailureState(false), "failed");
});

test("surfaces safe xAI device-login diagnostics without echoing arbitrary errors", () => {
  assert.equal(
    xaiOauthLoginError(new Error("xAI OAuth device authorization failed (HTTP 403): access_denied")),
    "Grok Build sign-in failed: xAI OAuth device authorization failed (HTTP 403): access_denied",
  );
  assert.equal(
    xaiOauthLoginError(new Error("secret internal database value")),
    "Grok Build sign-in failed. Try again.",
  );
});

test("pins OAuth auth when a concurrent disconnect removes the store entry", async () => {
  const previousKey = process.env.XAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.XAI_API_KEY = "ambient-api-key-must-never-be-used";
  let reads = 0;
  let authorization: string | null = null;
  const credential = {
    type: "oauth" as const,
    access: "oauth-access-token",
    refresh: "oauth-refresh-token",
    expires: Date.now() + 60_000,
  };
  const store: CredentialStore = {
    read: async () => {
      reads += 1;
      // Model the disconnect winning immediately after the initial read.
      return reads === 1 ? credential : undefined;
    },
    list: async () => [],
    modify: async (_providerId, fn) => fn(undefined),
    delete: async () => undefined,
  };
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response(
      [
        'data: {"id":"test","model":"grok-build-0.1","choices":[{"delta":{"content":"GROK_CONNECTION_OK"},"finish_reason":null}]}',
        'data: {"id":"test","model":"grok-build-0.1","choices":[{"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    const result = await xaiOauthChat(
      { newsroomId: 44, user: "Reply with GROK_CONNECTION_OK.", maxTokens: 12 },
      {
        store,
        resolveConnection: async () => ({ modelId: "grok-build-0.1", label: "Grok Build" }),
      },
    );
    assert.equal(result.text, "GROK_CONNECTION_OK");
    assert.equal(authorization, "Bearer oauth-access-token");
    assert.equal(reads, 1, "completion must use the token captured before disconnect");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
  }
});

test("fails closed before model discovery when OAuth disappears and an API key is ambient", async () => {
  const previousKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "ambient-api-key-must-never-be-used";
  let reads = 0;
  let requests = 0;
  const credential = {
    type: "oauth" as const,
    access: "oauth-access-token",
    refresh: "oauth-refresh-token",
    expires: Date.now() + 60_000,
  };
  const store: CredentialStore = {
    read: async () => {
      reads += 1;
      // The first read is the precheck; the second models auth-resolution read
      // observes a concurrent disconnect.
      return reads === 1 ? credential : undefined;
    },
    list: async () => [],
    modify: async (_providerId, fn) => fn(undefined),
    delete: async () => undefined,
  };
  try {
    await assert.rejects(
      () => refreshXaiOauthModels(44, async () => {
        requests += 1;
        throw new Error("model request must not run");
      }, { store }),
      /authentication is unavailable/i,
    );
    assert.equal(reads, 2);
    assert.equal(requests, 0, "model discovery must stop before contacting xAI");
  } finally {
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
  }
});
