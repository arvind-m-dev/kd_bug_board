import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ExternalLink, FileText, Film, Image as ImageIcon, LoaderCircle, Paperclip, Play, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ConfirmAction, actionError } from './action-feedback';
import { deleteMedia, finishMediaUpload, prepareMediaUpload } from '@/lib/bug-media.functions';
import { formatBytes, mayDeleteMedia, mayUploadMedia, type MediaConfig, type MediaItem } from '@/lib/bug-media';
import { prepareFile, uploadPut, type PreparedFile } from '@/lib/media-client';
import type { BugAccess, BugActor, LiveBug } from '@/lib/bug-workflow';
import { timeAgo } from '@/lib/format';

export type UploadState = { id: string; name: string; size: number; status: 'preparing' | 'queued' | 'uploading' | 'verifying' | 'done' | 'failed'; progress: number; error?: string | undefined; preview?: string | undefined; file?: PreparedFile | undefined; abort?: AbortController | undefined };
const label = (u: UploadState) => u.status === 'preparing' ? 'Compressing…' : u.status === 'queued' ? 'Ready to upload' : u.status === 'uploading' ? `Uploading ${Math.round(u.progress * 100)}%` : u.status === 'verifying' ? 'Verifying…' : u.status === 'done' ? 'Attached' : u.error ?? 'Failed';

/**
 * Upload queue: compress in the browser → signed link → PUT straight to the bucket → server verification.
 * With bugId null the files are only prepared ("staged") until start(bugId) is called — the report form uses that.
 */
export function useMediaUpload(access: BugAccess, bugId: string | null) {
  const client = useQueryClient(); const prepare = useServerFn(prepareMediaUpload); const finish = useServerFn(finishMediaUpload);
  const [uploads, setUploads] = useState<UploadState[]>([]); const latest = useRef<UploadState[]>([]); latest.current = uploads;
  const patch = (id: string, p: Partial<UploadState>) => setUploads(list => list.map(u => (u.id === id ? { ...u, ...p } : u)));
  useEffect(() => () => { for (const u of latest.current) if (u.preview) URL.revokeObjectURL(u.preview); }, []);
  async function send(u: UploadState, target: string) {
    if (!u.file) return false;
    const abort = new AbortController(); patch(u.id, { status: 'uploading', progress: 0, error: undefined, abort });
    try {
      const { uploadUrl, headers } = await prepare({ data: { access, upload: { bugId: target, id: u.id, name: u.file.name, contentType: u.file.contentType, size: u.file.size } } });
      await uploadPut(uploadUrl, headers, u.file.blob, f => patch(u.id, { progress: f }), abort.signal);
      patch(u.id, { status: 'verifying', progress: 1 });
      await finish({ data: { access, upload: { id: u.id, width: u.file.width, height: u.file.height } } });
      patch(u.id, { status: 'done' });
      await Promise.all([client.invalidateQueries({ queryKey: ['bug-detail'] }), client.invalidateQueries({ queryKey: ['bug-workspace'] })]);
      window.setTimeout(() => setUploads(list => list.filter(x => x.id !== u.id)), 1500);
      return true;
    } catch (e) { patch(u.id, { status: 'failed', error: actionError(e, 'The upload failed.') }); return false; }
  }
  async function add(files: File[]) {
    for (const f of files) {
      const id = crypto.randomUUID(); const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      setUploads(list => [...list, { id, name: f.name, size: f.size, status: 'preparing', progress: 0, preview }]);
      const r = await prepareFile(f);
      if (!r.ok) { patch(id, { status: 'failed', error: r.error }); continue; }
      const u: UploadState = { id, name: r.file.name, size: r.file.size, status: 'queued', progress: 0, preview, file: r.file }; patch(id, u);
      if (bugId) void send(u, bugId);
    }
  }
  /** Uploads everything staged, one after another; returns how many failed. */
  async function start(target: string) { let failed = 0; for (const u of latest.current) if (u.status === 'queued' || u.status === 'failed') { if (!(await send(u, target))) failed++; } return failed; }
  const retry = (id: string) => { const u = latest.current.find(x => x.id === id); if (u && bugId) void send(u, bugId); else if (u) patch(id, { status: 'queued', error: undefined }); };
  const remove = (id: string) => { const u = latest.current.find(x => x.id === id); u?.abort?.abort(); if (u?.preview) URL.revokeObjectURL(u.preview); setUploads(list => list.filter(x => x.id !== id)); };
  const busy = uploads.some(u => u.status === 'preparing' || u.status === 'uploading' || u.status === 'verifying');
  const staged = uploads.filter(u => u.status === 'queued' || u.status === 'failed').length;
  return { uploads, add, start, retry, remove, busy, staged };
}

