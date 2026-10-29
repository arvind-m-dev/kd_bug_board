import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/board")({
  beforeLoad: requireWorkspaceAccess,
  head: () => pageHead("Board", "A drag-and-drop scrum board over the Bug Board workflow stages."),
  component: () => <Workspace view="board" />,
});
