import { AsyncLocalStorage } from "node:async_hooks";
import { getSql } from "../db.ts";

type ExecutedModel = { model: string; endpoint: string; provider: string; runtime: string };
type Execution = { jobId: number; claimToken?: string; models: ExecutedModel[] };
const execution = new AsyncLocalStorage<Execution>();

/** Called only after a transport returns a successful model response. */
export function captureExecutedModel(model: ExecutedModel): void {
  const active = execution.getStore();
  if (active && model.model) active.models.push(model);
}

/** Covers composite workers too, so nested drafts, Dark and follow-up calls
 * retain their actual transports even when a terminal write replaces JSON. */
export async function withJobModelExecution<T>(
  jobId: number,
  run: () => Promise<T>,
  claimToken?: string,
): Promise<T> {
  if (execution.getStore()?.jobId === jobId) return run();
  const active: Execution = { jobId, claimToken, models: [] };
  return execution.run(active, async () => {
    try {
      return await run();
    } finally {
      const last = active.models.at(-1);
      if (last) {
        const sql = await getSql();
        const receipt = {
          modelId: last.model,
          modelEndpoint: last.endpoint,
          runtimeProvider: last.provider,
          executedModels: active.models,
        };
        await sql.query(
          `update desk_jobs set result_json=(coalesce(nullif(result_json,'')::jsonb,'{}'::jsonb) || $2::jsonb)::text,
             updated_at=now() where id=$1
             and (($3::text is null and status='running') or claim_token=$3)`,
          [jobId, JSON.stringify(receipt), claimToken ?? null],
        );
      }
    }
  });
}
