import { Fragment, useState } from 'react';
import { SkeletonRows } from './loading';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Bug, Search, Plus, ArrowUpRight, RefreshCw, CheckCircle2, Clock3, Pencil, Trash2, Copy, CopyCheck, ListChecks, X, ChevronDown, ChevronRight, MessageSquareWarning, MessageSquare, UserRound, CalendarClock, History, Server, Monitor, ArrowRightLeft, ClipboardCheck, Flag, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getBugWorkspace, getBugDetail, updateBug, deleteBug } from '@/lib/bug-workflow.functions';
import { PRIORITIES, allowedStatuses, mayVerify, groupCounts, matchesFilter, STATUS_GROUPS, NOTES_SUGGESTED, type BugAccess, type BugWorkspaceData, type BugChange, type LiveBug , priorityTone, priorityNames, mayEditBug, severityLevel} from '@/lib/bug-workflow';
import { useNavigate } from '@tanstack/react-router';
import { getMembers } from '@/lib/portal-access.functions';
import { MemberProfile } from './member-profile';
import { ThemedSelect, ThemedMultiSelect } from './themed-select';
import { BugReportForm } from './bug-report-form';
import { BugReportContent } from './bug-report-content';
import { RowStatus, RowAssign, RowRating } from './row-actions';
import { ErrorNotice, ConfirmAction, actionError } from './action-feedback';
import { toast } from 'sonner';
import { statusLabel, statusTone, dateLabel, shortDate, timeAgo } from '@/lib/format';
const PAGE=15;
const ALL_STATUSES=['NEW','VALIDATING','VALIDATED','READY_FOR_ASSIGNMENT','ASSIGNED','IN_PROGRESS','RECHECK','RESOLVED','NEEDS_INFORMATION','REOPENED','DUPLICATE','NOT_A_BUG','WONT_FIX'];
export function BugWorkspace({access,initialFilter='all',initialFilterLabel,initialQuery='',assignmentsOnly=false,linkCards=false}:{access:BugAccess;initialFilter?:string;initialFilterLabel?:string;initialQuery?:string;assignmentsOnly?:boolean;linkCards?:boolean}){
 const fetch=useServerFn(getBugWorkspace);const update=useServerFn(updateBug);const client=useQueryClient();const navigate=useNavigate();const [cursor,setCursor]=useState<string>();const [pages,setPages]=useState<(string|undefined)[]>([]);const [page,setPage]=useState(0);
 const data=useQuery({queryKey:['bug-workspace',access,cursor],queryFn:()=>fetch({data:{access,cursor}}),retry:false,staleTime:10000,refetchInterval:20000});
 const isAdmin=access.kind==='admin';const fetchMembers=useServerFn(getMembers);const members=useQuery({queryKey:['members'],queryFn:()=>fetchMembers(),retry:false,staleTime:10000,refetchInterval:20000,enabled:isAdmin});
 const [query,setQuery]=useState(initialQuery);const [filter,setFilterRaw]=useState(/^P[0-5]$/.test(initialFilter)?'all':initialFilter);const [priority,setPriority]=useState(/^P[0-5]$/.test(initialFilter)?initialFilter:'all');const [severity,setSeverity]=useState('all');const [report,setReport]=useState(false);const [id,setId]=useState<string|null>(null);const [editOnOpen,setEditOnOpen]=useState(false);const [profile,setProfile]=useState<string|null>(null);
 const [expanded,setExpanded]=useState<Set<string>>(new Set());
 const [selecting,setSelecting]=useState(false);const [selected,setSelected]=useState<Set<string>>(new Set());const [copying,setCopying]=useState(false);const [copied,setCopied]=useState<string|null>(null);
 const fetchDetail=useServerFn(getBugDetail);
 const SHEET_HEADERS=['Bug ID','Title','Module','Severity','Priority','Status','Reported by','Assigned to','Reported','Description','Expected result','Actual result','Steps to reproduce','Environment','Browser / device','Evidence links'];
 const cell=(v:string)=>v.replace(/[\t\r\n]+/g,' ').trim();
 async function copyBugs(ids:string[]){if(copying||ids.length===0)return;setCopying(true);try{const details=await Promise.all(ids.map(bid=>fetchDetail({data:{access,id:bid}})));const lines=details.map(({bug:b})=>[b.code,b.title,b.module,b.severity,b.priority,statusLabel(b.status),b.reporter,b.assignees?.length?b.assignees.map(a=>a.name).join(', '):b.assignee,dateLabel(b.createdAt),b.description,b.expected,b.actual,b.steps.map((s,i)=>`${i+1}. ${s}`).join(' '),b.environment,b.browserDevice,b.evidenceUrls.join(' ')].map(cell).join('\t'));await navigator.clipboard.writeText([SHEET_HEADERS.join('\t'),...lines].join('\n'));setCopied(ids.length===1?(ids[0]??'multi'):'multi');toast.success(ids.length===1?'Bug copied — paste it into your sheet':`${ids.length} bugs copied — paste them into your sheet`);setTimeout(()=>setCopied(null),2000);}catch{toast.error('Copy failed. Your browser may have blocked clipboard access.');}finally{setCopying(false);}}
 const toggleSelect=(bid:string)=>setSelected(old=>{const next=new Set(old);if(next.has(bid))next.delete(bid);else next.add(bid);return next;});
 const setFilter=(f:string)=>{setFilterRaw(f);setPage(0);};
 if(data.isPending)return <div className="bf-panel"><SkeletonRows rows={8} label="Loading bugs" /></div>;
 if(data.isError)return <ErrorNotice message={actionError(data.error,'Bugs could not be loaded. Please try again.')} onRetry={()=>{void data.refetch();}} retrying={data.isFetching}/>;
 const d=data.data;const counts=groupCounts(d.statusCounts??[],assignmentsOnly);
 const rows=d.bugs.filter(b=>(!assignmentsOnly||b.assigneeId!==null)&&matchesFilter(filter,b,d.actor.userId)&&(severity==='all'||b.severity===severity)&&(priority==='all'||b.priority===priority)&&`${b.code} ${b.title} ${b.project} ${b.reporter} ${b.assignee}`.toLowerCase().includes(query.toLowerCase()));
 const pageCount=Math.max(1,Math.ceil(rows.length/PAGE));const current=Math.min(page,pageCount-1);const visible=rows.slice(current*PAGE,current*PAGE+PAGE);
 const memberFor=(userId:string|null)=>userId?members.data?.find(m=>m.userId===userId):undefined;
 const person=(userId:string|null,name:string)=>{const m=isAdmin?memberFor(userId):undefined;return m?<button type="button" className="bf-person-link" title={`Open ${name}’s profile`} onClick={()=>setProfile(m.id)}>{name}</button>:<span>{name}</span>;};
 const pick=(f:string)=>{if(linkCards)void navigate({to:assignmentsOnly?'/admin/assignments':'/admin/bugs',search:{filter:f}});else setFilter(f);};
 const cards=[{key:'all',label:assignmentsOnly?'Assigned bugs':'Total bugs',count:counts.total,tone:'info'},...counts.groups.map(g=>({key:g.key,label:g.label,count:g.count,tone:g.tone}))];
 async function quickChange(b:LiveBug,change:Partial<BugChange>,done:string){try{await update({data:{access,change:{requestId:crypto.randomUUID(),id:b.id,version:b.version,notes:'',...change} as BugChange}});await Promise.all([client.invalidateQueries({queryKey:['bug-workspace']}),client.invalidateQueries({queryKey:['bug-detail']})]);toast.success(done);}catch(e){toast.error(actionError(e,'This change could not be saved.'));}}
 const filterOptions=[{value:'all',label:'All bugs'},{value:'mine',label:'My bugs I raised'},{value:'owned',label:'Assigned to me'},{value:'open',label:'Open bugs'},{value:'unassigned',label:'Unassigned'},...STATUS_GROUPS.map(g=>({value:g.key,label:`${g.label} (group)`})),...ALL_STATUSES.map(v=>({value:v,label:statusLabel(v)}))];
 if(initialFilterLabel&&!filterOptions.some(o=>o.value===initialFilter))filterOptions.push({value:initialFilter,label:initialFilterLabel});
 return <>{isAdmin&&<div className="bf-status-cards">{cards.map(c=><button type="button" key={c.key} className="bf-status-card" data-selected={filter===c.key} data-tone={c.tone} onClick={()=>pick(c.key)}><span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="bf-dot"/>{c.label}</span><strong>{c.count}</strong></button>)}</div>}
 <div className="bf-toolbar"><div className="bf-search"><Search/><Input aria-label="Search bugs" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Search bug ID, title or person…"/></div>
 <ThemedSelect label="Bug status" value={filter} onChange={setFilter} options={filterOptions}/>
 <ThemedSelect label="Bug severity" value={severity} onChange={v=>{setSeverity(v);setPage(0);}} options={[{value:'all',label:'All severities'},...d.options.severities]}/>
 <ThemedSelect label="Bug priority" value={priority} onChange={v=>{setPriority(v);setPage(0);}} options={[{value:'all',label:'All priorities'},...PRIORITIES]}/>
 <Button variant="outline" size="icon" title="Refresh bugs" aria-label="Refresh bugs" onClick={()=>{void data.refetch();}}><RefreshCw className={data.isFetching?'animate-spin':''}/></Button>
 {selecting?<><Button variant="outline" size="sm" disabled={selected.size===0||copying} onClick={()=>{void copyBugs([...selected]);}}>{copying?<RefreshCw className="animate-spin"/>:<CopyCheck/>}Copy selected ({selected.size})</Button><Button variant="ghost" size="sm" onClick={()=>{setSelecting(false);setSelected(new Set());}}><X/>Done</Button></>:<Button variant="outline" size="sm" onClick={()=>setSelecting(true)} title="Select bugs to copy into a sheet"><ListChecks/>Select</Button>}
 {d.actor.permissions.includes('report')&&<Button onClick={()=>setReport(true)}><Plus/>Raise a bug</Button>}</div>
 <div className="bf-table-wrap bf-sticky-table rounded-md border"><table className="bf-table bf-bug-table"><thead><tr>{selecting&&<th className="w-8"><input type="checkbox" aria-label="Select all bugs on this page" checked={visible.length>0&&visible.every(b=>selected.has(b.id))} onChange={e=>setSelected(old=>{const next=new Set(old);for(const b of visible){if(e.target.checked)next.add(b.id);else next.delete(b.id);}return next;})}/></th>}<th aria-label="Expand report"/>{['ID','Bug',...isAdmin?['Summary']:[],'Module','Priority · severity','Status','Reporter','Assignee','Last activity','Created'].map(h=><th key={h} className={h==='Summary'?'bf-cell-summary':undefined}>{h}</th>)}<th><span className="sr-only">Copy</span></th><th><span className="sr-only">Edit</span></th></tr></thead><tbody>{visible.map(b=>{const options=allowedStatuses(d.actor,b);return <Fragment key={b.id}><tr data-selected={selected.has(b.id)||undefined}>{selecting&&<td><input type="checkbox" aria-label={`Select ${b.code}`} checked={selected.has(b.id)} onChange={()=>toggleSelect(b.id)}/></td>}<td><Button variant="ghost" size="icon" className="size-7" aria-label={`${expanded.has(b.id)?'Collapse':'Expand'} ${b.code}`} aria-expanded={expanded.has(b.id)} onClick={()=>setExpanded(old=>{const next=new Set(old);if(next.has(b.id))next.delete(b.id);else next.add(b.id);return next;})}>{expanded.has(b.id)?<ChevronDown/>:<ChevronRight/>}</Button></td><td><Button variant="link" className="h-auto p-0 font-mono text-[11.5px] text-muted-foreground" title="Copy bug ID" aria-label={`Copy bug ID ${b.code}`} onClick={async()=>{try{await navigator.clipboard.writeText(b.code);toast.success(`${b.code} copied`);}catch{toast.error('Could not copy the bug ID. Try again.');}}}>{b.code}</Button></td><td><Button variant="link" className="bf-bug-title h-auto whitespace-normal p-0 text-left text-foreground" onClick={()=>{setEditOnOpen(false);setId(b.id);}}>{b.title}</Button>{b.statusNote&&NOTE_STATUSES.includes(b.status)&&<StatusNoteLine status={b.status} note={b.statusNote}/>}</td>{isAdmin&&<td className="bf-cell-summary"><p className="bf-bug-summary">{b.description||'—'}</p></td>}<td className="bf-cell-nowrap">{b.module||'—'}</td><td className="bf-cell-nowrap"><RowRating bug={b} access={access} workspace={d} editable={isAdmin}/></td>
 <td className="bf-cell-status"><RowStatus bug={b} access={access} workspace={d}/></td>
 <td className="bf-cell-person">{person(b.reporterId,b.reporter)}</td><td className="bf-cell-person">{d.actor.permissions.includes('assign')?<RowAssign bug={b} access={access} workspace={d}/>:b.assignees&&b.assignees.length>1?<span className="flex flex-wrap gap-1">{b.assignees.map(a=><span key={a.id}>{person(a.id,a.name)}</span>)}</span>:b.assigneeId?person(b.assigneeId,b.assignee):<span className="text-muted-foreground">Unassigned</span>}</td>
 <td className="bf-cell-activity">{b.lastChange?<span className="bf-activity" title={`${dateLabel(b.lastChange.at)}${b.lastChange.via?` · via ${b.lastChange.via} portal`:''}`}><span className="bf-activity-action">{statusLabel(b.lastChange.action.replace('bug.','').replace('sample_created','created'))}</span><span className="bf-activity-meta">{b.lastChange.by} · {timeAgo(b.lastChange.at)}</span></span>:'—'}</td>
 <td className="bf-cell-nowrap"><time className="text-xs text-muted-foreground" title={dateLabel(b.createdAt)}>{shortDate(b.createdAt)}</time></td><td><Button variant="ghost" size="icon" className="h-7 w-7" title={`Copy ${b.code} for a sheet`} aria-label={`Copy ${b.code}`} disabled={copying} onClick={()=>{void copyBugs([b.id]);}}>{copied===b.id?<CopyCheck className="text-green-500"/>:<Copy/>}</Button></td><td>{mayEditBug(d.actor,b)?<Button variant="ghost" size="icon" className="h-7 w-7" title={`Edit ${b.code}`} aria-label={`Edit ${b.code}`} onClick={()=>{setEditOnOpen(true);setId(b.id);}}><Pencil/></Button>:<span className="text-xs text-muted-foreground">—</span>}</td></tr>{expanded.has(b.id)&&<tr><td colSpan={(selecting?1:0)+1+12+(isAdmin?1:0)} className="!max-w-none !whitespace-normal !p-0"><div className="max-w-3xl border-l-2 border-primary bg-background px-6 py-4"><div className="flex items-start justify-between gap-4"><h3 className="break-words text-base font-semibold">{b.title}</h3><Button size="sm" variant="outline" onClick={()=>{setEditOnOpen(false);setId(b.id);}}>Open details</Button></div><InlineReport id={b.id} access={access}/></div></td></tr>}</Fragment>;})}</tbody></table>{rows.length===0&&<div className="bf-empty"><Bug/><h3>{d.total===0?'No bugs reported yet':'No bugs match this view'}</h3>{d.actor.permissions.includes('report')&&d.total===0&&<Button variant="outline" onClick={()=>setReport(true)}><Plus/>Raise a bug</Button>}</div>}</div>
 <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>Showing {rows.length?current*PAGE+1:0}–{Math.min(rows.length,(current+1)*PAGE)} of {rows.length} · {assignmentsOnly?counts.total:d.total} in your scope</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={current===0&&pages.length===0} onClick={()=>{if(current>0)setPage(current-1);else{setCursor(pages.at(-1));setPages(old=>old.slice(0,-1));setPage(0);}}}>Previous</Button><span>Page {current+1} / {pageCount}</span><Button variant="outline" size="sm" disabled={current>=pageCount-1&&!d.nextCursor} onClick={()=>{if(current<pageCount-1)setPage(current+1);else{setPages(old=>[...old,cursor]);setCursor(d.nextCursor??undefined);setPage(0);}}}>Next</Button></div></div>
 <Dialog open={profile!==null} onOpenChange={o=>{if(!o)setProfile(null);}}><DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>Member profile</DialogTitle><DialogDescription>Details, permissions and portal controls</DialogDescription></DialogHeader>{profile&&<MemberProfile id={profile} onDeleted={()=>setProfile(null)}/>}</DialogContent></Dialog>
 <Dialog open={report} onOpenChange={setReport}><DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>Raise a bug</DialogTitle><DialogDescription>New report · {d.actor.name}</DialogDescription></DialogHeader><BugReportForm access={access} projects={d.projects} options={d.options} onSaved={saved=>{setReport(false);setId(saved);}}/></DialogContent></Dialog>
 <Dialog open={id!==null} onOpenChange={open=>{if(!open){setId(null);setEditOnOpen(false);}}}><DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>Bug details</DialogTitle><DialogDescription>Report, ownership and change history</DialogDescription></DialogHeader>{id&&<BugDetails startEditing={editOnOpen} onDeleted={()=>setId(null)} key={id} id={id} access={access} workspace={d}/>}</DialogContent></Dialog>
 </>;
}
export function BugDetails({id,access,workspace,onDeleted=()=>{},startEditing=false}:{startEditing?:boolean;id:string;access:BugAccess;workspace:BugWorkspaceData;onDeleted?:()=>void}){
 const client=useQueryClient();const fetch=useServerFn(getBugDetail);const update=useServerFn(updateBug);const detail=useQuery({queryKey:['bug-detail',access,id],queryFn:()=>fetch({data:{access,id}}),retry:false,refetchInterval:20000});
 const [notes,setNotes]=useState('');const [noteTo,setNoteTo]=useState('');const [noteToName,setNoteToName]=useState('');const [status,setStatus]=useState('');const [priority,setPriority]=useState('');const [assignees,setAssignees]=useState<string[]>([]);const [pending,setPending]=useState<Partial<BugChange>|null>(null);const [requestId,setRequestId]=useState(()=>crypto.randomUUID());const [editing,setEditing]=useState(startEditing);const [removing,setRemoving]=useState(false);const remove=useServerFn(deleteBug);
 const mutation=useMutation({mutationFn:update,onSuccess:async()=>{await Promise.all([client.invalidateQueries({queryKey:['bug-detail']}),client.invalidateQueries({queryKey:['bug-workspace']})]);setNotes('');setNoteTo('');setNoteToName('');setStatus('');setPriority('');setAssignees([]);setRequestId(crypto.randomUUID());toast.success('Bug updated');}});
 if(detail.isPending)return <p role="status">Loading bug…</p>;
 if(detail.isError)return <ErrorNotice message={actionError(detail.error,'This bug could not be loaded.')} onRetry={()=>{void detail.refetch();}}/>;
 const b=detail.data.bug;const actor=workspace.actor;const options=allowedStatuses(actor,b);
 if(editing)return <div className="grid gap-3"><div className="flex items-center justify-between"><strong className="text-sm">Edit {b.code}</strong><Button size="sm" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button></div><BugReportForm access={access} projects={workspace.projects} options={workspace.options} initial={b} onSaved={()=>setEditing(false)}/></div>;
 async function commit(change:Partial<BugChange>){await mutation.mutateAsync({data:{access,change:{requestId,id,version:b.version,action:change.action??'comment',notes,noteTo:notes.trim()?(noteTo==='Other'?`Other · ${noteToName.trim()}`:noteTo):'',...change}}});}
 const busy=mutation.isPending;
 const addComment=async()=>{if(!notes.trim())return;await commit({action:'comment'});};
 const people=b.assignees?.length?b.assignees:b.assigneeId?[{id:b.assigneeId,name:b.assignee}]:[];
 return <div className="bf-bd">
  <header className="bf-bd-hero" data-pri={b.priority}>
   <div className="bf-bd-hero-top"><span className="bf-bd-code">{b.code}</span>{b.module&&<span className="bf-bd-chip">{b.module}</span>}{b.project&&<span className="bf-bd-chip">{b.project}</span>}
    <span className="ml-auto flex items-center gap-2">{mayEditBug(actor,b)&&<Button size="sm" variant="outline" onClick={()=>setEditing(true)}><Pencil/>Edit</Button>}{actor.role==='admin'&&<Button size="sm" variant="outline" className="text-destructive" onClick={()=>setRemoving(true)}><Trash2/>Delete</Button>}</span></div>
   <h2 className="bf-detail-title">{b.title}</h2>
   <div className="bf-bd-controls">
    <span className="bf-bd-control"><small>Priority · severity</small><RowRating bug={b} access={access} workspace={workspace} editable={actor.role==='admin'}/></span>
    <span className="bf-bd-control"><small>Status</small><RowStatus bug={b} access={access} workspace={workspace}/></span>
    <span className="bf-bd-control"><small>Assignee</small>{actor.permissions.includes('assign')?<RowAssign bug={b} access={access} workspace={workspace}/>:<span className="bf-owner">{people.map(p=>p.name).join(', ')||'Unassigned'}</span>}</span>
   </div>
   <dl className="bf-bd-meta">
    <div><dt><UserRound size={13}/>Reported by</dt><dd><span className="bf-avatar !size-5 !text-[9.5px]">{b.reporter.slice(0,2).toUpperCase()}</span>{b.reporter}</dd></div>
    <div><dt><CalendarClock size={13}/>Reported</dt><dd>{dateLabel(b.createdAt)}</dd></div>
    <div><dt><History size={13}/>Updated</dt><dd>{dateLabel(b.updatedAt)}</dd></div>
    <div><dt><Server size={13}/>Environment</dt><dd>{b.environment||'Not specified'}</dd></div>
    <div><dt><Monitor size={13}/>Browser / device</dt><dd>{b.browserDevice||'Not specified'}</dd></div>
   </dl>
   <ConfirmAction open={removing} onOpenChange={setRemoving} destructive title={`Delete ${b.code}?`} description="The bug disappears from every list, count and portal. The deletion is recorded with your name, date and time." confirmLabel="Delete bug" onConfirm={async()=>{await remove({data:{id:b.id,reason:''}});await client.invalidateQueries({queryKey:['bug-workspace']});toast.success(`${b.code} deleted`);onDeleted();}}/>
  </header>
  <StatusNoteBox bug={b}/>
  <BugReportContent bug={b} showEvidence={actor.permissions.includes('evidence')}/>
  {actor.permissions.includes('comment')&&<section className="bf-rc-card" data-tone="info"><h3 className="bf-section-title"><span className="bf-rc-icon"><MessageSquare size={15}/></span>Add a comment</h3>
   <textarea className="bf-note-input" rows={3} maxLength={4000} placeholder="Share an update, ask a question or add context…" value={notes} onChange={e=>setNotes(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void addComment();}}}/>
   <div className="flex flex-wrap items-center gap-2">{notes.trim()&&<><ThemedSelect label="Send note to" placeholder="Send to… (optional)" value={noteTo} onChange={setNoteTo} options={[`Developer · ${b.assignee}`,`Reporter · ${b.reporter}`,'Product manager','Client','Other'].map(v=>({value:v,label:v}))}/>{noteTo==='Other'&&<Input className="h-9 w-48" placeholder="Name (specify)" value={noteToName} maxLength={60} onChange={e=>setNoteToName(e.target.value)}/>}</>}
    <Button size="sm" className="ml-auto" disabled={!notes.trim()||busy} onClick={()=>void addComment()}>{busy?<RefreshCw className="animate-spin"/>:<MessageSquare/>}Post comment</Button></div>
   <p className="text-[11.5px] text-muted-foreground">Ctrl/⌘ + Enter to post · status, priority and assignee are changed from the chips above.</p>
  </section>}
  <BugHistory events={detail.data.events} admin={access.kind==='admin'}/>
 </div>;
}

