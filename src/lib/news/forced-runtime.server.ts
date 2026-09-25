import { resolveLocalModelChoice } from "./provider-settings.ts";
import { isCustomModelChoice, type CustomModelChoice } from "./model-choice.ts";
import {
  PICKER_PROVIDER_IDS,
  isAutomaticRungId,
  providerEntry,
  providerModel,
  type AutomaticRungId,
  type PickerProviderId,
  type ProviderId,
  modelEffort,
  type ModelEffort,
} from "./provider-registry.ts";
import type { ProviderProbe } from "./ai.ts";
import type { OcrOptions } from "./ingest.ts";

type LegacyForcedRuntime = "local" | "claude-cli" | "codex-terra" | "codex-sol";
export type ForcedRuntime = LegacyForcedRuntime | PickerProviderId | AutomaticRungId | CustomModelChoice;
type CliProviderChoice = Exclude<PickerProviderId, "local-model" | "grok-oauth">;
/** One rung of Automatic's ladder, minus the internal "configured" entry. */
type LadderChoice = Exclude<ProviderId, "configured">;
export type ForcedRuntimeSnapshot =
  | {
      runtime: "local";
      modelChoice: "local-model";
      transport: "local";
      localModel: { baseUrl: string; id: string };
      modelEffort?: ModelEffort;
    }
  | {
      /*
        0.6.64 (Unit AA). A run on Automatic that resolved to one of Automatic's
        own rungs: DeepSeek v4.1 Flash or Qwen 3.6 35B, both on a local
        endpoint. `transport: "local"` routes it through the same adapter the
        "Local model" snapshot uses; the endpoint is the RUNG's, from the
        registry, so it is never the editor's local-model pick.
      */
      runtime: AutomaticRungId;
      modelChoice: AutomaticRungId;
      transport: "local";
      localModel: { baseUrl: string; id: string };
      modelEffort?: ModelEffort;
    }
  | {
      runtime: Exclude<ForcedRuntime, "local" | "local-model" | AutomaticRungId>;
      modelChoice: CliProviderChoice;
      transport: "claude-code" | "codex";
      model: string;
      modelEffort?: ModelEffort;
    }
  | {
      runtime: "grok-oauth";
      modelChoice: "grok-oauth";
      transport: "xai-oauth";
      model: string;
      newsroomId: number;
      modelEffort?: ModelEffort;
    }
  | {
      runtime: CustomModelChoice;
      modelChoice: CustomModelChoice;
      transport: "custom";
      model: string;
      newsroomId: number;
      label?: string;
      modelEffort?: ModelEffort;
    };

const choiceFor = (
  runtime: Exclude<ForcedRuntime, CustomModelChoice | AutomaticRungId>,
): PickerProviderId =>
  runtime === "local" || runtime === "local-model"
    ? "local-model"
    : runtime === "claude-cli"
      ? "claude-sonnet"
      : runtime === "codex-terra"
        ? "codex-balanced"
        : runtime === "codex-sol"
          ? "codex-frontier"
          : runtime;

/**
 * Resolve a runtime to the exact snapshot a run is pinned to.
 *
 * `options.automaticRung` opens the one door a rung needs (0.6.64, Unit AA):
 * Automatic's own rungs are not pickable models -- no picker lists them and
 * `parseForcedRuntimeSnapshot` refuses them by default -- but a scheduled run
 * that Automatic resolved to a rung has to be able to record the endpoint it
 * ran against. Left off, a rung still throws the same sentence the batch
 * picker has always shown.
 */
