import {
  approveAuthorize,
  authServerMetadata,
  exchangeCode,
  protectedResourceMetadata,
  registerClient,
  sweepOauthCodes,
  validateAuthorize,
} from "./oauth.server";
import { consentPage, parsePortalUrl } from "./oauth-consent";

/** The OAuth routes for the MCP endpoint. Returns a Response for an OAuth path, or null when the path is not ours. */
export async function handleOauth(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const oauthError = (error: string, description: string, status = 400) =>
    json({ error, error_description: description }, status);

  if (path === "/.well-known/oauth-authorization-server") return json(authServerMetadata(origin));
  if (
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/api/mcp"
  )
    return json(protectedResourceMetadata(origin));

  if (path === "/api/oauth/register" && request.method === "POST") {
    try {
      return json(await registerClient(await request.json().catch(() => ({}))), 201);
    } catch (e) {
      return oauthError(
        "invalid_client_metadata",
        e instanceof Error ? e.message : "Registration failed.",
      );
    }
  }

  if (path === "/api/oauth/authorize") {
    if (request.method === "GET") {
      const params = Object.fromEntries(url.searchParams.entries());
      try {
        const { name } = await validateAuthorize({
          clientId: params["client_id"] ?? "",
          redirectUri: params["redirect_uri"] ?? "",
          codeChallenge: params["code_challenge"] ?? "",
          method: params["code_challenge_method"] ?? "",
          responseType: params["response_type"] ?? "",
        });
        const keep = [
          "client_id",
          "redirect_uri",
          "state",
          "code_challenge",
          "code_challenge_method",
          "response_type",
          "scope",
        ].reduce<Record<string, string>>((a, k) => {
          if (params[k]) a[k] = params[k]!;
          return a;
        }, {});
        return html(consentPage({ clientName: name, params: keep }));
      } catch (e) {
        return html(
          `<!doctype html><meta charset="utf-8"><body style="font:15px sans-serif;padding:40px;background:#13111c;color:#eceaf5">This connection request is invalid: ${e instanceof Error ? e.message : "bad request"}.</body>`,
          400,
        );
      }
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const g = (k: string) => String(form.get(k) ?? "");
      const base = {
        clientId: g("client_id"),
        redirectUri: g("redirect_uri"),
        codeChallenge: g("code_challenge"),
        method: g("code_challenge_method"),
        responseType: g("response_type"),
      };
      const redirectBack = (qs: string) =>
        new Response(null, {
          status: 302,
          headers: {
            location: `${base.redirectUri}${base.redirectUri.includes("?") ? "&" : "?"}${qs}`,
          },
        });
      try {
        const name = (await validateAuthorize(base)).name;
        const login =
          g("login_kind") === "portal"
            ? ((): { kind: "portal"; token: string; type: string } => {
                const p = parsePortalUrl(g("portal_url"));
                if (!p) throw new Error("Paste a valid portal link.");
                return { kind: "portal", token: p.token, type: p.type };
              })()
            : { kind: "admin" as const, email: g("email"), password: g("password") };
        const { code } = await approveAuthorize({ ...base, login, clientName: name });
        const state = g("state");
        return redirectBack(
          `code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ""}`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sign-in failed.";
        // A credential error re-renders the consent page; a structural error (bad client) cannot redirect safely.
        if (/portal|password|email|panel|valid portal/i.test(message)) {
          const keep = [
            "client_id",
            "redirect_uri",
            "state",
            "code_challenge",
            "code_challenge_method",
            "response_type",
            "scope",
          ].reduce<Record<string, string>>((a, k) => {
            const v = String(form.get(k) ?? "");
            if (v) a[k] = v;
            return a;
          }, {});
          let clientName = "";
          try {
            clientName = (await validateAuthorize(base)).name;
          } catch {
            /* keep blank */
          }
          return html(consentPage({ clientName, params: keep, error: message }), 400);
        }
        return html(
          `<!doctype html><meta charset="utf-8"><body style="font:15px sans-serif;padding:40px;background:#13111c;color:#eceaf5">${message}</body>`,
          400,
        );
      }
    }
  }

  if (path === "/api/oauth/token" && request.method === "POST") {
    void sweepOauthCodes();
    const ct = request.headers.get("content-type") ?? "";
    const form = ct.includes("application/json")
      ? await request.json().catch(() => ({}))
      : Object.fromEntries((await request.formData()).entries());
    const f = (k: string) => String((form as Record<string, unknown>)[k] ?? "");
    if (f("grant_type") !== "authorization_code")
      return oauthError("unsupported_grant_type", "Only authorization_code is supported.");
    try {
      return json(
        await exchangeCode({
          code: f("code"),
          redirectUri: f("redirect_uri"),
          clientId: f("client_id"),
          codeVerifier: f("code_verifier"),
        }),
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : "invalid_grant";
      return oauthError(/invalid_request/.test(m) ? "invalid_request" : "invalid_grant", m);
    }
  }
  return null;
}
function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
