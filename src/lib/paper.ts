export const PAPER = {
  name: "TownReporter",
  city: "Longmont",
  state: "Colorado",
  location: "Longmont, Colorado",
  tagline: "Civic news, human-edited.",
  kicker: "Vol. 1  ·  Longmont edition",
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
    url: "https://www.longmontcolorado.gov/government/agendas-minutes-and-videos",
    title: "Agendas, minutes, and videos",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.longmontcolorado.gov/government/departments/planning-and-development-services",
    title: "Planning and Development",
    kind: "official",
    tier: "A",
  },
  {
    url: "https://www.nextlight.net/",
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
];

export function slugify(input: string) {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
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

export function formatDate(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(iso: string | Date | null | undefined) {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
