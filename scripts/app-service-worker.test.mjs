/*
  `public/sw.js`, run the way a browser runs it: as a classic worker script
  with a `self` that collects listeners.

  The file exists for one reason -- a browser will not offer "Install app"
  without a service worker that has a fetch handler -- and it must not change
  anything else. So these checks are about behaviour: it claims clients on
  activate, it answers an offline navigation with a readable page, it leaves
  every other request to the browser, and it never touches Cache Storage (the
  module has no `caches` global here at all, so a call to it would throw).
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW_PATH = join(root, "public", "sw.js");

/** Load sw.js into a fresh fake worker scope. */
function loadWorker({ fetch: fetchImpl = () => Promise.reject(new Error("offline")) } = {}) {
  const listeners = new Map();
  const claimed = [];
  const skipped = [];
  const self = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    skipWaiting() {
      skipped.push(true);
      return Promise.resolve();
    },
    clients: {
      claim() {
        claimed.push(true);
        return Promise.resolve();
      },
    },
  };
  const response = new Response("", { status: 200 });
  vm.runInNewContext(readFileSync(SW_PATH, "utf8"), {
    self,
    fetch: fetchImpl,
    Response,
    console,
  });
  return { listeners, claimed, skipped, response };
}

/** Dispatch a fetch event and report what the worker did with it. */
function dispatchFetch(listener, request) {
  let responded = null;
  let waited = null;
  listener({
    request,
    respondWith(value) {
      responded = value;
    },
    waitUntil(value) {
      waited = value;
    },
  });
  return { responded, waited };
}

test("the worker takes over immediately and claims open pages", async () => {
  const worker = loadWorker();
  assert.ok(worker.listeners.has("install"), "an install listener is registered");
  assert.ok(worker.listeners.has("activate"), "an activate listener is registered");

  let waited = null;
  worker.listeners.get("install")({});
  assert.deepEqual(worker.skipped, [true], "install calls skipWaiting()");

  worker.listeners.get("activate")({ waitUntil: (value) => (waited = value) });
  await waited;
  assert.deepEqual(worker.claimed, [true], "activate calls clients.claim()");
});

test("an offline page navigation gets a readable offline page", async () => {
  const worker = loadWorker();
  const { responded } = dispatchFetch(worker.listeners.get("fetch"), {
    url: "https://paper.example/story/42?x=1",
    method: "GET",
    mode: "navigate",
  });
  assert.ok(responded, "the worker answered the navigation");

  const response = await responded;
  assert.equal(response.status, 200, "the offline page is a normal 200 response");
  assert.match(
    String(response.headers.get("content-type")),
    /text\/html/,
    "the offline page is HTML",
  );
  const body = await response.text();
  assert.match(body, /You are offline\./);
  assert.match(body, /This page will load when your phone is back online\./);
  assert.match(body, /<title>Offline<\/title>/);
  assert.match(
    body,
    /href="https:\/\/paper\.example\/story\/42\?x=1"/,
    "Try again links back to the same URL",
  );
  // Rule 30: nothing on this page is small or faint.
  assert.doesNotMatch(body, /font-size:\s*(?:1[0-9]|[0-9])px/);
  assert.match(body, /#fffdf7/i, "the paper colour is the background");
  assert.doesNotMatch(body, /color:\s*#(?:[89a-f][0-9a-f])/i, "no faint grey text");
});

test("a passing network is used, not replaced", async () => {
  const seen = [];
  const worker = loadWorker({
    fetch: (request) => {
      seen.push(request.url);
      return Promise.resolve(new Response("the real page", { status: 200 }));
    },
  });
  const { responded } = dispatchFetch(worker.listeners.get("fetch"), {
    url: "https://paper.example/",
    method: "GET",
    mode: "navigate",
  });
  const response = await responded;
  assert.equal(await response.text(), "the real page");
  assert.deepEqual(seen, ["https://paper.example/"], "the real request was made");
});

test("every other request is left entirely to the browser", () => {
  const worker = loadWorker();
  const listener = worker.listeners.get("fetch");
  for (const request of [
    { url: "https://paper.example/logo.png", method: "GET", mode: "no-cors" },
    { url: "https://paper.example/api/stories", method: "GET", mode: "cors" },
    { url: "https://paper.example/", method: "POST", mode: "navigate" },
    { url: "https://paper.example/assets/app.js", method: "GET", mode: "same-origin" },
  ]) {
    const { responded } = dispatchFetch(listener, request);
    assert.equal(
      responded,
      null,
      `${request.method} ${request.mode} ${request.url} must not be intercepted`,
    );
  }
});
