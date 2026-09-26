/**
 * The YouTube key, its encryption, the unit meter, and the Google calls (0.6.70).
 *
 * Everything here runs on the server only: it reads credentials and writes
 * rows. The pure half — URL building, response parsing, error wording — lives
 * in `youtube-data-api.ts`, and this module is the only place a socket or a
 * table is touched.
 *
 * Why it exists: the desk learned about a channel's videos by scraping the
 * channel tab, the public RSS feed, and (last resort) a yt-dlp listing. All
 * three are unofficial. The owner has a YouTube Data API v3 key, so the
 * documented service becomes the first choice and those three become the
 * fallback — which is why every function here is written to FAIL SOFT: a
 * missing key, a refused key, a used-up quota, a dead network, and an
 * unreadable reply all come back as "used: false" with a sentence for the
 * desk, never as a thrown error that would take the scan down with it.
 *
 * The key is never returned to a caller outside this file except as a boolean.
 * It travels to Google in the `x-goog-api-key` header, never in a URL, so it
 * cannot appear in a printed request, a redirect chain, or an error string.
 */

import { DEFAULT_NEWSROOM_ID, requireEditor } from "./membership.ts";
import { getSql } from "../db.ts";
import { decryptApiKey, encryptApiKey } from "./custom-ai-connections.server.ts";
import { assertPublicHttpUrl, resolveFetch } from "./fetch-url.ts";
import {
  YOUTUBE_API_UNIT_COST,
  YOUTUBE_DAILY_QUOTA_UNITS,
  YOUTUBE_KEY_HEADER,
  buildApiVideos,
  classifyYouTubeApiFailure,
  failureMessage,
  pacificDay,
  parseChannelLookup,
  parseUploadsPage,
  parseVideoDetails,
  readinessFromVideo,
  unusableReply,
  youtubeApiUrl,
  type YouTubeApiFailure,
  type YouTubeApiListedVideo,
  type YouTubeCaptureReadiness,
  type YouTubeChannelLookup,
  type YouTubeUploadEntry,
} from "./youtube-data-api.ts";

/**
 * The runtime create-table-if-not-exists pair, mirroring the DDL in
 * `migrations/0096_youtube_data_api.sql`.
 *
 * Node unit tests reach the database through PGlite, where the migration glob
 * is unavailable (see `src/lib/db.ts`), so the tables have to be creatable from
 * code as well as from the deploy path. The two definitions must stay
 * column-for-column identical.
 */
const SCHEMA = [
  `create table if not exists youtube_api_settings (
     newsroom_id integer primary key,
     encrypted_api_key text,
     quota_blocked_day text,
     updated_at timestamptz not null default now()
   )`,
  `create table if not exists youtube_api_usage (
     newsroom_id integer not null,
     day text not null,
     units integer not null default 0,
     primary key (newsroom_id, day)
   )`,
];

async function ensureSchema(): Promise<void> {
  const sql = await getSql();
  for (const statement of SCHEMA) await sql.query(statement);
}

/* ------------------------------------------------------------------ *
 * Test seam
 * ------------------------------------------------------------------ */

/** How this module reaches Google. Replaced wholesale by a test. */
export type YouTubeTransport = (url: URL, init: RequestInit) => Promise<Response>;

let transportOverride: YouTubeTransport | null = null;

/**
 * Stand in for Google. Tests pass a function that answers from a fixture, so
 * no test in this repository ever opens a socket to Google or to YouTube.
 * Pass `null` to restore the guarded transport.
 */
export function setYouTubeTransportForTests(impl: YouTubeTransport | null): void {
  transportOverride = impl;
}

/**
 * The real transport: the same SSRF-guarded fetch every other outbound request
 * in this codebase uses, so `www.googleapis.com` is resolved and checked rather
 * than trusted by name.
 */
async function guardedTransport(url: URL, init: RequestInit): Promise<Response> {
  await assertPublicHttpUrl(url.toString());
  const send = await resolveFetch();
  return send(url, init);
}

/* ------------------------------------------------------------------ *
 * The key
 * ------------------------------------------------------------------ */

