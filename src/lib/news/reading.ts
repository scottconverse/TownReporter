/*
  Reading, counted in aggregate.

  WHAT THIS FILE IS. The vocabulary and the arithmetic of the redesign's
  reading beacon (docs/design/handoff-2026-09-26/README.md:370-411, "12.
  Stats"): which referrer classes exist, which device classes, which
  scroll-depth buckets, which of the paper's own controls are counted, and the
  pure functions that turn what a browser knows into one of those fixed words.

  WHY IT IS SHARED AND PURE. The beacon runs in the reader's browser
  (src/components/read-beacon.tsx) and the server validates what it sent
  (src/lib/news/reading.server.ts). If each side owned its own copy of the
  eight words, the two would drift and the server would start silently
  dropping classes the client still sends. So the vocabulary lives here, is
  imported by both, and has no database and no `node:` import -- anything this
  file pulled in would land in the reader's bundle.

  THE PRIVACY RULE THIS FILE SERVES (README.md:370-411, DECISIONS.md:90). No
  cookies, no localStorage, no sessionStorage, no IP, no fingerprint, no
  identifier that outlives the tab. Nothing here ever sees or returns one:

    - The referrer is reduced to a CLASS in the browser and the class is what
      is sent. The full referrer URL is never transmitted, because on a search
      result it carries the reader's query string -- which is exactly the kind
      of per-person fact this page must never hold.
    - Time is whole seconds and a bucket, never a timestamp of one reader's
      arrival.
    - A path is canonicalized to a short allowlist before it is sent, so a
      crafted path cannot mint an arbitrary row (the same rule `recordView`
      already enforces with `isCountableTarget`).
*/

/**
 * The eight arrival classes. These are the words the Stats page prints in
 * "Where visits come from" and "Arriving from, right now", so they are also
 * the only words the storage may contain.
 */
export const READ_REF_CLASSES = [
  "search",
  "share",
  "facebook",
  "reddit",
  "direct",
  "local",
  "rss",
  "internal",
] as const;

export type ReadRefClass = (typeof READ_REF_CLASSES)[number];

export function isReadRefClass(value: unknown): value is ReadRefClass {
  return typeof value === "string" && (READ_REF_CLASSES as readonly string[]).includes(value);
}

/** What the Stats page prints for each class, in the drawing's own words. */
export const READ_REF_CLASS_LABELS: Record<ReadRefClass, string> = {
  search: "Search",
  share: "Email, apps, texts",
  facebook: "Facebook",
  reddit: "Reddit",
  direct: "Direct",
  local: "Other local sites",
  rss: "RSS readers",
  internal: "Another page of this paper",
};

export const READ_DEVICES = ["phone", "tablet", "computer"] as const;
export type ReadDevice = (typeof READ_DEVICES)[number];

export function isReadDevice(value: unknown): value is ReadDevice {
  return typeof value === "string" && (READ_DEVICES as readonly string[]).includes(value);
}

export const READ_DEVICE_LABELS: Record<ReadDevice, string> = {
  phone: "Phone",
  tablet: "Tablet",
  computer: "Computer",
};

/**
 * Viewport widths. A device class is this and nothing else -- no user-agent is
 * read anywhere in this unit, on either side of the wire, so a phone that
 * claims to be a desktop is simply a narrow window.
 */
export const PHONE_MAX_WIDTH = 640;
export const TABLET_MAX_WIDTH = 1024;

export function deviceForWidth(width: number): ReadDevice {
  if (!Number.isFinite(width) || width <= 0) return "computer";
  if (width < PHONE_MAX_WIDTH) return "phone";
  if (width < TABLET_MAX_WIDTH) return "tablet";
  return "computer";
}

/** Scroll depth, in the four buckets the drawing's read-through bars use. */
export const READ_DEPTH_BUCKETS = [25, 50, 75, 100] as const;
export type ReadDepthBucket = (typeof READ_DEPTH_BUCKETS)[number];

export function isReadDepthBucket(value: unknown): value is ReadDepthBucket {
  return typeof value === "number" && (READ_DEPTH_BUCKETS as readonly number[]).includes(value);
}

