import { createFileRoute } from "@tanstack/react-router";

/**
 * The reading beacon. Public and unauthenticated, like /api/view -- readers
 * are anonymous by design, and there is nothing here to authenticate with:
 * no cookie, no token, no session.
 *
 * All the logic lives in `readBeaconHandler` (src/lib/news/reading.server.ts)
 * so it can be tested directly with a plain `Request`, and so the rule that
 * matters most -- WHICH headers may be read -- is visible in one place. That
 * rule is no longer "none": since the owner's decision of 2026-09-30 the
 * handler reads exactly the five names in `BEACON_HEADER_ALLOWLIST`
 * (src/lib/news/stats-privacy.ts), every one of them through `allowedHeader`,
 * and the location and address headers only when the request arrived over the
 * Cloudflare tunnel's loopback connection. `cookie`, `referer` and
 * `authorization` are still never touched, and the body is read only through a
 * 2 KB cap. The import is dynamic and inside the handler: this route file is
 * part of the client graph for its route definition, and a static import of a
 * `*.server.ts` from there is exactly the trap rule 13 of the standing brief
 * describes.
 *
 * Answers 204, always. A stats failure cannot reach a reader, because the
 * reader's page has already rendered by the time this runs.
 */
export const Route = createFileRoute("/api/read")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const reading = await import("@/lib/news/reading.server.ts");
        return reading.readBeaconHandler(request);
      },
    },
  },
});
