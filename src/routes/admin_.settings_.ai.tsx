import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/settings_/ai")({
  beforeLoad: requireWorkspaceAccess,
  head: () => pageHead("AI access", "AI access in Futurist Global Bug Board settings."),
  component: () => <Workspace view="settings-ai" />,
});