/** `YOUTUBE_API_KEY` from the app environment, or "" when unset. */
export function youtubeApiKeyFromEnv(): string {
  return process.env.YOUTUBE_API_KEY?.trim() ?? "";
}

export type YouTubeKeySource = "env" | "stored" | "none";

export type YouTubeKeyRow = {
  encryptedApiKey: string | null;
  quotaBlockedDay: string | null;
};

async function readKeyRow(newsroomId: number): Promise<YouTubeKeyRow> {
  await ensureSchema();
  const sql = await getSql();
  const rows = await sql<{ encrypted_api_key: string | null; quota_blocked_day: string | null }>`
    select encrypted_api_key, quota_blocked_day from youtube_api_settings where newsroom_id = ${newsroomId} limit 1
  `;
  return {
    encryptedApiKey: rows[0]?.encrypted_api_key ?? null,
    quotaBlockedDay: rows[0]?.quota_blocked_day ?? null,
  };
}

/**
 * The key in force, and where it came from. An environment key overrides a
 * saved one: an operator who puts `YOUTUBE_API_KEY` in the app environment
 * means it, and a stale key left in the desk must not shadow it.
 */
export async function resolveYouTubeApiKey(
  newsroomId: number,
): Promise<{ key: string; source: YouTubeKeySource }> {
  const env = youtubeApiKeyFromEnv();
  if (env) return { key: env, source: "env" };
  const row = await readKeyRow(newsroomId);
  if (!row.encryptedApiKey) return { key: "", source: "none" };
  try {
    const key = decryptApiKey(row.encryptedApiKey);
    return key ? { key, source: "stored" } : { key: "", source: "none" };
  } catch {
    // A key encrypted under a rotated BETTER_AUTH_SECRET is unreadable, not a
    // crash: report it as no key and let the desk read the public feed.
    return { key: "", source: "none" };
  }
}

/** "A key is saved" / "No key" — the only thing the desk is ever told about it. */
export function describeKeySource(source: YouTubeKeySource): string {
  if (source === "env") return "A key is saved, from the app environment (YOUTUBE_API_KEY).";
  if (source === "stored") return "A key is saved.";
  return "No key.";
}

/* ------------------------------------------------------------------ *
 * The unit meter
 * ------------------------------------------------------------------ */

/** Add to today's tally. Called once per call made, before the answer is read. */
export async function recordYouTubeUnits(
  newsroomId: number,
  units = YOUTUBE_API_UNIT_COST,
  at: Date = new Date(),
): Promise<void> {
  await ensureSchema();
  const sql = await getSql();
  await sql`
    insert into youtube_api_usage(newsroom_id, day, units) values (${newsroomId}, ${pacificDay(at)}, ${units})
    on conflict(newsroom_id, day) do update set units = youtube_api_usage.units + excluded.units
  `;
}

export async function readYouTubeUnits(
  newsroomId: number,
  at: Date = new Date(),
): Promise<number> {
  await ensureSchema();
  const sql = await getSql();
  const rows = await sql<{ units: number }>`
    select units from youtube_api_usage where newsroom_id = ${newsroomId} and day = ${pacificDay(at)}
  `;
  return rows[0]?.units ?? 0;
}

/** Remember that Google refused today. Cleared by the Pacific day rolling over. */
async function blockForToday(newsroomId: number, at: Date): Promise<void> {
  await ensureSchema();
  const sql = await getSql();
  await sql`
    insert into youtube_api_settings(newsroom_id, quota_blocked_day) values (${newsroomId}, ${pacificDay(at)})
    on conflict(newsroom_id) do update set quota_blocked_day = excluded.quota_blocked_day, updated_at = now()
  `;
}

/* ------------------------------------------------------------------ *
 * One call
 * ------------------------------------------------------------------ */

type GoogleReply = { ok: true; body: unknown } | { ok: false; failure: YouTubeApiFailure };

/**
 * One Data API call, counted, with every failure mode reduced to a value.
 *
 * The unit is recorded BEFORE the answer is read: a request that leaves the
 * desk has been made, and under-counting the meter is the one error that would
 * let a scan run past the daily allowance without the desk saying so.
 */
