import { fetchPublicHttp } from "./fetch-url.ts";
import { compiledDocumentUrl, preferredDocuments, type PrimeGovDocument, type PrimeGovMeeting } from "./primegov.ts";
import type { PacketItem } from "./meeting-story-section5.ts";

const ITEM_LINE = /^\s*(\d{1,2})\.\s+([^\n]{3,120})$/gm;

/** "=== PAGE 2 ===" as the extraction dump prints it, and a bare "Page 2" footer. */
const PAGE_MARKER = /^=+\s*page\s+\d+\s*=+$/i;
const PAGE_FOOTER = /^page\s+\d+$/i;
/** Everything after this line is the appendix and staff reports, not the agenda. */
const APPENDIX = /^\s*appendix of informational items\s*$/i;
/** "6." / "5." / "6A." -- a top-level item, with an optional sub-item letter. */
const NUMBER_TOKEN = /^(\d{1,2})([A-Za-z]?)\s*[.)]\s*(.*)$/;
/** "A." / "B." -- a sub-item under the last top-level number. */
const LETTER_TOKEN = /^([A-Za-z])\s*[.)]\s*(.*)$/;

/**
 * A title line, or the start of the item's body prose?
 *
 * The packet prints an item as a bare number line ("3.") followed by one or
 * more title lines ("MOTIONS TO DIRECT THE CITY MANAGER TO ADD AGENDA ITEMS TO
 * FUTURE" / "AGENDAS"), then the body. A line is title-like when it is short
 * or when almost none of its words start lowercase -- an English sentence has
 * plenty of them. Parentheticals are stripped first so that "PUBLIC INVITED TO
 * BE HEARD (3 minute limitation per speaker)" is measured on its heading
 * alone. A dollar figure is never part of a title and is what separates
 * "10. ADJOURN" from the "City Council Contingency Fund: $91,569" line the
 * extraction prints directly under it.
 */
function isHeadingLine(line: string): boolean {
  if (/\$/.test(line)) return false;
  const stripped = line.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return true;
  const words = stripped.split(" ");
  if (words.length <= 3) return true;
  const lower = words.filter((word) => /^[a-z]/.test(word)).length;
  return lower / words.length < 0.5;
}

/** One line, with the extraction's run of spaces (plain or non-breaking) folded. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/**
 * Parse the agenda pages of a packet into the full item list.
 *
 * The real Sept. 29, 2026 Longmont packet (pages 1-2) is printed with the
 * number and the title on separate lines and with lettered sub-items under
 * items 5 and 6, and the extraction has no notion of a table: this returns
 * ids "1".."10" plus "5A", "6A" and "6B", with "6A" carrying the airport
 * noise-abatement title that the old one-line regex could not see at all (and
 * whose absence is why the writer filed the meeting's three unanimous votes
 * inside "1. MEETING CALLED TO ORDER").
 *
 * `dropLines` is how the caller removes a running header/footer -- a line
 * that repeats on more than one page (see `packetAgendaFromPages`) is not
 * part of any title.
 */
