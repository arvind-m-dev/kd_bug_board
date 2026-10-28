import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead(
      "Overview",
      "Bug Board manual QA workspace overview, team portals and shared bug tracking.",
    ),
  component: () => <Workspace />,
});
