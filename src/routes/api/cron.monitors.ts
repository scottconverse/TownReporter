import { createFileRoute } from "@tanstack/react-router";
import { handleMonitorsCronRequest } from "@/lib/news/cron-monitors-request";

export const Route = createFileRoute("/api/cron/monitors")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMonitorsCronRequest(request),
    },
  },
});
