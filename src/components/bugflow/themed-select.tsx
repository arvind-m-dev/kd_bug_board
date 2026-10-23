import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const NONE = "__none__";
export type Option = { value: string; label: string; hint?: string };
const trigger =
  "h-9 min-w-[160px] w-auto rounded-lg border-border bg-card text-xs shadow-sm transition-colors hover:border-primary/60 focus:ring-2 focus:ring-primary/30 data-[placeholder]:text-muted-foreground";
const panel = "rounded-lg border-border bg-popover p-1 shadow-xl";

/** Theme-aware dropdown used everywhere instead of native selects. Empty values map to a sentinel only when '' is a real option. */
export function ThemedSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: (Option | string)[];
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const hasEmpty = opts.some((o) => o.value === "");
  return (
    <Select
      value={value === "" ? (hasEmpty ? NONE : "") : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled ?? false}
    >
      <SelectTrigger aria-label={label} className={cn(trigger, className)}>
        <SelectValue placeholder={placeholder ?? label} />
      </SelectTrigger>
      <SelectContent className={panel}>
        {opts.map((o) => (
          <SelectItem
            key={o.value || NONE}
            value={o.value === "" ? NONE : o.value}
            className="rounded-md text-xs focus:bg-primary/15 focus:text-foreground"
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Multi-select dropdown: one click selects an option, a second click unselects it. */
export function ThemedMultiSelect({
  values,
  onChange,
  options,
  label,
  placeholder,
  className,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: Option[];
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter((o) => values.includes(o.value));
  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled ?? false}>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex min-h-9 items-center justify-between gap-2 px-3 py-1 text-left border",
            trigger,
            className,
          )}
        >
          <span className="flex flex-wrap gap-1">
            {chosen.length === 0 ? (
              <span className="text-muted-foreground">{placeholder ?? label}</span>
            ) : (
              chosen.map((o) => (
                <span
                  key={o.value}
                  className="rounded-md bg-primary/15 px-1.5 py-0.5 text-xs text-foreground"
                >
                  {o.label}
                </span>
              ))
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(panel, "w-72")}>
        <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
          <span>{values.length} selected</span>
          {values.length > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 hover:text-foreground"
              onClick={() => onChange([])}
            >
              <X className="size-3" />
              Clear
            </button>
          )}
        </div>
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="max-h-64 overflow-y-auto"
        >
          {options.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No members available.</p>
          )}
          {options.map((o) => {
            const on = values.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-primary/10",
                  on && "bg-primary/15",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
                <span className="flex-1">{o.label}</span>
                {o.hint && (
                  <span className="text-[11.5px] uppercase text-muted-foreground">{o.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
