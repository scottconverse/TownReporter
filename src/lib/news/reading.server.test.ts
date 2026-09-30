/*
  The beacon endpoint and the aggregates behind /desk/stats, on a fake database.

  WHAT THIS FILE IS FOR. Two things the redesign's Stats brief calls out as
  tests, and one thing it calls out as a rule:

    1. That the beacon writes AGGREGATES AND NOTHING ELSE. The first case below
       reads `information_schema.columns` for both tables and asserts the
       column list exactly -- so an IP column, a user-agent column or a
       per-reader id is not merely unused, it cannot exist without failing
       here. The migration file is scanned for the same words outside its
       comments, because the migration is the other half of the schema
       (src/lib/news/schema-parity.test.ts diffs them against real Postgres).
    2. That `readBeaconHandler` reads EXACTLY the header names the owner's
       2026-09-30 decision permits and no others. It used to read none at all,
       and this file used to prove that with a `headers` getter that threw; the
       rule is now a five-name allowlist (src/lib/news/stats-privacy.ts), so it
       is handed a `Headers` that records every `get()` and the names it asked
       for are asserted against that list. `cookie`, `referer`, `authorization`
       and Cloudflare's latitude/longitude/postal/region/timezone headers are
       all present in the fixture and must not appear among them.
    3. The arithmetic the page depends on: which referrer class a report lands
       in, the visit/internal split (DECISIONS.md:90, Q6), the
       under-ten-seconds rule, the read-through buckets, the rolling window
       expiring, and the CSV an editor downloads.

  It is the same shape as views.test.ts: migrations applied by hand (PGLite in
  `node --test` has no Vite migration glob), one newsroom id per case, and no
  framework -- `requireEditor` is called directly so a stranger can be refused
  without standing up a route.
*/

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { ensureNewsroomSchema, DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { SITE_TARGET, ensureViewsSchema } from "./views.ts";
import {
  BEACON_HEADER_ALLOWLIST,
  ensureReadingSchema,
  exportReadingCsv,
  foldSmallPlaces,
  getReadingStats,
  pruneLocationDaily,
  readBeaconHandler,
  recordReadBeacon,
  recordTrustCount,
} from "./reading.server.ts";
import { FOLDED_CITY, LOCATION_MIN_VISITS } from "./stats-privacy.ts";
import { liveSnapshot, noteLiveBeat, resetLiveWindow } from "./reading-live.ts";

/** Same bootstrap as views.test.ts -- `articles` is migrations-only. */
async function applyMigrations() {
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // Not every migration applies cleanly on a bare PGLite. What matters
      // here is asserted immediately below.
    }
  }
  await ensureViewsSchema();
  await ensureReadingSchema();
  const sql = await getSql();
  const cols = await sql<{ table_name: string }>`
    select table_name from information_schema.columns where table_name = 'read_hourly'
  `;
  assert.ok(cols.length > 0, "read_hourly was not created by the migrations or the ensure function");
}

before(applyMigrations);

async function seedArticle(newsroomId: number, slug: string, headline = "A published story", topic = "council") {
  const sql = await getSql();
  await sql`
    insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status)
    values (${"seed-user"}, ${newsroomId}, ${slug}, ${headline}, ${""}, ${"Body"}, ${topic}, 'published')
  `;
}

type Bucket = Record<string, string | number | null>;

async function bucket(newsroomId: number, path: string, refClass: string, device: string) {
  const sql = await getSql();
  const rows = await sql<Bucket>`
    select * from read_hourly
    where newsroom_id = ${newsroomId} and path = ${path}
      and ref_class = ${refClass} and device = ${device}
  `;
  return rows[0] ?? null;
}

