import { Link } from '@tanstack/react-router';
import { Bug, UsersRound, ClipboardCheck, Settings2, Code2, MessageSquare, Link2, Flag, ListChecks, Paperclip, PenLine, Play, Images, HardDrive, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** One help text, written once, for the Admin workspace and for every member portal. */
type Topic = { icon: LucideIcon; title: string; text: string };

const ADMIN: Topic[] = [
  { icon: Bug, title: 'Report → validate → fix → verify', text: 'New reports are validated by QA, assigned to a developer, fixed, and only resolved after a successful QA retest. Statuses move from the chips on each bug row.' },
  { icon: UsersRound, title: 'Private portal links', text: 'Members work through private links instead of passwords — open, copy or replace a link in Team & access. Replacing a link immediately revokes the old one.' },
  { icon: ClipboardCheck, title: 'Permissions & scope', text: 'Each member sees only their projects and, unless granted more, only bugs they reported or were assigned. Permissions are edited in their profile.' },
  { icon: Settings2, title: 'Workspace options', text: 'Severities, modules, environments, devices and themes live in Settings. Severity order controls the colour scale everywhere.' },
];
const DEVELOPER: Topic[] = [
  { icon: Code2, title: 'Your workflow', text: 'When you start on an assigned bug, set it to In progress. When it is fixed, send it to Ready for QA retest with a short fix note. QA then resolves it, or reopens it with a reason if the fix did not hold.' },
  { icon: MessageSquare, title: 'Need more details?', text: 'Set Needs information and say what is missing — the reporter is asked and the bug comes back to you when they answer.' },
  { icon: Flag, title: 'Closing without a fix', text: 'Not a bug, Duplicate and Won’t fix need the disposition permission and a reason. QA can reopen any of them for review.' },
  { icon: ListChecks, title: 'Comments', text: 'Post an update on any bug you can see. Ctrl/⌘ + Enter posts; you can address a note to the reporter, QA or someone else.' },
];
const QA: Topic[] = [
  { icon: ClipboardCheck, title: 'Validate new reports', text: 'Move New reports to Validating while you reproduce them, then Validated and Ready for assignment — or assign a developer straight away if you have the permission.' },
  { icon: Bug, title: 'Retest fixes', text: 'Bugs marked Ready for QA retest are waiting for you. Pass marks the bug Resolved; Fail reopens it with your note. You cannot pass your own fix.' },
  { icon: Flag, title: 'Reject clearly', text: 'Close duplicates, non-bugs and won’t-fix items with a reason, so the reporter learns what to change next time.' },
  { icon: Link2, title: 'Evidence', text: 'Attach screenshots, recordings or PDFs directly on a bug (Attachments), or share Google Drive links. Files are private: only people who can see the bug can open them.' },
];
const REPORTER: Topic[] = [
  { icon: Bug, title: 'Report a bug that gets fixed', text: 'Describe what happened and list the exact steps first — the title is filled in from your description if you leave it empty. One bug per report.' },
  { icon: ListChecks, title: 'Follow progress', text: 'Each bug shows its status: New → Validating → Assigned → In progress → Ready for QA retest → Resolved. Reopened means the fix failed and went back to the developer.' },
  { icon: MessageSquare, title: 'When someone needs more', text: 'Needs information means a question is waiting for you — open the bug, read the note and reply with a comment or by editing your report.' },
  { icon: Link2, title: 'Evidence', text: 'Drop screenshots, recordings or PDFs on a bug — images are compressed automatically — or add Google Drive links. Uploads need media storage connected in Settings.' },
];
const BY_ROLE: Record<string, Topic[]> = { developer: DEVELOPER, qa: QA, tester: REPORTER, other: REPORTER };

/** One line for the portal hero: what this person is here to do. */
export function roleGuide(role: string) {
  switch (role) {
    case 'developer': return 'Fix what is assigned to you, send it to QA for a retest, and answer questions on your bugs.';
    case 'qa': return 'Validate new reports, assign them, and pass or fail fixes on retest.';
    default: return 'Report bugs with clear steps, follow their progress, and answer when QA needs more detail.';
  }
}

export function HelpContent({ audience = 'admin', role = 'other', onNavigate }: { audience?: 'admin' | 'portal'; role?: string; onNavigate?: () => void }) {
  const topics = audience === 'admin' ? ADMIN : (BY_ROLE[role] ?? REPORTER);
  return <div className="grid gap-3">
    {topics.map(t => <div key={t.title} className="bf-help-topic"><span className="bf-stat-icon bf-tone-teal shrink-0"><t.icon size={16} /></span><div><h3>{t.title}</h3><p>{t.text}</p></div></div>)}
    <MediaGuide audience={audience} />
    {audience === 'admin'
      ? <Button asChild onClick={onNavigate}><Link to="/admin/settings"><Settings2 />Open Settings</Link></Button>
      : <p className="text-xs leading-6 text-muted-foreground">Missing a permission or a project? Ask your workspace Admin — they can change your access from your profile in Team & access.</p>}
  </div>;
}

/** How attachments work, for whoever is reading: Admin gets the connection steps, members get the day-to-day steps, both get a picture of the Attachments card. */
function MediaGuide({ audience }: { audience: 'admin' | 'portal' }) {
  return <section className="bf-help-media">
    <div className="bf-help-topic"><span className="bf-stat-icon bf-tone-teal shrink-0"><Paperclip size={16} /></span><div>
      <h3>Attachments &amp; media</h3>
      {audience === 'admin' ? <ol>
        <li><strong>Get a bucket</strong> (5 minutes, free): Cloudflare R2 → Create bucket (private) → Manage R2 API Tokens → Object Read &amp; Write for that bucket. Copy the endpoint, Access Key ID and Secret.</li>
        <li><strong>Paste them</strong> into Settings → Media storage → <em>Workspace bucket</em> (provider, endpoint, bucket, key, secret) and press <em>Save &amp; test</em>. That bucket is the default for every portal. The secret is stored encrypted and never shown again.</li>
        <li><strong>Add the CORS rule</strong> shown in the setup guide to the bucket, so browsers can upload and read.</li>
        <li><strong>Clean-up</strong>: on the same card choose when files on resolved bugs are removed (never / 7 / 30 / 90 days), or remove them now. On any closed bug you can also press <em>Remove all files</em>.</li>
      </ol> : <ol>
        <li><strong>Drop files on a bug</strong>: open the bug, drag screenshots, recordings or PDFs onto <em>Attachments</em> (several at once is fine). Images are shrunk and recordings over 100 MB are compressed in your browser first; keep the tab open while that runs.</li>
        <li><strong>Name it</strong> in the queue before it goes up, or press <em>Rename</em> on the tile later.</li>
        <li><strong>Share it</strong>: <em>Link</em> copies a link to one file, <em>Copy link to all files</em> to the whole bug. Links open for anyone who can see that bug and nobody else.</li>
        <li><strong>Mark it up</strong>: open a screenshot and press <em>Mark up</em> for boxes, arrows, pencil and text. On a recording, pause on the moment and press <em>Mark up this frame</em>. A new file is attached; the original stays.</li>
        <li><strong>Find everything</strong> you attached under <em>My media</em>, grouped by bug.</li>
      </ol>}
    </div></div>
    <figure className="bf-help-preview" aria-label="What the Attachments card looks like">
      <figcaption><Paperclip size={13} />Attachments <span className="bf-tag">3 of 10</span><span className="ml-auto flex gap-2 text-[11px]"><span><Link2 size={11} /> Copy link to all files</span></span></figcaption>
      <div className="bf-help-tiles">
        <div className="bf-help-tile"><div className="bf-help-thumb" data-kind="image"><span>image</span></div><strong>Login button misaligned</strong><small>412 KB · Priya · 2h ago</small><em><PenLine size={10} /> Mark up</em></div>
        <div className="bf-help-tile" data-derived=""><div className="bf-help-thumb" data-kind="image"><span>image</span><i className="bf-help-box" /><i className="bf-help-arrow" /></div><strong>Login button misaligned (marked up)</strong><small>Marked up · from Login button…</small><em><Link2 size={10} /> Link</em></div>
        <div className="bf-help-tile"><div className="bf-help-thumb" data-kind="video"><Play size={16} /><span>video</span></div><strong>Checkout crash at 0:42</strong><small>38 MB · compressed from 410 MB</small><em><Play size={10} /> Mark up this frame</em></div>
      </div>
      <div className="bf-help-drop"><HardDrive size={14} />Drop screenshots, recordings or PDFs here — several at once is fine</div>
      <p><Images size={12} /> Members see all their files under <strong>My media</strong>; Admin sees everyone's. {audience === 'admin' ? 'Until a bucket is connected, this card says "Media uploads unavailable" and Drive links keep working.' : 'Every view uses a private 10-minute link; nothing is public.'}</p>
    </figure>
  </section>;
}
