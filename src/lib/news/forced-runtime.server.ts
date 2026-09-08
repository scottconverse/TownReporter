import { resolveLocalModelChoice } from "./provider-settings.ts";
import { providerEntry, providerModel } from "./provider-registry.ts";
import type { OcrOptions } from "./ingest.ts";

export type ForcedRuntime = "local" | "claude-cli" | "codex-terra" | "codex-sol";
export type ForcedRuntimeSnapshot =
  | {
      runtime: "local";
      modelChoice: "local-model";
      transport: "local";
      localModel: { baseUrl: string; id: string };
    }
  | {
      runtime: "claude-cli" | "codex-terra" | "codex-sol";
      modelChoice: string;
      transport: "claude-code" | "codex";
      model: string;
    };

const choiceFor = (runtime: ForcedRuntime) =>
  runtime === "local"
    ? "local-model"
    : runtime === "claude-cli"
      ? "claude-frontier"
      : runtime === "codex-terra"
        ? "codex-balanced"
        : "codex-frontier";

export async function validateForcedRuntime(
  newsroomId: number,
  runtime: ForcedRuntime,
): Promise<ForcedRuntimeSnapshot> {
  if (runtime === "local") {
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
      runtime,
      modelChoice: "local-model",
      transport: "local",
      localModel: local.override,
    };
  }
  const choice = choiceFor(runtime);
  const ready =
    runtime === "claude-cli"
      ? await (await import("./ai-claude-code.server.ts")).probeClaudeCode("Claude Code")
      : await (
          await import("./ai-codex.server.ts")
        ).probeCodex(runtime === "codex-terra" ? "Codex Terra" : "Codex Sol");
  if (!ready.ok) throw new Error(ready.error);
  const entry = providerEntry(choice);
  if (!entry) throw new Error("The selected subscription runtime is unavailable in this build.");
  return {
    runtime,
    modelChoice: choice,
    model: providerModel(entry),
    transport: runtime === "claude-cli" ? "claude-code" : "codex",
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
  if (
    (row.runtime === "claude-cli" ||
      row.runtime === "codex-terra" ||
      row.runtime === "codex-sol") &&
    row.modelChoice === choiceFor(row.runtime) &&
    typeof row.model === "string" &&
    row.model.trim() &&
    row.transport === (row.runtime === "claude-cli" ? "claude-code" : "codex")
  ) {
    return row as ForcedRuntimeSnapshot;
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
  if (valid.runtime === "claude-cli") {
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
    localModel: snapshot.runtime === "local" ? snapshot.localModel : undefined,
    forcedPlan:
      snapshot.runtime === "local"
        ? { kind: "local", baseUrl: snapshot.localModel.baseUrl, model: snapshot.localModel.id }
        : {
            kind: snapshot.runtime === "claude-cli" ? "claude-code" : "codex",
            model: snapshot.model,
          },
    beforeModelCall,
    adapters,
  };
}

export function forcedRuntimeLabel(snapshot: ForcedRuntimeSnapshot): string {
  return snapshot.runtime === "local"
    ? `Local model: ${snapshot.localModel.id}`
    : snapshot.runtime === "claude-cli"
      ? "Claude Code"
      : snapshot.runtime === "codex-terra"
        ? "Codex Terra"
        : "Codex Sol";
}
