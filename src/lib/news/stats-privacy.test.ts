/*
  The reader-privacy rule of the Stats beacons, proved rather than described.

  WHAT PROBLEM THIS FILE EXISTS FOR. Unit U17b gave the Stats screen two new
  signals -- a place, and a daily visitor count -- under the owner's decision
  that Stats "must never store or log information identifying an individual".
  That is a claim about an ABSENCE, and an absence is the one thing a test of
  behaviour cannot show by exercising a happy path: every case below is written
  to make the absence fail loudly if it ever stops being true.

  HOW IT IS DONE. A request is sent carrying a known address, a known
  user-agent, a known referrer query and a known cookie. Then everything the
  request could have reached is read back and searched for those four strings:

    - every stats table (`page_views`, `read_hourly`, `trust_signals_hourly`,
      `location_daily`, `visitor_daily`) and `audit_events`, every column of
      every row;
    - everything written under the data root;
    - every console line printed while the request was handled.

  The four strings appear nowhere, or this file fails. The city in the same
  request is NOT in that list on purpose: a city is the permitted signal and is
  supposed to land in `location_daily` -- what must not land is the address
  that produced it.

  The three tests that are easy to get wrong, and so are written longest:
  the handle rotation (B), the location rejection rules (C), and the two bounds
  on a public endpoint (E).
*/

import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { SITE_TARGET, ensureViewsSchema, viewBeaconHandler } from "./views.ts";
import { ensureReadingSchema, readBeaconHandler } from "./reading.server.ts";
import {
  BEACON_BODY_LIMIT_BYTES,
  BEACON_HEADER_ALLOWLIST,
  BEACON_RATE_BURST,
  allowedHeader,
  beaconContextFromHeaders,
  isLoopbackAddress,
  normalizeCity,
  normalizeCountry,
  userAgentClass,
} from "./stats-privacy.ts";
import {
  beaconBucketTokens,
  readBeaconBody,
  resetBeaconBucket,
  takeBeaconToken,
} from "./beacon-guard.server.ts";
import {
  noteVisitor,
  resetVisitorWindow,
  visitorHandleFor,
  visitorWindowState,
} from "./stats-visitors.server.ts";

/** Same bootstrap as reading.server.test.ts -- `articles` is migrations-only. */
async function applyMigrations() {
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // Not every migration applies cleanly on a bare PGLite; the two tables
      // this file needs are asserted below instead.
    }
  }
  await ensureViewsSchema();
  await ensureReadingSchema();
  const sql = await getSql();
  const tables = await sql<{ table_name: string }>`
    select distinct table_name from information_schema.columns
    where table_name in ('location_daily', 'visitor_daily')
    order by table_name
  `;
  assert.deepEqual(
    tables.map((row) => row.table_name),
    ["location_daily", "visitor_daily"],
    "0109's two tables were not created by the migrations or by ensureReadingSchema",
  );
}

before(applyMigrations);

/*
  Both caps and the handle window are process-wide (that is the point of them),
  and every case here writes to the same newsroom, so a case that deliberately
  exhausts a bucket or fills a window must not decide the next case's result.
*/
beforeEach(async () => {
  resetBeaconBucket();
  resetVisitorWindow();
  const sql = await getSql();
  for (const table of [
    "page_views",
    "read_hourly",
    "trust_signals_hourly",
    "location_daily",
    "visitor_daily",
  ]) {
    await sql.query(`delete from ${table} where newsroom_id = $1`, [DEFAULT_NEWSROOM_ID]);
  }
});

/**
 * Run `fn` with a request context whose TRANSPORT PEER is `ip` -- the same
 * AsyncLocalStorage the framework populates for a real request, entered the way
 * src/lib/auth/isolation.server.test.ts enters it. Without it,
 * `beaconPeerIsLoopback()` (src/lib/news/beacon-peer.server.ts) finds no event,
 * returns false, and every location header is correctly ignored -- so a test
 * that expects a place to be counted has to say where the request came from.
 *
 * `undefined` means the adapter reported no peer address at all, which is the
 * case the gate must fail closed on.
 */
const EVENT_STORAGE_KEY = Symbol.for("tanstack-start:event-storage");

/** `AsyncLocalStorage.run`, generically, so a promise-returning case types. */
type EventStorage = { run: <R>(store: unknown, fn: () => R) => R };

async function withPeer<T>(ip: string | undefined, fn: () => Promise<T>): Promise<T> {
  const storage = (globalThis as Record<symbol, EventStorage | undefined>)[EVENT_STORAGE_KEY];
  assert.ok(storage, "tanstack-start's event AsyncLocalStorage was not found on globalThis");
  return storage.run({ h3Event: { req: { ip } } }, fn);
}

/** Everything a reader's request carried that must never be written down. */
const SENTINEL = {
  ip: "203.0.113.7",
  ua: "SentinelAgent/9.9",
  query: "SENTINELQUERY",
  cookie: "SENTINELCOOKIE",
};
const SENTINELS = [SENTINEL.ip, SENTINEL.ua, SENTINEL.query, SENTINEL.cookie];

