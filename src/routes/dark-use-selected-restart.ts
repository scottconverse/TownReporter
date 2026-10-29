/**
 * A finished job state after the editor pressed "Use selected model".
 *
 * desk_jobs currently settles at completed, failed or cancelled. "stopped" is
 * included because the editor-facing contract names it as a finished state and
 * a future worker must not make this press silently stop working.
 */
const FINISHED_DARK_ROUND_STATES = new Set(["failed", "stopped", "cancelled", "completed"]);

export type DarkRoundRestartState = {
  id: number;
  status: string;
};

/**
 * Decide whether the requested restart has reached its one safe moment.
 *
 * The old round must be the one the editor asked to stop, must have settled,
 * and must not already have launched its replacement. Keeping this decision
 * pure makes the completed-before-stop race explicit and testable.
 */
export function shouldRestartDarkRoundOnSelectedModel(
  pendingJobId: number | null,
  job: DarkRoundRestartState | null | undefined,
  alreadyRestarted: boolean,
): boolean {
  if (pendingJobId == null || alreadyRestarted || job?.id !== pendingJobId) return false;
  return FINISHED_DARK_ROUND_STATES.has(job.status);
}
