import { createFileRoute } from "@tanstack/react-router";
import { handleMonitorsCron } from "@/lib/news/monitors-cron";

export const Route = createFileRoute("/api/cron/monitors")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMonitorsCron(request),
    },
  },
});
