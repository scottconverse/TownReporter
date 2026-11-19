/**
 * The public Community resources JSON API, version 1.
 *
 *   GET /api/registry/v1/services          q, category, language, page, limit
 *   GET /api/registry/v1/services/<id>
 *   GET /api/registry/v1/categories
 *
 * Body: `{ "version": "1", "data": ..., "page": { "number", "size", "total" } }`
 * (`page` on the services list only). Errors: `{ "version": "1", "error":
 * { "code", "message" } }` with 400 `bad_parameter`, 404 `not_found`,
 * 405 `method_not_allowed` and 503 `unavailable`. An empty result is a 200
 * with `data: []`.
 *
 * The API is public and the same for everyone. It never reads the request's
 * headers, so a cookie or an authorization header cannot change the answer.
 * It reads through the same public reader as the page, so a draft, an
 * inactive row, a removed row or another newsroom's row cannot appear here.
 * What the reader does not return (the verification basis, who checked, review
 * notes, audit data, contact people's names) cannot be serialised.
 *
 * Compatibility: version 1 fields are only added, never renamed or removed.
 * A breaking change would be version 2 at a new path.
 */

import { getSql, type Sql } from "../../db.ts";
import { DEFAULT_NEWSROOM_ID } from "../membership.ts";
import {
  PUBLIC_REGISTRY_MAX_Q,
  PUBLIC_REGISTRY_PAGE_SIZE,
  getPublicRegistryService,
  listPublicRegistryCategories,
  searchPublicRegistry,
  type PublicRegistryEntry,
} from "./registry-public.server.ts";

const API_PREFIX = "/api/registry/v1";
const MAX_LIMIT = 100;
const MAX_PAGE = 100000;
const MAX_LANGUAGE = 100;
const MAX_SERVICE_ID = 2147483647;

export interface RegistryApiDeps {
  getSql?: () => Promise<Sql>;
  newsroomId?: number;
}

const BASE_HEADERS = {
  "access-control-allow-origin": "*",
  "content-type": "application/json; charset=utf-8",
};

function ok(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ version: "1", ...body }), {
    status: 200,
    headers: { ...BASE_HEADERS, "cache-control": "public, max-age=60" },
  });
}

function fail(status: number, code: string, message: string, extra?: HeadersInit): Response {
  return new Response(JSON.stringify({ version: "1", error: { code, message } }), {
    status,
    // An error is never worth keeping for a minute: the next try may succeed.
    headers: { ...BASE_HEADERS, "cache-control": "no-store", ...(extra as object) },
  });
}

const bad = (message: string) => fail(400, "bad_parameter", message);

