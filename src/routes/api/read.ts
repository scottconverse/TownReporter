import { createFileRoute } from "@tanstack/react-router";

/**
 * The reading beacon. Public and unauthenticated, like /api/view -- readers
 * are anonymous by design, and there is nothing here to authenticate with:
 * no cookie, no token, no session.
 *
 * All the logic lives in `readBeaconHandler` (src/lib/news/reading.server.ts)
 * so it can be tested directly with a plain `Request`, and so the one rule
 * that matters most -- that the handler never reads `request.headers` -- is
 * visible in one place. The import is dynamic and inside the handler: this
 * route file is part of the client graph for its route definition, and a
 * static import of a `*.server.ts` from there is exactly the trap rule 13 of
 * the standing brief describes.
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
