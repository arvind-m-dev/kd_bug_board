import { neonQuery, neonExecute } from "./neon.server";
import { checkOrigin, requireAdmin } from "./portal-access.server";
import { hashToken, randomToken } from "./portal-access";
import {
  formatAiToken,
  type AiToken,
  type NewAiToken,
  type createAiTokenSchema,
  type portalAiTokenSchema,
  type revokeAiTokenSchema,
} from "./ai-tokens";
import type { z } from "zod";

const toToken = (r: Record<string, unknown>): AiToken => ({
  id: String(r["id"]),
  label: String(r["label"] ?? ""),
  scopeLabel:
    r["scope_type"] === "admin"
      ? "Admin panel"
      : `${String(r["member_name"] ?? "Member")} · ${String(r["scope_type"])} panel`,
  createdAt: String(r["created_iso"]),
  lastUsedAt: r["last_used_iso"] ? String(r["last_used_iso"]) : null,
});
const COLUMNS = `t.id,t.label,to_json(t.created_at) as created_iso,to_json(t.last_used_at) as last_used_iso,p.type as scope_type,u.name as member_name`;

/** Issues a token for a portal and returns the secret once. The caller (requireAdmin or the member's own portal) must have proven access to that portal. */
async function issueToken(portalId: string, label: string, createdBy: string): Promise<NewAiToken> {
  const secret = randomToken();
  const id = crypto.randomUUID();
  await neonExecute(
    `insert into bugflow.ai_tokens(id,portal_id,token_hash,label,created_by) values($1,$2,$3,$4,$5)`,
    [id, portalId, await hashToken(secret), label.trim().slice(0, 60), createdBy],
  );
  return { id, secret: formatAiToken(secret), label: label.trim().slice(0, 60) };
}

/** Admin: create a token for the Admin panel or any member portal. */
export async function createAiToken(
  data: z.infer<typeof createAiTokenSchema>,
): Promise<NewAiToken> {
  checkOrigin();
  const admin = await requireAdmin();
  if (data.scope === "admin") {
    const { rows } = await neonQuery(
      `select id from bugflow.portals where type='admin' and user_id=$1 and active and revoked_at is null limit 1`,
      [admin.userId],
    );
    const portalId = rows[0]?.["id"];
    if (!portalId) throw new Error("Admin portal not found.");
    return issueToken(String(portalId), data.label, admin.userId);
  }
  const { rows } = await neonQuery(
    `select id from bugflow.portals where id=$1 and type<>'admin' and active and revoked_at is null limit 1`,
    [data.scope.portalId],
  );
  if (!rows.length) throw new Error("That member portal is not available.");
  return issueToken(data.scope.portalId, data.label, admin.userId);
}

/** Admin: every live token, newest first, with its scope and last use. */
export async function listAiTokens(): Promise<AiToken[]> {
  await requireAdmin();
  const { rows } = await neonQuery(
    `select ${COLUMNS} from bugflow.ai_tokens t join bugflow.portals p on p.id=t.portal_id join bugflow.users u on u.id=p.user_id where t.revoked_at is null order by t.created_at desc limit 200`,
  );
  return rows.map(toToken);
}

/** Admin: revoke one token immediately. */
export async function revokeAiToken(data: z.infer<typeof revokeAiTokenSchema>) {
  checkOrigin();
  await requireAdmin();
  const { rows } = await neonExecute(
    `update bugflow.ai_tokens set revoked_at=now() where id=$1 and revoked_at is null returning id`,
    [data.id],
  );
  if (!rows.length) throw new Error("This token was already revoked.");
  return { revoked: true };
}

/** A member creates or lists tokens for their own open portal (proven by the portal token). */
async function portalId(token: string, type: string) {
  const { rows } = await neonQuery(
    `select p.id,p.user_id from bugflow.portals p join bugflow.users u on u.id=p.user_id where p.token_hash=$1 and p.type=$2 and p.active and u.active and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) limit 1`,
    [await hashToken(token), type],
  );
  const r = rows[0];
  if (!r) throw new Error("This portal link has expired or been revoked.");
  return { id: String(r["id"]), userId: String(r["user_id"]) };
}
export async function createPortalAiToken(
  data: z.infer<typeof portalAiTokenSchema>,
): Promise<NewAiToken> {
  checkOrigin();
  const p = await portalId(data.token, data.type);
  const { rows } = await neonQuery(
    `select count(*)::int as n from bugflow.ai_tokens where portal_id=$1 and revoked_at is null`,
    [p.id],
  );
  if (Number(rows[0]?.["n"] ?? 0) >= 10)
    throw new Error("This panel already has 10 AI tokens. Revoke one first.");
  return issueToken(p.id, data.label, p.userId);
}
export async function listPortalAiTokens(data: {
  token: string;
  type: string;
}): Promise<AiToken[]> {
  const p = await portalId(data.token, data.type);
  const { rows } = await neonQuery(
    `select ${COLUMNS} from bugflow.ai_tokens t join bugflow.portals p on p.id=t.portal_id join bugflow.users u on u.id=p.user_id where t.portal_id=$1 and t.revoked_at is null order by t.created_at desc limit 50`,
    [p.id],
  );
  return rows.map(toToken);
}
export async function revokePortalAiToken(data: { token: string; type: string; id: string }) {
  checkOrigin();
  const p = await portalId(data.token, data.type);
  const { rows } = await neonExecute(
    `update bugflow.ai_tokens set revoked_at=now() where id=$1 and portal_id=$2 and revoked_at is null returning id`,
    [data.id, p.id],
  );
  if (!rows.length) throw new Error("This token was already revoked.");
  return { revoked: true };
}
