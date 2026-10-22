import { z } from 'zod';
import { brandTokens } from './color';

/**
 * Appearance = colour palette (or a custom accent) + style (skin) + fonts + shape + motion + what to hide.
 * The Admin saves one for the workspace (bugflow.settings 'appearance'); a member may save their own on their
 * portal. Light/dark stays per browser. Status, severity and priority colours keep their meaning in every theme.
 */
export type PaletteTokens = { primary: string; primaryForeground: string; brand2: string; accent: string };
export type Palette = { id: string; name: string; description: string; light: PaletteTokens; dark: PaletteTokens };

export const PALETTES: Palette[] = [
  { id: 'teal', name: 'Futurist Teal', description: 'Calm teal with an indigo partner — the original look.',
    light: { primary: 'oklch(0.5 0.1 192)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.53 0.17 275)', accent: 'oklch(0.945 0.035 192)' },
    dark: { primary: 'oklch(0.8 0.125 187)', primaryForeground: 'oklch(0.18 0.03 200)', brand2: 'oklch(0.72 0.15 280)', accent: 'oklch(0.3 0.055 192)' } },
  { id: 'keydemand', name: 'Keydemand', description: 'Petrol teal with a soft gold partner — the Keydemand brand.',
    light: { primary: 'oklch(0.4 0.07 215)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.62 0.12 85)', accent: 'oklch(0.94 0.02 215)' },
    dark: { primary: 'oklch(0.8 0.08 205)', primaryForeground: 'oklch(0.2 0.04 215)', brand2: 'oklch(0.82 0.13 88)', accent: 'oklch(0.3 0.05 215)' } },
  { id: 'ocean', name: 'Ocean Blue', description: 'Trustworthy corporate blue with a cyan partner.',
    light: { primary: 'oklch(0.5 0.16 255)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.58 0.12 215)', accent: 'oklch(0.95 0.03 255)' },
    dark: { primary: 'oklch(0.75 0.13 250)', primaryForeground: 'oklch(0.17 0.03 255)', brand2: 'oklch(0.78 0.11 210)', accent: 'oklch(0.31 0.06 252)' } },
  { id: 'indigo', name: 'Royal Indigo', description: 'Rich indigo with a magenta partner — confident and modern.',
    light: { primary: 'oklch(0.5 0.2 278)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.56 0.2 325)', accent: 'oklch(0.95 0.035 278)' },
    dark: { primary: 'oklch(0.75 0.15 280)', primaryForeground: 'oklch(0.18 0.04 280)', brand2: 'oklch(0.75 0.16 325)', accent: 'oklch(0.31 0.07 280)' } },
  { id: 'emerald', name: 'Emerald', description: 'Fresh green with a sea-blue partner — clean and positive.',
    light: { primary: 'oklch(0.5 0.12 158)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.52 0.11 205)', accent: 'oklch(0.95 0.04 158)' },
    dark: { primary: 'oklch(0.79 0.15 158)', primaryForeground: 'oklch(0.18 0.04 160)', brand2: 'oklch(0.78 0.11 205)', accent: 'oklch(0.3 0.06 158)' } },
  { id: 'forest', name: 'Forest', description: 'Deep green with an amber partner — grounded and calm.',
    light: { primary: 'oklch(0.42 0.1 150)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.62 0.14 75)', accent: 'oklch(0.945 0.035 150)' },
    dark: { primary: 'oklch(0.78 0.13 150)', primaryForeground: 'oklch(0.18 0.04 150)', brand2: 'oklch(0.84 0.13 80)', accent: 'oklch(0.3 0.05 150)' } },
  { id: 'copper', name: 'Copper', description: 'Warm copper with a crimson partner — energetic and bold.',
    light: { primary: 'oklch(0.5 0.14 45)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.52 0.18 15)', accent: 'oklch(0.955 0.035 55)' },
    dark: { primary: 'oklch(0.8 0.14 60)', primaryForeground: 'oklch(0.2 0.04 55)', brand2: 'oklch(0.74 0.15 20)', accent: 'oklch(0.32 0.06 55)' } },
  { id: 'pumpkin', name: 'Pumpkin', description: 'Bright orange with a violet partner — Halloween’s own.',
    light: { primary: 'oklch(0.6 0.17 50)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.5 0.2 300)', accent: 'oklch(0.95 0.04 60)' },
    dark: { primary: 'oklch(0.78 0.16 55)', primaryForeground: 'oklch(0.2 0.05 50)', brand2: 'oklch(0.75 0.16 300)', accent: 'oklch(0.33 0.07 300)' } },
  { id: 'holly', name: 'Holly', description: 'Berry red with a fir-green partner — Christmas’s own.',
    light: { primary: 'oklch(0.5 0.19 25)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.45 0.11 150)', accent: 'oklch(0.95 0.03 150)' },
    dark: { primary: 'oklch(0.72 0.17 25)', primaryForeground: 'oklch(0.2 0.05 25)', brand2: 'oklch(0.78 0.13 150)', accent: 'oklch(0.3 0.05 150)' } },
  { id: 'sunset', name: 'Sunset', description: 'Bright orange with a pink partner — friendly and warm.',
    light: { primary: 'oklch(0.56 0.17 40)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.6 0.2 350)', accent: 'oklch(0.955 0.035 45)' },
    dark: { primary: 'oklch(0.8 0.14 50)', primaryForeground: 'oklch(0.2 0.04 45)', brand2: 'oklch(0.76 0.16 350)', accent: 'oklch(0.32 0.06 45)' } },
  { id: 'rose', name: 'Rose', description: 'Elegant rose with a violet partner.',
    light: { primary: 'oklch(0.5 0.18 5)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.5 0.16 300)', accent: 'oklch(0.955 0.03 5)' },
    dark: { primary: 'oklch(0.76 0.15 5)', primaryForeground: 'oklch(0.19 0.04 5)', brand2: 'oklch(0.74 0.14 300)', accent: 'oklch(0.31 0.07 5)' } },
  { id: 'sand', name: 'Sand & Navy', description: 'Warm sand with a navy partner — editorial and clear.',
    light: { primary: 'oklch(0.36 0.07 255)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.62 0.1 70)', accent: 'oklch(0.95 0.025 80)' },
    dark: { primary: 'oklch(0.82 0.08 80)', primaryForeground: 'oklch(0.2 0.03 80)', brand2: 'oklch(0.74 0.1 250)', accent: 'oklch(0.3 0.03 80)' } },
  { id: 'graphite', name: 'Graphite', description: 'Minimal monochrome with a blue partner — quiet and focused.',
    light: { primary: 'oklch(0.32 0.02 260)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.5 0.14 255)', accent: 'oklch(0.94 0.01 260)' },
    dark: { primary: 'oklch(0.9 0.01 260)', primaryForeground: 'oklch(0.2 0.02 260)', brand2: 'oklch(0.74 0.13 255)', accent: 'oklch(0.3 0.015 260)' } },
];
export const DEFAULT_PALETTE = 'teal';
export const paletteById = (id: string | null | undefined) => PALETTES.find(p => p.id === id) ?? PALETTES[0]!;

