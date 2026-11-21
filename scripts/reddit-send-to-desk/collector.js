/*
 * Injected into the Reddit tab by background.js, and only then.
 *
 * This file is a plain script (not an ES module): Chrome's `files:` injection
 * evaluates it as a classic script, so it must not import anything. It only
 * reads the DOM that is already on screen. It makes no requests, starts no
 * timers, scrolls nothing, clicks nothing and keeps no state between runs.
 */
(() => {
  const MAX_PER_RUN = 50;

  function textOf(el) {
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isoFromEpoch(raw) {
    if (!/^\d+$/.test(raw)) return raw;
    const ms = Number(raw) * 1000;
    if (!Number.isFinite(ms)) return raw;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString();
  }

  // Current Reddit renders one <shreddit-post> per post, with the fields as
  // attributes and the body in a slotted element.
  function fromShreddit(el) {
    const timeEl = el.querySelector("time[datetime]");
    return {
      title: el.getAttribute("post-title") || textOf(el.querySelector('[slot="title"]')),
      permalink: el.getAttribute("permalink") || "",
      author: el.getAttribute("author") || textOf(el.querySelector('[slot="author"]')),
      time: el.getAttribute("created-timestamp") || (timeEl && timeEl.getAttribute("datetime")) || "",
      excerpt: textOf(el.querySelector('[slot="text-body"]')),
    };
  }

  // Old Reddit: one div.thing per post, with the permalink on a.comments.
  function fromThing(el) {
    const titleEl = el.querySelector("a.title");
    const commentsEl = el.querySelector("a.comments");
    const timeEl = el.querySelector("time");
    const titleHref = (titleEl && titleEl.getAttribute("href")) || "";
    const permalink =
      (commentsEl && commentsEl.getAttribute("href")) ||
      (titleHref.includes("/comments/") ? titleHref : "");
    return {
      title: textOf(titleEl) || el.getAttribute("data-title") || "",
      permalink,
      author: textOf(el.querySelector(".tagline .author")),
      time: isoFromEpoch(el.getAttribute("data-timestamp") || (timeEl && timeEl.getAttribute("datetime")) || ""),
      excerpt: textOf(el.querySelector(".expando .usertext-body")),
    };
  }

  function collect(max) {
    const limit = Number.isInteger(max) && max > 0 ? Math.min(max, MAX_PER_RUN) : MAX_PER_RUN;
    const posts = [];
    const shreddit = document.querySelectorAll("shreddit-post");
    for (const el of shreddit) {
      posts.push(fromShreddit(el));
      if (posts.length >= limit) return posts;
    }
    const things = document.querySelectorAll("div.thing");
    for (const el of things) {
      posts.push(fromThing(el));
      if (posts.length >= limit) return posts;
    }
    return posts;
  }

  globalThis.__townreporterRedditCollect = collect;

  // A small message box on the page, so "No posts found on this page" is
  // something the editor can actually see. It stays until dismissed -- no
  // timers -- and is replaced on the next press.
  globalThis.__townreporterRedditToast = (message) => {
    const id = "townreporter-send-to-desk-toast";
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    if (!document.body) return;
    const box = document.createElement("div");
    box.id = id;
    box.setAttribute("role", "status");
    box.textContent = String(message);
    box.style.cssText =
      "position:fixed;z-index:2147483647;left:16px;bottom:16px;max-width:320px;" +
      "padding:12px 14px;border:1px solid #1a1a1a;background:#fffdf5;color:#1a1a1a;" +
      "font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Dismiss";
    close.style.cssText =
      "display:block;margin-top:8px;padding:2px 8px;border:1px solid #1a1a1a;" +
      "background:#fffdf5;color:#1a1a1a;font:inherit;cursor:pointer;";
    close.addEventListener("click", () => box.remove());
    box.append(close);
    document.body.append(box);
  };
})();
