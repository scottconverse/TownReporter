import { fetchPublicHttp } from "./fetch-url.ts";

const PRIME_HOST = /(^|\.)primegov\.com$/i;

export function isPrimeGovUrl(url: URL): boolean {
  return PRIME_HOST.test(url.hostname.replace(/^www\./i, ""));
}

export type PrimeGovDocument = {
  id: number;
  templateId: number;
  compileOutputType: number;
  templateName: string;
  link: string | null;
  publishDate?: string | null;
};

export type PrimeGovMeeting = {
  id: number;
  title: string;
  date: string;
  dateTime: string;
  time: string;
  location: string;
  documentList: PrimeGovDocument[];
};

export function portalOrigin(url: URL): string {
  return `${url.protocol}//${url.hostname}`;
}

export function compiledDocumentUrl(origin: string, doc: PrimeGovDocument): string {
  if (doc.link) return doc.link;
  const param = `meetingTemplateId=${doc.templateId || doc.id}`;
  if (doc.compileOutputType === 3) {
    return `${origin}/Portal/Meeting?${param}`;
  }
  return `${origin}/Public/CompiledDocument?${param}&compileOutputType=${doc.compileOutputType || 1}`;
}

export function preferredDocuments(meeting: PrimeGovMeeting): PrimeGovDocument[] {
  const docs = meeting.documentList ?? [];
  const rank = (name: string) => {
    const n = name.toLowerCase();
    if (/\bminutes\b/.test(n)) return 0;
    if (/\bpacket\b/.test(n)) return 1;
    if (n === "agenda" || /\bagenda\b/.test(n) && !/html/.test(n)) return 2;
    if (/html agenda/.test(n)) return 4;
    return 3;
  };
  return [...docs].sort((a, b) => rank(a.templateName) - rank(b.templateName));
}

export function scoreMeetingMatch(videoTitle: string, meeting: PrimeGovMeeting): number {
  const v = norm(videoTitle);
  const m = norm(meeting.title);
  if (!v || !m) return 0;
  let score = 0;
  if (v === m) return 100;
  const vDate = dateFromTitle(videoTitle) ?? "";
  const mDate = dateFromTitle(`${meeting.date} ${meeting.dateTime}`) ?? dateFromTitle(meeting.date) ?? "";
  if (vDate && mDate && vDate === mDate) score += 40;
  const tokens = v.split(" ").filter((t) => t.length > 3 && !STOP.has(t));
  let hits = 0;
  for (const t of tokens) {
    if (m.includes(t)) hits += 1;
  }
  score += hits * 8;
  if (/206/.test(v) && /206/.test(m)) score += 30;
  if (/pharaoh|pharoah/.test(v) && /pharaoh|pharoah/.test(m)) score += 30;
  if (/council/.test(v) && /council/.test(m) && /regular/.test(v) && /regular/.test(m)) score += 20;
  return score;
}

