import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import {
  buildApiVideos,
  classifyYouTubeApiFailure,
  isoDurationSeconds,
  pacificDay,
  parseChannelLookup,
  parseUploadsPage,
  parseVideoDetails,
  readinessFromVideo,
  redactSecret,
  youtubeReadPathLine,
  youtubeUsageLine,
} from "./youtube-data-api.ts";
import {
  channelSelector,
  getYouTubeKeyState,
  listChannelVideosWithApi,
  readYouTubeUnits,
  removeYouTubeApiKey,
  saveYouTubeApiKey,
  setYouTubeTransportForTests,
  testYouTubeApiKey,
  youtubeApiKeyFromEnv,
  youtubeCaptureReadinessFromApi,
} from "./youtube-data-api.server.ts";

/*
  Unit AN: the YouTube Data API path, against a fake Google.

  NO TEST HERE MAY REACH GOOGLE. There is no key, no socket and no DNS: every
  call goes through `setYouTubeTransportForTests`, so the only HTTP this file
  can produce is the answer the fake hands back. That is also why the transport
  seam exists -- the alternative, stubbing global fetch, would leave the SSRF
  guard and the real undici client in the path.

  The last test is the one that matters most: whatever Google says, and however
  the desk words it, the key itself must not appear in a reply, a URL, a log
  line or an error.
*/

const NEWSROOM = 73;
const EDITOR = "an-youtube-editor";
const CHANNEL_URL = "https://www.youtube.com/@CityofLongmont";
const KEY = "AIzaFAKE-key-for-unit-AN-9xQ2";

type Hit = { url: string; key: string | null };
let hits: Hit[] = [];
let prints: string[] = [];
let restoreConsole: (() => void) | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Install a fake Google for one test. Handlers are keyed by endpoint name. */
function fakeGoogle(handlers: Record<string, (url: URL) => Response>): void {
  setYouTubeTransportForTests(async (url, init) => {
    const headers = new Headers((init.headers ?? {}) as HeadersInit);
    hits.push({ url: url.toString(), key: headers.get("x-goog-api-key") });
    const endpoint = url.pathname.split("/").pop() ?? "";
    const handler = handlers[endpoint];
    if (!handler) return json(500, { error: { code: 500, message: `no fake for ${endpoint}` } });
    return handler(url);
  });
}

const CHANNEL_BODY = {
  items: [
    {
      id: "UCfake0000000000000000AA",
      snippet: { title: "City of Longmont" },
      contentDetails: { relatedPlaylists: { uploads: "UUfake0000000000000000AA" } },
    },
  ],
};

function playlistBody(entries: Array<{ id: string; title: string; at: string }>): unknown {
  return {
    items: entries.map((e) => ({
      snippet: {
        title: e.title,
        publishedAt: e.at,
        resourceId: { kind: "youtube#video", videoId: e.id },
      },
      contentDetails: { videoId: e.id, videoPublishedAt: e.at },
    })),
  };
}

function videoBody(
  rows: Array<{
    id: string;
    title?: string;
    duration?: string;
    broadcast?: string;
    scheduled?: string;
    actualStart?: string;
    description?: string;
    published?: string;
  }>,
): unknown {
  return {
    items: rows.map((r) => ({
      id: r.id,
      snippet: {
        title: r.title ?? "Longmont City Council Regular Meeting",
        publishedAt: r.published ?? "2026-09-20T01:00:00Z",
        description: r.description ?? "Agenda and packet.",
        liveBroadcastContent: r.broadcast ?? "none",
      },
      contentDetails: { duration: r.duration ?? "PT1H2M3S" },
      liveStreamingDetails: {
        ...(r.scheduled ? { scheduledStartTime: r.scheduled } : {}),
        ...(r.actualStart ? { actualStartTime: r.actualStart } : {}),
      },
      status: { privacyStatus: "public" },
    })),
  };
}

