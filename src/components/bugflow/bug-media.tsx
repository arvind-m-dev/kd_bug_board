import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Camera, Check, ChevronLeft, ChevronRight, ExternalLink, FileText, Film, Image as ImageIcon, Link2, LoaderCircle, Paperclip, Pencil, PenLine, Play, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ConfirmAction, actionError } from './action-feedback';
import { AnnotationEditor, captureFrame, loadImage, type AnnotationSource } from './media-annotate';
import { moveToTrashToast } from './trash-bin';
import { clearBugMedia, deleteMedia, finishMediaUpload, prepareMediaUpload, renameMedia } from '@/lib/bug-media.functions';
import { MEDIA_NAME_MAX, clock, formatBytes, isClosedForMedia, mayDeleteMedia, mayUploadMedia, mediaLinkPath, type MediaConfig, type MediaItem } from '@/lib/bug-media';
import { prepareFile, uploadPut, type PreparedFile } from '@/lib/media-client';
import type { BugAccess, BugActor, LiveBug } from '@/lib/bug-workflow';
import { timeAgo } from '@/lib/format';

export type UploadMeta = { name?: string; derivedFrom?: string | null; atSeconds?: number | null };
export type UploadState = { id: string; name: string; label: string; size: number; status: 'preparing' | 'queued' | 'uploading' | 'verifying' | 'done' | 'failed'; progress: number; note?: string | undefined; error?: string | undefined; preview?: string | undefined; file?: PreparedFile | undefined; abort?: AbortController | undefined; derivedFrom: string | null; atSeconds: number | null };
const label = (u: UploadState) => u.status === 'preparing' ? (u.note ?? 'Compressing…') : u.status === 'queued' ? 'Ready to upload' : u.status === 'uploading' ? `Uploading ${Math.round(u.progress * 100)}%` : u.status === 'verifying' ? 'Verifying…' : u.status === 'done' ? 'Attached' : u.error ?? 'Failed';
const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || name;

/** Copies an in-app link to a bug's files (or one file). It opens for whoever is signed in or has their portal open. */
export async function copyMediaLink(bugId: string, mediaId?: string) {
  const url = `${window.location.origin}${mediaLinkPath(bugId, mediaId)}`;
  try { await navigator.clipboard.writeText(url); toast.success('Link copied', { description: mediaId ? 'Opens this file on the bug for anyone with access to it.' : 'Opens the bug with all its files for anyone with access to it.' }); }
  catch { toast.error('The link could not be copied.', { description: url }); }
}

/**
 * Upload queue: compress in the browser → signed link → PUT straight to the bucket → server verification.
 * With bugId null the files are only prepared ("staged") until start(bugId) is called — the report form uses that.
 * Each file carries a name people can edit before it goes up (and rename afterwards).
 */
