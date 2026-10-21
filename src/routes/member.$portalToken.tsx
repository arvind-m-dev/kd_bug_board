import { createFileRoute } from '@tanstack/react-router';
import { PersonalPortal } from '@/components/bugflow/personal-portal';
import { pageHead } from '@/lib/bugflow';
export const Route=createFileRoute('/member/$portalToken')({head:()=>pageHead('Member portal','Private member bug tracking workspace in Futurist Global Bug Board.'),component:PortalPage});

function PortalPage(){ const {portalToken}=Route.useParams(); return <PersonalPortal type="member" token={portalToken}/>; }
