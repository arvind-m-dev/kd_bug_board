import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/sprints")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead("Sprints", "Plan bugs into sprints and track scope and carry-over in Bug Board."),
  component: () => <Workspace view="sprints" />,
});
