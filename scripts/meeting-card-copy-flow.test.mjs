// guards: captured meeting cards could hide the usable recording and expose unreadable times or tool diagnostics
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
installDom();
const copy = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": stubUrl("export const looksLikeProviderAuthFailure=()=>false; export const providerAuthTarget=()=>null;"),
  "./lead-match.ts": stubUrl("export const distinguishingOverlap=()=>false;"),
});
const base = { published: "2026-10-07T06:29:30Z", channelUrl: "https://youtube.com/@city", aligned: null, chunks: [], votes: [], revisionCount: 0 };
const rows = [{ ...base, videoId: "blocked", title: "Library Board", status: "failed", failureReason: "WARNING: yt-dlp could not download: socket ECONNRESET\nTraceback: internal tool output" },
  { ...base, videoId: "saved", title: "Council meeting", status: "captured", audioFormat: "mp4", audioBytes: 412000000, artifactFormat: "mp4", artifactBytes: 412000000, artifactSha256: "hidden-hash" }];
const url = await moduleUrl("src/components/meetings-activity.tsx", {
  "@/lib/news/desk-copy": copy,
  "@/lib/paper": await moduleUrl("src/lib/paper.ts"),
  "@/lib/news/meeting-capture-retry": await moduleUrl("src/lib/news/meeting-capture-retry.ts"),
  "@tanstack/react-query": stubUrl(`export const useQuery=()=>({data:${JSON.stringify(rows)}}); export const useMutation=()=>({}); export const useQueryClient=()=>({});`),
  "@/components/desk-chrome": stubUrl("export const Busy=()=>null; export const SecHead=()=>null;"),
  "@/lib/news/meeting-activity": stubUrl("export const listMeetingActivity=()=>[];"),
  "@/lib/news/meeting-activity-label": stubUrl("export const meetingStatusLabel=()=>({text:'Captured',tone:'ok'});"),
  "@/lib/news/meeting-manual-run": stubUrl("export const captureAudioAgain=()=>({ok:true});"),
});
const { MeetingsActivity } = await import(url);
test("captured meeting cards show paper times and plain failures with recording details tucked away", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(renderToStaticMarkup(React.createElement(MeetingsActivity)));
    const text = await page.locator("body").innerText();
    assert.match(text, /Oct\. 7, 12:29 a\.m\./);
    assert.match(text, /The capture failed:/);
    assert.match(text, /Saved audio: MP4, 412 MB/);
    assert.doesNotMatch(text, /WARNING|yt-dlp|ECONNRESET|Traceback|2026-10-07T|hidden-hash|Artifact bytes/);
    await page.getByText("Details", { exact: true }).click();
    assert.match(await page.locator("body").innerText(), /hidden-hash/);
  } finally { await browser.close(); }
});