/*
  The guard, the meter and the key box all read the real clock -- the desk has
  to know which Pacific day it is, and there is no seam worth building for
  that. So the DB-backed tests derive their days from now: TODAY is the Pacific
  day this run is in, and TOMORROW is 26 hours later, which is always a
  different Pacific day.
*/
const TODAY = new Date();
const TOMORROW = new Date(Date.now() + 26 * 60 * 60 * 1000);

const QUOTA_403 = {
  error: {
    code: 403,
    message: "The request cannot be completed because you have exceeded your quota.",
    errors: [{ reason: "quotaExceeded", domain: "youtube.quota" }],
  },
};

const BAD_KEY_400 = {
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    errors: [{ reason: "keyInvalid", domain: "usageLimits" }],
  },
};

/** Everything this test run has printed, plus console's own output, is watched. */
function watchConsole(): void {
  prints = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      prints.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
  restoreConsole = () => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  };
}

describe("YouTube Data API: the pure half", () => {
  it("reads ISO durations and refuses to invent one", () => {
    assert.equal(isoDurationSeconds("PT1H2M3S"), 3723);
    assert.equal(isoDurationSeconds("PT45S"), 45);
    assert.equal(isoDurationSeconds("P1DT2H"), 93600);
    assert.equal(isoDurationSeconds("P0D"), 0, "an unknown duration is 0, not a zero-length video");
    assert.equal(isoDurationSeconds(""), 0);
    assert.equal(isoDurationSeconds("90 seconds"), 0);
  });

  it("names the day in Google's own timezone, not the server's", () => {
    assert.equal(pacificDay(new Date("2026-09-25T20:00:00Z")), "2026-09-25");
    // 04:00 UTC is still the previous day in Pacific, which is when Google's
    // 10,000 units reset.
    assert.equal(pacificDay(new Date("2026-09-26T04:00:00Z")), "2026-09-25");
    assert.equal(pacificDay(new Date("2026-09-26T07:00:00Z")), "2026-09-26");
  });

  it("reads the channel selector from any of the three channel URL shapes", () => {
    assert.deepEqual(channelSelector("https://www.youtube.com/@CityofLongmont"), {
      forHandle: "@CityofLongmont",
    });
    assert.deepEqual(channelSelector("https://www.youtube.com/user/longmontcolorado"), {
      forUsername: "longmontcolorado",
    });
    assert.deepEqual(channelSelector("https://www.youtube.com/channel/UCfake0000000000000000AA"), {
      channelId: "UCfake0000000000000000AA",
    });
    assert.deepEqual(
      channelSelector("https://example.test/not-youtube"),
      {},
      "a URL that identifies nothing yields nothing, and lookupChannel then refuses it",
    );
  });

  it("parses a channel lookup, an uploads page and a details page", () => {
    assert.deepEqual(parseChannelLookup(CHANNEL_BODY), {
      channelId: "UCfake0000000000000000AA",
      title: "City of Longmont",
      uploadsPlaylistId: "UUfake0000000000000000AA",
    });
    assert.equal(parseChannelLookup({ items: [] }), null);

    const uploads = parseUploadsPage(
      playlistBody([
        { id: "vid00000001", title: "Council 9/23", at: "2026-09-24T01:00:00Z" },
        { id: "vid00000002", title: "Deleted video", at: "2026-09-23T01:00:00Z" },
        { id: "vid00000003", title: "Private video", at: "2026-09-22T01:00:00Z" },
      ]),
    );
    assert.deepEqual(
      uploads.map((u) => u.videoId),
      ["vid00000001"],
      "a deleted or private placeholder has no video to open and is dropped",
    );

    const details = parseVideoDetails(
      videoBody([
        { id: "vid00000001", duration: "PT2H1M" },
        { id: "vid00000002", duration: "P0D", broadcast: "upcoming", scheduled: "2026-10-01T01:00:00Z" },
        { id: "vid00000003", duration: "P0D", broadcast: "live" },
        { id: "vid00000004", duration: "PT30M", actualStart: "2026-09-01T01:00:00Z" },
      ]),
    );
    assert.deepEqual(
      details.map((v) => [v.id, v.duration, v.live]),
      [
        ["vid00000001", 7260, "vod"],
        ["vid00000002", 0, "upcoming"],
        ["vid00000003", 0, "live"],
        ["vid00000004", 1800, "ended"],
      ],
    );
    assert.equal(details[1]!.scheduled, "2026-10-01T01:00:00Z");
  });

  it("turns a video's live state and duration into a capture readiness", () => {
    assert.equal(readinessFromVideo({ live: "upcoming", duration: 0 }), "upcoming");
    assert.equal(readinessFromVideo({ live: "live", duration: 0 }), "live");
    assert.equal(readinessFromVideo({ live: "ended", duration: 3723 }), "ready");
    assert.equal(readinessFromVideo({ live: "vod", duration: 60 }), "ready");
    assert.equal(
      readinessFromVideo({ live: "ended", duration: 0 }),
      "unknown",
      "a broadcast Google has no duration for is 'ask again', never 'ready'",
    );
  });

  it("keeps an upload whose details call did not return it", () => {
    const rows = buildApiVideos(
      [{ videoId: "vid00000009", title: "Council 9/23", published: "2026-09-24T01:00:00Z" }],
      [],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.duration, 0);
    assert.equal(rows[0]!.tab, "api");
    assert.equal(rows[0]!.url, "https://www.youtube.com/watch?v=vid00000009");
  });

  it("classifies Google's refusals by status and reason together", () => {
    const badKey = classifyYouTubeApiFailure(400, BAD_KEY_400);
    assert.equal(badKey.problem, "bad-key");
    assert.equal(badKey.reason, "keyInvalid");
    assert.match(badKey.message, /Google says this key is not allowed to use the YouTube Data API/);

    // The same 403 is a used-up quota, a restricted key, or a disabled API.
    assert.equal(classifyYouTubeApiFailure(403, QUOTA_403).problem, "quota");
    assert.equal(
      classifyYouTubeApiFailure(403, {
        error: { code: 403, message: "no", errors: [{ reason: "ipRefererBlocked" }] },
      }).problem,
      "bad-key",
    );
    assert.equal(
      classifyYouTubeApiFailure(403, {
        error: { code: 403, message: "no", errors: [{ reason: "accessNotConfigured" }] },
      }).problem,
      "bad-key",
    );
    assert.equal(
      classifyYouTubeApiFailure(404, { error: { code: 404, message: "nope" } }).problem,
      "not-found",
    );
    assert.match(classifyYouTubeApiFailure(403, QUOTA_403).message, /midnight Pacific/);
  });

  it("words the read path exactly once per path, and says the fallback reason", () => {
    assert.equal(youtubeReadPathLine("api"), "Read YouTube with the official API.");
    assert.equal(
      youtubeReadPathLine("feed", null),
      "No YouTube key; read the public feed.",
      "no key is not a failure and must not read like one",
    );
    assert.equal(
      youtubeReadPathLine("feed", classifyYouTubeApiFailure(400, BAD_KEY_400).message),
      "Google says this key is not allowed to use the YouTube Data API. Check that the key is right, that the YouTube Data API v3 is turned on for its project, and that the key is not restricted to another API. Read the public feed instead.",
    );
  });

  it("shows the unit meter in the thousands a person reads", () => {
    assert.equal(youtubeUsageLine(0), "YouTube units used today: 0 of 10,000");
    assert.equal(youtubeUsageLine(1234), "YouTube units used today: 1,234 of 10,000");
    assert.equal(youtubeUsageLine(Number.NaN), "YouTube units used today: 0 of 10,000");
  });

  it("scrubs the key out of anything an editor is about to read", () => {
    assert.equal(
      redactSecret(`Request failed: key=${KEY} was rejected`, KEY),
      "Request failed: key=[the key] was rejected",
    );
    assert.equal(redactSecret("nothing to hide", KEY), "nothing to hide");
  });
});

