/*
  The Named outlets panel's RPCs (0.6.63, Unit W), beside sections.ts.

  Same shape as the section list's three calls, including the `{ok:false,
  error}` return: the panel has to be able to show "The outlet list changed
  while you were editing" under the Confirm button rather than throwing into
  a router error boundary and losing the owner's draft. The role check itself
  stays in named-outlets.server.ts, where it can be tested without a server.
*/

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { ForbiddenError, requireEditor } from "./membership.ts";
import {
  previewNamedOutlets,
  readNamedOutlets,
  saveNamedOutlets,
  type NamedOutletConfig,
} from "./named-outlets.server.ts";

export const editorNamedOutlets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return readNamedOutlets(context.userId);
  });

export const namedOutletsPreview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: NamedOutletConfig) => data)
  .handler(async ({ context, data }) => {
    try {
      return { ok: true as const, preview: await previewNamedOutlets(context.userId, data) };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Unable to review the outlet list.",
      };
    }
  });

export const applyNamedOutlets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: NamedOutletConfig) => data)
  .handler(async ({ context, data }) => {
    try {
      const me = await requireEditor(context.userId);
      if (me.role !== "owner") {
        throw new ForbiddenError("Only the owner can change which outlets the paper checks.");
      }
      return { ok: true as const, config: await saveNamedOutlets(context.userId, data) };
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Unable to apply the outlet list. Nothing has been changed.",
      };
    }
  });
