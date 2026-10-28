import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/trash")({
  beforeLoad: requireWorkspaceAccess,
  head: () => pageHead("Trash", "Deleted bugs and members in Bug Board, restorable for 30 days."),
  component: () => <Workspace view="trash" />,
});
