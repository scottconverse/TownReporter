import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import {
  getModelAssignmentsFn,
  MODEL_ASSIGNMENTS_QUERY_KEY,
} from "@/lib/news/model-assignments-settings";
import {
  resolveJobModel,
  type ModelJobKey,
  type JobModelResolution,
} from "@/lib/news/model-assignments";
import type { ModelEffort } from "@/lib/news/provider-registry";

/**
 * Seed a door from the paper's saved first choice for that job.
 *
 * The route owns its per-run state and marks `touched` when an editor changes
 * the picker. This hook only applies the saved first choice while that state
 * is untouched. A route with a remembered story can set `preserveCurrent` so
 * the story's own recorded model remains the stronger default.
 */
export function useJobModelAssignment<T extends string>(input: {
  jobKey: ModelJobKey;
  touched: MutableRefObject<boolean>;
  setChoice: (choice: T) => void;
  setEffort: (effort: ModelEffort | null) => void;
  preserveCurrent?: boolean;
  /** Reapply a dialog default when that dialog opens again. */
  refreshWhen?: unknown;
}): {
  resolution: JobModelResolution;
  hasAssignment: boolean;
  isPending: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: MODEL_ASSIGNMENTS_QUERY_KEY,
    queryFn: () => getModelAssignmentsFn(),
    staleTime: 30_000,
  });
  const resolution = resolveJobModel({
    jobKey: input.jobKey,
    assignments: query.data?.ok ? query.data.assignments : [],
  });
  const callbacks = useRef(input);
  callbacks.current = input;

  useEffect(() => {
    if (
      resolution.source !== "assignment" ||
      callbacks.current.touched.current ||
      callbacks.current.preserveCurrent
    ) {
      return;
    }
    callbacks.current.setChoice(resolution.providerId as T);
    callbacks.current.setEffort(resolution.effort);
  }, [
    input.preserveCurrent,
    input.refreshWhen,
    resolution.effort,
    resolution.providerId,
    resolution.source,
  ]);

  return {
    resolution,
    hasAssignment: resolution.source === "assignment",
    isPending: query.isPending,
    isError: query.isError || query.data?.ok === false,
  };
}
