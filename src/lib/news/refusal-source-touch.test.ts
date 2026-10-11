import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { writeSourceTouch } from "./source-touch-write.ts";
import { touchAfterSuccess, touchAfterError } from "./fetch-politeness.ts";
import { BLOCKED_AFTER_RENDER_MESSAGE } from "./refusal-routes.ts";

const db = new PGlite();
after(() => db.close());
const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
  const query = parts.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, "");
  return (await db.query(query, values)).rows;
}) as Sql;

test("source touch stores browser/feed route and newsletter; refusal remains visible and scoped", async () => {
  await db.exec(`create table sources(id integer primary key, newsroom_id integer,
    last_fetched_at timestamptz, last_error text, consecutive_failures integer default 0,
    failure_streak_started_at timestamptz, last_ok_at timestamptz,
    retry_after timestamptz, retry_after_note text, blocked_at timestamptz, blocked_attempts integer default 0);
    insert into sources(id,newsroom_id) values(1,10),(2,20);`);
  await db.exec(
    readFileSync(
      new URL("../../../migrations/0145_source_public_read_routes.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const method of ["playwright", "feed"]) {
    await writeSourceTouch(sql, {
      id: 1,
      newsroomId: 10,
      touch: {
        ...touchAfterSuccess(),
        readMethod: method,
        readOutcome: "fetched",
        readRouteUrl: "https://1.1.1.1/feed",
        newsletterUrl: "https://1.1.1.1/newsletter",
      },
    });
    const {
      rows: [row],
    } = await db.query<Record<string, unknown>>("select * from sources where id=1");
    assert.equal(row.last_read_method, method);
    assert.equal(row.last_read_outcome, "fetched");
    assert.equal(row.newsletter_url, "https://1.1.1.1/newsletter");
    assert.equal(row.last_error, null);
    assert.ok(row.last_ok_at);
  }
  await writeSourceTouch(sql, {
    id: 1,
    newsroomId: 10,
    touch: {
      ...touchAfterError(BLOCKED_AFTER_RENDER_MESSAGE),
      readMethod: "playwright",
      readOutcome: "blocked-after-render",
    },
  });
  const {
    rows: [row],
  } = await db.query<Record<string, unknown>>("select * from sources where id=1");
  assert.equal(row.last_read_outcome, "blocked-after-render");
  assert.equal(row.last_error, BLOCKED_AFTER_RENDER_MESSAGE);
  assert.equal(row.newsletter_url, "https://1.1.1.1/newsletter");
  await writeSourceTouch(sql, { id: 2, newsroomId: 10, touch: touchAfterSuccess() });
  const {
    rows: [other],
  } = await db.query<Record<string, unknown>>("select * from sources where id=2");
  assert.equal(other.last_ok_at, null);
});
