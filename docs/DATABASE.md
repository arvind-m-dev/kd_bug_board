# Database

Neon Postgres, schema `bugflow`. Connection: `DATABASE_URL`. Apply migrations: `npm run db:migrate` (`database/migrate.ts`). SQL files are the source of truth; this doc summarizes.

## Conventions
- New change = new file `database/NNN_name.sql`, next number, idempotent (`IF NOT EXISTS`), never edit an applied file.
- Soft delete: `deleted_at` (Trash) then `purged_at` (gone from Trash; row kept so history/references stay).
- Secrets/tokens stored only as hashes (`token_hash`) or ciphertext (`token_ciphertext`, key `BUGFLOW_PORTAL_ENCRYPTION_KEY`).
- Optimistic concurrency: bug `version` is `bugs.updated_at::text` (no separate column); media marks use `bug_media.marks_version`.

## Core entities (001)
`users`, `projects`, `modules`, `portals` (one per member link or the admin; type, token hash, expiry, revoked_at, active), `portal_projects` (scope), `bugs`, `steps`, `comments`, `assignment_batches`, `assignments`, `status_history`, `verifications`, `evidence`, `activity`, `saved_views`, `settings`.

## Migrations
| # | Purpose |
| --- | --- |
| 001 | Base schema |
| 002 | `portal_onboarding` (role, permissions jsonb, scope note) |
| 003 | `admin_sessions` (hashed, expiring) |
| 004 | `bug_details`, `bug_mutations` (request-ID idempotency/audit) |
| 005 | Member management columns |
| 006 | Sample bugs |
| 007 | `notification_state`, `portals.last_seen_at` |
| 008 | Dropdown options; `bugs.deleted_at` |
| 009 | Grant `disposition` to developers |
| 010 | `bug_assignees` (multi-assignee) |
| 011 | `portals.online_until` (presence) |
| 012 | `bug_media` |
| 013 | `portals.appearance` |
| 014 | Media lineage (`derived_from`, `at_seconds`) |
| 015 | Trash `purged_at` for bugs/members |
| 016 | `ai_tokens` |
| 017 | `oauth_clients`, `oauth_codes` |
| 018 | `bug_media.marks`, `marks_version` |
| 019 | `bug_media.restorable_until` |
| 020 | `bug_media.has_thumb` |
| 021 | `bugs.due_on` (Phase 2.1 due dates) + partial index |
| 022 | `sprints`, `sprint_items` (Phase 2.2); one active sprint per project |

## Integrity notes
- Member deletion is soft; bug references remain; all portals revoked.
- Media sweep purges only rows whose `restorable_until` is null or past.
- Demo data: `npm run demo:seed` / `demo:remove` (`database/demo`).
