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
import { listPublicRegistry, type PublicRegistryPage } from "./registry-public.server.ts";

/** The page's one read. Public: no middleware, and no desk data in it. */
export const listPublicRegistryPage = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const category = Number((input as { category?: unknown } | null)?.category);
    return {
      category: Number.isInteger(category) && category > 0 ? category : null,
    };
  })
  .handler(async ({ data }): Promise<PublicRegistryPage> => {
    try {
      const sql = await getSql();
      return await listPublicRegistry(sql, DEFAULT_NEWSROOM_ID, data.category);
    } catch (err) {
      // A registry that cannot be read is an empty registry, not a broken
      // page: the reader gets the honest empty state rather than a 500.
      console.error("[registry] listPublicRegistry failed", err);
      return { entries: [], categories: [] };
    }
  });
