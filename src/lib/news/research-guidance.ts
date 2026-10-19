/** Shared by stage prompts (including CLI models) and API tool loops. */
export const RESEARCH_GUIDANCE = "Use tools to find and check facts, then deliver the requested JSON. Once the facts needed for this task are supported, stop researching and write the stage's answer. Treat 404, 429, 403 and repeated pages yielding no new facts as dead ends; note them in an existing open-questions or follow-up field if present. Do not paginate listings beyond the story's needs.";

export function researchSystem(system: string, toolsEnabled = true): string {
  // Remove only the shared addition; preserve all caller-specific stage text.
  if (!toolsEnabled) return system.replaceAll(RESEARCH_GUIDANCE, "");
  return system.includes(RESEARCH_GUIDANCE) ? system : system + "\n\n" + RESEARCH_GUIDANCE;
}
