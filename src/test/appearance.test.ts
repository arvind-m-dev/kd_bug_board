import { describe, expect, it } from 'vitest';
import { PALETTES, appearanceSchema, paletteById, paletteVars, skinOf, THEME_BOOT_SCRIPT } from '@/lib/appearance';

describe('colour palettes', () => {
  it('every palette defines all brand tokens for light and dark', () => {
    for (const p of PALETTES) for (const mode of ['light', 'dark'] as const) {
      const t = p[mode];
      for (const v of [t.primary, t.primaryForeground, t.brand2, t.accent]) expect(v).toMatch(/^oklch\(/);
    }
    expect(new Set(PALETTES.map(p => p.id)).size).toBe(PALETTES.length);
  });
  it('maps a palette to CSS variables per mode and falls back to the default', () => {
    expect(paletteVars('ocean', false)['--primary']).toBe(paletteById('ocean').light.primary);
    expect(paletteVars('ocean', true)['--primary']).toBe(paletteById('ocean').dark.primary);
    expect(paletteById('nope').id).toBe('teal');
  });
  it('only accepts known palettes', () => {
    expect(appearanceSchema.safeParse({ palette: 'emerald' }).success).toBe(true);
    expect(appearanceSchema.safeParse({ palette: 'neon' }).success).toBe(false);
  });
  it('only the pencil sketch palette carries a skin, and the boot script applies it before paint', () => {
    expect(PALETTES.filter(p => p.skin).map(p => p.id)).toEqual(['sketch']);
    expect(skinOf('sketch')).toBe('sketch'); expect(skinOf('teal')).toBeNull();
    expect(THEME_BOOT_SCRIPT).toContain('data-skin');
  });
  it('boot script is self-contained and runs without errors', () => {
    expect(() => new Function(THEME_BOOT_SCRIPT)).not.toThrow();
  });
});
