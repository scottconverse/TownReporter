/*
  The reader-privacy vocabulary of the Stats beacons (unit U17b, owner decision
  2026-09-30).

  WHAT THIS FILE IS. The one place that says which request headers the reading
  beacon's server half may look at, how a Cloudflare location header is turned
  into something worth counting, and how a user-agent is reduced to a class
  before it is ever used as input to anything.

  WHY IT IS SHARED AND PURE. The Stats screen imports LOCATION_MIN_READERS and
  LOCATION_OTHER_LABEL to draw its panel and its note, so this module is
  reachable from the client bundle: it therefore has no `node:` import, no
  database and no state. The stateful half -- the daily salt and the handle set
  -- is in src/lib/news/stats-visitors.server.ts, which is server-only.

  THE RULE THIS FILE SERVES. The owner's decision of 2026-09-30 permits
  location and visitor-level signals and forbids storing or logging anything
  that identifies a person. So:

    - The header allowlist below is EXACTLY the set of names any beacon handler
      may read, and src/lib/news/reading.server.test.ts pins it by handing the
      handler a `Headers` that records every `get()`. Latitude, longitude,
      region, postal code and timezone are deliberately absent from the list
      even though Cloudflare can send all five: a latitude and a longitude
      beside a small town single out a household, which is the exact failure
      the rule names.
    - A location is COARSE (a city name or a country code) and is validated by
      rejection, never by sanitising and keeping. The failure-path table in the
      acceptance spec is explicit: a malformed or over-long value stores
      nothing at all.
    - The user-agent is never stored, never logged and never compared to
      anything: it is reduced to one of five words and used only as HMAC input.
*/

/**
 * The only header names a beacon handler may read. `beaconContextFromHeaders`
 * is the only function that touches a `Headers` at all, and it reads no name
 * outside this list.
 *
 * `cf-ipcity` and `cf-ipcountry` are Cloudflare's own visitor-location headers.
 * They are set at the edge only when the zone has the "Add visitor location
 * headers" Managed Transform enabled, and they do not exist at all on an
 * installation that is not behind Cloudflare -- see the module docstring in
 * src/lib/news/reading.server.ts for what the panel does then.
 */
export const BEACON_HEADER_ALLOWLIST = [
  "cf-ipcity",
  "cf-ipcountry",
  "cf-connecting-ip",
  "x-forwarded-for",
  "user-agent",
] as const;

export const CITY_HEADER = "cf-ipcity";
export const COUNTRY_HEADER = "cf-ipcountry";
/**
 * In precedence order, the same two names Better Auth is configured with
 * (src/lib/auth/server.ts). Cloudflare's own header wins; the forwarded chain
 * is the fallback for a non-tunnel deployment.
 */
export const IP_HEADERS = ["cf-connecting-ip", "x-forwarded-for"] as const;
export const USER_AGENT_HEADER = "user-agent";

/**
 * How many READERS a place needs, on one day, before the Stats page prints it
 * as its own row. Below it the readers are folded into "Other places".
 *
 * THE UNIT IS A READER, NOT A PAGE LOAD (unit U23). The server counts a place
 * once per reader per day, so this number and the "visitors" figure beside it
 * are the same kind of quantity -- see `noteLoadExtras` in
 * src/lib/news/reading.server.ts. It used to be fed by page loads, which let
 * one reader reload their way over it.
 *
 * THE GRAIN IS ONE DAY, NOT THE SELECTED RANGE. A row of `location_daily` is
 * one (day, place), so the threshold is applied to a day: a place is named only
 * on the days it had this many readers, the total shown for it is those days
 * only, and its smaller days count under "Other places" like any other. Ten
 * readers a day for a week is 70 in the range and still not a place, because
 * the fold at rest moves each day's ten out of the named rows as the day ends.
 *
 * The number is a privacy threshold, not a display preference: a city row with
 * a count of 1 is a statement about one person, and a small paper's
 * neighbouring towns produce exactly that. 25 is the value the owner's
 * acceptance decision fixed; changing it changes what the page may print.
 */
export const LOCATION_MIN_READERS = 25;

/** The row that stands in for every place under {@link LOCATION_MIN_READERS}. */
export const LOCATION_OTHER_LABEL = "Other places";

