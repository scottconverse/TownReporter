/* global chrome */
/*
 * The only code that runs on a click.
 *
 * There is no alarm, no timer, no startup hook and no request to Reddit. The
 * listener below fires when the editor presses the toolbar button; it reads
 * the tab that is already open, stores the posts in session storage and opens
 * the desk. Nothing else in this extension runs by itself.
 */
import { MAX_POSTS, isRedditHost, toDeskPosts } from "./parse.js";

const DESK_URL = "https://townreporter.org/desk/dark";
const STORE_KEY = "townreporter.redditSendToDesk";
const NO_POSTS = "No posts found on this page.";

async function toast(tabId, message) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["collector.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (text) => globalThis.__townreporterRedditToast?.(text),
      args: [message],
    });
  } catch {
    // The page may forbid injection (browser pages, PDF viewer). The badge is
    // the only channel left, and a failed toast is not worth a console shout.
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab?.id;
  let url;
  try {
    url = new URL(tab?.url ?? "");
  } catch {
    await toast(tabId, NO_POSTS);
    return;
  }

  if (!isRedditHost(url.hostname)) {
    await toast(tabId, "Open a Reddit page first.");
    return;
  }

  let posts = [];
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["collector.js"] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (max) => globalThis.__townreporterRedditCollect?.(max) ?? [],
      args: [MAX_POSTS],
    });
    posts = toDeskPosts(result?.result, MAX_POSTS);
  } catch {
    await toast(tabId, NO_POSTS);
    return;
  }

  if (!posts.length) {
    await toast(tabId, NO_POSTS);
    return;
  }

  await chrome.storage.session.set({
    [STORE_KEY]: { posts, capturedAt: Date.now() },
  });
  await chrome.tabs.create({ url: DESK_URL, active: true });
});
