export const PAPER = {
  name: "TownReporter",
  city: "Longmont",
  state: "Colorado",
  location: "Longmont, Colorado",
  timezone: "America/Denver",
  tagline: "The public record is only the beginning.",
  kicker: "Independent civic reporting  ·  Longmont",
  deck: "TownReporter follows Longmont's meetings, money, contracts and public records — then keeps digging when something changes, disappears or doesn't add up. Non-profit. Human-edited. Sources shown.",
  trust: "Civic news, non-profit, human-edited.",
} as const;

/**
 * How a reader reaches the editor, if the operator has said.
 *
 * The Corrections page told readers to "write the editor from the About page".
 * The About page carried no address, no form, and no contact of any kind, so
 * the paper's own accountability promise ended at a wall. An audit found it
 * beside a second one: the paper promises "Sources shown" and a story had
 * none. Both are the same failure -- a claim printed with nothing behind it.
 *
 * Deliberately not hard-coded. This is self-hosted software; the address
 * belongs to whoever runs the paper, and shipping one in the source would put
 * a stranger's inbox on every fork. While it is unset, nothing anywhere
 * claims a way to write in -- an honest silence beats a dead pointer.
 */
/*
  Read at BUILD time, not at run time.

  This page renders in the browser, where process.env does not exist, so a
  server variable would have been silently null on every screen that shows it.
  A self-hoster builds their own copy of the paper, so Vite inlining the value
  is both simplest and correct: set VITE_TOWNREPORTER_EDITOR_EMAIL in .env
  before npm run build.
*/
export const EDITOR_EMAIL: string | null =
  (import.meta.env?.VITE_TOWNREPORTER_EDITOR_EMAIL ?? "").trim() || null;

export const TOPICS = [
  "council",
  "budget",
  "housing",
  "utilities",
  "schools",
  "planning",
  "infrastructure",
  "elections",
  /*
    Opinion is deliberately absent from every model prompt.

    The scanner and the reporting pass each enumerate the topics they may
    assign, and this is not among them: an opinion piece is a human writing in
    their own voice, and a machine that could file one would be doing the one
    thing this paper does not do. It exists here so the section, the filter and
    the chip work.
  */
  "opinion",
  "about",
] as const;

/**
 * Where the council's own vote record lives.
 *
 * An outside site, linked rather than absorbed: it is somebody else's work and
 * the paper should send readers to it, not quietly reproduce it.
 */
export const COUNCIL_VOTES_URL = "https://longmontcitycouncil.org/";

export type Topic = (typeof TOPICS)[number];

export const SEED_SOURCES: {
  url: string;
  title: string;
  kind: "official" | "news" | "youtube";
  tier: "A" | "B";
}[] = [
  {
    url: "https://www.longmontcolorado.gov/",
    title: "City of Longmont",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.longmontcolorado.gov/government/city-council",
    title: "Longmont City Council",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://longmontcolorado.gov/city-clerk/",
    title: "Longmont City Clerk (agendas, minutes, videos)",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://longmont.primegov.com/public/portal",
    title: "Longmont PrimeGov (agendas, packets, minutes)",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.longmontcolorado.gov/departments/departments-n-z/planning-and-development-services",
    title: "Planning and Development",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://mynextlight.com/",
    title: "NextLight",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.svvsd.org/",
    title: "St. Vrain Valley Schools",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://bouldercounty.gov/",
    title: "Boulder County",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.longmontcolorado.gov/community/library",
    title: "Longmont Public Library",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.youtube.com/@CityofLongmont",
    title: "City of Longmont on YouTube",
    kind: "youtube",
    tier: "A",
  },
  {
    url: "https://www.youtube.com/@LongmontPublicMedia",
    title: "Longmont Public Media on YouTube",
    kind: "youtube",
    tier: "A",
  },
];

export function slugify(input: string) {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 72)
    // Trim AFTER the length cut: cutting at 72 can land mid-separator and
    // leave a trailing dash, which then shows up in the public URL.
    .replace(/^-+|-+$/g, "");
  /*
    Drop a final fragment of a word.

    The cut lands wherever 72 characters land, so a headline ending "...match a
    $42.5 million offer. Their public fundraiser..." produced a URL ending
    `-offer-t`. Readers see these addresses — in the browser bar, in a shared
    link, read aloud — and a severed word reads as a broken link. Only a short
    tail is dropped: a two- or three-letter last word is usually a real word
    ("a", "no", "tax"), and losing it would be the worse edit.
  */
  const cut = s.replace(/-[a-z0-9]{1,3}$/, "");
  return (s.length === 72 && cut ? cut : s) || "item";
}

export function parseUrlList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function asDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? null : d;
}

/*
  CITY-SETUP slice C1: an optional `timeZone` param, defaulting to
  PAPER.timezone.

  These three helpers are imported by client components (paper-chrome.tsx,
  provenance.tsx, article/route files) that this module must stay safe for --
  no server/db import here, ever (see the file-top note). The configured
  timezone lives in request-scoped React context (`PaperIdentity.timezone` in
  paper-context.tsx), not in this module, so the caller -- which already has
  that context via usePaperIdentity() -- is the right place to supply it. A
  caller that passes nothing renders exactly what it renders today, which is
  the "no settings row" no-behaviour-change requirement.
*/
export function formatDate(iso: string | Date | null | undefined, timeZone: string = PAPER.timezone) {
  const d = asDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

export function formatShortDate(iso: string | Date | null | undefined, timeZone: string = PAPER.timezone) {
  const d = asDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

export function formatDateTime(iso: string | Date | null | undefined, timeZone: string = PAPER.timezone) {
  const d = asDate(iso);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function formatAge(iso: string | Date | null | undefined) {
  const d = asDate(iso);
  if (!d) return "";
  const h = Math.max(0, Math.round((Date.now() - d.getTime()) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  return `${days}d`;
}

/**
 * The origin readers actually see, for links that must survive leaving the page:
 * canonical URLs, Open Graph tags, the feed.
 *
 * Falls back to the relative form when nothing is configured (local dev), which
 * is correct: a canonical or an `og:url` pointing at `localhost` is worse than
 * none at all, because a crawler that reads it will follow it nowhere.
 */
export function siteUrl(path = "/"): string {
  const configured = (
    process.env.PUBLIC_SITE_URL ||
    process.env.BETTER_AUTH_URL ||
    ""
  ).trim();
  if (!configured) return path;
  try {
    return new URL(path, configured).toString();
  } catch {
    return path;
  }
}

/**
 * The town's subreddit, read as a tip line.
 *
 * Not a source in the watch-list sense: nothing from here is ever cited. It is
 * where a road closure, a rent increase or a notice taped to a door shows up
 * days before any record does, and every item it produces is a question for a
 * reporter, not an answer.
 */
export const TIP_SUBREDDIT = "longmont";

/**
 * Searches run against the subreddit, alongside its newest posts.
 *
 * Kept short on purpose: each one is a request against a rate limit shared by
 * everything on this machine, so the list is the few angles that actually turn
 * up records rather than conversation.
 */
export const TIP_SUBREDDIT_QUERIES = [
  "city council OR ordinance OR public hearing",
  "closure OR construction OR detour",
] as const;
