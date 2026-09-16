export type DarkRunStopReason =
  | "elapsed-time-limit"
  | "model-call-limit"
  | "search-limit"
  | "document-read-limit"
  | "evidence-sufficient"
  | "diminishing-returns"
  | "repeated-sources"
  | "no-materially-new-finding"
  | "frontier-exhausted"
  | "hop-limit"
  | "synthesis-failed"
  | "provider-failed"
  | "completed";

export type DarkRunBudgetLimits = {
  elapsedMs: number;
  modelCalls: number;
  searches: number;
  documentReads: number;
};

export type DarkUsageCall = {
  stage: string;
  provider: string;
  model: string;
  durationMs: number;
  result: string;
  timedOut: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type DarkUsageTotals = {
  modelCalls: number;
  searches: number;
  documentReads: number;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type DarkRunUsageSnapshot = {
  totals: DarkUsageTotals;
  calls: DarkUsageCall[];
};

export type DarkModelCallFinish = {
  result: string;
  durationMs?: number;
  timedOut?: boolean;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type DarkModelCallHandle = {
  finish: (result: DarkModelCallFinish) => void;
};

export type DarkRunBudget = ReturnType<typeof createDarkRunBudget>;

function wholeNonNegative(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function createDarkRunBudget(
  rawLimits: DarkRunBudgetLimits,
  deps: { now?: () => number } = {},
) {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const limits = {
    elapsedMs: Math.max(1, wholeNonNegative(rawLimits.elapsedMs)),
    modelCalls: wholeNonNegative(rawLimits.modelCalls),
    searches: wholeNonNegative(rawLimits.searches),
    documentReads: wholeNonNegative(rawLimits.documentReads),
  };
  let modelCalls = 0;
  let searches = 0;
  let documentReads = 0;
  let stopReason: DarkRunStopReason | null = null;
  const calls: DarkUsageCall[] = [];

  const elapsedMs = () => wholeNonNegative(now() - startedAt);
  const markStop = (reason: DarkRunStopReason) => {
    stopReason ??= reason;
    return false;
  };
  const withinElapsed = () =>
    elapsedMs() < limits.elapsedMs || markStop("elapsed-time-limit");

  return {
    get stopReason(): DarkRunStopReason | null {
      if (!stopReason) withinElapsed();
      return stopReason;
    },
    limits,
    markStop(reason: DarkRunStopReason) {
      stopReason ??= reason;
    },
    consumeSearch() {
      if (!withinElapsed()) return false;
      if (searches >= limits.searches) return markStop("search-limit");
      searches += 1;
      return true;
    },
    consumeDocumentRead() {
      if (!withinElapsed()) return false;
      if (documentReads >= limits.documentReads) return markStop("document-read-limit");
      documentReads += 1;
      return true;
    },
    remainingMs() {
      return Math.max(0, limits.elapsedMs - elapsedMs());
    },
    startModelCall(call: Pick<DarkUsageCall, "stage" | "provider" | "model">): DarkModelCallHandle | null {
      if (!withinElapsed()) return null;
      if (modelCalls >= limits.modelCalls) {
        markStop("model-call-limit");
        return null;
      }
      modelCalls += 1;
      const callStartedAt = now();
      let finished = false;
      return {
        finish(result) {
          if (finished) return;
          finished = true;
          const row: DarkUsageCall = {
            stage: call.stage,
            provider: result.provider ?? call.provider,
            model: result.model ?? call.model,
            durationMs: wholeNonNegative(result.durationMs ?? (now() - callStartedAt)),
            result: result.result,
            timedOut: Boolean(result.timedOut),
          };
          if (Number.isFinite(result.inputTokens)) row.inputTokens = wholeNonNegative(result.inputTokens!);
          if (Number.isFinite(result.outputTokens)) row.outputTokens = wholeNonNegative(result.outputTokens!);
          if (Number.isFinite(result.totalTokens)) row.totalTokens = wholeNonNegative(result.totalTokens!);
          calls.push(row);
        },
      };
    },
    snapshot(): DarkRunUsageSnapshot {
      const completeTokenTotal = (field: "inputTokens" | "outputTokens" | "totalTokens") =>
        calls.length > 0 && calls.every((call) => call[field] !== undefined)
          ? calls.reduce((sum, call) => sum + (call[field] ?? 0), 0)
          : null;
      return {
        totals: {
          modelCalls,
          searches,
          documentReads,
          elapsedMs: elapsedMs(),
          inputTokens: completeTokenTotal("inputTokens"),
          outputTokens: completeTokenTotal("outputTokens"),
          totalTokens: completeTokenTotal("totalTokens"),
        },
        calls: calls.map((call) => ({ ...call })),
      };
    },
  };
}
