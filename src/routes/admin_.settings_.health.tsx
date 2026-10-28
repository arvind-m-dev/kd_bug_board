import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/settings_/health")({
  beforeLoad: requireWorkspaceAccess,
  head: () => pageHead("System health", "Live status of the services behind Bug Board."),
  component: () => <Workspace view="settings-health" />,
});
