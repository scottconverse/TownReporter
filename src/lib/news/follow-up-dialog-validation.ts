import type { FollowUpAgentKind } from "./types.ts";

export type FollowUpDialogValidationIssue = {
  field: "what" | "targets";
  message: string;
};

/** Return every reason the follow-up form cannot submit, even before a click. */
export function validateFollowUpDialog(input: {
  what: string;
  agentKind: FollowUpAgentKind;
  targets: readonly string[];
}): FollowUpDialogValidationIssue[] {
  const issues: FollowUpDialogValidationIssue[] = [];

  if (!input.what.trim()) {
    issues.push({ field: "what", message: "Say what the follow-up should find out." });
  }

  const badTarget = input.targets.find((target) => !/^https?:\/\//i.test(target));
  if (badTarget) {
    issues.push({ field: "targets", message: "Links to look at must start with http:// or https://" });
  } else if (input.agentKind !== "search" && input.targets.length === 0) {
    issues.push({ field: "targets", message: "Add at least one link to check." });
  }

  return issues;
}
