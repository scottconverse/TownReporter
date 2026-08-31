import { assertPublicHttpUrl, fetchPublicHttp } from "./fetch-url.ts";
import { htmlToPlainText } from "./html-text.ts";

/** Same ceiling as ingest ARCHIVE_TEXT_CAP. Retrieval slices; storage does not. */
const TEXT_CAP = 2_000_000;

const YT_HOST = /^(www\.)?(youtube\.com|m\.youtube\.com|youtu\.be)$/i;

export function isYoutubeUrl(url: URL): boolean {
  return YT_HOST.test(url.hostname);
}

export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] && ["watch", "embed", "shorts", "live", "v"].includes(parts[0]) && parts[1] && /^[\w-]{11}$/.test(parts[1])) {
    return parts[1];
  }
  return null;
}

export function isYoutubeChannel(url: URL): boolean {
  if (!isYoutubeUrl(url) || youtubeVideoId(url)) return false;
  const p = url.pathname;
  return (
    p.startsWith("/@") ||
    p.startsWith("/channel/") ||
    p.startsWith("/c/") ||
    p.startsWith("/user/") ||
    /\/(videos|streams|featured|playlists)?\/?$/i.test(p)
  );
}

export function extractChannelId(html: string): string | null {
  return (
    html.match(/"externalId":"(UC[\w-]+)"/)?.[1] ??
    html.match(/"browseId":"(UC[\w-]+)"/)?.[1] ??
    html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ??
    html.match(/\/channel\/(UC[\w-]+)/)?.[1] ??
    html.match(/channel_id=(UC[\w-]+)/)?.[1] ??
    null
  );
}

export type YoutubeVideoMeta = {
  id: string;
  title: string;
  published: string;
  live: "upcoming" | "live" | "ended" | "vod";
  scheduled: string;
  description: string;
  captions: string;
};

function decodeXml(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlEntries(xml: string): { id: string; title: string; published: string }[] {
  const out: { id: string; title: string; published: string }[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1] ?? "";
    const id = block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1];
    const title = decodeXml(block.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() ?? "");
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1] ?? "";
    if (id) out.push({ id, title, published: published.slice(0, 10) });
    if (out.length >= 25) break;
  }
  return out;
}

async function fetchRss(channelId: string): Promise<{ id: string; title: string; published: string }[]> {
  const rss = new URL(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const res = await fetchPublicHttp(rss);
  if (!res.ok) return [];
  return xmlEntries(await res.text());
}

export type ListedVideo = {
  id: string;
  title: string;
  published: string;
  url: string;
  duration: number;
  tab: "streams" | "videos" | "rss";
};

export const MEETING_KEYWORDS = [
  "council",
  "meeting",
  "session",
  "board",
  "commission",
  "hearing",
  "work session",
  "study session",
  "neighborhood",
  "planning",
  "zoning",
  "lura",
  "pre-session",
];

const SKIP_TITLES = /\bthis week in council\b|^twic\b|\btldw\b|block part(y|ies)|cruise night/i;

export const LONGMONT_YOUTUBE_CHANNELS = [
  "https://www.youtube.com/@CityofLongmont",
  "https://www.youtube.com/@LongmontPublicMedia",
];

export function normalizeMeetingTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "&")
    .replace(/pharoah/g, "pharaoh")
    .replace(/\b(virtual|livestreamed?|live[- ]?stream|cancelled|canceled|rescheduled|notice)\b/g, " ")
    .replace(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/g,
      " ",
    )
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/#\s*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function meetingKey(title: string): { core: string; date: string; month: string } {
  const core = normalizeMeetingTitle(title);
  const slash = title.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  let date = "";
  let month = "";
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
  if (slash) {
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    date = `${y}-${String(Number(slash[1])).padStart(2, "0")}-${String(Number(slash[2])).padStart(2, "0")}`;
    month = date.slice(0, 7);
  } else {
    const named = title.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/i,
    );
    if (named) {
      let y = Number(named[3]);
      if (y < 100) y += 2000;
      date = `${y}-${months[named[1]!.slice(0, 3).toLowerCase()]}-${String(Number(named[2])).padStart(2, "0")}`;
      month = date.slice(0, 7);
    } else {
      const my = title.match(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/i,
      );
      if (my) {
        let y = Number(my[2]);
        if (y < 100) y += 2000;
        month = `${y}-${months[my[1]!.slice(0, 3).toLowerCase()]}`;
      }
    }
  }
  return { core, date, month };
}

