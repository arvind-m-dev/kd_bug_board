# BugFlow implementation plan

## Goal
Build a polished manual-QA workspace with clearly visible dashboards, easy navigation, clickable counts, copyable bug reports and portal links, and accurate shared data across Admin, Reporter, QA, Developer and Member portals. No login screen.

## What exists today
- The repository is a React 19 / TanStack Start application using Bun, Vite, Tailwind v4, TanStack Query and reusable shadcn UI controls.
- The home page is a placeholder; BugFlow pages, business logic and Neon/R2 integrations are not implemented.
- Vitest and React Testing Library are available.
- The supplied demo URL redirects to a sign-in page, so its internal dashboards could not be inspected. Use the uploaded screenshots for dashboard/table structure and create an original BugFlow interface; do not copy unrelated product features or the login screen.

## 1. Clear, usable interface
- Light neutral surfaces, teal primary actions, restrained status colors, readable typography, subtle borders and compact cards inspired by the supplied screenshots.
- Persistent Admin navigation: Overview, All Bugs, Users & Portals, Assignments, Projects & Modules, Activity & Reports, Settings. Every item opens a working page; breadcrumbs and return links keep navigation predictable.
- Overview shows total/open/unassigned bugs, awaiting QA verification, users and portals, status/severity/priority breakdowns, project and developer workloads, overdue bugs, and recent activity.
- Each count opens the corresponding filtered list. Counts and lists use identical definitions and permission scopes. Show loading/unavailable states instead of invented numbers; a confirmed empty database shows zero.
- Searchable, sortable, paginated bug tables with readable IDs, status/severity/priority badges, selection, filters and clear actions. Provide saved views, useful empty/error states and confirmation dialogs.
- Bug detail pages show reproduction steps, expected/actual results, evidence, comments, assignment history, fix notes and verification history.
- Copy buttons for bug IDs, permitted links and complete Markdown reports: one bug, selected bugs or all filtered results. Export every matching record, not just the current page, with downloadable fallback for large reports; include CSV export.
- Layouts remain usable on smaller screens, with accessible labels, visible focus states and appropriately sized controls.

## 2. First complete workflow
Implement and verify this vertical slice before expanding reporting and settings:

1. Admin creates a user and a restricted portal, then copies its link.
2. Reporter opens that link and submits a bug with reproduction details.
3. QA validates the bug and assigns it to a developer.
4. Developer opens their portal, adds fix notes and sends the bug for retesting.
5. QA records pass/fail: a pass resolves the bug; a failure reopens it.
6. Admin sees the updated counts, assignment and complete actor/timestamp history.

All portals read the same Neon records. Refresh relevant views after mutations and use a verified cross-session update mechanism; do not substitute local arrays or browser storage for shared data. If the available connection supports only polling, state its refresh delay rather than promising instantaneous synchronization.

## 3. Portal access and permissions
- Routes: `/admin`, `/reporter/$portalToken`, `/qa/$portalToken`, `/developer/$portalToken`, `/member/$portalToken`; `/` opens the actual BugFlow workspace.
- Admin also requires server-validated authority: bootstrap a private Admin bearer link through secure setup and exchange it for a secure cookie. `/admin` alone grants no access. No publicly accessible admin mutations or client-only role checks.
- Generate cryptographically random portal tokens server-side; store only hashes. Support active/disabled/revoked states, expiry, regeneration and revocation. Show a newly generated link only to the authorized Admin; never return other users' tokens.
- Reporters submit and follow permitted bugs; QA validates, handles duplicates, assigns and verifies; developers access their assignments, add progress/fix notes and request retesting; members view/comment within their granted scope.
- Validate every read, write, export and evidence operation on the server. Derive actor and scope from the token/session, never from caller-supplied user IDs or URL role names. Prevent tokens from leaking through logs, referrers or exported links.
- Rate limiting is required by the brief. Use an explicitly configured durable limiter, not a pretend in-memory serverless limit; confirm the supported mechanism and operational tradeoff before implementation.