const STOP = new Set(["meeting", "notice", "virtual", "street", "longmont", "city", "session", "with", "from"]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dateFromTitle(raw: string): string | null {
  const slash = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slash) {
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(Number(slash[1])).padStart(2, "0")}-${String(Number(slash[2])).padStart(2, "0")}`;
  }
  const named = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  if (named) {
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const key = named[1]!.slice(0, 3).toLowerCase();
    return `${named[3]}-${months[key]}-${String(Number(named[2])).padStart(2, "0")}`;
  }
  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export function bestMeetingMatch(
  videoTitle: string,
  meetings: PrimeGovMeeting[],
): PrimeGovMeeting | null {
  let best: PrimeGovMeeting | null = null;
  let score = 0;
  for (const m of meetings) {
    const s = scoreMeetingMatch(videoTitle, m);
    if (s > score) {
      score = s;
      best = m;
    }
  }
  return score >= 40 ? best : null;
}

function asMeeting(row: Record<string, unknown>): PrimeGovMeeting {
  const docs = Array.isArray(row.documentList) ? row.documentList : [];
  return {
    id: Number(row.id) || 0,
    title: String(row.title ?? "Untitled meeting"),
    date: String(row.date ?? ""),
    dateTime: String(row.dateTime ?? ""),
    time: String(row.time ?? ""),
    location: String(row.location ?? ""),
    documentList: docs.map((d) => {
      const doc = d as Record<string, unknown>;
      return {
        id: Number(doc.id) || 0,
        templateId: Number(doc.templateId) || 0,
        compileOutputType: Number(doc.compileOutputType) || 1,
        templateName: String(doc.templateName ?? "Document"),
        link: typeof doc.link === "string" ? doc.link : null,
        publishDate: typeof doc.publishDate === "string" ? doc.publishDate : null,
      };
    }),
  };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetchPublicHttp(new URL(url));
  if (!res.ok) throw new Error(`PrimeGov ${res.status}`);
  return res.json();
}

export async function fetchPrimeGovMeetings(origin: string): Promise<PrimeGovMeeting[]> {
  const year = new Date().getFullYear();
  const [upcoming, archived] = await Promise.all([
    getJson(`${origin}/api/v2/PublicPortal/ListUpcomingMeetings`).catch(() => []),
    getJson(`${origin}/api/v2/PublicPortal/ListArchivedMeetings?year=${year}`).catch(() => []),
  ]);
  const rows = [...(Array.isArray(upcoming) ? upcoming : []), ...(Array.isArray(archived) ? archived : [])];
  const seen = new Set<number>();
  const out: PrimeGovMeeting[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const m = asMeeting(row as Record<string, unknown>);
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function isRecent(meeting: PrimeGovMeeting, days = 45): boolean {
  const t = Date.parse(meeting.dateTime || meeting.date);
  if (!Number.isFinite(t)) return true;
  const delta = t - Date.now();
  return delta > -days * 86400000;
}

export function minutesGap(meeting: PrimeGovMeeting, now = new Date()): string | null {
  const names = (meeting.documentList ?? []).map((d) => d.templateName.toLowerCase());
  if (names.some((n) => n.includes("minutes"))) return null;
  if (/cancel|continued to date|tbd/i.test(meeting.title)) return null;
  const t = Date.parse(meeting.dateTime || meeting.date);
  if (!Number.isFinite(t)) return null;
  const hoursAfter = (now.getTime() - t) / 3600000;
  if (hoursAfter < 36) return null;
  if (!/council|commission|board|authority/i.test(meeting.title)) return null;
  return "minutes not posted";
}

export function catalogAndExtras(
  origin: string,
  meetings: PrimeGovMeeting[],
): { text: string; extras: string[] } {
  const windowed = meetings.filter((m) => isRecent(m)).sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
  const lines = [
    `PrimeGov portal ${origin}/public/portal`,
    `${meetings.length} meetings on file this year; showing ${windowed.length} from the last 45 days plus upcoming.`,
    "Packets and minutes are separate records (the CompiledDocument links). This catalog does not replace them.",
    "",
  ];
  const extras: string[] = [];
  const seen = new Set<string>();
  for (const m of windowed.slice(0, 40)) {
    const docs = preferredDocuments(m);
    const labels = docs.map((d) => d.templateName).join(", ") || "no documents yet";
    const gap = minutesGap(m);
    lines.push(`- ${m.date} ${m.time} ${m.title} [${labels}]${gap ? ` — ${gap}` : ""}`);
    for (const d of docs) {
      if (/html agenda/i.test(d.templateName)) continue;
      const href = compiledDocumentUrl(origin, d);
      if (seen.has(href)) continue;
      seen.add(href);
      if (extras.length < 8) extras.push(href);
      break;
    }
  }
  return { text: lines.join("\n"), extras };
}

export async function ingestPrimeGov(url: URL): Promise<{ text: string; title: string; extras: string[] } | null> {
  if (!isPrimeGovUrl(url)) return null;
  const origin = portalOrigin(url);
  if (/\/Public\/CompiledDocument/i.test(url.pathname) || /\/Portal\/Meeting/i.test(url.pathname)) {
    return null;
  }
  const meetings = await fetchPrimeGovMeetings(origin);
  const { text, extras } = catalogAndExtras(origin, meetings);
  return {
    text,
    title: "Longmont agendas, packets, and minutes (PrimeGov)",
    extras,
  };
}

export async function primeGovDocumentsForTitle(
  videoTitle: string,
  origin = "https://longmont.primegov.com",
): Promise<{ meeting: PrimeGovMeeting; urls: string[] } | null> {
  const meetings = await fetchPrimeGovMeetings(origin);
  const hit = bestMeetingMatch(videoTitle, meetings);
  if (!hit) return null;
  const urls: string[] = [];
  for (const d of preferredDocuments(hit)) {
    if (/html agenda/i.test(d.templateName)) continue;
    urls.push(compiledDocumentUrl(origin, d));
    if (urls.length >= 3) break;
  }
  return { meeting: hit, urls };
}