export function packetAgendaFromText(
  text: string,
  options: { dropLines?: ReadonlySet<string> } = {},
): PacketItem[] {
  const drop = options.dropLines ?? new Set<string>();
  const items: PacketItem[] = [];
  const seen = new Set<string>();
  let lastNumber = "";
  let current: { id: string; lines: string[] } | null = null;
  let locked = false;

  const flush = () => {
    if (!current) return;
    const title = current.lines.join(" ").replace(/\s+/g, " ").trim();
    if (title && !seen.has(current.id)) {
      seen.add(current.id);
      items.push({ itemNumber: current.id, title });
    }
    current = null;
    locked = false;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = normalizeLine(raw);
    if (!line) continue;
    if (PAGE_MARKER.test(line) || PAGE_FOOTER.test(line) || drop.has(line)) continue;
    if (APPENDIX.test(line)) break;

    const number = NUMBER_TOKEN.exec(line);
    if (number) {
      const id = `${number[1]}${(number[2] ?? "").toUpperCase()}`;
      // The appendix and the staff reports restart numbering at 1; a repeat
      // means the agenda itself has ended.
      if (seen.has(id)) break;
      flush();
      lastNumber = number[1]!;
      const rest = number[3]!.trim();
      current = { id, lines: rest ? [rest] : [] };
      continue;
    }
    if (!current || locked) continue;

    const letter = LETTER_TOKEN.exec(line);
    if (letter && lastNumber) {
      const id = `${lastNumber}${letter[1]!.toUpperCase()}`;
      if (seen.has(id)) break;
      flush();
      const rest = letter[2]!.trim();
      current = { id, lines: rest ? [rest] : [] };
      continue;
    }
    if (isHeadingLine(line)) current.lines.push(line);
    else locked = true;
  }
  flush();
  return items;
}

/**
 * The agenda from the packet's own pages. A line that repeats across pages is
 * a running header or footer ("City Council Study Session, September 29,
 * 2026") and is dropped before parsing, so it never lands in the last item's
 * title.
 */
export function packetAgendaFromPages(
  pages: ReadonlyArray<{ page: number; text: string }>,
): PacketItem[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const line of new Set(page.text.split(/\r?\n/).map(normalizeLine).filter(Boolean))) {
      // A footer is a sentence ("City Council Study Session, September 29,
      // 2026"); a bare "1." is an item number that the appendix restarts, so
      // short lines never count as repeats.
      if (line.split(" ").length < 3) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const dropLines = new Set([...counts].filter(([, count]) => count > 1).map(([line]) => line));
  return packetAgendaFromText(
    pages.map((page) => page.text).join("\n"),
    { dropLines },
  );
}

/**
 * Extract real agenda items from a compiled agenda document. PrimeGov's
 * documentList only names documents ("Agenda", "Packet", "HTML Agenda"); the
 * item-level list lives inside the agenda PDF itself.
 *
 * A number and a title on one line ("1. MEETING CALLED TO ORDER") is still
 * read; when the structured parse finds nothing at all, the old one-line scan
 * is the fallback rather than an empty list.
 */
export async function packetItemsFromAgendaText(text: string): Promise<PacketItem[]> {
  const parsed = packetAgendaFromText(text);
  if (parsed.length > 0) return parsed;

  const items: PacketItem[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  ITEM_LINE.lastIndex = 0;
  while ((m = ITEM_LINE.exec(text))) {
    const itemNumber = m[1]!;
    const title = m[2]!.replace(/\s+/g, " ").trim();
    if (!title || seen.has(itemNumber)) continue;
    seen.add(itemNumber);
    items.push({ itemNumber, title });
  }
  return items;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  return String((result as { text?: unknown }).text ?? "");
}

function agendaDocument(meeting: PrimeGovMeeting): PrimeGovDocument | null {
  const ranked = preferredDocuments(meeting);
  return ranked.find((d) => /\bagenda\b/i.test(d.templateName) && !/html/i.test(d.templateName)) ?? ranked[0] ?? null;
}

/**
 * Fetch the real item list for a meeting by downloading its compiled agenda
 * document and parsing the numbered items out of it. Returns [] when the agenda
 * cannot be fetched or parsed; callers must treat that as "no packet item list"
 * and must not invent items.
 */
export async function packetItemsForMeeting(
  meeting: PrimeGovMeeting,
  origin: string,
): Promise<PacketItem[]> {
  const doc = agendaDocument(meeting);
  if (!doc) return [];
  const url = compiledDocumentUrl(origin, doc);
  try {
    const res = await fetchPublicHttp(new URL(url));
    if (!res.ok) return [];
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = await extractPdfText(bytes);
    return await packetItemsFromAgendaText(text);
  } catch {
    return [];
  }
}
