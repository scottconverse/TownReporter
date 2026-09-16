/**
 * Client-safe owner controls for TownReporter's newsroom-scoped SuperGrok
 * OAuth connection. The credential implementation stays in the .server file;
 * only public status, provider-issued login instructions, and selected model
 * ids cross this boundary.
 */
import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "./desk-auth.ts";
import { assertRate, audit } from "./ops.ts";
import type { XaiOauthStatus } from "./xai-oauth.server.ts";

export type { XaiOauthStatus };

function modelInput(raw: unknown): { modelId: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Choose a Grok model.");
  const modelId = (raw as { modelId?: unknown }).modelId;
  if (typeof modelId !== "string" || !modelId.trim())
    throw new Error("Choose a Grok model.");
  return { modelId: modelId.trim() };
}

export const getXaiOauthStatusFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    return (await import("./xai-oauth.server.ts")).getXaiOauthStatus(context.newsroomId);
  });

export const startXaiOauthLoginFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    await assertRate(context.userId, "provider-login", context.newsroomId);
    const status = await (await import("./xai-oauth.server.ts")).startXaiOauthLogin(
      context.newsroomId,
    );
    await audit(context.userId, "provider-login", `xai-oauth ${status.loginState}`, context.newsroomId);
    return status;
  });

export const pollXaiOauthLoginFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    return (await import("./xai-oauth.server.ts")).pollXaiOauthLogin(context.newsroomId);
  });

export const cancelXaiOauthLoginFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    const status = await (await import("./xai-oauth.server.ts")).cancelXaiOauthLogin(
      context.newsroomId,
    );
    await audit(context.userId, "provider-login", "cancel xai-oauth", context.newsroomId);
    return status;
  });

export const disconnectXaiOauthFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    const status = await (await import("./xai-oauth.server.ts")).disconnectXaiOauth(
      context.newsroomId,
    );
    await audit(context.userId, "provider-login", "disconnect xai-oauth", context.newsroomId);
    return status;
  });

export const refreshXaiOauthModelsFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    const status = await (await import("./xai-oauth.server.ts")).refreshXaiOauthModels(
      context.newsroomId,
    );
    await audit(context.userId, "provider-models", "refresh xai-oauth", context.newsroomId);
    return status;
  });

export const selectXaiOauthModelFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(modelInput)
  .handler(async ({ context, data }): Promise<XaiOauthStatus> => {
    assertOwner(context.role);
    const status = await (await import("./xai-oauth.server.ts")).selectXaiOauthModel(
      context.newsroomId,
      data.modelId,
    );
    await audit(context.userId, "provider-models", `select xai-oauth ${data.modelId}`, context.newsroomId);
    return status;
  });

export const testXaiOauthConnectionFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<{ ok: boolean; message: string }> => {
    assertOwner(context.role);
    await assertRate(context.userId, "provider-test", context.newsroomId);
    const result = await (await import("./xai-oauth.server.ts")).testXaiOauthConnection(
      context.newsroomId,
      "GROK_CONNECTION_OK",
    );
    await audit(context.userId, "provider-test", `xai-oauth ${result.ok ? "ok" : "failed"}`, context.newsroomId);
    return result;
  });