export function sameMeeting(a: string, b: string): boolean {
  const ka = meetingKey(a);
  const kb = meetingKey(b);
  if (!ka.core || !kb.core) return false;
  if (ka.month && kb.month && ka.month !== kb.month) return false;
  if (ka.date && kb.date && ka.date !== kb.date) return false;
  if (ka.core === kb.core) return true;
  const wa = ka.core.split(" ").filter((w) => w.length > 2);
  const wb = kb.core.split(" ").filter((w) => w.length > 2);
  if (!wa.length || !wb.length) return false;
  let hit = 0;
  const setB = new Set(wb);
  for (const w of wa) if (setB.has(w)) hit += 1;
  const denom = Math.max(wa.length, wb.length);
  return hit >= Math.min(3, Math.min(wa.length, wb.length)) && hit / denom >= 0.45;
}

export function pickSisterMatch<T extends { title: string }>(title: string, others: T[]): T | null {
  return others.find((o) => sameMeeting(title, o.title)) ?? null;
}

export function isMeetingTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (SKIP_TITLES.test(t)) return false;
  return MEETING_KEYWORDS.some((k) => t.includes(k));
}

export function pickMeetingVideos<T extends { title: string; duration?: number }>(
  videos: T[],
  max = 8,
): T[] {
  const meetings = videos.filter((v) => isMeetingTitle(v.title));
  if (meetings.length) return meetings.slice(0, max);
  return [...videos]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, max);
}

export function parseChannelTabHtml(html: string, tab: ListedVideo["tab"]): ListedVideo[] {
  const out: ListedVideo[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/videoRenderer/);
  for (const block of blocks) {
    const id = block.match(/"videoId":"([\w-]{11})"/)?.[1];
    if (!id || seen.has(id)) continue;
    const titleRaw =
      block.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/)?.[1] ??
      block.match(/"title":\{"simpleText":"((?:\\.|[^"\\])*)"/)?.[1] ??
      "";
    let title = titleRaw;
    try {
      title = JSON.parse(`"${titleRaw}"`) as string;
    } catch {
      title = titleRaw.replace(/\\u0026/g, "&").replace(/\\"/g, '"');
    }
    if (!title) continue;
    if (/keyboard shortcut|cookies|sign in|^privacy/i.test(title)) continue;
    seen.add(id);
    const lengthText = block.match(/"lengthText":\{"simpleText":"([^"]+)"/)?.[1] ?? "";
    out.push({
      id,
      title,
      published: "",
      url: `https://www.youtube.com/watch?v=${id}`,
      duration: parseLengthText(lengthText),
      tab,
    });
  }
  return out;
}

function parseLengthText(raw: string): number {
  const p = raw.split(":").map((n) => Number(n));
  if (p.some((n) => !Number.isFinite(n))) return 0;
  if (p.length === 3) return p[0]! * 3600 + p[1]! * 60 + p[2]!;
  if (p.length === 2) return p[0]! * 60 + p[1]!;
  return 0;
}

async function fetchChannelTab(channelUrl: string, tab: "streams" | "videos"): Promise<ListedVideo[]> {
  const base = channelUrl.replace(/\/(videos|streams|featured|playlists|about)\/?$/, "").replace(/\/$/, "");
  const url = new URL(`${base}/${tab}`);
  try {
    const res = await fetchPublicHttp(url);
    if (!res.ok) return [];
    return parseChannelTabHtml(await res.text(), tab);
  } catch {
    return [];
  }
}

