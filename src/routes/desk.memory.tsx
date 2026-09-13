import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/desk/memory")({
  beforeLoad: () => {
    throw redirect({ to: "/desk/published", hash: "beat-memory" });
  },
  component: function MemoryRedirect() {
    return null;
  },
});