function num(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * Run `fn` with a request context whose transport peer is `ip` -- the real
 * framework AsyncLocalStorage, entered the way
 * src/lib/auth/isolation.server.test.ts enters it.
 *
 * The location headers are believed only over loopback (unit U17c,
 * `beaconPeerIsLoopback`), so a case that expects a place to be counted has to
 * say the request came from the tunnel, and a case that expects none can say it
 * came from anywhere else -- or, with `undefined`, that the adapter reported
 * nothing at all.
 */
const EVENT_STORAGE_KEY = Symbol.for("tanstack-start:event-storage");

type EventStorage = { run: <R>(store: unknown, fn: () => R) => R };

async function withPeer<T>(ip: string | undefined, fn: () => Promise<T>): Promise<T> {
  const storage = (globalThis as Record<symbol, EventStorage | undefined>)[EVENT_STORAGE_KEY];
  assert.ok(storage, "tanstack-start's event AsyncLocalStorage was not found on globalThis");
  return storage.run({ h3Event: { req: { ip } } }, fn);
}

/**
 * A `Request` whose headers RECORD every name read, and a list that fills in as
 * the handler works.
 *
 * This replaces the old `headers`-throws double, which failed the case the
 * moment anything touched `request.headers`. That was the right test while the
 * rule was "read no header at all"; the owner's decision of 2026-09-30 replaced
 * the rule with a narrow allowlist, so the test had to become narrower too. A
 * recording proxy is strictly stronger than the throw was: it still fails if a
 * sixth name is read, and it fails if the five allowed ones are read for the
 * wrong thing, because the names are asserted against the list rather than
 * assumed to be absent. `cookie`, `referer` and `authorization` are in the
 * fixture on purpose -- a handler that started reading them would be caught
 * here, and a throws-double would have caught that too but told us nothing
 * about which names were the acceptable ones.
 */
function recordingRequest(
  body: unknown,
  headers: Record<string, string> = {},
): { request: Request; read: string[] } {
  const read: string[] = [];
  const real = new Headers(headers);
  const recording = new Proxy(real, {
    get(target, property, receiver) {
      if (property === "get") {
        return (name: string) => {
          read.push(String(name).toLowerCase());
          return target.get(name);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as Headers;
  const fake = {
    headers: recording,
    body: undefined,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
  return { request: fake as unknown as Request, read };
}

describe("the tables hold aggregates, never a person", () => {
  it("has exactly the read_hourly columns a sum needs, and no column that names a reader", async () => {
    const sql = await getSql();
    const rows = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_name = 'read_hourly'
    `;
    assert.deepEqual(
      rows.map((row) => row.column_name).sort(),
      [
        "active_seconds",
        "depth_100",
        "depth_25",
        "depth_50",
        "depth_75",
        "device",
        "hour_start",
        "left_early",
        "loads",
        "newsroom_id",
        "path",
        "recirc",
        "ref_class",
        "visits",
      ],
      "the column list is the schema: nothing can be stored that is not in it",
    );
  });

  it("has exactly the trust_signals_hourly columns a count needs", async () => {
    const sql = await getSql();
    const rows = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_name = 'trust_signals_hourly'
    `;
    assert.deepEqual(
      rows.map((row) => row.column_name).sort(),
      ["count", "event", "hour_start", "newsroom_id"],
    );
  });

  it("has no column whose name is an address, an agent, a cookie, a session or an id", async () => {
    const sql = await getSql();
    const rows = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns
      where table_name in ('read_hourly', 'trust_signals_hourly')
    `;
    const forbidden = /(^|_)(ip|addr|address|agent|ua|cookie|session|fingerprint|token|visitor|user|email|hash)($|_)/;
    for (const row of rows) {
      const name = row.column_name;
      assert.ok(!forbidden.test(name), `${row.table_name}.${name} names a reader`);
      if (name !== "newsroom_id") {
        assert.ok(!name.includes("id"), `${row.table_name}.${name} looks like a key for one person`);
      }
    }
  });

  it("states the same promise in the migration that creates them", () => {
    const source = readFileSync(
      join(process.cwd(), "migrations", "0103_read_hourly.sql"),
      "utf8",
    );
    // The migration must match the ensure statements column-for-column
    // (schema-parity.test.ts diffs them where Postgres is available). Here the
    // question is the other one: no identifier column, comments excluded --
    // the docstring says the word "IP" on purpose, so it has to be stripped
    // before the scan or the scan would flag its own promise.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    for (const word of ["ip", "user_agent", "cookie", "session", "fingerprint", "token"]) {
      assert.ok(
        !new RegExp(`\\b${word}\\b`, "i").test(code),
        `migrations/0103_read_hourly.sql stores a "${word}"`,
      );
    }
    for (const table of ["read_hourly", "trust_signals_hourly"]) {
      assert.ok(code.includes(`create table if not exists ${table}`));
    }
  });

  it("states the same promise in migrations/0109 for the place and visitor tables", () => {
    const source = readFileSync(
      join(process.cwd(), "migrations", "0109_stats_location.sql"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    // The docstring says most of these words on purpose, so it is stripped
    // first -- otherwise the scan would flag the promise it is written to make.
    for (const word of [
      "ip",
      "user_agent",
      "cookie",
      "session",
      "fingerprint",
      "token",
      "hash",
      "salt",
      "latitude",
      "longitude",
      "postal",
      "timezone",
      "region",
    ]) {
      assert.ok(
        !new RegExp(`\\b${word}\\b`, "i").test(code),
        `migrations/0109_stats_location.sql stores a "${word}"`,
      );
    }
    for (const table of ["location_daily", "visitor_daily"]) {
      assert.ok(code.includes(`create table if not exists ${table}`));
    }
    // The grain is a day, in both tables: no timestamp column at all.
    assert.ok(!/timestamptz|timestamp/i.test(code), "0109 has a finer grain than a day");
  });
});

describe("readBeaconHandler", () => {
  it("reads exactly the allowlisted header names -- no cookie, no referer, no authorization, no latitude", async () => {
    const { request, read } = recordingRequest(
      { kind: "load", path: "/", refClass: "search", device: "phone" },
      {
        "content-type": "application/json",
        "cf-ipcity": "Longmont",
        "cf-ipcountry": "US",
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "SentinelAgent/9.9",
        // Present, and never to be read:
        cookie: "sentinel=SENTINELCOOKIE",
        referer: "https://search.example/?q=SENTINELQUERY",
        authorization: "Bearer SENTINELTOKEN",
        "cf-iplatitude": "40.1672",
        "cf-iplongitude": "-105.1019",
        "cf-postal-code": "80501",
        "cf-region": "Colorado",
        "cf-timezone": "America/Denver",
      },
    );
    // Over the tunnel's loopback connection: the two location headers are only
    // read at all when the peer is loopback (unit U17c).
    const response = await withPeer("127.0.0.1", () => readBeaconHandler(request));
    assert.equal(response.status, 204);

    const names = [...new Set(read)];
    assert.ok(names.length > 0, "the handler read no header at all -- the probe is broken");
    for (const name of names) {
      assert.ok(
        (BEACON_HEADER_ALLOWLIST as readonly string[]).includes(name),
        `the handler read "${name}", which is not in the allowlist`,
      );
    }
    for (const forbidden of [
      "cookie",
      "referer",
      "authorization",
      "cf-iplatitude",
      "cf-iplongitude",
      "cf-postal-code",
      "cf-region",
      "cf-timezone",
    ]) {
      assert.ok(!names.includes(forbidden), `the handler read ${forbidden}`);
    }

    // And the report still landed, with the two signals the allowlist exists
    // for: the load row, the place, and one visitor.
    const row = await bucket(DEFAULT_NEWSROOM_ID, "/", "search", "phone");
    assert.ok(row, "the report landed");
    assert.ok(num(row.loads) >= 1);
    const sql = await getSql();
    const places = await sql<{ city: string }>`
      select city from location_daily where newsroom_id = ${DEFAULT_NEWSROOM_ID} and city = ${"Longmont"}
    `;
    assert.equal(places.length, 1, "the city the allowlist permits was counted");
  });

  it("always answers 204, for a good body, a garbage body and an unlisted path alike", async () => {
    for (const body of [
      { kind: "load", path: "/about", refClass: "direct", device: "computer" },
      "not json at all {{{",
      { kind: "load", path: "/admin", refClass: "direct", device: "computer" },
      null,
    ]) {
      const response = await readBeaconHandler(recordingRequest(body).request);
      assert.equal(response.status, 204);
    }
    const sql = await getSql();
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from read_hourly where path = ${"/admin"}
    `;
    assert.equal(num(rows[0]?.n), 0, "an unlisted path minted no row");
  });
});

describe("a load: referrer class, visit vs internal, read another story", () => {
  it("keeps each of the eight classes in its own row", async () => {
    const newsroomId = 9402;
    for (const refClass of ["search", "share", "facebook", "reddit", "local"]) {
      const outcome = await recordReadBeacon(
        { kind: "load", path: "/about", refClass, device: "computer" },
        newsroomId,
      );
      assert.deepEqual(outcome, { accepted: true, kind: "load" });
    }
    const sql = await getSql();
    const rows = await sql<{ ref_class: string; loads: number; visits: number }>`
      select ref_class, loads, visits from read_hourly
      where newsroom_id = ${newsroomId} and path = ${"/about"}
      order by ref_class asc
    `;
    assert.deepEqual(
      rows.map((row) => [row.ref_class, num(row.loads), num(row.visits)]),
      [
        ["facebook", 1, 1],
        ["local", 1, 1],
        ["reddit", 1, 1],
        ["search", 1, 1],
        ["share", 1, 1],
      ],
      "every class that arrived from outside the site is also a visit (Q6)",
    );
  });

  it("counts an arrival from another page of this paper as a load but not a visit", async () => {
    const newsroomId = 9403;
    await seedArticle(newsroomId, "reading-load-a");
    await seedArticle(newsroomId, "reading-load-b");

    await recordReadBeacon(
      {
        kind: "load",
        path: "/articles/reading-load-b",
        refClass: "internal",
        device: "computer",
        fromArticle: true,
      },
      newsroomId,
    );
    const row = await bucket(newsroomId, "/articles/reading-load-b", "internal", "computer");
    assert.ok(row);
    assert.equal(num(row.loads), 1, "it is still a page load the beacon heard about");
    assert.equal(num(row.visits), 0, "it did not arrive from outside the site");
    assert.equal(num(row.recirc), 1, "and it is a reader who read another story");
  });

  it("will not let a client claim read-another-story on an outside referral", async () => {
    const newsroomId = 9404;
    await seedArticle(newsroomId, "reading-load-c");
    await recordReadBeacon(
      {
        kind: "load",
        path: "/articles/reading-load-c",
        refClass: "search",
        device: "phone",
        fromArticle: true,
      },
      newsroomId,
    );
    const row = await bucket(newsroomId, "/articles/reading-load-c", "search", "phone");
    assert.equal(num(row?.loads), 1);
    assert.equal(num(row?.visits), 1, "search is an arrival from outside the site");
    assert.equal(
      num(row?.recirc),
      0,
      "only an internal arrival can be a reader who read another story",
    );
  });

  it("keeps phone, tablet and computer apart, and sums repeats of one key", async () => {
    const newsroomId = 9405;
    await recordReadBeacon(
      { kind: "load", path: "/get-the-code", refClass: "direct", device: "phone" },
      newsroomId,
    );
    await recordReadBeacon(
      { kind: "load", path: "/get-the-code", refClass: "direct", device: "phone" },
      newsroomId,
    );
    await recordReadBeacon(
      { kind: "load", path: "/get-the-code", refClass: "direct", device: "tablet" },
      newsroomId,
    );
    const sql = await getSql();
    const rows = await sql<{ device: string; loads: number; visits: number }>`
      select device, loads, visits from read_hourly
      where newsroom_id = ${newsroomId} and path = ${"/get-the-code"}
      order by device asc
    `;
    assert.deepEqual(
      rows.map((row) => [row.device, num(row.loads), num(row.visits)]),
      [
        ["phone", 2, 2],
        ["tablet", 1, 1],
      ],
    );
  });

  it("refuses a path outside the allowlist, a bad class, a bad device, a bad kind and an unpublished slug", async () => {
    const newsroomId = 9406;
    const sql = await getSql();
    await sql`
      insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status)
      values (${"seed-user"}, ${newsroomId}, ${"reading-held"}, ${"Held"}, ${""}, ${"Body"}, ${"council"}, 'held')
    `;
    const cases: Array<[unknown, string]> = [
      [{ kind: "load", path: "/admin", refClass: "direct", device: "phone" }, "path"],
      [{ kind: "load", path: "/", refClass: "carrier-pigeon", device: "phone" }, "refClass"],
      [{ kind: "load", path: "/", refClass: "direct", device: "watch" }, "device"],
      [{ kind: "nonsense", path: "/", refClass: "direct", device: "phone" }, "kind"],
      [{ kind: "load", path: "/articles/reading-held", refClass: "direct", device: "phone" }, "unpublished"],
      [{ kind: "load", path: "/articles/no-such-story-xyz", refClass: "direct", device: "phone" }, "unpublished"],
      ["not an object", "kind"],
      [null, "kind"],
      [[1, 2, 3], "kind"],
    ];
    for (const [payload, reason] of cases) {
      const outcome = await recordReadBeacon(payload, newsroomId);
      assert.equal(outcome.accepted, false, `${JSON.stringify(payload)} was accepted`);
      assert.equal(outcome.reason, reason);
    }
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from read_hourly where newsroom_id = ${newsroomId}
    `;
    assert.equal(num(rows[0]?.n), 0, "not one refusal wrote anything");
  });
});

describe("a read report: active time and read-through buckets", () => {
  it("counts a load under ten seconds as left without reading, but only once it is final", async () => {
    const newsroomId = 9411;
    await recordReadBeacon(
      { kind: "read", path: "/", refClass: "direct", device: "phone", seconds: 4, totalSeconds: 4 },
      newsroomId,
    );
    let row = await bucket(newsroomId, "/", "direct", "phone");
    assert.equal(num(row?.left_early), 0, "still on the page, so not yet gone");

    await recordReadBeacon(
      {
        kind: "read",
        path: "/",
        refClass: "direct",
        device: "phone",
        seconds: 3,
        totalSeconds: 7,
        final: true,
      },
      newsroomId,
    );
    row = await bucket(newsroomId, "/", "direct", "phone");
    assert.equal(num(row?.left_early), 1);
    assert.equal(num(row?.active_seconds), 7, "the seconds column is a plain sum");

    await recordReadBeacon(
      {
        kind: "read",
        path: "/",
        refClass: "direct",
        device: "phone",
        seconds: 30,
        totalSeconds: 37,
        final: true,
      },
      newsroomId,
    );
    row = await bucket(newsroomId, "/", "direct", "phone");
    assert.equal(num(row?.left_early), 1, "a long read did not add a second early exit");
    assert.equal(num(row?.active_seconds), 37);
  });

  it("counts the ten-second boundary as read, not as left", async () => {
    const newsroomId = 9412;
    await recordReadBeacon(
      {
        kind: "read",
        path: "/about",
        refClass: "local",
        device: "computer",
        seconds: 10,
        totalSeconds: 10,
        final: true,
      },
      newsroomId,
    );
    const row = await bucket(newsroomId, "/about", "local", "computer");
    assert.equal(num(row?.left_early), 0, "under ten seconds, so exactly ten is not under it");
  });

  it("bumps each depth bucket once, and ignores a depth that is not a bucket", async () => {
    const newsroomId = 9413;
    await recordReadBeacon(
      {
        kind: "read",
        path: "/corrections",
        refClass: "search",
        device: "phone",
        seconds: 120,
        depth: [25, 50, 33, 100, "75"],
      },
      newsroomId,
    );
    let row = await bucket(newsroomId, "/corrections", "search", "phone");
    assert.deepEqual(
      [row?.depth_25, row?.depth_50, row?.depth_75, row?.depth_100].map(num),
      [1, 1, 0, 1],
      "33 and \"75\" are not buckets the server will count",
    );

    await recordReadBeacon(
      { kind: "read", path: "/corrections", refClass: "search", device: "phone", seconds: 10, depth: [25] },
      newsroomId,
    );
    row = await bucket(newsroomId, "/corrections", "search", "phone");
    assert.deepEqual([row?.depth_25, row?.depth_50].map(num), [2, 1]);
    assert.equal(num(row?.active_seconds), 130);
  });

  it("writes nothing at all for a report with no time and no depth", async () => {
    const newsroomId = 9414;
    const outcome = await recordReadBeacon(
      { kind: "read", path: "/", refClass: "direct", device: "tablet", seconds: 0, depth: [] },
      newsroomId,
    );
    assert.deepEqual(outcome, { accepted: true, kind: "read", reason: "nothing to add" });
    assert.equal(await bucket(newsroomId, "/", "direct", "tablet"), null);
  });

  it("clamps a forgotten tab rather than storing it", async () => {
    const newsroomId = 9415;
    await recordReadBeacon(
      { kind: "read", path: "/", refClass: "direct", device: "computer", seconds: 60 * 60 * 24 },
      newsroomId,
    );
    const row = await bucket(newsroomId, "/", "direct", "computer");
    assert.equal(num(row?.active_seconds), 4 * 60 * 60);
  });
});

describe("the live window", () => {
  it("never writes a beat down, and counts it while it is fresh", async () => {
    resetLiveWindow();
    const newsroomId = 9421;
    const outcome = await recordReadBeacon(
      { kind: "beat", path: "/", device: "phone", seconds: 30 },
      newsroomId,
    );
    assert.deepEqual(outcome, { accepted: true, kind: "beat" });
    assert.equal(liveSnapshot().readers >= 1, true, "a beat this second is someone on the site");
    const sql = await getSql();
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from read_hourly where newsroom_id = ${newsroomId}
    `;
    assert.equal(num(rows[0]?.n), 0, "the beat was never written anywhere");
  });

  it("expires: a beat past the window is nobody, and the sparkline still holds its minute", () => {
    resetLiveWindow();
    noteLiveBeat({ path: "/", seconds: 30, device: "phone" }, Date.now() - 31 * 60_000);
    let snapshot = liveSnapshot();
    assert.equal(snapshot.readers, 0, "older than the thirty-minute window");
    assert.equal(snapshot.pages.length, 0);
    assert.equal(snapshot.perMinute.length, 30);

    resetLiveWindow();
    noteLiveBeat({ path: "/", seconds: 30, device: "phone" }, Date.now() - 90_000);
    snapshot = liveSnapshot();
    assert.equal(snapshot.readers, 0, "half a minute of silence is not a reader still on the page");
    assert.ok(
      snapshot.perMinute.some((readers) => readers > 0),
      "but the minute it happened in is still on the sparkline",
    );

    resetLiveWindow();
    noteLiveBeat({ path: "/", seconds: 30, device: "phone" });
    noteLiveBeat({ path: "/", seconds: 30, device: "phone" });
    noteLiveBeat({ path: "/", seconds: 30, device: "phone" });
    noteLiveBeat({ path: "/", seconds: 30, device: "phone" });
    snapshot = liveSnapshot();
    assert.equal(snapshot.readers, 1, "four beats a minute is one reader, not four");
    assert.equal(snapshot.pages[0]?.path, "/");
    assert.equal(snapshot.windowMinutes, 30);
    assert.equal(snapshot.beatSeconds, 15);
  });

  it("takes a load as an arrival at once, so a panel is not empty for fifteen seconds", async () => {
    resetLiveWindow();
    await recordReadBeacon(
      { kind: "load", path: "/how-we-report", refClass: "reddit", device: "phone" },
      9422,
    );
    const snapshot = liveSnapshot();
    assert.equal(snapshot.readers, 1);
    assert.deepEqual(snapshot.arrivals, [{ refClass: "reddit", count: 1 }]);
    assert.deepEqual(snapshot.devices.map((row) => [row.device, row.readers]), [["phone", 1]]);
  });
});

describe("trust signals", () => {
  it("counts the beacon's four, one row per hour and event", async () => {
    const newsroomId = 9431;
    for (const event of ["dark-mode-chosen", "dark-mode-chosen", "credit-copied"]) {
      const outcome = await recordReadBeacon({ kind: "trust", event }, newsroomId);
      assert.deepEqual(outcome, { accepted: true, kind: "trust" });
    }
    const sql = await getSql();
    const rows = await sql<{ event: string; count: number }>`
      select event, count from trust_signals_hourly
      where newsroom_id = ${newsroomId} order by event asc
    `;
    assert.deepEqual(
      rows.map((row) => [row.event, num(row.count)]),
      [
        ["credit-copied", 1],
        ["dark-mode-chosen", 2],
      ],
    );
  });

  it("refuses a signal the browser is not allowed to report, but accepts the server-side ones", async () => {
    const newsroomId = 9432;
    for (const event of ["correction-filed", "rss-fetch", "captured-version-opened", "made-up"]) {
      const outcome = await recordReadBeacon({ kind: "trust", event }, newsroomId);
      assert.equal(outcome.accepted, false, `${event} must not arrive on the beacon`);
      assert.equal(outcome.reason, "event");
    }
    // ...because these two are counted where they actually happen.
    await recordTrustCount("rss-fetch", newsroomId, 3);
    const sql = await getSql();
    const rows = await sql<{ event: string; count: number }>`
      select event, count from trust_signals_hourly where newsroom_id = ${newsroomId}
    `;
    assert.deepEqual(
      rows.map((row) => [row.event, num(row.count)]),
      [["rss-fetch", 3]],
    );
  });
});

describe("the read-back behind /desk/stats", () => {
  const newsroomId = 9501;
  const userId = `reading-stats-owner-${Date.now()}`;
  const slugA = "reading-stats-a";
  const slugB = "reading-stats-b";

  before(async () => {
    await ensureNewsroomSchema();
    await ensureViewsSchema();
    await ensureReadingSchema();
    const sql = await getSql();
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${userId}, 'owner', ${newsroomId})
    `;
    await seedArticle(newsroomId, slugA, "Council votes on the rates", "council");
    await seedArticle(newsroomId, slugB, "Schools reopen Monday", "schools");

    await sql`
      insert into page_views (newsroom_id, target, day, count)
      values (${newsroomId}, ${SITE_TARGET}, current_date, 40)
    `;
    await sql`
      insert into read_hourly (newsroom_id, hour_start, path, ref_class, device,
        loads, visits, recirc, left_early, active_seconds,
        depth_25, depth_50, depth_75, depth_100)
      values
        (${newsroomId}, date_trunc('hour', now()), ${`/articles/${slugA}`}, 'search', 'phone',
         10, 10, 0, 4, 600, 10, 6, 3, 1),
        (${newsroomId}, date_trunc('hour', now()), ${`/articles/${slugA}`}, 'search', 'tablet',
         2, 2, 0, 0, 60, 2, 1, 0, 0),
        (${newsroomId}, date_trunc('hour', now()), ${`/articles/${slugB}`}, 'internal', 'computer',
         5, 0, 5, 0, 0, 0, 0, 0, 0),
        (${newsroomId}, date_trunc('hour', now()), ${"/evidence"}, 'direct', 'phone',
         3, 3, 0, 0, 30, 0, 0, 0, 0)
    `;
    await sql`
      insert into trust_signals_hourly (newsroom_id, hour_start, event, count) values
        (${newsroomId}, date_trunc('hour', now()), 'dark-mode-chosen', 5),
        (${newsroomId}, date_trunc('hour', now()), 'rss-fetch', 10)
    `;
    // A correction is attributed through the story it corrects (`corrections`
    // has no newsroom_id of its own -- see reading.server.ts).
    await sql`
      insert into corrections (user_id, article_id, body, created_at)
      select ${"reader"}, id, ${"Spelling of the mayor's name"}, now()
      from articles where newsroom_id = ${newsroomId} and slug = ${slugA}
    `;
    // Another paper's reading, which must not appear anywhere above.
    await sql`
      insert into read_hourly (newsroom_id, hour_start, path, ref_class, device, loads, visits, active_seconds)
      values (${9999}, date_trunc('hour', now()), ${"/"}, 'search', 'phone', 999, 999, 99999)
    `;
  });

  it("adds up the range, splitting visits from loads and internal from outside", async () => {
    const stats = await getReadingStats(userId, "7d");
    assert.equal(stats.range, "7d");
    assert.equal(stats.rangeLabel, "7 days");
    assert.equal(stats.days, 7);
    assert.equal(stats.kpis.loads, 20, "every load the beacon heard about");
    assert.equal(stats.kpis.visits, 15, "the one that arrived from our own story is not a visit");
    assert.equal(stats.kpis.pageLoads, 40, "from the daily counter that has the history");
    assert.equal(stats.kpis.totalSeconds, 690);
    assert.equal(stats.kpis.avgSeconds, 35, "active seconds over loads, the honest denominator");
    assert.equal(stats.kpis.recircShare, 0.25);
    assert.equal(stats.kpis.leftEarlyShare, 0.2);
    assert.equal(stats.empty, false);
    assert.equal(stats.live.windowMinutes, 30);
  });

  it("drops internal arrivals from 'where visits come from', which counts arrivals from outside", async () => {
    const stats = await getReadingStats(userId, "7d");
    assert.deepEqual(
      stats.sources.map((row) => [row.refClass, row.visits]),
      [
        ["search", 12],
        ["direct", 3],
      ],
      "internal is not a source; it is someone already here",
    );
    assert.equal(stats.sources[0]?.share, 0.8);
  });

  it("ranks stories with their read-through and names the ones nobody has read", async () => {
    const stats = await getReadingStats(userId, "7d");
    const [first, second] = stats.stories;
    assert.equal(first?.slug, slugA);
    assert.equal(first?.headline, "Council votes on the rates");
    assert.equal(first?.loads, 12);
    assert.equal(first?.avgSeconds, 55);
    assert.deepEqual(
      first?.depth.map((d) => Math.round(d * 100)),
      [100, 58, 25, 8],
      "reached-bucket shares, each over this story's own loads",
    );
    assert.equal(first?.endShare, first?.depth[3]);
    assert.equal(second?.slug, slugB);
    assert.equal(second?.recircShare, 1, "all five of its loads came from our own story page");
    assert.equal(stats.pathLabels[`/articles/${slugA}`], "Council votes on the rates");
  });

  it("counts trust signals from the three places they actually happen", async () => {
    const stats = await getReadingStats(userId, "7d");
    const byEvent = new Map(stats.trust.map((row) => [row.event, row]));
    assert.equal(byEvent.get("captured-version-opened")?.count, 3, "a load of /evidence");
    assert.equal(byEvent.get("how-we-reported-reached")?.count, 0, "nothing loaded /how-we-report");
    assert.equal(byEvent.get("correction-filed")?.count, 1, "a row in corrections, joined to its story");
    assert.equal(byEvent.get("rss-fetch")?.count, 10);
    assert.equal(byEvent.get("rss-fetch")?.perDay, 1, "10 fetches over 7 days");
    assert.equal(byEvent.get("rss-fetch")?.share, null, "a fetch is not a share of loads");
    assert.equal(byEvent.get("dark-mode-chosen")?.count, 5);
    assert.equal(byEvent.get("dark-mode-chosen")?.share, 0.25);
    assert.equal(byEvent.get("larger-text-chosen")?.count, 0);
    assert.equal(stats.trust.length, 8, "all eight rows are drawn, including the zeroes");
  });

  it("draws the thirty-day chart whichever range is chosen, and a heatmap with something to say", async () => {
    const stats = await getReadingStats(userId, "today");
    assert.equal(stats.daily.length, 30);
    assert.equal(stats.daily[29]?.visits, 40, "today is the last bar");
    assert.equal(stats.dailyMax, 40);
    assert.equal(stats.daily[29]?.over, false, "well under the thousand that turns a bar yellow");
    assert.ok(stats.heatmap.cells.length >= 1);
    assert.equal(stats.heatmap.max, 15);
    assert.ok(stats.heatmap.takeaway?.includes("busiest"), "the panel prints a sentence, not a chart");
    assert.equal(stats.sections[0]?.topic, "council");
    assert.equal(stats.sections[0]?.seconds, 660);
  });

  it("exports the flat rows, this newsroom's only, with the columns the page promises", async () => {
    const { csv, fileName } = await exportReadingCsv(userId, "7d");
    const lines = csv.trimEnd().split("\n");
    assert.deepEqual(lines[0]?.split(","), [
      "hour_start",
      "path",
      "ref_class",
      "device",
      "loads",
      "visits",
      "recirc",
      "left_early",
      "active_seconds",
      "depth_25",
      "depth_50",
      "depth_75",
      "depth_100",
    ]);
    assert.equal(lines.length, 5, "four rows in range, and no header-only file");
    for (const line of lines.slice(1)) {
      assert.equal(line.split(",").length, 13, "every row has every column");
    }
    assert.ok(csv.includes(`/articles/${slugA}`));
    assert.ok(csv.includes("depth_100"));
    assert.ok(!csv.includes("99999"), "another paper's reading is not in this editor's export");
    assert.equal(fileName.startsWith("stats-7d-"), true);
    assert.equal(fileName.endsWith(".csv"), true);
  });

  it("will not name one busiest hour when two are level, because that would name a row order", async () => {
    const sql = await getSql();
    /*
      A second hour with exactly the same visits as the first. The fixture's
      rows all land in one (weekday, hour) cell, so the panel's "busiest hour"
      is that cell; give another hour the same count and neither one is the
      busiest. This row is removed again in the `finally` so the sums the other
      tests assert on are the sums they were written against.
    */
    await sql`
      insert into read_hourly (newsroom_id, hour_start, path, ref_class, device,
        loads, visits, recirc, left_early, active_seconds,
        depth_25, depth_50, depth_75, depth_100)
      values (${newsroomId}, date_trunc('hour', now()) - interval '2 hours', '/', 'search', 'phone',
        15, 15, 0, 0, 0, 0, 0, 0, 0)
    `;
    try {
      const stats = await getReadingStats(userId, "7d");
      assert.equal(stats.heatmap.max, 15);
      assert.equal(
        stats.heatmap.takeaway,
        "2 hours are level at the top of this range; none is the busiest.",
      );
    } finally {
      await sql`
        delete from read_hourly
        where newsroom_id = ${newsroomId} and path = '/' and visits = 15
      `;
    }
    // ...and with the tie gone, one hour is named again.
    const after = await getReadingStats(userId, "7d");
    assert.ok(after.heatmap.takeaway?.includes("is the busiest hour"));
  });

  it("refuses a stranger, the same way the views read does", async () => {
    // `requireEditor` seats a brand-new stranger as owner of the default
    // newsroom when that newsroom has no members at all yet. Claim it first
    // on this PGLite instance so the refusal below is a refusal -- the same
    // guard views.test.ts uses.
    const sql = await getSql();
    const claimed = await sql<{ c: number }>`
      select count(*)::int as c from newsroom_members where newsroom_id = ${DEFAULT_NEWSROOM_ID}
    `;
    let guardOwnerId: string | null = null;
    if (num(claimed[0]?.c) === 0) {
      guardOwnerId = `reading-owner-guard-${Date.now()}`;
      await sql`
        insert into newsroom_members (user_id, role, newsroom_id)
        values (${guardOwnerId}, 'owner', ${DEFAULT_NEWSROOM_ID})
      `;
    }
    try {
      await assert.rejects(() => getReadingStats(`stranger-${Date.now()}`, "7d"));
      await assert.rejects(() => exportReadingCsv(`stranger-${Date.now()}`, "7d"));
    } finally {
      if (guardOwnerId) await sql`delete from newsroom_members where user_id = ${guardOwnerId}`;
    }
  });
});

/*
  The two signals the owner's 2026-09-30 decision permits: a place, and a daily
  visitor count. Its own newsroom id and its own editor, so the exact sums the
  cases above assert on are the sums they were written against.
*/
describe("where readers are, and how many", () => {
  const newsroomId = 9601;
  const userId = `reading-places-owner-${Date.now()}`;

  before(async () => {
    await ensureNewsroomSchema();
    await ensureReadingSchema();
    const sql = await getSql();
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${userId}, 'owner', ${newsroomId})
    `;
    /*
      One place over the threshold, three under it, and one old enough that a
      twelve-month range excludes it -- so the range filter and the threshold
      are both exercised, and the prune below has exactly one row to take.
    */
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits) values
        (${newsroomId}, current_date, 'US', 'Longmont', 100),
        (${newsroomId}, current_date, 'US', 'Lyons', 10),
        (${newsroomId}, current_date - 1, 'US', 'Lyons', 5),
        (${newsroomId}, current_date, 'US', 'unknown', 3),
        (${newsroomId}, current_date - 400, 'US', 'Fort Collins', 7)
    `;
    await sql`
      insert into visitor_daily (newsroom_id, day, visitors) values
        (${newsroomId}, current_date, 42),
        (${newsroomId}, current_date - 1, 37)
    `;
    // Another paper's places and readers, which must not appear anywhere.
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits)
      values (${9999}, current_date, 'US', 'Elsewhere', 500)
    `;
    await sql`
      insert into visitor_daily (newsroom_id, day, visitors) values (${9999}, current_date, 999)
    `;
  });

  it("prints only the places at or over the threshold, and folds the rest so no row is one reader", async () => {
    const stats = await getReadingStats(userId, "7d");
    assert.deepEqual(
      stats.locations.map((row) => row.city),
      ["Longmont"],
      "a place with 10 or 5 visits is not a row",
    );
    assert.equal(stats.locations[0]?.visits, 100);
    assert.equal(stats.locations[0]?.share, 100 / 118, "the bar is over every located visit in range");
    assert.equal(stats.otherVisits, 18, "Lyons twice and the unknown fold, summed rather than named");
    assert.ok(
      !JSON.stringify(stats).includes("Lyons"),
      "a place under the threshold must not reach the browser at all",
    );
    assert.ok(!JSON.stringify(stats).includes("Elsewhere"), "another paper's places are not here");
  });

  it("prunes the place past twelve months, idempotently, and takes nothing else", async () => {
    const sql = await getSql();
    const before = await sql<{ n: number }>`
      select count(*)::int as n from location_daily where newsroom_id = ${newsroomId}
    `;
    assert.equal(num(before[0]?.n), 5);
    // Inside the longest range the page offers, so the row is still drawn.
    const stats = await getReadingStats(userId, "12m");
    assert.deepEqual(stats.locations.map((row) => row.city), ["Longmont"]);
    assert.equal(stats.otherVisits, 18, "the 400-day-old row is outside the range");

    const removed = await pruneLocationDaily();
    assert.equal(removed, 1, "exactly the row past twelve months");
    const after = await sql<{ n: number }>`
      select count(*)::int as n from location_daily where newsroom_id = ${newsroomId}
    `;
    assert.equal(num(after[0]?.n), 4, "nothing else was touched");
    assert.equal(await pruneLocationDaily(), 0, "and running it again takes nothing");
  });

  it("shows a day's visitors as single days, never as a range sum", async () => {
    const stats = await getReadingStats(userId, "7d");
    assert.equal(stats.visitors.today, 42);
    assert.equal(stats.visitors.yesterday, 37);
    // Adding the days would print 79 as "visitors", which is a different and
    // false number -- there is deliberately no field for it.
    assert.deepEqual(Object.keys(stats.visitors).sort(), ["today", "yesterday"]);
  });

  it("draws no place when every place is under the threshold, and still accounts for the visits", async () => {
    /*
      The shape that crashed the panel when it was first written: an empty
      `locations` beside a non-zero `otherVisits`. The panel scaled its bars
      from `locations[0]`, which is undefined in exactly this case, so the read
      that produced it has to be pinned -- a range where everything is under the
      threshold must come back with the visits accounted for in `otherVisits`
      and nothing drawn.
    */
    const onlySmall = 9602;
    const sql = await getSql();
    const memberId = `reading-small-owner-${Date.now()}`;
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${memberId}, 'owner', ${onlySmall})
    `;
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits) values
        (${onlySmall}, current_date, 'US', 'Lyons', 3),
        (${onlySmall}, current_date, 'US', 'Berthoud', 2)
    `;
    try {
      const stats = await getReadingStats(memberId, "7d");
      assert.deepEqual(stats.locations, [], "nothing is drawn under the threshold");
      assert.equal(stats.otherVisits, 5, "and the visits are still accounted for");
      assert.equal(stats.visitors.today, 0, "no reader was counted for this paper");
    } finally {
      await sql`delete from location_daily where newsroom_id = ${onlySmall}`;
      await sql`delete from newsroom_members where newsroom_id = ${onlySmall}`;
    }
  });
});

/*
  Unit U17c: a finished day's small places are folded at rest, not only on the
  screen. Its own newsroom, and assertions scoped to it -- `foldSmallPlaces()`
  is deliberately global (it is a table-wide cleanup on a clock, not a per-paper
  action), so the rows another describe in this file seeded are folded by the
  same call.
*/
describe("a finished day's small places are folded, not kept", () => {
  const newsroomId = 9603;

  /** `daysAgo` is a number, not a date string: the tag parameterises values. */
  async function seedPlace(daysAgo: number, city: string, visits: number) {
    const sql = await getSql();
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits)
      values (${newsroomId}, current_date - ${daysAgo}::int, ${"US"}, ${city}, ${visits})
      on conflict (newsroom_id, day, country, city) do update set
        visits = location_daily.visits + excluded.visits
    `;
  }

  async function mine() {
    const sql = await getSql();
    const rows = await sql<{ city: string; visits: string }>`
      select city, visits from location_daily
      where newsroom_id = ${newsroomId} and country = ${"US"}
      order by city asc
    `;
    return rows.map((row) => [row.city, Number(row.visits)] as const);
  }

  it("moves a finished day's one-visit place into its country's other row and leaves the busy one alone", async () => {
    const sql = await getSql();
    await sql`delete from location_daily where newsroom_id = ${newsroomId}`;
    await seedPlace(3, "SmallTown", 1);
    await seedPlace(3, "Longmont", 30);

    const folded = await foldSmallPlaces();
    assert.ok(folded >= 1, "the small place was folded");

    assert.deepEqual(
      await mine(),
      [
        [FOLDED_CITY, 1],
        ["Longmont", 30],
      ],
      "the one-visit place is gone, the 30-visit place is untouched, and the country's other row holds the 1",
    );
  });

  it("is idempotent: a second run in the same hour changes nothing", async () => {
    const before = await mine();
    assert.equal(await foldSmallPlaces(), 0, "nothing left to fold");
    assert.deepEqual(await mine(), before, "and the table is exactly as it was");
  });

  it("leaves today's small rows alone until the day closes", async () => {
    const sql = await getSql();
    await sql`delete from location_daily where newsroom_id = ${newsroomId}`;
    await seedPlace(0, "TodayTown", 1);
    await seedPlace(0, "Longmont", 30);

    assert.equal(await foldSmallPlaces(), 0, "a day still in progress is not folded");
    assert.deepEqual(
      await mine(),
      [
        ["Longmont", 30],
        ["TodayTown", 1],
      ],
      "the small row is still there today, and the screen folds it for display instead",
    );

    // And when the day is over, the same rows fold: the lag is one day, not
    // forever.
    await sql`
      update location_daily set day = current_date - 1 where newsroom_id = ${newsroomId}
    `;
    assert.equal(await foldSmallPlaces(), 1, "the day closed, so it folds now");
    assert.deepEqual(await mine(), [
      [FOLDED_CITY, 1],
      ["Longmont", 30],
    ]);
  });

  it("a folded row is never drawn as a place, whatever its size", async () => {
    /*
      The case that would otherwise print a bar with no name on it: a country
      whose small places add up past the threshold. 60 visits, over
      LOCATION_MIN_VISITS, and still not a place.
    */
    const sql = await getSql();
    const newsroom = 9604;
    const userId = `reading-fold-owner-${Date.now()}`;
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${userId}, 'owner', ${newsroom})
    `;
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits) values
        (${newsroom}, current_date, 'US', ${FOLDED_CITY}, ${LOCATION_MIN_VISITS + 35}),
        (${newsroom}, current_date, 'US', 'Longmont', ${LOCATION_MIN_VISITS + 100})
    `;
    try {
      const stats = await getReadingStats(userId, "7d");
      assert.deepEqual(
        stats.locations.map((row) => row.city),
        ["Longmont"],
        "the folded row is not a place",
      );
      assert.equal(
        stats.otherVisits,
        LOCATION_MIN_VISITS + 35,
        "its visits are still accounted for, under Other places",
      );
      // NOT `!JSON.stringify(...).includes(FOLDED_CITY)`: FOLDED_CITY is the
      // empty string, and every string contains the empty string, so that
      // assertion could never fail. Check the rows themselves.
      assert.ok(
        stats.locations.every((row) => row.city.length > 0),
        "and no row with a blank city reaches the browser",
      );
    } finally {
      await sql`delete from location_daily where newsroom_id = ${newsroom}`;
      await sql`delete from newsroom_members where newsroom_id = ${newsroom}`;
    }
  });
});
