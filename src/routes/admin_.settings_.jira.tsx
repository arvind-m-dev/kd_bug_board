import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/settings_/jira")({
  beforeLoad: requireWorkspaceAccess,
  head: () => pageHead("Jira", "The Jira Cloud connection for this workspace."),
  // `jira` carries the outcome code after returning from the Atlassian sign-in.
  validateSearch: (s: Record<string, unknown>): { jira?: string | undefined } => ({
    jira: typeof s["jira"] === "string" ? s["jira"] : undefined,
  }),
  component: () => <Workspace view="settings-jira" />,
});