export function useMediaUpload(access: BugAccess, bugId: string | null) {
  const client = useQueryClient(); const prepare = useServerFn(prepareMediaUpload); const finish = useServerFn(finishMediaUpload);
  const [uploads, setUploads] = useState<UploadState[]>([]); const latest = useRef<UploadState[]>([]); latest.current = uploads;
  const patch = (id: string, p: Partial<UploadState>) => setUploads(list => list.map(u => (u.id === id ? { ...u, ...p } : u)));
  useEffect(() => () => { for (const u of latest.current) if (u.preview) URL.revokeObjectURL(u.preview); }, []);
  async function send(u: UploadState, target: string) {
    if (!u.file) return false;
    const abort = new AbortController(); patch(u.id, { status: 'uploading', progress: 0, error: undefined, abort });
    const name = (latest.current.find(x => x.id === u.id)?.label ?? u.label).trim() || u.file.name;
    try {
      const { uploadUrl, headers } = await prepare({ data: { access, upload: { bugId: target, id: u.id, name, contentType: u.file.contentType, size: u.file.size, derivedFrom: u.derivedFrom, atSeconds: u.atSeconds } } });
      await uploadPut(uploadUrl, headers, u.file.blob, f => patch(u.id, { progress: f }), abort.signal);
      patch(u.id, { status: 'verifying', progress: 1 });
      await finish({ data: { access, upload: { id: u.id, width: u.file.width, height: u.file.height } } });
      patch(u.id, { status: 'done' });
      await Promise.all([client.invalidateQueries({ queryKey: ['bug-detail'] }), client.invalidateQueries({ queryKey: ['bug-workspace'] }), client.invalidateQueries({ queryKey: ['media-library'] })]);
      window.setTimeout(() => setUploads(list => list.filter(x => x.id !== u.id)), 1500);
      return true;
    } catch (e) { patch(u.id, { status: 'failed', error: actionError(e, 'The upload failed.') }); return false; }
  }
  async function add(files: File[], meta: UploadMeta = {}) {
    for (const f of files) {
      const id = crypto.randomUUID(); const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      const start: UploadState = { id, name: f.name, label: meta.name ?? baseName(f.name), size: f.size, status: 'preparing', progress: 0, preview, derivedFrom: meta.derivedFrom ?? null, atSeconds: meta.atSeconds ?? null };
      const abort = new AbortController(); setUploads(list => [...list, { ...start, abort }]);
      const r = await prepareFile(f, { onProgress: (fraction, done, total) => patch(id, { progress: fraction, note: `Compressing ${clock(done)} of ${clock(total)} · keep this tab open` }), signal: abort.signal });
      if (!r.ok) { patch(id, { status: 'failed', error: r.error }); continue; }
      const u: UploadState = { ...start, name: r.file.name, size: r.file.size, status: 'queued', file: r.file }; patch(id, { name: u.name, size: u.size, status: 'queued', file: u.file, note: f.size > r.file.size * 1.5 ? `Compressed from ${formatBytes(f.size)}` : undefined, progress: 0 });
      if (bugId) void send(u, bugId);
    }
  }
  /** Uploads everything staged, one after another; returns how many failed. */
  async function start(target: string) { let failed = 0; for (const u of latest.current) if (u.status === 'queued' || u.status === 'failed') { if (!(await send(u, target))) failed++; } return failed; }
  const retry = (id: string) => { const u = latest.current.find(x => x.id === id); if (u && bugId) void send(u, bugId); else if (u) patch(id, { status: 'queued', error: undefined }); };
  const remove = (id: string) => { const u = latest.current.find(x => x.id === id); u?.abort?.abort(); if (u?.preview) URL.revokeObjectURL(u.preview); setUploads(list => list.filter(x => x.id !== id)); };
  const setLabel = (id: string, value: string) => patch(id, { label: value.slice(0, MEDIA_NAME_MAX) });
  const busy = uploads.some(u => u.status === 'preparing' || u.status === 'uploading' || u.status === 'verifying');
  const staged = uploads.filter(u => u.status === 'queued' || u.status === 'failed').length;
  return { uploads, add, start, retry, remove, setLabel, busy, staged };
}

