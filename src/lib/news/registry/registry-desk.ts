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
  listAutoPublishedRegistryEntries,
  listDeskChanges,
  listPublishedRegistryEntries,
  listRegistryCategoryNames,
  listRegistryDirectoryNames,
  listRegistryImports,
  listRegistrySourcesWithHealth,
  listUnpublishedRegistryEntries,
  readDeskEntryPanel,
  readRegistryFreshness,
  starterListIsLoaded,
  type DeskEntryPanelView,
  type RegistryDeskView,
} from "./registry-desk.server.ts";

/*
  The types the desk's components draw from. `export type` is erased at build
  time, so a client component can name the shape without pulling a `.server`
  module into the browser bundle.
*/
export type {
  DeskAutoPublishedEntry,
  DeskEntryFacts,
  DeskEntryHistoryRow,
  DeskEntryPanelView,
  DeskEntrySourceRow,
  DeskRegistryChange,
  DeskRegistryWaitingEntry,
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
      autoPublished,
      categories,
      directoryNames,
      publishedCount,
      starterLoaded,
      freshness,
    ] = await Promise.all([
      listDeskChanges(sql, context.newsroomId),
      listRegistryImports(sql, context.newsroomId),
      listRegistrySourcesWithHealth(sql, context.newsroomId),
      listUnpublishedRegistryEntries(sql, context.newsroomId),
      listPublishedRegistryEntries(sql, context.newsroomId),
      listAutoPublishedRegistryEntries(sql, context.newsroomId),
      listRegistryCategoryNames(sql, context.newsroomId),
      listRegistryDirectoryNames(sql, context.newsroomId),
      countPublishedRegistryServices(sql, context.newsroomId),
      starterListIsLoaded(sql, context.newsroomId),
      readRegistryFreshness(sql, context.newsroomId),
    ]);
    return {
      changes,
      imports,
      sources,
      waiting,
      published,
      autoPublished,
      categories,
      directoryNames,
      publishedCount,
      starterLoaded,
      freshness,
    };
  });

/**
 * One entry's own page on the desk: every field, its history and its sources
 * (Scott, Nov 20 2026). Read-only; the editor keeps its own save paths.
 */
export const readRegistryEntryPanel = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number } => {
    const serviceId = Number((input as { serviceId?: unknown } | null)?.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      throw new Error("That entry could not be found.");
    }
    return { serviceId };
  })
  .handler(async ({ data, context }): Promise<DeskEntryPanelView> => {
    const sql = await getSql();
    const panel = await readDeskEntryPanel(sql, context.newsroomId, data.serviceId);
    if (!panel) throw new Error("That entry is not in this newsroom.");
    return panel;
  });
