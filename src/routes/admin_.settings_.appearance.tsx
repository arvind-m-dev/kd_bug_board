import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/settings_/appearance")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead(
      "Appearance & themes",
      "Theme Studio for Bug Board: palette, style, fonts, motion and seasonal scenes.",
    ),
  component: () => <Workspace view="appearance" />,
});