/** Font pairings (all on Google Fonts). 'query' is the css2 family part; empty means the root page already loads it. */
export type FontPair = { id: string; name: string; heading: string; body: string; query: string; note: string };
export const FONTS: FontPair[] = [
  { id: 'dm', name: 'Manrope & DM Sans', heading: 'Manrope', body: 'DM Sans', query: '', note: 'The default — friendly and clear' },
  { id: 'jakarta', name: 'Plus Jakarta Sans & Figtree', heading: 'Plus Jakarta Sans', body: 'Figtree', query: 'family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Figtree:wght@400;500;600', note: 'Geometric headings, humanist body' },
  { id: 'inter', name: 'Inter', heading: 'Inter', body: 'Inter', query: 'family=Inter:wght@400;500;600;700', note: 'Neutral and compact' },
  { id: 'plex', name: 'IBM Plex Sans', heading: 'IBM Plex Sans', body: 'IBM Plex Sans', query: 'family=IBM+Plex+Sans:wght@400;500;600;700', note: 'Technical and precise' },
  { id: 'grotesk', name: 'Space Grotesk & Inter', heading: 'Space Grotesk', body: 'Inter', query: 'family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600', note: 'Modern with character' },
  { id: 'nunito', name: 'Nunito', heading: 'Nunito', body: 'Nunito', query: 'family=Nunito:wght@400;600;700;800', note: 'Soft and rounded' },
  { id: 'serif', name: 'Source Serif & Source Sans', heading: 'Source Serif 4', body: 'Source Sans 3', query: 'family=Source+Serif+4:wght@600;700&family=Source+Sans+3:wght@400;600', note: 'Editorial' },
  { id: 'hand', name: 'Caveat & Patrick Hand', heading: 'Caveat', body: 'Patrick Hand', query: '', note: 'Handwritten — pencil sketch' },
  { id: 'ink', name: 'Architects Daughter & Patrick Hand', heading: 'Architects Daughter', body: 'Patrick Hand', query: 'family=Architects+Daughter', note: 'Pen lettering — ink' },
  { id: 'spooky', name: 'Creepster & Nunito', heading: 'Creepster', body: 'Nunito', query: 'family=Creepster&family=Nunito:wght@400;600;700', note: 'Halloween' },
  { id: 'festive', name: 'Mountains of Christmas & Nunito', heading: 'Mountains of Christmas', body: 'Nunito', query: 'family=Mountains+of+Christmas:wght@700&family=Nunito:wght@400;600;700', note: 'Winter' },
  { id: 'mono', name: 'Share Tech Mono & IBM Plex Sans', heading: 'Share Tech Mono', body: 'IBM Plex Sans', query: 'family=Share+Tech+Mono&family=IBM+Plex+Sans:wght@400;500;600', note: 'Terminal' },
];
export const fontById = (id: string | null | undefined) => FONTS.find(f => f.id === id) ?? FONTS[0]!;

