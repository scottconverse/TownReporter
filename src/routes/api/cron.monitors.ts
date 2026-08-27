import { createFileRoute } from "@tanstack/react-router";
import { tickAllDueMonitors } from "@/lib/news/monitors-cron";

export const Route = createFileRoute("/api/cron/monitors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET?.trim();
        if (!secret) {
          return new Response("cron disabled", { status: 503 });
        }
        const hdr = request.headers.get("authorization") ?? "";
        if (hdr !== `Bearer ${secret}`) {
          return new Response("forbidden", { status: 403 });
        }
        const result = await tickAllDueMonitors();
        return Response.json(result);
      },
    },
  },
});
