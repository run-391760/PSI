"use client";

import { CalendarDays, ChevronDown, Layers } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { Checkbox, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/feedback";
import { INTERVALS, rangeLabel, type Interval, type Range } from "@/lib/cx/reports/model";
import { cn } from "@/lib/utils";

/** Update URL params (null removes) keeping everything else; replace, no scroll jump. */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v == null || v === "" ? p.delete(k) : p.set(k, v));
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };
  return { sp, set, pending };
}

const DAY = 86400000;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function DateRange({ range, today, onChange }: { range: Range; today: string; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (setFrom(range.from), setTo(range.to)), [range.from, range.to]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = shift(monthStart, -1);
  const presets: { label: string; r: Range }[] = [
    { label: "Today", r: { from: today, to: today } },
    { label: "Yesterday", r: { from: shift(today, -1), to: shift(today, -1) } },
    { label: "Last 7 days", r: { from: shift(today, -6), to: today } },
    { label: "Last 14 days", r: { from: shift(today, -13), to: today } },
    { label: "Last 30 days", r: { from: shift(today, -29), to: today } },
    { label: "This month", r: { from: monthStart, to: today } },
    { label: "Last month", r: { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd } },
    { label: "Last 90 days", r: { from: shift(today, -89), to: today } },
  ];
  const pick = (r: Range) => (onChange(r), setOpen(false));
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-[13px] text-text hover:border-border-strong" aria-expanded={open} aria-label="Date range">
        <CalendarDays className="h-4 w-4 shrink-0 text-text-3" />
        <span className="truncate tabular">{rangeLabel(range)}</span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-text-3" />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-[min(92vw,420px)] rounded-lg border border-border bg-surface p-3 shadow-pop">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={() => pick(p.r)} className={cn("rounded-md px-2 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-3 hover:text-text", p.r.from === range.from && p.r.to === range.to && "bg-brand-soft text-brand-ink")}>
                {p.label}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (from && to) pick(from <= to ? { from, to } : { from: to, to: from });
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] text-text-3">
              From
              <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-text" />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] text-text-3">
              To
              <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-text" />
            </label>
            <button type="submit" className="h-8 rounded-md bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-brand-hover">Apply</button>
          </form>
        </div>
      )}
    </div>
  );
}

function MediaSelect({ options, selected, onChange }: { options: { id: string; label: string; count?: number }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(selected), [selected]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const label = selected.length ? options.filter((o) => selected.includes(o.id)).map((o) => o.label).join(", ") || `${selected.length} media types` : "All media types";
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-[13px] text-text hover:border-border-strong" aria-expanded={open} aria-label="Media types">
        <Layers className="h-4 w-4 shrink-0 text-text-3" />
        <span className="truncate">{label}</span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-text-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[min(92vw,320px)] rounded-lg border border-border bg-surface shadow-pop">
          <div className="max-h-72 overflow-y-auto p-2">
            {options.length === 0 && <p className="px-2 py-3 text-[12.5px] text-text-3">No media types in this period.</p>}
            {options.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-text hover:bg-surface-3">
                <Checkbox checked={draft.includes(o.id)} onChange={(e) => setDraft((d) => (e.target.checked ? [...d, o.id] : d.filter((x) => x !== o.id)))} />
                <span className="flex-1">{o.label}</span>
                {o.count != null && <span className="text-[12px] text-text-3 tabular">{o.count.toLocaleString("en-US")}</span>}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <button type="button" className="text-[12.5px] text-link hover:underline" onClick={() => setDraft(options.map((o) => o.id))}>Select all</button>
            <button type="button" className="text-[12.5px] text-text-2 hover:underline" onClick={() => setDraft([])}>Clear</button>
            <button type="button" className="ml-auto h-7 rounded-md bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-brand-hover" onClick={() => (onChange(draft.length === options.length ? [] : draft), setOpen(false))}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Report filter bar: scope picker (the shared ScopePicker, passed in as `scope`), date range, media types and
 * "Show by publish / created date". Every value lives in the URL.
 */
export function ReportFilterBar({
  scope,
  range,
  today,
  media,
  mediaOptions,
  basis,
  showBasis,
  showMedia = true,
}: {
  scope?: ReactNode;
  range: Range;
  today: string;
  media: string[];
  mediaOptions: { id: string; label: string; count?: number }[];
  basis?: "publish" | "created";
  showBasis?: boolean;
  showMedia?: boolean;
}) {
  const { set, pending } = useUrlParams();
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:items-center">
      {scope && <div className="min-w-0 xl:w-[30%]">{scope}</div>}
      <div className="min-w-0 xl:flex-1">
        <DateRange range={range} today={today} onChange={(r) => set({ from: r.from, to: r.to })} />
      </div>
      {showMedia && (
        <div className="min-w-0 xl:flex-1">
          <MediaSelect options={mediaOptions} selected={media} onChange={(ids) => set({ media: ids.length ? ids.join(",") : null })} />
        </div>
      )}
      {showBasis && (
        <Select value={basis ?? "publish"} onChange={(e) => set({ basis: e.target.value === "created" ? "created" : null })} className="h-9 min-w-0 text-[13px] xl:w-52" aria-label="Show by date">
          <option value="publish">Show By Publish Date</option>
          <option value="created">Show By Created Date</option>
        </Select>
      )}
      {pending && <Spinner className="h-4 w-4 justify-self-start text-text-3" />}
    </div>
  );
}

/** "Sort By Daily / Weekly / Monthly" control bound to ?interval= (or a custom param). */
export function IntervalSelect({ value, param = "interval" }: { value: Interval; param?: string }) {
  const { set } = useUrlParams();
  return (
    <Select value={value} onChange={(e) => set({ [param]: e.target.value === "day" ? null : e.target.value })} className="h-7 w-36 text-[12.5px]" aria-label="Sort by">
      {INTERVALS.map((i) => <option key={i.id} value={i.id}>Sort By {i.label}</option>)}
    </Select>
  );
}

/** Select bound to a URL param (e.g. a widget's scope entity). */
export function ParamSelect({ param, value, options, label, className }: { param: string; value: string; options: { value: string; label: string }[]; label: string; className?: string }) {
  const { set } = useUrlParams();
  return (
    <Select value={value} onChange={(e) => set({ [param]: e.target.value || null })} className={cn("h-7 w-44 text-[12.5px]", className)} aria-label={label}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
