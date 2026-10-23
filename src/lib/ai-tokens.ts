import { z } from 'zod';

/** Pure rules for AI (MCP) tokens. A token belongs to one portal — the Admin panel or a member panel — and inherits its access. */
export const AI_TOKEN_PREFIX = 'bf_ai_';
export const aiTokenLabelSchema = z.string().trim().max(60).default('');
/** The portal a new token is for: the Admin panel, or a member portal by its id. */
export const createAiTokenSchema = z.object({ scope: z.union([z.literal('admin'), z.object({ portalId: z.string().uuid() }).strict()]), label: aiTokenLabelSchema }).strict();
export const revokeAiTokenSchema = z.object({ id: z.string().uuid() }).strict();
/** The portal-side creator: a member makes a token for their own open portal. */
export const portalAiTokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), type: z.enum(['reporter', 'qa', 'developer', 'member']), label: aiTokenLabelSchema }).strict();

export type AiToken = { id: string; label: string; scopeLabel: string; createdAt: string; lastUsedAt: string | null };
/** Shown once, right after creation: the full secret the person pastes into their AI client. */
export type NewAiToken = { id: string; secret: string; label: string };
/** The value a client sends as the Bearer token: a readable prefix plus the 64-hex secret stored only as a hash. */
export const formatAiToken = (secret: string) => `${AI_TOKEN_PREFIX}${secret}`;
export const parseAiToken = (value: string) => { const v = value.trim().startsWith(AI_TOKEN_PREFIX) ? value.trim().slice(AI_TOKEN_PREFIX.length) : value.trim(); return /^[a-f0-9]{64}$/.test(v) ? v : null; };