function InlineReport({id,access}:{id:string;access:BugAccess}){
 const fetch=useServerFn(getBugDetail);const detail=useQuery({queryKey:['bug-detail',access,id],queryFn:()=>fetch({data:{access,id}}),retry:false,refetchInterval:20000});
 if(detail.isPending)return <p role="status" className="py-4 text-sm text-muted-foreground">Loading report…</p>;
 if(detail.isError)return <ErrorNotice message="The report could not be loaded." onRetry={()=>{void detail.refetch();}}/>;
 return <BugReportContent bug={detail.data.bug} showEvidence={detail.data.bug.evidenceUrls.length>0}/>;
}

/** Severity: signal-bar badge coloured by its rank in the configured list. */
export function SeverityBadge({value,list}:{value:string;list:readonly string[]}){const level=severityLevel(value,list);return <span className="bf-sev" data-sev={level}><span className="bf-sev-bars" aria-hidden="true"><i/><i/><i/></span>{value}</span>;}
/** Priority: compact square badge P0–P5 with its name on hover. */
export function PriorityBadge({value}:{value:string}){return <span className="bf-pri" data-pri={value} title={priorityNames[value]}>{value}</span>;}

/** Statuses whose reason matters to whoever works on the bug next. */
const NOTE_STATUSES=['REOPENED','NEEDS_INFORMATION','NOT_A_BUG','DUPLICATE','WONT_FIX','RECHECK'];
const NOTE_HEADINGS:Record<string,string>={REOPENED:'Why it was reopened',NEEDS_INFORMATION:'What information is needed',NOT_A_BUG:'Why it isn’t a bug',DUPLICATE:'Duplicate of',WONT_FIX:'Why it won’t be fixed',RECHECK:'What was fixed'};
const NOTE_SHORT:Record<string,string>={REOPENED:'Reopened',NEEDS_INFORMATION:'Needs info',NOT_A_BUG:'Not a bug',DUPLICATE:'Duplicate',WONT_FIX:'Won’t fix',RECHECK:'Fix note'};
function StatusNoteLine({status,note}:{status:string;note:NonNullable<LiveBug['statusNote']>}){
 return <span className="bf-status-note" data-status={status} title={`${NOTE_HEADINGS[status]} — ${note.by}, ${dateLabel(note.at)}\n${note.notes}`}>
  <MessageSquareWarning size={12} aria-hidden="true"/><b>{NOTE_SHORT[status]}:</b><span className="truncate">{note.notes}</span></span>;
}
function StatusNoteBox({bug}:{bug:LiveBug}){
 if(!bug.statusNote||!NOTE_STATUSES.includes(bug.status))return null;
 return <div className="bf-status-note-box" data-status={bug.status} role="note">
  <MessageSquareWarning size={18} aria-hidden="true"/>
  <div className="min-w-0"><strong>{NOTE_HEADINGS[bug.status]}</strong><p>{bug.statusNote.notes}</p><small>{bug.statusNote.by} · {dateLabel(bug.statusNote.at)}</small></div>
 </div>;
}