/** Drop zone + picker + the queue of files in flight, each with an editable name. Purely presentational; the hook above does the work. */
export function MediaDropZone({ accept, remaining, disabledReason, onFiles, uploads, onRetry, onRemove, onLabel, hint }: { accept: string[]; remaining: number; disabledReason?: string | undefined; onFiles: (files: File[]) => void; uploads: UploadState[]; onRetry: (id: string) => void; onRemove: (id: string) => void; onLabel?: ((id: string, value: string) => void) | undefined; hint?: string | undefined }) {
  const input = useRef<HTMLInputElement>(null); const [active, setActive] = useState(false);
  const disabled = !!disabledReason || remaining <= 0;
  const take = (list: FileList | null) => { if (!list) return; const files = [...list]; if (disabledReason) { toast.error(disabledReason); return; } if (files.length > remaining) toast.error(`Only ${remaining} more ${remaining === 1 ? 'file' : 'files'} can be attached to this bug.`); onFiles(files.slice(0, Math.max(0, remaining))); };
  const editable = (u: UploadState) => !!onLabel && (u.status === 'preparing' || u.status === 'queued' || u.status === 'failed');
  return <div className="grid gap-3">
    <div className="bf-upload" role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} data-active={active} onClick={() => !disabled && input.current?.click()} onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={e => { e.preventDefault(); if (!disabled) setActive(true); }} onDragLeave={() => setActive(false)} onDrop={e => { e.preventDefault(); setActive(false); take(e.dataTransfer.files); }}>
      <input ref={input} type="file" multiple accept={accept.join(',')} className="sr-only" tabIndex={-1} onChange={e => { take(e.target.files); e.target.value = ''; }} />
      <Upload size={24} />
      <strong className="text-xs">{disabledReason ? 'Media uploads unavailable' : remaining <= 0 ? 'This bug has all 10 files' : 'Drop screenshots, recordings or PDFs here — several at once is fine'}</strong>
      <span className="text-xs text-muted-foreground">{disabledReason ?? (remaining <= 0 ? 'Remove one to add another' : hint ?? `PNG, JPEG, WebP, GIF, MP4, WebM or PDF · images are shrunk and recordings over 100 MB are compressed in your browser · ${remaining} more`)}</span>
      {!disabledReason && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={e => { e.stopPropagation(); input.current?.click(); }}><Paperclip />Choose files</Button>}
    </div>
    {uploads.length > 0 && <ul className="bf-upload-queue" aria-live="polite">{uploads.map(u => <li key={u.id} className="bf-upload-row" data-status={u.status}>
      {u.preview ? <img src={u.preview} alt="" /> : <span className="bf-upload-ph">{u.name.toLowerCase().endsWith('.pdf') ? <FileText size={18} /> : <Film size={18} />}</span>}
      <span className="min-w-0">
        {editable(u) ? <input className="bf-upload-name" value={u.label} maxLength={MEDIA_NAME_MAX} placeholder="Name this file" aria-label={`Name for ${u.name}`} onChange={e => onLabel!(u.id, e.target.value)} /> : <strong title={u.name}>{u.label.trim() || u.name}</strong>}
        <small>{formatBytes(u.size)} · {u.status === 'queued' && u.note ? `${u.note} · ` : ''}{label(u)}</small>{(u.status === 'uploading' || u.status === 'verifying' || (u.status === 'preparing' && u.progress > 0)) && <Progress value={u.progress * 100} className="mt-1 h-1.5" />}
      </span>
      <span className="flex items-center gap-1">{u.status === 'failed' && u.file && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onRetry(u.id)}><RefreshCw />Retry</Button>}{u.status === 'preparing' && u.progress > 0 ? <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onRemove(u.id)}><X />Cancel</Button> : (u.status === 'preparing' || u.status === 'uploading' || u.status === 'verifying') ? <LoaderCircle className="animate-spin text-muted-foreground" size={16} /> : u.status === 'done' ? <Check className="text-success" size={16} /> : <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${u.name} from the queue`} onClick={() => onRemove(u.id)}><X size={14} /></Button>}</span>
    </li>)}</ul>}
  </div>;
}

/** Where a file came from: a marked-up copy of another, or a frame taken from a recording. */
export function Lineage({ item, items }: { item: MediaItem; items: MediaItem[] }) {
  if (!item.derivedFrom) return null;
  const from = items.find(m => m.id === item.derivedFrom);
  return <small className="bf-media-lineage">{item.atSeconds != null ? `Frame at ${clock(item.atSeconds)}` : 'Marked up'}{from ? ` · from ${from.name}` : ''}</small>;
}

/** A thumbnail for one file. */
export function MediaThumb({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  return <button type="button" className="bf-media-thumb" data-kind={item.kind} onClick={onOpen} aria-label={`Open ${item.name}`} disabled={!item.url}>
    {item.kind === 'image' && item.url ? <img src={item.url} alt={item.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : item.kind === 'video' && item.url ? <><video src={item.url} preload="metadata" muted playsInline /><span className="bf-media-play"><Play size={18} /></span></> : item.kind === 'pdf' ? <FileText size={30} /> : item.kind === 'video' ? <Film size={30} /> : <ImageIcon size={30} />}
    <span className="bf-media-kind">{item.kind}</span>
  </button>;
}

/**
 * Full-size viewer with previous/next (buttons and arrow keys), inline PDF, copy link, and whatever extra actions the caller adds.
 * The video element is CORS-enabled so a frame can be captured for marking up.
 */
export function MediaLightbox({ items, index, onIndex, onClose, actions, videoRef }: { items: MediaItem[]; index: number | null; onIndex: (i: number) => void; onClose: () => void; actions?: ((m: MediaItem) => ReactNode) | undefined; videoRef?: React.RefObject<HTMLVideoElement | null> | undefined }) {
  const m = index === null ? null : items[index] ?? null;
  const go = (d: number) => { if (index === null || items.length < 2) return; onIndex((index + d + items.length) % items.length); };
  return <Dialog open={m !== null} onOpenChange={o => { if (!o) onClose(); }}><DialogContent className="bf-lightbox max-w-5xl" onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } }}>
    <DialogHeader><DialogTitle className="truncate">{m?.name}</DialogTitle><DialogDescription>{m ? `${formatBytes(m.size)} · attached by ${m.uploadedBy} · ${timeAgo(m.createdAt)}${items.length > 1 ? ` · ${(index ?? 0) + 1} of ${items.length}` : ''}` : ''}</DialogDescription></DialogHeader>
    {m && <div className="bf-lightbox-stage">
      {m.kind === 'image' && m.url && <img src={m.url} alt={m.name} referrerPolicy="no-referrer" />}
      {m.kind === 'video' && m.url && <video key={m.id} ref={videoRef} src={m.url} controls autoPlay playsInline crossOrigin="anonymous" />}
      {m.kind === 'pdf' && m.url && <iframe key={m.id} src={m.url} title={m.name} />}
      {!m.url && <p className="p-8 text-center text-sm text-muted-foreground">This file cannot be shown because media storage is not connected right now.</p>}
      {items.length > 1 && <><button type="button" className="bf-lightbox-nav" data-dir="prev" aria-label="Previous file" onClick={() => go(-1)}><ChevronLeft size={22} /></button><button type="button" className="bf-lightbox-nav" data-dir="next" aria-label="Next file" onClick={() => go(1)}><ChevronRight size={22} /></button></>}
    </div>}
    {m && <div className="bf-lightbox-bar">
      {m.url && <Button asChild variant="outline" size="sm"><a href={m.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink />Open in a new tab</a></Button>}
      <Button type="button" variant="outline" size="sm" onClick={() => void copyMediaLink(m.bugId, m.id)}><Link2 />Copy link</Button>
      {actions?.(m)}
      <Lineage item={m} items={items} />
    </div>}
  </DialogContent></Dialog>;
}

/** The "Attachments" card on a bug: gallery with lightbox, rename, mark-up, Open and Remove, plus the drop zone for people who may attach files. */
export function BugMedia({ access, bug, actor, items, config, readOnly = false, openMediaId }: { access: BugAccess; bug: LiveBug; actor: BugActor; items: MediaItem[]; config: MediaConfig; readOnly?: boolean; openMediaId?: string | undefined }) {
  const client = useQueryClient(); const remove = useServerFn(deleteMedia); const rename = useServerFn(renameMedia); const clearAll = useServerFn(clearBugMedia);
  const [open, setOpen] = useState<number | null>(null); const [removing, setRemoving] = useState<MediaItem | null>(null); const [clearing, setClearing] = useState(false); const removingRect = useRef<DOMRect | null>(null); const section = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null); const [savingName, setSavingName] = useState(false);
  const [markup, setMarkup] = useState<{ source: AnnotationSource; name: string; caption: string; derivedFrom: string; atSeconds: number | null } | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const uploader = useMediaUpload(access, bug.id);
  // A link to one file opens it as soon as it is in the list (once).
  const opened = useRef<string | null>(null);
  useEffect(() => { if (!openMediaId || opened.current === openMediaId) return; const i = items.findIndex(m => m.id === openMediaId); if (i >= 0) { opened.current = openMediaId; setOpen(i); } }, [openMediaId, items]);
  const canSee = actor.permissions.includes('evidence'); const canUpload = !readOnly && mayUploadMedia(actor, bug);
  if (!canSee && !canUpload) return null;
  if (readOnly && items.length === 0) return null;
  const disabledReason = !config.enabled ? 'Media uploads are off until your Admin connects storage in Settings → Media storage. Add a Drive link instead.' : undefined;
  if (!canUpload && items.length === 0) return null;
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['bug-detail'] }), client.invalidateQueries({ queryKey: ['bug-workspace'] }), client.invalidateQueries({ queryKey: ['media-library'] })]);
  async function saveName() {
    if (!editing) return; const value = editing.value.trim(); const current = items.find(m => m.id === editing.id);
    if (!value || !current || value === current.name) { setEditing(null); return; }
    setSavingName(true);
    try { await rename({ data: { access, media: { id: editing.id, name: value } } }); await refresh(); setEditing(null); toast.success('File renamed'); }
    catch (e) { toast.error(actionError(e, 'The file could not be renamed.')); }
    finally { setSavingName(false); }
  }
  async function markImage(m: MediaItem) {
    if (!m.url) return;
    try { const img = await loadImage(m.url); setMarkup({ source: { image: img, width: img.naturalWidth, height: img.naturalHeight }, name: `${m.name} (marked up)`, caption: m.name, derivedFrom: m.id, atSeconds: null }); }
    catch (e) { toast.error(actionError(e, 'The image could not be loaded for drawing.')); }
  }
  function markFrame(m: MediaItem) {
    const v = video.current; if (!v) return; v.pause();
    try { const source = captureFrame(v); const at = v.currentTime; setMarkup({ source, name: `${m.name} at ${clock(at)}`, caption: `${m.name} at ${clock(at)}`, derivedFrom: m.id, atSeconds: Math.round(at * 100) / 100 }); }
    catch (e) { toast.error(actionError(e, 'The frame could not be captured.')); }
  }
  const remaining = config.maxFiles - items.length - uploader.uploads.filter(u => u.status !== 'failed').length;
  return <section ref={section} className="bf-rc-card" data-tone="info"><h3 className="bf-section-title"><span className="bf-rc-icon"><Paperclip size={15} /></span>Attachments{items.length > 0 && <span className="bf-tag ml-1">{items.length} of {config.maxFiles}</span>}
    {items.length > 0 && <span className="ml-auto flex gap-1"><Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void copyMediaLink(bug.id)}><Link2 />Copy link to all files</Button>{!readOnly && actor.role === 'admin' && isClosedForMedia(bug.status) && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => setClearing(true)}><Trash2 />Remove all {items.length} files</Button>}</span>}</h3>
    {!readOnly && actor.role === 'admin' && isClosedForMedia(bug.status) && items.length > 0 && <p className="text-xs text-muted-foreground">This bug is closed. Its files take {formatBytes(items.reduce((n, m) => n + m.size, 0))} of storage; remove them here, or set a clean-up schedule in Settings → Media storage.</p>}
    {items.length > 0 && <div className="bf-media-grid">{items.map((m, i) => <figure key={m.id} className="bf-media-tile" data-derived={m.derivedFrom ? '' : undefined}>
      <MediaThumb item={m} onOpen={() => setOpen(i)} />
      <figcaption className="bf-media-cap">
        {editing?.id === m.id ? <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); void saveName(); }}><input className="bf-upload-name" autoFocus value={editing.value} maxLength={MEDIA_NAME_MAX} aria-label="New name" onChange={e => setEditing({ id: m.id, value: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }} /><Button type="submit" size="icon" variant="ghost" className="h-6 w-6" disabled={savingName} aria-label="Save name">{savingName ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />}</Button></form>
          : <strong title={m.name}>{m.name}</strong>}
        <small>{formatBytes(m.size)} · {m.uploadedBy} · {timeAgo(m.createdAt)}</small><Lineage item={m} items={items} />
      </figcaption>
      <span className="bf-media-actions">
        {!readOnly && mayDeleteMedia(actor, m) && editing?.id !== m.id && <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing({ id: m.id, value: m.name })}><Pencil />Rename</Button>}
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" aria-label={`Copy link to ${m.name}`} onClick={() => void copyMediaLink(bug.id, m.id)}><Link2 />Link</Button>
        {!readOnly && mayDeleteMedia(actor, m) && <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs text-destructive" onClick={e => { removingRect.current = (e.currentTarget.closest('figure') as HTMLElement | null)?.getBoundingClientRect() ?? null; setRemoving(m); }}><Trash2 />Remove</Button>}
      </span>
    </figure>)}</div>}
    {canUpload && <MediaDropZone accept={config.accept} remaining={remaining} disabledReason={disabledReason} onFiles={f => void uploader.add(f)} uploads={uploader.uploads} onRetry={uploader.retry} onRemove={uploader.remove} onLabel={uploader.setLabel} />}
    {items.some(m => !m.url) && <p className="text-xs text-muted-foreground">Some files cannot be shown because media storage is not connected right now.</p>}
    <MediaLightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} videoRef={video}
      actions={m => canUpload && remaining > 0 ? (m.kind === 'image' ? <Button type="button" variant="outline" size="sm" onClick={() => void markImage(m)}><PenLine />Mark up</Button> : m.kind === 'video' ? <Button type="button" variant="outline" size="sm" onClick={() => markFrame(m)}><Camera />Mark up this frame</Button> : null) : null} />
    {markup && <AnnotationEditor source={markup.source} defaultName={markup.name} caption={markup.caption}
      onSave={async (file, name) => { await uploader.add([file], { name, derivedFrom: markup.derivedFrom, atSeconds: markup.atSeconds }); setMarkup(null); setOpen(null); toast.success('Marked-up copy is being attached'); }}
      onClose={() => setMarkup(null)} />}
    <ConfirmAction open={clearing} onOpenChange={setClearing} destructive title={`Remove all ${items.length} files from ${bug.code}?`} description="Every screenshot, recording and PDF on this bug is removed for everyone and deleted from storage. One audit entry records it with your name, date and time." confirmLabel="Remove all files" onConfirm={async () => { const source = section.current?.getBoundingClientRect() ?? null; const n = items.length; await clearAll({ data: { access, media: { bugId: bug.id } } }); await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['trash'] })]); moveToTrashToast({ title: 'Files removed', label: `${n} ${n === 1 ? 'file' : 'files'} from ${bug.code}`, detail: 'Deleted from storage; listed in Trash for the record.', source, trashLink: access.kind === 'admin' }); setClearing(false); }} />
    <ConfirmAction open={removing !== null} onOpenChange={o => { if (!o) setRemoving(null); }} destructive title={`Remove ${removing?.name ?? 'this file'}?`} description="The file is removed from this bug for everyone and deleted from private storage. The removal is recorded with your name, date and time." confirmLabel="Remove file"
      onConfirm={async () => { if (!removing) return; const source = removingRect.current; await remove({ data: { access, media: { id: removing.id } } }); await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['trash'] })]); moveToTrashToast({ title: 'File removed', label: removing.name, detail: 'Deleted from storage; listed in Trash for the record.', source, trashLink: access.kind === 'admin' }); setRemoving(null); }} />
  </section>;
}