/**
 * The `city` value of a folded row: the sum of a finished day's places that
 * were under {@link LOCATION_MIN_READERS}, one row per country (unit U17c).
 *
 * It is the empty string and not a word like "other", on purpose. A word could
 * be sent in `cf-ipcity` and counted as a place; the empty string cannot --
 * {@link normalizeCity} refuses it -- so the only way a `''` row can exist is
 * the fold itself, and no request can ever mint one or add to one directly.
 */
export const FOLDED_CITY = "";

/**
 * True when a value is the loopback interface: `127.0.0.0/8` in any of its
 * spellings, or `::1`. Everything else, including an IPv6-mapped
 * `::ffff:127.0.0.1`, is decided on its IPv4 part.
 *
 * This is the gate on the location headers (unit U17c). `cf-ipcity` and
 * `cf-ipcountry` are Cloudflare's own headers, and Cloudflare sets them at its
 * edge; nothing stops a client from putting the same names on a request that
 * went straight to this server, so the headers are believed only when the
 * request came from the tunnel daemon, which connects over loopback
 * (SELF-HOSTING.md: the tunnel dials out from this box and reaches the server
 * on 127.0.0.1). An absent or unparseable address is NOT loopback: the gate
 * fails closed, so a stack path that cannot report the peer simply has no
 * location rather than a forgeable one.
 */
export function isLoopbackAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let address = value.trim().toLowerCase();
  if (!address) return false;
  // A zone index (`fe80::1%eth0`) is never loopback, and an IPv6-mapped
  // address (`::ffff:127.0.0.1`) is the IPv4 one wearing a hat.
  if (address.includes("%")) return false;
  if (address.startsWith("::ffff:")) address = address.slice("::ffff:".length);
  if (address === "::1") return true;
  const parts = address.split(".");
  // Only the dotted-quad form is decided here. Any other IPv6 literal -- `::1`
  // aside -- is not loopback for this purpose.
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === "127";
}

/**
 * One request header, or null -- and the ONLY way any code on this path may
 * read one.
 *
 * The allowlist is enforced here at runtime rather than trusted to reviewers:
 * a name that is not in {@link BEACON_HEADER_ALLOWLIST} is refused before the
 * `Headers` object is touched at all, so a future caller cannot leak a
 * latitude by asking one question through the wrong door. The test and the
 * code share the same list, which is the point -- there is no second copy of
 * the five names to drift.
 */
export function allowedHeader(headers: Headers, name: string): string | null {
  if (!(BEACON_HEADER_ALLOWLIST as readonly string[]).includes(name)) return null;
  return headers.get(name);
}

/**
 * A city name is capped well below any real one (the longest in the United
 * States is 38 characters) so a hostile or broken header cannot write a novel
 * into a column an editor reads.
 */
export const CITY_MAX_LENGTH = 64;

/** Cloudflare's placeholder for "we could not tell", and its Tor exit marker. */
const NOT_A_PLACE = new Set(["XX", "T1"]);

/**
 * A city the panel folds countries into when a country arrived without a
 * usable city beside it. Lowercase on purpose, so it cannot collide with a
 * real name and is recognisable in the table.
 */
export const UNKNOWN_CITY = "unknown";

/**
 * True when a value carries a C0 control (0x00-0x1F) or DEL (0x7F). Written as
 * a code-point walk rather than a character-class regex on purpose: a literal
 * control character inside a regex is invisible in a diff and survives a bad
 * copy-paste, and this file is the one that must not carry one.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/*
  Letters, marks and the punctuation that occurs in real place names (Saint-
  Denis, O'Fallon, Winston-Salem, Washington (D.C.), St. John's). The first
  character must be a letter or a mark, so a header that is only digits or only
  punctuation is refused rather than counted as a place.
*/
const CITY_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’()/-]*$/u;

/**
 * ISO-3166 alpha-2, uppercased; `XX` (Cloudflare's unknown) and `T1` (Tor) are
 * refused rather than counted, because neither is a place a reader is in.
 * Returns null for anything else -- there is no "best effort" branch.
 */
export function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return null;
  if (NOT_A_PLACE.has(value)) return null;
  return value;
}

