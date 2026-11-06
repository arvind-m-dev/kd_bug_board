// Gate 0 contract spike for the Jira trial. Stand-alone: it does not import or touch the app or its database.
//
// It proves, against YOUR Jira test site, the Atlassian behaviour the sync design depends on, and saves what it
// saw (never tokens) under .jira-spike/ so test fixtures can be made from real responses.
//
//   node --env-file=.env.jira-trial scripts/jira-spike.mjs
//
// Needs: JIRA_CLIENT_ID, JIRA_CLIENT_SECRET, JIRA_PUBLIC_ORIGIN (the public https address that tunnels to this
// script's port), JIRA_TRIAL_PROJECT_KEY. Optional: JIRA_ALLOWED_SITE_URL (recommended), JIRA_SPIKE_PORT (8090).
// Everything it creates in Jira is named "TRIAL-JIRA-spike …". Tokens stay in memory and vanish when it stops.

import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";

const env = (k) => (process.env[k] ?? "").trim();
const CLIENT_ID = env("JIRA_CLIENT_ID");
const CLIENT_SECRET = env("JIRA_CLIENT_SECRET");
const ORIGIN = env("JIRA_PUBLIC_ORIGIN").replace(/\/+$/, "");
const PROJECT = env("JIRA_TRIAL_PROJECT_KEY");
const ALLOWED = env("JIRA_ALLOWED_SITE_URL");
const PORT = Number(env("JIRA_SPIKE_PORT") || 8090);
const missing = Object.entries({
  JIRA_CLIENT_ID: CLIENT_ID,
  JIRA_CLIENT_SECRET: CLIENT_SECRET,
  JIRA_PUBLIC_ORIGIN: ORIGIN,
  JIRA_TRIAL_PROJECT_KEY: PROJECT,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`);
  process.exit(1);
}
if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(PROJECT)) {
  console.error("JIRA_TRIAL_PROJECT_KEY must be a Jira project key such as BFT.");
  process.exit(1);
}

const CALLBACK = "/api/integrations/jira/callback";
const WEBHOOK = "/api/integrations/jira/webhook";
const SCOPES = "read:jira-work write:jira-work manage:jira-webhook read:jira-user offline_access";
const OUT = ".jira-spike";
mkdirSync(OUT, { recursive: true });
// The tunnel makes this script reachable from the internet while it runs: every action needs this key.
const KEY = randomBytes(12).toString("hex");
let state = "";
let tokens = null; // { access, refresh, expiresAt }
let site = null; // { id, url, name }
let lastIssue = null; // { id, key }
let webhookIds = [];

const save = (name, data) => {
  const file = `${OUT}/${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.json`;
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
};
const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:14px/1.5 system-ui;max-width:900px;margin:32px auto;padding:0 16px"><h2>${title}</h2>${body}<p><a href="/?k=${KEY}">Back</a></p></body>`;
const esc = (v) =>
  String(v).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const pre = (v) =>
  `<pre style="background:#f4f4f6;padding:12px;overflow:auto">${esc(typeof v === "string" ? v : JSON.stringify(v, null, 2))}</pre>`;

async function tokenCall(body) {
  const r = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
const keep = (json) => {
  tokens = {
    access: json.access_token,
    refresh: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
};
/** What a token response looked like, without the tokens themselves. */
const shape = (r) => ({
  status: r.status,
  keys: r.json ? Object.keys(r.json) : [],
  expires_in: r.json?.expires_in,
  scope: r.json?.scope,
  token_type: r.json?.token_type,
  error: r.json?.error,
  access_token_length: r.json?.access_token?.length,
  refresh_token_length: r.json?.refresh_token?.length,
});
async function jira(path, init = {}) {
  if (!tokens || !site) throw new Error("Connect first.");
  const base = path.startsWith("https://")
    ? path
    : `https://api.atlassian.com/ex/jira/${site.id}${path}`;
  const r = await fetch(base, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${tokens.access}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { unparsed: text.slice(0, 500) };
  }
  const limits = Object.fromEntries(
    [...r.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)),
  );
  return { status: r.status, limits, json };
}
const adf = (text) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const actions = {
  async probe() {
    const calls = {
      myself: "/rest/api/3/myself",
      project: `/rest/api/3/project/${PROJECT}`,
      statuses: `/rest/api/3/project/${PROJECT}/statuses`,
      issueTypes: `/rest/api/3/issue/createmeta/${PROJECT}/issuetypes`,
      fields: "/rest/api/3/field",
      priorities: "/rest/api/3/priority",
      assignable: `/rest/api/3/user/assignable/search?project=${PROJECT}&maxResults=20`,
    };
    const out = {};
    for (const [name, path] of Object.entries(calls)) out[name] = await jira(path);
    const bug = (out.issueTypes.json?.issueTypes ?? out.issueTypes.json?.values ?? []).find(
      (t) => t.name === "Bug",
    );
    if (bug)
      out.bugFields = await jira(`/rest/api/3/issue/createmeta/${PROJECT}/issuetypes/${bug.id}`);
    const file = save("probe", out);
    return {
      saved: file,
      statuses: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.status])),
      bugIssueTypeId: bug?.id ?? "NOT FOUND — the project needs a work type named Bug",
      customFields: (Array.isArray(out.fields.json) ? out.fields.json : [])
        .filter((f) => f.custom)
        .map((f) => `${f.id}  ${f.name}  (${f.schema?.custom ?? f.schema?.type ?? "?"})`),
      workflowStatuses: (Array.isArray(out.statuses.json) ? out.statuses.json : []).flatMap((t) =>
        t.name === "Bug" ? t.statuses.map((s) => `${s.name} [${s.statusCategory?.key}]`) : [],
      ),
    };
  },
  async create() {
    const opId = randomUUID();
    const summary = `TRIAL-JIRA-spike ${new Date().toISOString()}`;
    const created = await jira("/rest/api/3/issue", {
      method: "POST",
      body: {
        fields: {
          project: { key: PROJECT },
          issuetype: { name: "Bug" },
          summary,
          description: adf("Created by the BugFlow Gate 0 spike. Safe to delete."),
        },
        properties: [{ key: "bugflow", value: { bugId: "spike", opId } }],
      },
    });
    if (created.status !== 201) return { saved: save("create-failed", created), created };
    lastIssue = { id: created.json.id, key: created.json.key };
    const read = await jira(
      `/rest/api/3/issue/${lastIssue.id}?fields=summary,status,priority,assignee,reporter,creator,duedate,updated,created&properties=bugflow`,
    );
    const transitions = await jira(`/rest/api/3/issue/${lastIssue.id}/transitions`);
    const edited = await jira(`/rest/api/3/issue/${lastIssue.id}`, {
      method: "PUT",
      body: { fields: { summary: `${summary} (edited)` } },
    });
    return {
      saved: save("create", { created, read, transitions, edited }),
      issue: lastIssue,
      propertyReadBack: read.json?.properties ?? null,
      transitions: (transitions.json?.transitions ?? []).map((t) => `${t.id} → ${t.to?.name}`),
      editStatus: edited.status,
    };
  },
  async transition(url) {
    if (!lastIssue) throw new Error("Create an issue first.");
    const id = url.searchParams.get("id");
    if (!id) throw new Error("Add &id=<transition id> from the create result.");
    const done = await jira(`/rest/api/3/issue/${lastIssue.id}/transitions`, {
      method: "POST",
      body: { transition: { id } },
    });
    const after = await jira(`/rest/api/3/issue/${lastIssue.id}?fields=status,resolution`);
    return {
      saved: save("transition", { done, after }),
      status: done.status,
      now: after.json?.fields?.status?.name,
    };
  },
  async search() {
    const jql = `project = ${PROJECT} AND issuetype = Bug AND updated >= "-30m" ORDER BY updated ASC`;
    const body = {
      jql,
      maxResults: 20,
      fields: ["summary", "status", "updated"],
      properties: ["bugflow"],
    };
    const plain = await jira("/rest/api/3/search/jql", { method: "POST", body });
    const reconciled = lastIssue
      ? await jira("/rest/api/3/search/jql", {
          method: "POST",
          body: { ...body, reconcileIssues: [Number(lastIssue.id)] },
        })
      : null;
    const byProperty = await jira("/rest/api/3/search/jql", {
      method: "POST",
      body: {
        jql: `project = ${PROJECT} AND issue.property[bugflow].bugId = "spike"`,
        maxResults: 5,
      },
    });
    return {
      saved: save("search", { plain, reconciled, byProperty }),
      found: (plain.json?.issues ?? []).map((i) => i.key),
      foundWithReconcile: reconciled
        ? (reconciled.json?.issues ?? []).map((i) => i.key)
        : "create an issue first to test",
      hasNextPageToken: "nextPageToken" in (plain.json ?? {}),
      hasTotal: "total" in (plain.json ?? {}),
      propertySearchStatus: byProperty.status,
    };
  },
  async "webhook-register"() {
    const r = await jira("/rest/api/3/webhook", {
      method: "POST",
      body: {
        url: `${ORIGIN}${WEBHOOK}`,
        webhooks: [
          {
            events: ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"],
            jqlFilter: `project = ${PROJECT}`,
          },
        ],
      },
    });
    webhookIds = (r.json?.webhookRegistrationResult ?? [])
      .map((w) => w.createdWebhookId)
      .filter(Boolean);
    return {
      saved: save("webhook-register", r),
      status: r.status,
      webhookIds,
      next: "Now create or edit a Bug in the test project; deliveries are captured automatically.",
    };
  },
  async "webhook-list"() {
    const r = await jira("/rest/api/3/webhook");
    webhookIds = (r.json?.values ?? []).map((w) => w.id);
    return { saved: save("webhook-list", r), status: r.status, webhooks: r.json?.values ?? [] };
  },
  async "webhook-refresh"() {
    const r = await jira("/rest/api/3/webhook/refresh", { method: "PUT", body: { webhookIds } });
    return { saved: save("webhook-refresh", r), status: r.status, body: r.json };
  },
  async "webhook-delete"() {
    const r = await jira("/rest/api/3/webhook", { method: "DELETE", body: { webhookIds } });
    if (r.status < 300) webhookIds = [];
    return { saved: save("webhook-delete", r), status: r.status };
  },
  async refresh(url) {
    if (!tokens) throw new Error("Connect first.");
    const old = tokens.refresh;
    const first = await tokenCall({ grant_type: "refresh_token", refresh_token: old });
    if (first.status === 200) keep(first.json);
    const out = {
      first: shape(first),
      rotated: first.status === 200 && first.json.refresh_token !== old,
    };
    // Optional: does the just-replaced refresh token still work inside Atlassian's reuse window?
    if (url.searchParams.get("reuse") === "1") {
      const again = await tokenCall({ grant_type: "refresh_token", refresh_token: old });
      if (again.status === 200) keep(again.json);
      out.reuseOfOldToken = shape(again);
    }
    return { saved: save("refresh", out), ...out };
  },
};

function captureWebhook(req, raw) {
  const auth = req.headers.authorization ?? "";
  const jwt = auth.replace(/^(Bearer|JWT)\s+/i, "");
  const parts = jwt.split(".");
  const decode = (p) => {
    try {
      return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  };
  let signatureValid = false;
  if (parts.length === 3) {
    const expected = createHmac("sha256", CLIENT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], "base64url");
    signatureValid = expected.length === given.length && timingSafeEqual(expected, given);
  }
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => k !== "authorization" && k !== "cookie"),
  );
  const file = save("webhook-delivery", {
    headers,
    authorizationScheme: auth.split(" ")[0] || null,
    jwtHeader: parts.length === 3 ? decode(parts[0]) : null,
    jwtClaims: parts.length === 3 ? decode(parts[1]) : null,
    signatureValidWithClientSecretHS256: signatureValid,
    bytes: raw.length,
    bodyKeys: body ? Object.keys(body) : null,
    webhookEvent: body?.webhookEvent,
    timestamp: body?.timestamp,
    matchedWebhookIds: body?.matchedWebhookIds,
    issue: body?.issue
      ? {
          id: body.issue.id,
          key: body.issue.key,
          fieldKeys: Object.keys(body.issue.fields ?? {}).length,
        }
      : null,
    changelog: body?.changelog
      ? {
          id: body.changelog.id,
          items: (body.changelog.items ?? []).map((i) => ({
            field: i.field,
            fieldId: i.fieldId,
            from: i.fromString,
            to: i.toString,
          })),
        }
      : null,
    userKeys: body?.user ? Object.keys(body.user) : null,
  });
  console.log(`webhook captured → ${file} (signature ${signatureValid ? "valid" : "NOT valid"})`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  const html = (status, body) => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(body);
  };
  try {
    if (req.method === "POST" && url.pathname === WEBHOOK) {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 2_000_000) break;
        chunks.push(c);
      }
      captureWebhook(req, Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200).end();
      return;
    }
    if (url.pathname === CALLBACK) {
      if (!state || url.searchParams.get("state") !== state)
        return html(400, page("State mismatch", "<p>Start again from the index page.</p>"));
      state = "";
      if (url.searchParams.get("error"))
        return html(400, page("Sign-in cancelled", pre(url.searchParams.get("error"))));
      const exchanged = await tokenCall({
        grant_type: "authorization_code",
        code: url.searchParams.get("code") ?? "",
        redirect_uri: `${ORIGIN}${CALLBACK}`,
      });
      if (exchanged.status !== 200 || !exchanged.json?.refresh_token)
        return html(400, page("Code exchange failed", pre(shape(exchanged))));
      keep(exchanged.json);
      const r = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: { authorization: `Bearer ${tokens.access}`, accept: "application/json" },
      });
      const sites = (await r.json().catch(() => [])) ?? [];
      const allowed = sites.filter(
        (s) => !ALLOWED || new URL(s.url).origin === new URL(ALLOWED).origin,
      );
      save("connect", {
        exchange: shape(exchanged),
        sites: sites.map((s) => ({ id: s.id, url: s.url, name: s.name, scopes: s.scopes })),
      });
      if (allowed.length !== 1) {
        tokens = null;
        return html(
          400,
          page(
            "Site not chosen",
            `<p>Expected exactly one allowed Jira site, found ${allowed.length}. Set JIRA_ALLOWED_SITE_URL to your test site.</p>${pre(sites.map((s) => s.url))}`,
          ),
        );
      }
      site = { id: allowed[0].id, url: allowed[0].url, name: allowed[0].name };
      res.writeHead(302, { location: `/?k=${KEY}` }).end();
      return;
    }
    if (url.searchParams.get("k") !== KEY)
      return html(403, "<p>Open the address printed in the terminal.</p>");
    if (url.pathname === "/connect") {
      state = randomBytes(32).toString("hex");
      const a = new URL("https://auth.atlassian.com/authorize");
      for (const [k, v] of Object.entries({
        audience: "api.atlassian.com",
        client_id: CLIENT_ID,
        scope: SCOPES,
        redirect_uri: `${ORIGIN}${CALLBACK}`,
        state,
        response_type: "code",
        prompt: "consent",
      }))
        a.searchParams.set(k, v);
      res.writeHead(302, { location: a.toString() }).end();
      return;
    }
    if (url.pathname === "/") {
      const link = (path, label, note = "") =>
        `<li><a href="${path}${path.includes("?") ? "&" : "?"}k=${KEY}">${label}</a> ${note}</li>`;
      return html(
        200,
        page(
          "BugFlow · Jira Gate 0 spike",
          `<p>Site: <b>${site ? esc(`${site.name} — ${site.url}`) : "not connected"}</b> · project <b>${PROJECT}</b> · last issue: ${lastIssue ? esc(lastIssue.key) : "none"} · webhooks: ${webhookIds.join(", ") || "none"}</p><ol>${[
            link("/connect", "1. Connect", "(Atlassian sign-in)"),
            link("/run/probe", "2. Probe", "(read-only: project, Bug type, statuses, fields)"),
            link("/run/create", "3. Create + read + edit one TRIAL-JIRA-spike bug"),
            link(
              "/run/transition?id=",
              "4. Transition it",
              "(add the id from step 3 to the address)",
            ),
            link("/run/search", "5. Search", "(enhanced search, reconcile, property search)"),
            link(
              "/run/webhook-register",
              "6. Register webhook",
              "(then edit the bug in Jira and watch the terminal)",
            ),
            link("/run/webhook-list", "7. List webhooks"),
            link("/run/webhook-refresh", "8. Extend webhook life"),
            link("/run/refresh", "9. Refresh token", "(rotation)"),
            link(
              "/run/refresh?reuse=1",
              "9b. Refresh, then reuse the old token",
              "(optional: reuse window)",
            ),
            link("/run/webhook-delete", "10. Delete webhook (clean-up)"),
          ].join(
            "",
          )}</ol><p>Captures: ${readdirSync(OUT).length} file(s) in <code>${OUT}/</code>. Delete the TRIAL-JIRA-spike bugs in Jira by hand when done.</p>`,
        ),
      );
    }
    const name = url.pathname.replace(/^\/run\//, "");
    if (url.pathname.startsWith("/run/") && Object.hasOwn(actions, name)) {
      const result = await actions[name](url);
      return html(200, page(name, pre(result)));
    }
    html(404, page("Not found", ""));
  } catch (error) {
    html(500, page("Failed", pre(error instanceof Error ? error.message : String(error))));
  }
});
server.listen(PORT, () => {
  console.log(`Jira spike listening on port ${PORT}.`);
  console.log(`Point your tunnel for ${ORIGIN} at http://localhost:${PORT}, then open:`);
  console.log(`  ${ORIGIN}/?k=${KEY}`);
  console.log(`Atlassian app callback URL must be: ${ORIGIN}${CALLBACK}`);
});
