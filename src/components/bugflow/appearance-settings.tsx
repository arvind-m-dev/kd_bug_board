import { useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Check, Moon, Palette as PaletteIcon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { PALETTES, paletteById } from '@/lib/appearance';
import { saveAppearance } from '@/lib/appearance.functions';
import { useTheme } from './theme-toggle';
import { actionError } from './action-feedback';

/** Settings → Appearance: workspace colour palette (everyone) and light/dark mode (this browser). */
export function AppearanceSettings() {
  const { palette, setPalette, dark, setDark } = useTheme(); const save = useServerFn(saveAppearance);
  const m = useMutation({ mutationFn: (id: string) => save({ data: { palette: id } }) });
  function choose(id: string) {
    if (id === palette) return;
    const previous = palette; setPalette(id); // preview instantly
    m.mutate(id, {
      onSuccess: () => toast.success(`${paletteById(id).name} applied`, { description: 'Saved for the whole workspace and every member portal.' }),
      onError: e => { setPalette(previous); toast.error(actionError(e, 'The colour theme could not be saved.')); },
    });
  }
  return <section className="bf-settings-section" aria-labelledby="appearance-heading">
    <div className="bf-settings-heading"><div className="flex items-center gap-3"><span className="bf-stat-icon bf-tone-teal"><PaletteIcon size={18} /></span><div><h2 id="appearance-heading">Appearance</h2><span className="text-xs text-muted-foreground">Colour theme for everyone · light or dark for you</span></div></div>
      <div className="bf-mode" role="radiogroup" aria-label="Light or dark mode">
        <button type="button" role="radio" aria-checked={!dark} onClick={() => setDark(false)}><Sun size={14} />Light</button>
        <button type="button" role="radio" aria-checked={dark} onClick={() => setDark(true)}><Moon size={14} />Dark</button>
      </div></div>
    <div className="bf-palettes" role="radiogroup" aria-label="Colour theme">
      {PALETTES.map(p => { const t = p[dark ? 'dark' : 'light']; const on = p.id === palette; return <button key={p.id} type="button" role="radio" aria-checked={on} className="bf-palette" onClick={() => choose(p.id)} disabled={m.isPending && !on}>
        <span className="bf-palette-preview" aria-hidden="true">
          <span className="bf-pp-bar" style={{ background: `linear-gradient(90deg, ${t.primary}, ${t.brand2})` }} />
          <span className="bf-pp-row"><span className="bf-pp-btn" style={{ background: t.primary, color: t.primaryForeground }}>Raise a bug</span><span className="bf-pp-chip" style={{ background: t.accent, color: t.primary }}>Active</span></span>
          <span className="bf-pp-swatches">{[t.primary, t.brand2, t.accent].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        </span>
        <span className="bf-palette-text"><strong>{p.name}{on && <Check size={15} />}</strong><small>{p.description}</small></span>
      </button>; })}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Status colours (new, reopened, resolved…) and chart colours stay the same in every theme, so their meaning never changes.</p>
  </section>;
}
