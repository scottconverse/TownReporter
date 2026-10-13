import { useRef, useState } from "react";
import type { DraftBatchRuntime } from "@/lib/news/draft-batch";
import { batchRuntimePick } from "@/lib/news/queue-rows";
import type { ModelEffort } from "@/lib/news/provider-registry";
import { useJobModelAssignment } from "@/components/use-job-model-assignment";

/**
 * The Queue batch's model choice, as one piece of state (DHE1-10, DHD1-2).
 *
 * The bulk strip ("Model for these stories") and the batch dialog ("Draft the
 * selected leads") are two pickers over this ONE runtime and ONE effort. The
 * Start press runs whatever this state holds, so the model a picker shows is
 * the model that runs. Both screens take `runtime`, `effort`, `pick` and
 * `setEffort` from here; neither keeps a copy of its own.
 *
 * `touched` turns true on the editor's first pick, so a late saved-assignment
 * default cannot overwrite what the editor chose in either picker.
 */
export function useBatchModelChoice() {
  const [runtime, setRuntime] = useState<DraftBatchRuntime>("auto");
  const [effort, setEffort] = useState<ModelEffort | null>(null);
  const touched = useRef(false);
  useJobModelAssignment<DraftBatchRuntime>({
    jobKey: "story-draft",
    touched,
    setChoice: setRuntime,
    setEffort,
  });
  const pick = (choice: string) => {
    touched.current = true;
    const next = batchRuntimePick(choice);
    setRuntime(next.runtime);
    setEffort(next.effort);
  };
  return { runtime, effort, setEffort, pick, touched };
}
