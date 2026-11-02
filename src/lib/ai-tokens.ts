import { z } from "zod";

/** Pure rules for AI (MCP) tokens. A token belongs to one portal — the Admin panel or a member panel — and inherits its access. */
export const AI_TOKEN_PREFIX = "bf_ai_";
/** A token stops working after this many days without use; every use starts the period again. */
export const AI_TOKEN_IDLE_DAYS = 90;
/** Hand-made tokens a member may hold on their own panel (Admin is not limited). */
export const MANUAL_TOKENS_PER_PORTAL = 10;
/** Live claude.ai/ChatGPT (OAuth) connections kept per panel; a new one revokes the oldest beyond this. */
export const OAUTH_TOKENS_PER_PORTAL = 10;
/** Shown as "expires soon" this many days before the end. */
export const AI_TOKEN_WARN_DAYS = 14;
export type AiTokenSource = "manual" | "oauth";
export const aiTokenLabelSchema = z.string().trim().max(60).default("");
/** The portal a new token is for: the Admin panel, or a member portal by its id. */
export const createAiTokenSchema = z
  .object({
    scope: z.union([z.literal("admin"), z.object({ portalId: z.string().uuid() }).strict()]),
    label: aiTokenLabelSchema,
  })
  .strict();
export const revokeAiTokenSchema = z.object({ id: z.string().uuid() }).strict();
/** The portal-side creator: a member makes a token for their own open portal. */
export const portalAiTokenSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    type: z.enum(["reporter", "qa", "developer", "member"]),
    label: aiTokenLabelSchema,
  })
  .strict();

export type AiToken = {
  id: string;
  label: string;
  scopeLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  source: AiTokenSource;
};
/** Whether a token still works, and whether to warn that it is about to lapse. */
export function aiTokenState(
  expiresAt: string,
  now = Date.now(),
): "active" | "expiring" | "expired" {
  const left = Date.parse(expiresAt) - now;
  if (!(left > 0)) return "expired";
  return left <= AI_TOKEN_WARN_DAYS * 86_400_000 ? "expiring" : "active";
}
/** "expired", "expires today" or "expires in N days" for the token list. */
export function aiTokenExpiryLabel(expiresAt: string, now = Date.now()) {
  const left = Date.parse(expiresAt) - now;
  if (!(left > 0)) return "expired";
  const days = Math.floor(left / 86_400_000);
  return days < 1 ? "expires today" : `expires in ${days} ${days === 1 ? "day" : "days"}`;
}
/** Shown once, right after creation: the full secret the person pastes into their AI client. */
export type NewAiToken = { id: string; secret: string; label: string };
/** The value a client sends as the Bearer token: a readable prefix plus the 64-hex secret stored only as a hash. */
export const formatAiToken = (secret: string) => `${AI_TOKEN_PREFIX}${secret}`;
export const parseAiToken = (value: string) => {
  const v = value.trim().startsWith(AI_TOKEN_PREFIX)
    ? value.trim().slice(AI_TOKEN_PREFIX.length)
    : value.trim();
  return /^[a-f0-9]{64}$/.test(v) ? v : null;
};
