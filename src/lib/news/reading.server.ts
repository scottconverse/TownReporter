/*
  Reading, stored in aggregate.

  WHAT THIS FILE IS. The server half of the redesign's reading beacon
  (docs/design/handoff-2026-09-26/README.md:370-411, "12. Stats"): the
  endpoint the reader's browser posts to, the hour-bucketed aggregates it
  writes, and the editor-only queries the Stats page reads back.

  THE PRIVACY RULE IT KEEPS (README.md:370-411, and the owner's decision of
  2026-09-30). Every row in `read_hourly` (migrations/0103_read_hourly.sql) is a
  SUM over one hour, one path, one referrer class and one device class. There is
  no column for an IP, a user agent, a cookie, a session, or any other
  per-reader value -- and there can be no such column, because what the beacon
  sends is the vocabulary in src/lib/news/reading.ts and nothing else:

    load   path, referrer class, device class, whether the referrer was one of
           our own article pages
    read   path, referrer class, device class, whole seconds of active time,
           and which scroll-depth buckets this load has newly reached
    beat   path, device class, seconds so far -- NEVER WRITTEN DOWN; it only
           feeds the in-memory window in src/lib/news/reading-live.ts
    trust  one of four fixed event names

  WHAT THE OWNER'S 2026-09-30 DECISION ADDED, AND HOW IT IS KEPT. Two signals
  are now permitted beside the above, both counted on a `load` and neither one
  storing or logging anything that identifies a person:

    location  a city and a country, read from Cloudflare's own `cf-ipcity` /
              `cf-ipcountry` headers, validated by rejection, and written as a
              per-DAY counter (migrations/0109_stats_location.sql). No IP is
              stored, no latitude, longitude, region, postal code or timezone is
              read at all, and a request that carries no such header writes no
              row. A place is printed on the Stats page only once
              LOCATION_MIN_VISITS visits have been counted there, so a row can
              never be a statement about one reader.

    visitors  a daily integer. The server tells two readers apart for one day
              with an HMAC held in process memory, whose secret salt rotates at
              day rollover and dies with the process -- see
              src/lib/news/stats-visitors.server.ts. Nothing derived from an
              address is ever written down; only the integer is.

  Of the request, `readBeaconHandler` reads exactly the five header names in
  src/lib/news/stats-privacy.ts's allowlist and the JSON body, and the body only
  through a 2 KB cap. `referer` and `cookie` are still never touched, and the
  referrer is still classified in the browser so the server never sees a URL.
  `reading.server.test.ts` pins the allowlist with a `Headers` that records
  every `get()`.

  WHAT IT STILL DOES NOT MEASURE, AND SAYS SO. "Returning readers" cannot be
  counted without a cross-day identifier, so it is still not counted
  (README.md:370-411): a reader who comes back tomorrow is a new handle. The
  visitor figure is an estimate that can be wrong in EITHER direction -- the
  handle set is one process wide, so a restart, or a busy day's eviction of its
  oldest handles, can count a reader who was already counted a second time
  (over), while one address shared by a household, an office or a carrier's NAT
  is one handle (under) -- and the page prints that beside the number rather
  than calling it a headcount. It said "under-counts" until unit U17c, which
  was one of the two directions and not the honest one on its own.

  A NOTE ON THE DENOMINATOR. `loads` counts every page load the beacon
  reported, `visits` only the ones that arrived from outside the site
  (DECISIONS.md:90, Q6: the referrer host is not the paper's own). So
  `loads >= visits` in every row, and every per-load ratio on the page
  (average reading time, left without reading, read another story, read
  through) divides by `loads` -- the honest denominator for "of the loads we
  heard about". A `read` report whose `load` report never arrived (a dropped
  request) can add time to a row with `loads = 0`; the page clamps its ratios
  and the note under each one names the denominator.
*/

import { ensureSchemaOnce, getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID, requireEditor } from "./membership.ts";
import {
  ARTICLE_PATH_PREFIX,
  EVIDENCE_PATH,
  LEFT_WITHOUT_READING_SECONDS,
  READ_REF_CLASSES,
  READ_REF_CLASS_LABELS,
  READING_RANGE_LABELS,
  TRUST_EVENTS,
  TRUST_EVENT_LABELS,
  clampReadSeconds,
  isBeaconTrustEvent,
  isReadDepthBucket,
  isReadDevice,
  isReadRefClass,
  isTrustEvent,
  normalizeReadPath,
  storySlugFromPath,
} from "./reading.ts";
import { liveSnapshot, noteLiveArrival, noteLiveBeat } from "./reading-live.ts";
import { SITE_TARGET, ensureViewsSchema } from "./views.ts";
import { readBeaconJson, takeBeaconToken } from "./beacon-guard.server.ts";
import { beaconPeerIsLoopback } from "./beacon-peer.server.ts";
import { noteVisitor } from "./stats-visitors.server.ts";
import {
  BEACON_HEADER_ALLOWLIST,
  EMPTY_BEACON_CONTEXT,
  FOLDED_CITY,
  LOCATION_MIN_VISITS,
  beaconContextFromHeaders,
  locationRowFor,
} from "./stats-privacy.ts";
import type { BeaconContext } from "./stats-privacy.ts";
import type { LiveSnapshot } from "./reading-live.ts";
import type { ReadRefClass, TrustEvent } from "./reading.ts";
import type { ReadingRange } from "./reading.ts";

export { BEACON_HEADER_ALLOWLIST };

/**
 * Mirrors migrations/0103_read_hourly.sql and migrations/0109_stats_location.sql.
 * They must stay column-for-column identical -- src/lib/news/schema-parity.test.ts
 * diffs them (type, nullability, default and index, table by table), and every
 * table this file touches is created here as well so a plain `node --test` run
 * (no Vite migration glob, see db.ts's `createPgliteSql`) and a freshly rebuilt
 * PGLite preview both have it before it is queried.
 *
 * One marker guards all four tables. `ensureSchemaOnce` keys on a fingerprint
 * of the whole statement list, so adding 0109's two tables here re-runs the
 * 0103 statements once on an installed database -- harmless, since every one of
 * them is `create ... if not exists`.
 */