export async function validateForcedRuntime(
  newsroomId: number,
  runtime: ForcedRuntime,
  effort?: ModelEffort | null,
  options?: { automaticRung?: boolean },
): Promise<ForcedRuntimeSnapshot> {
  if (runtime === "local" || runtime === "local-model") {
    const local = await resolveLocalModelChoice(newsroomId, "forced");
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
    const { probeProvider } = await import("./ai.ts");
    const ready = await probeProvider("local-model", newsroomId, undefined, "forced");
    if (!ready.ok) throw new Error(ready.error);
    const exactEffort = modelEffort("local-model", effort, local.override.id);
    return {
      runtime: "local",
      modelChoice: "local-model",
      transport: "local",
      localModel: local.override,
      ...(exactEffort ? { modelEffort: exactEffort } : {}),
    };
  }
  if (isCustomModelChoice(runtime)) {
    const id = runtime.slice("custom:".length);
    const { resolveCustomAiChoice } = await import("./custom-ai-connections.server.ts");
    const connection = await resolveCustomAiChoice(newsroomId, id);
    const { probeProvider } = await import("./ai.ts");
    const ready = await probeProvider(runtime, newsroomId, undefined, "forced");
    if (!ready.ok) throw new Error(ready.error);
    const exactEffort = modelEffort(runtime, effort, connection.modelId);
    return {
      runtime,
      modelChoice: runtime,
      transport: "custom",
      model: connection.modelId,
      newsroomId,
      ...(connection.name ? { label: connection.name } : {}),
      ...(exactEffort ? { modelEffort: exactEffort } : {}),
    };
  }
  if (runtime === "grok-oauth") {
    const connection = await (
      await import("./xai-oauth.server.ts")
    ).resolveXaiOauthConnection(newsroomId);
    const { probeProvider } = await import("./ai.ts");
    const ready = await probeProvider(runtime, newsroomId, undefined, "forced");
    if (!ready.ok) throw new Error(ready.error);
    const exactEffort = modelEffort(runtime, effort, connection.modelId);
    return {
      runtime,
      modelChoice: runtime,
      transport: "xai-oauth",
      model: connection.modelId,
      newsroomId,
      ...(exactEffort ? { modelEffort: exactEffort } : {}),
    };
  }
  if (isAutomaticRungId(runtime)) {
    if (!options?.automaticRung) throw new Error("The selected batch model is unavailable in this build.");
    /*
      A rung, named by the run that resolved to it. The endpoint comes from the
      registry through `rungLocalModel`, and the probe is the same one the
      ladder walk used -- so a rung that stopped answering between the walk and
      this call fails here rather than being stored as if it had run.
    */
    const { probeProvider, rungLocalModel } = await import("./ai.ts");
    const localModel = rungLocalModel(runtime);
    if (!localModel) throw new Error("The selected batch model is unavailable in this build.");
    const ready = await probeProvider(runtime, newsroomId, undefined, "forced");
    if (!ready.ok) throw new Error(ready.error);
    const exactEffort = modelEffort(runtime, effort, localModel.id);
    return {
      runtime,
      modelChoice: runtime,
      transport: "local",
      localModel,
      ...(exactEffort ? { modelEffort: exactEffort } : {}),
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
    modelChoice: choice as CliProviderChoice,
    model: providerModel(entry),
    transport: entry.kind,
    ...(modelEffort(choice, effort) ? { modelEffort: modelEffort(choice, effort)! } : {}),
  };
}

/**
 * Resolve Automatic for a run that has to name ONE provider up front.
 *
 * Automatic's own resolution (`probeProvider("auto")`) answers with the
 * operator's configured gateway when there is one, because an interactive
 * editor can be told "it will use your gateway" and the transport reads the
 * gateway again at call time. A scheduled run cannot: it stores the model it
 * will run on in its reservation and run record before the job is queued, and
 * a stored name has to be a model that can be called. So this walks the same
 * ladder, in the same order, and returns the first rung that is READY, already
 * resolved to its exact endpoint (0.6.64, Unit AA).
 *
 * A rung that is skipped rather than failed -- Qwen is used only when it is
 * loaded -- carries its reason forward in `skippedRungs` so the reservation
 * records what was passed over, exactly as the story path's Automatic does.
 * Nothing ready is an error naming every reason, the same shape the story
 * path uses.
 */
export async function resolveAutomaticForcedRuntime(
  newsroomId: number,
  effort?: ModelEffort | null,
  deps?: { probe?: (rung: LadderChoice) => Promise<ProviderProbe> },
): Promise<ForcedRuntimeSnapshot & { skippedRungs?: string[] }> {
  const { AUTOMATIC_LADDER, probeProvider } = await import("./ai.ts");
  const probe =
    deps?.probe ?? ((rung: LadderChoice) => probeProvider(rung, newsroomId, undefined, "forced"));
  const failures: string[] = [];
  const skippedRungs: string[] = [];
  const ladder = AUTOMATIC_LADDER.filter(
    (id): id is LadderChoice => id !== "configured",
  );
  for (const rung of ladder) {
    const ready = await probe(rung);
    if (ready.ok) {
      const snapshot = await validateForcedRuntime(newsroomId, rung, effort, {
        automaticRung: true,
      });
      return skippedRungs.length ? { ...snapshot, skippedRungs } : snapshot;
    }
    if (ready.skippedRungs?.length) skippedRungs.push(...ready.skippedRungs);
    else failures.push(ready.error);
  }
  const skippedNote = skippedRungs.length ? ` Skipped: ${skippedRungs.join("; ")}.` : "";
  throw new Error(`No model in the Automatic ladder is ready. ${failures.join(" ")}${skippedNote}`);
}

export function parseForcedRuntimeSnapshot(
  value: unknown,
  options?: { automaticRung?: boolean },
): ForcedRuntimeSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  /*
    A rung snapshot (0.6.64, Unit AA), read only where the caller says so. The
    default is deny, and that is the point: a rung is not a model an editor can
    pick, so a stored row naming one is a row this build must not run -- the
    same answer the batch picker gives for it.

    No loopback guard here, unlike the "local" variant above: that guard stops
    an editor pointing a local run at a remote host, while a rung's base URL
    comes from the registry and the rung's own env override -- operator
    configuration, which the transport reads through `rungGateway` anyway.
  */
  if (options?.automaticRung && isAutomaticRungId(row.runtime)) {
    if (
      row.modelChoice === row.runtime &&
      row.transport === "local" &&
      row.localModel &&
      typeof row.localModel === "object"
    ) {
      const local = row.localModel as Record<string, unknown>;
      if (
        typeof local.baseUrl === "string" &&
        /^https?:\/\//i.test(local.baseUrl) &&
        typeof local.id === "string" &&
        local.id.trim()
      ) {
        const parsedEffort =
          row.modelEffort === undefined ? null : modelEffort(row.runtime, row.modelEffort, local.id);
        if (row.modelEffort !== undefined && parsedEffort !== row.modelEffort) return null;
        return {
          runtime: row.runtime,
          modelChoice: row.runtime,
          transport: "local",
          localModel: { baseUrl: local.baseUrl, id: local.id },
          ...(parsedEffort ? { modelEffort: parsedEffort } : {}),
        };
      }
    }
    return null;
  }
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
      const parsedEffort = row.modelEffort === undefined
        ? null
        : modelEffort("local-model", row.modelEffort, local.id);
      if (row.modelEffort !== undefined && parsedEffort !== row.modelEffort) return null;
      return {
        runtime: "local",
        modelChoice: "local-model",
        transport: "local",
        localModel: { baseUrl: local.baseUrl, id: local.id },
        ...(parsedEffort ? { modelEffort: parsedEffort } : {}),
      };
    }
    return null;
  }
  if (typeof row.runtime === "string" && typeof row.modelChoice === "string") {
    if (
      row.runtime === "grok-oauth" &&
      row.modelChoice === "grok-oauth" &&
      row.transport === "xai-oauth" &&
      typeof row.model === "string" &&
      row.model.trim() &&
      Number.isSafeInteger(row.newsroomId) &&
      Number(row.newsroomId) > 0
    ) {
      const parsedEffort = row.modelEffort === undefined
        ? null
        : modelEffort("grok-oauth", row.modelEffort, row.model);
      if (row.modelEffort !== undefined && parsedEffort !== row.modelEffort) return null;
      return row as ForcedRuntimeSnapshot;
    }
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
      const parsedEffort = row.modelEffort === undefined
        ? null
        : modelEffort(row.runtime, row.modelEffort, row.model);
      if (row.modelEffort !== undefined && parsedEffort !== row.modelEffort) return null;
      return row as ForcedRuntimeSnapshot;
    }
    const runtime = row.runtime as ForcedRuntime;
    // `grok-oauth` is retired from every picker (0.6.63, Unit Y item 4) and has
    // its own branch above, so a stored row that reaches here on the retired id
    // is not a snapshot this build can run. `PICKER_PROVIDER_IDS` no longer
    // contains it, so this is a plain membership answer, not a cast.
    const knownRuntime =
      (["local", "claude-cli", "codex-terra", "codex-sol"] as const).includes(
        runtime as LegacyForcedRuntime,
      ) || (PICKER_PROVIDER_IDS as readonly string[]).includes(runtime);
    const choice = knownRuntime
      ? choiceFor(runtime as Exclude<ForcedRuntime, CustomModelChoice | AutomaticRungId>)
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
      const parsedEffort = row.modelEffort === undefined ? null : modelEffort(choice, row.modelEffort);
      if (row.modelEffort !== undefined && parsedEffort !== row.modelEffort) return null;
      return row as ForcedRuntimeSnapshot;
    }
  }
  return null;
}

