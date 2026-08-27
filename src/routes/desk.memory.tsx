import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/desk/memory")({
  beforeLoad: () => {
    throw redirect({ to: "/desk/published" });
  },
  component: function MemoryRedirect() {
    return null;
  },
});
