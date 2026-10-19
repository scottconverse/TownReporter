/**
 * Per-attempt facts suitable for the Dark run ledger.
 *
 * Token fields are copied only when a provider explicitly reports the named
 * counter. In particular, adapters must not derive totals by adding partial
 * counters or estimate tokens from text length.
 */
export type ToolRoundDetail = {
  round: number;
  timeMs: number;
  tools: Array<{ name: string; arguments: string; timeMs: number; resultChars: number }>;
};

export type ChatResultMetadata = {
  /** Provider transport that completed (for example, `claude-code`). */
  provider: string;
  /** Actual model-requested tool invocations, including failed executions. */
  toolExecutions?: Record<string, number>;
  /** Tool-bearing response rounds, without any execution limit. */
  toolRounds?: number;
  /** Characters sent as tool-result content, including deadline guidance. */
  toolResultChars?: number;
  /** Detail for the last 60 tool-bearing rounds; totals above are never truncated. */
  toolRoundDetails?: ToolRoundDetail[];
  /** Endpoint explicitly rejected tools and was retried once without them. */
  toolsFallback?: boolean;
  /** Provider-reported model ID when available; otherwise the CLI model selector. */
  model: string;
  /** CLI-reported duration when available, otherwise this process's elapsed wall time. */
  durationMs: number;
  /** True only when TownReporter ended the attempt at its configured deadline. */
  timedOut: boolean;
  /** Exact provider-reported input-token counter, when present. */
  inputTokens?: number;
  /** Exact provider-reported output-token counter, when present. */
  outputTokens?: number;
  /** Exact provider-reported total-token counter, when present. */
  totalTokens?: number;
};

export type ChatResult =
  | { ok: true; text: string; meta?: ChatResultMetadata }
  | { ok: false; error: string; partialText?: string; meta?: ChatResultMetadata };
