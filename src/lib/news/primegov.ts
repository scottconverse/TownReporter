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
  publishDate?: string | null;
  dateTime: string;
  time: string;
  location: string;
  documentList: PrimeGovDocument[];
};

export function portalOrigin(url: URL): string {
  return `${url.protocol}//${url.hostname}`;
}

/**
 * The portal a newsroom watches, from its own watch-list source URLs: the first
 * accepted source whose host is a PrimeGov tenant.
 *
 * This used to be a constant (`https://longmont.primegov.com`) inside this
 * module, so a second city's meeting tape was matched against Longmont's
 * meetings. The portal comes from configuration now, and "no portal
 * configured" is a real answer: callers skip the lookup rather than query
 * somebody else's city.
 */
export function primeGovOriginFromSources(urls: readonly string[]): string | null {
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue; // a watch-list row that is not a link
    }
    if (isPrimeGovUrl(url)) return portalOrigin(url);
  }
  return null;
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

/**
 * The civic bodies a meeting title can name. Two tapes that agree on the date
 * but not on the body are two different meetings -- a city holds several on the
 * same night -- so agreeing on one of these is what makes a date mean anything.
 *
 * SINGLE WORDS, because that is what the match below compares: `norm` splits a
 * title into words and this set is intersected with both, so a two-word entry
 * could never match anything. A "study session" is therefore recognised by
 * `study`, a "work session" by `work` -- not by `session`, which on its own is
 * true of a study session and an executive session and would join two meetings
 * a council held the same night. `workshop` and `hearing` name their own kind
 * of meeting. (Missing these was why "Longmont Study Session 09/09/2026" and a
 * portal row titled "Study Session" stopped being joined: no body word agreed
 * and the titles are not identical.)
 */
const MEETING_BODIES = new Set([
  "council",
  "commission",
  "committee",
  "board",
  "trustees",
  "aldermen",
  "supervisors",
  "selectmen",
  "planning",
  "zoning",
  "school",
  "authority",
  "district",
  "study",
  "work",
  "workshop",
  "hearing",
]);

/** The body names both titles carry, in the body list's order. */
export function sharedBodyNames(videoTitle: string, meeting: PrimeGovMeeting): string[] {
  const v = new Set(norm(videoTitle).split(" "));
  const m = new Set(norm(meeting.title).split(" "));
  return [...MEETING_BODIES].filter((body) => v.has(body) && m.has(body));
}

/** The two dates agree, day for day. */
export function datesAgree(videoTitle: string, meeting: PrimeGovMeeting): boolean {
  const vDate = dateFromTitle(videoTitle);
  const mDate = dateFromTitle(`${meeting.date} ${meeting.dateTime}`) ?? dateFromTitle(meeting.date);
  return Boolean(vDate && mDate && vDate === mDate);
}

/**
 * Do these two titles name the same meeting?
 *
 * The dates have to agree, always -- that is what picks WHICH instance of a
 * recurring meeting this is -- and on top of that either the body names have to
 * agree or the whole title has to be identical. A date on its own is not an
 * identification: it used to score 40, and 40 was the acceptance floor, so a
 * date coincidence was enough to attach one city's agenda to another city's
 * tape. The old `/206/` and `/pharaoh|pharoah/` bonuses were fixture-specific
 * (one Longmont address, one project name) and are gone with them.
 */
export function sameMeetingTitle(videoTitle: string, meeting: PrimeGovMeeting): boolean {
  const v = norm(videoTitle);
  const m = norm(meeting.title);
  if (!v || !m) return false;
  if (!datesAgree(videoTitle, meeting)) return false;
  // An identical title is a title agreement in full, and it is the only way a
  // meeting that names no body ("Neighborhood Meeting Notice - Avis Car
  // Rental") can ever be identified. The date above still has to agree: two
  // such notices a month apart are two different meetings.
  return v === m || sharedBodyNames(videoTitle, meeting).length > 0;
}

/**
 * How strong the agreement is, for ranking candidates. **0 means "not the same
 * meeting"** -- `sameMeetingTitle` is the gate, and this is only ever asked
 * about titles that passed it.
 */
export function scoreMeetingMatch(videoTitle: string, meeting: PrimeGovMeeting): number {
  if (!sameMeetingTitle(videoTitle, meeting)) return 0;
  const v = norm(videoTitle);
  const m = norm(meeting.title);
  if (v === m) return 100;
  // The gate above has already established the date; the tokens below decide
  // which of that day's meetings this is.
  let score = 40;
  const tokens = v.split(" ").filter((t) => t.length > 3 && !STOP.has(t));
  let hits = 0;
  for (const t of tokens) {
    if (m.includes(t)) hits += 1;
  }
  score += hits * 8;
  if (/council/.test(v) && /council/.test(m) && /regular/.test(v) && /regular/.test(m)) score += 20;
  return score;
}

