import { describe,it,expect } from 'vitest';
import { PRIORITIES, evidenceUrlSchema, mayUpdateStatus, mayVerify, maySeeBug, formatBugCode, reportSchema, NOTES_REQUIRED, type BugActor } from '@/lib/bug-workflow';
import { rolePermissions } from '@/lib/onboarding';
const actor=(role:BugActor['role'],permissions:string[],userId='tester'):BugActor=>({role,permissions,userId,portalId:'portal',name:'Test'});
const bug={status:'RESOLVED' as const,reporterId:'tester',assigneeId:'dev'};
describe('bug portal rules',()=>{
 it('accepts exactly P0 through P5',()=>{expect(PRIORITIES).toEqual(['P0','P1','P2','P3','P4','P5']);expect(reportSchema.safeParse({requestId:'550e8400-e29b-41d4-a716-446655440000',projectId:'550e8400-e29b-41d4-a716-446655440001',description:'Save fails',steps:['Click save'],priority:'P6'}).success).toBe(false);});
 it('allows explicitly granted reporting in each collaborator role',()=>{for(const role of ['tester','developer','qa','other'])expect(rolePermissions[role]).toContain('report');});
 it('only accepts secure Drive evidence URLs',()=>{expect(evidenceUrlSchema.safeParse('https://drive.google.com/file/d/example/view').success).toBe(true);expect(evidenceUrlSchema.safeParse('https://example.com/file').success).toBe(false);expect(evidenceUrlSchema.safeParse('http://drive.google.com/file').success).toBe(false);});
 it('lets an authorized reporter reopen their resolved report',()=>{expect(mayUpdateStatus(actor('reporter',['report']),bug,'REOPENED')).toBe(true);expect(mayUpdateStatus(actor('reporter',['report'],'other'),bug,'REOPENED')).toBe(false);});
 it('does not let developer resolve their fix',()=>{const b={...bug,status:'RECHECK' as const};expect(mayVerify(actor('developer',['verify'],'dev'),b)).toBe(false);expect(mayUpdateStatus(actor('developer',['progress','recheck'],'dev'),b,'RESOLVED')).toBe(false);});
 it('requires authorized independent QA to verify',()=>{const b={...bug,status:'RECHECK' as const};expect(mayVerify(actor('qa',['verify'],'qa'),b)).toBe(true);expect(mayVerify(actor('qa',[],'qa'),b)).toBe(false);expect(mayVerify(actor('qa',['verify'],'dev'),b)).toBe(false);});
 it('enforces assignment ownership on progress',()=>{const b={...bug,status:'ASSIGNED' as const};expect(mayUpdateStatus(actor('developer',['progress'],'dev'),b,'IN_PROGRESS')).toBe(true);expect(mayUpdateStatus(actor('developer',['progress'],'other'),b,'IN_PROGRESS')).toBe(false);});
 it('developer can request a QA retest after fixing',()=>{const b={...bug,status:'IN_PROGRESS' as const};expect(mayUpdateStatus(actor('developer',['recheck'],'dev'),b,'RECHECK')).toBe(true);expect(mayUpdateStatus(actor('developer',['recheck'],'dev'),b,'RESOLVED')).toBe(false);});
 it('developer closes their own assignment as not a bug, duplicate or won’t fix',()=>{const b={...bug,status:'ASSIGNED' as const};for(const to of ['NOT_A_BUG','DUPLICATE','WONT_FIX'] as const){expect(mayUpdateStatus(actor('developer',['disposition'],'dev'),b,to)).toBe(true);expect(mayUpdateStatus(actor('developer',['disposition'],'other'),b,to)).toBe(false);}});
 it('closing a bug needs the disposition permission and written notes',()=>{const b={...bug,status:'IN_PROGRESS' as const};expect(mayUpdateStatus(actor('developer',['progress','recheck'],'dev'),b,'NOT_A_BUG')).toBe(false);expect(NOTES_REQUIRED).toEqual(expect.arrayContaining(['NOT_A_BUG','DUPLICATE','WONT_FIX','RECHECK']));});
 it('allows Admin to revalidate reopened issues',()=>{expect(mayUpdateStatus(actor('admin',[]),{...bug,status:'REOPENED'},'VALIDATING')).toBe(true);});
 it('restricts member visibility to their reports or assignments',()=>{expect(maySeeBug(actor('member',[]),bug)).toBe(true);expect(maySeeBug(actor('member',[],'other'),bug)).toBe(false);});
 it('keeps permanent padded bug IDs',()=>{expect(formatBugCode('23')).toBe('BF-000023');});
});
import { mayEditBug } from '@/lib/bug-workflow';
describe('editing bugs from portals', () => {
  const tester = { userId: 'u1', role: 'tester', permissions: ['view', 'report'] };
  it('reporter can edit own open bug', () => { expect(mayEditBug(tester, { reporterId: 'u1', status: 'NEW', assigneeId: null })).toBe(true); });
  it('cannot edit someone else’s bug', () => { expect(mayEditBug(tester, { reporterId: 'u2', status: 'NEW', assigneeId: null })).toBe(false); });
  it('cannot edit a resolved bug', () => { expect(mayEditBug(tester, { reporterId: 'u1', status: 'RESOLVED', assigneeId: null })).toBe(false); });
  it('admin can edit any bug', () => { expect(mayEditBug({ userId: 'a', role: 'admin', permissions: [] }, { reporterId: 'u2', status: 'RESOLVED', assigneeId: null })).toBe(true); });
  it('assigned developer can edit their bug', () => { expect(mayEditBug({ userId: 'd1', role: 'developer', permissions: [] }, { reporterId: 'u2', status: 'IN_PROGRESS', assigneeId: 'd1' })).toBe(true); });
  it('unassigned developer cannot edit', () => { expect(mayEditBug({ userId: 'd2', role: 'developer', permissions: [] }, { reporterId: 'u2', status: 'IN_PROGRESS', assigneeId: 'd1' })).toBe(false); });
  it('developer cannot edit a resolved bug', () => { expect(mayEditBug({ userId: 'd1', role: 'developer', permissions: [] }, { reporterId: 'u2', status: 'RESOLVED', assigneeId: 'd1' })).toBe(false); });
});
import { cleanOptions, DEFAULT_OPTIONS } from '@/lib/bug-workflow';
describe('dropdown options', () => {
  it('removes duplicates', () => { expect(cleanOptions({ modules: ['A', 'A'], environments: [], devices: [] }).modules).toEqual(['A']); });
  it('falls back to defaults on bad data', () => { expect(cleanOptions({ bad: 1 })).toEqual(DEFAULT_OPTIONS); });
});
describe('read-only all-bugs permission',()=>{it('lets a member with view_all see bugs they did not report',()=>{expect(maySeeBug({userId:'x',role:'developer',permissions:['view','view_all']} as BugActor,{reporterId:'a',assigneeId:null})).toBe(true);expect(maySeeBug({userId:'x',role:'developer',permissions:['view']} as BugActor,{reporterId:'a',assigneeId:null})).toBe(false);});});
describe('minimal bug reports',()=>{
 const report={requestId:'550e8400-e29b-41d4-a716-446655440000',projectId:'550e8400-e29b-41d4-a716-446655440001',description:'Save button fails\nAn error appears.',steps:['Open the form','Click Save']};
 it('requires a description',()=>expect(reportSchema.safeParse({...report,description:''}).success).toBe(false));
 it('requires steps to replicate',()=>expect(reportSchema.safeParse({...report,steps:[]}).success).toBe(false));
 it('derives an omitted title from the report',()=>expect(reportSchema.parse(report).title).toBe('Save button fails'));
 it('preserves supplied details',()=>{const r=reportSchema.parse({...report,title:'Custom title',actual:'Network error',expected:'Saved'});expect([r.title,r.actual,r.expected]).toEqual(['Custom title','Network error','Saved']);});
 it('uses the reported description as actual result but never invents context',()=>{const r=reportSchema.parse(report);expect(r.actual).toBe(report.description);expect([r.module,r.expected,r.environment,r.browserDevice]).toEqual(['','','','']);});
});

import { severityLevel, DEFAULT_SEVERITIES, bugChangeSchema } from '@/lib/bug-workflow';
describe('configurable severities', () => {
  it('colours the default four from most to least severe', () => {
    expect(DEFAULT_SEVERITIES.map(s => severityLevel(s))).toEqual([1, 2, 3, 4]);
  });
  it('spreads longer lists across five colours and treats unknown values as lowest', () => {
    const list = ['Blocker', 'Critical', 'High', 'Medium', 'Low', 'Cosmetic'];
    expect(severityLevel('Blocker', list)).toBe(1);
    expect(severityLevel('Cosmetic', list)).toBe(5);
    expect(severityLevel('Removed', list)).toBe(5);
  });
  it('keeps saved options that predate severities and defaults the list', () => {
    const o = cleanOptions({ modules: ['Login'], environments: [], devices: [] });
    expect(o.modules).toEqual(['Login']);
    expect(o.severities).toEqual(DEFAULT_SEVERITIES);
  });
  it('accepts a severity change request', () => {
    expect(bugChangeSchema.safeParse({ requestId: crypto.randomUUID(), id: '9', version: 'v', action: 'severity', severity: 'Blocker' }).success).toBe(true);
  });
});