/**
 * A city name, or null. Null means NOTHING IS STORED -- this is a validator,
 * not a cleaner, so a value it cannot vouch for is dropped rather than tidied
 * and kept.
 *
 * Rejected: a non-string, an empty or whitespace-only value, anything carrying
 * a control character, anything longer than {@link CITY_MAX_LENGTH} after its
 * whitespace is collapsed, and anything that is not shaped like a place name
 * (a run of digits, a URL, a JSON blob, a base64 string).
 */
export function normalizeCity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (hasControlCharacter(raw)) return null;
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value || value.length > CITY_MAX_LENGTH) return null;
  if (!CITY_SHAPE.test(value)) return null;
  return value;
}

/**
 * A plausible client address, or null. Loose on purpose -- the value is never
 * stored, never logged and never compared, it is only HMAC input, so the check
 * exists to bound what is fed to the digest, not to be an IP parser. `node:net`
 * is unavailable here (this module is client-reachable), which is the other
 * reason it is a shape check.
 */
function plausibleIp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length < 3 || value.length > 45) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return null;
  if (!/\d/.test(value)) return null;
  if (!value.includes(".") && !value.includes(":")) return null;
  return value;
}

/**
 * The client address, from Cloudflare's header first and the forwarded chain
 * second (the first entry, which is the client; everything after it is a
 * proxy). Returns null when neither is present or plausible -- and a null
 * address means the visitor is simply not counted, never counted some other
 * way.
 *
 * BOTH HEADERS ARE FORGEABLE, so `fromTunnel` gates them exactly as it gates
 * the location pair (unit U17d). `cf-connecting-ip` and `x-forwarded-for` are
 * ordinary request headers: a client that connects straight to this server can
 * put any value it likes in either one, and a caller that varied it per request
 * would mint a fresh visitor handle every time and inflate the day's count
 * without limit. Cloudflare and the tunnel daemon set these on requests that
 * arrive over loopback, and nothing else does -- the same fact the location
 * gate rests on, so it is the same flag. Off the tunnel: no address is read,
 * `noteVisitor` is never called, and no visitor is counted.
 */
export function visitorClientIp(headers: Headers, fromTunnel: boolean): string | null {
  if (!fromTunnel) return null;
  for (const name of IP_HEADERS) {
    const raw = allowedHeader(headers, name);
    if (raw === null) continue;
    if (name === "x-forwarded-for") {
      for (const part of raw.split(",")) {
        const ip = plausibleIp(part);
        if (ip) return ip;
      }
      continue;
    }
    const ip = plausibleIp(raw);
    if (ip) return ip;
  }
  return null;
}

export const VISITOR_UA_CLASSES = ["phone", "tablet", "computer", "bot", "other"] as const;
export type VisitorUaClass = (typeof VISITOR_UA_CLASSES)[number];

/*
  Deliberately crude substring tests, in this order. The class is not a
  measurement -- it exists so the digest has a coarser input than the raw
  string, which is the point: a full user-agent is close to a fingerprint, and
  a handful of words is not. A phone that lies is simply a different word.
*/
const BOT_MARKERS = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "curl/",
  "wget",
  "headless",
  "python-requests",
  "facebookexternalhit",
  "monitor",
];
const TABLET_MARKERS = ["ipad", "tablet", "kindle", "silk/", "playbook"];
const PHONE_MARKERS = ["mobi", "iphone", "ipod", "android", "windows phone", "blackberry"];

export function userAgentClass(raw: unknown): VisitorUaClass {
  if (typeof raw !== "string") return "other";
  const value = raw.trim().toLowerCase();
  if (!value) return "other";
  if (BOT_MARKERS.some((marker) => value.includes(marker))) return "bot";
  if (TABLET_MARKERS.some((marker) => value.includes(marker))) return "tablet";
  if (PHONE_MARKERS.some((marker) => value.includes(marker))) return "phone";
  return "computer";
}

/**
 * Everything a beacon handler is allowed to learn from a request, and nothing
 * else.
 *
 * `ip` is the one field that must never leave the write path: it is HMAC input
 * for the day's visitor count and is dropped immediately afterwards. It is
 * never stored, never logged and never exported -- the sentinel test in
 * src/lib/news/stats-privacy.test.ts proves that by grepping every stats table,
 * `audit_events` and the whole captured log for a known address.
 */
