# Jira ↔ Bug Board sync: source of truth, plan, and test matrix

Status 2026-11-13: two-way sync runs live against the trial site (the personal trial site, space `SCRUM`).
This file is the working plan for finishing it. Owner direction: people mostly come from Jira; the Admin is
never a named person; everything must be easy to see and trace.

## 1. Source of truth

| Data | Source of truth | Other side | Why |
|---|---|---|---|
| **Who exists (people, names, accounts)** | **Jira** | Bug Board links each member to one Jira account id | Owner: people are created in Jira; Jira sends its own notifications |
| **Role, permissions, portal link** | **Bug Board** | Not in Jira (Jira has no QA/Dev roles) | Bug Board's workflow and access rules depend on it |
| **Admin** | Bug Board | Shown in Jira as "Bug Board Admin", never a person | Owner: "admin is admin only" |
| **Which bug is which** | The link (Jira issue **id**, not key) | — | Keys change when issues move |
| **Bug text** (title, description, steps, expected, actual) | **Both** (last-common-snapshot, three-way) | — | Same field changed differently on both sides → a decision, never an overwrite |
| **Priority, severity, due date** | **Both** (switchable per project) | — | Same rule |
| **Status** | **Bug Board's workflow** | Jira moves are applied only along Bug Board's 13-status graph | Jira "Done" never resolves without QA |
| **Assignee** | **Both**, linked people only | Unlinked Jira assignee → decision | No guessing who someone is |
| **Reporter** | **Bug Board** → Jira only | Jira-made bugs keep the Jira author's name | Who reported never changes |
| **Sprints (containers)** | **Jira** | Bug Board mirrors | PRD |
| **History / audit log** | **Bug Board activity log** | Jira history shows the main account | Every change: who, when, from which side |

## 2. Done and verified live

Connect / sign in again / token refresh (incl. concurrent) · create both ways exactly once · title, priority, due date,
status (QA-protected), assignee, reporter · first sync of existing bugs (45 → 47 issues, rerun safe) · replay without
duplicates · people: link, Add from Jira, Jira tag, auto-link by email, People report (same names, extra links,
likely pairs) · "Raised in" + Admin naming on every issue · purged/trashed member re-add · 462 unit tests.

## 3. Built 2026-11-13 (unit-tested; live-checked on the trial)

1. **Sync log** (Settings → Jira → Sync log): every move with direction (→ Jira / ← Jira), who caused it (member
   name, "Bug Board Admin", or "Jira"), bug + issue, filters (To Jira, From Jira, Decisions, Setup & people,
   Errors), search, and "Retry stopped work". Errors say whether they retry by themselves.
2. **Use Jira name**: People report flags a linked member whose name differs from their Jira name; one click
   renames (read live from Jira, audited as `member.updated` with `source: jira`, shown in the Sync log).
3. **Name labels** (project option, off by default): `reported-by-<name>` / `assigned-to-<name>` on Jira
   issues for people with no linked Jira account; never for the Admin or Jira-made bugs; other labels untouched;
   labels removed once the person is linked. Toggling queues every linked issue so existing ones update.
4. **Same bug twice?** panel: unlinked Bug Board bug + unlinked Jira issue with the same title → "Link these"
   (confirmed; Bug Board's details then go to Jira) or "Not the same bug"; same titles within one side listed
   once with "Not duplicates".

## 3b. Built 2026-11-13 (afternoon)

5. **Send on save**: a saved change is sent to Jira at once (about 5 s live); the scheduler stays the safety net.
   `JIRA_SEND_ON_SAVE=0` turns it off.
6. **Vercel-ready scheduler**: `/api/internal/jira/process` and `/reconcile` accept POST or GET with
   `Bearer JIRA_JOB_SECRET` or Vercel Cron's `Bearer CRON_SECRET`.
7. **Safe deletes** (two project options, off by default): Trash closes the Jira issue (Won't fix status +
   `bugboard-trashed`), restore reopens it; a Jira delete moves the bug to Bug Board's Trash, only when the
   Jira project is still readable (lost access never trashes). Jira issues are never deleted by Bug Board.

## 4. Test matrix (run each live against the trial site, record result here)

| # | Scenario | Expected | Result 2026-11-13 |
|---|---|---|---|
| T1 | Pause project → edit in both → Resume | Nothing moves while paused; all changes arrive after resume, no duplicates | PASS: paused 75 s, nothing moved; on resume everything arrived (BF-000067/SCRUM-38) |
| T2 | Disconnect → Reconnect | No record deleted on either side; links reused; no duplicate issues | to run (needs owner to sign in to Atlassian again) |
| T3 | Decision buttons (keep Bug Board / keep Jira / ignore / unlink) | Each applies through normal rules; audited | PARTIAL: "Use Bug Board's" and "Leave both" used live (8 audited decisions); "Use Jira's" and Unlink unit-tested only |
| T4 | Same field edited differently on both sides | One decision, nothing overwritten | PASS: priority P3 vs Low → one decision, neither side overwritten |
| T5 | Different fields edited on both sides | Both changes merge | PASS: Jira title + Bug Board priority merged, no decision |
| T6 | Description, steps, expected, actual, severity, environment, module edited in Jira | Applied in Bug Board | PASS: description, steps, expected, severity, module applied from Jira |
| T7 | Bug moved to Trash in Bug Board, then restored | Jira issue untouched; link resumes | PASS (option on): Trash → SCRUM-28 Done + `bugboard-trashed`; restore → In Progress, label removed, nothing pulled back |
| T8 | Jira issue deleted / moved to another project | Link marked missing; Bug Board bug kept | PASS (option on): SCRUM-52 deleted in Jira → BF-000212 to Trash as "Jira Sync — Deleted in Jira"; lost project access never trashes (unit) |
| T9 | Sprint add/remove in Jira; estimate both ways | Mirrored; one open sprint per bug | PASS Jira → Bug Board: sprint mirrored (planned), membership + 5 story points → estimate |
| T10 | Network failure / Jira 429 | Retried with backoff; nothing lost | Unit-tested (retry/backoff, Retry-After); not forced live |
| T11 | Atlassian access revoked | "Sign in again" shown; resumes after sign-in | to run (owner revokes the app in Atlassian) |
| T12 | Webhooks (needs HTTPS tunnel + `BUGFLOW_TRUST_PROXY=1`) | Jira change arrives in seconds; duplicate delivery ignored | to run on the Vercel deploy (HTTPS) |
| T13 | Member added in Jira → Add to Bug Board → assigned in Jira | Linked, assignment applied, Jira notifies | PASS earlier today: Jira people listed, Add to Bug Board linked them, Jira assignments applied |
| T14 | Member deleted, Trash emptied, re-added | Works; old history keeps old name | PASS earlier today: purged member re-added without the database error |
| T15 | `npm run test:db`, `npm test`, `npm run build`, Playwright e2e | All green | PASS: 499 unit, 59 database (local Postgres), 6 smoke e2e (Chrome), tsc, lint, build. Full e2e not run: it writes many bugs that would sync to Jira |

Also verified live: name labels on 26 SCRUM issues (e.g. SCRUM-38 `reported-by-stephen`, `assigned-to-shathish`);
Sync log and Same-bug panels render real data (found BF-000118/119 and BF-000120/121 same-title pairs).