export async function listChannelVideos(channelUrl: string): Promise<ListedVideo[]> {
  const seen = new Map<string, ListedVideo>();
  const out: ListedVideo[] = [];
  const push = (row: ListedVideo) => {
    const prev = seen.get(row.id);
    if (prev) {
      if (!prev.duration && row.duration) prev.duration = row.duration;
      if (!prev.published && row.published) prev.published = row.published;
      if (row.tab !== "rss") prev.tab = row.tab;
      if (row.title && row.title.length > prev.title.length) prev.title = row.title;
      return;
    }
    seen.set(row.id, row);
    out.push(row);
  };
  let handleUrl = channelUrl;
  try {
    const page = await fetchPublicHttp(new URL(channelUrl));
    const html = await page.text();
    const channelId = extractChannelId(html);
    if (channelId) {
      for (const e of await fetchRss(channelId)) {
        push({
          id: e.id,
          title: e.title,
          published: e.published,
          url: `https://www.youtube.com/watch?v=${e.id}`,
          duration: 0,
          tab: "rss",
        });
      }
    }
    const canon =
      html.match(/"canonicalBaseUrl":"(\/[@c][^"]+)"/)?.[1] ??
      html.match(/"url":"(\/@[\w.-]+)"/)?.[1];
    if (canon) handleUrl = `https://www.youtube.com${canon}`;
  } catch {
    /* tabs still tried */
  }
  for (const tab of ["streams", "videos"] as const) {
    for (const row of await fetchChannelTab(handleUrl, tab)) push(row);
  }
  return out;
}

type PlayerSnapshot = {
  title: string;
  description: string;
  status: string;
  reason: string;
  scheduled: string;
  isLiveNow: boolean;
  isLiveContent: boolean;
  captionTracks: { languageCode?: string; kind?: string; baseUrl?: string }[];
};

async function fetchPlayer(videoId: string): Promise<PlayerSnapshot | null> {
  const endpoint = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
  await assertPublicHttpUrl(endpoint);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 TownReporter/1.0" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20240801.00.00", hl: "en", gl: "US" } },
      videoId,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    playabilityStatus?: {
      status?: string;
      reason?: string;
      liveStreamability?: {
        liveStreamabilityRenderer?: {
          offlineSlate?: {
            liveStreamOfflineSlateRenderer?: {
              scheduledStartTime?: string;
              subtitleText?: { simpleText?: string };
            };
          };
        };
      };
    };
    videoDetails?: { title?: string; shortDescription?: string; isLiveContent?: boolean };
    microformat?: {
      playerMicroformatRenderer?: {
        liveBroadcastDetails?: { isLiveNow?: boolean; startTimestamp?: string };
      };
    };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { languageCode?: string; kind?: string; baseUrl?: string }[];
      };
    };
  };
  const slate =
    data.playabilityStatus?.liveStreamability?.liveStreamabilityRenderer?.offlineSlate
      ?.liveStreamOfflineSlateRenderer;
  return {
    title: data.videoDetails?.title ?? "",
    description: data.videoDetails?.shortDescription ?? "",
    status: data.playabilityStatus?.status ?? "",
    reason: data.playabilityStatus?.reason ?? "",
    scheduled: slate?.subtitleText?.simpleText || slate?.scheduledStartTime || "",
    isLiveNow: Boolean(data.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow),
    isLiveContent: Boolean(data.videoDetails?.isLiveContent),
    captionTracks: data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
  };
}