/*
  Words that appear in nearly every meeting title of any city, so agreement on
  one is not evidence. "longmont" is here because this file's shipped example
  city is Longmont and its name is in every one of its own titles; a name from
  another city is simply not a stop word.
*/
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

/** The best candidate, or null when no candidate is the same meeting at all. */
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
  return score > 0 ? best : null;
}

function asMeeting(row: Record<string, unknown>): PrimeGovMeeting {
  const docs = Array.isArray(row.documentList) ? row.documentList : [];
  return {
    id: Number(row.id) || 0,
    title: String(row.title ?? "Untitled meeting"),
    date: String(row.date ?? ""),
    publishDate: typeof row.publishDate === "string" ? row.publishDate : null,
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

/**
 * A portal that answered with a failure, or did not answer at all.
 *
 * Carries the status so an ingest can record what the portal said (503, a
 * timeout) rather than only that something went wrong, and so callers that
 * already have a place to write a reason -- the follow-up agents, the scan's
 * source errors -- can use the portal's own words.
 */
export class PrimeGovPortalError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "PrimeGovPortalError";
    this.status = status;
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetchPublicHttp(new URL(url));
  if (!res.ok) {
    throw new PrimeGovPortalError(`the portal answered ${res.status}`, res.status);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!text.trim()) {
    throw new PrimeGovPortalError("the portal returned an empty body", res.status);
  }
  const looksLikeMarkup = (body: string) =>
    /text\/html/i.test(contentType) || /<\s*(?:!doctype|\/?html|head|body|title|main|h1|div)\b/i.test(body);
  if (looksLikeMarkup(text)) {
    throw new PrimeGovPortalError("the portal returned an error page instead of meeting data", res.status);
  }
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "string" && looksLikeMarkup(body)) {
      throw new PrimeGovPortalError("the portal returned an error page instead of meeting data", res.status);
    }
    return body;
  } catch (error) {
    if (error instanceof PrimeGovPortalError) throw error;
    throw new PrimeGovPortalError("the portal's answer was not a meeting list", res.status);
  }
}

type PortalCall =
  | { ok: true; rows: unknown[] }
  | { ok: false; detail: string; status: number };

/** One portal call. A failure is a value here: the two lists are independent,
 *  and one of them answering is still worth reporting. */
async function listMeetingsAt(url: string): Promise<PortalCall> {
  try {
    const body = await getJson(url);
    return Array.isArray(body)
      ? { ok: true, rows: body }
      : { ok: false, detail: "the portal's answer was not a meeting list", status: 200 };
  } catch (error) {
    if (error instanceof PrimeGovPortalError) {
      return { ok: false, detail: error.message, status: error.status };
    }
    const message = error instanceof Error ? error.message : "the portal could not be read";
    return /timeout|aborted/i.test(message)
      ? { ok: false, detail: "the portal timed out", status: 0 }
      : { ok: false, detail: message, status: 0 };
  }
}

export type PrimeGovPortalRead = {
  /** Every meeting the lists that answered carried. */
  meetings: PrimeGovMeeting[];
  /** false when NEITHER list answered: nothing was read at all. */
  ok: boolean;
  /** The status of the first call that failed, for recording. 0 when none did. */
  status: number;
  /** Which list failed and why; null when both answered. */
  failure: string | null;
};

/**
 * Read a portal's two meeting lists.
 *
 * A failure is carried out of here, never swallowed into an empty list. An
 * empty catalog reads as evidence that a meeting or a document does not exist,
 * and a 5xx, a timeout or a block must not be able to buy that evidence: both
 * lists failing is `ok: false` with the reason, and one failing keeps the
 * other's meetings and names the failure so the catalog can say it is partial.
 */
