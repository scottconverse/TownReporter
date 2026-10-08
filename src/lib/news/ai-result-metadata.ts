/**
 * Per-attempt facts suitable for the Dark run ledger.
 *
 * Token fields are copied only when a provider explicitly reports the named
 * counter. In particular, adapters must not derive totals by adding partial
 * counters or estimate tokens from text length.
 */
export type ChatResultMetadata = {
  /** Provider transport that completed (for example, `claude-code`). */
  provider: string;
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
  | { ok: false; error: string; meta?: ChatResultMetadata };
