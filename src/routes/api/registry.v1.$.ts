import { createFileRoute } from "@tanstack/react-router";

/**
 * The public Community resources JSON API, version 1:
 *
 *   GET /api/registry/v1/services
 *   GET /api/registry/v1/services/<id>
 *   GET /api/registry/v1/categories
 *
 * A thin route, like /api/read: the logic is `registryApiHandler`
 * (src/lib/news/registry/registry-api.server.ts), which takes a plain
 * `Request` so it is tested directly. Unauthenticated, and it never reads the
 * request's cookies. `ANY` sends every method to the handler, which answers
 * anything but GET with 405 in the API's error envelope. The import is dynamic
 * so this route's client graph never reaches a `*.server.ts` file.
 */
export const Route = createFileRoute("/api/registry/v1/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const api = await import("@/lib/news/registry/registry-api.server.ts");
        return api.registryApiHandler(request);
      },
    },
  },
});