/** Collapsible, colour-coded change history for one bug. */
const HISTORY_KIND:Record<string,{icon:typeof Bug;tone:string;label:string}>={'bug.created':{icon:Bug,tone:'info',label:'Reported'},'bug.sample_created':{icon:Bug,tone:'info',label:'Sample added'},'bug.status':{icon:ArrowRightLeft,tone:'teal',label:'Status changed'},'bug.verify':{icon:ClipboardCheck,tone:'success',label:'QA retest'},'bug.priority':{icon:Flag,tone:'warning',label:'Priority changed'},'bug.severity':{icon:Flag,tone:'warning',label:'Severity changed'},'bug.assign':{icon:UserPlus,tone:'violet',label:'Assigned'},'bug.comment':{icon:MessageSquare,tone:'neutral',label:'Comment'},'bug.edited':{icon:Pencil,tone:'neutral',label:'Details edited'}};
function BugHistory({events,admin}:{events:{id:string;actor:string;action:string;detail:Record<string,string>;createdAt:string}[];admin:boolean}){
 const [open,setOpen]=useState(false);
 return <section className="bf-bd-history" data-open={open||undefined}>
  <button type="button" className="bf-bd-history-toggle" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
   <ChevronRight size={16} className="bf-bd-chevron"/><span className="bf-section-title">{admin?'Bug history':'Bug lifecycle'}</span><span className="bf-bd-count">{events.length}</span>
   <span className="ml-auto text-xs font-normal text-muted-foreground">{open?'Hide':'Show'} {admin?'every change':'latest steps'}</span>
  </button>
  {open&&<ol className="bf-bd-timeline">{events.map(e=>{const k=HISTORY_KIND[e.action]??{icon:History,tone:'neutral',label:statusLabel(e.action.replace(/^[a-z]+\./,''))};const Icon=k.icon;const moved=!!e.detail['status']&&!!e.detail['previousStatus']&&e.detail['previousStatus']!==e.detail['status'];
   const failed=e.action==='bug.verify'&&e.detail['status']==='REOPENED';
   return <li key={e.id}><span className="bf-kind" data-tone={failed?'danger':k.tone}><Icon size={14}/></span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="text-sm"><strong>{e.actor}</strong> <span className="text-muted-foreground">{failed?'failed the QA retest':e.action==='bug.verify'?'passed the QA retest':k.label.toLowerCase()}</span></span><time className="text-xs text-muted-foreground">{dateLabel(e.createdAt)}</time></div>
     {moved&&<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"><span className="bf-status-pill" data-tone={statusTone(String(e.detail['previousStatus']))}>{statusLabel(String(e.detail['previousStatus']||'NEW'))}</span>→<span className="bf-status-pill" data-tone={statusTone(String(e.detail['status']))}>{statusLabel(String(e.detail['status']))}</span></div>}
     {e.action==='bug.priority'&&<div className="mt-1 flex items-center gap-1.5 text-xs"><PriorityBadge value={String(e.detail['previousPriority'])}/>→<PriorityBadge value={String(e.detail['priority'])}/></div>}
     {e.action==='bug.severity'&&e.detail['severity']&&<p className="mt-1 text-xs text-muted-foreground">{e.detail['previousSeverity']} → {e.detail['severity']}</p>}
     {e.detail['noteTo']&&<p className="mt-1 text-xs text-primary">Note to {e.detail['noteTo']}</p>}
     {e.detail['notes']&&<p className="bf-bd-note">{e.detail['notes']}</p>}
    </div></li>;})}</ol>}
 </section>;
}
