import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import schemaCurrentGate, {
  SCHEMA_UNAVAILABLE_BODY,
} from "../../../server/middleware/00-schema-current.ts";

/**
 * The refuse-to-serve guard's answer (batch-6 pre-merge audit, item 12).
 *
 * The middleware returned `error.message` in the 503 body. The guard's own
 * `console.error` already puts the detail in the log, and the messages that
 * arrive here are not all tidy migration sentences: an unreachable database
 * reads `connect ECONNREFUSED 127.0.0.1:55432` -- host, port and user, served
 * to any unauthenticated caller -- and a driver error can carry a table name or
 * a piece of SQL. The body is now fixed, and it must stay fixed whatever the
 * guard failed with.
 *
 * The seam is real rather than mocked: `getMigrationGuardPromise` memoizes on
 * `globalThis.__migrationGuardPromise__` (migration-status.ts), which is exactly
 * the promise this middleware awaits.
 */

const globalRef = globalThis as typeof globalThis & {
  __migrationGuardPromise__?: Promise<void>;
};

afterEach(() => {
  globalRef.__migrationGuardPromise__ = undefined;
});

const next = () => new Response("served", { status: 200 });

describe("a database that is not current", () => {
  it("answers 503 without repeating the database's own address", async () => {
    globalRef.__migrationGuardPromise__ = Promise.reject(
      new Error(
        "connect ECONNREFUSED 127.0.0.1:55432 (user=townreporter, database=townreporter)",
      ),
    );
    const response = (await schemaCurrentGate({}, next)) as Response;
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.equal(body, SCHEMA_UNAVAILABLE_BODY);
    for (const leak of ["55432", "127.0.0.1", "townreporter", "ECONNREFUSED"])
      assert.doesNotMatch(body, new RegExp(leak), `the body leaked ${leak}`);
  });

  it("keeps a schema dump out of the body too", async () => {
    globalRef.__migrationGuardPromise__ = Promise.reject(
      new Error('relation "story_documents" does not exist at character 41'),
    );
    const response = (await schemaCurrentGate({}, next)) as Response;
    const body = await response.text();
    assert.equal(body, SCHEMA_UNAVAILABLE_BODY);
    assert.doesNotMatch(body, /story_documents|relation|character 41/);
  });

  it("says what is wrong and that somebody has been told", () => {
    assert.match(SCHEMA_UNAVAILABLE_BODY, /database needs an update/);
    assert.match(SCHEMA_UNAVAILABLE_BODY, /operator has been told/);
  });

  it("is not cached, so a fixed paper stops showing it", async () => {
    globalRef.__migrationGuardPromise__ = Promise.reject(new Error("behind"));
    const response = (await schemaCurrentGate({}, next)) as Response;
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
  });
});

describe("a database that is current", () => {
  it("serves the request", async () => {
    globalRef.__migrationGuardPromise__ = Promise.resolve();
    const response = (await schemaCurrentGate({}, next)) as Response;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "served");
  });
});
