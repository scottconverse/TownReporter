/**
 * Google's official YouTube Data API v3, read as data (0.6.70).
 *
 * The desk used to learn about a channel's videos by scraping the channel tab
 * HTML and the public RSS feed. Both are unofficial: they move when YouTube
 * reshapes a page, and the feed can trail a stream by hours. With a key set,
 * this module talks to the documented service instead, and the scrapers become
 * the fallback (see `youtube.ts`).
 *
 * Everything here is pure: URLs are built and responses are parsed without
 * touching the network, so the shape of a Google reply can be tested against a
 * fake without a socket or a key.
 *
 * Two rules run through the whole file:
 *
 * 1. THE KEY NEVER RIDES IN A URL. It goes in the `x-goog-api-key` header, so
 *    it cannot turn up in a printed URL, a redirect chain, an error message, or
 *    a log line that quotes any of those.
 * 2. NO `search.list`. It costs 100 units a call against a 10,000 unit day;
 *    `channels.list`, `playlistItems.list` and `videos.list` cost 1 each and
 *    answer every question the desk actually asks.
 */

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Google's free daily allowance for a project. */
export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;

/** What each call this module makes costs. Google charges 1 for all three. */
export const YOUTUBE_API_UNIT_COST = 1;

/** The key header. Preferred over `?key=` precisely so the key stays out of URLs. */
export const YOUTUBE_KEY_HEADER = "x-goog-api-key";

/** `playlistItems.list` and `videos.list` both take at most 50 ids a call. */
export const YOUTUBE_API_PAGE_SIZE = 50;

export type YouTubeApiVideo = {
  id: string;
  title: string;
  /** ISO instant from `snippet.publishedAt`, or "" when Google withheld it. */
  published: string;
  /** Seconds. 0 = Google reported no playable duration (upcoming, or not ready). */
  duration: number;
  live: YouTubeLiveState;
  /** ISO instant a scheduled stream starts, or "". */
  scheduled: string;
  description: string;
};

/** The four states the desk already distinguishes for a YouTube video. */
export type YouTubeLiveState = "upcoming" | "live" | "ended" | "vod";