async function callGoogle(
  newsroomId: number,
  url: URL,
  key: string,
  at: Date,
): Promise<GoogleReply> {
  await recordYouTubeUnits(newsroomId, YOUTUBE_API_UNIT_COST, at);
  const send = transportOverride ?? guardedTransport;
  let response: Response;
  try {
    response = await send(url, {
      method: "GET",
      headers: { Accept: "application/json", [YOUTUBE_KEY_HEADER]: key },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, failure: { problem: "network", reason: "", message: failureMessage("network") } };
  }
  let body: unknown = null;
  try {
    body = response.status === 204 ? {} : await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) return { ok: false, failure: classifyYouTubeApiFailure(response.status, body) };
  if (body === null) return { ok: false, failure: unusableReply("the reply was not JSON") };
  return { ok: true, body };
}

export type YouTubeApiSkipReason = "no-key" | "quota" | "blocked" | "error";

export type YouTubeApiOutcome<T> =
  | { used: true; value: T; units: number }
  | { used: false; reason: YouTubeApiSkipReason; message: string };

/**
 * Whether the API may be called at all right now.
 *
 * Three ways to say no, and the desk needs to word them differently:
 * no key at all, today's allowance already spent, or Google having refused
 * today — the last two must not be retried until the Pacific day rolls over,
 * because each retry is a call Google will refuse again for free.
 */
async function guard(
  newsroomId: number,
  at: Date,
): Promise<{ key: string; skipped: YouTubeApiOutcome<never> | null }> {
  const { key } = await resolveYouTubeApiKey(newsroomId);
  if (!key) {
    return { key, skipped: { used: false, reason: "no-key", message: "No YouTube key is set." } };
  }
  const row = await readKeyRow(newsroomId);
  if (row.quotaBlockedDay === pacificDay(at)) {
    return {
      key,
      skipped: { used: false, reason: "blocked", message: failureMessage("quota") },
    };
  }
  if ((await readYouTubeUnits(newsroomId, at)) >= YOUTUBE_DAILY_QUOTA_UNITS) {
    return {
      key,
      skipped: { used: false, reason: "quota", message: failureMessage("quota") },
    };
  }
  return { key, skipped: null };
}

/* ------------------------------------------------------------------ *
 * Channel discovery
 * ------------------------------------------------------------------ */

/** `/channel/UC…`, `@handle`, or a legacy `/user/name` — whichever the URL carries. */
export function channelSelector(channelUrl: string): {
  channelId?: string;
  forHandle?: string;
  forUsername?: string;
} {
  const id = channelUrl.match(/\/channel\/(UC[\w-]{20,})/)?.[1];
  if (id) return { channelId: id };
  const username = channelUrl.match(/\/user\/([\w.-]+)/)?.[1];
  if (username) return { forUsername: username };
  const handle =
    channelUrl.match(/\/@([\w.-]+)/)?.[1] ??
    channelUrl.match(/youtube\.com\/([\w.-]+)\/?$/)?.[1];
  return handle ? { forHandle: `@${handle.replace(/^@/, "")}` } : {};
}

/**
 * `channels.list` for whatever the configured URL identifies.
 *
 * A URL carrying `/channel/UC…` already knows the id, so it is asked for by id
 * — one call either way, and the id path cannot be confused by a handle
 * somebody else has since taken.
 */
async function lookupChannel(
  newsroomId: number,
  channelUrl: string,
  key: string,
  at: Date,
): Promise<{ channel: YouTubeChannelLookup | null; failure: YouTubeApiFailure | null }> {
  const selector = channelSelector(channelUrl);
  if (!selector.channelId && !selector.forHandle && !selector.forUsername) {
    return { channel: null, failure: unusableReply("that channel URL has no id, handle or username") };
  }
  const params: Record<string, string> = { part: "snippet,contentDetails" };
  if (selector.channelId) params.id = selector.channelId;
  if (selector.forHandle) params.forHandle = selector.forHandle;
  if (selector.forUsername) params.forUsername = selector.forUsername;
  const reply = await callGoogle(newsroomId, youtubeApiUrl("channels", params), key, at);
  if (!reply.ok) return { channel: null, failure: reply.failure };
  const channel = parseChannelLookup(reply.body);
  if (!channel) {
    return {
      channel: null,
      failure: { problem: "not-found", reason: "", message: failureMessage("not-found") },
    };
  }
  return { channel, failure: null };
}

/* ------------------------------------------------------------------ *
 * Listing a channel
 * ------------------------------------------------------------------ */

/**
 * The channel's newest uploads, from the official API.
 *
 * Three calls at most: `channels.list` for the id and the uploads playlist,
 * `playlistItems.list` for the newest 50, `videos.list` for their durations
 * and live state. Never `search.list`, which alone would cost 100 units.
 */
export async function listChannelVideosWithApi(
  channelUrl: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  at: Date = new Date(),
): Promise<YouTubeApiOutcome<YouTubeApiListedVideo[]>> {
  const { key, skipped } = await guard(newsroomId, at);
  if (skipped) return skipped;

  const lookup = await lookupChannel(newsroomId, channelUrl, key, at);
  if (!lookup.channel) {
    const failure = lookup.failure!;
    if (failure.problem === "quota") await blockForToday(newsroomId, at);
    return { used: false, reason: failure.problem === "quota" ? "quota" : "error", message: failure.message };
  }
  const channel = lookup.channel;
  if (!channel.uploadsPlaylistId) {
    return {
      used: false,
      reason: "error",
      message: unusableReply(`Google listed ${channel.channelId} without an uploads playlist`).message,
    };
  }

  const page = await callGoogle(
    newsroomId,
    youtubeApiUrl("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: channel.uploadsPlaylistId,
      maxResults: 50,
    }),
    key,
    at,
  );
  if (!page.ok) {
    if (page.failure.problem === "quota") await blockForToday(newsroomId, at);
    return { used: false, reason: page.failure.problem === "quota" ? "quota" : "error", message: page.failure.message };
  }
  const uploads: YouTubeUploadEntry[] = parseUploadsPage(page.body);
  if (!uploads.length) return { used: true, value: [], units: 2 };

  const details = await callGoogle(
    newsroomId,
    youtubeApiUrl("videos", {
      part: "snippet,contentDetails,liveStreamingDetails,status",
      id: uploads.map((u) => u.videoId).slice(0, 50),
    }),
    key,
    at,
  );
  // A missing details call is not fatal: the uploads listing alone still names
  // every recent video. Durations and live state stay at their defaults, which
  // is what makes meeting capture ask about readiness later rather than
  // skipping a meeting outright.
  const detailRows = details.ok ? parseVideoDetails(details.body) : [];
  return { used: true, value: buildApiVideos(uploads, detailRows), units: details.ok ? 3 : 2 };
}

