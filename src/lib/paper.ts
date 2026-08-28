export const PAPER = {
  name: "TownReporter",
  city: "Longmont",
  state: "Colorado",
  location: "Longmont, Colorado",
  timezone: "America/Denver",
  tagline: "The public record is only the beginning.",
  kicker: "Independent civic reporting  ·  Longmont",
  deck: "TownReporter follows Longmont's meetings, money, contracts and public records — then keeps digging when something changes, disappears or doesn't add up. Human-edited. Sources shown.",
  trust: "Civic news, human-edited.",
} as const;

export const TOPICS = [
  "council",
  "budget",
  "housing",
  "utilities",
  "schools",
  "planning",
  "infrastructure",
  "elections",
  "about",
] as const;

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
  return s || "item";
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

export function formatDate(iso: string | Date | null | undefined) {
  const d = asDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: PAPER.timezone,
  });
}

export function formatShortDate(iso: string | Date | null | undefined) {
  const d = asDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PAPER.timezone,
  });
}

export function formatDateTime(iso: string | Date | null | undefined) {
  const d = asDate(iso);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PAPER.timezone,
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
