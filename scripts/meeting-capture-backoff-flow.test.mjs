// guards: the desk could lose a meeting recording by retrying YouTube too often or hiding a blocked capture
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";
import { createServer } from "vite";

test("a blocked meeting waits longer between retries and shows its next try", async () => {
  const root = await mkdtemp(join(tmpdir(), "tr-meeting-retry-"));
  const previousDataRoot = process.env.TOWNREPORTER_DATA_ROOT;
  process.env.TOWNREPORTER_DATA_ROOT = root;
  let vite;
  try {
    vite = await createServer({
      configFile: false,
      cacheDir: join(root, "vite-cache"),
      server: { middlewareMode: true, hmr: { port: 0 } },
      resolve: { alias: { "@": join(process.cwd(), "src") } },
    });
    const { runMeetingAwareness, restoreYoutubeCaptureRetries } = await vite.ssrLoadModule("/src/lib/news/meeting-capture.ts");
    const video = {
      id: "AbCdEfGhI12",
      url: "https://www.youtube.com/watch?v=AbCdEfGhI12",
      title: "City Council meeting",
      published: "2026-10-08",
      duration: 1800,
      tab: "feed",
    };
    let now = new Date("2026-10-08T00:00:00.000Z");
    const firstAttemptAt = now.getTime();
    let captureCount = 0;
    const scheduled = [];
    const rows = new Map();
    const sql = {
      async query(statement, params = []) {
        const query = String(statement);
        if (/select enabled from meeting_capture_settings/i.test(query)) return [{ enabled: true }];
        if (/select duration_cap_seconds,size_cap_bytes/i.test(query)) return [{ duration_cap_seconds: 28800, size_cap_bytes: 524288000 }];
        if (/select channel_url,position from meeting_channel_priority/i.test(query)) return [{ channel_url: "https://www.youtube.com/@city" }];
        if (/select r.newsroom_id,r.video_id|select video_id,channel_url,title,published,status,failure_reason/i.test(query)) return [...rows.values()];
        if (/update meeting_capture_records set youtube_retry_day/i.test(query)) {
          Object.assign(rows.get(params[1]), {
            youtube_retry_day: params[2],
            youtube_retry_count: params[3],
            youtube_retry_at: params[4],
          });
          return [{ youtube_retry_at: params[4] }];
        }
        if (/insert into meeting_capture_records/i.test(query)) {
          const [newsroomId, videoId, channelUrl, title, published] = params;
          const row = rows.get(videoId) ?? { newsroom_id: newsroomId, video_id: videoId };
          Object.assign(row, { channel_url: channelUrl, title, published, status: "not-captured" });
          if (/youtube_retry_at/i.test(query)) {
            Object.assign(row, {
              status: "failed",
              failure_reason: "yt-dlp rate limited (HTTP 429)",
              youtube_retry_day: params[5],
              youtube_retry_count: params[6],
              youtube_retry_at: params[7],
            });
          } else if (/failure_reason/i.test(query)) {
            row.status = "failed";
            row.failure_reason = params[5];
          }
          rows.set(videoId, row);
          return [];
        }
        throw new Error(`Unexpected meeting query: ${query}`);
      },
    };
    const deps = {
      listChannelVideos: async () => [video],
      prepareCapturePaths: (_newsroomId, videoId) => ({ archivePath: join(root, `${videoId}.archive`), outputDir: join(root, videoId) }),
      captureMeeting: async () => {
        captureCount += 1;
        return { ok: false, reason: "yt-dlp rate limited (HTTP 429)", stderr: "HTTP Error 429", argv: [] };
      },
      now: () => now,
      scheduleYoutubeRetry: (newsroomId, retryAt) => {
        if (!scheduled.some((entry) => entry.newsroomId === newsroomId && entry.retryAt.getTime() === retryAt.getTime())) {
          scheduled.push({ newsroomId, retryAt });
        }
      },
    };

    rows.set(video.id, {
      newsroom_id: 9,
      video_id: video.id,
      channel_url: "https://www.youtube.com/@city",
      title: video.title,
      published: video.published,
      status: "failed",
      failure_reason: "WARNING: yt-dlp HTTP Error 429: Too Many Requests",
      youtube_retry_count: 0,
      youtube_retry_at: null,
    });
    await runMeetingAwareness(sql, 9, { ...deps, listChannelVideos: async () => [] });
    assert.ok(
      rows.get(video.id).youtube_retry_at,
      "a legacy blocked meeting must receive a retry time even outside the current feed",
    );
    await restoreYoutubeCaptureRetries(sql, now, deps.scheduleYoutubeRetry, 9);
    rows.clear();
    scheduled.length = 0;

    await Promise.all([
      runMeetingAwareness(sql, 9, deps),
      runMeetingAwareness(sql, 9, deps),
    ]);
    assert.equal(captureCount, 1);
    const firstRetry = new Date(rows.get(video.id)?.youtube_retry_at);
    assert.ok(firstRetry.getTime() > now.getTime());
    assert.equal(scheduled.length, 1);

    now = new Date(firstRetry.getTime() - 60_000);
    await runMeetingAwareness(sql, 9, deps);
    assert.equal(captureCount, 1, "a later pass must wait for the saved retry time");

    now = firstRetry;
    await runMeetingAwareness(sql, 9, deps);
    assert.equal(captureCount, 2);
    const secondRetry = new Date(rows.get(video.id)?.youtube_retry_at);
    assert.ok(secondRetry.getTime() - now.getTime() > firstRetry.getTime() - firstAttemptAt);
    assert.equal(scheduled.length, 2);

    now = secondRetry;
    await runMeetingAwareness(sql, 9, deps);
    assert.equal(captureCount, 3);
    const thirdRetry = new Date(rows.get(video.id)?.youtube_retry_at);
    assert.ok(thirdRetry.getTime() - now.getTime() > secondRetry.getTime() - firstRetry.getTime());
    assert.equal(scheduled.length, 3);
    now = new Date(thirdRetry.getTime() - 60_000);
    await runMeetingAwareness(sql, 9, deps);
    assert.equal(captureCount, 3, "the daily limit must prevent another YouTube request");

    installDom();
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const queryStubUrl = transpileToUrl(`
      export let meetingRows = [];
      export function setMeetingRows(rows) { meetingRows = rows; }
      export function useQuery() { return { data: meetingRows, isPending: false }; }
      export function useQueryClient() { return { invalidateQueries: async () => {} }; }
      export function useMutation() { return { mutate() {}, isPending: false }; }
    `, "meeting-query-stub.js");
    const queryStub = await import(queryStubUrl);
    const chromeStubUrl = transpileToUrl(`export function Busy() { return null; } export function SecHead() { return null; }`, "meeting-chrome-stub.js");
    const activityUrl = await moduleUrl("src/components/meetings-activity.tsx", {
      "@/lib/news/meeting-capture-retry": await moduleUrl("src/lib/news/meeting-capture-retry.ts"),
      "@tanstack/react-query": queryStubUrl,
      "@/components/desk-chrome": chromeStubUrl,
      "@/lib/news/meeting-activity": transpileToUrl("export async function listMeetingActivity() { return []; }", "meeting-activity-stub.js"),
      "@/lib/news/meeting-manual-run": transpileToUrl("export async function captureAudioAgain() { return { ok: true }; }", "meeting-manual-run-stub.js"),
      "@/lib/news/meeting-activity-label": transpileToUrl("export function meetingStatusLabel() { return { text: 'Capture blocked', tone: 'bad' }; }", "meeting-activity-label-stub.js"),
      "@/lib/news/desk-copy": await moduleUrl("src/lib/news/desk-copy.ts", {
        "./preflight.ts": transpileToUrl("export function looksLikeProviderAuthFailure() { return false; } export function providerAuthTarget() { return ''; }", "preflight-stub.js"),
        "./lead-match.ts": transpileToUrl("export function distinguishingOverlap() { return { subjects: 0, names: 0 }; }", "lead-match-stub.js"),
      }),
    });
    queryStub.setMeetingRows([{
      videoId: video.id,
      title: video.title,
      published: video.published,
      channelUrl: "https://www.youtube.com/@city",
      status: "failed",
      failureReason: "yt-dlp rate limited (HTTP 429)",
      youtubeRetryAt: null,
      audioIntegrityStatus: null,
      canCaptureAgain: false,
      captureDisposition: null,
      revisionCount: 0,
      settledUnderChurn: false,
      forcedRecapture: false,
      artifactPath: null,
      artifactFormat: null,
      artifactSha256: null,
      artifactBytes: null,
      aligned: null,
      alignmentReason: null,
      chunks: [],
      votes: [],
      leadId: null,
      leadStatus: null,
      draftId: null,
      citationCount: 0,
    }]);
    const { MeetingsActivity } = await import(activityUrl);
    const markup = renderToStaticMarkup(React.createElement(MeetingsActivity));
    assert.match(markup, /Capture blocked by YouTube \(too many requests\)\. Next try/);
    assert.doesNotMatch(markup, /yt-dlp rate limited/);

    now = thirdRetry;
    await runMeetingAwareness(sql, 9, deps);
    assert.equal(captureCount, 4, "the saved retry becomes eligible after the UTC day rolls over");
  } finally {
    await vite?.close();
    if (previousDataRoot === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
    else process.env.TOWNREPORTER_DATA_ROOT = previousDataRoot;
    await rm(root, { recursive: true, force: true });
  }
});