/** A city that IS allowed to be stored, so the test proves the difference. */
const SENTINEL_CITY = "Longmont";

/** The tables a reader's request could reach. */
const READER_REACHABLE_TABLES = [
  "page_views",
  "read_hourly",
  "trust_signals_hourly",
  "location_daily",
  "visitor_daily",
  "audit_events",
];

/**
 * Every row of every table a beacon can write to, as text. Deliberately a
 * `select *` rather than a named-column list: a column added to one of these
 * tables later is searched by this test the day it is added, without anyone
 * remembering to add it here.
 */
async function dumpReaderReachable(): Promise<string> {
  const sql = await getSql();
  const parts: string[] = [];
  for (const table of READER_REACHABLE_TABLES) {
    try {
      const rows = await sql.query<Record<string, unknown>>(`select * from ${table}`);
      parts.push(`${table}\n${JSON.stringify(rows)}`);
    } catch {
      // A table the migrations did not create on this PGlite run holds nothing.
      parts.push(`${table}\n(absent)`);
    }
  }
  return parts.join("\n");
}

/** Capture every console line printed while `run` does its work. */
async function withCapturedConsole(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const sink = console as unknown as Record<string, unknown>;
  const levels = ["log", "warn", "error"] as const;
  const original = levels.map((level) => sink[level]);
  for (const level of levels) {
    sink[level] = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) =>
            arg instanceof Error ? `${arg.name}: ${arg.message}\n${arg.stack ?? ""}` : String(arg),
          )
          .join(" "),
      );
    };
  }
  try {
    await run();
  } finally {
    levels.forEach((level, index) => {
      sink[level] = original[index];
    });
  }
  return lines;
}

