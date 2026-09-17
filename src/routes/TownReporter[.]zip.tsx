import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old zip URL used to serve a binary and gray-screen the preview. Send people to the save page. */
export const Route = createFileRoute("/TownReporter.zip")({
  loader: () => {
    throw redirect({ to: "/get-the-code" });
  },
  component: () => null,
});