/** What `meeting-capture` needs to decide whether a video can be taped yet. */
export type YouTubeCaptureReadiness = "ready" | "upcoming" | "live" | "unknown";

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function items(body: unknown): Json[] {
  const list = obj(body).items;
  return Array.isArray(list) ? list.map(obj) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * `PT1H2M3S`, `PT45S`, `P0D` -> seconds.
 *
 * `P0D` is what Google returns for a stream whose duration is not known yet
 * (an upcoming broadcast, or a live one that just ended). It parses to 0, which
 * the caller reads as "no duration", never as "zero-length video".
 */
export function isoDurationSeconds(raw: unknown): number {
  const text = str(raw).trim();
  if (!text) return 0;
  const m = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
}

/**
 * The calendar day in Google's quota timezone.
 *
 * Google resets the 10,000 unit allowance at midnight Pacific, so "which day is
 * this" has to be answered in Pacific terms or the desk will keep asking after
 * being refused (or refuse a call it is entitled to). `en-CA` is the locale
 * that formats as YYYY-MM-DD.
 */
export function pacificDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Build a Data API URL. The key is deliberately NOT a parameter. */
export function youtubeApiUrl(
  endpoint: string,
  params: Record<string, string | number | string[]>,
): URL {
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url;
}

export type YouTubeApiProblem =
  | "quota"
  | "bad-key"
  | "not-found"
  | "network"
  | "http"
  | "unusable";

export type YouTubeApiFailure = {
  problem: YouTubeApiProblem;
  /** Google's own reason code, when its body carried one. "" otherwise. */
  reason: string;
  /** What the desk shows an editor. Plain words, never the request. */
  message: string;
};

const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

const KEY_REASONS = new Set([
  "keyInvalid",
  "keyNotAllowed",
  "accessNotConfigured",
  "forbidden",
  "ipRefererBlocked",
  "apiKeyInvalid",
  "apiKeyNotValid",
]);

const NOT_FOUND_REASONS = new Set([
  "notFound",
  "channelNotFound",
  "playlistNotFound",
  "videoNotFound",
  "resourceNotFound",
]);

/** Pull `error.errors[0].reason` / `error.status` out of a Google error body. */
export function googleErrorReason(body: unknown): string {
  const error = obj(obj(body).error);
  const list = error.errors;
  if (Array.isArray(list)) {
    for (const entry of list) {
      const reason = str(obj(entry).reason);
      if (reason) return reason;
    }
  }
  return str(error.status);
}

export function googleErrorMessage(body: unknown): string {
  return str(obj(obj(body).error).message);
}

const PROBLEM_MESSAGES: Record<YouTubeApiProblem, string> = {
  quota:
    "Google says the YouTube Data API allowance for today is used up. TownReporter will read the public feed instead and ask the official API again tomorrow, after midnight Pacific.",
  "bad-key":
    "Google says this key is not allowed to use the YouTube Data API. Check that the key is right, that the YouTube Data API v3 is turned on for its project, and that the key is not restricted to another API.",
  "not-found": "Google has no YouTube channel by that name or id.",
  network: "Could not reach Google's YouTube Data API.",
  http: "Google's YouTube Data API refused the request.",
  unusable: "Google's YouTube Data API sent back a reply TownReporter could not read.",
};

/**
 * Turn an HTTP status and Google's error body into something the desk can say
 * out loud, plus the machine-readable reason the caller needs in order to
 * decide between falling back, disabling the key, and trying again.
 *
 * The status is checked before the reason because Google answers several
 * different problems with 403: a used-up quota, a key restricted to another
 * API, and an API that was never enabled all arrive that way.
 */
export function classifyYouTubeApiFailure(status: number, body: unknown): YouTubeApiFailure {
  const reason = googleErrorReason(body);
  const text = `${reason} ${googleErrorMessage(body)}`.toLowerCase();
  let problem: YouTubeApiProblem;
  if (status === 429 || QUOTA_REASONS.has(reason)) {
    problem = "quota";
  } else if (status === 401 || status === 403) {
    problem = KEY_REASONS.has(reason) || !reason ? "bad-key" : "bad-key";
  } else if (status === 404 || NOT_FOUND_REASONS.has(reason)) {
    problem = "not-found";
  } else if (/api key not valid|api key is invalid|not allowed to use/.test(text)) {
    problem = "bad-key";
  } else if (status >= 500) {
    problem = "http";
  } else {
    problem = "http";
  }
  return { problem, reason, message: PROBLEM_MESSAGES[problem] };
}

/**
 * A reply that arrived with a success status but is not the JSON shape expected.
 * Reported as `unusable` rather than as an empty channel, so a Google change
 * shows up as a fallback with a reason instead of a silent "no videos".
 */
export function unusableReply(detail: string): YouTubeApiFailure {
  return {
    problem: "unusable",
    reason: "",
    message: `${PROBLEM_MESSAGES.unusable} (${detail})`,
  };
}

export function failureMessage(problem: YouTubeApiProblem): string {
  return PROBLEM_MESSAGES[problem];
}

export type YouTubeChannelLookup = {
  channelId: string;
  title: string;
  uploadsPlaylistId: string;
};

/**
 * `channels.list?part=snippet,contentDetails`.
 *
 * Returns null when Google answered normally and listed no channel, which is
 * the honest answer for a handle nobody has taken.
 */
export function parseChannelLookup(body: unknown): YouTubeChannelLookup | null {
  const first = items(body)[0];
  if (!first) return null;
  const channelId = str(first.id);
  if (!channelId) return null;
  const snippet = obj(first.snippet);
  const related = obj(obj(first.contentDetails).relatedPlaylists);
  return {
    channelId,
    title: str(snippet.title),
    uploadsPlaylistId: str(related.uploads),
  };
}

export type YouTubeUploadEntry = { videoId: string; title: string; published: string };

/**
 * `playlistItems.list?part=snippet,contentDetails` for a channel's uploads.
 *
 * Google lists removed and private videos in an uploads playlist as
 * "Deleted video" / "Private video" placeholders. They have no `videoId` to
 * fetch and nothing to read, so they are dropped here rather than carried
 * through as rows the desk cannot open.
 */
export function parseUploadsPage(body: unknown): YouTubeUploadEntry[] {
  const out: YouTubeUploadEntry[] = [];
  for (const item of items(body)) {
    const snippet = obj(item.snippet);
    const details = obj(item.contentDetails);
    const videoId = str(obj(snippet.resourceId).videoId) || str(details.videoId);
    if (!videoId) continue;
    const title = str(snippet.title);
    if (/^(deleted|private) video$/i.test(title.trim())) continue;
    out.push({
      videoId,
      title,
      published: str(details.videoPublishedAt) || str(snippet.publishedAt),
    });
  }
  return out;
}

/**
 * Which of the four states a video is in, from `snippet.liveBroadcastContent`
 * plus `liveStreamingDetails`.
 *
 * `actualStartTime` with no live/upcoming flag is how a finished broadcast
 * reads: the stream happened (`ended`) and its recording is what is playable
 * now. Without it the video was uploaded, not streamed (`vod`).
 */
export function youTubeLiveState(snippet: unknown, liveDetails: unknown): YouTubeLiveState {
  const broadcast = str(obj(snippet).liveBroadcastContent);
  if (broadcast === "upcoming") return "upcoming";
  if (broadcast === "live") return "live";
  const details = obj(liveDetails);
  if (str(details.actualStartTime) || str(details.actualEndTime)) return "ended";
  return "vod";
}

/** `videos.list?part=snippet,contentDetails,liveStreamingDetails,status`. */
export function parseVideoDetails(body: unknown): YouTubeApiVideo[] {
  const out: YouTubeApiVideo[] = [];
  for (const item of items(body)) {
    const id = str(item.id);
    if (!id) continue;
    const snippet = obj(item.snippet);
    const liveDetails = obj(item.liveStreamingDetails);
    out.push({
      id,
      title: str(snippet.title),
      published: str(snippet.publishedAt),
      duration: isoDurationSeconds(obj(item.contentDetails).duration),
      live: youTubeLiveState(snippet, liveDetails),
      scheduled: str(liveDetails.scheduledStartTime),
      description: str(snippet.description),
    });
  }
  return out;
}

/**
 * The readiness verdict for a video, from the same fields.
 *
 * A video with no duration but a `scheduledStartTime` in the future is not
 * ready; one with a duration is. `unknown` means "try again later" and is what
 * `meeting-capture` counts as "waiting for status metadata", so an upcoming
 * broadcast must never be reported as unknown-and-ready.
 */
export function readinessFromVideo(video: {
  live: YouTubeLiveState;
  duration: number;
}): YouTubeCaptureReadiness {
  if (video.live === "upcoming") return "upcoming";
  if (video.live === "live") return "live";
  if (video.duration > 0) return "ready";
  return "unknown";
}

/** The rows the channel reader consumes, tagged as coming from the API. */
export type YouTubeApiListedVideo = {
  id: string;
  title: string;
  published: string;
  url: string;
  duration: number;
  tab: "api";
  live: YouTubeLiveState;
  scheduled: string;
};

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Fold the uploads listing (titles and dates, one cheap call) together with the
 * details (durations and live state, one more) into desk rows.
 *
 * A video Google listed in the uploads playlist but did not return details for
 * is still a row: it exists, and dropping it would hide a meeting from the
 * desk. It arrives with duration 0, which is what makes meeting capture ask
 * about its readiness later.
 */
export function buildApiVideos(
  uploads: YouTubeUploadEntry[],
  details: YouTubeApiVideo[],
): YouTubeApiListedVideo[] {
  const byId = new Map(details.map((d) => [d.id, d]));
  const out: YouTubeApiListedVideo[] = [];
  const seen = new Set<string>();
  for (const upload of uploads) {
    if (seen.has(upload.videoId)) continue;
    seen.add(upload.videoId);
    const detail = byId.get(upload.videoId);
    out.push({
      id: upload.videoId,
      // Google truncates long playlist titles with an ellipsis; the details
      // call carries the whole one, so prefer it when it is longer.
      title: detail && detail.title.length > upload.title.length ? detail.title : upload.title,
      published: upload.published || detail?.published || "",
      url: watchUrl(upload.videoId),
      duration: detail?.duration ?? 0,
      tab: "api",
      live: detail?.live ?? "vod",
      scheduled: detail?.scheduled ?? "",
    });
  }
  return out;
}

/** "YouTube units used today: 12 of 10,000" — the line shown next to the key box. */
export function youtubeUsageLine(units: number, limit = YOUTUBE_DAILY_QUOTA_UNITS): string {
  const used = Number.isFinite(units) && units > 0 ? Math.floor(units) : 0;
  return `YouTube units used today: ${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")}`;
}

/** The scan-receipt wording for whichever path actually ran. */
export function youtubeReadPathLine(
  path: "api" | "feed",
  fallbackReason: string | null = null,
): string {
  if (path === "api") return "Read YouTube with the official API.";
  if (fallbackReason) return `${fallbackReason} Read the public feed instead.`;
  return "No YouTube key; read the public feed.";
}

/**
 * The last line of defence for the key, on the browser side.
 *
 * Nothing on the server path puts the key into a message -- it travels in a
 * header, Google never echoes it, and the desk only ever says "a key is saved".
 * This exists for the one remaining route: an exception thrown across the
 * server-function boundary, whose text is whatever the runtime decided to
 * quote, which for a failed request can include the request. Anything an
 * editor is about to read goes through here first, so the paste can never
 * appear in a paragraph on the page.
 */
export function redactSecret(text: string, secret: string): string {
  const needle = secret.trim();
  if (!needle) return text;
  return text.split(needle).join("[the key]");
}
