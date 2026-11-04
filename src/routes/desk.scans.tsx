import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/desk/scans` was the plural spelling people type for the scan page, and it
 * served "page not found". Send them to `/desk/scan` and keep any query string
 * they arrived with (a source id, a date, whichever link they followed).
 */
export const Route = createFileRoute("/desk/scans")({
  beforeLoad: () => {
    throw redirect({ to: "/desk/scan", search: true });
  },
  component: function ScansRedirect() {
    return null;
  },
});