/** Styles (skins): a CSS layer keyed on html[data-skin] that restyles surfaces, lines and decorations. */
export type Style = { id: string; name: string; description: string; fonts: string; palette?: string; monochrome?: boolean; decorated?: boolean };
export const STYLES: Style[] = [
  { id: 'none', name: 'Standard', description: 'Clean cards, soft shadows and crisp type.', fonts: 'dm' },
  { id: 'keydemand', name: 'Keydemand', description: 'White cards on cool grey, teal pills and gold counts — the Keydemand product look.', fonts: 'jakarta', palette: 'keydemand' },
  { id: 'sketch', name: 'Pencil sketch', description: 'Graphite on paper with hand-drawn lines; a chalkboard in dark mode.', fonts: 'hand', palette: 'graphite' },
  { id: 'ink', name: 'Ink', description: 'Only black and white — pen-and-ink outlines and hatching; scratchboard in dark mode.', fonts: 'ink', palette: 'graphite', monochrome: true },
  { id: 'halloween', name: 'Halloween', description: '3D beetles explore cards and tables, spiders descend on silk, and bats fly from a twisted tree and return to roost.', fonts: 'spooky', palette: 'pumpkin', decorated: true },
  { id: 'winter', name: 'Winter', description: 'Snow-covered 3D firs and six-point snowflakes that bounce off cards and table edges.', fonts: 'festive', palette: 'ocean', decorated: true },
  { id: 'christmas', name: 'Christmas', description: '3D Christmas trees, golden stars, Santa’s sleigh and galloping reindeer, with snow that bounces on your workspace.', fonts: 'festive', palette: 'holly', decorated: true },
  { id: 'autumn', name: 'Autumn', description: 'A sculpted copper canopy sways in the breeze as leaves tumble across your workspace.', fonts: 'serif', palette: 'copper', decorated: true },
  { id: 'terminal', name: 'Terminal', description: 'Phosphor green on black with scanlines and a mono face.', fonts: 'mono', palette: 'emerald', decorated: true },
];
export const styleById = (id: string | null | undefined) => STYLES.find(s => s.id === id) ?? STYLES[0]!;
/** Legacy: 'sketch' used to be a palette; it is a style now. */
export const skinOf = (id: string | null | undefined) => (id === 'sketch' ? 'sketch' : null);