/**
 * Which buckets a depth percentage has newly reached, given the ones already
 * reported for this page load.
 *
 * The client keeps `reported` in JavaScript memory only (it dies with the tab
 * and is never stored), so each bucket is sent to the server once per load and
 * the server's counter is a plain increment. Without this the server would
 * need to remember per-load state -- which is the per-reader key this design
 * exists to avoid.
 */
export function depthBucketsReached(
  percent: number,
  reported: readonly number[] = [],
): ReadDepthBucket[] {
  if (!Number.isFinite(percent)) return [];
  return READ_DEPTH_BUCKETS.filter(
    (bucket) => percent >= bucket && !reported.includes(bucket),
  );
}

/**
 * "Left without reading" -- README.md:370-411 fixes this at active time under
 * ten seconds.
 */
export const LEFT_WITHOUT_READING_SECONDS = 10;

/**
 * A ceiling on one page load's reported time. There is no correct value here
 * -- a reader can leave a tab open for hours -- but an unbounded number from a
 * public endpoint is a way to write nonsense into a table an editor reads, and
 * four hours is past the point where the reading is a person rather than a
 * forgotten tab. Everything above it is clamped, never dropped: the load still
 * counts, and its depth buckets still land.
 */
export const MAX_READ_SECONDS = 4 * 60 * 60;

export function clampReadSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_READ_SECONDS);
}

/** How often a visible page reports that it is still being read. */
export const BEAT_INTERVAL_MS = 15_000;
export const BEAT_INTERVAL_SECONDS = BEAT_INTERVAL_MS / 1000;

/**
 * "Active time" is time the page is on screen: seconds counted while
 * `document.visibilityState` is "visible", and nothing at all while the tab is
 * in the background. No timestamps are taken of one reader and no interaction
 * is watched, so a story left open on screen and a story being read look the
 * same from here -- which is the point. A forgotten tab is bounded by
 * MAX_READ_SECONDS rather than by guessing from the mouse.
 *
 * This is how long a visible page may hold unreported time before it sends
 * what it has anyway: a tab killed by the OS loses a minute of counting at
 * most, and nothing about the reader is kept in the meantime.
 */
export const QUIET_FLUSH_MS = 60_000;

/**
 * How long a page must stay hidden before the reader counts as gone. Switching
 * tabs for a moment and coming back is not leaving; a hidden tab that stays
 * hidden this long is reported as the end of the visit, which is what
 * "left without reading" is measured against (LEFT_WITHOUT_READING_SECONDS).
 */
export const HIDDEN_GONE_MS = 30_000;

/**
 * The paper's own controls, counted as presses -- never as people. These are
 * the eight rows in the drawing's "Trust signals" panel.
 */
export const TRUST_EVENTS = [
  "captured-version-opened",
  "source-link-followed",
  "how-we-reported-reached",
  "correction-filed",
  "credit-copied",
  "rss-fetch",
  "dark-mode-chosen",
  "larger-text-chosen",
] as const;

export type TrustEvent = (typeof TRUST_EVENTS)[number];

export function isTrustEvent(value: unknown): value is TrustEvent {
  return typeof value === "string" && (TRUST_EVENTS as readonly string[]).includes(value);
}

/**
 * The four that arrive on the beacon, i.e. the ones a browser reports. The
 * other four are counted where they actually happen and are listed here so the
 * vocabulary has one home:
 *
 *   - captured-version-opened, how-we-reported-reached: page loads of
 *     /evidence and /how-we-report (read_hourly), not clicks.
 *   - correction-filed: rows in the `corrections` table, written by the desk.
 *   - rss-fetch: counted server-side in src/routes/feed.ts.
 */
export const BEACON_TRUST_EVENTS = [
  "source-link-followed",
  "credit-copied",
  "dark-mode-chosen",
  "larger-text-chosen",
] as const;

export function isBeaconTrustEvent(value: unknown): value is (typeof BEACON_TRUST_EVENTS)[number] {
  return (
    typeof value === "string" && (BEACON_TRUST_EVENTS as readonly string[]).includes(value)
  );
}

export const TRUST_EVENT_LABELS: Record<TrustEvent, string> = {
  "captured-version-opened": "“View captured version” opened",
  "source-link-followed": "Source links followed",
  "how-we-reported-reached": "“How we reported this” reached",
  "correction-filed": "Corrections filed by readers",
  "credit-copied": "“Copy credit & link” used",
  "rss-fetch": "RSS feed fetches",
  "dark-mode-chosen": "Dark mode chosen",
  "larger-text-chosen": "Larger text chosen",
};

