import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { parseAiToken } from "./ai-tokens";
import { PRIORITIES, formatBugCode, type BugAccess } from "./bug-workflow";

/**
 * BugFlow's Model Context Protocol server: any MCP client (Claude, Cursor, VS Code, ChatGPT) can read and report bugs
 * as the Admin panel or a member panel, using an AI token as a Bearer credential. Every tool runs through the same
 * scoped server functions as the app, so a token can never see or do more than its panel. Stateless: one request, one reply.
 */
const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});
// Compact, low-token renderings: fields are named once (a header line for lists, short labels for detail) instead of
// repeated JSON keys per row, so an AI reads and understands a lot of bugs for a fraction of the tokens.
const ymd = (iso: string) => (iso || "").slice(0, 10);
const oneLine = (v: string, max = 140) => {
  const t = (v || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "\u2026" : t;
};
type Row = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  severity: string;
  project: string;
  reporter: string;
  assignee: string;
  createdAt: string;
};
function bugsTable(rows: Row[], total: number): string {
  if (!rows.length) return "No bugs match.";
  // Pipe-separated, columns named once. id = numeric id for get_bug/update tools.
  const head = "id | code | status | pri | sev | project | assignee | title";
  const body = rows
    .map((b) =>
      [
        b.id,
        b.code,
        b.status,
        b.priority,
        b.severity,
        oneLine(b.project, 28),
        oneLine(b.assignee, 24),
        oneLine(b.title, 90),
      ].join(" | "),
    )
    .join("\n");
  const more =
    total > rows.length
      ? `\n(${rows.length} of ${total}; narrow with query/status/projectId or raise limit)`
      : "";
  return `${rows.length} bug(s). Columns: ${head}\n${body}${more}`;
}
function bugDetailText(
  b: {
    id: string;
    code: string;
    title: string;
    status: string;
    priority: string;
    severity: string;
    project: string;
    module: string;
    reporter: string;
    assignee: string;
    assignees?: { id: string; name: string }[];
    description: string;
    steps: string[];
    expected: string;
    actual: string;
    environment: string;
    browserDevice: string;
    fixNotes: string;
    version: string;
    createdAt: string;
    updatedAt: string;
    evidenceUrls: string[];
  },
  media: { name: string; kind: string; url: string | null }[],
  events: { actor: string; action: string; createdAt: string; detail: Record<string, string> }[],
): string {
  const lines: string[] = [];
  lines.push(
    `${b.code} [${b.status}] ${b.priority}/${b.severity}  ${b.project}${b.module ? ` \u203a ${b.module}` : ""}`,
  );
  lines.push(`title: ${b.title}`);
  lines.push(
    `reporter: ${b.reporter}  assignee: ${b.assignees?.length ? b.assignees.map((a) => a.name).join(", ") : b.assignee}`,
  );
  lines.push(
    `id: ${b.id}  version: ${b.version}  created: ${ymd(b.createdAt)}  updated: ${ymd(b.updatedAt)}`,
  );
  if (b.environment || b.browserDevice)
    lines.push(`env: ${[b.environment, b.browserDevice].filter(Boolean).join(" / ")}`);
  lines.push(`description: ${oneLine(b.description, 600)}`);
  if (b.steps.length)
    lines.push("steps:\n" + b.steps.map((st, i) => `  ${i + 1}. ${oneLine(st, 200)}`).join("\n"));
  if (b.expected) lines.push(`expected: ${oneLine(b.expected, 300)}`);
  if (b.actual) lines.push(`actual: ${oneLine(b.actual, 300)}`);
  if (b.fixNotes) lines.push(`fix notes: ${oneLine(b.fixNotes, 300)}`);
  const links = [
    ...b.evidenceUrls,
    ...media.filter((m) => m.url).map((m) => `${m.name} (${m.kind}): ${m.url}`),
  ];
  if (links.length) lines.push("attachments:\n" + links.map((l) => `  ${l}`).join("\n"));
  if (events.length)
    lines.push(
      "history (newest first):\n" +
        events
          .slice(0, 12)
          .map(
            (e) =>
              `  ${ymd(e.createdAt)} ${e.actor}: ${e.action.replace("bug.", "")}${Object.keys(e.detail).length ? " " + oneLine(Object.values(e.detail).join(" "), 90) : ""}`,
          )
          .join("\n"),
    );
  return lines.join("\n");
}

