# Feature inventory

Status key: **Implemented** = code present with unit tests or verified per `roadmap.md`; **Partial**; **Planned**; **Deprecated**. Inventory taken 2026-10-28 from source; not every journey was manually re-run on that date.

## Admin
| Feature | Status | Routes / files |
| --- | --- | --- |
| Email/password sign-in, 8h session, throttling (10 fails / 15 min per address) | Implemented | `/login`, `portal-access.server.ts`, `sign-in-throttle.server.ts` |
| Temporary one-click sign-in ("Login without credentials" link, `BUGFLOW_DEMO_LOGIN=1`) | Implemented (temporary) | `/login`, `admin-access.tsx`, `demoUnlockAdmin` |
| Projects (add, archive, summary) | Implemented | `/admin/projects`, `portal-access.functions.ts` |
| Team & access: create/manage member portals, copy links, revoke, expiry | Implemented | `/admin/users` (`/portals` redirects here), `member-portals.tsx` |
| Member lifecycle (soft delete, restore via Trash) | Implemented | `member-management.*`, `trash.*` |
| Settings: dropdown options, appearance, media storage, AI access, system health | Implemented | `/admin/settings*` |
| Trash (bugs, members, media; 30 days) | Implemented | `/admin/trash`, `trash-view.tsx` |
| Assignments board | Implemented | `/admin/assignments` |

## Member portals
| Feature | Status | Notes |
| --- | --- | --- |
| Role-scoped bug lists ("Total bugs", "My bugs I raised") | Implemented | `personal-portal.tsx`, `bug-workspace.tsx` |
| Welcome/onboarding acknowledgement persisted per portal | Implemented | `dismissWelcome` |
| Personal appearance override | Implemented | migration 013, `savePortalAppearance` |
| Member AI tokens tab | Implemented | `createPortalAiToken` |
| My media (own files, mark-up, trash/restore) | Implemented | `media-library.tsx`, `upload-markup.tsx` |

## Bugs
| Feature | Status | Notes |
| --- | --- | --- |
| Report bug (title/actual derived from description when omitted) | Implemented | `reportSchema`, `bug-report-form.tsx` |
| 13-status lifecycle with role rules | Implemented | [BUG_WORKFLOW.md](BUG_WORKFLOW.md) |
| Multi-assignee with task labels (fix/retest…) | Implemented | migration 010, `ASSIGN_TASKS` |
| Edit report (version-checked; non-Admin cannot change priority/severity) | Implemented | `editBug`, `mayEditBug` |
| Comments, status notes, immutable history | Implemented | `bug_mutations`, `status_history`, `activity` |
| Expandable rows, inline assignment, copyable IDs | Implemented | `bug-workspace.tsx`, `row-actions.tsx` |
| Bug delete → Trash | Implemented | migration 008/015 |

## Media
| Feature | Status | Notes |
| --- | --- | --- |
| Browser → bucket presigned uploads, background queue + tray | Implemented | `media-queue.ts`, `upload-tray.tsx` |
| MP4 faststart, >~5 Mbps re-encode, JPEG thumbs | Implemented | `mp4-faststart.ts`, migration 020 |
| Image annotation (copy with lineage) | Implemented | `media-annotate.tsx`, migration 014 |
| Timed video marks (uploader only) | Implemented | `video-marks.tsx`, migration 018 |
| Media trash 30 days, restore / delete forever | Implemented | migration 019 |
| Quota, cleanup, usage, CORS test per origin | Implemented | `media-storage-settings.tsx` |
| Shareable media page | Implemented | `/media/$bugId`, `media-link.tsx` |

## Reports, notifications, activity
| Feature | Status | Notes |
| --- | --- | --- |
| Dashboard summary with status groups | Implemented | `dashboard-summary.tsx`, `STATUS_GROUPS` |
| Team/person reports, period picker | Implemented | `/admin/reports`, `person-reports.*` |
| Activity log + insights | Implemented | `/admin/activity`, `activity.*` |
| Notification bell (skips `bug.media_*`) | Implemented | `notifications.ts`, `/admin/notifications` |
| Spreadsheet export / sheet-ready copy, Markdown export | Implemented | `bug-sheet*.ts`, `export.ts` |
| Presence (online indicator) | Implemented | `/api/presence`, migration 011 |

## AI / MCP
| Feature | Status | Notes |
| --- | --- | --- |
| MCP server: whoami, list_projects, list_bugs, get_bug, report_bug, update_bug_status, comment_bug, assign_bug | Implemented | `mcp.server.ts`; no delete tool |
| OAuth 2.1 + PKCE for claude.ai / ChatGPT | Implemented | `oauth*.ts`, migration 017 |
| AI token management (hashed, revocable) | Implemented | `ai-tokens.*`, migration 016 |
| AI onboarding drafts | Implemented | `onboarding.server.ts`, needs `AI_API_KEY` |

## UI / themes
| Feature | Status | Notes |
| --- | --- | --- |
| Theme provider, light/dark, Theme Studio | Implemented | `appearance*.ts`, `theme-toggle.tsx` |
| Seasonal / 3D background worlds, scene-quality setting | Partial — code wired, tests/build pass 2026-10-28; not yet viewed in a browser | `seasonal-*.ts`, `scene-quality.ts` |
| Responsive sticky tables, scroll hints | Implemented | `scroll-hints.tsx` |

## Planned / deferred
| Feature | Status | Notes |
| --- | --- | --- |
| Google Drive connector (connect a Drive folder for media) | Planned | Settings → Media storage shows "Coming later"; Drive *links* on bugs already work. Needs a Google OAuth app |
| Public (signed-out) media share links | Planned — undecided | Currently in-app only (`/media/$bugId`, needs Admin session or portal) |
| Timestamped text comments on recordings | Planned — undecided | Timed drawn marks exist (migration 018); text comments at a time do not |
| Media end-to-end test against the real R2 bucket incl. production origin CORS | Partial — bucket verified 2026-10-28 | CORS preflight PUT/GET OK for `localhost:8080` and `kd-bug-board.vercel.app`; signed PUT/GET/delete round-trip with stored credentials OK. Full in-app upload (thumbnails, compression, mark-up) not yet clicked through in a browser |
| Published deep-link checks | Deferred | Needs publishing approval (`roadmap.md`) |
| Phase 2.1 Due dates, overdue, filter, time zone, calendar | Partial — 2.1a + calendar view shipped; bell due-reminders pending | `due_on` (021), `isOverdue`/`dueBadge`, `maySetDue`, `plan`; `DueCalendar` on All Bugs |
| Phase 2.2 Sprints (plan/start/close, carry-over) | Planned | same plan; new `plan` permission |
| Phase 2.3 Scrum board (rule-bound drag) | Planned | same plan |
| Phase 2.4 Agile backlog (epics/stories/tasks via `bugs.kind`) | Planned | same plan |
| Phase 2.5 In-app user guide | Planned | same plan |
| Phase 3 (burndown, SLA, alerts, releases, GitHub/GitLab, AI triage, phone capture, feedback widget, SSO/MFA) | Planned | same plan, Phase 3 section |
| Jira sync / import | Not planned | Decision D1, 2026-10-28 |

Source: 2026-10-22 media/theme brief (remaining items) and `roadmap.md`. New feature requests should be added here as **Planned** before implementation.
