import { resolveLocalModelChoice } from "./provider-settings.ts";
import { isCustomModelChoice, type CustomModelChoice } from "./model-choice.ts";
import {
  PICKER_PROVIDER_IDS,
  providerEntry,
  providerModel,
  type PickerProviderId,
} from "./provider-registry.ts";
import type { OcrOptions } from "./ingest.ts";

type LegacyForcedRuntime = "local" | "claude-cli" | "codex-terra" | "codex-sol";
export type ForcedRuntime = LegacyForcedRuntime | PickerProviderId | CustomModelChoice;
type CloudProviderChoice = Exclude<PickerProviderId, "local-model">;
export type ForcedRuntimeSnapshot =
  | {
      runtime: "local";
      modelChoice: "local-model";
      transport: "local";
      localModel: { baseUrl: string; id: string };
    }
  | {
      runtime: Exclude<ForcedRuntime, "local" | "local-model">;
      modelChoice: CloudProviderChoice;
      transport: "claude-code" | "codex";
      model: string;
    }
  | {
      runtime: CustomModelChoice;
      modelChoice: CustomModelChoice;
      transport: "custom";
      model: string;
      newsroomId: number;
      label?: string;
    };

const choiceFor = (
  runtime: Exclude<ForcedRuntime, CustomModelChoice>,
): PickerProviderId =>
  runtime === "local" || runtime === "local-model"
    ? "local-model"
    : runtime === "claude-cli"
      ? "claude-frontier"
      : runtime === "codex-terra"
        ? "codex-balanced"
        : runtime === "codex-sol"
          ? "codex-frontier"
          : runtime;

export async function validateForcedRuntime(
  newsroomId: number,
  runtime: ForcedRuntime,
): Promise<ForcedRuntimeSnapshot> {
  if (runtime === "local" || runtime === "local-model") {
    const local = await resolveLocalModelChoice(newsroomId);
    if (
      !local.override ||
      !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(
        local.override.baseUrl,
      )
    ) {
      throw new Error(
        "Local model is unavailable. Select a model on a known local endpoint first.",
      );
    }
    return {
      runtime: "local",
      modelChoice: "local-model",
      transport: "local",
      localModel: local.override,
    };
  }
  if (isCustomModelChoice(runtime)) {
    const id = runtime.slice("custom:".length);
    const { resolveCustomAiChoice } = await import("./custom-ai-connections.server.ts");
    const connection = await resolveCustomAiChoice(newsroomId, id);
    const { probeProvider } = await import("./ai.ts");
    const ready = await probeProvider(runtime, newsroomId);
    if (!ready.ok) throw new Error(ready.error);
    return {
      runtime,
      modelChoice: runtime,
      transport: "custom",
      model: connection.modelId,
      newsroomId,
      ...(connection.name ? { label: connection.name } : {}),
    };
  }
  const choice = choiceFor(runtime);
  const entry = providerEntry(choice);
  if (!entry || (entry.kind !== "claude-code" && entry.kind !== "codex")) {
    throw new Error("The selected batch model is unavailable in this build.");
  }
  const ready =
    entry.kind === "claude-code"
      ? await (await import("./ai-claude-code.server.ts")).probeClaudeCode(entry.label)
      : await (await import("./ai-codex.server.ts")).probeCodex(entry.label);
  if (!ready.ok) throw new Error(ready.error);
  return {
    runtime,
    modelChoice: choice as CloudProviderChoice,
    model: providerModel(entry),
    transport: entry.kind,
  };
}

