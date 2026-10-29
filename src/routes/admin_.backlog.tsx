import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/backlog")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead("Backlog", "Epics, stories, tasks and bugs in one ranked backlog per project."),
  component: () => <Workspace view="backlog" />,
});