/**
 * Every path the reading beacon may report. Anything else is refused -- by the
 * browser before it sends, and again by the handler after it arrives -- so this
 * table can never be grown into an arbitrary per-page log by a crafted request.
 *
 * This is the same rule `isCountableTarget` applies to `page_views`, one level
 * finer: that one counts the whole site and individual stories, this one needs
 * the standing pages too, because "How we reported this" reached is a count of
 * loads of /how-we-report and a captured version opened is a count of loads
 * under /evidence.
 */
export const READ_STANDING_PATHS = [
  "/",
  "/about",
  "/corrections",
  "/get-the-code",
  "/how-we-report",
  "/evidence",
] as const;

export const ARTICLE_PATH_PREFIX = "/articles/";

/**
 * What the standing pages are called on the Stats page. The live window holds
 * paths only, and a reader looking at "Reading right now" should see "Front
 * page", not "/". A story's headline comes from the database instead -- it is
 * editor-written text and has no business in this module.
 */
export const READ_PATH_LABELS: Record<string, string> = {
  "/": "Front page",
  "/about": "About",
  "/corrections": "Corrections",
  "/get-the-code": "Get the code",
  "/how-we-report": "How we report",
  "/evidence": "Captured versions",
};

/** A path as a person would say it, for a path with no label of its own. */
export function readPathFallbackLabel(path: string): string {
  const slug = storySlugFromPath(path);
  if (slug) return slug.replaceAll("-", " ");
  return path;
}

/** The path /evidence/<versionId> and /evidence/compare both fold into. */
export const EVIDENCE_PATH = "/evidence";

/** A published story's slug, out of a canonical article path. */
export function storySlugFromPath(path: string): string | null {
  if (!path.startsWith(ARTICLE_PATH_PREFIX)) return null;
  const slug = path.slice(ARTICLE_PATH_PREFIX.length);
  if (!slug || slug.includes("/")) return null;
  return slug;
}

export function isArticlePath(path: string): boolean {
  return storySlugFromPath(path) !== null;
}

/**
 * Canonicalize a browser pathname into one of the allowed paths, or null.
 *
 * Query strings and fragments are dropped: a search page's `?q=` is a per
 * person fact and is never part of what is counted.
 */
export function normalizeReadPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (!path) return null;
  // A full URL is accepted too -- the beacon may be handed `location.href`.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
  try {
    path = withScheme ? new URL(path).pathname : path;
  } catch {
    return null;
  }
  path = path.split("#")[0]!.split("?")[0]!;
  if (!path.startsWith("/")) return null;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (path.startsWith(ARTICLE_PATH_PREFIX)) {
    const slug = storySlugFromPath(path);
    return slug ? `${ARTICLE_PATH_PREFIX}${slug}` : null;
  }
  if (path === EVIDENCE_PATH || path.startsWith(`${EVIDENCE_PATH}/`)) return EVIDENCE_PATH;
  return (READ_STANDING_PATHS as readonly string[]).includes(path) ? path : null;
}

/**
 * `www.` and the port are dropped, so `example.com:443` and `www.example.com`
 * compare equal. Returns "" for anything unparseable.
 */