/** Builds the server for one AI token; all tools act as that token's panel. */
async function serverFor(access: BugAccess) {
  const bw = await import("./bug-workflow.server");
  const actor = await bw.actorFor(access); // throws if the token is invalid or revoked
  const can = (p: string) => actor.permissions.includes(p);
  const server = new McpServer(
    { name: "bugflow", version: "1.0.0" },
    {
      instructions: `You are connected to the Futurist Global Bug Board as ${actor.name} (${actor.role} panel). You may only see and change bugs this panel is allowed to. Report bugs with clear steps; one bug per report. Use get_bug before changing a bug so you have its current id and version.`,
    },
  );

  server.registerTool(
    "whoami",
    { title: "Who am I", description: "The panel this token acts as, and what it may do." },
    async () =>
      text(
        `You act as ${actor.name} on the ${actor.role} panel. Permissions: ${actor.permissions.join(", ")}.`,
      ),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Projects this panel can file bugs against, with their id and name.",
    },
    async () => {
      const ws = await bw.workspaceData(access);
      const lines = [
        "Projects (id | name):",
        ...ws.projects.map((p) => `${p.id} | ${p.name}`),
        `severities: ${ws.options.severities.join(", ")}`,
        `priorities: ${PRIORITIES.join(", ")}`,
      ];
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "list_bugs",
    {
      title: "List bugs",
      description:
        "Bugs visible to this panel, newest first. Optional text search (id, title, person) and status/project filters.",
      inputSchema: {
        query: z.string().max(200).optional(),
        status: z.string().max(40).optional(),
        projectId: z.string().uuid().optional(),
        includeClosed: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ query, status, projectId, includeClosed, limit }) => {
      if (!can("view")) return fail("This panel cannot view bugs.");
      let bugs = await bw.exportBugs(access, {
        projectId: projectId ?? null,
        includeClosed: includeClosed ?? true,
      });
      if (status) bugs = bugs.filter((b) => b.status.toLowerCase() === status.toLowerCase());
      if (query) {
        const q = query.toLowerCase();
        bugs = bugs.filter((b) =>
          `${b.code} ${b.title} ${b.reporter} ${b.assignee} ${b.project}`.toLowerCase().includes(q),
        );
      }
      const rows = bugs.slice(0, limit ?? 50).map((b) => ({
        id: b.id,
        code: b.code,
        title: b.title,
        status: b.status,
        priority: b.priority,
        severity: b.severity,
        project: b.project,
        reporter: b.reporter,
        assignee: b.assignee,
        createdAt: b.createdAt,
      }));
      return text(bugsTable(rows, bugs.length));
    },
  );

  server.registerTool(
    "get_bug",
    {
      title: "Get a bug",
      description:
        "Full detail for one bug: description, steps, expected/actual, attachments and history. Use the numeric id (from list_bugs) or a BF-code.",
      inputSchema: { id: z.string().min(1).max(20) },
    },
    async ({ id }) => {
      if (!can("view")) return fail("This panel cannot view bugs.");
      const numeric = id.replace(/^BF-?0*/i, "").replace(/\D/g, "");
      if (!/^[1-9]\d*$/.test(numeric)) return fail("Give a bug id like 51 or BF-000051.");
      try {
        const d = await bw.bugDetail(access, numeric);
        const b = d.bug;
        return text(
          bugDetailText(
            b,
            d.media.map((m) => ({ name: m.name, kind: m.kind, url: m.url })),
            d.events.map((e) => ({
              actor: e.actor,
              action: e.action,
              createdAt: e.createdAt,
              detail: e.detail,
            })),
          ),
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : "This bug could not be read.");
      }
    },
  );

  server.registerTool(
    "report_bug",
    {
      title: "Report a bug",
      description:
        "File a new bug. Give a clear description and the exact steps to reproduce; one bug per report. projectId comes from list_projects.",
      inputSchema: {
        projectId: z.string().uuid(),
        title: z.string().max(180).optional(),
        description: z.string().min(1).max(8000),
        steps: z.array(z.string().min(1).max(2000)).min(1).max(30),
        expected: z.string().max(4000).optional(),
        actual: z.string().max(4000).optional(),
        priority: z.enum(PRIORITIES).optional(),
        severity: z.string().max(40).optional(),
        module: z.string().max(100).optional(),
        environment: z.string().max(80).optional(),
        browserDevice: z.string().max(200).optional(),
      },
    },
    async (input) => {
      if (!can("report")) return fail("This panel cannot report bugs.");
      try {
        const { reportSchema } = await import("./bug-workflow");
        const data = reportSchema.parse({
          requestId: crypto.randomUUID(),
          projectId: input.projectId,
          title: input.title ?? "",
          description: input.description,
          steps: input.steps,
          expected: input.expected ?? "",
          actual: input.actual ?? "",
          priority: input.priority ?? "P3",
          severity: input.severity ?? "Medium",
          module: input.module ?? "",
          environment: input.environment ?? "",
          browserDevice: input.browserDevice ?? "",
          evidenceUrls: [],
        });
        const r = await bw.reportBug(access, data);
        return text(`Reported ${r.code} (id ${r.id}).`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "The bug could not be reported.");
      }
    },
  );

  const change = async (args: {
    id: string;
    version: string;
    action: "status" | "assign" | "comment";
    status?: string | undefined;
    assigneeIds?: string[] | undefined;
    notes?: string | undefined;
    noteTo?: string | undefined;
  }) => {
    const { bugChangeSchema } = await import("./bug-workflow");
    const data = bugChangeSchema.parse({
      requestId: crypto.randomUUID(),
      id: args.id,
      version: args.version,
      action: args.action,
      ...(args.status ? { status: args.status } : {}),
      ...(args.assigneeIds ? { assigneeIds: args.assigneeIds } : {}),
      notes: args.notes ?? "",
      noteTo: args.noteTo ?? "",
    });
    await bw.changeBug(access, data);
  };

  server.registerTool(
    "update_bug_status",
    {
      title: "Change a bug status",
      description:
        "Move a bug to a new status the panel is allowed to set (for example In progress, Needs information, Resolved). Pass the id and the version from get_bug.",
      inputSchema: {
        id: z.string().regex(/^[1-9]\d*$/),
        version: z.string().min(1).max(60),
        status: z.string().min(1).max(40),
        notes: z.string().max(4000).optional(),
      },
    },
    async ({ id, version, status, notes }) => {
      try {
        await change({ id, version, action: "status", status, notes });
        return text(`Status of ${formatBugCode(id)} updated to ${status}.`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "The status could not be changed.");
      }
    },
  );

  server.registerTool(
    "comment_bug",
    {
      title: "Comment on a bug",
      description: "Add a comment to a bug. Pass the id and the version from get_bug.",
      inputSchema: {
        id: z.string().regex(/^[1-9]\d*$/),
        version: z.string().min(1).max(60),
        comment: z.string().min(1).max(4000),
      },
    },
    async ({ id, version, comment }) => {
      if (!can("comment")) return fail("This panel cannot comment on bugs.");
      try {
        await change({ id, version, action: "comment", notes: comment });
        return text(`Comment added to ${formatBugCode(id)}.`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "The comment could not be added.");
      }
    },
  );

  if (actor.permissions.includes("assign"))
    server.registerTool(
      "assign_bug",
      {
        title: "Assign a bug",
        description:
          "Assign a bug to one or more developers by their user id (from get_bug assignees or list_projects members). Pass the id and version from get_bug.",
        inputSchema: {
          id: z.string().regex(/^[1-9]\d*$/),
          version: z.string().min(1).max(60),
          assigneeIds: z.array(z.string().uuid()).min(1).max(20),
        },
      },
      async ({ id, version, assigneeIds }) => {
        try {
          await change({ id, version, action: "assign", assigneeIds });
          return text(`${formatBugCode(id)} assigned.`);
        } catch (e) {
          return fail(e instanceof Error ? e.message : "The bug could not be assigned.");
        }
      },
    );

  return server;
}

/** Handles one MCP HTTP request: reads the Bearer AI token, builds the scoped server, answers, and tears it down. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const raw = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7)
    : (new URL(request.url).searchParams.get("token") ?? "");
  const token = parseAiToken(raw);
  if (!token) return unauthorized(request);
  let server: McpServer;
  try {
    server = await serverFor({ kind: "ai", token });
  } catch (e) {
    return unauthorized(request, e instanceof Error ? e.message : undefined);
  }
  const options = { enableJsonResponse: true } as ConstructorParameters<
    typeof WebStandardStreamableHTTPServerTransport
  >[0];
  const transport = new WebStandardStreamableHTTPServerTransport(options);
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    // Stateless: close after the reply so nothing lingers between requests.
    void transport.close();
    void server.close();
  }
}
function unauthorized(request: Request, detail?: string) {
  const resource = new URL(request.url).origin;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          detail ??
          "A valid BugFlow AI token is required. Create one in Settings (Admin) or in your portal.",
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer realm="BugFlow", resource_metadata="${resource}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}