const READING_SCHEMA_STATEMENTS = [
  `create table if not exists read_hourly (
     newsroom_id integer not null default 1,
     hour_start timestamptz not null,
     path text not null,
     ref_class text not null,
     device text not null,
     loads bigint not null default 0,
     visits bigint not null default 0,
     recirc bigint not null default 0,
     left_early bigint not null default 0,
     active_seconds bigint not null default 0,
     depth_25 bigint not null default 0,
     depth_50 bigint not null default 0,
     depth_75 bigint not null default 0,
     depth_100 bigint not null default 0,
     primary key (newsroom_id, hour_start, path, ref_class, device)
   )`,
  `create index if not exists read_hourly_newsroom_hour_idx
     on read_hourly (newsroom_id, hour_start desc)`,
  `create table if not exists trust_signals_hourly (
     newsroom_id integer not null default 1,
     hour_start timestamptz not null,
     event text not null,
     count bigint not null default 0,
     primary key (newsroom_id, hour_start, event)
   )`,
  `create index if not exists trust_signals_hourly_newsroom_hour_idx
     on trust_signals_hourly (newsroom_id, hour_start desc)`,
  // migrations/0109_stats_location.sql. A place counted by the day -- never by
  // the hour, which for a small town would be one reader's evening (see that
  // file's header and migrations/0103_read_hourly.sql:15). No extra index: the
  // primary key is already prefixed by (newsroom_id, day), which is every read
  // this table gets.
  `create table if not exists location_daily (
     newsroom_id integer not null default 1,
     day date not null,
     country text not null,
     city text not null,
     visits bigint not null default 0,
     primary key (newsroom_id, day, country, city)
   )`,
  // The one integer the in-memory visitor handles produce
  // (src/lib/news/stats-visitors.server.ts). There is no table of handles, and
  // there must never be one: nothing derived from an address is written down.
  `create table if not exists visitor_daily (
     newsroom_id integer not null default 1,
     day date not null,
     visitors bigint not null default 0,
     primary key (newsroom_id, day)
   )`,
] as const;

export async function ensureReadingSchema(): Promise<void> {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "read_hourly", READING_SCHEMA_STATEMENTS);
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type ReadBeaconOutcome = {
  /** False for a malformed or unlisted request -- nothing was written. */
  accepted: boolean;
  kind: string;
  /** Why it was refused, for the tests; never printed to a reader. */
  reason?: string;
};

/** A slug is only reportable while it is a published story of this newsroom. */
async function isPublishedStory(slug: string, newsroomId: number): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    select id from articles
    where slug = ${slug} and status = 'published' and newsroom_id = ${newsroomId}
    limit 1
  `;
  return rows.length > 0;
}

/**
 * The shape every persisting kind shares: a canonical path (and, if it is a
 * story, a story that actually exists) plus the two classes. Returns the
 * canonical path, or the reason it was refused.
 */
async function validateRow(
  body: Record<string, unknown>,
  newsroomId: number,
): Promise<{ path: string; refClass: ReadRefClass; device: "phone" | "tablet" | "computer" } | string> {
  const path = normalizeReadPath(body.path);
  if (!path) return "path";
  if (!isReadRefClass(body.refClass)) return "refClass";
  if (!isReadDevice(body.device)) return "device";
  const slug = storySlugFromPath(path);
  if (slug && !(await isPublishedStory(slug, newsroomId))) return "unpublished";
  return { path, refClass: body.refClass, device: body.device };
}

async function insertLoad(row: {
  newsroomId: number;
  path: string;
  refClass: ReadRefClass;
  device: string;
  visits: number;
  recirc: number;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into read_hourly (newsroom_id, hour_start, path, ref_class, device, loads, visits, recirc)
    values (${row.newsroomId}, date_trunc('hour', now()), ${row.path}, ${row.refClass},
            ${row.device}, 1, ${row.visits}, ${row.recirc})
    on conflict (newsroom_id, hour_start, path, ref_class, device) do update set
      loads = read_hourly.loads + 1,
      visits = read_hourly.visits + excluded.visits,
      recirc = read_hourly.recirc + excluded.recirc
  `;
}

