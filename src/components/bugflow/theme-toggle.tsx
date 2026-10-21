import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import { Moon,Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
const ThemeContext=createContext({dark:true,toggle:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}){const [dark,setDark]=useState(true);useEffect(()=>{const stored=localStorage.getItem('bugflow-theme');if(stored)setDark(stored==='dark');},[]);useEffect(()=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.style.colorScheme=dark?'dark':'light';},[dark]);return <ThemeContext.Provider value={{dark,toggle:()=>setDark(v=>{localStorage.setItem('bugflow-theme',v?'light':'dark');return !v;})}}>{children}</ThemeContext.Provider>;}
export function ThemeToggle(){const {dark,toggle}=useContext(ThemeContext);return <Button variant="ghost" size="icon" aria-label={dark?'Switch to light theme':'Switch to dark theme'} title={dark?'Light theme':'Dark theme'} onClick={toggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</Button>;}
