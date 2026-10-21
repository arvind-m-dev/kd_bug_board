import { describe, it, expect } from 'vitest';
import { portalTypesByRole, saveMemberSchema, portalReadSchema, unlockSchema, equalSecret, randomToken, hashToken } from '@/lib/portal-access';

describe('Unique role-scoped portals',()=>{
 it('requires only email and password for Admin sign-in',()=>{expect(unlockSchema.safeParse({email:'Admin.bug.tracker@Fg.com',password:'example-password'}).success).toBe(true);expect(unlockSchema.safeParse({email:'Admin.bug.tracker@Fg.com'}).success).toBe(false);expect(unlockSchema.safeParse({email:'Admin.bug.tracker@Fg.com',password:'example-password',name:'Admin'}).success).toBe(false);});
 it('maps every collaborator to their own role portal',()=>expect(portalTypesByRole).toEqual({tester:'reporter',developer:'developer',qa:'qa',other:'member'}));
 it('rejects saving a portal without actual project scope',()=>expect(saveMemberSchema.safeParse({collaborator:{name:'QA',email:'qa@example.test',role:'qa',scope:'Project',context:'',permissions:['verify']},projectIds:[],welcome:''}).success).toBe(false));
 it('rejects granting developers QA verification when saving',()=>expect(saveMemberSchema.safeParse({collaborator:{name:'Dev',email:'dev@example.test',role:'developer',scope:'Project',context:'',permissions:['verify']},projectIds:['550e8400-e29b-41d4-a716-446655440000'],welcome:''}).success).toBe(false));
 it('does not accept Admin as a member portal type',()=>expect(portalReadSchema.safeParse({token:'a'.repeat(64),type:'admin'}).success).toBe(false));
 it('issues distinct unpredictable tokens and stores only digests',async()=>{const a=randomToken();const b=randomToken();expect(a).not.toBe(b);expect(await hashToken(a)).not.toBe(a);});
 it('rejects incorrect owner keys',async()=>{expect(await equalSecret('correct-example-key','incorrect-example-key')).toBe(false);expect(await equalSecret('correct-example-key','correct-example-key')).toBe(true);});
});