import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Plus, X, Save, LoaderCircle, Pencil, Check, UsersRound, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getBugWorkspace, saveOptions } from '@/lib/bug-workflow.functions';
import { DEFAULT_OPTIONS, type DropdownOptions } from '@/lib/bug-workflow';
import { ErrorNotice, actionError } from './action-feedback';
import { Link } from '@tanstack/react-router';

const groups: { key: keyof DropdownOptions; title: string; hint: string }[] = [
  { key: 'modules', title: 'Modules / pages', hint: 'Shown in the “Module or page” dropdown.' },
  { key: 'environments', title: 'Environments', hint: 'Shown in the “Environment” dropdown.' },
  { key: 'devices', title: 'Browsers / devices', hint: 'Shown in the “Browser / device” dropdown.' },
];

export function DropdownOptionsEditor({ onAddMember }: { onAddMember: () => void }) {
  const fetch = useServerFn(getBugWorkspace); const save = useServerFn(saveOptions); const client = useQueryClient();
  const q = useQuery({ queryKey: ['bug-workspace', { kind: 'admin' }, undefined], queryFn: () => fetch({ data: { access: { kind: 'admin' } } }), retry: false, staleTime: 10000, refetchInterval: 20000 });
  const [draft, setDraft] = useState<DropdownOptions>(DEFAULT_OPTIONS); const [entry, setEntry] = useState<Record<string, string>>({}); const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<{ key: keyof DropdownOptions; value: string } | null>(null);
  const [replacement, setReplacement] = useState('');
  useEffect(() => { if (q.data && !dirty) setDraft(q.data.options); }, [q.data, dirty]);
  const m = useMutation({ mutationFn: (o: DropdownOptions) => save({ data: o }), onSuccess: async () => { setDirty(false); await client.invalidateQueries({ queryKey: ['bug-workspace'] }); toast.success('Dropdown options saved'); } });
  const update = (k: keyof DropdownOptions, list: string[]) => { setDraft(d => ({ ...d, [k]: list })); setDirty(true); };
  const add = (k: keyof DropdownOptions) => { const v = (entry[k] ?? '').trim(); if (!v || draft[k].includes(v)) return; update(k, [...draft[k], v]); setEntry(e => ({ ...e, [k]: '' })); };
  const rename = () => { const value = replacement.trim(); if (!editing || !value || (value !== editing.value && draft[editing.key].includes(value))) return; update(editing.key, draft[editing.key].map(item => item === editing.value ? value : item)); setEditing(null); };
  return <section className="bf-settings-section">
    <div className="bf-settings-heading"><div className="flex items-center gap-3"><span className="bf-stat-icon bf-tone-teal"><SlidersHorizontal size={18}/></span><div><h2>Dropdown options</h2><span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Report fields & assignment choices'}</span></div></div><div className="flex flex-wrap gap-2">{dirty && <Button variant="ghost" size="sm" disabled={m.isPending} onClick={()=>{setDraft(q.data?.options??DEFAULT_OPTIONS);setDirty(false);setEditing(null);}}>Discard</Button>}<Button size="sm" disabled={!q.data || !dirty || m.isPending || !!editing} onClick={() => m.mutate(draft)}>{m.isPending ? <LoaderCircle className="animate-spin" /> : <Save />}Save options</Button></div></div>
    {q.isError && <ErrorNotice message={actionError(q.error, 'Options could not be loaded.')} onRetry={() => q.refetch()} />}
    {m.isError && <ErrorNotice message={actionError(m.error, 'Options could not be saved.')} />}
    {q.isPending ? <p className="py-5 text-sm text-muted-foreground">Loading options…</p> : q.data && <div className="grid gap-4 lg:grid-cols-3">{groups.map(g => <div key={g.key} className="bf-option-group">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{g.title}</h3><span className="bf-tag">{draft[g.key].length}/50</span></div>
      <ul className="bf-option-list">{draft[g.key].map(v => <li key={v} className="bf-option-row">{editing?.key===g.key&&editing.value===v ? <><Input autoFocus aria-label={`Rename ${v}`} value={replacement} maxLength={80} onChange={e=>setReplacement(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();rename();}if(e.key==='Escape')setEditing(null);}}/><Button size="icon" variant="ghost" aria-label={`Confirm rename ${v}`} title="Save name" disabled={!replacement.trim()||(replacement.trim()!==v&&draft[g.key].includes(replacement.trim()))} onClick={rename}><Check size={14}/></Button><Button size="icon" variant="ghost" aria-label="Cancel rename" title="Cancel" onClick={()=>setEditing(null)}><X size={14}/></Button></> : <><span className="min-w-0 flex-1 break-words">{v}</span><Button size="icon" variant="ghost" aria-label={`Edit ${v}`} title={`Edit ${v}`} disabled={m.isPending} onClick={()=>{setEditing({key:g.key,value:v});setReplacement(v);}}><Pencil size={13}/></Button><Button size="icon" variant="ghost" aria-label={`Remove ${v}`} title={`Remove ${v}`} disabled={m.isPending} onClick={() => update(g.key, draft[g.key].filter(x => x !== v))}><X size={14}/></Button></>}</li>)}{!draft[g.key].length && <li className="py-5 text-xs text-muted-foreground">No saved choices</li>}</ul>
      <div className="flex gap-2"><Input aria-label={`New ${g.title}`} placeholder="New option" maxLength={80} disabled={m.isPending||draft[g.key].length>=50} value={entry[g.key] ?? ''} onChange={e => setEntry(x => ({ ...x, [g.key]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(g.key); } }} /><Button size="icon" variant="outline" aria-label={`Add ${g.title}`} title={`Add ${g.title}`} disabled={m.isPending||!entry[g.key]?.trim()||draft[g.key].includes(entry[g.key]?.trim()??'')||draft[g.key].length>=50} onClick={() => add(g.key)}><Plus /></Button></div>
    </div>)}</div>}
    <div className="bf-settings-fixed"><span className="text-xs font-medium">Workflow choices · Fixed</span><div className="flex flex-wrap gap-2"><span className="bf-tag">Priority · P0–P5</span><span className="bf-tag">Severity · Critical / High / Medium / Low</span><span className="bf-tag">Status · Bug lifecycle</span></div></div>
    <div className="bf-settings-heading mt-6"><div className="flex items-center gap-3"><span className="bf-stat-icon bf-tone-info"><UsersRound size={18}/></span><div><h2>Assign to</h2><span className="text-xs text-muted-foreground">Active members · {q.data?.developers.length??'—'}</span></div></div><Button size="sm" variant="outline" onClick={onAddMember}><Plus/>Add member</Button></div>
    {q.data && <div className="bf-assignee-directory">{q.data.developers.map(member=><div className="flex min-w-0 items-center gap-3 py-3" key={member.id}><span className="bf-avatar">{member.name.slice(0,2).toUpperCase()}</span><div className="min-w-0"><p className="break-words text-sm font-medium">{member.name}</p><span className="text-xs capitalize text-muted-foreground">{member.role} · {member.id.slice(0,8)}</span></div></div>)}{!q.data.developers.length&&<p className="py-4 text-sm text-muted-foreground">No active members yet.</p>}</div>}
    <div className="flex flex-wrap justify-between gap-3 pt-4 text-xs text-muted-foreground"><span>New members appear automatically for projects they can access.</span><Button asChild variant="link" size="sm"><Link to="/admin/users">Manage members & permissions</Link></Button></div>
  </section>;
}
