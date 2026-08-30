import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSameSiteRequest, CrossSiteRequestError } from "./isolation.server.ts";

/**
 * `assertSameSiteRequest` is the sibling-tenant CSRF guard: apps on
 * `*.grok.me` are same-site to each other but mutually untrusted, and a
 * `SameSite=Lax` cookie rides along on same-site subrequests. This is the
 * only thing standing between a scripted request from a malicious sibling
 * and this app's session cookie -- see the docstring on `isolation.server.ts`
 * for the attack. It was previously verified only by `assert.match(auth,
 * /assertSameSiteRequest/)` in `newsroom-security.test.mjs`, which is
 * satisfied by the import line and says nothing about what the function
 * actually decides for a given request.
 *
 * `getRequest()` reads a per-request store that TanStack Start's request
 * handler populates via `AsyncLocalStorage.run()` before a handler runs.
 * There's no exported test seam for that store, but the storage instance
 * itself lives on `globalThis` behind a well-known `Symbol.for(...)` key
 * (see `@tanstack/start-server-core`'s `request-response.ts`) specifically
 * so that a single storage instance survives module duplication. Grabbing it
 * by that key and calling the real `AsyncLocalStorage.run()` on it is not a
 * mock of the request context -- it *is* the request context, populated the
 * same way the framework populates it for a real request, just without a
 * live socket. `assertSameSiteRequest` only ever reads `request.headers` and
 * `request.method`, so a plain object shaped like a Fetch `Request` is
 * enough; nothing here stands in for the function under test itself.
 */
const EVENT_STORAGE_KEY = Symbol.for("tanstack-start:event-storage");

function withRequest<T>(headers: Record<string, string>, method: string, fn: () => T): T {
  const storage = (globalThis as Record<symbol, { run: (store: unknown, fn: () => T) => T }>)[
    EVENT_STORAGE_KEY
  ];
  assert.ok(storage, "tanstack-start's event AsyncLocalStorage was not found on globalThis");
  const req = { headers: new Headers(headers), method };
  return storage.run({ h3Event: { req } }, fn);
}

function verdict(headers: Record<string, string>, method = "GET"): "allow" | "block" {
  return withRequest(headers, method, () => {
    try {
      assertSameSiteRequest();
      return "allow";
    } catch (err) {
      assert.ok(err instanceof CrossSiteRequestError, `expected CrossSiteRequestError, got ${err}`);
      assert.equal((err as CrossSiteRequestError).status, 403);
      return "block";
    }
  });
}

describe("assertSameSiteRequest", () => {
  it("allows a request with no Sec-Fetch-Site header (SSR / server-to-server / build)", () => {
    assert.equal(verdict({}), "allow");
  });

  it("allows the app's own same-origin requests", () => {
    assert.equal(verdict({ "sec-fetch-site": "same-origin" }), "allow");
  });

  it("allows a direct address-bar/bookmark load (site: none)", () => {
    assert.equal(verdict({ "sec-fetch-site": "none" }), "allow");
  });

  it("blocks a scripted cross-site POST", () => {
    assert.equal(verdict({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" }, "POST"), "block");
  });

  /**
   * The attack this file exists for: a sibling app on another `*.grok.me`
   * subdomain is "same-site" to this one under the Fetch Metadata spec, so a
   * naive check that only distinguishes same-site from cross-site would let
   * it through. This must still be blocked.
   */
  it("blocks a scripted same-site request from a sibling app", () => {
    assert.equal(verdict({ "sec-fetch-site": "same-site", "sec-fetch-mode": "cors" }, "POST"), "block");
  });

  it("allows a top-level cross-site GET navigation (e.g. the OAuth callback redirect)", () => {
    assert.equal(
      verdict({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }, "GET"),
      "allow",
    );
  });

  it("blocks a navigate-mode request that isn't a GET", () => {
    assert.equal(
      verdict({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }, "POST"),
      "block",
    );
  });

  /** An iframe-smuggled navigation -- the code deliberately rejects this even though sec-fetch-mode says "navigate". */
  it("blocks a top-level GET whose destination is an embed", () => {
    assert.equal(
      verdict({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "embed" }, "GET"),
      "block",
    );
  });

  it("blocks a top-level GET whose destination is an object", () => {
    assert.equal(
      verdict({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "object" }, "GET"),
      "block",
    );
  });
});
