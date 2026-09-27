import { useEffect } from "react";
import {
  BEAT_INTERVAL_MS,
  HIDDEN_GONE_MS,
  QUIET_FLUSH_MS,
  classifyArrival,
  depthBucketsReached,
  deviceForWidth,
  isBeaconTrustEvent,
  normalizeReadPath,
} from "@/lib/news/reading";
import { send, sendTrustEvent } from "@/components/read-beacon-send";

import type { ReadDepthBucket } from "@/lib/news/reading";

/**
 * The reading beacon. Mounted on public pages only, beside <ViewBeacon/>, and
 * like it: a `useEffect`, so it runs after the DOM is committed and render
 * does no extra work for it. Everything here is silent-fail -- counting can
 * never be the thing that breaks a reader's page.
 *
 * WHAT IT SENDS, and what it never sends. Four kinds of message go to
 * /api/read, all of them four to ten words of class, never a value from the
 * reader:
 *
 *   load   once, on mount: the canonical path, the arrival CLASS, the device
 *          CLASS from the viewport width, and whether the referrer was one of
 *          our own story paths ("read another story").
 *   beat   every fifteen seconds while the page is visible: path, device, and
 *          the active seconds so far. Presence only -- it draws "Reading right
 *          now" from a rolling half hour held in memory, and is never stored.
 *   read   active time (as a delta, in whole seconds) and the scroll-depth
 *          buckets just reached, on each new bucket, on a quiet flush, and once
 *          as `final` when the reader is gone.
 *   trust  one of the four controls a browser can report: a source link
 *          followed, a credit copied, dark mode chosen, larger text chosen.
 *
 * The full referrer URL is read here and never leaves this function: on a
 * search result it carries the reader's query, so `classifyArrival` reduces it
 * to one of eight words and only the word is sent. Nothing is written to
 * cookies, localStorage or sessionStorage, no id of any kind is generated,
 * and the server never looks at an IP or a user-agent -- so there is nothing
 * to recognise a reader by, on either side of the wire.
 *
 * WHY NOTHING IS REMEMBERED BETWEEN LOADS. `reportedDepth` lives in this
 * closure: it exists while the page is open and is gone when the tab is. That
 * is what lets the server keep plain counters instead of per-load state, which
 * is the per-reader key this design exists to avoid.
 */
export function ReadBeacon() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const path = normalizeReadPath(window.location.pathname);
    if (!path) return;

    // The device class is fixed at load, from the viewport width and nothing
    // else (no user-agent is read anywhere). A rotating phone stays one row.
    const device = deviceForWidth(window.innerWidth);
    const arrival = classifyArrival(document.referrer, window.location.host, path);

    let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    let accumulated = 0;
    let reportedSeconds = 0;
    let sentFinal = false;
    let goneTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const reportedDepth: number[] = [];

    const activeSeconds = () =>
      Math.round((accumulated + (visibleSince ? Date.now() - visibleSince : 0)) / 1000);

    const pause = () => {
      if (!visibleSince) return;
      accumulated += Date.now() - visibleSince;
      visibleSince = 0;
    };
    const resume = () => {
      if (visibleSince || stopped) return;
      visibleSince = Date.now();
    };

    /**
     * Active time and depth, as a delta. `final` is the reader gone: it is
     * always sent, even with nothing new in it, because "left without reading"
     * is measured on the total the last report carries.
     */
    const report = (buckets: ReadDepthBucket[], final: boolean) => {
      if (final && sentFinal) return;
      const total = activeSeconds();
      const delta = total - reportedSeconds;
      if (delta > 0) reportedSeconds = total;
      if (final) sentFinal = true;
      if (delta <= 0 && buckets.length === 0 && !final) return;
      send({
        kind: "read",
        path,
        device,
        seconds: delta > 0 ? delta : 0,
        totalSeconds: total,
        depth: buckets,
        ...(final ? { final: true } : {}),
      });
    };

    const cancelGone = () => {
      if (goneTimer === null) return;
      clearTimeout(goneTimer);
      goneTimer = null;
    };

    send({
      kind: "load",
      path,
      device,
      refClass: arrival.refClass,
      fromArticle: arrival.fromArticle,
    });

    // A heartbeat while the page is visible, and -- once a minute -- whatever
    // unreported time has built up since the last report, so an OS-killed tab
    // loses a minute of counting at most.
    const beat = setInterval(() => {
      if (stopped || document.visibilityState !== "visible") return;
      send({ kind: "beat", path, device, seconds: activeSeconds() });
      if (activeSeconds() - reportedSeconds >= QUIET_FLUSH_MS / 1000) report([], false);
    }, BEAT_INTERVAL_MS);

    // Depth is only read on a scroll, so a story that fits on one screen
    // reports no depth rather than claiming to have been read to the end.
    let lastScrollAt = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollAt < 200) return;
      lastScrollAt = now;
      const element = document.documentElement;
      const height = Math.max(element.scrollHeight, 1);
      const percent = ((window.scrollY + window.innerHeight) / height) * 100;
      const fresh = depthBucketsReached(percent, reportedDepth);
      if (fresh.length === 0) return;
      reportedDepth.push(...fresh);
      report(fresh, false);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Back within HIDDEN_GONE_MS: not gone, and no visit ends.
        cancelGone();
        resume();
        return;
      }
      pause();
      report([], false);
      cancelGone();
      goneTimer = setTimeout(() => {
        goneTimer = null;
        report([], true);
      }, HIDDEN_GONE_MS);
    };

    const onPageHide = () => {
      cancelGone();
      pause();
      stopped = true;
      clearInterval(beat);
      report([], true);
    };

    // Back out of the back/forward cache: the page is live again, so counting
    // resumes. No second `load` -- this is the same visit.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      stopped = false;
      sentFinal = false;
      resume();
    };

    // Trust signals are counted where they happen, on the paper's own controls.
    // A delegated listener, because the story page's share panel and sources
    // list are rendered by routes this unit must not edit.
    const onTrustClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const marked = target.closest("[data-trust-event]");
      if (marked) {
        const value = marked.getAttribute("data-trust-event");
        if (isBeaconTrustEvent(value)) sendTrustEvent(value);
        return;
      }
      const anchor = target.closest("a[href]");
      // A source link: an off-site link inside the story's own sources list.
      if (anchor && anchor.closest("#sources")) {
        const href = anchor.getAttribute("href") ?? "";
        if (href && !isSelfHref(href)) {
          sendTrustEvent("source-link-followed");
          return;
        }
      }
      const control = target.closest("button, a, [role='button']");
      if (control) {
        const text = (control.textContent ?? "").trim();
        if (text.length > 0 && text.length < 80 && /copy credit/i.test(text)) {
          sendTrustEvent("credit-copied");
        }
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("click", onTrustClick, true);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("click", onTrustClick, true);
      clearInterval(beat);
      cancelGone();
    };
  }, []);
  return null;
}

/** True for a link back to this paper, which is not a source link. */
function isSelfHref(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("/")) return true;
  try {
    return new URL(href, window.location.href).host === window.location.host;
  } catch {
    return true;
  }
}
