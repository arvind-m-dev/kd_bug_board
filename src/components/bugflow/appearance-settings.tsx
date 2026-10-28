import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  Dices,
  Eye,
  LockKeyhole,
  Moon,
  Palette as PaletteIcon,
  RotateCcw,
  Save,
  Sun,
  Undo2,
  Users,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_SCENE,
  FONTS,
  HIDEABLE,
  MINIMAL_HIDE,
  PALETTES,
  STYLES,
  WORLDS,
  fontById,
  paletteById,
  portalAppearanceSchema,
  resolveAppearance,
  styleById,
  type Appearance,
  type PortalAppearance,
  type Scene,
} from "@/lib/appearance";
import { cssOklchToHex } from "@/lib/color";
import { saveAppearance } from "@/lib/appearance.functions";
import { savePortalAppearance } from "@/lib/member-management.functions";
import { useTheme } from "./theme-toggle";
import { ConfirmAction, actionError } from "./action-feedback";

type PortalType = "reporter" | "qa" | "developer" | "member";
type Scope = { scope: "workspace" } | { scope: "portal"; token: string; type: PortalType };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A member saves everything except the workspace-level switch (the schema is strict about it). */
const omitSwitch = ({ membersMayCustomize: _switch, ...rest }: Appearance): PortalAppearance =>
  rest;
const PREVIEW_FONTS_ID = "bf-fonts-preview";
const SCENE_PRESETS: { name: string; values: Partial<Scene> }[] = [
  {
    name: "Calm",
    values: {
      amount: 0.55,
      speed: 0.7,
      randomness: 0.25,
      bats: 3,
      bugs: 2,
      spiders: 1,
      webs: 1,
      pumpkins: 2,
    },
  },
  {
    name: "Balanced",
    values: {
      amount: 1,
      speed: 1,
      randomness: 0.5,
      bats: 7,
      bugs: 5,
      spiders: 2,
      webs: 2,
      pumpkins: 3,
    },
  },
  {
    name: "Full",
    values: {
      amount: 1.65,
      speed: 1.25,
      randomness: 0.8,
      bats: 11,
      bugs: 8,
      spiders: 4,
      webs: 3,
      pumpkins: 5,
    },
  },
];

/** Settings → Appearance: the Admin's Theme Studio, saved for the whole workspace. */
export function AppearanceSettings() {
  return <ThemeStudio scope="workspace" />;
}

/**
 * Theme Studio. Every control previews instantly on this page; nothing is saved until Save.
 * Admin saves the workspace theme (the default for everyone) and may allow members to customise.
 * A member saves their own theme on their portal, so it follows them on every device.
 */
