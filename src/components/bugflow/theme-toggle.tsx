import { createContext,useContext,useEffect,useMemo,useState,type ReactNode } from 'react';
import { Moon,Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APPEARANCE_CACHE_KEY, DEFAULT_APPEARANCE, FONT_LINK_ID, effectiveAppearance, normalizeAppearance, portalAppearanceSchema, resolveAppearance, type Appearance, type PortalAppearance } from '@/lib/appearance';
import { getAppearance } from '@/lib/appearance.functions';

type Theme={
 dark:boolean;toggle:()=>void;setDark:(d:boolean)=>void;
 /** Saved for the whole workspace by the Admin. */ workspace:Appearance;
 /** This member's own choice on their portal (null = use the workspace theme). */ personal:PortalAppearance|null;
 /** What the page is showing right now (a preview wins while it lasts). */ effective:Appearance;
 setWorkspace:(a:Appearance)=>void;setPersonal:(a:PortalAppearance|null)=>void;
 /** Transient preview while editing; pass null to stop previewing. */ preview:(a:Appearance|null)=>void;previewing:boolean;
 /** True once the client has mounted (decorations render only then, so server and client markup match). */ ready:boolean;
};
const ThemeContext=createContext<Theme>({dark:true,toggle:()=>{},setDark:()=>{},workspace:DEFAULT_APPEARANCE,personal:null,effective:DEFAULT_APPEARANCE,setWorkspace:()=>{},setPersonal:()=>{},preview:()=>{},previewing:false,ready:false});
const read=(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}};
const write=(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{/* storage unavailable */}};
type Cache={workspace?:unknown;personal?:unknown;light?:unknown;dark?:unknown};
const readCache=():Cache=>{try{return JSON.parse(read(APPEARANCE_CACHE_KEY)||'{}') as Cache;}catch{return {};}};

/** Light/dark is personal (this browser). The appearance is the workspace's, optionally overridden by the member on their portal. */
export function ThemeProvider({children}:{children:ReactNode}){
 const [dark,setDarkState]=useState(true);const [ready,setReady]=useState(false);
 const [workspace,setWorkspace]=useState<Appearance>(DEFAULT_APPEARANCE);const [personal,setPersonalState]=useState<PortalAppearance|null>(null);const [draft,setDraft]=useState<Appearance|null>(null);
 useEffect(()=>{
  const m=read('bugflow-theme');if(m)setDarkState(m==='dark');
  // Start from what this browser saw last (the boot script already painted it), then refresh from the server.
  const c=readCache();if(c.workspace)setWorkspace(normalizeAppearance(c.workspace));if(c.personal){const p=portalAppearanceSchema.safeParse(c.personal);if(p.success)setPersonalState(p.data);}
  setReady(true);
  getAppearance().then(a=>setWorkspace(normalizeAppearance(a))).catch(()=>{/* keep the cached appearance */});
 },[]);
 const effective=useMemo(()=>draft??effectiveAppearance(workspace,personal),[draft,workspace,personal]);
 useEffect(()=>{
  const d=document.documentElement;d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';
  const r=resolveAppearance(effective,dark);
  for(const [k,v] of Object.entries(r.vars))d.style.setProperty(k,v);
  for(const [k,v] of Object.entries(r.attrs)){if(v==null)d.removeAttribute(k);else d.setAttribute(k,v);}
  let link=document.getElementById(FONT_LINK_ID) as HTMLLinkElement|null;
  if(!r.fontQuery)link?.remove();else{const href=`https://fonts.googleapis.com/css2?${r.fontQuery}&display=swap`;if(!link){link=document.createElement('link');link.id=FONT_LINK_ID;link.rel='stylesheet';document.head.appendChild(link);}if(link.href!==href)link.href=href;}
  if(!draft)write(APPEARANCE_CACHE_KEY,JSON.stringify({workspace,personal,light:resolveAppearance(effective,false),dark:resolveAppearance(effective,true)}));
 },[dark,effective,draft,workspace,personal]);
 const setDark=(v:boolean)=>{write('bugflow-theme',v?'dark':'light');setDarkState(v);};
 const setPersonal=(a:PortalAppearance|null)=>{setPersonalState(a);setDraft(null);};
 return <ThemeContext.Provider value={{dark,toggle:()=>setDark(!dark),setDark,workspace,personal,effective,setWorkspace:a=>{setWorkspace(a);setDraft(null);},setPersonal,preview:setDraft,previewing:draft!==null,ready}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);
export function ThemeToggle(){const {dark,toggle}=useTheme();return <Button variant="ghost" size="icon" aria-label={dark?'Switch to light theme':'Switch to dark theme'} title={dark?'Light theme':'Dark theme'} onClick={toggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</Button>;}
