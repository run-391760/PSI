"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Range = { min?: number; max?: number };
export type Preset = { label: string; min?: number; max?: number };

export const inRange = (v: number | null | undefined, r: Range) => {
  if (r.min == null && r.max == null) return true;
  if (v == null) return false;
  return (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
};

export const POSITION_PRESETS: Preset[] = [
  { label: "Top 3", min: 1, max: 3 },
  { label: "Top 10", min: 1, max: 10 },
  { label: "Top 20", min: 1, max: 20 },
  { label: "11–20", min: 11, max: 20 },
  { label: "21–50", min: 21, max: 50 },
  { label: "51–100", min: 51, max: 100 },
];
export const VOLUME_PRESETS: Preset[] = [
  { label: "100,001+", min: 100001 },
  { label: "10,001–100,000", min: 10001, max: 100000 },
  { label: "1,001–10,000", min: 1001, max: 10000 },
  { label: "101–1,000", min: 101, max: 1000 },
  { label: "11–100", min: 11, max: 100 },
  { label: "1–10", min: 1, max: 10 },
];
export const KD_PRESETS: Preset[] = [
  { label: "Very easy (0–14)", min: 0, max: 14 },
  { label: "Easy (15–29)", min: 15, max: 29 },
  { label: "Possible (30–49)", min: 30, max: 49 },
  { label: "Difficult (50–69)", min: 50, max: 69 },
  { label: "Hard (70–84)", min: 70, max: 84 },
  { label: "Very hard (85–100)", min: 85, max: 100 },
];

function rangeLabel(r: Range, presets: Preset[]) {
  const p = presets.find((x) => x.min === r.min && x.max === r.max);
  if (p) return p.label.replace(/ \(.*\)$/, "");
  if (r.min != null && r.max != null) return `${r.min.toLocaleString()}–${r.max.toLocaleString()}`;
  if (r.min != null) return `≥ ${r.min.toLocaleString()}`;
  if (r.max != null) return `≤ ${r.max.toLocaleString()}`;
  return "";
}

/** Filter trigger: neutral when inactive, brand-tinted with its value (and a clear “×”) when active. */
function Trigger({ label, value, open, onClear }: { label: string; value?: string; open: boolean; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors select-none",
        value ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-border-strong bg-surface text-text-2 hover:bg-surface-3 hover:text-text",
      )}
    >
      {label}
      {value && <span className="font-normal">: {value}</span>}
      {value ? (
        <span
          role="button"
          aria-label={`Clear ${label} filter`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="-mr-1 rounded p-0.5 hover:bg-brand/15"
        >
          <X className="h-3 w-3" />
        </span>
      ) : (
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      )}
    </button>
  );
}

export function RangeFilter({ label, value, onChange, presets, unit }: { label: string; value: Range; onChange: (r: Range) => void; presets: Preset[]; unit?: string }) {
  const [min, setMin] = useState(value.min?.toString() ?? "");
  const [max, setMax] = useState(value.max?.toString() ?? "");
  const active = value.min != null || value.max != null;
  return (
    <Menu trigger={(open) => <Trigger label={label} value={active ? rangeLabel(value, presets) : undefined} open={open} onClear={() => onChange({})} />}>
      {(close) => (
        <div className="w-60 py-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange({ min: p.min, max: p.max });
                setMin(p.min?.toString() ?? "");
                setMax(p.max?.toString() ?? "");
                close();
              }}
              className={cn("flex w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-3", value.min === p.min && value.max === p.max && "font-semibold text-brand-ink")}
            >
              {p.label}
            </button>
          ))}
          <form
            className="mt-1 border-t border-border px-3 pt-2.5 pb-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const a = min.trim() === "" ? undefined : Number(min);
              const b = max.trim() === "" ? undefined : Number(max);
              onChange({ min: Number.isFinite(a) ? a : undefined, max: Number.isFinite(b) ? b : undefined });
              close();
            }}
          >
            <div className="mb-1.5 text-[11.5px] font-medium text-text-3">Custom range{unit ? ` (${unit})` : ""}</div>
            <div className="flex items-center gap-1.5">
              <input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} placeholder="From" inputMode="numeric" className="h-7 w-full rounded border border-border-strong bg-surface px-2 text-[12.5px] focus:border-brand focus:outline-none" />
              <span className="text-text-3">–</span>
              <input value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))} placeholder="To" inputMode="numeric" className="h-7 w-full rounded border border-border-strong bg-surface px-2 text-[12.5px] focus:border-brand focus:outline-none" />
            </div>
            <Button type="submit" size="sm" variant="primary" className="mt-2 w-full">
              Apply
            </Button>
          </form>
        </div>
      )}
    </Menu>
  );
}

export function MultiFilter<T extends string>({ label, options, value, onChange, width = "w-56" }: { label: string; options: { value: T; label: ReactNode; text?: string }[]; value: T[]; onChange: (v: T[]) => void; width?: string }) {
  const text = value.length === 0 ? undefined : value.length === 1 ? (options.find((o) => o.value === value[0])?.text ?? String(value[0])) : `${value.length} selected`;
  return (
    <Menu trigger={(open) => <Trigger label={label} value={text} open={open} onClear={() => onChange([])} />}>
      <div className={cn("scroll-thin max-h-80 overflow-y-auto py-1", width)}>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-3">
            <Checkbox checked={value.includes(o.value)} onChange={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])} />
            {o.label}
          </label>
        ))}
      </div>
    </Menu>
  );
}

export function ChoiceFilter<T extends string>({ label, options, value, onChange, children }: { label: string; options: { value: T; label: string }[]; value: T | ""; onChange: (v: T | "") => void; children?: ReactNode }) {
  const text = value ? options.find((o) => o.value === value)?.label : undefined;
  return (
    <Menu trigger={(open) => <Trigger label={label} value={text} open={open} onClear={() => onChange("")} />}>
      {(close) => (
        <div className="scroll-thin max-h-96 w-60 overflow-y-auto py-1">
          {children}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={cn("flex w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-3", value === o.value && "font-semibold text-brand-ink")}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

export function TextFilter({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <Menu trigger={(open) => <Trigger label={label} value={value || undefined} open={open} onClear={() => (onChange(""), setDraft(""))} />}>
      {(close) => (
        <form
          className="w-64 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            onChange(draft.trim());
            close();
          }}
        >
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="h-8 w-full rounded border border-border-strong bg-surface px-2 text-[13px] focus:border-brand focus:outline-none" />
          {hint && <p className="mt-1.5 text-[11.5px] text-text-3">{hint}</p>}
          <Button type="submit" size="sm" variant="primary" className="mt-2 w-full">
            Apply
          </Button>
        </form>
      )}
    </Menu>
  );
}

export function SearchBox({ value, onChange, placeholder = "Filter by keyword", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative w-56 max-w-full", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border-strong bg-surface pr-2 pl-8 text-[12.5px] placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
      />
    </div>
  );
}

/** Words of a filter string; a keyword matches "exclude" when it contains any of them. */
export const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter(Boolean);
