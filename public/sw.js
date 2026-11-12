/*
  The smallest service worker that makes the paper installable.

  A browser will not offer "Install app" for a manifest-only site; Chrome wants
  a service worker with a fetch handler as well. This one exists for that and
  nothing else. It caches NOTHING: no page, no script, no stylesheet, no image,
  no API reply, no desk screen. Every request that is not a page navigation is
  handed straight back to the browser without `respondWith`, so the app behaves
  exactly as it did before this file existed.

  The one thing it does is the offline case: a reader who opens the installed
  app with no signal gets a page that says so, in the paper's own colours,
  instead of the browser's "No internet" dinosaur. That page is a string in
  this file -- it is never fetched and never stored.

  Scope is `/` because this file is served at `/sw.js` from `public/`.
*/

var OFFLINE_BACKGROUND = "#fffdf7";
var OFFLINE_INK = "#1c1410";

/** Escape a URL for use in an HTML attribute. */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The offline page. Large, dark text on the paper colour; no small print. */
function offlinePage(url) {
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Offline</title>" +
    "<style>" +
    "html,body{margin:0;min-height:100%;background:" +
    OFFLINE_BACKGROUND +
    ";color:" +
    OFFLINE_INK +
    ";}" +
    "body{display:flex;flex-direction:column;justify-content:center;" +
    "box-sizing:border-box;padding:32px;font-family:Georgia,'Times New Roman',serif;" +
    "font-size:22px;line-height:1.5;}" +
    "h1{font-size:44px;line-height:1.2;margin:0 0 24px;}" +
    "p{margin:0 0 24px;font-size:22px;}" +
    "a{font-size:22px;font-weight:bold;color:" +
    OFFLINE_INK +
    ";text-decoration:underline;}" +
    "</style></head><body>" +
    "<h1>You are offline.</h1>" +
    "<p>This page will load when your phone is back online.</p>" +
    '<p><a href="' +
    escapeAttribute(url) +
    '">Try again</a></p>' +
    "</body></html>"
  );
}

self.addEventListener("install", function () {
  // Take over as soon as the browser will let us; nothing is precached.
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  // Page navigations only. Everything else is the browser's business.
  if (!request || request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(function () {
      return new Response(offlinePage(request.url), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }),
  );
});