async function insertReadTime(row: {
  newsroomId: number;
  path: string;
  refClass: ReadRefClass;
  device: string;
  seconds: number;
  leftEarly: number;
  depth: Record<"25" | "50" | "75" | "100", number>;
}): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into read_hourly (
      newsroom_id, hour_start, path, ref_class, device,
      active_seconds, left_early, depth_25, depth_50, depth_75, depth_100
    )
    values (${row.newsroomId}, date_trunc('hour', now()), ${row.path}, ${row.refClass},
            ${row.device}, ${row.seconds}, ${row.leftEarly},
            ${row.depth["25"]}, ${row.depth["50"]}, ${row.depth["75"]}, ${row.depth["100"]})
    on conflict (newsroom_id, hour_start, path, ref_class, device) do update set
      active_seconds = read_hourly.active_seconds + excluded.active_seconds,
      left_early = read_hourly.left_early + excluded.left_early,
      depth_25 = read_hourly.depth_25 + excluded.depth_25,
      depth_50 = read_hourly.depth_50 + excluded.depth_50,
      depth_75 = read_hourly.depth_75 + excluded.depth_75,
      depth_100 = read_hourly.depth_100 + excluded.depth_100
  `;
}

/**
 * One of the eight trust signals, counted. The beacon may report the four
 * browser-side ones; `rss-fetch` is counted server-side in src/routes/feed.ts
 * through this same function, which is why it accepts every `TrustEvent` and
 * not only the beacon's four.
 */
export async function recordTrustCount(
  event: TrustEvent,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  times: number = 1,
): Promise<void> {
  if (!isTrustEvent(event)) return;
  const sql = await getSql();
  await ensureReadingSchema();
  await sql`
    insert into trust_signals_hourly (newsroom_id, hour_start, event, count)
    values (${newsroomId}, date_trunc('hour', now()), ${event}, ${Math.max(1, Math.floor(times))})
    on conflict (newsroom_id, hour_start, event) do update set
      count = trust_signals_hourly.count + excluded.count
  `;
}

/**
 * One beacon report. Always resolves; a refusal writes nothing and says why,
 * an error is logged and swallowed the way `recordView` swallows its own --
 * a stats failure must never reach a reader's page or the route's answer.
 *
 * Split out from the route so the tests can call it with a plain object: that
 * is where the referrer classes, the visit/internal split, the
 * left-without-reading rule, the read-through buckets and the published-slug
 * check are all pinned down.
 */
export async function recordReadBeacon(
  payload: unknown,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  context: BeaconContext = EMPTY_BEACON_CONTEXT,
): Promise<ReadBeaconOutcome> {
  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const kind = typeof body.kind === "string" ? body.kind : "";
  try {
    switch (kind) {
      case "load":
        return await recordLoad(body, newsroomId, context);
      case "read":
        return await recordReadTime(body, newsroomId);
      case "trust":
        return await recordTrust(body, newsroomId);
      case "beat":
        return recordBeat(body);
      default:
        return { accepted: false, kind, reason: "kind" };
    }
  } catch (err) {
    console.error("[reading] beacon failed", err);
    return { accepted: false, kind, reason: "error" };
  }
}

/**
 * A page load. `visits` counts the arrivals that came from outside the site
 * (DECISIONS.md:90, Q6); `recirc` counts the ones that came from one of the
 * paper's own story pages ("Read another story"), and is only counted when the
 * class is `internal` -- a client cannot inflate recirculation by claiming a
 * same-site arrival on a search referral.
 */
async function recordLoad(
  body: Record<string, unknown>,
  newsroomId: number,
  context: BeaconContext,
): Promise<ReadBeaconOutcome> {
  const valid = await validateRow(body, newsroomId);
  if (typeof valid === "string") return { accepted: false, kind: "load", reason: valid };
  await ensureReadingSchema();
  const internal = valid.refClass === "internal";
  const fromArticle = internal && body.fromArticle === true;
  await insertLoad({
    newsroomId,
    path: valid.path,
    refClass: valid.refClass,
    device: valid.device,
    visits: internal ? 0 : 1,
    recirc: fromArticle ? 1 : 0,
  });
  noteLiveArrival(valid.refClass);
  /*
    The load also opens the reader's presence in the live window, so someone
    who has just landed shows up on the panel at once rather than up to
    fifteen seconds later. It costs one extra beat per load, which nudges the
    estimate up; the panel prints "updates every 15 seconds" and the
    "How it's counted" box says the number is estimated from heartbeats, not
    counted heads.
  */
  noteLiveBeat({ path: valid.path, seconds: 0, device: valid.device });
  /*
    The load is also where the two signals the owner's 2026-09-30 decision
    permits are counted -- a place, and a person only as a daily integer.

    Its own try/catch, deliberately: a location or visitor write that fails
    must not turn a load that already landed into a refusal, and must not stop
    the live panel above. This is the same rule every other refusal on this
    path keeps -- one counter's bad day is never another's.
  */
  try {
    await noteLoadExtras(newsroomId, context);
  } catch (err) {
    console.error("[reading] load extras failed", err);
  }
  return { accepted: true, kind: "load" };
}

/**
 * The location counter and the visitor count for one load, both keyed by the
 * database's `current_date` so they land on the same calendar `page_views.day`
 * is written on.
 *
 * THIS IS THE ONLY FUNCTION THAT SEES `context.ip`, and it does not keep it:
 * the address goes into `noteVisitor` as HMAC input and the only thing that
 * comes back is a yes/no, which becomes the integer in `visitor_daily`. It is
 * never a query parameter, never a log line, never returned to a caller.
 */
async function noteLoadExtras(newsroomId: number, context: BeaconContext): Promise<void> {
  const location = locationRowFor(context);
  if (location) {
    const sql = await getSql();
    await sql`
      insert into location_daily (newsroom_id, day, country, city, visits)
      values (${newsroomId}, current_date, ${location.country}, ${location.city}, 1)
      on conflict (newsroom_id, day, country, city) do update set
        visits = location_daily.visits + 1
    `;
  }

  // No address, no visitor count. A reader whose request carried neither
  // header is simply not counted -- never counted some other way.
  if (!context.ip) return;
  /*
    Checked and marked before the write, so two loads racing in the same
    process cannot both count the same reader. The cost is that a write which
    then fails leaves the reader marked as seen: the day under-counts by one,
    which is the direction an estimate under this rule should err.
  */
  if (!noteVisitor({ ip: context.ip, uaClass: context.uaClass })) return;
  const sql = await getSql();
  await sql`
    insert into visitor_daily (newsroom_id, day, visitors)
    values (${newsroomId}, current_date, 1)
    on conflict (newsroom_id, day) do update set visitors = visitor_daily.visitors + 1
  `;
}

/**
 * Time and depth. `seconds` is the time since this load's last report, not the
 * total, so the column stays a plain sum; `totalSeconds` is only used for the
 * under-ten-seconds rule, and only when the client says this is the last
 * report of the load (`final`) -- a reader still on the page has not left
 * without reading.
 */
async function recordReadTime(
  body: Record<string, unknown>,
  newsroomId: number,
): Promise<ReadBeaconOutcome> {
  const valid = await validateRow(body, newsroomId);
  if (typeof valid === "string") return { accepted: false, kind: "read", reason: valid };
  const seconds = clampReadSeconds(body.seconds);
  const total =
    typeof body.totalSeconds === "number" && Number.isFinite(body.totalSeconds)
      ? Math.max(0, Math.floor(body.totalSeconds))
      : null;
  const final = body.final === true;
  const leftEarly = final && total !== null && total < LEFT_WITHOUT_READING_SECONDS ? 1 : 0;
  const reported = Array.isArray(body.depth) ? body.depth.filter(isReadDepthBucket) : [];
  const depth = {
    "25": reported.includes(25) ? 1 : 0,
    "50": reported.includes(50) ? 1 : 0,
    "75": reported.includes(75) ? 1 : 0,
    "100": reported.includes(100) ? 1 : 0,
  } as Record<"25" | "50" | "75" | "100", number>;
  const empty = seconds === 0 && leftEarly === 0 && Object.values(depth).every((n) => n === 0);
  if (empty) return { accepted: true, kind: "read", reason: "nothing to add" };
  await ensureReadingSchema();
  await insertReadTime({
    newsroomId,
    path: valid.path,
    refClass: valid.refClass,
    device: valid.device,
    seconds,
    leftEarly,
    depth,
  });
  return { accepted: true, kind: "read" };
}

/**
 * A heartbeat. Deliberately the one kind that never opens the database: it
 * feeds the rolling window in src/lib/news/reading-live.ts and is gone with
 * the process. The path is only shape-checked, not looked up -- a beat is not
 * persisted, so a slug that is not published cannot mint anything.
 */
function recordBeat(body: Record<string, unknown>): ReadBeaconOutcome {
  const path = normalizeReadPath(body.path);
  if (!path) return { accepted: false, kind: "beat", reason: "path" };
  if (!isReadDevice(body.device)) return { accepted: false, kind: "beat", reason: "device" };
  noteLiveBeat({ path, seconds: clampReadSeconds(body.seconds), device: body.device });
  return { accepted: true, kind: "beat" };
}

/** One of the four controls a browser can report. */
async function recordTrust(
  body: Record<string, unknown>,
  newsroomId: number,
): Promise<ReadBeaconOutcome> {
  if (!isBeaconTrustEvent(body.event)) {
    return { accepted: false, kind: "trust", reason: "event" };
  }
  await recordTrustCount(body.event, newsroomId);
  return { accepted: true, kind: "trust" };
}

/**
 * The beacon endpoint's whole body, pulled out of src/routes/api/read.ts so a
 * test can call it directly with a plain `Request` -- the same shape as
 * `viewBeaconHandler` in views.ts.
 *
 * WHAT IT READS, AND WHAT IT STILL DOES NOT. It reads exactly five request
 * header names -- the allowlist in src/lib/news/stats-privacy.ts, which is what
 * `beaconContextFromHeaders` will ask for and nothing more -- and it reads the
 * body only through the 2 KB cap in src/lib/news/beacon-guard.server.ts, after
 * taking a token from the process's unkeyed bucket.
 *
 * The incoming `referer` and `cookie` are still never touched, and the referrer
 * is still classified in the browser (src/lib/news/reading.ts) so the server
 * never sees a URL. Of the five names, the user-agent is reduced to one of five
 * words and the address is HMAC input that is dropped immediately: neither is
 * stored, logged or exported (src/lib/news/stats-visitors.server.ts). Before
 * this unit the handler read no header at all; the owner's 2026-09-30 decision
 * permits the visitor and location signals those five names carry, and nothing
 * else about the request is read to get them.
 *
 * Always answers 204, whatever the body held, whatever the write did, and
 * whether or not the request got past the cap.
 */
export async function readBeaconHandler(request: Request): Promise<Response> {
  try {
    // The rate cap first: a request that never gets a token is never parsed and
    // never touches the database.
    if (!takeBeaconToken()) return new Response(null, { status: 204 });
    const body = await readBeaconJson(request);
    // Over the cap, unreadable, or not JSON: a refusal the validator would
    // reach anyway, answered the same way.
    if (body === undefined) return new Response(null, { status: 204 });
    /*
      `beaconPeerIsLoopback()` is the U17c gate on the two location headers: the
      request's transport peer must be loopback (where the Cloudflare tunnel
      daemon's requests come from) or `beaconContextFromHeaders` will not read
      `cf-ipcity` / `cf-ipcountry` at all. It is computed here and not inside
      the pure module because it needs the request event, which only exists in
      the server runtime.
    */
    await recordReadBeacon(
      body,
      DEFAULT_NEWSROOM_ID,
      beaconContextFromHeaders(request.headers, { locationTrusted: beaconPeerIsLoopback() }),
    );
  } catch {
    // A malformed body is just another report the validator refuses. This
    // endpoint never fails outward, for the same reason /api/view never does.
  }
  return new Response(null, { status: 204 });
}

/* ------------------------------------------------------------------ *
 * Reading back
 * ------------------------------------------------------------------ */

/** Days a range covers, counted including today. */
export function readingRangeDays(range: ReadingRange): number {
  switch (range) {
    case "today":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "12m":
      return 365;
  }
}

/** The interval text bound into the queries below. */
function sinceInterval(days: number): string {
  return `${days - 1} days`;
}

/** The same boundary, one full period back, for the prior-period comparison. */
function priorFromInterval(days: number): string {
  return `${2 * days - 1} days`;
}

export type ReadingKpis = {
  /** Arrivals from outside the site in the range (Q6). */
  visits: number;
  visitsPrior: number;
  /** Page loads from the paper's own daily counter (`page_views`, `site`). */
  pageLoads: number;
  pageLoadsPrior: number;
  /** Seconds of active reading per load, averaged. */
  avgSeconds: number;
  avgSecondsPrior: number;
  totalSeconds: number;
  totalSecondsPrior: number;
  /** Loads the beacon heard from in the range -- every ratio's denominator. */
  loads: number;
  loadsPrior: number;
  /** "Read another story": share of loads that arrived from our own stories. */
  recircShare: number;
  recircSharePrior: number;
  /** "Left without reading": share of loads whose active time was under 10s. */
  leftEarlyShare: number;
  leftEarlySharePrior: number;
};

export type ReadingDayBar = { day: string; label: string; visits: number; over: boolean };

export type ReadingStoryRow = {
  slug: string;
  headline: string;
  /** The story's section, named the way the paper names it where that is known. */
  section: string;
  /** Whole days since publication, 0 for today. The page prints "1 day". */
  ageDays: number;
  path: string;
  loads: number;
  avgSeconds: number;
  /** Reached-bucket shares for 25, 50, 75 and 100 percent, each 0..1. */
  depth: number[];
  /** Share of loads that reached the end -- the last depth bar, drawn yellow. */
  endShare: number;
  recircShare: number;
};

export type ReadingSourceRow = {
  refClass: ReadRefClass;
  label: string;
  visits: number;
  share: number;
};

export type ReadingSectionRow = { topic: string; label: string; seconds: number; share: number };

/**
 * One place the Stats page is allowed to print. `city` is a name, or the
 * UNKNOWN_CITY fold for a country that arrived with no usable city beside it;
 * `country` is beside it so the panel can say which one.
 */
export type ReadingLocationRow = {
  city: string;
  country: string;
  visits: number;
  /** Share of the located visits in the range -- the bar's width. */
  share: number;
};

/**
 * The daily visitor estimate. NOT a range sum: adding days together would
 * count one reader once per day and print the total as "visitors", which is
 * the one thing this number must never be read as. So the page shows single
 * days, and says beside them that they are estimates from memory that empty on
 * restart (src/lib/news/stats-visitors.server.ts).
 */
export type ReadingVisitors = { today: number; yesterday: number };

export type ReadingHeatCell = { dow: number; hour: number; visits: number };
export type ReadingHeatCellNamed = ReadingHeatCell & { when: string };

export type ReadingTrustRow = {
  event: TrustEvent;
  label: string;
  count: number;
  /** Count per day in the range, for the RSS row the drawing prints daily. */
  perDay: number;
  /**
   * Share of loads, for the two rows that are a choice a reader made about
   * this visit (dark mode, larger text). Null for the rows that are presses:
   * dividing a press count by loads would print a number that means nothing.
   */
  share: number | null;
};

export type ReadingStats = {
  range: ReadingRange;
  rangeLabel: string;
  days: number;
  kpis: ReadingKpis;
  /** The fixed thirty-day chart, oldest first -- drawn regardless of range. */
  daily: ReadingDayBar[];
  dailyMax: number;
  stories: ReadingStoryRow[];
  sources: ReadingSourceRow[];
  sections: ReadingSectionRow[];
  /**
   * Places with at least LOCATION_MIN_VISITS visits in the range, busiest
   * first. Everything under the threshold is summed into `otherVisits` instead
   * of being printed row by row: a place with one visit is a statement about
   * one reader, which is what the threshold exists to prevent.
   */
  locations: ReadingLocationRow[];
  otherVisits: number;
  visitors: ReadingVisitors;
  heatmap: {
    cells: ReadingHeatCell[];
    max: number;
    busiest: ReadingHeatCellNamed | null;
    quietest: ReadingHeatCellNamed | null;
    takeaway: string | null;
  };
  trust: ReadingTrustRow[];
  /** The in-memory window, so the first paint is not empty. */
  live: LiveSnapshot;
  /**
   * `/articles/slug` -> headline, for the "Reading right now" panel. The live
   * window holds paths and nothing else (see reading-live.ts), so a story being
   * read this minute is named by looking its slug up here rather than by
   * keeping a title on the reader's beat. Standing pages ("/", "/about") are
   * labelled in reading.ts and are not in this map.
   */
  pathLabels: Record<string, string>;
  /** True when nothing at all has been recorded for this range. */
  empty: boolean;
};

type TotalsRow = {
  loads: number | null;
  visits: number | null;
  recirc: number | null;
  left_early: number | null;
  active_seconds: number | null;
  depth_25: number | null;
  depth_50: number | null;
  depth_75: number | null;
  depth_100: number | null;
};

/*
  Written once and interpolated into two queries rather than repeated twenty
  times: the `Sql` shim (src/lib/db.ts) rebuilds a tagged template into
  `$1, $2, …` and has no fragment nesting, so each query has to carry its own
  boundary expressions. A shared column list is the safe half to share -- it
  binds no values.
*/
const TOTALS_COLUMNS = `
  coalesce(sum(loads), 0) as loads,
  coalesce(sum(visits), 0) as visits,
  coalesce(sum(recirc), 0) as recirc,
  coalesce(sum(left_early), 0) as left_early,
  coalesce(sum(active_seconds), 0) as active_seconds,
  coalesce(sum(depth_25), 0) as depth_25,
  coalesce(sum(depth_50), 0) as depth_50,
  coalesce(sum(depth_75), 0) as depth_75,
  coalesce(sum(depth_100), 0) as depth_100`;

function share(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(1, Math.max(0, part / whole));
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Aug 28" out of a 'YYYY-MM-DD' day, without a timezone in the way. */
function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date || month < 1 || month > 12) return day;
  return `${MONTH_LABELS[month - 1]} ${date}`;
}

/** "6 a.m." for the heatmap's takeaway; noon and midnight by name. */
function hourLabel(hour: number): string {
  if (hour === 0) return "12 a.m.";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} a.m.` : `${hour - 12} p.m.`;
}

