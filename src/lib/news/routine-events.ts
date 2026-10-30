import { HOME_AREA, type StoryArea } from "../story-area.ts";
import type { RoutineField } from "./routine-notice-types.ts";

/** One stored event row. A story collapses rows with the same `matchKey`. */
export type RoutineEventRow = {
  id: number;
  newsroomId: number;
  sourceId: number;
  eventKey: string;
  candidateKey: string;
  matchKey: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  localDate: string;
  startMinutes: number | null;
  allDay: boolean;
  place: string;
  town: string;
  area: StoryArea;
  sourceUrl: string;
  link: string | null;
  sourceIssuer: string;
  sourceTitle: string;
  fields: Record<string, RoutineField>;
};

export type CollapsedRoutineEvent = {
  matchKey: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  localDate: string;
  startMinutes: number | null;
  allDay: boolean;
  place: string;
  town: string;
  area: StoryArea;
  link: string | null;
  candidateKey: string;
  eventKey: string;
  sourceId: number;
  sourceUrl: string;
  sourceIssuer: string;
  sourceTitle: string;
  fields: Record<string, RoutineField>;
  sourceUrls: string[];
  rows: RoutineEventRow[];
};

export type EventWindow = { start: string; end: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

/** Decode the entities a calendar can reasonably put in a title or place. */
export function decodeEventText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Lowercase, decode entities, remove punctuation, and collapse whitespace. */
export function normalizeEventText(value: string | null | undefined): string {
  return decodeEventText(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A source locality names its town before the state: "Longmont, Colorado" -> "Longmont". */
export function localityTown(locality: string): string {
  return locality.split(",", 1)[0]!.trim();
}

/** The same event on two sites has one match key. Empty places match only empty places. */
export function eventMatchKey(event: {
  title: string;
  localDate: string;
  startMinutes: number | null;
  allDay: boolean;
  place?: string | null;
}): string {
  const time = event.allDay ? "all-day" : event.startMinutes === null ? "no-time" : String(event.startMinutes);
  return [
    normalizeEventText(event.title),
    event.localDate,
    time,
    normalizeEventText(event.place),
  ].join("|");
}

function townPattern(pattern: string) {
  return new RegExp(pattern, "iu");
}

/**
 * The venue wins over the source's town, but only when it names a town this
 * newsroom already knows. An unknown venue town falls back to the source town.
 */
export function eventTown(place: string, sourceTown: string, knownTowns: readonly string[]): string {
  const source = sourceTown.trim();
  const towns = [...new Set(knownTowns.map((town) => town.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const text = decodeEventText(place);
  let best: { town: string; at: number } | null = null;
  for (const town of towns) {
    const escaped = town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const afterTown = `(?=$|[^\\p{L}\\p{N}])`;
    const beforeTown = `(?:^|[^\\p{L}\\p{N}])`;
    const patterns = [
      townPattern(`,\\s*${escaped}${afterTown}`),
      townPattern(`${beforeTown}${escaped}\\s*,\\s*CO(?![\\p{L}\\p{N}])`),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match && (!best || match.index < best.at)) best = { town, at: match.index };
    }
  }
  if (best) return best.town;
  const canonical = towns.find((town) => normalizeEventText(town) === normalizeEventText(source));
  return canonical ?? source;
}

/** Home when the town is the paper's city; otherwise Nearby. No city keeps today's home behavior. */
export function eventArea(town: string, paperCity: string): StoryArea {
  const city = localityTown(paperCity);
  if (!city) return HOME_AREA;
  return localityTown(town).toLowerCase() === city.toLowerCase() ? HOME_AREA : "nearby";
}

function organizerNames(row: RoutineEventRow): string[] {
  return [row.sourceIssuer, row.sourceTitle]
    .map(normalizeEventText)
    .filter((value) => value.length > 0);
}

/** One organizer match wins; none or several fall back to the lowest source id. */
export function pickShownRow(rows: readonly RoutineEventRow[]): RoutineEventRow | null {
  if (!rows.length) return null;
  const lowest = [...rows].sort(
    (a, b) => a.sourceId - b.sourceId || a.id - b.id || a.eventKey.localeCompare(b.eventKey),
  )[0]!;
  const place = normalizeEventText(lowest.place);
  if (!place) return lowest;
  const matches = rows.filter((row) =>
    organizerNames(row).some((name) => name.includes(place) || place.includes(name)),
  );
  return matches.length === 1 ? matches[0]! : lowest;
}

function sourceOrder(a: RoutineEventRow, b: RoutineEventRow) {
  return a.sourceId - b.sourceId || a.id - b.id || a.eventKey.localeCompare(b.eventKey);
}

/** One line per match key, with every source URL retained. */
export function collapseEvents(rows: readonly RoutineEventRow[]): CollapsedRoutineEvent[] {
  const grouped = new Map<string, RoutineEventRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.matchKey);
    if (group) group.push(row);
    else grouped.set(row.matchKey, [row]);
  }
  const collapsed: CollapsedRoutineEvent[] = [];
  for (const [matchKey, group] of grouped) {
    const ordered = [...group].sort(sourceOrder);
    const shown = pickShownRow(ordered)!;
    const sourceUrls = [...new Set(
      [shown.sourceUrl, ...ordered.map((row) => row.sourceUrl)].filter(Boolean),
    )];
    collapsed.push({
      matchKey,
      title: shown.title,
      startsAt: shown.startsAt,
      endsAt: shown.endsAt,
      localDate: shown.localDate,
      startMinutes: shown.startMinutes,
      allDay: shown.allDay,
      place: shown.place,
      town: shown.town,
      area: shown.area,
      link: shown.link,
      candidateKey: shown.candidateKey,
      eventKey: shown.eventKey,
      sourceId: shown.sourceId,
      sourceUrl: shown.sourceUrl,
      sourceIssuer: shown.sourceIssuer,
      sourceTitle: shown.sourceTitle,
      fields: shown.fields,
      sourceUrls,
      rows: ordered,
    });
  }
  return collapsed.sort(
    (a, b) =>
      a.localDate.localeCompare(b.localDate) ||
      (a.startMinutes ?? -1) - (b.startMinutes ?? -1) ||
      a.title.localeCompare(b.title) ||
      a.place.localeCompare(b.place) ||
      a.matchKey.localeCompare(b.matchKey),
  );
}

export function eventSeenKey(row: Pick<RoutineEventRow, "eventKey" | "localDate">): string {
  return `${row.eventKey}\u0000${row.localDate}`;
}

/** A full read removes only its own unseen rows inside the read window. */
export function rowsToRemove(
  existingRows: readonly RoutineEventRow[],
  seenKeys: Iterable<string>,
  window: EventWindow,
  fullRead: boolean,
): RoutineEventRow[] {
  if (!fullRead) return [];
  const seen = new Set(seenKeys);
  return existingRows.filter(
    (row) =>
      row.localDate >= window.start &&
      row.localDate <= window.end &&
      !seen.has(eventSeenKey(row)),
  );
}
