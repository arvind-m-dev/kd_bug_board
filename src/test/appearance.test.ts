import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, FONTS, HIDEABLE, MINIMAL_HIDE, PALETTES, STYLES, THEME_BOOT_SCRIPT, appearanceSchema, effectiveAppearance, fontById, normalizeAppearance, paletteById, paletteVars, portalAppearanceSchema, resolveAppearance, styleById } from '@/lib/appearance';

describe('palettes, styles and fonts', () => {
  it('every palette defines all brand tokens for light and dark', () => {
    for (const p of PALETTES) for (const mode of ['light', 'dark'] as const) {
      const t = p[mode];
      for (const v of [t.primary, t.primaryForeground, t.brand2, t.accent]) expect(v).toMatch(/^oklch\(/);
    }
    expect(new Set(PALETTES.map(p => p.id)).size).toBe(PALETTES.length);
  });
  it('styles and fonts only reference each other by known ids', () => {
    for (const s of STYLES) { expect(fontById(s.fonts).id).toBe(s.fonts); if (s.palette) expect(paletteById(s.palette).id).toBe(s.palette); }
    expect(new Set(STYLES.map(s => s.id)).size).toBe(STYLES.length);
    expect(new Set(FONTS.map(f => f.id)).size).toBe(FONTS.length);
    expect(MINIMAL_HIDE.every(k => HIDEABLE.some(h => h.key === k))).toBe(true);
  });
  it('maps a palette to CSS variables per mode and falls back to the default', () => {
    expect(paletteVars('ocean', false)['--primary']).toBe(paletteById('ocean').light.primary);
    expect(paletteVars('ocean', true)['--primary']).toBe(paletteById('ocean').dark.primary);
    expect(paletteById('nope').id).toBe('teal'); expect(styleById('nope').id).toBe('none');
  });
});

describe('appearance schema', () => {
  it('accepts known ids and custom hex colours, rejects anything else', () => {
    expect(appearanceSchema.safeParse({ palette: 'emerald' }).success).toBe(true);
    expect(appearanceSchema.safeParse({ palette: 'custom', accent: '#0e4f63', partner: '#e9c868' }).success).toBe(true);
    expect(appearanceSchema.safeParse({ palette: 'neon' }).success).toBe(false);
    expect(appearanceSchema.safeParse({ accent: 'red' }).success).toBe(false);
    expect(appearanceSchema.safeParse({ hide: ['everything'] }).success).toBe(false);
    expect(appearanceSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
  it('members cannot touch the workspace-level switch', () => {
    expect(portalAppearanceSchema.safeParse({ palette: 'rose', membersMayCustomize: false }).success).toBe(false);
    expect(portalAppearanceSchema.safeParse({ palette: 'rose' }).success).toBe(true);
  });
  it('normalizes old rows and never throws', () => {
    expect(normalizeAppearance({ palette: 'sketch' })).toMatchObject({ palette: 'graphite', style: 'sketch' });
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ palette: 'neon' })).toEqual(DEFAULT_APPEARANCE);
  });
  it('a member choice overrides the workspace only while the Admin allows it', () => {
    const ws = appearanceSchema.parse({ palette: 'teal', membersMayCustomize: true });
    const mine = portalAppearanceSchema.parse({ palette: 'rose', density: 'compact' });
    expect(effectiveAppearance(ws, mine)).toMatchObject({ palette: 'rose', density: 'compact', membersMayCustomize: true });
    expect(effectiveAppearance({ ...ws, membersMayCustomize: false }, mine)).toEqual({ ...ws, membersMayCustomize: false });
    expect(effectiveAppearance(ws, null)).toBe(ws);
  });
});

describe('resolving an appearance for the page', () => {
  it('turns a palette, style and layout into CSS variables and html attributes', () => {
    const r = resolveAppearance(appearanceSchema.parse({ palette: 'ocean', style: 'none', radius: 'round', density: 'compact', motion: 'off', hide: ['footer', 'clock'] }), false);
    expect(r.vars['--primary']).toBe(paletteById('ocean').light.primary);
    expect(r.vars['--font-heading']).toContain('Manrope');
    expect(r.attrs).toEqual({ 'data-skin': null, 'data-radius': 'round', 'data-density': 'compact', 'data-motion': 'off', 'data-hide': 'footer clock' });
    expect(r.fontQuery).toBe('');
  });
  it('a style brings its own palette fonts, which an explicit font choice overrides', () => {
    const halloween = resolveAppearance(appearanceSchema.parse({ palette: 'pumpkin', style: 'halloween' }), true);
    expect(halloween.attrs['data-skin']).toBe('halloween'); expect(halloween.vars['--font-heading']).toContain('Creepster'); expect(halloween.fontQuery).toContain('Creepster');
    expect(resolveAppearance(appearanceSchema.parse({ style: 'halloween', fonts: 'inter' }), true).vars['--font-heading']).toContain('Inter');
  });
  it('the Ink style is only black and white whatever palette is saved', () => {
    const light = resolveAppearance(appearanceSchema.parse({ palette: 'rose', style: 'ink' }), false);
    const dark = resolveAppearance(appearanceSchema.parse({ palette: 'rose', style: 'ink' }), true);
    expect(light.vars['--primary']).toBe('oklch(0 0 0)'); expect(dark.vars['--primary']).toBe('oklch(1 0 0)');
    expect(light.vars['--brand-2']).toMatch(/^oklch\([\d.]+ 0 0\)$/);
  });
  it('a custom accent keeps readable text by pinning lightness per mode', () => {
    const a = appearanceSchema.parse({ palette: 'custom', accent: '#0e4f63' });
    expect(resolveAppearance(a, false).vars['--primary']).toMatch(/^oklch\(0\.5 /);
    expect(resolveAppearance(a, true).vars['--primary']).toMatch(/^oklch\(0\.78 /);
    expect(resolveAppearance({ ...a, accent: null }, false).vars['--primary']).toBe(paletteById('teal').light.primary);
  });
  it('boot script applies cached attributes before paint and is self-contained', () => {
    expect(THEME_BOOT_SCRIPT).toContain('bugflow-appearance-cache'); expect(THEME_BOOT_SCRIPT).toContain('setAttribute');
    expect(() => new Function(THEME_BOOT_SCRIPT)).not.toThrow();
  });
});