export type ForcedChatAdapters<T> = {
  claude: (input: {
    system: string;
    user: string;
    model: string;
    timeoutMs: number;
    noTools?: boolean;
    reasoningEffort?: ModelEffort | null;
  }) => Promise<T>;
  codex: (input: { system: string; user: string; model: string; timeoutMs: number; reasoningEffort?: ModelEffort | null }) => Promise<T>;
  local: (
    system: string,
    user: string,
    maxTokens: number,
    options: {
      timeoutMs?: number;
      choice: "local-model";
      localModel: { baseUrl: string; id: string };
      noTools?: boolean;
      reasoningEffort?: ModelEffort | null;
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
      reasoningEffort?: ModelEffort | null;
    },
  ) => Promise<T>;
  xai?: (
    system: string,
    user: string,
    maxTokens: number,
    options: {
      timeoutMs?: number;
      choice: "grok-oauth";
      newsroomId: number;
      model: string;
      noTools?: boolean;
      reasoningEffort?: ModelEffort | null;
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
  const valid = parseForcedRuntimeSnapshot(snapshot, { automaticRung: true });
  if (!valid) throw new Error("The forced runtime snapshot is invalid.");
  const timeoutMs = options?.timeoutMs ?? 150000;
  if (valid.transport === "local") {
    return adapters.local(system, user, maxTokens, {
      ...options,
      choice: "local-model",
      localModel: valid.localModel,
      ...(valid.modelEffort ? { reasoningEffort: valid.modelEffort } : {}),
    });
  }
  if (valid.transport === "xai-oauth") {
    if (!adapters.xai) {
      throw new Error("The saved SuperGrok OAuth adapter is unavailable for this batch.");
    }
    return adapters.xai(system, user, maxTokens, {
      ...options,
      choice: "grok-oauth",
      newsroomId: valid.newsroomId,
      model: valid.model,
      ...(valid.modelEffort ? { reasoningEffort: valid.modelEffort } : {}),
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
      ...(valid.modelEffort ? { reasoningEffort: valid.modelEffort } : {}),
    });
  }
  if (valid.transport === "claude-code") {
    return adapters.claude({
      system,
      user,
      model: valid.model,
      timeoutMs,
      noTools: options?.noTools,
      reasoningEffort: valid.modelEffort,
    });
  }
  return adapters.codex({ system, user, model: valid.model, timeoutMs, reasoningEffort: valid.modelEffort });
}

export function forcedOcrOptions(
  snapshot: ForcedRuntimeSnapshot,
  beforeModelCall?: () => Promise<void>,
  adapters?: OcrOptions["adapters"],
  onProviderSwitch?: OcrOptions["onProviderSwitch"],
): OcrOptions {
  return {
    provider: snapshot.modelChoice,
    ...(snapshot.modelEffort ? { reasoningEffort: snapshot.modelEffort } : {}),
    newsroomId:
      snapshot.transport === "custom" || snapshot.transport === "xai-oauth"
        ? String(snapshot.newsroomId)
        : undefined,
    localModel: snapshot.transport === "local" ? snapshot.localModel : undefined,
    forcedPlan:
      snapshot.transport === "local"
        ? { kind: "local", baseUrl: snapshot.localModel.baseUrl, model: snapshot.localModel.id }
        : snapshot.transport === "custom" || snapshot.transport === "xai-oauth"
          ? undefined
          : {
            kind: snapshot.transport,
            model: snapshot.model,
          },
    beforeModelCall,
    adapters,
    ...(onProviderSwitch ? { onProviderSwitch } : {}),
  };
}

export function forcedRuntimeLabel(snapshot: ForcedRuntimeSnapshot): string {
  if (snapshot.runtime === "local") return `Local model: ${snapshot.localModel.id}`;
  if (snapshot.transport === "xai-oauth") return `Grok (SuperGrok): ${snapshot.model}`;
  if (snapshot.transport === "custom") {
    return `${snapshot.label ?? "Custom AI"}: ${snapshot.model}`;
  }
  return providerEntry(snapshot.modelChoice)?.label ?? snapshot.modelChoice;
}