export function parseTranscriptPanel(text: string): string {
  const raw = text.replace(/\u00a0/g, " ").trim();
  if (!raw) return "";
  if (/\n\[\d+:\d/.test(raw) || /^\[\d+:\d/.test(raw)) {
    return raw
      .replace(/Search transcript/gi, "")
      .replace(/Double tap to skip to this point in the video\.?/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const cleaned = raw
    .replace(/Search transcript/gi, " ")
    .replace(/\bTranscript\b/g, " ")
    .replace(/Double tap to skip to this point in the video\.?/gi, " ");
  const parts = cleaned.split(/(?=\b\d+:\d{2}(?::\d{2})?\b)/);
  const lines: string[] = [];
  for (const part of parts) {
    const m = part.match(/^\s*(\d+:\d{2}(?::\d{2})?)\s+(?:\d+\s+seconds?\s+)?([\s\S]*)$/i);
    if (m) {
      const body = (m[2] ?? "").replace(/\s+/g, " ").trim();
      if (body) lines.push(`[${m[1]}] ${body}`);
    } else {
      const body = part.replace(/\s+/g, " ").trim();
      if (body) lines.push(body);
    }
  }
  return lines.join("\n").trim();
}

async function scrapeShowTranscript(videoId: string): Promise<string> {
  if (typeof window !== "undefined") return "";
  if (process.env["VERCEL"] || process.env["TOWNREPORTER_NO_PLAYWRIGHT"] === "1") return "";
  try {
    const { scrapeYoutubeShowTranscript } = await import("./render-fetch.ts");
    const raw = await scrapeYoutubeShowTranscript(videoId);
    return parseTranscriptPanel(raw).slice(0, TEXT_CAP);
  } catch {
    return "";
  }
}

async function fetchCaptions(videoId: string, tracks: PlayerSnapshot["captionTracks"]): Promise<string> {
  const urls: string[] = [];
  const preferred =
    tracks.find((t) => t.languageCode?.startsWith("en") && t.baseUrl) ??
    tracks.find((t) => t.baseUrl);
  if (preferred?.baseUrl) urls.push(preferred.baseUrl);
  urls.push(
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=srv3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=srv3`,
  );
  for (const raw of urls) {
    try {
      const res = await fetchPublicHttp(new URL(raw));
      if (!res.ok) continue;
      const xml = await res.text();
      const text = htmlToPlainText(xml).replace(/\s+/g, " ").trim();
      if (text.length > 40) return text.slice(0, TEXT_CAP);
    } catch {
      /* next */
    }
  }
  return "";
}

export function describeLiveStatus(player: {
  status: string;
  reason: string;
  scheduled: string;
  isLiveNow: boolean;
  isLiveContent: boolean;
  captions: string;
}): { live: YoutubeVideoMeta["live"]; note: string } {
  if (player.status === "LIVE_STREAM_OFFLINE" || (player.isLiveContent && !player.isLiveNow && !player.captions)) {
    const when = player.scheduled ? ` Scheduled: ${player.scheduled}.` : "";
    return {
      live: "upcoming",
      note: `Upcoming live stream — no transcript yet because the meeting has not started.${when} ${player.reason}`.trim(),
    };
  }
  if (player.isLiveNow) {
    return { live: "live", note: "Live right now. Captions, if any, are rolling and incomplete." };
  }
  if (player.captions) {
    return {
      live: player.isLiveContent ? "ended" : "vod",
      note: player.captions.includes("Public Media")
        ? "Transcript from Longmont Public Media (same meeting). City tape had none. Auto-captions; names may be wrong; verify quotes against the video."
        : "Transcript captured from More → Show transcript. Auto-captions; names may be wrong; verify quotes against the video.",
    };
  }
  if (player.isLiveContent) {
    return { live: "ended", note: "Live event appears over, but YouTube did not give us the transcript panel." };
  }
  return { live: "vod", note: "No Show transcript control on this video." };
}

async function transcriptFromSisterChannel(title: string, alreadyId: string): Promise<string> {
  if (!title || !isMeetingTitle(title)) return "";
  for (const ch of LONGMONT_YOUTUBE_CHANNELS) {
    try {
      const listed = await listChannelVideos(ch);
      const hit = listed.find((v) => v.id !== alreadyId && sameMeeting(title, v.title));
      if (!hit) continue;
      const text = await scrapeShowTranscript(hit.id);
      if (text.length > 80) {
        return `Transcript from Longmont Public Media / ${ch} ${hit.url} (same meeting; other tape had none).\n${text}`;
      }
    } catch {
      /* next channel */
    }
  }
  return "";
}

async function captureVideo(id: string, listedTitle = "", published = ""): Promise<string> {
  const player = await fetchPlayer(id);
  let captions = player ? await fetchCaptions(id, player.captionTracks) : "";
  const upcoming =
    player?.status === "LIVE_STREAM_OFFLINE" ||
    (Boolean(player?.isLiveContent) && !player?.isLiveNow && !captions);
  if (!captions && !upcoming) {
    captions = await scrapeShowTranscript(id);
  }
  if (!captions && !upcoming) {
    const alt = await transcriptFromSisterChannel(player?.title || listedTitle, id);
    if (alt) captions = alt;
  }
  const status = describeLiveStatus({
    status: player?.status ?? "",
    reason: player?.reason ?? "",
    scheduled: player?.scheduled ?? "",
    isLiveNow: Boolean(player?.isLiveNow),
    isLiveContent: Boolean(player?.isLiveContent),
    captions,
  });
  const title = player?.title || listedTitle || id;
  const lines = [
    `--- video ${id} ---`,
    `Title: ${title}`,
    published ? `Listed: ${published}` : "",
    `Watch: https://www.youtube.com/watch?v=${id}`,
    status.note,
  ].filter(Boolean);
  if (player?.description?.trim()) lines.push(`Description:\n${player.description.trim().slice(0, 1200)}`);
  if (captions) {
    lines.push(
      `YouTube transcript from More → Show transcript (auto or manual; verify quotes against the video).\n${captions}`,
    );
  }
  return lines.join("\n").slice(0, TEXT_CAP);
}

export type YoutubeIngest = { text: string; title: string; extras: string[] };

export async function ingestYoutube(url: URL): Promise<YoutubeIngest | null> {
  if (!isYoutubeUrl(url)) return null;
  const videoId = youtubeVideoId(url);
  if (videoId) {
    const text = await captureVideo(videoId);
    const title = text.match(/^Title: (.+)$/m)?.[1] ?? `YouTube ${videoId}`;
    let extras: string[] = [];
    try {
      const { primeGovDocumentsForTitle } = await import("./primegov.ts");
      const hit = await primeGovDocumentsForTitle(title);
      if (hit?.urls.length) {
        extras = hit.urls;
        return {
          text: `${text}\n\nPrimeGov match: ${hit.meeting.date} ${hit.meeting.title}\n${hit.urls.map((u) => `Packet/agenda: ${u}`).join("\n")}`,
          title,
          extras,
        };
      }
    } catch {
      /* PrimeGov is a sibling record, not required to read the tape */
    }
    return { text, title, extras };
  }

  const listed = await listChannelVideos(url.toString());
  const notes: string[] = [];
  const handle = url.toString().toLowerCase();
  for (const ch of LONGMONT_YOUTUBE_CHANNELS) {
    if (handle.includes((ch.split("@")[1] ?? "___").toLowerCase())) continue;
    try {
      const alt = await listChannelVideos(ch);
      for (const v of listed) {
        const hit = pickSisterMatch(v.title, alt);
        if (hit && hit.id !== v.id) {
          notes.push(`Same meeting also at ${hit.url} (${ch})`);
        }
      }
      for (const a of alt) {
        if (!isMeetingTitle(a.title)) continue;
        if (listed.some((v) => v.id === a.id || sameMeeting(v.title, a.title))) continue;
        listed.push(a);
        notes.push(`Only listed on ${ch}: ${a.title} ${a.url}`);
      }
    } catch {
      /* sister channel is optional */
    }
  }
  const meetings = pickMeetingVideos(listed.filter((v) => !/keyboard shortcut/i.test(v.title)), 12);
  const extras = meetings.slice(0, 6).map((v) => v.url);
  const title = listed[0]?.title
    ? `YouTube channel ${url.pathname}`
    : url.hostname;
  const lines = [
    `YouTube channel ${url.toString()}.`,
    `Listed ${listed.length} recent videos; ${meetings.length} look like meetings (streams + videos tabs, plus RSS).`,
    "Full transcripts are stored on each watch URL — not sliced into this catalog. Dark desk reads the whole meeting from those records.",
    notes.length ? `Sister channel:\n${notes.slice(0, 12).join("\n")}` : "",
    "",
    "Recent videos:",
    ...listed.map((v) => {
      const tag = isMeetingTitle(v.title) ? "meeting" : v.tab;
      return `- [${tag}] ${v.published || v.tab} ${v.title} ${v.url}`;
    }),
  ];
  if (!listed.length) {
    const page = await fetchPublicHttp(url);
    const html = await page.text();
    lines.push(htmlToPlainText(html).slice(0, 3000));
  }
  return { text: lines.join("\n").slice(0, 20000), title, extras };
}
