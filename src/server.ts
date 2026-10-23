import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Portal URLs carry a private access token: never cache, index, frame or leak them via Referer.
const PORTAL_PATH = /^\/(member|qa|developer|reporter)\/[a-f0-9]{64}\/?$/;
const PORTAL_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

// MCP is called cross-origin by AI clients, so the endpoint allows any origin; the AI token is the only credential.
function mcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, content-type, mcp-session-id, mcp-protocol-version, accept",
  );
  headers.set("Access-Control-Expose-Headers", "mcp-session-id, www-authenticate");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
function withPortalHeaders(request: Request, response: Response): Response {
  if (!PORTAL_PATH.test(new URL(request.url).pathname)) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(PORTAL_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (request.method === "POST" && new URL(request.url).pathname === "/api/presence") {
        const { handlePresence } = await import("./lib/presence.server");
        return await handlePresence(request);
      }
      // Model Context Protocol endpoint: any AI client reaches the bugs with a BugFlow AI token. CORS-open; auth is the token.
      const mcpPath = new URL(request.url).pathname;
      const isMcp = mcpPath === "/api/mcp" || mcpPath === "/mcp";
      const isOauth =
        mcpPath.startsWith("/api/oauth/") || mcpPath.startsWith("/.well-known/oauth-");
      if (isMcp || isOauth) {
        const { mcpConfig } = await import("./lib/mcp-config.server");
        const cfg = await mcpConfig();
        if (!cfg.enabled)
          return mcpCors(
            Response.json(
              {
                error: "mcp_disabled",
                error_description: "AI access is turned off for this workspace.",
              },
              { status: 404 },
            ),
          );
        if (isOauth && !cfg.oauth)
          return mcpCors(
            Response.json(
              {
                error: "oauth_disabled",
                error_description: "App connectors (OAuth) are turned off. Paste a token instead.",
              },
              { status: 404 },
            ),
          );
      }
      if (mcpPath === "/api/mcp" || mcpPath === "/mcp") {
        if (request.method === "OPTIONS") return mcpCors(new Response(null, { status: 204 }));
        if (request.method === "GET" && new URL(request.url).searchParams.get("token") === null) {
          return mcpCors(
            Response.json({
              name: "BugFlow MCP",
              version: "1.0.0",
              transport: "streamable-http",
              authentication: "Bearer AI token (create one in Settings or your portal)",
            }),
          );
        }
        const { handleMcpRequest } = await import("./lib/mcp.server");
        return mcpCors(await handleMcpRequest(request));
      }
      // OAuth 2.1 (register, authorize, token, discovery) so claude.ai / ChatGPT connectors can sign in.
      if (mcpPath.startsWith("/api/oauth/") || mcpPath.startsWith("/.well-known/oauth-")) {
        const { handleOauth } = await import("./lib/oauth-routes.server");
        const oauth = await handleOauth(request);
        if (oauth) return mcpCors(oauth);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withPortalHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