/**
 * Editor-only aggregation for the Stats page. `requireEditor` is called
 * directly, the same shape as `getViewStats`, so a test can prove the refusal
 * without standing up the framework.
 *
 * Every range boundary is `date_trunc('day', now()) - <n> days` and every
 * calendar read (`current_date`, `extract(hour …)`) is in the database
 * session's timezone -- the same calendar the existing `page_views.day` column
 * is written on. On a paper whose server runs in one timezone, every screen
 * agrees; a server that moves timezone moves the day boundary with it, and the
 * page prints the range label rather than a claim about midnight.
 */
export async function getReadingStats(userId: string, range: ReadingRange): Promise<ReadingStats> {
  const editor = await requireEditor(userId);
  const newsroomId = editor.newsroomId;
  const days = readingRangeDays(range);
  await ensureReadingSchema();
  await ensureViewsSchema();
  const sql = await getSql();

  const [current] = await sql.query<TotalsRow>(
    `select ${TOTALS_COLUMNS} from read_hourly
     where newsroom_id = $1 and hour_start >= date_trunc('day', now()) - $2::interval`,
    [newsroomId, sinceInterval(days)],
  );
  const [prior] = await sql.query<TotalsRow>(
    `select ${TOTALS_COLUMNS} from read_hourly
     where newsroom_id = $1
       and hour_start >= date_trunc('day', now()) - $2::interval
       and hour_start < date_trunc('day', now()) - $3::interval`,
    [newsroomId, priorFromInterval(days), sinceInterval(days)],
  );

  /*
    Page loads come from the counter that has been running since 0.6.14
    (0037_page_views.sql), not from the beacon: the beacon starts the day this
    ships, the daily counter has the history, and "Page loads" is defined as
    every load the site counted -- refreshes included -- which is what that
    table holds. `site` counts the front page and every published story page:
    both send it.
  */
  const [siteLoads] = await sql.query<{ current: number | null; prior: number | null }>(
    `select
       coalesce(sum(count) filter (where day >= current_date - $2::int), 0) as current,
       coalesce(sum(count) filter (where day >= current_date - $3::int and day < current_date - $4::int), 0) as prior
     from page_views
     where newsroom_id = $1 and target = $5`,
    [newsroomId, days - 1, 2 * days - 1, days - 1, SITE_TARGET],
  );

  // The thirty-day chart is drawn whatever range is selected, as the drawing
  // has it -- the range filter changes the panels around it.
  const dailyRows = await sql.query<{ day: string; visits: number | null }>(
    `select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(pv.count), 0) as visits
     from generate_series(current_date - 29, current_date, interval '1 day') as d(day)
     left join page_views pv on pv.day = d.day and pv.newsroom_id = $1 and pv.target = $2
     group by d.day
     order by d.day asc`,
    [newsroomId, SITE_TARGET],
  );

  // Left join, not inner: a published story nobody has read yet is real
  // information on this page, not a row to hide -- the same choice views.ts's
  // story table makes. The range filter sits in the join condition so those
  // zero rows survive it.
  const storyRows = await sql.query<{
    slug: string;
    headline: string;
    topic: string;
    age_days: number | null;
    loads: number | null;
    active_seconds: number | null;
    recirc: number | null;
    depth_25: number | null;
    depth_50: number | null;
    depth_75: number | null;
    depth_100: number | null;
  }>(
    `select a.slug as slug, a.headline as headline, a.topic as topic,
       min(current_date - a.published_at::date)::int as age_days,
       coalesce(sum(r.loads), 0) as loads,
       coalesce(sum(r.active_seconds), 0) as active_seconds,
       coalesce(sum(r.recirc), 0) as recirc,
       coalesce(sum(r.depth_25), 0) as depth_25,
       coalesce(sum(r.depth_50), 0) as depth_50,
       coalesce(sum(r.depth_75), 0) as depth_75,
       coalesce(sum(r.depth_100), 0) as depth_100
     from articles a
     left join read_hourly r
       on r.newsroom_id = a.newsroom_id
       and r.path = '${ARTICLE_PATH_PREFIX}' || a.slug
       and r.hour_start >= date_trunc('day', now()) - $2::interval
     where a.newsroom_id = $1 and a.status = 'published'
     group by a.slug, a.headline, a.topic, a.published_at
     order by coalesce(sum(r.loads), 0) desc, a.published_at desc
     limit 12`,
    [newsroomId, sinceInterval(days)],
  );

  const sourceRows = await sql.query<{ ref_class: string; visits: number | null }>(
    `select ref_class, coalesce(sum(visits), 0) as visits from read_hourly
     where newsroom_id = $1 and hour_start >= date_trunc('day', now()) - $2::interval
     group by ref_class`,
    [newsroomId, sinceInterval(days)],
  );

  const sectionRows = await sql.query<{ topic: string; seconds: number | null }>(
    `select a.topic as topic, coalesce(sum(r.active_seconds), 0) as seconds
     from articles a
     join read_hourly r
       on r.newsroom_id = a.newsroom_id
       and r.path = '${ARTICLE_PATH_PREFIX}' || a.slug
       and r.hour_start >= date_trunc('day', now()) - $2::interval
     where a.newsroom_id = $1 and a.status = 'published'
     group by a.topic
     order by seconds desc`,
    [newsroomId, sinceInterval(days)],
  );

  const heatRows = await sql.query<{ dow: number; hour: number; visits: number | null }>(
    `select extract(dow from hour_start)::int as dow,
            extract(hour from hour_start)::int as hour,
            coalesce(sum(visits), 0) as visits
     from read_hourly
     where newsroom_id = $1 and hour_start >= date_trunc('day', now()) - $2::interval
     group by 1, 2`,
    [newsroomId, sinceInterval(days)],
  );

  const trustRows = await sql.query<{ event: string; count: number | null }>(
    `select event, coalesce(sum(count), 0) as count from trust_signals_hourly
     where newsroom_id = $1 and hour_start >= date_trunc('day', now()) - $2::interval
     group by event`,
    [newsroomId, sinceInterval(days)],
  );

  // A captured version opened is a load of /evidence (the reader page for
  // every version and for the compare view); "How we reported this" is
  // /how-we-report. Both are page loads, which is the honest measure -- a
  // click that opened a panel is not distinguishable from a paste of the link,
  // and both are someone reading the paper's receipts.
  const standingRows = await sql.query<{ path: string; loads: number | null }>(
    `select path, coalesce(sum(loads), 0) as loads from read_hourly
     where newsroom_id = $1 and path in ($2, $3)
       and hour_start >= date_trunc('day', now()) - $4::interval
     group by path`,
    [newsroomId, EVIDENCE_PATH, "/how-we-report", sinceInterval(days)],
  );

  /*
    Where readers are, and how many were counted today.

    Both read the tables migrations/0109_stats_location.sql adds, and both are
    DAY-bucketed: `day >= current_date - <days-1>` is the same calendar
    page_views uses, so the range filter means here what it means everywhere
    else on this page. `location_daily` is empty on an installation that is not
    behind Cloudflare, or whose zone does not emit the visitor-location
    headers, and that is not a failure -- the panel says so instead of drawing
    an empty chart it cannot fill.
  */
  const locationRows = await sql.query<{ country: string; city: string; visits: number | null }>(
    `select country, city, coalesce(sum(visits), 0) as visits from location_daily
     where newsroom_id = $1 and day >= current_date - $2::int
     group by country, city
     order by visits desc, city asc`,
    [newsroomId, days - 1],
  );

  const [visitorRow] = await sql.query<{ today: number | null; yesterday: number | null }>(
    `select
       coalesce(sum(visitors) filter (where day = current_date), 0) as today,
       coalesce(sum(visitors) filter (where day = current_date - 1), 0) as yesterday
     from visitor_daily
     where newsroom_id = $1`,
    [newsroomId],
  );

  /*
    `corrections` (migrations/0002_newsroom.sql) has no newsroom_id of its own,
    so a reader-filed correction is attributed through the story it belongs to.
    That means a correction whose story has since been deleted is not counted
    here; the panel's note says "counted on the story they correct" rather than
    pretending the number is every correction ever filed. The try/catch is the
    same defensive shape views.ts uses for audit_events: a database that has
    never run the newsroom migration answers zero instead of failing the page.
  */
  const [ownLoads, priorLoads] = [
    Number(current?.loads ?? 0),
    Number(prior?.loads ?? 0),
  ];
  const activeSeconds = Number(current?.active_seconds ?? 0);
  const priorActiveSeconds = Number(prior?.active_seconds ?? 0);
  let correctionCount = 0;
  try {
    const [row] = await sql.query<{ total: number | null }>(
      `select count(*)::int as total from corrections corr
       join articles a on a.id = corr.article_id
       where a.newsroom_id = $1 and corr.created_at >= date_trunc('day', now()) - $2::interval`,
      [newsroomId, sinceInterval(days)],
    );
    correctionCount = Number(row?.total ?? 0);
  } catch {
    correctionCount = 0;
  }

  const daily: ReadingDayBar[] = dailyRows.map((row) => ({
    day: row.day,
    label: dayLabel(row.day),
    visits: Number(row.visits ?? 0),
    over: Number(row.visits ?? 0) > 1000,
  }));
  const dailyMax = daily.reduce((max, row) => Math.max(max, row.visits), 0);

  const sourceVisits = new Map<string, number>();
  for (const row of sourceRows) sourceVisits.set(row.ref_class, Number(row.visits ?? 0));
  const sourceTotal = [...sourceVisits.values()].reduce((sum, n) => sum + n, 0);
  const sources: ReadingSourceRow[] = READ_REF_CLASSES.filter(
    (refClass) => refClass !== "internal" && (sourceVisits.get(refClass) ?? 0) > 0,
  )
    .map((refClass) => ({
      refClass,
      label: READ_REF_CLASS_LABELS[refClass],
      visits: sourceVisits.get(refClass) ?? 0,
      share: share(sourceVisits.get(refClass) ?? 0, sourceTotal),
    }))
    .sort((a, b) => b.visits - a.visits || a.refClass.localeCompare(b.refClass));

  /*
    The threshold is applied here, on the server, and not in the page: a place
    under it must not reach the browser at all. Everything below it is summed
    into one "Other places" figure, so the panel still accounts for every
    located visit without naming a place that only one reader was in.

    TWO KINDS OF ROW ARE NOT A PLACE, and both go to "Other places" whatever
    their size:

      - a row under LOCATION_MIN_VISITS, which is what the threshold has always
        meant, and which is all that is left of a day still in progress (the
        hourly fold only touches days that have finished);
      - a row whose city is FOLDED_CITY, the sum of a finished day's small
        places. It can easily be OVER the threshold -- a hundred towns with two
        readers each -- and drawing it would print a bar with no name on it, or
        worse, invite someone to name it. It is a fold, not a place, so it is
        never drawn as one.
  */
  const located = locationRows.map((row) => ({
    city: row.city,
    country: row.country,
    visits: Number(row.visits ?? 0),
  }));
  const locatedTotal = located.reduce((sum, row) => sum + row.visits, 0);
  const drawsAsAPlace = (row: { city: string; visits: number }) =>
    row.city !== FOLDED_CITY && row.visits >= LOCATION_MIN_VISITS;
  const locations: ReadingLocationRow[] = located
    .filter(drawsAsAPlace)
    .map((row) => ({ ...row, share: share(row.visits, locatedTotal) }));
  const otherVisits = located
    .filter((row) => !drawsAsAPlace(row))
    .reduce((sum, row) => sum + row.visits, 0);
  const visitors: ReadingVisitors = {
    today: Number(visitorRow?.today ?? 0),
    yesterday: Number(visitorRow?.yesterday ?? 0),
  };

  const sectionSeconds = sectionRows.map((row) => ({
    topic: row.topic,
    seconds: Number(row.seconds ?? 0),
  }));
  const sectionTotal = sectionSeconds.reduce((sum, row) => sum + row.seconds, 0);
  const sectionNames = await sectionNameMap(newsroomId);
  const sections: ReadingSectionRow[] = sectionSeconds
    .filter((row) => row.seconds > 0)
    .map((row) => ({
      topic: row.topic,
      label: sectionNames.get(row.topic) ?? row.topic,
      seconds: row.seconds,
      share: share(row.seconds, sectionTotal),
    }));

  const heatCells: ReadingHeatCell[] = heatRows
    .map((row) => ({ dow: row.dow, hour: row.hour, visits: Number(row.visits ?? 0) }))
    .filter((cell) => cell.dow >= 0 && cell.dow <= 6 && cell.hour >= 0 && cell.hour <= 23);
  const heatMax = heatCells.reduce((max, cell) => Math.max(max, cell.visits), 0);
  const named = (cell: ReadingHeatCell): ReadingHeatCellNamed => ({
    ...cell,
    when: `${DAY_LABELS[cell.dow]} ${hourLabel(cell.hour)}`,
  });
  const busiest = heatCells.reduce<ReadingHeatCell | null>(
    (best, cell) => (best === null || cell.visits > best.visits ? cell : best),
    null,
  );
  const quietest = heatCells.reduce<ReadingHeatCell | null>(
    (best, cell) => (best === null || cell.visits < best.visits ? cell : best),
    null,
  );
  const hasHeat = heatCells.some((cell) => cell.visits > 0);

  /*
    "THE busiest hour" is only true when one hour stands alone at the top.

    Both ends of the week are full of ties at small numbers -- five evening
    hours on the same day, or any hour at all in a week with little traffic --
    and a tie resolved by taking the first row the database returned would print
    a fact about the query's ordering as if it were a fact about the town. So
    an extreme is named only when it is single. A tie at the quiet end costs
    nothing and is simply not mentioned; a tie at the top is the whole sentence,
    because then there is no busiest hour to give.
  */
  const atTop = busiest ? heatCells.filter((cell) => cell.visits === busiest.visits).length : 0;
  const atBottom = quietest
    ? heatCells.filter((cell) => cell.visits === quietest.visits).length
    : 0;

  const trustCounts = new Map<string, number>();
  for (const row of trustRows) trustCounts.set(row.event, Number(row.count ?? 0));
  const standingLoads = new Map<string, number>();
  for (const row of standingRows) standingLoads.set(row.path, Number(row.loads ?? 0));
  const trust: ReadingTrustRow[] = TRUST_EVENTS.map((event) => {
    const count =
      event === "captured-version-opened"
        ? (standingLoads.get(EVIDENCE_PATH) ?? 0)
        : event === "how-we-reported-reached"
          ? (standingLoads.get("/how-we-report") ?? 0)
          : event === "correction-filed"
            ? correctionCount
            : (trustCounts.get(event) ?? 0);
    const isChoice = event === "dark-mode-chosen" || event === "larger-text-chosen";
    return {
      event,
      label: TRUST_EVENT_LABELS[event],
      count,
      perDay: days > 0 ? Math.round(count / days) : count,
      share: isChoice ? share(count, ownLoads) : null,
    };
  });

  const visited = Number(current?.visits ?? 0);
  const recirc = Number(current?.recirc ?? 0);
  const leftEarly = Number(current?.left_early ?? 0);
  const priorVisited = Number(prior?.visits ?? 0);
  const priorRecirc = Number(prior?.recirc ?? 0);
  const priorLeftEarly = Number(prior?.left_early ?? 0);
  const priorSiteLoads = Number(siteLoads?.prior ?? 0);

  return {
    range,
    rangeLabel: READING_RANGE_LABELS[range],
    days,
    kpis: {
      visits: visited,
      visitsPrior: priorVisited,
      pageLoads: Number(siteLoads?.current ?? 0),
      pageLoadsPrior: priorSiteLoads,
      avgSeconds: ownLoads > 0 ? Math.round(activeSeconds / ownLoads) : 0,
      avgSecondsPrior: priorLoads > 0 ? Math.round(priorActiveSeconds / priorLoads) : 0,
      totalSeconds: activeSeconds,
      totalSecondsPrior: priorActiveSeconds,
      loads: ownLoads,
      loadsPrior: priorLoads,
      recircShare: share(recirc, ownLoads),
      recircSharePrior: share(priorRecirc, priorLoads),
      // Clamped inside `share`: a `read` report whose `load` never arrived can
      // push this past 1 for one hour, and a percentage over 100 would be a lie
      // in the other direction.
      leftEarlyShare: share(leftEarly, ownLoads),
      leftEarlySharePrior: share(priorLeftEarly, priorLoads),
    },
    daily,
    dailyMax,
    stories: storyRows.map((row) => {
      const storyLoads = Number(row.loads ?? 0);
      const depth = [row.depth_25, row.depth_50, row.depth_75, row.depth_100].map((value) =>
        share(Number(value ?? 0), storyLoads),
      );
      return {
        slug: row.slug,
        headline: row.headline,
        section: sectionNames.get(row.topic) ?? row.topic,
        ageDays: Math.max(0, Number(row.age_days ?? 0)),
        path: `${ARTICLE_PATH_PREFIX}${row.slug}`,
        loads: storyLoads,
        avgSeconds: storyLoads > 0 ? Math.round(Number(row.active_seconds ?? 0) / storyLoads) : 0,
        depth,
        endShare: depth[3] ?? 0,
        recircShare: share(Number(row.recirc ?? 0), storyLoads),
      };
    }),
    sources,
    sections,
    locations,
    otherVisits,
    visitors,
    heatmap: {
      cells: heatCells,
      max: heatMax,
      busiest: hasHeat && busiest ? named(busiest) : null,
      quietest: hasHeat && quietest ? named(quietest) : null,
      takeaway:
        !hasHeat || !busiest
          ? null
          : atTop > 1
            ? `${atTop} hours are level at the top of this range; none is the busiest.`
            : quietest && atBottom === 1
              ? `${named(busiest).when} is the busiest hour, ${named(quietest).when} the quietest.`
              : `${named(busiest).when} is the busiest hour.`,
    },
    trust,
    live: liveSnapshot(),
    pathLabels: await articlePathLabels(newsroomId),
    empty: ownLoads === 0 && Number(siteLoads?.current ?? 0) === 0,
  };
}