export async function readPrimeGovPortal(origin: string): Promise<PrimeGovPortalRead> {
  const year = new Date().getFullYear();
  const [upcoming, archived] = await Promise.all([
    listMeetingsAt(`${origin}/api/v2/PublicPortal/ListUpcomingMeetings`),
    listMeetingsAt(`${origin}/api/v2/PublicPortal/ListArchivedMeetings?year=${year}`),
  ]);
  const rows = [
    ...(upcoming.ok ? upcoming.rows : []),
    ...(archived.ok ? archived.rows : []),
  ];
  const seen = new Set<number>();
  const meetings: PrimeGovMeeting[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const m = asMeeting(row as Record<string, unknown>);
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    meetings.push(m);
  }
  const failed = [
    ...(upcoming.ok ? [] : [{ label: "upcoming", detail: upcoming.detail, status: upcoming.status }]),
    ...(archived.ok ? [] : [{ label: "archived", detail: archived.detail, status: archived.status }]),
  ];
  return {
    meetings,
    ok: upcoming.ok || archived.ok,
    status: failed[0]?.status ?? 0,
    failure: failed.length ? failed.map((f) => `${f.label}: ${f.detail}`).join(" · ") : null,
  };
}

/**
 * The portal's meetings, or a throw naming why it could not be read. The throw
 * is the point: every caller of this one has somewhere honest to put a reason
 * (the scan's source errors, a follow-up's "could not check"), and none of them
 * may see an outage as an empty portal.
 */
export async function fetchPrimeGovMeetings(origin: string): Promise<PrimeGovMeeting[]> {
  const read = await readPrimeGovPortal(origin);
  if (!read.ok) {
    throw new PrimeGovPortalError(read.failure ?? "the portal could not be read", read.status);
  }
  return read.meetings;
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
  partialFailure: string | null = null,
): { text: string; extras: string[] } {
  const windowed = meetings.filter((m) => isRecent(m)).sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
  const lines = [
    `PrimeGov portal ${origin}/public/portal`,
    `${meetings.length} meetings on file this year; showing ${windowed.length} from the last 45 days plus upcoming.`,
    /*
      One list answering and one failing is a partial catalog, and it has to
      read as one. Without this line a block on the archived endpoint would
      look exactly like a year with no archived meetings.
    */
    ...(partialFailure
      ? [`PARTIAL: one of the portal's two meeting lists could not be read (${partialFailure}). The list below is incomplete.`]
      : []),
    "Packets and minutes are separate records (the CompiledDocument links). This catalog does not replace them.",
    "",
  ];
  const extras: string[] = [];
  const seen = new Set<string>();
  for (const m of windowed.slice(0, 40)) {
    const docs = preferredDocuments(m);
    const labels = docs.map((d) => d.templateName).join(", ") || "no documents yet";
    const gap = minutesGap(m);
    const publishDate = m.publishDate ?? docs.find((doc) => doc.publishDate)?.publishDate ?? null;
    lines.push(`- Meeting date: ${m.date} ${m.time}; posted: ${publishDate ?? "not recorded"}; ${m.title} [${labels}]${gap ? ` — ${gap}` : ""}`);
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
  if (/\/api\/v\d+\/PublicPortal\//i.test(url.pathname)) return null;
  if (/\/Public\/CompiledDocument/i.test(url.pathname) || /\/Portal\/Meeting/i.test(url.pathname)) {
    return null;
  }
  const read = await readPrimeGovPortal(origin);
  // An outage is a failed read with the portal's own reason, thrown rather than
  // returned as an empty catalog: "0 meetings on file" is a reading of the
  // portal, and this is not one.
  if (!read.ok) {
    throw new PrimeGovPortalError(read.failure ?? "the portal could not be read", read.status);
  }
  const { text, extras } = catalogAndExtras(origin, read.meetings, read.failure);
  return {
    text,
    title: `${new URL(origin).hostname} agendas, packets, and minutes (PrimeGov)`,
    extras,
  };
}

/**
 * The documents for the meeting a video title names, from the portal the
 * caller passed in. There is no default portal: the origin comes from the
 * newsroom's own watch list (`primeGovOriginForNewsroom`), and a caller with
 * no configured portal must skip the lookup rather than ask another city.
 */
export async function primeGovDocumentsForTitle(
  videoTitle: string,
  origin: string,
): Promise<{ meeting: PrimeGovMeeting; urls: string[] } | null> {
  const read = await readPrimeGovPortal(origin);
  if (!read.ok) {
    throw new PrimeGovPortalError(read.failure ?? "the portal could not be read", read.status);
  }
  const hit = bestMeetingMatch(videoTitle, read.meetings);
  if (!hit) return null;
  const urls: string[] = [];
  for (const d of preferredDocuments(hit)) {
    if (/html agenda/i.test(d.templateName)) continue;
    urls.push(compiledDocumentUrl(origin, d));
    if (urls.length >= 3) break;
  }
  return { meeting: hit, urls };
}