export function ThemeStudio(props: Scope) {
  const { dark, setDark, workspace, personal, preview, setWorkspace, setPersonal } = useTheme();
  const client = useQueryClient();
  const forWorkspace = props.scope === "workspace";
  const locked = !forWorkspace && !workspace.membersMayCustomize;
  // Where this editor starts: the workspace theme, or the member's own choices on top of it.
  const base = useMemo<Appearance>(
    () =>
      forWorkspace
        ? workspace
        : { ...workspace, ...(personal ?? {}), membersMayCustomize: workspace.membersMayCustomize },
    [forWorkspace, workspace, personal],
  );
  const [draft, setDraft] = useState<Appearance>(base);
  const [confirmAll, setConfirmAll] = useState(false);
  const dirty = !same(draft, base);
  // Follow a refreshed base (another tab saved, a refetch) while nothing is being edited here.
  const lastBase = useRef(base);
  useEffect(() => {
    setDraft((d) => (same(d, lastBase.current) ? base : d));
    lastBase.current = base;
  }, [base]);
  // Live preview for as long as there are unsaved changes; stop when leaving the page.
  useEffect(() => {
    preview(dirty ? draft : null);
  }, [dirty, draft, preview]);
  useEffect(() => () => preview(null), [preview]);
  // One stylesheet with every pairing, so the font cards show their own faces.
  useEffect(() => {
    const queries = [...new Set(FONTS.map((f) => f.query).filter(Boolean))];
    const link = document.createElement("link");
    link.id = PREVIEW_FONTS_ID;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${queries.join("&")}&display=swap`;
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  const saveWorkspace = useServerFn(saveAppearance);
  const savePortal = useServerFn(savePortalAppearance);
  const save = useMutation({
    mutationFn: async (arg: Appearance | null | { all: true }) => {
      const next = arg && "all" in arg ? draft : arg;
      if (forWorkspace) {
        const r = await saveWorkspace({
          data: { appearance: next ?? draft, forAllPortals: !!(arg && "all" in arg) },
        });
        return {
          kind: "workspace" as const,
          value: r.appearance,
          reset: r.portalsReset,
          all: !!(arg && "all" in arg),
        };
      }
      const p = props as Extract<Scope, { scope: "portal" }>;
      const value = next ? portalAppearanceSchema.parse(omitSwitch(next)) : null;
      await savePortal({ data: { token: p.token, type: p.type, appearance: value } });
      return { kind: "portal" as const, value };
    },
    onSuccess: (r) => {
      if (r.kind === "workspace") {
        setWorkspace(r.value);
        setDraft(r.value);
        preview(null);
        setConfirmAll(false);
        toast.success(r.all ? "Theme saved for all portals" : "Theme saved for the main panel", {
          description: r.all
            ? r.reset
              ? `${r.reset} personal ${r.reset === 1 ? "theme was" : "themes were"} cleared, so every portal now shows this theme.`
              : "Every portal now shows this theme."
            : "The workspace and every portal without a personal theme use it; members keep their own choices.",
        });
        return;
      }
      setPersonal(r.value);
      setDraft(
        r.value
          ? { ...workspace, ...r.value, membersMayCustomize: workspace.membersMayCustomize }
          : workspace,
      );
      preview(null);
      void client.invalidateQueries({ queryKey: ["personal-portal"] });
      toast.success(r.value ? "Your theme is saved" : "Back to the workspace theme", {
        description: r.value
          ? "It follows you on every device you open your portal on."
          : undefined,
      });
    },
    onError: (e) => toast.error(actionError(e, "The theme could not be saved.")),
  });

  const set = (patch: Partial<Appearance>) => setDraft((d) => ({ ...d, ...patch }));
  const scene = (patch: Partial<Scene>) =>
    setDraft((d) => ({ ...d, scene: { ...d.scene, ...patch } }));
  const style = styleById(draft.style);
  const mode = dark ? "dark" : "light";
  const live = resolveAppearance(draft, dark).vars;
  const accentHex = draft.accent ?? cssOklchToHex(live["--primary"]!) ?? "#0e7490";
  const partnerHex = draft.partner ?? cssOklchToHex(live["--brand-2"]!) ?? "#6d28d9";
  const chooseStyle = (id: string) => {
    const s = styleById(id);
    set({
      style: id,
      fonts: null,
      ...(s.palette && draft.palette !== "custom" ? { palette: s.palette } : {}),
      ...(["halloween", "winter", "christmas", "autumn"].includes(id)
        ? { world: id as Appearance["world"] }
        : {}),
    });
  };
  const hidden = (key: string) => draft.hide.includes(key);
  const toggleHide = (key: string, show: boolean) =>
    set({ hide: show ? draft.hide.filter((k) => k !== key) : [...new Set([...draft.hide, key])] });

  const heading = (
    <div className="bf-settings-heading">
      <div className="flex items-center gap-3">
        <span className="bf-stat-icon bf-tone-teal">
          <PaletteIcon size={18} />
        </span>
        <div>
          <h2 id="appearance-heading">{forWorkspace ? "Appearance" : "My theme"}</h2>
          <span className="text-xs text-muted-foreground">
            {forWorkspace
              ? "Colour, style, fonts and layout for the whole workspace · light or dark is personal"
              : locked
                ? "Your Admin has set one theme for this workspace · light or dark is still yours"
                : "Make your portal comfortable for you — it follows you on every device"}
          </span>
        </div>
      </div>
      <div className="bf-theme-heading-actions">
        {!forWorkspace && personal && !dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            <RotateCcw />
            Use workspace theme
          </Button>
        )}
        <Seg
          label="Light or dark mode"
          value={dark ? "dark" : "light"}
          onChange={(v) => setDark(v === "dark")}
          options={[
            { value: "light", label: "Light", icon: <Sun size={14} /> },
            { value: "dark", label: "Dark", icon: <Moon size={14} /> },
          ]}
        />
      </div>
    </div>
  );

  if (locked)
    return (
      <section className="bf-settings-section" aria-labelledby="appearance-heading">
        {heading}
        <div className="bf-switch-row">
          <span className="flex items-center gap-3 text-sm">
            <LockKeyhole size={16} className="text-muted-foreground" />
            Personal themes are turned off for this workspace. You are seeing{" "}
            <strong>
              {paletteById(workspace.palette).name}
              {styleById(workspace.style).id !== "none"
                ? ` · ${styleById(workspace.style).name}`
                : ""}
            </strong>
            , chosen by your Admin.
          </span>
        </div>
      </section>
    );

  return (
    <section className="bf-settings-section" aria-labelledby="appearance-heading">
      {heading}
      <div className="bf-studio">
        <Row
          title="Colour"
          hint={
            style.monochrome
              ? "The Ink style is black and white only — pick another style to use colour."
              : "The brand colour and its partner. Status colours keep their meaning in every theme."
          }
        >
          <div
            className="bf-palette-swatches"
            role="radiogroup"
            aria-label="Colour theme"
            aria-disabled={style.monochrome}
          >
            {PALETTES.map((p) => {
              const t = p[mode];
              const on = draft.palette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={`${p.name} — ${p.description}`}
                  aria-label={p.name}
                  className="bf-palette-swatch"
                  style={{ ["--a" as string]: t.primary, ["--b" as string]: t.brand2 }}
                  disabled={style.monochrome}
                  onClick={() => set({ palette: p.id })}
                >
                  {on && <Check size={18} />}
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={draft.palette === "custom"}
              title="Custom — pick any colour"
              aria-label="Custom colour"
              className="bf-palette-swatch"
              data-custom=""
              disabled={style.monochrome}
              onClick={() => set({ palette: "custom", accent: draft.accent ?? accentHex })}
            >
              {draft.palette === "custom" ? <Check size={18} /> : <Wand2 size={16} />}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {draft.palette === "custom"
              ? "Custom colours"
              : `${paletteById(draft.palette).name} — ${paletteById(draft.palette).description}`}
          </p>
          {draft.palette === "custom" && !style.monochrome && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="bf-color">
                <input
                  type="color"
                  aria-label="Brand colour"
                  value={accentHex}
                  onChange={(e) => set({ accent: e.target.value })}
                />
                Brand colour <code className="text-[11px] text-muted-foreground">{accentHex}</code>
              </label>
              <label className="bf-color">
                <input
                  type="color"
                  aria-label="Partner colour"
                  value={partnerHex}
                  onChange={(e) => set({ partner: e.target.value })}
                />
                Partner{" "}
                <code className="text-[11px] text-muted-foreground">{draft.partner ?? "auto"}</code>
              </label>
              {draft.partner && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ partner: null })}
                >
                  <RotateCcw />
                  Auto partner
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                Text on your colour stays readable in light and dark — the shade adapts, the hue is
                yours.
              </span>
            </div>
          )}
        </Row>
        <Row
          title="Style"
          hint="A style changes surfaces, lines and decorations, and brings its own colours and fonts (you can still change both)."
        >
          <div className="bf-styles" role="radiogroup" aria-label="Style">
            {STYLES.map((s) => {
              const v = resolveAppearance(
                {
                  ...draft,
                  style: s.id,
                  palette: s.palette && draft.palette !== "custom" ? s.palette : draft.palette,
                },
                dark,
              ).vars;
              const on = draft.style === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="bf-style"
                  data-skin={s.id === "none" ? undefined : s.id}
                  onClick={() => chooseStyle(s.id)}
                >
                  <span
                    className="bf-style-sample"
                    style={{
                      background: v["--accent"],
                      color: v["--primary"],
                      fontFamily: `'${fontById(s.fonts).heading}', sans-serif`,
                    }}
                  >
                    <i style={{ background: v["--primary"] }} />
                    <i style={{ background: v["--brand-2"] }} />
                    Aa
                  </span>
                  <strong>
                    {s.name}
                    {on && <Check size={14} />}
                  </strong>
                  <small>{s.description}</small>
                </button>
              );
            })}
          </div>
        </Row>
        <Row
          title="Fonts"
          hint="Headings and body text. “Match the style” follows whichever style is chosen."
        >
          <div className="bf-fonts" role="radiogroup" aria-label="Fonts">
            <button
              type="button"
              role="radio"
              aria-checked={draft.fonts === null}
              className="bf-font"
              onClick={() => set({ fonts: null })}
            >
              <strong style={{ fontFamily: `'${fontById(style.fonts).heading}', sans-serif` }}>
                Match the style
              </strong>
              <span style={{ fontFamily: `'${fontById(style.fonts).body}', sans-serif` }}>
                {fontById(style.fonts).name}
              </span>
              <small>Follows {style.name}</small>
            </button>
            {FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={draft.fonts === f.id}
                className="bf-font"
                onClick={() => set({ fonts: f.id })}
              >
                <strong style={{ fontFamily: `'${f.heading}', sans-serif` }}>{f.heading}</strong>
                <span style={{ fontFamily: `'${f.body}', sans-serif` }}>
                  {f.body === f.heading ? "Body text in the same face" : `Body text in ${f.body}`}
                </span>
                <small>{f.note}</small>
              </button>
            ))}
          </div>
        </Row>
        <Row title="Shape & density" hint="Corner roundness, and how much fits on a screen.">
          <div className="flex flex-wrap items-center gap-3">
            <Seg
              label="Corner shape"
              value={draft.radius}
              onChange={(v) => set({ radius: v })}
              options={[
                { value: "sharp", label: "Sharp" },
                { value: "soft", label: "Soft" },
                { value: "round", label: "Round" },
              ]}
            />
            <Seg
              label="Density"
              value={draft.density}
              onChange={(v) => set({ density: v })}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </div>
        </Row>
        <Row
          title="Motion"
          hint="Off stops every animation and decoration. Lively adds the moving parts of decorated styles — bats and crawling bugs, snow, falling leaves, twinkling lights."
        >
          <Seg
            label="Motion"
            value={draft.motion}
            onChange={(v) => set({ motion: v })}
            options={[
              { value: "off", label: "Off" },
              { value: "subtle", label: "Subtle" },
              { value: "lively", label: "Lively" },
            ]}
          />
        </Row>
        <Row
          title="3D world"
          hint="Choose a scene independently from the surface style. It stays decorative and never blocks workspace controls."
        >
          <div className="bf-styles" role="radiogroup" aria-label="3D world">
            {WORLDS.map((world) => {
              const on = draft.world === world.id;
              return (
                <button
                  key={world.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="bf-style bf-world"
                  onClick={() => set({ world: world.id as Appearance["world"] })}
                >
                  <span className="bf-world-sample" data-world={world.id} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>
                    {world.name}
                    {on && <Check size={14} />}
                  </strong>
                  <small>{world.description}</small>
                </button>
              );
            })}
          </div>
          {draft.world !== "none" && (
            <div className="mt-3">
              <Seg
                label="3D quality"
                value={draft.quality}
                onChange={(value) => set({ quality: value as Appearance["quality"] })}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ]}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Auto lowers resolution and animation rate on constrained devices or data-saving
                connections.
              </p>
            </div>
          )}
        </Row>
        {draft.world !== "none" && (
          <Row
            title="Scene"
            hint={
              draft.world === "halloween"
                ? "How much is going on: how many bats, bugs, spiders, webs and pumpkins, how big the bugs are, how fast everything moves, and how random the placement is. Shuffle rolls new positions."
                : "How much falls, how fast, and how random the placement is. Shuffle rolls new positions."
            }
          >
            <div className="bf-scene-presets" aria-label="Scene presets">
              <span>Preset</span>
              {SCENE_PRESETS.map((preset) => (
                <Button
                  key={preset.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => scene(preset.values)}
                >
                  {preset.name}
                </Button>
              ))}
            </div>
            <div className="bf-knobs">
              {draft.world === "halloween" ? (
                <>
                  <Knob
                    label="Bats"
                    value={draft.scene.bats}
                    min={0}
                    max={12}
                    step={1}
                    onChange={(v) => scene({ bats: v })}
                  />
                  <Knob
                    label="Bugs"
                    value={draft.scene.bugs}
                    min={0}
                    max={10}
                    step={1}
                    onChange={(v) => scene({ bugs: v })}
                  />
                  <Knob
                    label="Bug size"
                    value={draft.scene.bugSize}
                    min={0.5}
                    max={2}
                    step={0.1}
                    format={(v) => `${v.toFixed(1)}×`}
                    onChange={(v) => scene({ bugSize: v })}
                  />
                  <Knob
                    label="Spiders"
                    value={draft.scene.spiders}
                    min={0}
                    max={4}
                    step={1}
                    onChange={(v) => scene({ spiders: v })}
                  />
                  <Knob
                    label="Webs"
                    value={draft.scene.webs}
                    min={0}
                    max={3}
                    step={1}
                    onChange={(v) => scene({ webs: v })}
                  />
                  <Knob
                    label="Pumpkins"
                    value={draft.scene.pumpkins}
                    min={0}
                    max={5}
                    step={1}
                    onChange={(v) => scene({ pumpkins: v })}
                  />
                </>
              ) : (
                <Knob
                  label="Amount"
                  value={draft.scene.amount}
                  min={0}
                  max={2}
                  step={0.1}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => scene({ amount: v })}
                />
              )}
              <Knob
                label="Speed"
                value={draft.scene.speed}
                min={0.5}
                max={2}
                step={0.1}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(v) => scene({ speed: v })}
              />
              <Knob
                label="Randomness"
                value={draft.scene.randomness}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => scene({ randomness: v })}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => scene({ seed: Math.floor(Math.random() * 10000) })}
              >
                <Dices />
                Shuffle positions
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set({ scene: DEFAULT_SCENE })}
              >
                <Undo2 />
                Reset scene
              </Button>
            </div>
          </Row>
        )}
        <Row
          title="Show or hide"
          hint="Turn off what you don't need. Nothing here changes what anyone is allowed to see — only what is on screen."
        >
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ hide: [...MINIMAL_HIDE] })}
            >
              <Eye />
              Minimal
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => set({ hide: [] })}>
              <Undo2 />
              Show everything
            </Button>
          </div>
          <div className="bf-hide-grid">
            {HIDEABLE.map((h) => (
              <label key={h.key}>
                <Checkbox
                  checked={!hidden(h.key)}
                  onCheckedChange={(v) => toggleHide(h.key, v === true)}
                  aria-label={`Show ${h.label.toLowerCase()}`}
                />
                <span>
                  {h.label}
                  <small>{h.hint}</small>
                </span>
              </label>
            ))}
          </div>
        </Row>
        {forWorkspace && (
          <Row
            title="Members"
            hint="When on, each member can set their own theme from “My theme” in their portal. When off, everyone sees the workspace theme."
          >
            <label className="bf-switch-row">
              <span className="text-sm">Members may choose their own theme</span>
              <Switch
                checked={draft.membersMayCustomize}
                onCheckedChange={(v) => set({ membersMayCustomize: v })}
                aria-label="Members may choose their own theme"
              />
            </label>
          </Row>
        )}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Status, severity and priority colours and chart colours stay the same in every theme, so
        their meaning never changes.
      </p>
      {dirty && (
        <div className="bf-savebar" role="status" aria-live="polite">
          <strong>Theme changes not saved</strong>
          <span className="flex flex-wrap gap-2">
            {dirty && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => setDraft(base)}
              >
                <Undo2 />
                Discard
              </Button>
            )}
            {forWorkspace && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => setConfirmAll(true)}
              >
                <Users />
                Save for all portals
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(draft)}
            >
              <Save />
              {forWorkspace ? "Save theme" : "Save my theme"}
            </Button>
          </span>
        </div>
      )}
      <ConfirmAction
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Save this theme for all portals?"
        description="Every member portal switches to this theme and any personal theme a member has chosen is cleared. Members can pick their own again afterwards if you leave that allowed."
        confirmLabel="Save for all portals"
        onConfirm={() => save.mutateAsync({ all: true }).then(() => undefined)}
      />
    </section>
  );
}

function Knob({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="bf-knob">
      <span>
        {label}
        <b>{format ? format(value) : value}</b>
      </span>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => {
          if (v !== undefined) onChange(Math.round(v * 100) / 100);
        }}
      />
    </label>
  );
}
function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="bf-studio-row">
      <div>
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="bf-mode" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
export type { PortalAppearance };
