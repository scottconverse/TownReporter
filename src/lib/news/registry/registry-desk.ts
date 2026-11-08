/**
 * The desk's one read of the registry (spec 24, Phase 1).
 *
 * This file is plain, not `.server`, because the route imports it: a route is
 * client code and may not import a `*.server.*` file. The handler body is
 * removed from the client bundle, so the data functions this imports from
 * `registry-desk.server.ts` never reach the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../../db.ts";
import { deskMiddleware } from "../desk-auth.ts";
import {
  countPublishedRegistryServices,
  listDeskChanges,
  listPublishedRegistryEntries,
  listRegistryCategoryNames,
  listRegistryImports,
  listRegistrySourcesWithHealth,
  listUnpublishedRegistryEntries,
  starterListIsLoaded,
  type RegistryDeskView,
} from "./registry-desk.server.ts";

/** The desk page's one read. Read-only: it writes nothing. */
export const listRegistryDesk = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<RegistryDeskView> => {
    const sql = await getSql();
    const [
      changes,
      imports,
      sources,
      waiting,
      published,
      categories,
      publishedCount,
      starterLoaded,
    ] = await Promise.all([
      listDeskChanges(sql, context.newsroomId),
      listRegistryImports(sql, context.newsroomId),
      listRegistrySourcesWithHealth(sql, context.newsroomId),
      listUnpublishedRegistryEntries(sql, context.newsroomId),
      listPublishedRegistryEntries(sql, context.newsroomId),
      listRegistryCategoryNames(sql, context.newsroomId),
      countPublishedRegistryServices(sql, context.newsroomId),
      starterListIsLoaded(sql, context.newsroomId),
    ]);
    return {
      changes,
      imports,
      sources,
      waiting,
      published,
      categories,
      publishedCount,
      starterLoaded,
    };
  });