export function parseForcedRuntimeSnapshot(value: unknown): ForcedRuntimeSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.runtime === "local" &&
    row.modelChoice === "local-model" &&
    row.transport === "local" &&
    row.localModel &&
    typeof row.localModel === "object"
  ) {
    const local = row.localModel as Record<string, unknown>;
    if (
      typeof local.baseUrl === "string" &&
      /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(local.baseUrl) &&
      typeof local.id === "string" &&
      local.id.trim()
    ) {
      return {
        runtime: "local",
        modelChoice: "local-model",
        transport: "local",
        localModel: { baseUrl: local.baseUrl, id: local.id },
      };
    }
    return null;
  }
  if (typeof row.runtime === "string" && typeof row.modelChoice === "string") {
    if (
      isCustomModelChoice(row.runtime) &&
      row.modelChoice === row.runtime &&
      row.transport === "custom" &&
      typeof row.model === "string" &&
      row.model.trim() &&
      Number.isSafeInteger(row.newsroomId) &&
      Number(row.newsroomId) > 0 &&
      (row.label === undefined || typeof row.label === "string")
    ) {
      return row as ForcedRuntimeSnapshot;
    }
    const runtime = row.runtime as ForcedRuntime;
    const knownRuntime =
      (["local", "claude-cli", "codex-terra", "codex-sol"] as const).includes(
        runtime as LegacyForcedRuntime,
      ) || PICKER_PROVIDER_IDS.includes(runtime as PickerProviderId);
    const choice = knownRuntime
      ? choiceFor(runtime as Exclude<ForcedRuntime, CustomModelChoice>)
      : null;
    const entry = choice ? providerEntry(choice) : null;
    if (
      entry &&
      entry.kind !== "local" &&
      row.modelChoice === choice &&
      typeof row.model === "string" &&
      row.model.trim() &&
      row.transport === entry.kind
    ) {
      return row as ForcedRuntimeSnapshot;
    }
  }
  return null;
}

type ForcedChatAdapters<T> = {
  claude: (input: {
    system: string;
    user: string;
    model: string;
    timeoutMs: number;
    noTools?: boolean;
  }) => Promise<T>;
  codex: (input: { system: string; user: string; model: string; timeoutMs: number }) => Promise<T>;
  local: (
    system: string,
    user: string,
    maxTokens: number,
    options: {
      timeoutMs?: number;
      choice: "local-model";
      localModel: { baseUrl: string; id: string };
      noTools?: boolean;
    },
  ) => Promise<T>;
  custom?: (
    system: string,
    user: string,
    maxTokens: number,
    options: {
      timeoutMs?: number;
      choice: CustomModelChoice;
      newsroomId: number;
      model: string;
      noTools?: boolean;
    },
  ) => Promise<T>;
};

export async function runForcedChat<T>(
  snapshot: ForcedRuntimeSnapshot,
  system: string,
  user: string,
  maxTokens: number,
  options: { timeoutMs?: number; noTools?: boolean } | undefined,
  adapters: ForcedChatAdapters<T>,
): Promise<T> {
  const valid = parseForcedRuntimeSnapshot(snapshot);
  if (!valid) throw new Error("The forced runtime snapshot is invalid.");
  const timeoutMs = options?.timeoutMs ?? 150000;
  if (valid.runtime === "local") {
    return adapters.local(system, user, maxTokens, {
      ...options,
      choice: "local-model",
      localModel: valid.localModel,
    });
  }
  if (valid.transport === "custom") {
    if (!adapters.custom) {
      throw new Error("The saved Custom AI adapter is unavailable for this batch.");
    }
    return adapters.custom(system, user, maxTokens, {
      ...options,
      choice: valid.modelChoice,
      newsroomId: valid.newsroomId,
      model: valid.model,
    });
  }
  if (valid.transport === "claude-code") {
    return adapters.claude({
      system,
      user,
      model: valid.model,
      timeoutMs,
      noTools: options?.noTools,
    });
  }
  return adapters.codex({ system, user, model: valid.model, timeoutMs });
}

export function forcedOcrOptions(
  snapshot: ForcedRuntimeSnapshot,
  beforeModelCall?: () => Promise<void>,
  adapters?: OcrOptions["adapters"],
): OcrOptions {
  return {
    provider: snapshot.modelChoice,
    newsroomId: snapshot.transport === "custom" ? String(snapshot.newsroomId) : undefined,
    localModel: snapshot.runtime === "local" ? snapshot.localModel : undefined,
    forcedPlan:
      snapshot.runtime === "local"
        ? { kind: "local", baseUrl: snapshot.localModel.baseUrl, model: snapshot.localModel.id }
        : snapshot.transport === "custom"
          ? undefined
          : {
            kind: snapshot.transport,
            model: snapshot.model,
          },
    beforeModelCall,
    adapters,
  };
}

export function forcedRuntimeLabel(snapshot: ForcedRuntimeSnapshot): string {
  if (snapshot.runtime === "local") return `Local model: ${snapshot.localModel.id}`;
  if (snapshot.transport === "custom") {
    return `${snapshot.label ?? "Custom AI"}: ${snapshot.model}`;
  }
  return providerEntry(snapshot.modelChoice)?.label ?? snapshot.modelChoice;
}
