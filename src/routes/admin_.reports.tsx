import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/reports")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead(
      "Team reports",
      "Per-person bug reports in Bug Board: raised, fixed, rejected and fix speed.",
    ),
  validateSearch: (s: Record<string, unknown>): { person?: string | undefined } => ({
    person:
      typeof s["person"] === "string" && /^[0-9a-f-]{36}$/i.test(s["person"])
        ? s["person"]
        : undefined,
  }),
  component: () => <Workspace view="reports" />,
});
