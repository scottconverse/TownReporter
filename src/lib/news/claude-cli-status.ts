import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "./desk-auth";

/** What the Server page's research-tool row reads (F02, Nov 2026). */
export type ClaudeCliStatus = {
  found: boolean;
  path: string | null;
  researchWriterInLadder: boolean;
};

/**
 * The Server > Health row: is the Claude Code CLI on this machine?
 *
 * The lookup only looks for the file; it never runs the CLI. Owner-only, the
 * same gate as `getOpsHealth`, because it reports a path on this machine.
 */
export const claudeCliStatusFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<ClaudeCliStatus> => {
    assertOwner(context.role);
    const { findClaudeCli } = await import("./ai-claude-code.server.ts");
    const { researchWriterInDraftingLadder } = await import("./provider-registry.ts");
    const path = await findClaudeCli();
    return {
      found: path !== null,
      path,
      researchWriterInLadder: researchWriterInDraftingLadder(),
    };
  });
