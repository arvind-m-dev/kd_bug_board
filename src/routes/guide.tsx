import { createFileRoute } from "@tanstack/react-router";
import { GuidePage } from "@/components/bugflow/guide-page";
import { pageHead } from "@/lib/bugflow";
export const Route = createFileRoute("/guide")({
  head: () =>
    pageHead("User guide", "Step-by-step instructions for reporting, fixing and verifying bugs."),
  component: GuidePage,
});
