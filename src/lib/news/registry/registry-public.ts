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
import {
  readPublicRegistry,
  readPublicRegistrySearch,
  readPublicRegistryService,
  type PublicRegistryResult,
  type PublicRegistrySearchResult,
  type PublicRegistryServiceResult,
} from "./registry-public.server.ts";

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

/** Same cap as `PUBLIC_REGISTRY_MAX_Q` on the server; kept here so the validator pulls in no server module. */
const MAX_Q = 200;

function wholeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The search page's read: q, category, language and page. Added for the
 * public list; the older `listPublicRegistryPage` stays as it was.
 */
export const searchPublicRegistryPage = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      q: typeof raw.q === "string" ? raw.q.trim().slice(0, MAX_Q) : "",
      category: wholeNumber(raw.category),
      language: typeof raw.language === "string" ? raw.language.trim().slice(0, 100) : "",
      page: wholeNumber(raw.page) ?? 1,
    };
  })
  .handler(async ({ data }): Promise<PublicRegistrySearchResult> =>
    readPublicRegistrySearch(getSql, DEFAULT_NEWSROOM_ID, {
      q: data.q,
      categoryId: data.category,
      language: data.language,
      page: data.page,
    }),
  );

/** One service by id for `/registry/<id>`. A null `entry` is "not listed". */
export const getPublicRegistryServicePage = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({
    id: wholeNumber((input as { id?: unknown } | null)?.id),
  }))
  .handler(async ({ data }): Promise<PublicRegistryServiceResult> => {
    if (data.id == null || data.id > 2147483647) return { status: "ok", entry: null };
    return readPublicRegistryService(getSql, DEFAULT_NEWSROOM_ID, data.id);
  });