/** A whole number from query text, or null when it is not one. */
function whole(text: string): number | null {
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

function iso(value: string | Date | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** One service as the API serialises it: only public fields, stable names. */
export function serviceJson(entry: PublicRegistryEntry) {
  return {
    id: entry.serviceId,
    hsds_id: entry.hsdsId,
    directory: entry.directory,
    name: entry.serviceName,
    description: entry.description,
    status: entry.status,
    organization: { name: entry.organizationName, phones: entry.organizationPhones },
    category: entry.categoryId == null ? null : { id: entry.categoryId, name: entry.categoryName },
    fees: entry.fees,
    application_process: entry.applicationProcess,
    url: entry.serviceUrl,
    emails: entry.serviceEmails,
    phones: entry.servicePhones,
    hours: entry.serviceHours,
    languages: entry.languages,
    eligibility: entry.eligibility,
    required_documents: entry.requiredDocuments.map((doc) => ({
      document: doc.document,
      description: doc.description,
      required: doc.required,
    })),
    accessibility: entry.accessibility,
    locations: entry.locations.map((place) => ({
      id: place.locationId,
      name: place.name,
      address: place.address,
      phones: place.phones,
      hours: place.hours,
      accessibility: place.accessibility,
    })),
    sources: entry.sources.map((source) => ({
      url: source.url,
      title: source.title,
      applies_to: source.appliesTo,
    })),
    verification: entry.verifiedAt
      ? { verified_at: iso(entry.verifiedAt), method: entry.verifiedMethod }
      : null,
    last_updated_at: iso(entry.lastVerifiedAt),
    editor_note: entry.editorNote,
  };
}

/** The handler behind every v1 route. Takes a plain `Request`, so tests can too. */
export async function registryApiHandler(
  request: Request,
  deps: RegistryApiDeps = {},
): Promise<Response> {
  if (request.method !== "GET") {
    return fail(405, "method_not_allowed", "This API answers GET requests only.", {
      allow: "GET",
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) {
    return fail(404, "not_found", "No such resource.");
  }
  const rest = path.slice(API_PREFIX.length);
  const params = url.searchParams;
  const newsroomId = deps.newsroomId ?? DEFAULT_NEWSROOM_ID;
  const database = deps.getSql ?? getSql;

  const unavailable = (err: unknown) => {
    // The cause goes to the server log only; the caller gets no stack, no SQL.
    console.error("[registry-api] read failed", err);
    return fail(
      503,
      "unavailable",
      "The directory could not be read right now. Try again shortly.",
    );
  };

  if (rest === "/categories") {
    try {
      const categories = await listPublicRegistryCategories(await database(), newsroomId);
      return ok({ data: categories.map((c) => ({ id: c.id, name: c.name })) });
    } catch (err) {
      return unavailable(err);
    }
  }

  const detail = /^\/services\/([^/]+)$/.exec(rest);
  if (detail) {
    const text = detail[1]!;
    if (!/^\d+$/.test(text)) return bad("The service id must be a whole number.");
    // Digits too long to be an id are an id nothing has, not a bad parameter.
    const id = whole(text);
    if (id == null || id < 1 || id > MAX_SERVICE_ID) {
      return fail(404, "not_found", "No such service is listed.");
    }
    try {
      const entry = await getPublicRegistryService(await database(), newsroomId, id);
      if (!entry) return fail(404, "not_found", "No such service is listed.");
      return ok({ data: serviceJson(entry) });
    } catch (err) {
      return unavailable(err);
    }
  }

  if (rest === "/services") {
    const q = (params.get("q") ?? "").trim();
    if (q.length > PUBLIC_REGISTRY_MAX_Q) {
      return bad(`q must be at most ${PUBLIC_REGISTRY_MAX_Q} characters.`);
    }
    const language = (params.get("language") ?? "").trim();
    if (language.length > MAX_LANGUAGE) {
      return bad(`language must be at most ${MAX_LANGUAGE} characters.`);
    }
    let category: number | null = null;
    if (params.has("category") && params.get("category") !== "") {
      category = whole(params.get("category")!);
      if (category == null || category < 1) return bad("category must be a positive whole number.");
    }
    let page = 1;
    if (params.has("page")) {
      const n = whole(params.get("page")!);
      if (n == null || n < 1 || n > MAX_PAGE) {
        return bad(`page must be a whole number from 1 to ${MAX_PAGE}.`);
      }
      page = n;
    }
    let limit = PUBLIC_REGISTRY_PAGE_SIZE;
    if (params.has("limit")) {
      const n = whole(params.get("limit")!);
      if (n == null || n < 1 || n > MAX_LIMIT) {
        return bad(`limit must be a whole number from 1 to ${MAX_LIMIT}.`);
      }
      limit = n;
    }
    try {
      const found = await searchPublicRegistry(await database(), newsroomId, {
        q,
        categoryId: category,
        language,
        page,
        pageSize: limit,
      });
      return ok({
        data: found.entries.map(serviceJson),
        page: { number: found.page, size: found.pageSize, total: found.total },
      });
    } catch (err) {
      return unavailable(err);
    }
  }

  return fail(404, "not_found", "No such resource.");
}
