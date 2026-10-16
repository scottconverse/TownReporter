import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ASSET_RELOAD_WINDOW_MS, assetReloadHeadScript } from "./asset-reload.ts";

const ORIGIN = "https://townreporter.org";
const { document } = parseHTML("<!doctype html><html><head></head><body></body></html>");

/** One browser tab. Its storage and clock outlive a reload, as they do in a real tab. */
type Tab = {
  storage: Map<string, string>;
  clock: { now: number };
};

type Listener = {
  type: string;
  handler: (event: unknown) => void;
  capture: boolean;
};

/** One page load: the reloads the head script asked for, and the listeners it installed. */
type Page = {
  reloads: number;
  listeners: Listener[];
};

function newTab(): Tab {
  return { storage: new Map(), clock: { now: 1_700_000_000_000 } };
}

/** Runs the real head-script text against a window stub, the way a page load runs it. */
function loadPage(
  tab: Tab,
  options: { pathname?: string; storageBroken?: boolean; accessBroken?: boolean } = {},
): Page {
  const page: Page = { reloads: 0, listeners: [] };
  const pathname = options.pathname ?? "/desk";
  const sessionStorage = {
    getItem(key: string): string | null {
      if (options.storageBroken) throw new Error("storage is blocked");
      return tab.storage.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (options.storageBroken) throw new Error("storage is blocked");
      tab.storage.set(key, value);
    },
  };
  const window = {
    location: {
      href: ORIGIN + pathname,
      origin: ORIGIN,
      pathname,
      reload(): void {
        page.reloads += 1;
      },
    },
    addEventListener(type: string, handler: (event: unknown) => void, capture = false): void {
      page.listeners.push({ type, handler, capture });
    },
    get sessionStorage() {
      if (options.accessBroken) throw new Error("access to storage is denied");
      return sessionStorage;
    },
  };
  new Function("window", "Date", assetReloadHeadScript())(window, { now: () => tab.clock.now });
  return page;
}

function element(tag: string, attributes: Record<string, string>): Element {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/** A resource that fails reports on itself. The event does not bubble, so only capture listeners see it. */
function resourceFailed(page: Page, target: Element): void {
  for (const listener of page.listeners) {
    if (listener.type === "error" && listener.capture) listener.handler({ target });
  }
}

/** Vite's own event for a failed dynamic-import preload. Returns the event so a test can read it. */
function preloadFailed(page: Page): { defaultPrevented: boolean; preventDefault(): void } {
  const event = {
    defaultPrevented: false,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
  };
  for (const listener of page.listeners) {
    if (listener.type === "vite:preloadError") listener.handler(event);
  }
  return event;
}

describe("asset reload head script", () => {
  it("reloads once when an /assets/ script fails to load", () => {
    const page = loadPage(newTab());
    resourceFailed(page, element("script", { src: "/assets/reader-DBUvOHP8.js" }));
    assert.equal(page.reloads, 1);
  });

  it("reloads once for a failed /assets/ stylesheet or modulepreload link", () => {
    const css = loadPage(newTab());
    resourceFailed(css, element("link", { rel: "stylesheet", href: "/assets/styles-abc.css" }));
    const preload = loadPage(newTab());
    resourceFailed(preload, element("link", { rel: "modulepreload", href: "/assets/chunk-xyz.js" }));
    assert.equal(css.reloads, 1);
    assert.equal(preload.reloads, 1);
  });

  it("does not reload a second time within 60 seconds", () => {
    const tab = newTab();
    const first = loadPage(tab);
    resourceFailed(first, element("script", { src: "/assets/a.js" }));
    tab.clock.now += ASSET_RELOAD_WINDOW_MS - 1000;
    const reloaded = loadPage(tab);
    resourceFailed(reloaded, element("script", { src: "/assets/a.js" }));
    assert.equal(first.reloads, 1);
    assert.equal(reloaded.reloads, 0);
  });

  it("reloads again for a failure once the 60 second window has passed", () => {
    const tab = newTab();
    const first = loadPage(tab);
    resourceFailed(first, element("script", { src: "/assets/a.js" }));
    tab.clock.now += ASSET_RELOAD_WINDOW_MS;
    const later = loadPage(tab);
    resourceFailed(later, element("script", { src: "/assets/a.js" }));
    assert.equal(later.reloads, 1);
  });

  it("ignores images, third-party scripts and same-origin files outside /assets/", () => {
    const tab = newTab();
    const page = loadPage(tab);
    resourceFailed(page, element("img", { src: "/assets/logo.png" }));
    resourceFailed(page, element("script", { src: "https://cdn.example.net/analytics.js" }));
    resourceFailed(page, element("script", { src: "https://cdn.example.net/assets/lib.js" }));
    resourceFailed(page, element("script", { src: "/static/legacy.js" }));
    assert.equal(page.reloads, 0);
    assert.equal(tab.storage.size, 0);
  });

  it("reloads once on vite:preloadError and prevents Vite from throwing it", () => {
    const page = loadPage(newTab());
    const event = preloadFailed(page);
    assert.equal(page.reloads, 1);
    assert.equal(event.defaultPrevented, true);
  });

  it("keeps the 60 second guard separate for each page path", () => {
    const tab = newTab();
    const desk = loadPage(tab, { pathname: "/desk" });
    resourceFailed(desk, element("script", { src: "/assets/a.js" }));
    const setup = loadPage(tab, { pathname: "/desk/setup" });
    resourceFailed(setup, element("script", { src: "/assets/a.js" }));
    assert.equal(setup.reloads, 1);
    assert.deepEqual([...tab.storage.keys()].sort(), ["tr-asset-reload:/desk", "tr-asset-reload:/desk/setup"]);
  });

  it("does not reload when sessionStorage throws, for a script or for vite:preloadError", () => {
    const page = loadPage(newTab(), { storageBroken: true });
    resourceFailed(page, element("script", { src: "/assets/a.js" }));
    preloadFailed(page);
    assert.equal(page.reloads, 0);
  });

  it("does not reload when reading window.sessionStorage is denied", () => {
    const page = loadPage(newTab(), { accessBroken: true });
    resourceFailed(page, element("script", { src: "/assets/a.js" }));
    assert.equal(page.reloads, 0);
  });
});
