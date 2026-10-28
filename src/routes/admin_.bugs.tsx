import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/bugflow/workspace";
import { pageHead } from "@/lib/bugflow";
import { requireWorkspaceAccess } from "@/lib/admin-route-access";
export const Route = createFileRoute("/admin_/bugs")({
  beforeLoad: requireWorkspaceAccess,
  head: () =>
    pageHead(
      "All bugs",
      "All bugs in Bug Board: manual QA, scoped bug tracking and collaboration.",
    ),
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    filter?: string | undefined;
    severity?: string | undefined;
    q?: string | undefined;
    bug?: number | undefined;
  } => ({
    filter: typeof s["filter"] === "string" ? s["filter"] : undefined,
    severity: typeof s["severity"] === "string" ? s["severity"] : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    // The bug to open (from a notification or a shared link); BugWorkspace reads it from the URL.
    // Kept as a number so the router writes ?bug=123 (a numeric string would be written quoted).
    bug: /^[1-9]\d*$/.test(String(s["bug"] ?? "").replace(/"/g, ""))
      ? Number(String(s["bug"]).replace(/"/g, ""))
      : undefined,
  }),
  component: () => <Workspace view="bugs" />,
});