describe("YouTube Data API: the calls", () => {
  before(async () => {
    process.env.BETTER_AUTH_SECRET = "unit-an-youtube-test-secret";
    await ensureNewsroomSchema();
    const sql = await getSql();
    await sql.query("insert into newsrooms(id,name) values(73,'Gamma') on conflict(id) do nothing");
    await sql.query(
      `insert into newsroom_members(user_id,role,newsroom_id) values('${EDITOR}','editor',73)
       on conflict(user_id) do update set newsroom_id=excluded.newsroom_id,role=excluded.role`,
    );
  });

  beforeEach(async () => {
    hits = [];
    delete process.env.YOUTUBE_API_KEY;
    watchConsole();
    setYouTubeTransportForTests(null);
    const sql = await getSql();
    await sql.query("delete from youtube_api_settings where newsroom_id = 73").catch(() => undefined);
    await sql.query("delete from youtube_api_usage where newsroom_id = 73").catch(() => undefined);
    setYouTubeTransportForTests(null);
  });

  afterEach(() => {
    setYouTubeTransportForTests(null);
    restoreConsole?.();
    restoreConsole = null;
    delete process.env.YOUTUBE_API_KEY;
  });

  it("finds a channel by handle, then lists and details its newest uploads", async () => {
    await saveYouTubeApiKey(EDITOR, KEY);
    fakeGoogle({
      channels: () => json(200, CHANNEL_BODY),
      playlistItems: (url) => {
        assert.equal(url.searchParams.get("playlistId"), "UUfake0000000000000000AA");
        assert.equal(url.searchParams.get("maxResults"), "50");
        return json(
          200,
          playlistBody([
            { id: "vid00000001", title: "Council 9/23", at: "2026-09-24T01:00:00Z" },
            { id: "vid00000002", title: "Council 9/16", at: "2026-09-17T01:00:00Z" },
          ]),
        );
      },
      videos: (url) => {
        assert.equal(url.searchParams.get("id"), "vid00000001,vid00000002");
        assert.match(url.searchParams.get("part") ?? "", /liveStreamingDetails/);
        return json(
          200,
          videoBody([
            { id: "vid00000001", title: "Council 9/23", duration: "PT1H2M3S" },
            {
              id: "vid00000002",
              title: "Council 9/16",
              duration: "P0D",
              broadcast: "live",
            },
          ]),
        );
      },
    });

    const outcome = await listChannelVideosWithApi(
      CHANNEL_URL,
      NEWSROOM,
      new Date("2026-09-25T20:00:00Z"),
    );
    assert.equal(outcome.used, true);
    assert.ok(outcome.used);
    assert.deepEqual(
      hits.map((h) => new URL(h.url).pathname.split("/").pop()),
      ["channels", "playlistItems", "videos"],
      "three calls, none of them search.list",
    );
    assert.match(hits[0]!.url, /forHandle=%40CityofLongmont/);
    assert.equal(hits[0]!.key, KEY, "the key travels in the header");
    assert.equal(
      hits.some((h) => h.url.includes(KEY)),
      false,
      "the key must never be a query parameter",
    );
    assert.deepEqual(
      outcome.value.map((v) => [v.id, v.title, v.duration, v.live, v.tab]),
      [
        ["vid00000001", "Council 9/23", 3723, "vod", "api"],
        ["vid00000002", "Council 9/16", 0, "live", "api"],
      ],
    );
    assert.equal(outcome.units, 3);
    assert.equal(await readYouTubeUnits(NEWSROOM, new Date("2026-09-25T20:00:00Z")), 3);
  });

  it("maps upcoming, live and ready state straight to what capture can do", async () => {
    await saveYouTubeApiKey(EDITOR, KEY);
    const at = new Date("2026-09-25T20:00:00Z");
    const details = videoBody([
      { id: "vid00000011", duration: "PT1H", actualStart: "2026-09-24T01:00:00Z" },
      { id: "vid00000012", duration: "P0D", broadcast: "live" },
      { id: "vid00000013", duration: "P0D", broadcast: "upcoming", scheduled: "2026-10-01T01:00:00Z" },
      { id: "vid00000014", duration: "P0D" },
    ]);
    fakeGoogle({
      channels: () => json(200, CHANNEL_BODY),
      playlistItems: () =>
        json(
          200,
          playlistBody([
            { id: "vid00000011", title: "a", at: "2026-09-24T01:00:00Z" },
            { id: "vid00000012", title: "b", at: "2026-09-24T01:00:00Z" },
            { id: "vid00000013", title: "c", at: "2026-09-24T01:00:00Z" },
            { id: "vid00000014", title: "d", at: "2026-09-24T01:00:00Z" },
          ]),
        ),
      videos: () => json(200, details),
    });

    const listing = await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, at);
    assert.ok(listing.used);
    assert.deepEqual(
      listing.value.map((v) => [v.id, v.live, readinessFromVideo(v), v.scheduled]),
      [
        ["vid00000011", "ended", "ready", ""],
        ["vid00000012", "live", "live", ""],
        ["vid00000013", "upcoming", "upcoming", "2026-10-01T01:00:00Z"],
        ["vid00000014", "vod", "unknown", ""],
      ],
    );

    // Readiness for one video, which is what replaced the yt-dlp metadata probe.
    fakeGoogle({ videos: () => json(200, details) });
    const one = await youtubeCaptureReadinessFromApi("vid00000011", NEWSROOM, at);
    assert.deepEqual(one, { used: true, value: "ready", units: 1 });
  });

  it("answers a bad key with Google's plain words and falls back to the feed", async () => {
    await saveYouTubeApiKey(EDITOR, KEY);
    fakeGoogle({
      channels: () => json(400, BAD_KEY_400),
    });

    const outcome = await listChannelVideosWithApi(
      CHANNEL_URL,
      NEWSROOM,
      new Date("2026-09-25T20:00:00Z"),
    );
    assert.equal(outcome.used, false);
    assert.ok(!outcome.used);
    assert.equal(outcome.reason, "error");
    assert.equal(
      outcome.message,
      "Google says this key is not allowed to use the YouTube Data API. Check that the key is right, that the YouTube Data API v3 is turned on for its project, and that the key is not restricted to another API.",
    );
    assert.equal(
      youtubeReadPathLine("feed", outcome.message),
      `${outcome.message} Read the public feed instead.`,
    );

    // A bad key is not a quota refusal: tomorrow's attempt is still allowed.
    const state = await getYouTubeKeyState(EDITOR);
    assert.equal(state.quotaBlockedToday, false);
    assert.equal(state.hasKey, true, "the desk keeps the saved key so it can be corrected");
  });

  it("stops asking for the rest of the Pacific day after a quota refusal", async () => {
    await saveYouTubeApiKey(EDITOR, KEY);
    fakeGoogle({ channels: () => json(403, QUOTA_403) });

    const first = await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TODAY);
    assert.ok(!first.used);
    assert.equal(first.reason, "quota");
    assert.equal(hits.length, 1);
    assert.match(first.message, /allowance for today is used up/);

    const again = await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TODAY);
    assert.ok(!again.used);
    assert.equal(again.reason, "blocked");
    assert.equal(hits.length, 1, "no second call is made the same Pacific day");
    assert.equal((await getYouTubeKeyState(EDITOR)).quotaBlockedToday, true);

    fakeGoogle({
      channels: () => json(200, CHANNEL_BODY),
      playlistItems: () =>
        json(200, playlistBody([{ id: "vid00000021", title: "Council", at: "2026-09-26T01:00:00Z" }])),
      videos: () => json(200, videoBody([{ id: "vid00000021" }])),
    });
    /*
      The refusal is recorded against the day it happened on, so next Pacific
      day it no longer matches and the API is tried again. Nothing clears the
      column: `getYouTubeKeyState` still reports quotaBlockedToday true here
      because the desk's real "today" is the day it was refused on.
    */
    const before = hits.length;
    const next = await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TOMORROW);
    assert.equal(next.used, true, "the refusal does not outlive the Pacific day");
    assert.equal(hits.length - before, 3, "the new day gets the full three-call read");
  });

  it("refuses to call Google once today's 10,000 units are spent", async () => {
    await saveYouTubeApiKey(EDITOR, KEY);
    const sql = await getSql();
    await sql.query(
      `insert into youtube_api_usage(newsroom_id, day, units) values(73, '${pacificDay(TODAY)}', 10000)`,
    );
    fakeGoogle({ channels: () => json(200, CHANNEL_BODY) });

    const outcome = await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TODAY);
    assert.ok(!outcome.used);
    assert.equal(outcome.reason, "quota");
    assert.match(outcome.message, /allowance for today is used up/);
    assert.equal(hits.length, 0, "the ceiling is enforced before a call is made");
  });

  it("says there is no key rather than reaching Google without one", async () => {
    fakeGoogle({ channels: () => json(200, CHANNEL_BODY) });
    const outcome = await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, new Date());
    assert.ok(!outcome.used);
    assert.equal(outcome.reason, "no-key");
    assert.equal(hits.length, 0);
    assert.equal(youtubeReadPathLine("feed", null), "No YouTube key; read the public feed.");
  });

  it("keeps the key box write-only: state in, no key out", async () => {
    const before = await getYouTubeKeyState(EDITOR);
    assert.deepEqual(before, {
      hasKey: false,
      source: "none",
      wording: "No key.",
      unitsToday: 0,
      unitsLimit: 10_000,
      quotaBlockedToday: false,
    });

    const saved = await saveYouTubeApiKey(EDITOR, KEY);
    assert.equal(saved.hasKey, true);
    assert.equal(saved.source, "stored");
    assert.equal(saved.wording, "A key is saved.");
    assert.equal(JSON.stringify(saved).includes(KEY), false);
    assert.equal(Object.values(saved).some((v) => String(v).includes(KEY)), false);

    const sql = await getSql();
    const rows = await sql<{ encrypted_api_key: string }>`
      select encrypted_api_key from youtube_api_settings where newsroom_id = 73
    `;
    const stored = rows[0]!.encrypted_api_key;
    assert.equal(stored.includes(KEY), false, "what lands in the column is ciphertext");
    assert.match(stored, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const removed = await removeYouTubeApiKey(EDITOR);
    assert.equal(removed.hasKey, false);
    assert.equal(removed.wording, "No key.");
  });

  it("takes YOUTUBE_API_KEY from the app environment as an override", async () => {
    await saveYouTubeApiKey(EDITOR, "AIzaSTORED-key-that-the-environment-overrides");
    process.env.YOUTUBE_API_KEY = KEY;
    assert.equal(youtubeApiKeyFromEnv(), KEY);
    const state = await getYouTubeKeyState(EDITOR);
    assert.equal(state.source, "env");
    assert.equal(state.hasKey, true);
    assert.equal(JSON.stringify(state).includes(KEY), false);

    fakeGoogle({ channels: () => json(200, CHANNEL_BODY) });
    await listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, new Date("2026-09-25T20:00:00Z"));
    assert.equal(hits[0]!.key, KEY, "the environment's key is the one that travels");
  });

  it("tests a typed key without storing it, and names the channel Google answered for", async () => {
    fakeGoogle({
      channels: (url) => {
        // No meeting channels are configured for newsroom 73, so the desk asks
        // about the channel TownReporter ships with -- a real channel is the
        // only honest test.
        assert.equal(url.searchParams.get("forHandle"), "@CityofLongmont");
        return json(200, CHANNEL_BODY);
      },
    });
    const result = await testYouTubeApiKey(EDITOR, "AIzaTYPED-key-never-saved", TODAY);
    assert.deepEqual(result, {
      ok: true,
      message: "Key works. Google answered for the channel City of Longmont.",
    });

    const sql = await getSql();
    const rows = await sql<{ encrypted_api_key: string | null }>`
      select encrypted_api_key from youtube_api_settings where newsroom_id = 73
    `;
    assert.equal(rows[0]?.encrypted_api_key ?? null, null, "a tested key is not saved");
    // The unit spent by the test is counted like any other.
    assert.equal(await readYouTubeUnits(NEWSROOM, TODAY), 1);
  });

  it("reports a rejected key in plain words and never stores it either", async () => {
    await saveYouTubeApiKey(EDITOR, KEY);
    fakeGoogle({ channels: () => json(400, BAD_KEY_400) });
    const result = await testYouTubeApiKey(
      EDITOR,
      "AIzaTYPED-key-that-google-refuses",
      new Date("2026-09-25T20:00:00Z"),
    );
    assert.equal(result.ok, false);
    assert.match(result.message, /Google says this key is not allowed to use the YouTube Data API/);
    assert.equal(result.message.includes("AIzaTYPED-key-that-google-refuses"), false);
  });

  it("says nothing to test with when there is no key and none was typed", async () => {
    fakeGoogle({ channels: () => json(200, CHANNEL_BODY) });
    const result = await testYouTubeApiKey(EDITOR);
    assert.equal(result.ok, false);
    assert.equal(result.message, "Save a key, or type one, before testing.");
    assert.equal(hits.length, 0);
  });

  /*
    The one that matters. A hostile or merely careless Google is imagined here:
    its error body quotes the key back. The desk must still not be able to print
    it -- in the value it returns, in the URL it built, in anything it logged,
    or in an exception.
  */
  it("never lets the key appear in a reply, a URL, a log line or an error", async () => {
    /*
      A hostile or merely careless Google is imagined here: its error body
      quotes the key back, and the quota sentence carries it too. The desk must
      still not be able to print it -- in the value it returns, in the URL it
      built, in anything it logged, or in an exception.

      Each case is run immediately after its own fake is installed, because
      there is one transport and the newest fake is the one in force.
    */
    const loud = {
      error: {
        code: 400,
        message: `API key not valid: ${KEY}`,
        errors: [{ reason: "keyInvalid", message: `key=${KEY}` }],
      },
    };
    await saveYouTubeApiKey(EDITOR, KEY);
    const replies: unknown[] = [];
    const attempt = async (run: () => Promise<unknown>) => {
      try {
        replies.push(await run());
      } catch (err) {
        replies.push(err instanceof Error ? err.message : String(err));
      }
    };

    fakeGoogle({ channels: () => json(400, loud) });
    await attempt(() => listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TODAY));
    await attempt(() => testYouTubeApiKey(EDITOR, undefined, TODAY));
    await attempt(() => getYouTubeKeyState(EDITOR));

    fakeGoogle({
      channels: () => json(403, { ...QUOTA_403, message: `${QUOTA_403.error.message} ${KEY}` }),
    });
    await attempt(() => listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TODAY));

    fakeGoogle({ channels: () => json(200, CHANNEL_BODY), playlistItems: () => json(200, loud) });
    await attempt(() => listChannelVideosWithApi(CHANNEL_URL, NEWSROOM, TOMORROW));

    const everything = JSON.stringify(replies);
    assert.equal(everything.includes(KEY), false, "no reply may carry the key");
    assert.equal(prints.join("\n").includes(KEY), false, "nothing may log the key");
    assert.equal(
      hits.some((h) => h.url.includes(KEY)),
      false,
      "no request URL may carry the key",
    );
    assert.equal(
      hits.length > 0 && hits.every((h) => h.key === KEY),
      true,
      "the key is present in every request header, so the check above is about where it sits",
    );
    // And the desk still had something honest to say in each case.
    assert.match(everything, /Google says this key is not allowed to use the YouTube Data API/);
    assert.match(everything, /allowance for today is used up/);
    assert.match(everything, /"wording":"A key is saved\."/);
  });
});
