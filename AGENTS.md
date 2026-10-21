
## BugFlow architecture
- Use shared frontend confirmation and error feedback for sign-out and portal access changes; keep failed confirmations open and offer retry for failed reads so actions remain recoverable without altering server authorization.
- Workspace routes use a shared server-session beforeLoad check and redirect to the standalone login page before rendering; member token routes keep their own scoped access validation.
- Admin cookies are Secure, HttpOnly and partitioned with SameSite=None for embedded preview support; mutations retain same-origin validation and sign-in verifies session readback before navigating.
- Preserve TanStack Start file-based routes and shadcn controls; all content routes carry their own metadata for reliable navigation and previews.
- Keep pure domain rules in `src/lib/bugflow.ts` and `src/lib/bug-workflow.ts`, presentation in `src/components/bugflow`, and server-only integrations behind server functions; this separates permission/count rules from UI.
- Unconfigured views display unavailable data, never fabricated records or success; live features require approved development connections.
- Keep proposed Neon schema changes in versioned SQL files under `database/` and apply them to the Neon database referenced by DATABASE_URL; this makes database changes reviewable and keeps credentials out of app code.
- AI onboarding uses a server-only call to an OpenAI-compatible API (AI_API_KEY) and verifies a live Neon Admin session before spending credits; only an authorized atomic member save grants selected role-limited permissions and actual project scope, never generated guidance.
- Admin sign-in verifies configured email and password only on the server and maps the verified owner to expiring hashed sessions in Neon; member links use hash-only validation plus server-encrypted recovery for Admin copying, and are validated for role, active user, expiry and revocation on every read.

- Bug reports and changes use shared scoped server functions for Admin and member panels, validate active access and explicit permissions, and atomically write immutable actor history; optimistic versions and request IDs protect retries and concurrent edits.

- Member lifecycle uses soft deletion and atomic audit records, retaining bug references while revoking all member portals; welcome acknowledgements live on the validated portal so first-visit behavior persists across devices.
- A shared theme provider updates semantic CSS variables and saves only the theme preference in browser storage; all workspace and member pages use the same theme controls.
- Single-project forms retain scoped IDs while hiding redundant selectors; compact tables omit project columns without changing server authorization.

- Shared report validation derives omitted titles and actual results from the submitted description; contextual facts remain empty to avoid invented data.
- Expanded bug rows reuse the shared report presentation and scoped detail query; inline assignment uses the existing authorized audited mutation.
- Settings uses the shared scoped workspace query for option and assignee management; member creation invalidates member, workspace and detail queries so eligible assignment choices refresh immediately.