/**
 * Whether one video can be captured yet, from `videos.list`.
 *
 * This is what replaces the yt-dlp metadata probe. `unknown` is the honest
 * answer when Google has no duration for the video yet, and meeting capture
 * treats it as "try again next scan" rather than as ready.
 */
export async function youtubeCaptureReadinessFromApi(
  videoId: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  at: Date = new Date(),
): Promise<YouTubeApiOutcome<YouTubeCaptureReadiness>> {
  const { key, skipped } = await guard(newsroomId, at);
  if (skipped) return skipped;
  const reply = await callGoogle(
    newsroomId,
    youtubeApiUrl("videos", {
      part: "snippet,contentDetails,liveStreamingDetails,status",
      id: [videoId],
    }),
    key,
    at,
  );
  if (!reply.ok) {
    if (reply.failure.problem === "quota") await blockForToday(newsroomId, at);
    return { used: false, reason: reply.failure.problem === "quota" ? "quota" : "error", message: reply.failure.message };
  }
  const video = parseVideoDetails(reply.body)[0];
  if (!video) {
    return { used: false, reason: "error", message: "Google has no video with that id." };
  }
  return { used: true, value: readinessFromVideo(video), units: 1 };
}

/* ------------------------------------------------------------------ *
 * The desk box
 * ------------------------------------------------------------------ */