/** A real `Request` carrying every sentinel the rule is about, and a place. */
function sentinelRequest(
  url: string,
  body: unknown,
  options: { withLocation?: boolean } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": SENTINEL.ip,
    "x-forwarded-for": `${SENTINEL.ip}, 10.0.0.1`,
    "user-agent": SENTINEL.ua,
    referer: `https://search.example/?q=${SENTINEL.query}`,
    cookie: `sentinel=${SENTINEL.cookie}`,
  };
  if (options.withLocation !== false) {
    headers["cf-ipcity"] = SENTINEL_CITY;
    headers["cf-ipcountry"] = "US";
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Every path under `dir`, so a test can prove nothing was written. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** Run `run` with a temporary data root, and report what landed in it. */
async function withTempDataRoot(run: () => Promise<void>): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "tr-stats-privacy-"));
  const previous = process.env.TOWNREPORTER_DATA_ROOT;
  process.env.TOWNREPORTER_DATA_ROOT = root;
  try {
    await run();
    return filesUnder(root);
  } finally {
    if (previous === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
    else process.env.TOWNREPORTER_DATA_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

describe("A. nothing that identifies a reader is stored or logged", () => {
  it("A1-A3: sends an address, an agent, a private query and a cookie, and leaves none of them anywhere", async () => {
    const sql = await getSql();
    await sql`
      insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status)
      values (${"privacy-seed"}, ${DEFAULT_NEWSROOM_ID}, ${"privacy-story"}, ${"A story"}, ${""},
              ${"Body"}, ${"council"}, 'published')
    `;

    let lines: string[] = [];
    let files: string[] = [];
    // A real temp data root, so "nothing was written to disk" is a check
    // against a directory that exists rather than a vacuous one.
    files = await withTempDataRoot(async () => {
      lines = await withCapturedConsole(async () => {
        // Both public endpoints, every kind a browser sends, plus a garbage
        // body and an unknown target -- a refusal must be as clean as a write.
        const requests = [
          sentinelRequest("http://test.local/api/read", {
            kind: "load",
            path: "/",
            refClass: "search",
            device: "computer",
          }),
          sentinelRequest("http://test.local/api/read", {
            kind: "load",
            path: "/articles/privacy-story",
            refClass: "search",
            device: "computer",
          }),
          sentinelRequest("http://test.local/api/read", {
            kind: "read",
            path: "/articles/privacy-story",
            refClass: "search",
            device: "computer",
            seconds: 30,
            totalSeconds: 30,
            depth: [25, 50],
            final: true,
          }),
          sentinelRequest("http://test.local/api/read", {
            kind: "trust",
            event: "dark-mode-chosen",
          }),
          sentinelRequest("http://test.local/api/read", "not json at all {{{"),
          sentinelRequest("http://test.local/api/read", { kind: "load", path: "/admin" }),
          sentinelRequest("http://test.local/api/view", { target: SITE_TARGET }),
          sentinelRequest("http://test.local/api/view", { target: "story:privacy-story" }),
          sentinelRequest("http://test.local/api/view", "not json at all {{{"),
        ];
        // Over the tunnel's loopback connection, which is the only peer whose
        // location headers are believed (unit U17c).
        await withPeer("127.0.0.1", async () => {
          for (const request of requests) {
            const response = request.url.includes("/api/view")
              ? await viewBeaconHandler(request)
              : await readBeaconHandler(request);
            assert.equal(response.status, 204, `${request.url} must answer 204`);
          }
        });
      });
    });

    const tables = await dumpReaderReachable();

    // The permitted signal DID land, so the assertions below are about a
    // request that was actually recorded and not one the validator refused.
    assert.ok(
      tables.includes(SENTINEL_CITY),
      "the city should be counted -- if it is not, this test proves nothing about the rest",
    );

    for (const sentinel of SENTINELS) {
      assert.ok(!tables.includes(sentinel), `"${sentinel}" reached a stats table`);
      assert.ok(!lines.join("\n").includes(sentinel), `"${sentinel}" reached a log line`);
      assert.ok(!files.join("\n").includes(sentinel), `"${sentinel}" reached a file on disk`);
    }
    assert.deepEqual(files, [], "the beacon wrote nothing at all to disk");
  });

  it("A4: no stats table has a column naming a reader, and 0109's tables have exactly their columns", async () => {
    const sql = await getSql();
    const rows = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns
      where table_name in (
        'page_views', 'read_hourly', 'trust_signals_hourly', 'location_daily', 'visitor_daily'
      )
    `;
    assert.ok(rows.length > 0);
    const forbidden =
      /(^|_)(ip|addr|address|agent|ua|cookie|session|fingerprint|token|visitor|user|email|hash|salt)($|_)/;
    for (const row of rows) {
      assert.ok(
        !forbidden.test(row.column_name),
        `${row.table_name}.${row.column_name} names a reader`,
      );
      if (row.column_name !== "newsroom_id") {
        assert.ok(
          !row.column_name.includes("id"),
          `${row.table_name}.${row.column_name} looks like a key for one person`,
        );
      }
    }

    // The exact lists, so a column cannot be added to either new table without
    // this file and the acceptance spec being updated with it.
    const columnsFor = async (table: string) =>
      (
        await sql<{ column_name: string }>`
          select column_name from information_schema.columns where table_name = ${table}
        `
      )
        .map((row) => row.column_name)
        .sort();
    assert.deepEqual(await columnsFor("location_daily"), [
      "city",
      "country",
      "day",
      "newsroom_id",
      "visits",
    ]);
    assert.deepEqual(await columnsFor("visitor_daily"), ["day", "newsroom_id", "visitors"]);
  });
});

describe("B. the daily handle rotates and is never written down", () => {
  const salt = "a".repeat(64);
  const input = { ip: SENTINEL.ip, uaClass: "computer" as const };

  it("B5: the same salt over two days gives two unrelated handles, and one day gives the same one twice", () => {
    const monday = visitorHandleFor({ salt, ...input, day: "2026-01-05" });
    const tuesday = visitorHandleFor({ salt, ...input, day: "2026-01-06" });
    assert.notEqual(monday, tuesday, "a day change must change the handle");
    assert.equal(
      monday,
      visitorHandleFor({ salt, ...input, day: "2026-01-05" }),
      "the handle must be deterministic within a day, or a reader would count twice",
    );
    // Different readers, same day: different handles -- otherwise the count
    // would be a constant rather than a count.
    assert.notEqual(
      monday,
      visitorHandleFor({ salt, ip: "198.51.100.9", uaClass: "computer", day: "2026-01-05" }),
    );
    // The class is part of the input, so a phone and a desktop behind one
    // address are two handles rather than one silently merged reader.
    assert.notEqual(
      monday,
      visitorHandleFor({ salt, ip: SENTINEL.ip, uaClass: "phone", day: "2026-01-05" }),
    );
    // It is a digest, not the input: nothing recognisable survives it.
    assert.ok(!monday.includes(SENTINEL.ip));
    assert.equal(monday.length, 64, "hex sha256");
  });

  it("B6: a restart mints a new salt, so the same reader is a different handle", () => {
    const before = visitorWindowState();
    const first = visitorHandleFor({
      salt: before.salt,
      ip: SENTINEL.ip,
      uaClass: "computer",
      day: before.day,
    });
    assert.equal(before.salt.length, 64, "32 bytes of CSPRNG, as hex");
    resetVisitorWindow(); // what a process restart does
    const after = visitorWindowState();
    assert.notEqual(before.salt, after.salt, "a restart must mint a new salt");
    const second = visitorHandleFor({
      salt: after.salt,
      ip: SENTINEL.ip,
      uaClass: "computer",
      day: after.day,
    });
    assert.notEqual(first, second, "the same reader must not survive a restart as the same handle");
  });

  it("B7: neither the salt nor a live handle appears in any table, any file or any log line", async () => {
    let lines: string[] = [];
    const files = await withTempDataRoot(async () => {
      lines = await withCapturedConsole(async () => {
        // Over the tunnel: the client address is only read at all when the
        // peer is loopback (unit U17d), and this case is about the handle.
        const response = await withPeer("127.0.0.1", () =>
          readBeaconHandler(
            sentinelRequest("http://test.local/api/read", {
              kind: "load",
              path: "/",
              refClass: "direct",
              device: "computer",
            }),
          ),
        );
        assert.equal(response.status, 204);
      });
    });

    // The handle this exact request produced, rebuilt from the live salt, so
    // the search below looks for the real value and not a stand-in.
    const state = visitorWindowState();
    const handle = visitorHandleFor({
      salt: state.salt,
      ip: SENTINEL.ip,
      uaClass: "computer",
      day: state.day,
    });
    assert.equal(state.size, 1, "the request really did produce a handle in memory");
    assert.equal(handle.length, 64);

    const tables = await dumpReaderReachable();
    assert.ok(!tables.includes(state.salt), "the salt reached a table");
    assert.ok(!tables.includes(handle), "a handle reached a table");
    assert.ok(!lines.join("\n").includes(state.salt), "the salt reached a log line");
    assert.ok(!lines.join("\n").includes(handle), "a handle reached a log line");
    assert.deepEqual(files, [], "the handle path wrote nothing to disk");
  });

  it("B8: one reader counts once a day, and the window empties at day rollover and on restart", async () => {
    const sql = await getSql();
    const dayA = new Date(2026, 0, 5, 12, 0, 0).getTime();
    const dayB = new Date(2026, 0, 6, 12, 0, 0).getTime();

    // Directly on the window, so the day can be moved without waiting for one.
    assert.equal(noteVisitor({ ip: SENTINEL.ip, uaClass: "computer", now: dayA }), true);
    assert.equal(
      noteVisitor({ ip: SENTINEL.ip, uaClass: "computer", now: dayA }),
      false,
      "the same reader twice in one day is one visitor",
    );
    assert.equal(visitorWindowState(dayA).size, 1);
    const saltOnDayA = visitorWindowState(dayA).salt;
    assert.equal(
      noteVisitor({ ip: SENTINEL.ip, uaClass: "computer", now: dayB }),
      true,
      "the window must rotate at day rollover, or this would be a cross-day identifier",
    );
    assert.notEqual(visitorWindowState(dayB).salt, saltOnDayA, "the rollover changes the salt");
    assert.equal(visitorWindowState(dayB).size, 1, "rotating starts a fresh window, it does not grow one");

    resetVisitorWindow();
    assert.equal(visitorWindowState(dayA).size, 0, "a restart empties the window");

    // The same rule through the endpoint: three loads from one reader are one
    // visitor in the table, a second reader makes it two, and a request with no
    // address at all counts nobody.
    // Over the tunnel: an address is only read when the peer is loopback
    // (unit U17d), and this case is entirely about addresses.
    const send = async (headers: Record<string, string>) => {
      const response = await withPeer("127.0.0.1", () =>
        readBeaconHandler(
          new Request("http://test.local/api/read", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({
              kind: "load",
              path: "/",
              refClass: "direct",
              device: "computer",
            }),
          }),
        ),
      );
      assert.equal(response.status, 204);
    };
    const visitorsNow = async () => {
      const [row] = await sql<{ visitors: string }>`
        select visitors from visitor_daily
        where newsroom_id = ${DEFAULT_NEWSROOM_ID} and day = current_date
      `;
      return Number(row?.visitors ?? 0);
    };

    for (let i = 0; i < 3; i += 1) await send({ "cf-connecting-ip": SENTINEL.ip });
    assert.equal(await visitorsNow(), 1, "three loads, one reader, one visitor");
    await send({ "cf-connecting-ip": "198.51.100.9" });
    assert.equal(await visitorsNow(), 2, "a second reader is a second visitor");
    await send({});
    assert.equal(await visitorsNow(), 2, "no address, no visitor -- never counted some other way");
  });
});

describe("C. a place is read coarsely, or not at all", () => {
  it("C9: the two Cloudflare headers become one day's counter for that place", async () => {
    const sql = await getSql();
    const response = await withPeer("127.0.0.1", () =>
      readBeaconHandler(
        sentinelRequest("http://test.local/api/read", {
          kind: "load",
          path: "/",
          refClass: "direct",
          device: "computer",
        }),
      ),
    );
    assert.equal(response.status, 204);
    const rows = await sql<{ country: string; city: string; visits: string }>`
      select country, city, visits from location_daily
      where newsroom_id = ${DEFAULT_NEWSROOM_ID} and day = current_date and country = ${"US"}
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.city, SENTINEL_CITY);
    assert.equal(Number(rows[0]?.visits), 1);

    // A country with no city is still a place, folded so it cannot be mistaken
    // for a real name.
    const countryOnly = new Request("http://test.local/api/read", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-ipcountry": "de" },
      body: JSON.stringify({ kind: "load", path: "/", refClass: "direct", device: "computer" }),
    });
    assert.equal((await withPeer("127.0.0.1", () => readBeaconHandler(countryOnly))).status, 204);
    const folded = await sql<{ city: string }>`
      select city from location_daily
      where newsroom_id = ${DEFAULT_NEWSROOM_ID} and country = ${"DE"}
    `;
    assert.deepEqual(
      folded.map((row) => row.city),
      ["unknown"],
      "the country is uppercased and the missing city is the fold, not a blank",
    );
  });

  it("C10: location_daily has no column for a latitude, a longitude, a region, a postal code or a timezone", async () => {
    const sql = await getSql();
    const rows = await sql<{ column_name: string }>`
      select column_name from information_schema.columns where table_name = 'location_daily'
    `;
    const names = rows.map((row) => row.column_name.toLowerCase());
    for (const forbidden of [
      "latitude",
      "longitude",
      "lat",
      "lon",
      "lng",
      "region",
      "region_code",
      "postal_code",
      "postcode",
      "zip",
      "timezone",
      "continent",
      "metro_code",
      "asn",
      "hour_start",
    ]) {
      assert.ok(!names.includes(forbidden), `location_daily has a ${forbidden} column`);
    }
    // The grain is a day: never an hour, never an instant. A finer bucket is
    // the thing migrations/0103_read_hourly.sql:15 refuses.
    const types = await sql<{ column_name: string; data_type: string }>`
      select column_name, data_type from information_schema.columns
      where table_name = 'location_daily' and column_name = 'day'
    `;
    assert.equal(types[0]?.data_type, "date", "a day, not a timestamp");
  });

  it("C11: a request with no location header writes no place and still counts the load", async () => {
    const sql = await getSql();
    const response = await readBeaconHandler(
      sentinelRequest(
        "http://test.local/api/read",
        { kind: "load", path: "/", refClass: "search", device: "phone" },
        { withLocation: false },
      ),
    );
    assert.equal(response.status, 204);

    const places = await sql<{ n: number }>`select count(*)::int as n from location_daily`;
    assert.equal(Number(places[0]?.n ?? 0), 0, "no header, no row");
    const loads = await sql<{ n: number }>`
      select count(*)::int as n from read_hourly
      where path = ${"/"} and ref_class = ${"search"} and device = ${"phone"}
    `;
    assert.equal(Number(loads[0]?.n ?? 0), 1, "the load itself is unaffected");
  });

  it("C12: a city that is not a place name is rejected, not tidied and kept", () => {
    // The two attacks: control characters, and length.
    const control = String.fromCharCode(1);
    assert.equal(
      normalizeCity(`Longmont${control}${"x".repeat(10_000)}`),
      null,
      "a control character anywhere refuses the whole value",
    );
    assert.equal(normalizeCity("a".repeat(10_000)), null, "a 10 KB value is refused");
    assert.equal(normalizeCity("x".repeat(65)), null, "just over the cap is refused");
    assert.equal(normalizeCity("x".repeat(64)), "x".repeat(64), "the cap itself is allowed");

    // Not place names. A validator that tidied these would file a reader under
    // a URL or a blob.
    for (const bad of [
      "",
      "   ",
      "https://example.com/longmont",
      '{"city":"Longmont"}',
      "12345",
      "....",
      "<script>alert(1)</script>",
      control,
      `Long${control}mont`,
    ]) {
      assert.equal(normalizeCity(bad), null, `${JSON.stringify(bad.slice(0, 24))} is not a place`);
    }

    // Real ones, including the punctuation real names carry.
    for (const good of ["Longmont", "Boulder County", "Saint-Denis", "O'Fallon", "Winston-Salem"]) {
      assert.equal(normalizeCity(good), good);
    }
    assert.equal(normalizeCity("  Longmont   City  "), "Longmont City", "whitespace is collapsed");

    // Countries: exactly two letters, uppercased, and two non-places refused.
    assert.equal(normalizeCountry("us"), "US");
    assert.equal(normalizeCountry(" US "), "US");
    for (const bad of ["USA", "U", "", "1S", "XX", "T1", null, 42]) {
      assert.equal(normalizeCountry(bad), null, `${String(bad)} is not a country`);
    }

    // The agent is reduced to a word, and no part of the string survives.
    assert.equal(userAgentClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148"), "phone");
    assert.equal(userAgentClass("Mozilla/5.0 (iPad; CPU OS 17_0)"), "tablet");
    assert.equal(userAgentClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "computer");
    assert.equal(userAgentClass("Googlebot/2.1 (+http://www.google.com/bot.html)"), "bot");
    assert.equal(userAgentClass(SENTINEL.ua), "computer");
    assert.equal(userAgentClass(undefined), "other");
    assert.equal(userAgentClass(""), "other");
  });
});

describe("E. the two bounds on a public beacon", () => {
  it("E16: a body over the cap is refused, answered 204, and never buffered whole", async () => {
    const sql = await getSql();
    const CHUNK = 64 * 1024;
    const TOTAL = 1024 * 1024;
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= TOTAL) {
          controller.close();
          return;
        }
        const size = Math.min(CHUNK, TOTAL - produced);
        produced += size;
        controller.enqueue(new Uint8Array(size).fill(65));
      },
    });
    const request = new Request("http://test.local/api/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const before = await sql<{ n: number }>`select count(*)::int as n from read_hourly`;
    const response = await readBeaconHandler(request);
    assert.equal(response.status, 204, "over the cap is still 204, never a 500");

    assert.ok(
      produced <= BEACON_BODY_LIMIT_BYTES + 2 * CHUNK,
      `the handler pulled ${produced} bytes of a ${TOTAL}-byte body; the cap is ${BEACON_BODY_LIMIT_BYTES}`,
    );
    assert.ok(produced < TOTAL, "the whole body must never be read");
    const after = await sql<{ n: number }>`select count(*)::int as n from read_hourly`;
    assert.equal(Number(after[0]?.n ?? 0), Number(before[0]?.n ?? 0), "an oversize body writes nothing");

    // Directly, so the boundary is pinned rather than approximated: a body at
    // the cap is read, one byte over is refused.
    const atCap = new Request("http://test.local/api/read", {
      method: "POST",
      body: "x".repeat(BEACON_BODY_LIMIT_BYTES),
    });
    assert.equal((await readBeaconBody(atCap))?.length, BEACON_BODY_LIMIT_BYTES);
    const overCap = new Request("http://test.local/api/read", {
      method: "POST",
      body: "x".repeat(BEACON_BODY_LIMIT_BYTES + 1),
    });
    assert.equal(await readBeaconBody(overCap), null, "one byte over the cap is refused");
  });

  it("E17: past the rate cap a beacon writes nothing and still answers 204, and no log line names anyone", async () => {
    const sql = await getSql();
    /*
      Time is frozen for the body of this case. The bucket refills with wall
      time, so without this the drain below would not be exactly one burst and
      the "and then it refuses" half would race the refill.
    */
    const frozen = Date.now();
    const realNow = Date.now;
    let taken = 0;
    let lines: string[] = [];
    let wroteNothing = false;
    try {
      Date.now = () => frozen;
      while (takeBeaconToken()) {
        taken += 1;
        assert.ok(taken <= BEACON_RATE_BURST, "the bucket handed out more than its burst");
      }
      assert.equal(taken, BEACON_RATE_BURST, "a full bucket is exactly one burst");
      assert.equal(beaconBucketTokens(), 0, "and it is empty afterwards");
      assert.equal(takeBeaconToken(), false, "an exhausted bucket refuses");

      const before = await sql<{ n: number }>`select count(*)::int as n from read_hourly`;
      lines = await withCapturedConsole(async () => {
        for (let i = 0; i < 5; i += 1) {
          const response = await readBeaconHandler(
            sentinelRequest("http://test.local/api/read", {
              kind: "load",
              path: "/",
              refClass: "direct",
              device: "computer",
            }),
          );
          assert.equal(response.status, 204, "over the cap is still 204");
        }
        const viewResponse = await viewBeaconHandler(
          sentinelRequest("http://test.local/api/view", { target: SITE_TARGET }),
        );
        assert.equal(viewResponse.status, 204, "the view beacon sits behind the same bucket");
      });
      const after = await sql<{ n: number }>`select count(*)::int as n from read_hourly`;
      wroteNothing = Number(after[0]?.n ?? 0) === Number(before[0]?.n ?? 0);
    } finally {
      Date.now = realNow;
    }

    assert.ok(wroteNothing, "an over-cap beacon wrote nothing");
    const places = await sql<{ n: number }>`select count(*)::int as n from location_daily`;
    assert.equal(Number(places[0]?.n ?? 0), 0, "and wrote no place");
    const visitors = await sql<{ n: number }>`select count(*)::int as n from visitor_daily`;
    assert.equal(Number(visitors[0]?.n ?? 0), 0, "and counted no visitor");

    const log = lines.join("\n");
    for (const sentinel of SENTINELS) {
      assert.ok(!log.includes(sentinel), `"${sentinel}" reached a log line while over the cap`);
    }

    // And the budget refills: a second later there is a second's worth back.
    const later = frozen + 1000;
    assert.ok(beaconBucketTokens(later) >= 20, "the bucket refills over time");
    assert.equal(takeBeaconToken(later), true, "and hands a token out again");
  });

  it("E18-E19: a database error on the extras is swallowed, logged with a fixed tag, and leaves every other counter alone", async () => {
    const pg = await getPglite();
    const sql = await getSql();
    const countLoads = async () => {
      const [row] = await sql<{ n: number }>`
        select count(*)::int as n from read_hourly where path = ${"/"} and ref_class = ${"direct"}
      `;
      return Number(row?.n ?? 0);
    };
    const before = await countLoads();

    // Break the location write without breaking the load: the extras insert
    // throws, and the load above it must be unaffected.
    await pg.exec("drop table if exists location_daily");
    let lines: string[] = [];
    try {
      lines = await withCapturedConsole(async () => {
        // Over loopback, so the location write is attempted at all and the
        // dropped table is what fails.
        const response = await withPeer("127.0.0.1", () =>
          readBeaconHandler(
            sentinelRequest("http://test.local/api/read", {
              kind: "load",
              path: "/",
              refClass: "direct",
              device: "computer",
            }),
          ),
        );
        assert.equal(response.status, 204, "a database error is still 204");
      });
    } finally {
      await pg.exec(
        readFileSync(join(process.cwd(), "migrations", "0109_stats_location.sql"), "utf8"),
      );
    }

    assert.equal(
      (await countLoads()) - before,
      1,
      "the load still landed: one counter's bad day is never another's",
    );

    const log = lines.join("\n");
    assert.ok(
      log.includes("[reading] load extras failed"),
      "the failure is logged with its fixed tag",
    );
    for (const sentinel of SENTINELS) {
      assert.ok(!log.includes(sentinel), `"${sentinel}" reached the error log`);
    }
  });
});

