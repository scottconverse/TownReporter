import { useRef, useState } from "react";
import { useJobModelAssignment } from "@/components/use-job-model-assignment";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";

/**
 * The Dark Desk's "Digging model" and its effort, as one piece of state
 * (DHE1-2).
 *
 * The page's dials panel, the open file's "Digging model for this file" picker
 * and the "Start a file" dialog are all views over this ONE model and ONE
 * effort. The dialog takes them as its `shared` prop, so a file opens with what
 * the editor sees; a change in any of the three shows in the others at once.
 * Before this hook, the open file kept a second copy, and the walk saw the
 * dialog say Low while the page said Medium.
 *
 * `touched` turns true on the editor's first pick, so a late saved-assignment
 * default cannot overwrite what the editor chose.
 */
export function useDarkModelChoice() {
  const [model, setModel] = useState<StoryModelChoice>("auto");
  const [effort, setEffort] = useState<ModelEffort | null>(null);
  const touched = useRef(false);
  const assignment = useJobModelAssignment<StoryModelChoice>({
    jobKey: "dark",
    touched,
    setChoice: setModel,
    setEffort,
  });
  const pick = (choice: StoryModelChoice) => {
    touched.current = true;
    setModel(choice);
    setEffort(defaultModelEffort(choice));
  };
  return { model, effort, setModel, setEffort, pick, touched, assignment };
}