/** Drop zone + picker + the queue of files in flight. Purely presentational; the hook above does the work. */
export function MediaDropZone({ accept, remaining, disabledReason, onFiles, uploads, onRetry, onRemove, hint }: { accept: string[]; remaining: number; disabledReason?: string | undefined; onFiles: (files: File[]) => void; uploads: UploadState[]; onRetry: (id: string) => void; onRemove: (id: string) => void; hint?: string | undefined }) {
  const input = useRef<HTMLInputElement>(null); const [active, setActive] = useState(false);
  const disabled = !!disabledReason || remaining <= 0;
  const take = (list: FileList | null) => { if (!list) return; const files = [...list]; if (disabledReason) { toast.error(disabledReason); return; } if (files.length > remaining) toast.error(`Only ${remaining} more ${remaining === 1 ? 'file' : 'files'} can be attached to this bug.`); onFiles(files.slice(0, Math.max(0, remaining))); };
  return <div className="grid gap-3">
    <div className="bf-upload" role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} data-active={active} onClick={() => !disabled && input.current?.click()} onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={e => { e.preventDefault(); if (!disabled) setActive(true); }} onDragLeave={() => setActive(false)} onDrop={e => { e.preventDefault(); setActive(false); take(e.dataTransfer.files); }}>
      <input ref={input} type="file" multiple accept={accept.join(',')} className="sr-only" tabIndex={-1} onChange={e => { take(e.target.files); e.target.value = ''; }} />
      <Upload size={24} />
      <strong className="text-xs">{disabledReason ? 'Media uploads unavailable' : remaining <= 0 ? 'This bug has all 10 files' : 'Drop screenshots, recordings or PDFs here'}</strong>
      <span className="text-xs text-muted-foreground">{disabledReason ?? (remaining <= 0 ? 'Remove one to add another' : hint ?? `PNG, JPEG, WebP, GIF, MP4, WebM or PDF · images are compressed automatically · ${remaining} more`)}</span>
      {!disabledReason && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={e => { e.stopPropagation(); input.current?.click(); }}><Paperclip />Choose files</Button>}
    </div>
    {uploads.length > 0 && <ul className="bf-upload-queue" aria-live="polite">{uploads.map(u => <li key={u.id} className="bf-upload-row" data-status={u.status}>
      {u.preview ? <img src={u.preview} alt="" /> : <span className="bf-upload-ph">{u.name.toLowerCase().endsWith('.pdf') ? <FileText size={18} /> : <Film size={18} />}</span>}
      <span className="min-w-0"><strong title={u.name}>{u.name}</strong><small>{formatBytes(u.size)} · {label(u)}</small>{(u.status === 'uploading' || u.status === 'verifying') && <Progress value={u.progress * 100} className="mt-1 h-1.5" />}</span>
      <span className="flex items-center gap-1">{u.status === 'failed' && u.file && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onRetry(u.id)}><RefreshCw />Retry</Button>}{(u.status === 'preparing' || u.status === 'uploading' || u.status === 'verifying') ? <LoaderCircle className="animate-spin text-muted-foreground" size={16} /> : <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${u.name}`} onClick={() => onRemove(u.id)}><X /></Button>}</span>
    </li>)}</ul>}
  </div>;
}

/** The "Attachments" card on a bug: gallery with lightbox, Open and Remove, plus the drop zone for people who may attach files. */
export function BugMedia({ access, bug, actor, items, config, readOnly = false }: { access: BugAccess; bug: LiveBug; actor: BugActor; items: MediaItem[]; config: MediaConfig; readOnly?: boolean }) {
  const client = useQueryClient(); const remove = useServerFn(deleteMedia);
  const [open, setOpen] = useState<MediaItem | null>(null); const [removing, setRemoving] = useState<MediaItem | null>(null);
  const uploader = useMediaUpload(access, bug.id);
  const canSee = actor.permissions.includes('evidence'); const canUpload = !readOnly && mayUploadMedia(actor, bug);
  if (!canSee && !canUpload) return null;
  if (readOnly && items.length === 0) return null;
  const disabledReason = !config.enabled ? 'Media uploads are off until your Admin connects storage in Settings → Media storage. Add a Drive link instead.' : undefined;
  if (!canUpload && items.length === 0) return null;
  return <section className="bf-rc-card" data-tone="info"><h3 className="bf-section-title"><span className="bf-rc-icon"><Paperclip size={15} /></span>Attachments{items.length > 0 && <span className="bf-tag ml-1">{items.length} of {config.maxFiles}</span>}</h3>
    {items.length > 0 && <div className="bf-media-grid">{items.map(m => <figure key={m.id} className="bf-media-tile">
      <button type="button" className="bf-media-thumb" data-kind={m.kind} onClick={() => (m.kind === 'pdf' ? window.open(m.url ?? '', '_blank', 'noopener,noreferrer') : setOpen(m))} aria-label={`Open ${m.name}`} disabled={!m.url}>
        {m.kind === 'image' && m.url ? <img src={m.url} alt={m.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : m.kind === 'video' && m.url ? <><video src={m.url} preload="metadata" muted playsInline /><span className="bf-media-play"><Play size={18} /></span></> : m.kind === 'pdf' ? <FileText size={30} /> : <ImageIcon size={30} />}
        <span className="bf-media-kind">{m.kind}</span>
      </button>
      <figcaption className="bf-media-cap"><strong title={m.name}>{m.name}</strong><small>{formatBytes(m.size)} · {m.uploadedBy} · {timeAgo(m.createdAt)}</small></figcaption>
      <span className="bf-media-actions">{m.url && <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><a href={m.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink />Open</a></Button>}{!readOnly && mayDeleteMedia(actor, m) && <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs text-destructive" onClick={() => setRemoving(m)}><Trash2 />Remove</Button>}</span>
    </figure>)}</div>}
    {canUpload && <MediaDropZone accept={config.accept} remaining={config.maxFiles - items.length - uploader.uploads.filter(u => u.status !== 'failed').length} disabledReason={disabledReason} onFiles={f => void uploader.add(f)} uploads={uploader.uploads} onRetry={uploader.retry} onRemove={uploader.remove} />}
    {items.some(m => !m.url) && <p className="text-xs text-muted-foreground">Some files cannot be shown because media storage is not connected right now.</p>}
    <Dialog open={open !== null} onOpenChange={o => { if (!o) setOpen(null); }}><DialogContent className="bf-lightbox max-w-4xl"><DialogHeader><DialogTitle className="truncate">{open?.name}</DialogTitle><DialogDescription>{open ? `${formatBytes(open.size)} · attached by ${open.uploadedBy} · ${timeAgo(open.createdAt)}` : ''}</DialogDescription></DialogHeader>
      {open?.kind === 'image' && open.url && <img src={open.url} alt={open.name} referrerPolicy="no-referrer" />}
      {open?.kind === 'video' && open.url && <video src={open.url} controls autoPlay playsInline />}
      {open?.url && <Button asChild variant="outline" size="sm" className="justify-self-start"><a href={open.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink />Open in a new tab</a></Button>}
    </DialogContent></Dialog>
    <ConfirmAction open={removing !== null} onOpenChange={o => { if (!o) setRemoving(null); }} destructive title={`Remove ${removing?.name ?? 'this file'}?`} description="The file is removed from this bug for everyone and deleted from private storage. The removal is recorded with your name, date and time." confirmLabel="Remove file"
      onConfirm={async () => { if (!removing) return; await remove({ data: { access, media: { id: removing.id } } }); await Promise.all([client.invalidateQueries({ queryKey: ['bug-detail'] }), client.invalidateQueries({ queryKey: ['bug-workspace'] })]); toast.success('File removed'); setRemoving(null); }} />
  </section>;
}
