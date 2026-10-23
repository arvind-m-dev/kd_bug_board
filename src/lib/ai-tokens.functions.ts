import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { createAiTokenSchema, portalAiTokenSchema, revokeAiTokenSchema } from './ai-tokens';

const run = async <T>(work: (s: typeof import('./ai-tokens.server')) => Promise<T>) => { const s = await import('./ai-tokens.server'); const a = await import('./portal-access.server'); return a.databaseCall(() => work(s)); };
export const createAiToken = createServerFn({ method: 'POST' }).validator((v: unknown) => createAiTokenSchema.parse(v)).handler(({ data }) => run(s => s.createAiToken(data)));
export const getAiTokens = createServerFn({ method: 'GET' }).handler(() => run(s => s.listAiTokens()));
export const revokeAiToken = createServerFn({ method: 'POST' }).validator((v: unknown) => revokeAiTokenSchema.parse(v)).handler(({ data }) => run(s => s.revokeAiToken(data)));
const portalRead = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), type: z.enum(['reporter', 'qa', 'developer', 'member']) }).strict();
export const createPortalAiToken = createServerFn({ method: 'POST' }).validator((v: unknown) => portalAiTokenSchema.parse(v)).handler(({ data }) => run(s => s.createPortalAiToken(data)));
export const getPortalAiTokens = createServerFn({ method: 'POST' }).validator((v: unknown) => portalRead.parse(v)).handler(({ data }) => run(s => s.listPortalAiTokens(data)));
export const revokePortalAiToken = createServerFn({ method: 'POST' }).validator((v: unknown) => portalRead.extend({ id: z.string().uuid() }).strict().parse(v)).handler(({ data }) => run(s => s.revokePortalAiToken(data)));