/**
 * Recent published slugs -> headlines, for naming the pages in the live panel.
 * Bounded and newest-first: a story being read right now is overwhelmingly a
 * story published recently, and the panel falls back to the slug for anything
 * older rather than loading an entire archive's titles into every stats page.
 */
async function articlePathLabels(newsroomId: number): Promise<Record<string, string>> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ slug: string; headline: string }>(
      `select slug, headline from articles
       where newsroom_id = $1 and status = 'published'
       order by published_at desc
       limit 200`,
      [newsroomId],
    );
    const labels: Record<string, string> = {};
    for (const row of rows) labels[`${ARTICLE_PATH_PREFIX}${row.slug}`] = row.headline;
    return labels;
  } catch {
    // The panel prints the path instead. Nothing on this page depends on it.
    return {};
  }
}

/** The paper's own section names, or an empty map if they cannot be read. */
async function sectionNameMap(newsroomId: number): Promise<Map<string, string>> {
  try {
    const { getSections } = await import("./sections.server.ts");
    const config = await getSections(newsroomId);
    return new Map(config.sections.map((section) => [section.key, section.name]));
  } catch {
    // A stats page is not the place to fail over section names: the topic key
    // is printed instead, which is what the story was filed under.
    return new Map();
  }
}

export type ReadingCsv = { fileName: string; csv: string };

