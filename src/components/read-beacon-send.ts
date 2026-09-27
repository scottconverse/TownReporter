/*
  The wire half of the reading beacon, apart from the beacon's effect.

  It lives in a `.ts` file and the component in `read-beacon.tsx` on purpose:
  eslint's react-refresh/only-export-components warns about a file that exports
  both, and splitting is this repo's convention for it (`job-card-state.ts`,
  `reader-context.ts` + `reader-controls.tsx`). `sendTrustEvent` has to be
  exported because the dark-mode and larger-text presses happen in
  reader-controls.tsx, not in the beacon.
*/

import { isBeaconTrustEvent } from "@/lib/news/reading";

import type { TrustEvent } from "@/lib/news/reading";

/** The one path anything in the reader's browser posts a count to. */
export const READ_BEACON_PATH = "/api/read";

/**
 * Report one press on the paper's own controls: the appearance and text-size
 * buttons in reader-controls.tsx.
 */
export function sendTrustEvent(event: TrustEvent): void {
  if (!isBeaconTrustEvent(event)) return;
  send({ kind: "trust", event });
}

/**
 * Post one beacon body. `sendBeacon` first, because it survives the page being
 * closed -- which is the whole point of the final report -- and `fetch` with
 * `keepalive` only as a fallback for a browser that has no beacon.
 */
export function send(payload: Record<string, unknown>): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(READ_BEACON_PATH, blob)) return;
    }
    if (typeof fetch === "function") {
      void fetch(READ_BEACON_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* a missed count is fine; a broken page is not */
      });
    }
  } catch {
    /* same: never let counting be the thing that breaks */
  }
}
