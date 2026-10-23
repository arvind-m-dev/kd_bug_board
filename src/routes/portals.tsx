import { createFileRoute, redirect } from "@tanstack/react-router";

// Member portals were merged into Team & access; keep old links working.
export const Route = createFileRoute("/portals")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/users", replace: true });
  },
});