/** RFC-4180 quoting: only cells that need it get quotes. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS = [
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
] as const;

/**
 * The rows behind the page, as plain CSV. Flat `read_hourly` rows for the
 * selected range and nothing derived -- an editor who wants to argue with a
 * number on the page can do the arithmetic themselves. `hour_start` is printed
 * in the database session's timezone (`to_char`, the same calendar the heatmap
 * and the day boundary use), to the hour.
 *
 * Deliberately not a route: the client asks for the text over the desk's
 * authenticated server function and saves it with an object URL, so there is
 * one download path instead of two and no new unauthenticated URL that returns
 * a paper's traffic.
 */
export async function exportReadingCsv(userId: string, range: ReadingRange): Promise<ReadingCsv> {
  const editor = await requireEditor(userId);
  const newsroomId = editor.newsroomId;
  await ensureReadingSchema();
  const sql = await getSql();
  const days = readingRangeDays(range);
  const rows = await sql.query<Record<string, string | number | null>>(
    `select to_char(hour_start, 'YYYY-MM-DD HH24:00') as hour_start,
            path, ref_class, device, loads, visits, recirc, left_early, active_seconds,
            depth_25, depth_50, depth_75, depth_100
     from read_hourly
     where newsroom_id = $1 and hour_start >= date_trunc('day', now()) - $2::interval
     order by hour_start asc, path asc, ref_class asc, device asc`,
    [newsroomId, sinceInterval(days)],
  );
  const [todayRow] = await sql.query<{ today: string }>(
    `select to_char(current_date, 'YYYY-MM-DD') as today`,
  );
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column] ?? "")).join(","));
  }
  return {
    fileName: `stats-${range}-${todayRow?.today ?? "today"}.csv`,
    csv: `${lines.join("\n")}\n`,
  };
}

