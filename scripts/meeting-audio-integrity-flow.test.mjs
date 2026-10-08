// guards: an editor could lose access to the saved recording without a way to replace it
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");

globalThis.__meetingRows = [{
  videoId: "AbCdEfGhI12",
  title: "Council meeting",
  published: "2026-10-06",
  channelUrl: "https://youtube.com/@city",
  status: "captured",
  failureReason: null,
  captionFormat: null,
  captionSha256: null,
  audioFormat: "opus",
  audioSha256: "a".repeat(64),
  audioBytes: 100,
  audioTriggerReason: "captions unavailable",
  audioIntegrityStatus: "hash-mismatch",
  captureDisposition: "final",
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
  canCaptureAgain: true,
}];
globalThis.__captureAgainCalls = [];

const queryUrl = stubUrl(`
export function useQuery() { return { isPending: false, isError: false, data: globalThis.__meetingRows }; }
export function useMutation(options) { return { isPending: false, mutate: (variables) => { void options.mutationFn(variables); } }; }
export function useQueryClient() { return { invalidateQueries: async () => {} }; }
`);
const captureUrl = stubUrl(`
export async function captureAudioAgain({ data }) {
  globalThis.__captureAgainCalls.push(data);
  return { ok: true };
}
`);
const deskCopyUrl = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": stubUrl("export const looksLikeProviderAuthFailure = () => false; export const providerAuthTarget = () => null;"),
  "./lead-match.ts": stubUrl("export const distinguishingOverlap = () => false;"),
  "../paper.ts": stubUrl("export const TOPICS = [];"),
});
const chromeUrl = stubUrl("export function Busy() { return null; } export function SecHead() { return null; }");

const meetingsUrl = await moduleUrl("src/components/meetings-activity.tsx", {
  "@/lib/news/desk-copy": deskCopyUrl,
  "@tanstack/react-query": queryUrl,
  "@/components/desk-chrome": chromeUrl,
  "@/lib/news/meeting-activity": stubUrl("export async function listMeetingActivity() { return globalThis.__meetingRows; }"),
  "@/lib/news/meeting-activity-label": stubUrl("export function meetingStatusLabel() { return { text: 'Captured', tone: 'ok' }; }"),
  "@/lib/news/meeting-manual-run": captureUrl,
});
const { MeetingsActivity } = await import(meetingsUrl);

test("a mismatched recording offers one action that captures it again", async () => {
  const mount = document.getElementById("root");
  const root = createRoot(mount);
  await React.act(async () => {
    root.render(React.createElement(MeetingsActivity));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const alerts = mount.querySelectorAll('[role="alert"]');
  assert.equal(alerts.length, 1, "the meeting should show one integrity notice");
  assert.match(alerts[0].textContent, /audio/i);
  assert.match(alerts[0].textContent, /does not match|mismatch/i);
  const button = [...mount.querySelectorAll("button")].find((node) => node.textContent.trim() === "Capture again");
  assert.ok(button, "the meeting should offer a way to make a new recording");

  await React.act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(globalThis.__captureAgainCalls, [{ videoId: "AbCdEfGhI12" }]);
  await React.act(async () => root.unmount());
});
