import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { primeGovOriginFromSources } from "./primegov.ts";
import { primeGovOriginForNewsroom } from "./primegov-source.ts";

/**
 * A stand-in for the real one: `{ text, params }` per query, answered by the
 * rows a test hands it. No database is opened.
 */
function fakeSql(rows: { url: string }[]) {
  const queries: { text: string; params: unknown[] }[] = [];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    queries.push({ text, params });
    return rows as T[];
  };
  return { sql, queries };
}

describe("the portal a newsroom watches", () => {
  it("takes the first accepted source whose host is a PrimeGov tenant", () => {
    assert.equal(
      primeGovOriginFromSources([
        "https://example.test/council-agendas",
        "https://boulder.primegov.com/public/portal",
        "https://other.primegov.com/public/portal",
      ]),
      "https://boulder.primegov.com",
    );
  });

  it("is null when no source is a portal -- never a default", () => {
    assert.equal(primeGovOriginFromSources([]), null);
    assert.equal(
      primeGovOriginFromSources([
        "https://example.test/council-agendas",
        "https://www.reddit.com/r/somewhere/",
        "not a link at all",
      ]),
      null,
    );
    // A host that merely mentions a portal is not one, and a lookalike domain
    // is not a tenant.
    assert.equal(primeGovOriginFromSources(["https://primegov.com.example.test/portal"]), null);
  });

  it("reads the watch list, accepted rows only, in watch-list order", async () => {
    const { sql, queries } = fakeSql([{ url: "https://boulder.primegov.com/public/portal" }]);
    assert.equal(await primeGovOriginForNewsroom(sql, 7), "https://boulder.primegov.com");
    assert.equal(queries.length, 1);
    assert.match(queries[0]!.text, /from sources/i);
    assert.match(queries[0]!.text, /status='accepted'/);
    assert.match(queries[0]!.text, /order by id/i);
    assert.deepEqual(queries[0]!.params, [7]);
  });

  it("answers null for a newsroom whose watch list holds no portal", async () => {
    const { sql } = fakeSql([{ url: "https://example.test/council" }]);
    assert.equal(await primeGovOriginForNewsroom(sql, 7), null);
  });
});