## 4. Workflow and remaining features
- Enforce `NEW → VALIDATING → VALIDATED → READY_FOR_ASSIGNMENT → ASSIGNED → IN_PROGRESS → RECHECK → RESOLVED` with `NEEDS_INFORMATION`, `REOPENED`, `DUPLICATE`, `NOT_A_BUG`, and `WONT_FIX` branches.
- Record every transition and actor. Only authorized QA/tester verification resolves a successfully retested bug; developers cannot resolve their own fixes.
- Add individual/bulk assignment and reassignment, explicit previews of affected records, confirmation, and safe transaction/failure reporting.
- Add project/module/environment management, user editing and deactivation, similarity suggestions for QA-confirmed duplicates, saved filters, activity reports and export/backup controls.
- Settings manage permitted priorities, severities, attachment policies and bug-ID presentation without bypassing the validated lifecycle or changing existing permanent IDs.

## 5. Neon records and private R2 evidence
- Discover the selected Neon development database schema before creating additive migrations. Use the Neon connector with parameterized statements and transactional batches; no direct Postgres client or production connection by default.
- Model users, portals, projects/modules, bugs, ordered steps, comments, evidence metadata, assignments/batches, status history, verification outcomes, saved views and audit history with constraints and indexes.
- Generate permanent IDs such as `BF-000001` safely under concurrent submissions.
- Use private Cloudflare R2 objects for multiple screenshots/videos and other allowed evidence; Neon stores metadata only. Verify the connector's supported object operations before choosing the upload/download transport.
- Authorize short-lived upload/download access on the server, validate sizes/types, show progress and recoverable errors, and provide image/video previews.
- Delete evidence only after explicit confirmation and authorization, recording the actor and coordinating object/metadata deletion safely. Resolving a bug never deletes evidence.
- Private evidence remains private in exports: use permission-checked application links or explicitly expiring download links, never permanent public object URLs.

## Technical details and configuration
- Preserve the existing framework and reusable controls. Use TanStack server functions for internal operations, Query for scoped caching, and shared semantic CSS tokens. Give each content page unique BugFlow title/description/social metadata.
- Required Neon runtime variables: `LOVABLE_API_KEY` (platform-managed) and `NEON_API_KEY` (provided by linking the Neon connector). No raw connection string in app code.
- For Cloudflare connector access: `CLOUDFLARE_API_KEY` plus `LOVABLE_API_KEY`; account and bucket identifiers are configuration, not guessed values. R2 signing-specific configuration will be listed only after confirming the supported storage transport—never assume a Cloudflare API token is an S3 signing credential.
- Secure one-time Admin setup and any durable rate-limit configuration are also required; secret values must be supplied through secure settings, never pasted into code or printed.
- If services are not configured, deliver safe unavailable/setup states and integration boundaries, with live persistence/evidence explicitly marked blocked—not fake success or hardcoded dashboard statistics.
- Connect only approved development services. No destructive migration, production connection, deployment or paid-resource provisioning without explicit approval. Neon and R2 usage may incur provider charges.

## Verification and completion
- Automated tests: token validation/revocation/expiry, access scopes and spoofed actors, concurrent IDs, exact count definitions, assignments, allowed/denied status transitions, QA-only resolution, bulk confirmation/failures, evidence access/deletion, pagination/filtering and complete exports.
- Browser checks: the full Admin → Reporter → QA → Developer → QA → Admin flow with real stored records, cross-session consistency, clickable count/filter agreement, copy results, navigation, evidence handling and direct nested links.
- Run relevant tests and inspect build/runtime signals; report completed features and missing configuration separately. Published deep-link verification remains pending until an explicitly approved deployment.

## Delivery order
1. Establish the visual shell, all requested pages and safe configuration states.
2. With approved development connections, complete the secure shared-record workflow and live counts.
3. Complete private evidence, bulk actions, exports, reports, settings and reliability tests.

Approval authorizes implementation of this plan, not publishing or connecting to production; connection and resource approvals remain separate.