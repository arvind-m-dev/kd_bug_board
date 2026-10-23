import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/users")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead(
      "Team & access",
      "Team & access in Futurist Global Bug Board: manual QA, scoped bug tracking and collaboration.",
    ),
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    filter?: string | undefined;
    severity?: string | undefined;
    q?: string | undefined;
    member?: string | undefined;
  } => ({
    filter: typeof s["filter"] === "string" ? s["filter"] : undefined,
    severity: typeof s["severity"] === "string" ? s["severity"] : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    // The member to open (from a notification); the members list reads it from the URL.
    member: typeof s["member"] === "string" && s["member"] ? s["member"] : undefined,
  }),
  component: () => <Workspace view="users" />,
});
