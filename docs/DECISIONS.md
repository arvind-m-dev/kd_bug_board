# Technical decisions

Constraints future work must respect. Fuller rule list: `AGENTS.md`.

1. **Pure rules separate from I/O.** Permissions, transitions and counts live in `bugflow.ts` / `bug-workflow.ts` so they are unit-testable and shared by UI, server and MCP.
2. **One scoped path for every client.** Admin UI, portals and MCP all call the same server functions with an `access` value; no parallel authorization code.
3. **Portal links instead of member accounts.** Members get expiring, revocable, hash-stored links; Admin can re-copy via encrypted copy. Avoids a password system for collaborators.
4. **Audit in the same statement.** Version check + mutation + audit row are one SQL statement; prevents lost updates and history gaps.
5. **Soft delete with 30-day Trash; `purged_at` keeps rows.** History and references survive deletion.
6. **Browser-to-bucket uploads.** Server only signs; large recordings never pass through Vercel functions. Requires bucket CORS per origin.
7. **Never re-encode for marks.** Video marks are an overlay with their own version.
8. **MCP output is compact text, no delete tool.** Cheap for AI reading; destructive actions stay human-only.
9. **OAuth tokens are ordinary AI tokens.** One revocation surface (Settings → AI access).
10. **Versioned, idempotent SQL migrations only.** Reviewable; keeps credentials out of app code.
11. **Unconfigured features show "unavailable", never fake data.**
12. **Docs in `docs/` are the persistent project memory** (2026-10-28); update with every change.