describe("F. the location headers are believed only over the tunnel (U17c)", () => {
  it("F1: only a loopback peer, in any of its spellings, opens the gate", () => {
    for (const loopback of [
      "127.0.0.1",
      "127.0.0.53",
      "127.255.255.254",
      "::1",
      "::ffff:127.0.0.1",
      " 127.0.0.1 ",
    ]) {
      assert.equal(isLoopbackAddress(loopback), true, `"${loopback}" is loopback`);
    }
    for (const other of [
      "10.0.0.1",
      "192.168.1.10",
      "203.0.113.7",
      "172.16.0.1",
      "128.0.0.1",
      "0.0.0.0",
      "::",
      "2001:db8::1",
      "fe80::1%eth0",
      "::ffff:10.0.0.1",
      "localhost",
      "",
      "   ",
      "not-an-address",
      "127.0.0.256",
      "127.0.0",
      undefined,
      null,
      42,
    ]) {
      assert.equal(isLoopbackAddress(other), false, `"${String(other)}" is not loopback`);
    }
  });

  it("F2: only a loopback peer gets a place; every other peer counts everything else unchanged", async () => {
    const sql = await getSql();
    const send = () =>
      sentinelRequest("http://test.local/api/read", {
        kind: "load",
        path: "/",
        refClass: "search",
        device: "phone",
      });
    const places = async () => {
      const [row] = await sql<{ n: number }>`select count(*)::int as n from location_daily`;
      return Number(row?.n ?? 0);
    };
    // A SUM, not a row count: read_hourly is one row per (hour, path, class,
    // device) with a running `loads`, so counting rows would read the same
    // number after every load.
    const loads = async () => {
      const [row] = await sql<{ n: number }>`
        select coalesce(sum(loads), 0)::int as n from read_hourly
        where path = ${"/"} and ref_class = ${"search"} and device = ${"phone"}
      `;
      return Number(row?.n ?? 0);
    };

    const cases = [
      ["a public address", "203.0.113.7", 0],
      ["a private LAN address", "192.168.1.10", 0],
      ["an address the adapter did not report", undefined, 0],
      ["the tunnel's loopback connection", "127.0.0.1", 1],
    ] as const;

    for (const [label, peer, expectedPlaces] of cases) {
      await sql`delete from location_daily where newsroom_id = ${DEFAULT_NEWSROOM_ID}`;
      const before = await loads();
      const response = await withPeer(peer, () => readBeaconHandler(send()));
      assert.equal(response.status, 204, `${label}: still answers 204`);
      assert.equal(await places(), expectedPlaces, `${label}: places written`);
      assert.equal(await loads(), before + 1, `${label}: the load itself is counted either way`);
    }
  });

  it("F3: the header helper refuses a name outside the allowlist without touching the Headers object", () => {
    const asked: string[] = [];
    const real = new Headers({ "cf-ipcity": "Longmont", "cf-iplatitude": "40.1672" });
    const recording = new Proxy(real, {
      get(target, property, receiver) {
        if (property === "get") {
          return (name: string) => {
            asked.push(String(name).toLowerCase());
            return target.get(name);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as Headers;

    assert.equal(allowedHeader(recording, "cf-ipcity"), "Longmont");
    assert.deepEqual(asked, ["cf-ipcity"], "an allowlisted name is read normally");

    assert.equal(allowedHeader(recording, "cf-iplatitude"), null, "a name off the list is refused");
    assert.equal(asked.length, 1, "and it never reached the Headers object at all");

    // The list the code enforces and the list the tests check are one object.
    for (const name of BEACON_HEADER_ALLOWLIST) {
      allowedHeader(recording, name);
    }
    assert.deepEqual(
      [...new Set(asked)].sort(),
      [...BEACON_HEADER_ALLOWLIST].sort(),
      "the five allowlisted names are exactly what the helper will read",
    );
  });

  it("F4: an untrusted peer's location headers are not read at all -- not read and discarded", () => {
    const asked: string[] = [];
    const real = new Headers({
      "cf-ipcity": "Longmont",
      "cf-ipcountry": "US",
      "cf-connecting-ip": "203.0.113.7",
      "user-agent": "SentinelAgent/9.9",
    });
    const recording = new Proxy(real, {
      get(target, property, receiver) {
        if (property === "get") {
          return (name: string) => {
            asked.push(String(name).toLowerCase());
            return target.get(name);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as Headers;

    const untrusted = beaconContextFromHeaders(recording, { fromTunnel: false });
    assert.equal(untrusted.city, null);
    assert.equal(untrusted.country, null);
    assert.equal(untrusted.ip, null, "the address header was read for an untrusted peer");
    assert.ok(!asked.includes("cf-ipcity"), "the city header was read for an untrusted peer");
    assert.ok(!asked.includes("cf-ipcountry"), "the country header was read for an untrusted peer");
    assert.ok(
      !asked.includes("cf-connecting-ip"),
      "the address header was read for an untrusted peer",
    );
    // What the gate does NOT close: the agent class. It is not an address, it
    // cannot be varied to inflate a count on its own (there is no address to
    // hash with it), and it is reduced to one word.
    assert.equal(untrusted.uaClass, "computer");

    const trusted = beaconContextFromHeaders(recording, { fromTunnel: true });
    assert.equal(trusted.city, "Longmont");
    assert.equal(trusted.country, "US");
    assert.equal(trusted.ip, "203.0.113.7");
  });

  it("F5: an untrusted peer's address counts no visitor; the tunnel's counts one", async () => {
    /*
      The address headers are as forgeable as the location pair, so they are
      gated the same way (unit U17d). A direct client that varied
      `cf-connecting-ip` per request would otherwise mint a fresh handle every
      time and inflate the day's visitor figure without limit.
    */
    const sql = await getSql();
    const send = () =>
      new Request("http://test.local/api/read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "203.0.113.7",
          "user-agent": "ProbeAgent/1.0",
        },
        body: JSON.stringify({ kind: "load", path: "/", refClass: "direct", device: "computer" }),
      });
    const visitors = async () => {
      const [row] = await sql<{ visitors: string }>`
        select visitors from visitor_daily
        where newsroom_id = ${DEFAULT_NEWSROOM_ID} and day = current_date
      `;
      return Number(row?.visitors ?? 0);
    };

    // A public peer that sets the headers itself: not counted, at all.
    assert.equal((await withPeer("203.0.113.7", () => readBeaconHandler(send()))).status, 204);
    assert.equal(await visitors(), 0, "a direct client's cf-connecting-ip counts no visitor");

    // The same request over the tunnel: counted, once.
    assert.equal((await withPeer("127.0.0.1", () => readBeaconHandler(send()))).status, 204);
    assert.equal(await visitors(), 1, "the tunnel's address is counted once");

    // And a forged address over the tunnel is one reader, not many: varying the
    // header is exactly what the tunnel gate exists to make impossible.
    assert.equal((await withPeer("127.0.0.1", () => readBeaconHandler(send()))).status, 204);
    assert.equal(await visitors(), 1, "the same reader is not counted twice");
  });

  it("F6: the peer gate assumes srvx's trustProxy is off, and this repo never turns it on", () => {
    /*
      h3's `getRequestIP()` answers `event.req.ip`, and srvx REWRITES `req.ip`
      from the first `x-forwarded-for` value when the server runs with
      `trustProxy` (node_modules/srvx/dist/_chunks/_trust-proxy.mjs:
      `Object.defineProperty(request, "ip", { value: forwardedFor, ... })`).
      With it on, `beaconPeerIsLoopback()` would be reading a header the caller
      controls and would open for anyone sending `x-forwarded-for: 127.0.0.1`.

      Nitro's `serve()` passes no proxy option, which is why the gate holds. This
      is the cheap static guard the unit asked for: the setting must not appear
      in the config surface this repo owns, so turning it on fails here rather
      than silently opening the gate in production.
    */
    const roots = ["vite.config.ts", "server"];
    const files: string[] = [];
    const walk = (path: string) => {
      const stat = statSync(path);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(path)) walk(join(path, entry));
      } else if (/\.(ts|mjs|js|json)$/.test(path)) {
        files.push(path);
      }
    };
    for (const root of roots) walk(join(process.cwd(), root));
    assert.ok(files.length > 0, "the scan found no config files at all -- the probe is broken");

    const offenders = files.filter((file) => /trustProxy/.test(readFileSync(file, "utf8")));
    assert.deepEqual(
      offenders.map((file) => file.slice(process.cwd().length + 1)),
      [],
      "trustProxy is set somewhere in the server config, which makes req.ip header-controlled " +
        "and opens the beacon's tunnel gate -- see src/lib/news/beacon-peer.server.ts",
    );
  });
});
