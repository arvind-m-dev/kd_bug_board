import { createFileRoute } from "@tanstack/react-router";
import { PersonalPortal } from "@/components/bugflow/personal-portal";
import { pageHead } from "@/lib/bugflow";
export const Route = createFileRoute("/qa/$portalToken")({
  head: () => pageHead("Qa portal", "Private qa bug tracking workspace in Bug Board."),
  component: PortalPage,
});

function PortalPage() {
  const { portalToken } = Route.useParams();
  return <PersonalPortal type="qa" token={portalToken} />;
}
