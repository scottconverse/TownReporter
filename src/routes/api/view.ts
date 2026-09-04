import { createFileRoute } from "@tanstack/react-router";
import { viewBeaconHandler } from "@/lib/news/views";

/**
 * The view beacon. Public, unauthenticated -- readers are anonymous by
 * design. All the logic lives in `viewBeaconHandler`
 * (src/lib/news/views.ts) so it can be tested directly with a plain
 * `Request`; this file is just the route wiring.
 *
 * This is the entire point of counting views this way: nothing about a
 * stats failure can ever reach the reader, because the reader's page has
 * already rendered by the time this is called (see
 * src/components/view-beacon.tsx) and this response is never awaited for
 * anything the page shows.
 */
export const Route = createFileRoute("/api/view")({
  server: {
    handlers: {
      POST: ({ request }) => viewBeaconHandler(request),
    },
  },
});
