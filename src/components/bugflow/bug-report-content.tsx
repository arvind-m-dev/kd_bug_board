import { FileText, ListChecks, Target, AlertCircle, Link2 } from 'lucide-react';
import type { LiveBug } from '@/lib/bug-workflow';

export function BugReportContent({bug,showEvidence}:{bug:LiveBug;showEvidence:boolean}) {
 return <div className="grid min-w-0 gap-5 py-4">
  <section className="border-l-2 border-primary pl-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText size={16} className="text-primary"/>Bug description</h3><p className="whitespace-pre-wrap break-words text-sm leading-6">{bug.description}</p></section>
  <section><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ListChecks size={16} className="text-primary"/>Steps to replicate</h3><ol className="grid gap-2">{bug.steps.map((step,i)=><li key={i} className="flex gap-3 text-sm leading-6"><span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-primary">{i+1}</span><span className="min-w-0 whitespace-pre-wrap break-words">{step}</span></li>)}</ol></section>
  <div className="grid gap-4 border-y py-4 sm:grid-cols-2">{[{title:'Expected result',text:bug.expected,icon:Target},{title:'Actual result',text:bug.actual,icon:AlertCircle}].map(s=><section key={s.title}><h3 className="mb-2 flex items-center gap-2 text-xs font-semibold"><s.icon size={15} className="text-muted-foreground"/>{s.title}</h3><p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{s.text||'Not specified'}</p></section>)}</div>
  {showEvidence&&bug.evidenceUrls.length>0&&<section><h3 className="mb-2 flex items-center gap-2 text-xs font-semibold"><Link2 size={15}/>Evidence links</h3><div className="flex flex-wrap gap-3">{bug.evidenceUrls.map((url,i)=><a key={`${url}-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline underline-offset-4">Drive evidence {i+1}</a>)}</div></section>}
 </div>;
}