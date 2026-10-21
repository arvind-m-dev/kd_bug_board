import { createFileRoute } from '@tanstack/react-router';
import { PersonalPortal } from '@/components/bugflow/personal-portal';
import { pageHead } from '@/lib/bugflow';
export const Route=createFileRoute('/developer/$portalToken')({head:()=>pageHead('Developer portal','Private developer bug tracking workspace in Futurist Global Bug Board.'),component:PortalPage});

function PortalPage(){ const {portalToken}=Route.useParams(); return <PersonalPortal type="developer" token={portalToken}/>; }
