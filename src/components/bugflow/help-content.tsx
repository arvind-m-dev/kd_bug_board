import { Link } from '@tanstack/react-router';
import { Bug, UsersRound, ClipboardCheck, Settings2, Code2, MessageSquare, Link2, Flag, ListChecks, type LucideIcon } from 'lucide-react';
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
  { icon: Link2, title: 'Evidence', text: 'Screenshots and recordings are shared as Google Drive or Docs links; open them from the Evidence links section of a report.' },
];
const REPORTER: Topic[] = [
  { icon: Bug, title: 'Report a bug that gets fixed', text: 'Describe what happened and list the exact steps first — the title is filled in from your description if you leave it empty. One bug per report.' },
  { icon: ListChecks, title: 'Follow progress', text: 'Each bug shows its status: New → Validating → Assigned → In progress → Ready for QA retest → Resolved. Reopened means the fix failed and went back to the developer.' },
  { icon: MessageSquare, title: 'When someone needs more', text: 'Needs information means a question is waiting for you — open the bug, read the note and reply with a comment or by editing your report.' },
  { icon: Link2, title: 'Evidence', text: 'Attach screenshots or recordings as Google Drive or Docs links in the Evidence field. Direct uploads are not available yet.' },
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
    {audience === 'admin'
      ? <Button asChild onClick={onNavigate}><Link to="/admin/settings"><Settings2 />Open Settings</Link></Button>
      : <p className="text-xs leading-6 text-muted-foreground">Missing a permission or a project? Ask your workspace Admin — they can change your access from your profile in Team & access.</p>}
  </div>;
}
