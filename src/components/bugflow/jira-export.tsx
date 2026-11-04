import { toast } from "sonner";
import { shareOrigin, warnIfLocalLink } from "@/lib/share-origin";
import { downloadText } from "@/lib/export";
import { JIRA_DATE_FORMAT, jiraFileName, toJiraCsv } from "@/lib/jira-csv";
import type { ExportBug } from "@/lib/bug-workflow";

/** Builds the Jira CSV in the browser and saves it. Returns the file name. */
export function downloadJiraCsv(bugs: ExportBug[], project: string | null) {
  const origin = shareOrigin();
  warnIfLocalLink(origin);
  const name = jiraFileName(project, bugs.length);
  // No BOM: Jira's importer would read it into the first column name.
  downloadText(name, toJiraCsv(bugs, origin), "text/csv;charset=utf-8", { bom: false });
  toast.success(`${bugs.length} ${bugs.length === 1 ? "bug" : "bugs"} ready for Jira`, {
    description: `Import it in Jira: Settings → System → External System Import → CSV. Date format: ${JIRA_DATE_FORMAT}.`,
  });
  return name;
}

/** The short "how to import" guide shown next to the Jira download. */
export function JiraImportSteps({ admin }: { admin: boolean }) {
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-semibold">How to import into Jira</summary>
      <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-muted-foreground">
        <li>
          In Jira, open <b>Settings → System → External System Import → CSV</b> (a Jira admin can do
          this).
        </li>
        <li>
          Choose the downloaded file. Encoding <b>UTF-8</b>, date format <b>{JIRA_DATE_FORMAT}</b>.
        </li>
        <li>Pick the Jira project the bugs should go to.</li>
        <li>
          Jira suggests the field mapping from the column names (Summary, Priority, Description,
          Labels…). Map <b>Bug Board ID</b> and <b>Bug Board link</b> to a text field, or leave them
          out — both are also inside each description.
        </li>
        <li>Check the preview, then press Begin import.</li>
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        Files are added as links in each issue&apos;s description; they open in Bug Board for people
        with access, so nothing becomes public.{" "}
        {admin
          ? "Reporter and assignee are matched to Jira users by email; anyone not in Jira is left empty."
          : "Reporter and assignee are left empty (only Admin exports carry email addresses), so Jira sets you as reporter."}{" "}
        Importing the same file twice creates the issues twice.
      </p>
    </details>
  );
}
