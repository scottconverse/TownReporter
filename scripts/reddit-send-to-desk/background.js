/* global chrome */
/*
 * The only code that runs on a click.
 *
 * There is no alarm, no timer, no startup hook and no request to Reddit. The
 * click listener below fires when the editor presses the toolbar button; it
 * reads the tab that is already open, stores the posts in session storage and
 * opens the desk. Nothing else in this extension runs by itself.
 *
 * The desk's content script (desk-bridge.js) cannot read session storage --
 * Chrome does not expose that area to content scripts -- so it asks this
 * service worker for the posts over `chrome.runtime.sendMessage`. The listener
 * at the bottom answers only a message whose sender is this extension and
 * whose origin is one of the two desk origins.
 */
import { MAX_POSTS, isRedditHost, toDeskPosts } from "./parse.js";

const DESK_URL = "https://townreporter.org/desk/dark";
const STORE_KEY = "townreporter.redditSendToDesk";
const NO_POSTS = "No posts found on this page.";
const NEED_REDDIT = "Open a Reddit page first.";
const DEFAULT_TITLE = "Send these posts to the desk";

/** The only frame origins the desk asks from. */
const DESK_ORIGINS = ["https://townreporter.org", "http://127.0.0.1:3100"];
const TAKE_POSTS = "take-posts";

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
    // The page may forbid injection (browser pages, PDF viewer). A failed
    // toast is not worth a console shout.
  }
}

/*
 * On a tab we may not touch, the toolbar button itself is the message: an
 * exclamation badge and a title, scoped to that tab, cleared on the next click
 * on a Reddit page. Nothing is injected into a non-Reddit page.
 */
async function flagTab(tabId, message) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" });
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setTitle({ tabId, title: message });
  } catch {
    // The tab can close mid-click; the badge is cosmetic.
  }
}

async function clearFlag(tabId) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
    await chrome.action.setTitle({ tabId, title: DEFAULT_TITLE });
  } catch {
    // Same as above.
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab?.id;

  if (typeof tabId !== "number") return;

  let url;
  try {
    url = new URL(tab?.url ?? "");
  } catch {
    await clearFlag(tabId);
    await flagTab(tabId, NEED_REDDIT);
    return;
  }

  if (!isRedditHost(url.hostname)) {
    await clearFlag(tabId);
    await flagTab(tabId, NEED_REDDIT);
    return;
  }

  await clearFlag(tabId);

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

/*
 * One message: the desk asks for the posts this click stored. It is answered
 * with the posts (and clears them) only when the speaker is this extension's
 * own content script on one of the two desk origins. `return true` keeps the
 * reply channel open for the async storage read.
 */
let taking = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== TAKE_POSTS) return undefined;

  const origin = typeof sender?.origin === "string" ? sender.origin : "";
  if (sender?.id !== chrome.runtime.id || !DESK_ORIGINS.includes(origin)) {
    sendResponse({ posts: [] });
    return undefined;
  }

  // A second ask while the first is still reading gets nothing, so the same
  // posts can never be handed over twice.
  if (taking) {
    sendResponse({ posts: [] });
    return undefined;
  }
  taking = true;

  chrome.storage.session
    .get(STORE_KEY)
    .then((stored) => {
      const payload = stored && stored[STORE_KEY];
      const posts = payload && Array.isArray(payload.posts) ? payload.posts : [];
      if (!posts.length) {
        sendResponse({ posts: [] });
        return undefined;
      }
      return chrome.storage.session.remove(STORE_KEY).then(() => {
        sendResponse({ posts, capturedAt: payload.capturedAt });
        return undefined;
      });
    })
    .catch(() => {
      sendResponse({ posts: [] });
    })
    .finally(() => {
      taking = false;
    });

  return true;
});