/** Things the Admin (or a member, for themselves) can hide. */
export const HIDEABLE: { key: string; label: string; hint: string }[] = [
  { key: 'subtitle', label: 'Page subtitles', hint: 'The line under each page title' },
  { key: 'breadcrumb', label: 'Breadcrumb', hint: 'Workspace › Page in the top bar' },
  { key: 'footer', label: 'Footer', hint: 'Brand line at the bottom of pages' },
  { key: 'counts', label: 'Sidebar counts', hint: 'Numbers next to All bugs, Assignments, Team' },
  { key: 'statusCards', label: 'Status & focus cards', hint: 'The card row above bug tables' },
  { key: 'summary', label: 'Summary column', hint: 'Description excerpt in the bug table' },
  { key: 'activity', label: 'Last activity column', hint: 'Who changed a bug last' },
  { key: 'attention', label: 'Needs-attention panel', hint: 'On the Overview' },
  { key: 'pipeline', label: 'Bug pipeline panel', hint: 'On the Overview' },
  { key: 'hero', label: 'Portal greeting', hint: 'The “Hi …” card on member portals' },
  { key: 'clock', label: 'Live clock', hint: 'Date and time in portal top bars' },
  { key: 'presence', label: 'Online dots & last seen', hint: 'Presence next to names' },
  { key: 'help', label: 'Help links', hint: 'Help & support and How it works' },
];
export const HIDE_KEYS = HIDEABLE.map(h => h.key) as [string, ...string[]];
export const MINIMAL_HIDE = ['subtitle', 'breadcrumb', 'footer', 'counts', 'clock', 'presence', 'help', 'hero'];

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const ids = <T extends { id: string }>(list: T[]) => list.map(x => x.id) as [string, ...string[]];
/**
 * Scene knobs for decorated styles, saved with the theme. Halloween uses all of them; snow and leaf styles use amount, speed and randomness.
 * Placements come from a seeded generator, so a theme looks the same on every device until Shuffle picks a new seed.
 */
