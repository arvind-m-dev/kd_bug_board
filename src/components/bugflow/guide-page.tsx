import { Link } from "@tanstack/react-router";
import {
  Bug,
  ClipboardCheck,
  Wrench,
  ShieldCheck,
  UsersRound,
  CalendarRange,
  Kanban,
  Bot,
  Paperclip,
  ArrowLeft,
} from "lucide-react";

/**
 * The step-by-step user guide (/guide). Static content only — no data, no session — so anyone on the team can read
 * it, signed in or not. Each section mirrors the real UI labels; when those change, this page must change with them.
 */
export function GuidePage() {
  return (
    <main className="bf-guide">
      <header className="bf-guide-hero">
        <h1>
          <Bug size={22} /> Bug Board — user guide
        </h1>
        <p>
          One shared place to report bugs, get them fixed and prove the fix. Everyone works through
          their own private link — no passwords for members, no setup.
        </p>
        <Link to="/login" className="bf-guide-back">
          <ArrowLeft size={14} /> To sign-in
        </Link>
      </header>

      <Section icon={Bug} title="Raise a bug (everyone with Report permission)">
        <ol>
          <li>
            Open your portal link and press <b>Raise a bug</b>.
          </li>
          <li>
            Describe what went wrong. A title is optional — the first line stands in if you skip it.
          </li>
          <li>Add the steps to replicate, one per line. These are what QA follows.</li>
          <li>
            Pick the project (and module), the priority and severity you believe are right — Admin
            can adjust them later.
          </li>
          <li>
            Attach screenshots or recordings, or paste Google Drive links. Files upload in the
            background; you can raise the next bug while they finish (watch the tray, bottom left).
          </li>
          <li>Save. You get a BUG-code you can share and paste into chats or sheets.</li>
        </ol>
      </Section>

      <Section icon={ClipboardCheck} title="Validate and assign (QA)">
        <ol>
          <li>
            New reports appear under <b>To validate</b> on your portal and in NEW on the board.
          </li>
          <li>
            Reproduce the bug with the written steps. If something is missing, send it to{" "}
            <b>Needs information</b> with a note.
          </li>
          <li>
            Move a confirmed bug through <b>Validating → Validated → Ready for assignment</b> (one
            action can jump the triage steps).
          </li>
          <li>
            Assign one or more developers with a task — fix, re-validate, retest or add media.
            People without access to the project can be granted it in the same dialog (Admin).
          </li>
          <li>
            Not a bug, a duplicate or won’t fix? Close it with that status and a short reason — the
            reason stays on the bug.
          </li>
        </ol>
      </Section>

      <Section icon={Wrench} title="Fix and hand to retest (developers)">
        <ol>
          <li>
            Your portal’s <b>Assigned to me</b> card lists everything you own.
          </li>
          <li>
            Start work: move the bug to <b>In progress</b> (drag it on the board, or use the status
            control).
          </li>
          <li>
            Done? Move it to <b>Retest</b> and write what you changed in the fix note.
          </li>
          <li>Questions about the report? Comment on the bug — the reporter is notified.</li>
          <li>You cannot resolve your own bug: only QA’s retest verdict does that.</li>
        </ol>
      </Section>

      <Section icon={ShieldCheck} title="Verify (QA)">
        <ol>
          <li>
            Bugs in <b>Retest</b> wait for your verdict. The fixer can never verify their own fix.
          </li>
          <li>
            Pass → the bug becomes <b>Resolved</b>. Fail → it is <b>Reopened</b> and goes back to
            the developer, with your notes.
          </li>
          <li>A reporter can reopen their own resolved bug if it comes back.</li>
        </ol>
      </Section>

      <Section icon={CalendarRange} title="Due dates & sprints (Admin and planners)">
        <ol>
          <li>
            Planners (Admin, and members with the <b>Plan work</b> permission) set a due date on a
            bug when reporting or editing it.
          </li>
          <li>
            Overdue bugs get a red badge, an <b>Overdue</b> card on Overview, and a red day on the
            All bugs <b>Calendar</b>.
          </li>
          <li>“Today” follows the workspace time zone — Settings → Options.</li>
          <li>
            <b>Sprints</b>: create one per project, add bugs by number, then <b>Start</b> it. Bugs
            added after the start count as added scope.
          </li>
          <li>
            On <b>Close</b>, still-open bugs can carry into the next sprint — they arrive marked
            “carried”, so scope history stays honest.
          </li>
        </ol>
      </Section>

      <Section icon={Kanban} title="The board">
        <ol>
          <li>
            <b>Board</b> shows every bug in one of five columns: To do, Assigned, In progress,
            Retest, Done.
          </li>
          <li>
            Drag a card to move it — only moves the workflow allows will drop; impossible columns
            dim.
          </li>
          <li>
            Assigning and retest verdicts need their dialogs, so those drops open the bug instead.
          </li>
          <li>
            Prefer the keyboard? Every card has a <b>Move to…</b> menu with the same moves.
          </li>
        </ol>
      </Section>

      <Section icon={UsersRound} title="Manage the team (Admin)">
        <ol>
          <li>
            <b>Team &amp; access</b>: add a member, pick their role and projects, and copy their
            private portal link.
          </li>
          <li>
            A link can be replaced or revoked at any time; expired or revoked links stop working
            everywhere, immediately.
          </li>
          <li>
            Deleting a member keeps their name on old bugs; their portals are revoked and they sit
            in Trash for 30 days.
          </li>
          <li>
            Dropdown choices (severities, modules, environments, devices) live in Settings →
            Options.
          </li>
        </ol>
      </Section>

      <Section icon={Paperclip} title="Files, screenshots & recordings">
        <ol>
          <li>
            Attach images, recordings or PDFs to any bug you may add evidence to; big recordings are
            compressed in your browser first.
          </li>
          <li>
            Mark up your own uploads — draw on images, or add timed marks to a recording that
            everyone sees during playback.
          </li>
          <li>
            Removing a file moves it to Trash for 30 days; the uploader or Admin can restore it.
          </li>
        </ol>
      </Section>

      <Section icon={Bot} title="AI access (optional)">
        <ol>
          <li>
            Admin (Settings → AI access) or a member (their portal) can create an AI token scoped to
            that panel.
          </li>
          <li>
            Claude, Cursor or ChatGPT can then list, read and report bugs — and check the current
            sprint — with exactly that panel’s permissions, never more.
          </li>
          <li>
            Every token and OAuth connection is listed and revocable in the same place it was made.
          </li>
        </ol>
      </Section>

      <footer className="bf-guide-foot">
        Lost? Your Admin can replace your portal link in a minute. ·{" "}
        <Link to="/login">Sign in</Link>
      </footer>
    </main>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bug;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bf-guide-section">
      <h2>
        <span className="bf-stat-icon bf-tone-teal">
          <Icon size={16} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
