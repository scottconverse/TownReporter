/*
  The reader-privacy vocabulary of the Stats beacons (unit U17b, owner decision
  2026-09-30).

  WHAT THIS FILE IS. The one place that says which request headers the reading
  beacon's server half may look at, how a Cloudflare location header is turned
  into something worth counting, and how a user-agent is reduced to a class
  before it is ever used as input to anything.

  WHY IT IS SHARED AND PURE. The Stats screen imports LOCATION_MIN_VISITS and
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
 * How many visits a place needs, in the selected range, before the Stats page
 * prints it as its own row. Below it the visits are folded into "Other
 * places".
 *
 * The number is a privacy threshold, not a display preference: a city row with
 * a count of 1 is a statement about one person, and a small paper's
 * neighbouring towns produce exactly that. 25 is the value the owner's
 * acceptance decision fixed; changing it changes what the page may print.
 */
export const LOCATION_MIN_VISITS = 25;

/** The row that stands in for every place under {@link LOCATION_MIN_VISITS}. */
export const LOCATION_OTHER_LABEL = "Other places";

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
 */
export function visitorClientIp(headers: Headers): string | null {
  for (const name of IP_HEADERS) {
    const raw = headers.get(name);
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
 * THAT TOUCHES A `Headers` OBJECT, and the allowlist test fails if any other
 * name is asked for.
 */
export function beaconContextFromHeaders(headers: Headers): BeaconContext {
  return {
    ip: visitorClientIp(headers),
    uaClass: userAgentClass(headers.get(USER_AGENT_HEADER)),
    country: normalizeCountry(headers.get(COUNTRY_HEADER)),
    city: normalizeCity(headers.get(CITY_HEADER)),
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
