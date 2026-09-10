import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";

export type {
  CustomAiConnectionInput,
  PublicCustomAiConnection,
  ConnectionProbeResult,
} from "./custom-ai-connections.server";

export function capabilityStatus(value: boolean | null): "yes" | "no" | "not tested" {
  return value === null ? "not tested" : value ? "yes" : "no";
}

export function managementActionsLocked(saving: boolean, action: string | null): boolean {
  return saving || action !== null;
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid connection request.");
  return raw as Record<string, unknown>;
}
function idInput(raw: unknown) {
  const id = record(raw).id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Connection id is required.");
  return { id: id.trim() };
}

export const getCustomAiConnectionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    (await import("./custom-ai-connections.server")).listCustomAiConnections(context.userId),
  );
export const saveCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const v = record(raw);
    for (const key of ["name", "baseUrl"] as const)
      if (typeof v[key] !== "string") throw new Error(`${key} is required.`);
    for (const key of ["id", "apiKey", "modelId"] as const)
      if (v[key] !== undefined && typeof v[key] !== "string")
        throw new Error(`${key} must be text.`);
    if (v.removeApiKey !== undefined && typeof v.removeApiKey !== "boolean")
      throw new Error("removeApiKey must be true or false.");
    return v as import("./custom-ai-connections.server").CustomAiConnectionInput & { id?: string };
  })
  .handler(async ({ context, data }) =>
    (await import("./custom-ai-connections.server")).saveCustomAiConnection(context.userId, data),
  );
export const enableCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const v = record(raw);
    if (typeof v.enabled !== "boolean") throw new Error("Enabled must be true or false.");
    return { ...idInput(raw), enabled: v.enabled };
  })
  .handler(async ({ context, data }) => {
    await (
      await import("./custom-ai-connections.server")
    ).setCustomAiConnectionEnabled(context.userId, data.id, data.enabled);
    return { ok: true };
  });
export const deleteCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) => {
    await (
      await import("./custom-ai-connections.server")
    ).deleteCustomAiConnection(context.userId, data.id);
    return { ok: true };
  });
export const discoverCustomAiModelsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) =>
    (await import("./custom-ai-connections.server")).discoverCustomAiModels(
      context.userId,
      data.id,
    ),
  );
export const testCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(idInput)
  .handler(async ({ context, data }) =>
    (await import("./custom-ai-connections.server")).testCustomAiConnection(
      context.userId,
      data.id,
    ),
  );
