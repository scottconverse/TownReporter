import { fetchPublicHttp } from "./fetch-url.ts";
import { compiledDocumentUrl, preferredDocuments, type PrimeGovDocument, type PrimeGovMeeting } from "./primegov.ts";
import type { PacketItem } from "./meeting-story-section5.ts";

const ITEM_LINE = /^\s*(\d{1,2})\.\s+([^\n]{3,120})$/gm;

/**
 * Extract real agenda items from a compiled agenda document. PrimeGov's
 * documentList only names documents ("Agenda", "Packet", "HTML Agenda"); the
 * item-level list lives inside the agenda PDF itself.
 */
export async function packetItemsFromAgendaText(text: string): Promise<PacketItem[]> {
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
  origin = "https://longmont.primegov.com",
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
