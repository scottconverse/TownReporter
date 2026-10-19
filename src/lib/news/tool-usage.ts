import { sanitizeJsonLeaves } from "./storable-text.ts";
import type { ChatResult, ChatResultMetadata, ToolRoundDetail } from "./ai-result-metadata.ts";
import type { Sql } from "../db.ts";

export type ToolUsage = Pick<ChatResultMetadata, "toolExecutions" | "toolRounds" | "toolResultChars" | "toolRoundDetails">;

/** Guidance only: the existing request deadline remains the only time limit. */
export function toolTimeGuidance(result: string, deadline: number, timeoutMs: number): string {
  const left = Math.max(0, deadline - Date.now());
  return result + "\n\nTime left for this answer: about " + Math.ceil(left / 1000) + " seconds."
    + (left < timeoutMs * 0.25 ? "\nWrite your final answer now." : "");
}

export function createToolUsage() {
  const counts: Record<string, number> = {};
  let rounds = 0;
  let chars = 0;
  const details: ToolRoundDetail[] = [];
  return {
    round(timeMs: number) {
      const detail: ToolRoundDetail = { round: ++rounds, timeMs, tools: [] };
      details.push(detail);
      if (details.length > 60) details.shift();
      return detail;
    },
    async execute(detail: ToolRoundDetail, name: string, args: unknown, execute: () => Promise<string>, deadline: number, timeoutMs: number) {
      counts[name] = (counts[name] ?? 0) + 1;
      const started = Date.now();
      const item = { name, arguments: (typeof args === "string" ? args : JSON.stringify(args) ?? "").slice(0, 200), timeMs: 0, resultChars: 0 };
      detail.tools.push(item);
      try {
        const result = toolTimeGuidance(await execute(), deadline, timeoutMs);
        item.resultChars = result.length;
        chars += result.length;
        return result;
      } finally { item.timeMs = Math.max(0, Date.now() - started); }
    },
    snapshot(): ToolUsage {
      return { toolExecutions: { ...counts }, toolRounds: rounds, toolResultChars: chars,
        toolRoundDetails: details.map(d => ({ ...d, tools: d.tools.map(t => ({ ...t })) })) };
    },
  };
}

/** Sum raw calls once at the job boundary, including failed calls and retries. */
export function addToolUsage(total: ToolUsage, meta?: ToolUsage): ToolUsage {
  const counts = { ...total.toolExecutions };
  for (const [name, n] of Object.entries(meta?.toolExecutions ?? {})) counts[name] = (counts[name] ?? 0) + n;
  const offset = total.toolRounds ?? 0;
  return { toolExecutions: counts, toolRounds: offset + (meta?.toolRounds ?? 0),
    toolResultChars: (total.toolResultChars ?? 0) + (meta?.toolResultChars ?? 0),
    toolRoundDetails: [...(total.toolRoundDetails ?? []), ...(meta?.toolRoundDetails ?? []).map(d => ({ ...d, round: d.round + offset }))].slice(-60) };
}

/** Merge into the existing receipt so checkpoints and later failure retain usage. */
export function jobToolRecorder(sql: Sql, job: { id: number; newsroom_id: number; claim_token?: string | null }) {
  let total: ToolUsage = {};
  return async <T extends ChatResult>(result: T): Promise<T> => {
    if (!result.meta) return result;
    total = addToolUsage(total, result.meta);
    const receipt = JSON.stringify(sanitizeJsonLeaves(total));
    await sql`
      update desk_jobs
      set result_json = (coalesce(nullif(result_json, ''), '{}')::jsonb || ${receipt}::jsonb)::text
      where id = ${job.id} and newsroom_id = ${job.newsroom_id}
        and status = 'running' and claim_token = ${job.claim_token ?? ""}
    `;
    return result;
  };
}
