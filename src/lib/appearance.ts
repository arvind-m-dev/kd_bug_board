import { z } from 'zod';

/**
 * Brand palettes. Each sets only the brand tokens (primary, its text colour, the partner colour and the
 * soft accent) for light and dark mode. Status and chart colours stay fixed so their meaning never changes.
 */
export type PaletteTokens = { primary: string; primaryForeground: string; brand2: string; accent: string };
export type Palette = { id: string; name: string; description: string; light: PaletteTokens; dark: PaletteTokens };

export const PALETTES: Palette[] = [
  { id: 'teal', name: 'Futurist Teal', description: 'Calm teal with an indigo partner — the original look.',
    light: { primary: 'oklch(0.5 0.1 192)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.53 0.17 275)', accent: 'oklch(0.945 0.035 192)' },
    dark: { primary: 'oklch(0.8 0.125 187)', primaryForeground: 'oklch(0.18 0.03 200)', brand2: 'oklch(0.72 0.15 280)', accent: 'oklch(0.3 0.055 192)' } },
  { id: 'ocean', name: 'Ocean Blue', description: 'Trustworthy corporate blue with a cyan partner.',
    light: { primary: 'oklch(0.5 0.16 255)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.58 0.12 215)', accent: 'oklch(0.95 0.03 255)' },
    dark: { primary: 'oklch(0.75 0.13 250)', primaryForeground: 'oklch(0.17 0.03 255)', brand2: 'oklch(0.78 0.11 210)', accent: 'oklch(0.31 0.06 252)' } },
  { id: 'indigo', name: 'Royal Indigo', description: 'Rich indigo with a magenta partner — confident and modern.',
    light: { primary: 'oklch(0.5 0.2 278)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.56 0.2 325)', accent: 'oklch(0.95 0.035 278)' },
    dark: { primary: 'oklch(0.75 0.15 280)', primaryForeground: 'oklch(0.18 0.04 280)', brand2: 'oklch(0.75 0.16 325)', accent: 'oklch(0.31 0.07 280)' } },
  { id: 'emerald', name: 'Emerald', description: 'Fresh green with a sea-blue partner — clean and positive.',
    light: { primary: 'oklch(0.5 0.12 158)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.52 0.11 205)', accent: 'oklch(0.95 0.04 158)' },
    dark: { primary: 'oklch(0.79 0.15 158)', primaryForeground: 'oklch(0.18 0.04 160)', brand2: 'oklch(0.78 0.11 205)', accent: 'oklch(0.3 0.06 158)' } },
  { id: 'copper', name: 'Copper', description: 'Warm copper with a crimson partner — energetic and bold.',
    light: { primary: 'oklch(0.5 0.14 45)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.52 0.18 15)', accent: 'oklch(0.955 0.035 55)' },
    dark: { primary: 'oklch(0.8 0.14 60)', primaryForeground: 'oklch(0.2 0.04 55)', brand2: 'oklch(0.74 0.15 20)', accent: 'oklch(0.32 0.06 55)' } },
  { id: 'rose', name: 'Rose', description: 'Elegant rose with a violet partner.',
    light: { primary: 'oklch(0.5 0.18 5)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.5 0.16 300)', accent: 'oklch(0.955 0.03 5)' },
    dark: { primary: 'oklch(0.76 0.15 5)', primaryForeground: 'oklch(0.19 0.04 5)', brand2: 'oklch(0.74 0.14 300)', accent: 'oklch(0.31 0.07 5)' } },
  { id: 'graphite', name: 'Graphite', description: 'Minimal monochrome with a blue partner — quiet and focused.',
    light: { primary: 'oklch(0.32 0.02 260)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.5 0.14 255)', accent: 'oklch(0.94 0.01 260)' },
    dark: { primary: 'oklch(0.9 0.01 260)', primaryForeground: 'oklch(0.2 0.02 260)', brand2: 'oklch(0.74 0.13 255)', accent: 'oklch(0.3 0.015 260)' } },
];
export const DEFAULT_PALETTE = 'teal';
export const paletteById = (id: string | null | undefined) => PALETTES.find(p => p.id === id) ?? PALETTES[0]!;
export const appearanceSchema = z.object({ palette: z.enum(PALETTES.map(p => p.id) as [string, ...string[]]) }).strict();

/** CSS custom properties for a palette in the given mode. */
export function paletteVars(id: string, dark: boolean): Record<string, string> {
  const t = paletteById(id)[dark ? 'dark' : 'light'];
  return { '--primary': t.primary, '--primary-foreground': t.primaryForeground, '--brand-2': t.brand2, '--accent': t.accent };
}

/** Runs before the page paints: applies the saved mode and palette so there's no flash of the default colours. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var m=localStorage.getItem('bugflow-theme');var dark=m?m==='dark':true;d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';var P=${JSON.stringify(Object.fromEntries(PALETTES.map(p => [p.id, { l: p.light, d: p.dark }])))};var p=P[localStorage.getItem('bugflow-palette')||''];if(!p)return;var t=dark?p.d:p.l;d.style.setProperty('--primary',t.primary);d.style.setProperty('--primary-foreground',t.primaryForeground);d.style.setProperty('--brand-2',t.brand2);d.style.setProperty('--accent',t.accent);}catch(e){}})();`;
