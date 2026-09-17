import { useEffect } from "react";

/**
 * Fire-and-forget view counting. Mounted on public pages only (the
 * homepage and public story pages -- never /desk/*), and fires AFTER the
 * page has already rendered: this is a `useEffect`, so it runs once the DOM
 * is committed, not during render, and render itself does zero extra work
 * for it.
 *
 * `targets` can be one or two: a story page counts both its own story and
 * the site total in one mount. Every send is silent-fail -- a reader must
 * never see, or be slowed by, anything going wrong here.
 */
export function ViewBeacon({ targets }: { targets: string[] }) {
  // One string dep so a fresh array literal every render doesn't refire.
  const key = targets.join(",");
  useEffect(() => {
    for (const target of key.split(",").filter(Boolean)) {
      sendBeacon(target);
    }
  }, [key]);
  return null;
}

function sendBeacon(target: string): void {
  try {
    const body = JSON.stringify({ target });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/view", blob);
      if (ok) return;
    }
    if (typeof fetch === "function") {
      void fetch("/api/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* a missed view is fine; a broken page is not */
      });
    }
  } catch {
    /* same: never let counting views be the thing that breaks */
  }
}
