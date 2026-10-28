import { createFileRoute } from "@tanstack/react-router";
import { MediaLinkPage } from "@/components/bugflow/media-link";
import { pageHead } from "@/lib/bugflow";
export const Route = createFileRoute("/media/$bugId")({
  head: () => pageHead("Attachment", "Open a file attached to a bug in Bug Board."),
  validateSearch: (s: Record<string, unknown>): { m?: string | undefined } => ({
    m: typeof s["m"] === "string" && /^[0-9a-f-]{36}$/i.test(s["m"]) ? s["m"] : undefined,
  }),
  component: Page,
});
function Page() {
  const { bugId } = Route.useParams();
  const { m } = Route.useSearch();
  return <MediaLinkPage bugId={bugId} mediaId={m} />;
}
