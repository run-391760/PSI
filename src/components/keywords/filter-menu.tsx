"use client";

import { ChevronDown, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Dropdown filter button (Semrush-style filter bar). Active filters show their value and a clear icon. */
export function FilterMenu({
  label,
  summary,
  onClear,
  children,
  width = "w-64",
  align = "left",
}: {
  label: string;
  summary?: string | null;
  onClear?: () => void;
  children: (close: () => void) => ReactNode;
  width?: string;
  align?: "left" | "right";
}) {
  const active = !!summary;
  return (
    <Menu
      align={align}
      className={cn("p-3", width)}
      trigger={(open) => (
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
            active ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-border-strong bg-surface text-text-2 hover:bg-surface-3 hover:text-text",
            open && !active && "bg-surface-3 text-text",
          )}
          aria-expanded={open}
        >
          <span className="inline-flex min-w-0 items-baseline">
            {label}
            {active && <span className="max-w-40 truncate font-normal">: {summary}</span>}
          </span>
          {active && onClear ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label} filter`}
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onClear();
                }
              }}
              className="-mr-1 rounded p-0.5 hover:bg-brand/10"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          )}
        </button>
      )}
    >
      {(close) => children(close)}
    </Menu>
  );
}

export type Range = { min: number | null; max: number | null };
export const emptyRange: Range = { min: null, max: null };
export const inRange = (v: number | null | undefined, r: Range) => (r.min == null || (v != null && v >= r.min)) && (r.max == null || (v != null && v <= r.max));
export function rangeSummary(r: Range, fmt: (n: number) => string = (n) => n.toLocaleString()) {
  if (r.min == null && r.max == null) return null;
  if (r.min != null && r.max != null) return `${fmt(r.min)}–${fmt(r.max)}`;
  return r.min != null ? `${fmt(r.min)}+` : `≤${fmt(r.max as number)}`;
}

/** Range picker: presets + custom from/to. */
export function RangePicker({
  value,
  onChange,
  presets = [],
  step = 1,
  close,
  unit,
}: {
  value: Range;
  onChange: (r: Range) => void;
  presets?: { label: string; range: Range }[];
  step?: number;
  close: () => void;
  unit?: string;
}) {
  const [min, setMin] = useState(value.min == null ? "" : String(value.min));
  const [max, setMax] = useState(value.max == null ? "" : String(value.max));
  const parse = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
  const apply = () => {
    let a = parse(min),
      b = parse(max);
    if (a != null && b != null && a > b) [a, b] = [b, a];
    onChange({ min: a, max: b });
    close();
  };
  return (
    <div className="space-y-2">
      {presets.length > 0 && (
        <ul className="-mx-1 space-y-0.5">
          {presets.map((p) => {
            const on = p.range.min === value.min && p.range.max === value.max;
            return (
              <li key={p.label}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.range);
                    close();
                  }}
                  className={cn("flex w-full items-center rounded px-2 py-1 text-left text-[12.5px] hover:bg-surface-3", on ? "font-semibold text-brand-ink" : "text-text")}
                >
                  {p.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={cn(presets.length > 0 && "border-t border-border pt-2")}>
        <div className="mb-1 text-[11.5px] font-medium text-text-3">Custom range{unit ? ` (${unit})` : ""}</div>
        <div className="flex items-center gap-1.5">
          <Input type="number" inputMode="decimal" step={step} placeholder="From" value={min} onChange={(e) => setMin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} className="h-7.5" aria-label="From" />
          <span className="text-text-3">–</span>
          <Input type="number" inputMode="decimal" step={step} placeholder="To" value={max} onChange={(e) => setMax(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} className="h-7.5" aria-label="To" />
        </div>
        <Button size="sm" variant="primary" className="mt-2 w-full" onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
