import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { PERIOD_PRESETS, type Period } from '@/lib/period';
import { ThemedSelect } from './themed-select';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

/** Preset periods (all time, last N days) or a custom from–to date range. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const isCustom = !!(value.from || value.to);
  const [custom, setCustom] = useState(isCustom);
  const [from, setFrom] = useState(value.from ?? daysAgo(29)); const [to, setTo] = useState(value.to ?? iso(new Date()));
  const today = iso(new Date());
  const invalid = !!from && !!to && from > to;
  const apply = (f: string, t: string) => { if (f && t && f <= t) onChange({ days: 0, from: f, to: t }); };
  return <div className="bf-period">
    <ThemedSelect label="Period" value={custom ? 'custom' : String(value.days)} options={PERIOD_PRESETS}
      onChange={v => { if (v === 'custom') { setCustom(true); apply(from, to); } else { setCustom(false); onChange({ days: Number(v) }); } }} />
    {custom && <div className="bf-range" data-invalid={invalid || undefined}>
      <CalendarRange size={15} aria-hidden="true" />
      <label><span className="sr-only">From</span><input type="date" value={from} max={to || today} onChange={e => { setFrom(e.target.value); apply(e.target.value, to); }} aria-label="From date" /></label>
      <span aria-hidden="true">→</span>
      <label><span className="sr-only">To</span><input type="date" value={to} min={from} max={today} onChange={e => { setTo(e.target.value); apply(from, e.target.value); }} aria-label="To date" /></label>
      {invalid && <span className="bf-range-error" role="alert">Start must be before end</span>}
    </div>}
  </div>;
}
