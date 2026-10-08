import { fetchPublicHttp } from "./fetch-url.ts";
import { compiledDocumentUrl, preferredDocuments, type PrimeGovMeeting } from "./primegov.ts";
import type { VoteRecord } from "./meeting-story-section5.ts";

export type PrimeGovVoteRecord = VoteRecord & { item: string };
export type PrimeGovVoteDocuments = { minutes: PrimeGovVoteRecord[]; packet: PrimeGovVoteRecord[] };

function itemHeading(line: string): { item: string; title: string } | null {
  const named = line.match(/^\s*(?:agenda\s+)?item\s+(\d{1,2}[a-z]?)(?:\s*[:.)-]?\s+|$)(.*)$/i);
  if (named) return { item: named[1]!.toUpperCase(), title: named[2]!.trim() };
  const numbered = line.match(/^\s*(\d{1,2}[a-z]?)\s*[.)]\s+(.+)$/i);
  return numbered ? { item: numbered[1]!.toUpperCase(), title: numbered[2]!.trim() } : null;
}

function voteInParagraph(item: string, paragraph: string, source: "minutes" | "packet", locator: string): VoteRecord | null {
  const text = paragraph.replace(/\s+/g, " ").trim();
  if (!text || !/\b(?:motion|moved|seconded|vote|voted|approved|passed|failed|adopted|carried|denied)\b/i.test(text)) return null;
  // A motion can discuss ages, dates or page ranges. Only an adjacent vote
  // label establishes that a numeric range counts votes; skip other ranges.
  const voteLabel = String.raw`(?:ayes?\s*[/,]\s*nays?|yes\s*[/,]\s*no|in\s+favou?r\s*[/,]\s*opposed|vote|ayes?|nays?|yes|no|in\s+favou?r|opposed)`;
  const beforeVote = new RegExp(String.raw`\b${voteLabel}\s*(?:(?:of|was|by)\s+)?[:(]?\s*$`, "i");
  const afterVote = new RegExp(String.raw`^\s*[):,]?\s*${voteLabel}\b`, "i");
  const range = [...text.matchAll(/\b(\d{1,2})\s*(?:-|–|—|\bto\b)\s*(\d{1,2})\b/gi)]
    .find((match) => beforeVote.test(text.slice(0, match.index))
      || afterVote.test(text.slice(match.index + match[0].length)));
  const tallyMatch = range
    ?? text.match(/\b(\d{1,2})\s+(?:yes|ayes)\b.{0,40}?\b(\d{1,2})\s+(?:no|nays)\b/i);
  if (!tallyMatch || !item) return null;
  const result = /\b(?:failed|denied)\b/i.test(text)
    ? "Failed"
    : /\b(?:passed|approved|adopted|carried)\b/i.test(text) ? "Passed" : "recorded";
  return {
    motion: text,
    mover: text.match(/\b(?:motion by|moved by)\s+([^,.;]+)/i)?.[1]?.trim() ?? "",
    seconder: text.match(/\bseconded by\s+([^,.;]+)/i)?.[1]?.trim() ?? "",
    tally: `${Number(tallyMatch[1])}-${Number(tallyMatch[2])}`,
    result,
    source,
    locator,
  };
}

/** Read only vote counts written under a numbered agenda item and motion. */
export function parsePrimeGovVoteRecords(
  body: string,
  source: "minutes" | "packet",
  locator: string,
): PrimeGovVoteRecord[] {
  const records: PrimeGovVoteRecord[] = [];
  let item = "";
  let paragraph: string[] = [];
  const flush = () => {
    const vote = voteInParagraph(item, paragraph.join(" "), source, locator);
    if (vote) records.push({ item, ...vote });
    paragraph = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = itemHeading(line);
    if (heading) {
      flush();
      item = heading.item;
      if (heading.title) paragraph.push(heading.title);
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return records;
}

async function readVoteDocument(
  origin: string,
  document: PrimeGovMeeting["documentList"][number],
  source: "minutes" | "packet",
): Promise<PrimeGovVoteRecord[]> {
  const locator = new URL(compiledDocumentUrl(origin, document), origin).toString();
  try {
    const response = await fetchPublicHttp(new URL(locator));
    if (!response.ok) return [];
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 4_000_000) return [];
    const { extractText } = await import("unpdf");
    const extracted = await extractText(bytes, { mergePages: true });
    const body = String((extracted as { text?: unknown }).text ?? "");
    return parsePrimeGovVoteRecords(body, source, locator);
  } catch {
    return [];
  }
}

/** Read the meeting's official minutes and packet, when PrimeGov lists them. */
export async function primeGovVoteRecordsForMeeting(
  meeting: PrimeGovMeeting,
  origin: string,
): Promise<PrimeGovVoteDocuments> {
  const documents = preferredDocuments(meeting);
  const minutes = documents.find((document) => /\bminutes\b/i.test(document.templateName));
  const packet = documents.find((document) => /\bpacket\b/i.test(document.templateName));
  const [minuteRecords, packetRecords] = await Promise.all([
    minutes ? readVoteDocument(origin, minutes, "minutes") : Promise.resolve([]),
    packet ? readVoteDocument(origin, packet, "packet") : Promise.resolve([]),
  ]);
  return { minutes: minuteRecords, packet: packetRecords };
}
