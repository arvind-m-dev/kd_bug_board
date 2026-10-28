import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/settings_/storage")({
  beforeLoad: requireWorkspaceAccess,
  head: () => pageHead("Storage & services", "Storage & services in Bug Board settings."),
  component: () => <Workspace view="settings-storage" />,
});
