/**
 * The public Registry page's one read (spec 15.1, 18.2 and 24, Phase 1).
 *
 * This file is plain, not `.server`, because the route imports it: a route is
 * client code and may not import a `*.server.*` file. The server function's
 * handler is removed from the client bundle, so the data functions this imports
 * from `registry-public.server.ts` never reach the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../../db.ts";
import { DEFAULT_NEWSROOM_ID } from "../membership.ts";
import { readPublicRegistry, type PublicRegistryResult } from "./registry-public.server.ts";

/** The page's one read. Public: no middleware, and no desk data in it. */
export const listPublicRegistryPage = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const category = Number((input as { category?: unknown } | null)?.category);
    return {
      category: Number.isInteger(category) && category > 0 ? category : null,
    };
  })
  .handler(
    // A registry that cannot be read comes back as `unavailable`, never as an
    // empty list: the page must not tell a reader nothing is published when the
    // truth is that the database could not be read.
    async ({ data }): Promise<PublicRegistryResult> =>
      readPublicRegistry(getSql, DEFAULT_NEWSROOM_ID, data.category),
  );
