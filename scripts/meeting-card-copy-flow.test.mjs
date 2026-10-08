// guards: captured meeting cards could hide the usable recording and expose unreadable times or tool diagnostics
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
installDom();
const copy = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": stubUrl("export const looksLikeProviderAuthFailure=()=>false; export const providerAuthTarget=()=>null;"),
  "./lead-match.ts": stubUrl("export const distinguishingOverlap=()=>false;"),
});
const base = { published: "2026-10-07T06:29:30Z", channelUrl: "https://youtube.com/@city", aligned: null, chunks: [], votes: [], revisionCount: 0 };
const rows = [{ ...base, published: "2026-10-07T05:29:30Z", videoId: "blocked", title: "Library Board", status: "failed", failureReason: "WARNING: yt-dlp could not download: socket ECONNRESET\nTraceback: internal tool output" },
  { ...base, videoId: "saved", title: "Council meeting", status: "captured", audioFormat: "mp4", audioBytes: 412000000, artifactFormat: "mp4", artifactBytes: 412000000, artifactSha256: "hidden-hash" },
  { ...base, published: "2026-10-07", videoId: "date-only", title: "Planning meeting", status: "pending" }];
const paperUrl = await moduleUrl("src/lib/paper.ts");
const { PAPER } = await import(paperUrl);
const url = await moduleUrl("src/components/meetings-activity.tsx", {
  "@/lib/news/desk-copy": copy,
  "@/lib/paper": paperUrl,
  "@/lib/news/meeting-capture-retry": await moduleUrl("src/lib/news/meeting-capture-retry.ts"),
  "@tanstack/react-query": stubUrl(`export const useQuery=()=>({data:${JSON.stringify(rows)}}); export const useMutation=()=>({}); export const useQueryClient=()=>({});`),
  "@/components/desk-chrome": stubUrl("export const Busy=()=>null; export const SecHead=()=>null;"),
  "@/lib/news/meeting-activity": stubUrl("export const listMeetingActivity=()=>[];"),
  "@/lib/news/meeting-activity-label": stubUrl("export const meetingStatusLabel=()=>({text:'Captured',tone:'ok'});"),
  "@/lib/news/meeting-manual-run": stubUrl("export const captureAudioAgain=()=>({ok:true});"),
});
const { MeetingsActivity } = await import(url);
test("captured meeting cards show paper times and plain failures with recording details tucked away", async () => {
  const { document } = parseHTML(renderToStaticMarkup(React.createElement(MeetingsActivity)));
  const cards = [...document.querySelectorAll("article")];
  assert.equal(cards.length, rows.length);
  for (const [index, row] of rows.entries()) {
    const text = cards[index].querySelector("p.meta").textContent;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(row.published);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: dateOnly ? "UTC" : PAPER.timezone,
      month: "short", day: "numeric",
      ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit", hour12: true }),
    }).formatToParts(new Date(dateOnly ? `${row.published}T12:00:00Z` : row.published));
    const part = (type) => parts.find((p) => p.type === type)?.value;
    // Check the calendar day and clock meaning; punctuation and optional year may vary.
    assert.match(text, new RegExp(`\\b${part("month")}\\.? ${part("day")}\\b`));
    if (dateOnly) assert.doesNotMatch(text, /\d+:\d+/);
    else {
      assert.match(text, new RegExp(`\\b${part("hour")}:${part("minute")}\\b`));
      assert.match(text.replaceAll(".", "").toLowerCase(), new RegExp(`\\b${part("dayPeriod").toLowerCase()}\\b`));
    }
  }
  assert.match(cards[0].querySelector('[role="alert"]').textContent, /capture.*failed.*connection.*interrupted/i);
  assert.match(cards[1].textContent, /saved audio.*MP4.*412\s*MB/i);
  const details = cards[1].querySelector("details");
  assert.ok(details, "recording metadata has a native disclosure");
  assert.equal(details.hasAttribute("open"), false, "recording metadata starts collapsed");
  assert.ok(details.querySelector("summary")?.textContent.trim(), "the disclosure has a usable label");
  assert.match(details.textContent, /hidden-hash/);
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: "msedge" }) });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(renderToStaticMarkup(React.createElement(MeetingsActivity)));
    const card = page.locator("article").nth(1);
    const audio = card.locator("p").filter({ hasText: /MP4.*412\s*MB/i });
    assert.equal(await audio.isVisible(), false, "audio format and size stay hidden while Details is closed");
    await card.locator("summary").click();
    assert.equal(await audio.isVisible(), true, "opening Details reveals the saved audio metadata");
    assert.equal(await card.getByText("hidden-hash", { exact: true }).isVisible(), true);
    await card.locator("summary").click();
    assert.equal(await audio.isVisible(), false);
  } finally { await browser.close(); }
  // linkedom has no native disclosure default action. Verify its rendered structure,
  // then exclude the collapsed contents when checking the card's visible copy.
  for (const child of [...details.children]) if (child.tagName !== "SUMMARY") child.remove();
  const text = cards.map((card) => card.textContent).join("\n");
  assert.doesNotMatch(text, /WARNING|yt-dlp|ECONNRESET|Traceback|2026-10-07T|hidden-hash|Artifact bytes/);
});
