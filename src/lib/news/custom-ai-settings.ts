import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import {
  cleanConnectionEnabled,
  cleanConnectionId,
  cleanConnectionInput,
} from "./request-input.ts";
import type {
  CustomAiConnectionInput,
  PublicCustomAiConnection,
} from "./custom-ai-connections.server";

export type {
  CustomAiConnectionInput,
  PublicCustomAiConnection,
  ConnectionProbeResult,
} from "./custom-ai-connections.server";

export function connectionSaveMessage(saved: PublicCustomAiConnection): string {
  return saved.modelId
    ? `${saved.name} saved with ${saved.modelId}. It is ready to choose in the writing model picker.`
    : `${saved.name} saved. Choose a model in Server settings before it can be selected for a run.`;
}

export function upsertCustomAiConnection(
  current: PublicCustomAiConnection[] | undefined,
  saved: PublicCustomAiConnection,
): PublicCustomAiConnection[] {
  return [...(current ?? []).filter((connection) => connection.id !== saved.id), saved].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

export function updateCustomAiConnectionEnabled(
  current: PublicCustomAiConnection[] | undefined,
  id: string,
  enabled: boolean,
): PublicCustomAiConnection[] {
  return (current ?? []).map((connection) =>
    connection.id === id ? { ...connection, enabled } : connection,
  );
}

export function removeCustomAiConnection(
  current: PublicCustomAiConnection[] | undefined,
  id: string,
): PublicCustomAiConnection[] {
  return (current ?? []).filter((connection) => connection.id !== id);
}

type CustomAiConnectionSave = (
  input: CustomAiConnectionInput & { id?: string },
) => Promise<PublicCustomAiConnection>;

type CustomAiConnectionCache = {
  setQueryData<TData>(
    queryKey: readonly unknown[],
    updater: (current: TData | undefined) => TData,
  ): unknown;
};

export async function saveCustomAiConnectionAndCache(
  input: CustomAiConnectionInput & { id?: string },
  save: CustomAiConnectionSave,
  queryClient: CustomAiConnectionCache,
): Promise<PublicCustomAiConnection> {
  const saved = await save(input);
  queryClient.setQueryData<PublicCustomAiConnection[] | undefined>(
    ["custom-ai-connections"],
    (current) => upsertCustomAiConnection(current, saved),
  );
  return saved;
}

export function capabilityStatus(value: boolean | null): "yes" | "no" | "not tested" {
  return value === null ? "not tested" : value ? "yes" : "no";
}

export function managementActionsLocked(saving: boolean, action: string | null): boolean {
  return saving || action !== null;
}
/*
  `record` / `idInput` moved to request-input.ts as `cleanConnectionInput`,
  `cleanConnectionId` and `cleanConnectionEnabled`. They still throw the same
  Errors for the same bodies -- what is new is the string ceilings, and that
  the save call now returns the six keys its type names instead of the raw
  object cast to that type. See request-input.ts for why.
*/

export const getCustomAiConnectionsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    (await import("./custom-ai-connections.server")).listCustomAiConnections(context.userId),
  );
export const saveCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanConnectionInput(raw))
  .handler(async ({ context, data }) =>
    (await import("./custom-ai-connections.server")).saveCustomAiConnection(context.userId, data),
  );
export const enableCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanConnectionEnabled(raw))
  .handler(async ({ context, data }) => {
    await (
      await import("./custom-ai-connections.server")
    ).setCustomAiConnectionEnabled(context.userId, data.id, data.enabled);
    return { ok: true };
  });
export const deleteCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanConnectionId(raw))
  .handler(async ({ context, data }) => {
    await (
      await import("./custom-ai-connections.server")
    ).deleteCustomAiConnection(context.userId, data.id);
    return { ok: true };
  });
export const discoverCustomAiModelsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanConnectionId(raw))
  .handler(async ({ context, data }) =>
    (await import("./custom-ai-connections.server")).discoverCustomAiModels(
      context.userId,
      data.id,
    ),
  );
export const testCustomAiConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanConnectionId(raw))
  .handler(async ({ context, data }) =>
    (await import("./custom-ai-connections.server")).testCustomAiConnection(
      context.userId,
      data.id,
    ),
  );
