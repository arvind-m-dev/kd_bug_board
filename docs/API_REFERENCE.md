# API reference

## HTTP endpoints (`src/server.ts`)
| Endpoint | Auth | Behavior |
| --- | --- | --- |
| `GET /api/health` | none | Runs `select 1`; returns JSON with latency. For keep-warm/uptime pings |
| `POST /api/presence` | portal token in body | `{token, type, state: 'here'\|'leaving'}` from an open member portal; updates online status |
| `/api/mcp`, `/mcp` | `Authorization: Bearer <AI token>` | MCP Streamable HTTP, stateless, CORS-open |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | none | OAuth discovery |
| `/api/oauth/register` | none | Dynamic client registration |
| `/api/oauth/authorize` | consent sign-in | Admin email+password or portal link; throttled |
| `/api/oauth/token` | code + PKCE verifier | Issues AI token (single-use code) |

## MCP tools (`src/lib/mcp.server.ts`)
`whoami`, `list_projects`, `list_bugs`, `get_bug`, `report_bug` (needs `report`), `update_bug_status`, `comment_bug`, `assign_bug` (only registered when panel has `assign`). Compact text output. No delete tool.

## Server functions
Called by the app as RPC (`createServerFn`). Bug functions take `access` (`accessSchema`). Admin-only functions require an Admin session; mutations check same origin. Errors are thrown as messages shown via shared feedback.

| Module | Functions |
| --- | --- |
| `bug-workflow.functions.ts` | getBugWorkspace, getBugExport, createBug, getBugDetail, updateBug (status/priority/severity/assign/comment/verify; `version` + request ID), editBug, saveOptions |
| `bug-media.functions.ts` | prepareMediaUpload, finishMediaUpload, saveVideoMarks, deleteMedia, restoreMedia, deleteMediaForever, getMediaTrash, renameMedia, getMediaLibrary, saveMediaStorage, clearBugMedia, getMediaUsage, saveMediaQuota, saveMediaCleanup, getMediaStatus |
| `portal-access.functions.ts` | getAdminStatus, unlockAdminAccess, lockAdminAccess, getMembers, getProjects, getProjectSummary, addProject, archiveProject, createMemberPortal, manageMemberPortal, getMemberPortal |
| `member-management.functions.ts` | getMemberProfile, saveMemberProfile, changeMember, dismissWelcome, savePortalAppearance |
| `trash.functions.ts` | getTrash, restoreFromTrash, deleteForever, emptyTrash |
| `ai-tokens.functions.ts` | createAiToken, getAiTokens, revokeAiToken, createPortalAiToken, getPortalAiTokens, revokePortalAiToken |
| `notifications.functions.ts` | getNotifications, updateNotifications, getBugState |
| `activity.functions.ts` | getActivity, getActivityInsights, getActivityPeople, getTeamPerformance |
| `person-reports.functions.ts` | getPersonOverview, getPersonDetail, getTeamDetail |
| `overview.functions.ts` | getOverviewStats |
| `appearance.functions.ts` | getAppearance, saveAppearance |
| `mcp-config.functions.ts` | getMcpConfig, saveMcpConfig |
| `onboarding.functions.ts` | generateCollaboratorOnboarding |
| `system-health.functions.ts` | getSystemHealth, getStorageAlarms |

Update this table whenever a function is added or its contract changes.
