import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '@/components/bugflow/workspace';
import { pageHead } from '@/lib/bugflow';
import { requireWorkspaceAccess } from '@/lib/admin-route-access';
export const Route = createFileRoute('/admin_/settings_/options')({
 beforeLoad:requireWorkspaceAccess,
 head:()=>pageHead('Options & fields','Options & fields in Futurist Global Bug Board settings.'),
 component:()=> <Workspace view="settings-options"/>
});
