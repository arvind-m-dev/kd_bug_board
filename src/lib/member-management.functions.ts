import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { editMemberSchema,memberActionSchema } from './member-management';
import { portalReadSchema } from './portal-access';
export const getMemberProfile=createServerFn({method:'POST'}).inputValidator((v:unknown)=>z.object({id:z.string().uuid()}).strict().parse(v)).handler(async({data})=>{const s=await import('./member-management.server');const a=await import('./portal-access.server');return a.databaseCall(()=>s.memberProfile(data.id));});
export const saveMemberProfile=createServerFn({method:'POST'}).inputValidator((v:unknown)=>editMemberSchema.parse(v)).handler(async({data})=>{const s=await import('./member-management.server');const a=await import('./portal-access.server');return a.databaseCall(()=>s.editMember(data));});
export const changeMember=createServerFn({method:'POST'}).inputValidator((v:unknown)=>memberActionSchema.parse(v)).handler(async({data})=>{const s=await import('./member-management.server');const a=await import('./portal-access.server');return a.databaseCall(()=>s.memberAction(data));});
export const dismissWelcome=createServerFn({method:'POST'}).inputValidator((v:unknown)=>portalReadSchema.parse(v)).handler(async({data})=>{const s=await import('./member-management.server');const a=await import('./portal-access.server');return a.databaseCall(()=>s.acknowledgeWelcome(data));});
