import { FileText, ListChecks, Target, AlertCircle, Link2 } from 'lucide-react';
import type { LiveBug } from '@/lib/bug-workflow';

/** The written report as colour-coded cards: description, steps, expected vs actual, evidence. */
export function BugReportContent({bug,showEvidence}:{bug:LiveBug;showEvidence:boolean}) {
 return <div className="grid min-w-0 gap-3 py-2">
  <section className="bf-rc-card" data-tone="teal"><h3 className="bf-section-title"><span className="bf-rc-icon"><FileText size={15}/></span>Bug description</h3><p className="whitespace-pre-wrap break-words text-sm leading-6">{bug.description}</p></section>
  <section className="bf-rc-card" data-tone="violet"><h3 className="bf-section-title"><span className="bf-rc-icon"><ListChecks size={15}/></span>Steps to replicate</h3><ol className="grid gap-2">{bug.steps.map((step,i)=><li key={i} className="flex gap-3 text-sm leading-6"><span className="bf-rc-step">{i+1}</span><span className="min-w-0 whitespace-pre-wrap break-words">{step}</span></li>)}</ol></section>
  <div className="grid gap-3 sm:grid-cols-2">{[{title:'Expected result',text:bug.expected,icon:Target,tone:'success'},{title:'Actual result',text:bug.actual,icon:AlertCircle,tone:'danger'}].map(s=><section key={s.title} className="bf-rc-card" data-tone={s.tone}><h3 className="bf-section-title"><span className="bf-rc-icon"><s.icon size={15}/></span>{s.title}</h3><p className="whitespace-pre-wrap break-words text-sm leading-6">{s.text||<span className="text-muted-foreground">Not specified</span>}</p></section>)}</div>
  {showEvidence&&bug.evidenceUrls.length>0&&<section className="bf-rc-card" data-tone="info"><h3 className="bf-section-title"><span className="bf-rc-icon"><Link2 size={15}/></span>Evidence links</h3><div className="flex flex-wrap gap-2">{bug.evidenceUrls.map((url,i)=><a key={`${url}-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="bf-rc-link">Drive evidence {i+1}</a>)}</div></section>}
 </div>;
}
