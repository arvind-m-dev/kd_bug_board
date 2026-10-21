import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import { Moon,Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DEFAULT_PALETTE, paletteVars } from '@/lib/appearance';
import { getAppearance } from '@/lib/appearance.functions';

type Theme={dark:boolean;toggle:()=>void;setDark:(d:boolean)=>void;palette:string;setPalette:(id:string)=>void};
const ThemeContext=createContext<Theme>({dark:true,toggle:()=>{},setDark:()=>{},palette:DEFAULT_PALETTE,setPalette:()=>{}});
const read=(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}};
const write=(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{/* storage unavailable */}};

/** Light/dark is personal (this browser); the colour palette is the workspace's and is loaded from the server. */
export function ThemeProvider({children}:{children:ReactNode}){
 const [dark,setDarkState]=useState(true);const [palette,setPaletteState]=useState(DEFAULT_PALETTE);
 useEffect(()=>{const m=read('bugflow-theme');if(m)setDarkState(m==='dark');const p=read('bugflow-palette');if(p)setPaletteState(p);
  getAppearance().then(a=>{setPaletteState(a.palette);write('bugflow-palette',a.palette);}).catch(()=>{/* keep the cached palette */});},[]);
 useEffect(()=>{const d=document.documentElement;d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';for(const [k,v] of Object.entries(paletteVars(palette,dark)))d.style.setProperty(k,v);},[dark,palette]);
 const setDark=(v:boolean)=>{write('bugflow-theme',v?'dark':'light');setDarkState(v);};
 const setPalette=(id:string)=>{write('bugflow-palette',id);setPaletteState(id);};
 return <ThemeContext.Provider value={{dark,toggle:()=>setDark(!dark),setDark,palette,setPalette}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);
export function ThemeToggle(){const {dark,toggle}=useTheme();return <Button variant="ghost" size="icon" aria-label={dark?'Switch to light theme':'Switch to dark theme'} title={dark?'Light theme':'Dark theme'} onClick={toggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</Button>;}
