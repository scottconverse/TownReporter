/* global chrome */
/*
 * Content script on the desk's own pages only (see manifest.json).
 *
 * The desk page asks "anything for me?" with a ready message; this answers
 * once with whatever the button stored and then clears it. That direction --
 * page asks, script answers -- means the desk has its listener attached
 * before anything is posted, with no polling and no timers.
 *
 * The target origin is the page's own origin, and the desk page checks both
 * origin and source before it trusts a single field.
 */
(() => {
  const STORE_KEY = "townreporter.redditSendToDesk";
  const READY = "townreporter:reddit-desk-ready";
  const BRIDGE_READY = "townreporter:reddit-desk-bridge-ready";
  const POSTS = "townreporter:reddit-send-to-desk";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== READY) return;

    chrome.storage.session.get(STORE_KEY).then((stored) => {
      const payload = stored && stored[STORE_KEY];
      if (!payload || !Array.isArray(payload.posts)) return;
      window.postMessage(
        { type: POSTS, posts: payload.posts, capturedAt: payload.capturedAt },
        window.location.origin,
      );
      chrome.storage.session.remove(STORE_KEY);
    });
  });

  // Tell a page that asked before this script loaded that it can ask again.
  window.postMessage({ type: BRIDGE_READY }, window.location.origin);
})();
