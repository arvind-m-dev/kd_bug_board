import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Images, Link2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from './action-feedback';
import { MediaLightbox, MediaThumb, Lineage, copyMediaLink } from './bug-media';
import { getMediaLibrary } from '@/lib/bug-media.functions';
import { formatBytes, mediaLinkPath, type LibraryItem } from '@/lib/bug-media';
import type { BugAccess } from '@/lib/bug-workflow';
import { statusLabel, statusTone, timeAgo } from '@/lib/format';

/**
 * "My media": every file this person attached, grouped by bug, with a link per file and per bug.
 * Admin sees everyone's files. Links open the bug for whoever has access to it; nothing here is public.
 */
export function MediaLibrary({ access, title = 'My media' }: { access: BugAccess; title?: string }) {
  const fetch = useServerFn(getMediaLibrary);
  const library = useQuery({ queryKey: ['media-library', access], queryFn: () => fetch({ data: { access } }), retry: false, staleTime: 10000, refetchInterval: 30000 });
  const [q, setQ] = useState(''); const [open, setOpen] = useState<number | null>(null);
  const items = useMemo(() => { const all = library.data ?? []; const needle = q.trim().toLowerCase(); return needle ? all.filter(m => `${m.name} ${m.bugCode} ${m.bugTitle}`.toLowerCase().includes(needle)) : all; }, [library.data, q]);
  const groups = useMemo(() => { const map = new Map<string, LibraryItem[]>(); for (const m of items) map.set(m.bugId, [...(map.get(m.bugId) ?? []), m]); return [...map.values()]; }, [items]);
  const total = (library.data ?? []).reduce((n, m) => n + m.size, 0);
  return <section className="bf-panel p-5">
    <div className="bf-panel-heading"><div><h2><Images size={18} />{title}</h2><p>{library.data ? `${library.data.length} ${library.data.length === 1 ? 'file' : 'files'} · ${formatBytes(total)} · each file has its own link, and each bug a link to all of its files.` : 'Screenshots, recordings and PDFs you attached, by bug.'}</p></div>
      <label className="bf-search"><Search size={15} /><input value={q} placeholder="Search by name or bug" onChange={e => setQ(e.target.value)} aria-label="Search files" /></label></div>
    {library.isPending && <p role="status" className="py-6 text-sm text-muted-foreground">Loading your files…</p>}
    {library.isError && <ErrorNotice message="Your files could not be loaded." onRetry={() => { void library.refetch(); }} />}
    {library.data && groups.length === 0 && <div className="bf-empty"><span className="bf-empty-icon"><Images size={22} /></span><strong>{q ? 'Nothing matches that search.' : 'No files yet.'}</strong><p>{q ? 'Try another name or bug code.' : 'Files you attach to a bug, and marked-up copies you save, appear here with the names you gave them.'}</p></div>}
    <div className="bf-library">{groups.map(g => { const first = g[0]!; return <article key={first.bugId} className="bf-library-group">
      <header><span className="bf-tag">{first.bugCode}</span><strong className="truncate">{first.bugTitle}</strong><span className="bf-status-pill" data-tone={statusTone(first.bugStatus)}><i className="bf-dot" />{statusLabel(first.bugStatus)}</span>
        <span className="ml-auto flex gap-1"><Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void copyMediaLink(first.bugId)}><Link2 />Copy link to all {g.length === 1 ? '' : g.length} files</Button><Button asChild variant="ghost" size="sm" className="h-7 text-xs"><Link to={mediaLinkPath(first.bugId)}><ArrowUpRight />Open bug</Link></Button></span></header>
      <div className="bf-media-grid">{g.map(m => <figure key={m.id} className="bf-media-tile" data-derived={m.derivedFrom ? '' : undefined}>
        <MediaThumb item={m} onOpen={() => setOpen(items.indexOf(m))} />
        <figcaption className="bf-media-cap"><strong title={m.name}>{m.name}</strong><small>{formatBytes(m.size)} · {timeAgo(m.createdAt)}{access.kind === 'admin' ? ` · ${m.uploadedBy}` : ''}</small><Lineage item={m} items={g} /></figcaption>
        <span className="bf-media-actions"><Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void copyMediaLink(m.bugId, m.id)}><Link2 />Copy link</Button></span>
      </figure>)}</div>
    </article>; })}</div>
    <MediaLightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
  </section>;
}
