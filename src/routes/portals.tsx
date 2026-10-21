import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '@/components/bugflow/workspace';
import { pageHead } from '@/lib/bugflow';
import { requireWorkspaceAccess } from '@/lib/admin-route-access';
export const Route = createFileRoute('/portals')({
 beforeLoad:requireWorkspaceAccess,
 head:()=>pageHead('Member portals','Member portals in Futurist Global Bug Board: manual QA, scoped bug tracking and collaboration.'),
 validateSearch:(s:Record<string,unknown>):{filter?:string|undefined;severity?:string|undefined}=>({filter:typeof s['filter']==='string'?s['filter']:undefined,severity:typeof s['severity']==='string'?s['severity']:undefined}),
 component:()=> <Workspace view="portals"/>
});