export const sceneSchema = z.object({
  amount: z.number().min(0).max(2).default(1), bats: z.number().int().min(0).max(12).default(7), bugs: z.number().int().min(0).max(10).default(5), bugSize: z.number().min(0.5).max(2).default(1),
  spiders: z.number().int().min(0).max(4).default(2), webs: z.number().int().min(0).max(3).default(2), pumpkins: z.number().int().min(0).max(5).default(3),
  speed: z.number().min(0.5).max(2).default(1), randomness: z.number().min(0).max(1).default(0.5), seed: z.number().int().min(0).max(9999).default(7),
}).strict();
export type Scene = z.infer<typeof sceneSchema>;
export const DEFAULT_SCENE: Scene = sceneSchema.parse({});
/** A small seeded generator (LCG): the same seed always gives the same sequence. */
export function seededRandom(seed: number) { let s = ((seed * 9301 + 49297) % 233280) || 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
/** Position i of n: an even spread mixed with a seeded random value by the randomness knob (0 = evenly spaced, 1 = anywhere). */
export const spread = (rand: () => number, i: number, n: number, randomness: number) => { const even = n <= 1 ? 0.5 : i / (n - 1); const r = rand(); return even * (1 - randomness) + r * randomness; };
export const appearanceSchema = z.object({
  palette: z.enum([...ids(PALETTES), 'custom']).default(DEFAULT_PALETTE),
  accent: hex.nullable().default(null),
  partner: hex.nullable().default(null),
  style: z.enum(ids(STYLES)).default('none'),
  fonts: z.enum(ids(FONTS)).nullable().default(null),
  radius: z.enum(['sharp', 'soft', 'round']).default('soft'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  motion: z.enum(['off', 'subtle', 'lively']).default('subtle'),
  hide: z.array(z.enum(HIDE_KEYS)).max(20).default([]),
  membersMayCustomize: z.boolean().default(true),
  scene: sceneSchema.default(() => sceneSchema.parse({})),
}).strict();
export type Appearance = z.infer<typeof appearanceSchema>;
/** What a member may save for themselves (never the workspace-level switch). */
export const portalAppearanceSchema = appearanceSchema.omit({ membersMayCustomize: true }).strict();
export type PortalAppearance = z.infer<typeof portalAppearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = appearanceSchema.parse({});

/** Parses a stored value, including the old {palette:'sketch'} rows, and never throws. */
export function normalizeAppearance(raw: unknown): Appearance {
  const v = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  if (v['palette'] === 'sketch') { v['palette'] = 'graphite'; v['style'] = v['style'] ?? 'sketch'; }
  const r = appearanceSchema.safeParse(v);
  return r.success ? r.data : DEFAULT_APPEARANCE;
}

/** The member's own appearance, if any, over the workspace one; the workspace switch is never overridable. */
export function effectiveAppearance(workspace: Appearance, personal: PortalAppearance | null): Appearance {
  if (!personal || !workspace.membersMayCustomize) return workspace;
  return { ...workspace, ...personal, membersMayCustomize: workspace.membersMayCustomize };
}

const INK = {
  light: { primary: 'oklch(0 0 0)', primaryForeground: 'oklch(1 0 0)', brand2: 'oklch(0.35 0 0)', accent: 'oklch(0.93 0 0)' },
  dark: { primary: 'oklch(1 0 0)', primaryForeground: 'oklch(0 0 0)', brand2: 'oklch(0.8 0 0)', accent: 'oklch(0.25 0 0)' },
};

export type Resolved = { vars: Record<string, string>; attrs: Record<string, string | null>; fontQuery: string };
/** Everything the page needs for one mode: CSS variables, html data-attributes and the Google Fonts query. */
export function resolveAppearance(a: Appearance, dark: boolean): Resolved {
  const style = styleById(a.style); const mode = dark ? 'dark' : 'light';
  const tokens: PaletteTokens = style.monochrome ? INK[mode]
    : a.palette === 'custom' && a.accent ? brandTokens(a.accent, a.partner, dark)
    : paletteById(a.palette === 'custom' ? style.palette ?? DEFAULT_PALETTE : a.palette)[mode];
  const fonts = fontById(a.fonts ?? style.fonts);
  return {
    vars: { '--primary': tokens.primary, '--primary-foreground': tokens.primaryForeground, '--brand-2': tokens.brand2, '--accent': tokens.accent, '--font-sans': `'${fonts.body}', 'DM Sans', sans-serif`, '--font-heading': `'${fonts.heading}', 'Manrope', sans-serif` },
    attrs: { 'data-skin': style.id === 'none' ? null : style.id, 'data-radius': a.radius === 'soft' ? null : a.radius, 'data-density': a.density === 'comfortable' ? null : a.density, 'data-motion': a.motion, 'data-hide': a.hide.length ? a.hide.join(' ') : null },
    fontQuery: fonts.query,
  };
}
/** Brand variables only, for callers that still think in palettes. */
export function paletteVars(id: string, dark: boolean): Record<string, string> {
  const t = paletteById(id)[dark ? 'dark' : 'light'];
  return { '--primary': t.primary, '--primary-foreground': t.primaryForeground, '--brand-2': t.brand2, '--accent': t.accent };
}

export const APPEARANCE_CACHE_KEY = 'bugflow-appearance-cache';
export const FONT_LINK_ID = 'bf-fonts';
/**
 * Runs before the page paints. The provider caches the resolved light and dark results for the effective
 * appearance in localStorage; this script only applies them, so no theme logic is duplicated here.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var m=localStorage.getItem('bugflow-theme');var dark=m?m==='dark':true;d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';var c=JSON.parse(localStorage.getItem('${APPEARANCE_CACHE_KEY}')||'null');var t=c&&c[dark?'dark':'light'];if(!t)return;for(var k in t.vars)d.style.setProperty(k,t.vars[k]);for(var a in t.attrs){if(t.attrs[a]==null)d.removeAttribute(a);else d.setAttribute(a,t.attrs[a]);}if(t.fontQuery){var l=document.createElement('link');l.id='${FONT_LINK_ID}';l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?'+t.fontQuery+'&display=swap';document.head.appendChild(l);}}catch(e){}})();`;