export type YouTubeKeyState = {
  hasKey: boolean;
  source: YouTubeKeySource;
  /** The source in words. Never the key, and never a fragment of it. */
  wording: string;
  unitsToday: number;
  unitsLimit: number;
  quotaBlockedToday: boolean;
};

async function keyState(newsroomId: number): Promise<YouTubeKeyState> {
  const { source } = await resolveYouTubeApiKey(newsroomId);
  const row = await readKeyRow(newsroomId);
  return {
    hasKey: source !== "none",
    source,
    wording: describeKeySource(source),
    unitsToday: await readYouTubeUnits(newsroomId),
    unitsLimit: YOUTUBE_DAILY_QUOTA_UNITS,
    quotaBlockedToday: row.quotaBlockedDay === pacificDay(new Date()),
  };
}

export async function getYouTubeKeyState(userId: string): Promise<YouTubeKeyState> {
  const me = await requireEditor(userId);
  return keyState(me.newsroomId);
}

/**
 * Save a key. Write-only: the return value says a key is saved, and nothing
 * that leaves this function carries the key or any part of it.
 */
export async function saveYouTubeApiKey(
  userId: string,
  apiKey: string,
): Promise<YouTubeKeyState> {
  const me = await requireEditor(userId);
  await ensureSchema();
  const sql = await getSql();
  const encrypted = encryptApiKey(apiKey);
  await sql`
    insert into youtube_api_settings(newsroom_id, encrypted_api_key, quota_blocked_day, updated_at)
    values (${me.newsroomId}, ${encrypted}, null, now())
    on conflict(newsroom_id) do update set
      encrypted_api_key = excluded.encrypted_api_key,
      -- A new key deserves a fresh start: last week's quota refusal must not
      -- keep the desk on the public feed after the key has been replaced.
      quota_blocked_day = null,
      updated_at = now()
  `;
  return keyState(me.newsroomId);
}

export async function removeYouTubeApiKey(userId: string): Promise<YouTubeKeyState> {
  const me = await requireEditor(userId);
  await ensureSchema();
  const sql = await getSql();
  await sql`
    insert into youtube_api_settings(newsroom_id, encrypted_api_key, quota_blocked_day, updated_at)
    values (${me.newsroomId}, null, null, now())
    on conflict(newsroom_id) do update set
      encrypted_api_key = null, quota_blocked_day = null, updated_at = now()
  `;
  return keyState(me.newsroomId);
}

export type YouTubeKeyTest = { ok: boolean; message: string };

/**
 * One `channels.list` call, to find out whether Google will take this key.
 *
 * A key given here is tested in place and never stored, so an editor can find
 * out that a key works before saving it. The channel asked about is the first
 * one the desk actually watches, falling back to the handle TownReporter ships
 * with — a real channel is the only honest test, and it doubles as proof that
 * the desk can read the channel it cares about.
 */
export async function testYouTubeApiKey(
  userId: string,
  apiKey?: string,
  at: Date = new Date(),
): Promise<YouTubeKeyTest> {
  const me = await requireEditor(userId);
  const { key } = apiKey?.trim()
    ? { key: apiKey.trim() }
    : await resolveYouTubeApiKey(me.newsroomId);
  if (!key) {
    return { ok: false, message: "Save a key, or type one, before testing." };
  }
  let target = "https://www.youtube.com/@CityofLongmont";
  try {
    const { getPaperConfig } = await import("./paper-settings.ts");
    const config = await getPaperConfig(me.newsroomId);
    if (config.youtubeChannels.length) target = config.youtubeChannels[0]!;
  } catch {
    /* the shipped channel is a fine stand-in */
  }
  // Counted like any other call, so the desk's meter stays honest about what a
  // Test button press costs.
  const lookup = await lookupChannel(me.newsroomId, target, key, at);
  if (lookup.channel) {
    const name = lookup.channel.title || lookup.channel.channelId;
    return { ok: true, message: `Key works. Google answered for the channel ${name}.` };
  }
  return { ok: false, message: lookup.failure!.message };
}
