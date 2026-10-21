import { describe, it, expect } from 'vitest';
import { groupCounts, matchesFilter } from '@/lib/bug-workflow';
const counts=[{status:'NEW',assigned:false,count:5},{status:'IN_PROGRESS',assigned:true,count:1},{status:'RESOLVED',assigned:false,count:1},{status:'NOT_A_BUG',assigned:false,count:2}];
describe('dashboard status counts', () => {
  it('group counts add up to the total', () => { const c=groupCounts(counts); expect(c.total).toBe(9); expect(c.groups.reduce((n,g)=>n+g.count,0)).toBe(9); });
  it('resolved and not a bug are counted separately', () => { const c=groupCounts(counts); expect(c.groups.find(g=>g.key==='g:resolved')?.count).toBe(1); expect(c.groups.find(g=>g.key==='g:notbug')?.count).toBe(2); });
  it('assignments view counts only assigned bugs', () => { expect(groupCounts(counts,true).total).toBe(1); });
  it('group filter matches its statuses', () => { expect(matchesFilter('g:progress',{status:'ASSIGNED',assigneeId:'x',reporterId:'y'},'z')).toBe(true); expect(matchesFilter('g:progress',{status:'NEW',assigneeId:null,reporterId:'y'},'z')).toBe(false); });
});
