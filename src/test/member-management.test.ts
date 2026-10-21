import { describe,it,expect } from 'vitest';
import { memberState,memberActionSchema,editMemberSchema } from '@/lib/member-management';
import { collaboratorSchema } from '@/lib/onboarding';
describe('member lifecycle rules',()=>{
 it('deleted members stay deleted even if activated',()=>expect(memberState(true,true,true)).toBe('Deleted'));
 it('deactivation blocks an otherwise active portal',()=>expect(memberState(false,false,true)).toBe('Deactivated'));
 it('distinguishes revoked links from deactivated people',()=>expect(memberState(false,true,false)).toBe('Revoked / expired'));
 it('permits only defined member actions',()=>{expect(memberActionSchema.safeParse({id:'ad110000-0000-4000-8000-000000000001',action:'delete'}).success).toBe(true);expect(memberActionSchema.safeParse({id:'ad110000-0000-4000-8000-000000000001',action:'admin'}).success).toBe(false);});
 it('cannot grant QA verification to a tester',()=>{expect(collaboratorSchema.safeParse({name:'Tester',email:'test@example.test',role:'tester',scope:'Sandbox',context:'',permissions:['view','verify']}).success).toBe(false);});
 it('requires a real project scope when editing',()=>{expect(editMemberSchema.safeParse({id:'ad110000-0000-4000-8000-000000000001',collaborator:{name:'Tester',email:'test@example.test',role:'tester',scope:'Sandbox',context:'',permissions:['view']},projectIds:[],welcome:''}).success).toBe(false);});
});