export function hostnameOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matchesHost(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

const SEARCH_DOMAINS = [
  "bing.com",
  "duckduckgo.com",
  "brave.com",
  "search.brave.com",
  "ecosia.org",
  "startpage.com",
  "qwant.com",
  "mojeek.com",
  "yahoo.com",
  "baidu.com",
  "yandex.com",
  "yandex.ru",
  "perplexity.ai",
  "chatgpt.com",
  "openai.com",
  "copilot.microsoft.com",
  "gemini.google.com",
];

/**
 * Google is the one engine whose host is a country domain (google.de,
 * google.co.uk), so the list above cannot hold it.
 */
function isSearchHost(host: string): boolean {
  if (matchesHost(host, SEARCH_DOMAINS)) return true;
  return /^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

const FACEBOOK_DOMAINS = ["facebook.com", "fb.com", "fb.watch", "messenger.com"];
const REDDIT_DOMAINS = ["reddit.com", "redd.it"];

/**
 * Feed readers that send a referrer. This list is why the RSS row exists at
 * all, and it is incomplete by nature: a reader that sends no referrer at all
 * is indistinguishable from a bookmark, and lands in `share` (on a story) or
 * `direct` (on a standing page). That is stated on the page rather than
 * guessed at.
 */
const FEED_READER_DOMAINS = [
  "feedly.com",
  "newsblur.com",
  "inoreader.com",
  "theoldreader.com",
  "feedbin.com",
  "bazqux.com",
  "freshrss.org",
  "miniflux.app",
  "netnewswire.com",
  "reederapp.com",
  "feeder.co",
  "feeds.pub",
  "rssowl.org",
  "quiterss.org",
  "thunderbird.net",
];

export type ArrivalClassification = {
  refClass: ReadRefClass;
  /** True when the reader came from one of this paper's own story pages. */
  fromArticle: boolean;
};

/**
 * Turn what the browser knows into one of the eight classes.
 *
 * `rawReferrer` is `document.referrer` -- the full URL. It is read HERE and
 * only its class leaves this function; the caller sends `refClass` and drops
 * the URL. `selfHost` is the paper's own host, so a link from one of our pages
 * to another of our pages reads as `internal` rather than as `local`.
 *
 * The one judgement call: a browser sends NO referrer for a link opened from a
 * mail client, a text message, a native app, or a bookmark, and nothing on the
 * wire tells those apart. The brief files "no referrer from an app" under
 * email/apps/texts, so an empty referrer on a STORY is `share`; on a standing
 * page (the front page, /about) it is `direct`, because that is where a typed
 * address and a home-screen bookmark land. Both are printed as the drawing
 * labels them and both are explained on the page.
 */
export function classifyArrival(
  rawReferrer: unknown,
  rawSelfHost: unknown,
  path: string,
): ArrivalClassification {
  const selfHost = hostnameOf(rawSelfHost);
  const referrer = typeof rawReferrer === "string" ? rawReferrer.trim() : "";
  const host = hostnameOf(referrer);
  if (!host) {
    return { refClass: isArticlePath(path) ? "share" : "direct", fromArticle: false };
  }
  const fromArticle = isArticlePath(safePathname(referrer));
  if (selfHost && host === selfHost) return { refClass: "internal", fromArticle };
  if (isSearchHost(host)) return { refClass: "search", fromArticle: false };
  if (matchesHost(host, FACEBOOK_DOMAINS)) return { refClass: "facebook", fromArticle: false };
  if (matchesHost(host, REDDIT_DOMAINS)) return { refClass: "reddit", fromArticle: false };
  if (matchesHost(host, FEED_READER_DOMAINS)) return { refClass: "rss", fromArticle: false };
  return { refClass: "local", fromArticle: false };
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * The Stats header's range filter, in the drawing's own four words
 * (docs/design/handoff-2026-09-26/design/Desk Stats.dc.html, the row of
 * `ranges`). Shared because both sides need them: the page draws a button per
 * word, and the server turns the chosen one into a number of days and a label
 * to print back ("Last 7 days").
 */
export const READING_RANGES = ["today", "7d", "30d", "12m"] as const;
export type ReadingRange = (typeof READING_RANGES)[number];

export function isReadingRange(value: unknown): value is ReadingRange {
  return typeof value === "string" && (READING_RANGES as readonly string[]).includes(value);
}

export const READING_RANGE_LABELS: Record<ReadingRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "12m": "12 months",
};

/**
 * The heatmap's y axis, Monday first -- the order the drawing draws, not the
 * order `extract(dow …)` returns (0 is Sunday there).
 */
export const READ_DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const READ_DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "today" / "1 day" / "4 days" for a story's age, the way the drawing prints it. */
export function readAgeLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "today";
  return days === 1 ? "1 day" : `${Math.round(days)} days`;
}

/** "2:56" for a reading time, the way the drawing prints it. */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** "295 hrs" for a total. Under an hour it prints minutes instead. */
export function formatHours(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (safe < 3600) return `${Math.round(safe / 60)} min`;
  return `${Math.round(safe / 3600).toLocaleString()} hrs`;
}

/** "9,842" -- the drawing prints every count with a thousands separator. */
export function formatCount(value: number): string {
  return (Number.isFinite(value) ? Math.round(value) : 0).toLocaleString();
}
