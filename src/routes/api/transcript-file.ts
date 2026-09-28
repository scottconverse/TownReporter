import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/transcript-file?artifactId=N -- the retained meeting transcript,
 * byte for byte, under the name it was stored with.
 *
 * The logic lives in `transcriptFileHandler`
 * (src/lib/news/meeting-transcript-view.server.ts) so it can be tested with a
 * plain `Request` and a fake `Sql`, and so the two rules that matter -- the
 * path comes from the artifact row, and the row is scoped to the caller's
 * newsroom -- are readable in one place.
 *
 * The import is dynamic and inside the handler: this route file is part of the
 * client graph for its route definition, and a static import of a `*.server.ts`
 * from there is the trap rule 13 of the standing brief describes.
 */
export const Route = createFileRoute("/api/transcript-file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const transcript = await import("@/lib/news/meeting-transcript-view.server.ts");
        return transcript.transcriptFileHandler(request);
      },
    },
  },
});