export type BeaconContext = {
  ip: string | null;
  uaClass: VisitorUaClass;
  country: string | null;
  city: string | null;
};

/** The context of a request that carried nothing usable. */
export const EMPTY_BEACON_CONTEXT: BeaconContext = {
  ip: null,
  uaClass: "other",
  country: null,
  city: null,
};

/**
 * Read the allowlisted headers and build the context. THIS IS THE ONLY PLACE
 * THAT TOUCHES A `Headers` OBJECT, every read goes through
 * {@link allowedHeader}, and the allowlist test fails if any name outside the
 * list is asked for.
 *
 * `fromTunnel` IS REQUIRED, and deliberately so. A caller has to state whether
 * the request came from the Cloudflare tunnel (see `beaconPeerIsLoopback`,
 * src/lib/news/beacon-peer.server.ts) before it can get a country, a city or a
 * client address back; there is no default to forget, and the safe answer is
 * the one a caller has to type. When it is false, three headers are not read at
 * all -- not read and discarded, NOT READ -- so a direct client's forged
 * `cf-ipcity` never enters this process's memory, and its forged
 * `cf-connecting-ip` cannot mint visitor handles. The user-agent is the one
 * header read either way: it is not an address, it cannot be varied to inflate
 * a count on its own (there is no address to hash with it), and it is only ever
 * reduced to a class word.
 *
 * The name says `fromTunnel` rather than `locationTrusted` because it now
 * decides more than the location: the visitor count depends on it too, and a
 * caller reading "location" in the name would not expect that.
 */
export function beaconContextFromHeaders(
  headers: Headers,
  options: { fromTunnel: boolean },
): BeaconContext {
  return {
    ip: visitorClientIp(headers, options.fromTunnel),
    uaClass: userAgentClass(allowedHeader(headers, USER_AGENT_HEADER)),
    country: options.fromTunnel ? normalizeCountry(allowedHeader(headers, COUNTRY_HEADER)) : null,
    city: options.fromTunnel ? normalizeCity(allowedHeader(headers, CITY_HEADER)) : null,
  };
}

/**
 * The stored row for a context: the country and city to count under, or null
 * when the request carried no usable location at all.
 *
 * A country with no city beside it is still a place worth counting, and lands
 * under {@link UNKNOWN_CITY}; a city with no country is not, because the panel
 * groups by city and a city alone cannot be placed. Neither header, and there
 * is no row.
 */
export function locationRowFor(
  context: Pick<BeaconContext, "country" | "city">,
): { country: string; city: string } | null {
  if (!context.country) return null;
  return { country: context.country, city: context.city ?? UNKNOWN_CITY };
}

/*
  ---------------------------------------------------------------------------
  The body cap and the rate cap
  ---------------------------------------------------------------------------
  Both beacons are public, unauthenticated and were neither capped nor limited
  (the finding is recorded against /api/view and /api/read in the acceptance
  spec section 1.10; the repo's own audit wording is at
  artifacts/audit-townreporter-2026-08-29/01-engineering-deepdive.md:792).
*/

/**
 * The largest beacon body worth reading. The biggest legitimate report is a
 * `read` carrying a path, three class words, two numbers and up to four depth
 * buckets -- a few hundred bytes; 2 KB is generous. A body over the cap is
 * refused before it is parsed, and the answer is still 204.
 */
export const BEACON_BODY_LIMIT_BYTES = 2048;

/**
 * The global write budget for the two beacons, as a token bucket. Deliberately
 * UNKEYED: a per-IP limiter would need an identifier to key on, which is the
 * per-person handle this whole design exists to avoid. A single bucket shared
 * by every caller still bounds what an anonymous flood can write, which is the
 * harm that matters -- a counter an editor reads cannot be inflated without
 * limit, and the tables cannot be grown without limit.
 *
 * Sized far above a small paper's real traffic: 20 writes a second sustained,
 * with a burst of 400.
 */
export const BEACON_RATE_PER_SECOND = 20;
export const BEACON_RATE_BURST = 400;
