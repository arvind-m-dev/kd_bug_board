import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ThemedSelect } from './themed-select';
import { ErrorNotice, actionError } from './action-feedback';
import { getBugExport, getBugWorkspace } from '@/lib/bug-workflow.functions';
import { sheetFileName } from '@/lib/bug-sheet';
import type { BugAccess, BugWorkspaceData } from '@/lib/bug-workflow';

/**
 * Download the bugs you can see as an .xlsx in the team's sheet layout: columns A–M as the shared sheet has them,
 * BugFlow's extra fields after that, coloured chips, dropdowns, day bands and links that open the bug here.
 */
export function BugSheetExport({ access, workspace, close }: { access: BugAccess; workspace: BugWorkspaceData; close: () => void }) {
  const fetch = useServerFn(getBugExport);
  const [projectId, setProjectId] = useState('all'); const [includeClosed, setIncludeClosed] = useState(true); const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const bugs = await fetch({ data: { access, projectId: projectId === 'all' ? null : projectId, includeClosed } });
      if (!bugs.length) { toast.info('Nothing to export with these choices.'); return; }
      const { buildBugSheet, downloadBlob } = await import('@/lib/bug-sheet-client');
      const people = [...new Set(workspace.developers.map(d => d.name))];
      const blob = await buildBugSheet(bugs, { categories: workspace.options.modules, builds: workspace.options.environments, people }, window.location.origin);
      const project = projectId === 'all' ? null : workspace.projects.find(p => p.id === projectId)?.name ?? null;
      downloadBlob(blob, sheetFileName(project));
      toast.success(`${bugs.length} ${bugs.length === 1 ? 'bug' : 'bugs'} exported`, { description: 'Opens in Excel, Google Sheets or Numbers with colours, dropdowns and links.' });
      close();
    } catch (e) { toast.error(actionError(e, 'The sheet could not be built.')); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-4">
    <div className="grid gap-1 text-sm"><span className="text-xs font-semibold">Project</span><ThemedSelect label="Project" value={projectId} onChange={setProjectId} options={[{ value: 'all', label: 'All projects' }, ...workspace.projects.map(p => ({ value: p.id, label: p.name }))]} /></div>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeClosed} onCheckedChange={v => setIncludeClosed(v === true)} />Include resolved and closed bugs</label>
    <p className="text-xs text-muted-foreground">Columns A to M match the team's bug sheet (ticket, Web/Mobile, category, build, date, status, priority, assigned to, issue, steps, media, dev and QA comments). Severity, reporter, project, expected and actual results, device, fix notes, last update and a link to open the bug follow after. Bugs are grouped under a green band per day, like the shared sheet.</p>
    <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button><Button size="sm" onClick={() => void run()} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}Download .xlsx</Button></div>
  </div>;
}

/** Loads the lists the sheet's dropdowns need (projects, options, people) for this access, then shows the form. */
export function SheetExportLoader({ access, close }: { access: BugAccess; close: () => void }) {
  const fetch = useServerFn(getBugWorkspace);
  const q = useQuery({ queryKey: ['bug-workspace', access, undefined], queryFn: () => fetch({ data: { access } }), retry: false, staleTime: 10000 });
  if (q.isPending) return <p role="status" className="py-4 text-sm text-muted-foreground">Preparing…</p>;
  if (!q.data) return <ErrorNotice message="The workspace could not be loaded." onRetry={() => { void q.refetch(); }} />;
  return <BugSheetExport access={access} workspace={q.data} close={close} />;
}