/* ------------------------------------------------------------------ *
 * Retention
 * ------------------------------------------------------------------ */

/**
 * How long a place is remembered. Twelve months, because twelve months is the
 * longest range the Stats screen offers (READING_RANGES in
 * src/lib/news/reading.ts) -- the table has to answer the question the page
 * draws, and no longer.
 *
 * This is the ONE retention period Stats has. `page_views`, `read_hourly`,
 * `trust_signals_hourly` and `visitor_daily` are counters with no personal
 * content and are kept indefinitely, exactly as they were before this unit;
 * nothing here deletes them, and the owner's decision of 2026-09-30 forbids
 * inventing a new period for them by inference.
 */
export const LOCATION_RETENTION_MONTHS = 12;

/**
 * Delete the places older than {@link LOCATION_RETENTION_MONTHS}. Idempotent,
 * and returns how many rows went, so the scheduler's log line and the test can
 * both see that it did something.
 *
 * `make_interval` rather than a literal `interval '12 months'` so the period is
 * the constant above and cannot drift from it. The comparison is against
 * `current_date`, the same calendar the rows were written on.
 */
export async function pruneLocationDaily(): Promise<number> {
  await ensureReadingSchema();
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    with removed as (
      delete from location_daily
      where day < current_date - make_interval(months => ${LOCATION_RETENTION_MONTHS}::int)
      returning 1
    )
    select count(*)::int as n from removed
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Fold a finished day's small places into that day's per-country "other" row
 * (unit U17c).
 *
 * WHY THIS EXISTS AT ALL. The 25-visit threshold used to live only on the
 * screen. A row like `(today - 3, 'SmallTown', visits = 1)` therefore sat in
 * `location_daily` for twelve months, went out in every `pg_dump`, and -- read
 * beside `read_hourly` for the same day -- is one reader's visit, recorded as a
 * named place. The display threshold stopped that reaching an editor's screen;
 * it did not stop it existing. This is the same rule applied where the data
 * actually rests, which is what the owner's decision is about.
 *
 * WHAT IT DOES. For every row on a FINISHED day (`day < current_date` -- the
 * same calendar the rows were written on, so the paper's own local day) whose
 * `visits` is under {@link LOCATION_MIN_VISITS}, it adds the visits to that
 * day's `(newsroom, country, city = FOLDED_CITY)` row and deletes the small
 * row. One statement, so one transaction: the sum and the delete cannot come
 * apart, and an interrupted run leaves the table exactly as it was.
 *
 * TODAY IS LEFT ALONE. A day still in progress has not finished arriving, so
 * folding it would move visits that are about to be joined by more; its small
 * places stay as places until the day closes, and the screen folds them for
 * display exactly as it always did. So the threshold is enforced at rest with
 * one day's lag, and on screen immediately.
 *
 * IDEMPOTENT BY CONSTRUCTION. The folded row itself has `city = FOLDED_CITY`
 * and is excluded by `city <> FOLDED_CITY`, so it can never fold into itself
 * and a second run in the same hour finds nothing to do. Returns how many rows
 * were folded, for the tick's log line and the test.
 *
 * A COUNTRIES' WORTH OF SMALL PLACES CAN EXCEED THE THRESHOLD, which is fine
 * and deliberate: the folded row is never drawn as a place
 * (src/lib/news/reading.server.ts's `drawsAsAPlace`), so its size does not
 * matter. What matters is that no single-reader place survives.
 */
export async function foldSmallPlaces(): Promise<number> {
  await ensureReadingSchema();
  const sql = await getSql();
  const rows = await sql<{ folded: number }>`
    with folded_rows as (
      delete from location_daily
      where day < current_date
        and visits < ${LOCATION_MIN_VISITS}::bigint
        and city <> ${FOLDED_CITY}
      returning newsroom_id, day, country, visits
    ),
    per_country as (
      select newsroom_id, day, country, sum(visits)::bigint as visits
      from folded_rows
      group by newsroom_id, day, country
    ),
    written as (
      insert into location_daily (newsroom_id, day, country, city, visits)
      select newsroom_id, day, country, ${FOLDED_CITY}, visits from per_country
      on conflict (newsroom_id, day, country, city) do update set
        visits = location_daily.visits + excluded.visits
      returning 1
    )
    select (select count(*)::int from folded_rows) as folded
  `;
  return Number(rows[0]?.folded ?? 0);
}
