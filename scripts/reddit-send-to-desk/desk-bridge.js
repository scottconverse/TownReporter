/* global chrome */
/*
 * Content script on the desk's own pages only (see manifest.json).
 *
 * A content script cannot read `chrome.storage.session` (Chrome reserves that
 * area for trusted extension contexts), so this file never touches storage.
 * Instead, when the desk page asks "anything for me?" it forwards that ask to
 * the service worker, which reads the stored posts, clears them and replies.
 * The bridge then hands the reply to the page with `window.postMessage`.
 *
 * The target origin is the page's own origin, and the desk page checks both
 * origin and source before it trusts a single field. A missing reply or an
 * invalidated extension context is swallowed: the desk simply shows nothing.
 */
(() => {
  const READY = "townreporter:reddit-desk-ready";
  const BRIDGE_READY = "townreporter:reddit-desk-bridge-ready";
  const POSTS = "townreporter:reddit-send-to-desk";
  const TAKE_POSTS = "take-posts";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== READY) return;

    let sent = false;
    try {
      chrome.runtime.sendMessage({ type: TAKE_POSTS }, (reply) => {
        // Reading lastError clears "message port closed" and friends; a
        // missing reply is not an error the editor needs to see.
        if (chrome.runtime.lastError) return;
        if (!reply || !Array.isArray(reply.posts) || reply.posts.length === 0) return;
        if (sent) return;
        sent = true;
        window.postMessage(
          { type: POSTS, posts: reply.posts, capturedAt: reply.capturedAt },
          window.location.origin,
        );
      });
    } catch {
      // The extension was reloaded or removed while this tab stayed open.
    }
  });

  // Tell a page that asked before this script loaded that it can ask again.
  window.postMessage({ type: BRIDGE_READY }, window.location.origin);
})();
