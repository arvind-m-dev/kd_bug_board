import { neonQuery,neonExecute } from './neon.server';
import { requireAdmin,checkOrigin,listProjects } from './portal-access.server';
import { decryptPortal,encryptPortal } from './portal-crypto.server';
import { portalTypesByRole,randomToken,hashToken, type portalReadSchema } from './portal-access';
import type { editMemberSchema,memberActionSchema } from './member-management';
import type { PortalAppearance } from './appearance';
import type { z } from 'zod';
export async function memberProfile(id:string){
 await requireAdmin();const {rows}=await neonQuery(`select p.id,p.user_id,p.type,p.active,p.token_ciphertext is not null as copyable,p.welcome_seen_at is not null as welcomed,to_json(p.expires_at) as expires_at,to_json(u.created_at) as created_at,u.name,u.email,u.active as user_active,o.collaborator_role,o.permissions,o.scope_note,o.context,o.welcome,coalesce((select jsonb_agg(pp.project_id) from bugflow.portal_projects pp where pp.portal_id=p.id),'[]'::jsonb) as project_ids,(select count(*) from bugflow.bugs b where b.reporter_id=u.id) as reported,(select count(*) from bugflow.bugs b where b.assignee_id=u.id and b.status not in ('RESOLVED','DUPLICATE','NOT_A_BUG','WONT_FIX')) as assigned from bugflow.portals p join bugflow.users u on u.id=p.user_id join bugflow.portal_onboarding o on o.portal_id=p.id where p.id=$1 and p.type<>'admin' and u.deleted_at is null limit 1`,[id]);const r=rows[0];if(!r)throw new Error('Member profile is unavailable.');return {id:String(r['id']),userId:String(r['user_id']),name:String(r['name']),email:String(r['email']),role:String(r['collaborator_role']) as 'tester'|'developer'|'qa'|'other',type:String(r['type']),active:r['user_active']===true,portalActive:r['active']===true,copyable:r['copyable']===true,welcomed:r['welcomed']===true,expiresAt:r['expires_at']?String(r['expires_at']):'',createdAt:String(r['created_at']),permissions:Array.isArray(r['permissions'])?r['permissions'].map(String):[],projectIds:Array.isArray(r['project_ids'])?r['project_ids'].map(String):[],scope:String(r['scope_note']),context:String(r['context']),welcome:String(r['welcome']),reported:Number(r['reported']),assigned:Number(r['assigned'])};
}
export async function editMember(data:z.infer<typeof editMemberSchema>){
 checkOrigin();const admin=await requireAdmin();const profile=await memberProfile(data.id);const projects=await listProjects();const ids=[...new Set(data.projectIds)];if(ids.some(id=>!projects.some(p=>p.id===id)))throw new Error('Choose active projects.');
 const c=data.collaborator;await neonExecute([
 {query:'select pg_advisory_xact_lock(7438592)'},
 {query:"update bugflow.users set name=$2,email=$3 where id=$1 and deleted_at is null and not exists(select 1 from bugflow.portals ap where ap.user_id=bugflow.users.id and ap.type='admin')",params:[profile.userId,c.name,c.email.toLowerCase()]},
 {query:"update bugflow.portals set type=$2 where id=$1 and type<>'admin'",params:[data.id,portalTypesByRole[c.role]]},
 {query:'update bugflow.portal_onboarding set collaborator_role=$2,permissions=$3::jsonb,scope_note=$4,context=$5,welcome=$6 where portal_id=$1',params:[data.id,c.role,JSON.stringify(c.permissions),projects.filter(p=>ids.includes(p.id)).map(p=>p.name).join(', '),c.context,data.welcome]},
 {query:'delete from bugflow.portal_projects where portal_id=$1',params:[data.id]},
 ...ids.map(projectId=>({query:'insert into bugflow.portal_projects(portal_id,project_id) values($1,$2)',params:[data.id,projectId]})),
 {query:"insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,'member.updated',$3::jsonb)",params:[crypto.randomUUID(),admin.userId,JSON.stringify({portalId:data.id,permissions:c.permissions,projectIds:ids,previousRole:profile.role,role:c.role})]}
 ]);return {saved:true};
}
export async function memberAction(data:z.infer<typeof memberActionSchema>){
 checkOrigin();const admin=await requireAdmin();const profile=await memberProfile(data.id);
 if(data.action==='copy'){
  if(!profile.active)throw new Error('Activate this member before sharing their portal.');const {rows}=await neonQuery("select type,token_ciphertext from bugflow.portals where id=$1 and active and revoked_at is null and (expires_at is null or expires_at>now()) limit 1",[data.id]);const r=rows[0];if(!r)throw new Error('This portal is revoked or expired. Replace the link first.');if(!r['token_ciphertext'])throw new Error('This older link cannot be recovered. Replace it once to enable secure copying.');const token=await decryptPortal(String(r['token_ciphertext'])).catch(()=>null);if(!token)throw new Error('This link was saved with a previous encryption key and cannot be recovered. Use Replace link to issue a new one.');return {path:`/${String(r['type'])}/${token}`};
 }
 await neonExecute([
 {query:'select pg_advisory_xact_lock(7438592)'},
 {query:"update bugflow.users set active=$2,deleted_at=case when $3 then now() else deleted_at end where id=$1 and deleted_at is null and not exists(select 1 from bugflow.portals p where p.user_id=bugflow.users.id and p.type='admin')",params:[profile.userId,data.action==='activate',data.action==='delete']},
 ...(data.action==='delete'?[{query:"update bugflow.portals set active=false,revoked_at=now(),token_ciphertext=null where user_id=$1 and type<>'admin'",params:[profile.userId]}]:[]),
 {query:"insert into bugflow.activity(id,actor_id,action,detail) values($1,$2,$3,$4::jsonb)",params:[crypto.randomUUID(),admin.userId,`member.${data.action}`,JSON.stringify({userId:profile.userId,portalId:data.id,historyPreserved:true})]}
 ]);return {path:''};
}
export async function acknowledgeWelcome(data:z.infer<typeof portalReadSchema>){checkOrigin();const {rows}=await neonExecute(`update bugflow.portals p set welcome_seen_at=coalesce(welcome_seen_at,now()) from bugflow.users u where p.user_id=u.id and p.token_hash=$1 and p.type=$2 and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) returning p.id`,[await hashToken(data.token),data.type]);if(!rows.length)throw new Error('Portal access is unavailable.');return {saved:true};}
/** A member's own appearance on their portal (null = use the workspace theme); refused when the Admin has turned personal themes off. */
export async function savePortalAppearance(data:z.infer<typeof portalReadSchema>&{appearance:PortalAppearance|null}){
 checkOrigin();
 if(data.appearance){const {rows:s}=await neonQuery(`select value->>'membersMayCustomize' as allowed from bugflow.settings where key='appearance'`);if(s[0]?.['allowed']==='false')throw new Error('Your Admin has turned off personal themes for this workspace.');}
 const {rows}=await neonExecute(`update bugflow.portals p set appearance=$3::jsonb from bugflow.users u where p.user_id=u.id and p.token_hash=$1 and p.type=$2 and p.active and u.active and u.deleted_at is null and p.revoked_at is null and (p.expires_at is null or p.expires_at>now()) returning p.id`,[await hashToken(data.token),data.type,data.appearance?JSON.stringify(data.appearance):null]);
 if(!rows.length)throw new Error('Portal access is unavailable.');return {saved:true};
}
