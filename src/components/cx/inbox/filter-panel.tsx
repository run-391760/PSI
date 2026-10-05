"use client";

import { Calendar, Check, ChevronDown, Circle, Info, MessageCircle, PanelRightClose, Pause } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NetworkIcon } from "@/components/cx/network-icon";
import { ScopePicker } from "@/components/cx/scope-picker";
import { Input, Select } from "@/components/ui/input";
import { MEDIA_TYPES, mediaLabel, parseMediaParam } from "@/lib/cx/ops/model";
import type { ScopeOptions } from "@/lib/cx/ops/scope-model";
import { DATE_PRESETS, matchPreset, parseDate, presetRange, rangeLabel, SORT_OPTIONS, toggleListValue } from "@/lib/cx/inbox/stream";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACTIVE_ROW, useStreamHref } from "./stream-ui";

/** "Ticket view" = card stream; "split" / "left" = conversational view, left-right aligned or left aligned. */
export type ViewKind = "cards" | "split" | "left";
export type MoreConfig = {
  sentiment?: boolean; status?: [string, string][]; assignees?: [string, string][]; priority?: boolean; tags?: string[]; languages?: [string, string][];
  attach?: boolean; classifications?: [string, string][]; direction?: boolean; kind?: [string, string][];
};
const MORE_KEYS = ["sentiment", "status", "assignee", "priority", "tag", "lang", "attach", "cls", "direction", "kind"] as const;

/**
 * Konnect right-hand FILTER panel: CHANGE VIEW, Topic / Profile scope, date range (dd/mm/yyyy), media-type
 * multi-select, sort, More Filters, then the page's counter cards. All state lives in the URL. Carries
 * `data-focus-hide` so focus mode hides it.
 */
export function StreamPanel({ scopeOptions, mediaCounts, sortOptions = SORT_OPTIONS, defaultSort = "latest", more, view, onView, counters, onClose, className, children }: {
  scopeOptions: ScopeOptions; mediaCounts: { id: string; n: number }[]; sortOptions?: [string, string][]; defaultSort?: string; more: MoreConfig;
  view?: ViewKind; onView?: (v: ViewKind) => void; counters: ReactNode; onClose?: () => void; className?: string; children?: ReactNode;
}) {
  const { href, go, search } = useStreamHref();
  const media = parseMediaParam(search.get("media"));
  const moreActive = MORE_KEYS.filter((k) => search.get(k)).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);
  return (
    <aside data-focus-hide className={cn("flex min-h-0 flex-col bg-bg", className)} aria-label="Filter">
      <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-3">
        <span className="text-[12px] font-bold tracking-[0.14em] text-text uppercase">Filter</span>
        <span className="flex items-center gap-1">
          {onView && <ChangeView value={view ?? "cards"} onChange={onView} />}
          {onClose && <button type="button" onClick={onClose} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Hide filter panel" title="Hide filter panel"><PanelRightClose className="h-4 w-4" /></button>}
        </span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-6">
        <ScopePicker options={scopeOptions} className="w-full" />
        {search.get("brand") && <Link href={`/cx/settings/clusters?brand=${search.get("brand")}`} className="-mt-1 block px-1 text-right text-[11.5px] text-link hover:underline">Manage clusters →</Link>}
        <DateRange from={search.get("from") ?? undefined} to={search.get("to") ?? undefined} onChange={(from, to) => go({ from, to, t: null })} />
        <MediaSelect selected={media} counts={mediaCounts} href={(id) => href({ media: id === null ? null : toggleListValue(media, id), t: null })} />
        <Select value={search.get("sort") ?? defaultSort} onChange={(e) => go({ sort: e.target.value === defaultSort ? null : e.target.value, t: null })} className="h-9 bg-surface text-[13px]" aria-label="Sort">
          {sortOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <button type="button" onClick={() => setMoreOpen((x) => !x)} aria-expanded={moreOpen} className={cn("flex h-9 w-full items-center justify-between rounded-md border bg-surface px-3 text-left text-[13px]", moreActive ? "border-link text-link" : "border-border-strong text-text")}>
          <span>More Filters{moreActive ? ` (${moreActive})` : ""}</span><ChevronDown className={cn("h-4 w-4 text-text-3 transition-transform", moreOpen && "rotate-180")} />
        </button>
        {moreOpen && <MoreFilters more={more} />}
        {children}
        <div className="space-y-5 pt-4">{counters}</div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- CHANGE VIEW

export function ChangeView({ value, onChange }: { value: ViewKind; onChange: (v: ViewKind) => void }) {
  return (
    <span className="relative">
      <MenuButton label={<>Change view<ChevronDown className="h-3 w-3" /></>} buttonClass="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong bg-surface-3 px-2.5 text-[11.5px] font-bold tracking-[0.1em] text-text uppercase hover:bg-surface-2">
        {(close) => (
          <div className="w-60 rounded-md bg-text p-1.5 text-[14px] text-bg shadow-pop" role="menu">
            <ViewItem on={value === "cards"} onClick={() => { close(); onChange("cards"); }}>Ticket view</ViewItem>
            <ViewItem on={value !== "cards"} onClick={() => { close(); onChange(value === "left" ? "left" : "split"); }}>Conversational view</ViewItem>
            <ViewItem sub on={value === "split"} onClick={() => { close(); onChange("split"); }} tip="Customer messages on the left, your team's replies and notes on the right.">Left-Right aligned</ViewItem>
            <ViewItem sub on={value === "left"} onClick={() => { close(); onChange("left"); }} tip="Every message on the left, one under the other, like a transcript.">Left aligned</ViewItem>
          </div>
        )}
      </MenuButton>
    </span>
  );
}
function ViewItem({ children, on, onClick, sub, tip }: { children: ReactNode; on: boolean; onClick: () => void; sub?: boolean; tip?: string }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick} className={cn("flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-bg/15", sub && "pl-6 text-[13px]", on && "font-semibold")}>
      <span className="flex-1">{children}</span>
      {tip && <span title={tip} aria-label={tip} className="inline-flex"><Info className="h-3.5 w-3.5 opacity-80" /></span>}
      {on && <Check className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Small popover button (closes on outside click / Esc). */
function MenuButton({ label, buttonClass, children, full }: { label: ReactNode; buttonClass: string; children: (close: () => void) => ReactNode; full?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className={cn("relative", full && "w-full")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass}>{label}</button>
      {open && <div className={cn("absolute z-50 mt-1", full ? "right-0 left-0" : "right-0")}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- date range

function DateRange({ from, to, onChange }: { from?: string; to?: string; onChange: (from: string | null, to: string | null) => void }) {
  const f = parseDate(from), t = parseDate(to);
  const [a, setA] = useState(f ?? ""), [b, setB] = useState(t ?? "");
  useEffect(() => { setA(f ?? ""); setB(t ?? ""); }, [f, t]);
  const preset = matchPreset(f, t);
  const label = rangeLabel(f, t);
  return (
    <MenuButton full label={<><span className={cn("min-w-0 flex-1 truncate", !label && "text-text-3")}>{label || "dd/mm/yyyy - dd/mm/yyyy"}</span><Calendar className="h-4 w-4 shrink-0 text-text-3" /></>}
      buttonClass={cn("flex h-9 w-full items-center gap-2 rounded-md border bg-surface px-3 text-left text-[13px]", label ? "border-border-strong text-text" : "border-border-strong")}>
      {(close) => (
        <div className="rounded-lg border border-border bg-surface p-2 shadow-pop">
          <div className="grid grid-cols-2 gap-1">
            {DATE_PRESETS.map(([id, l]) => (
              <button key={id} type="button" onClick={() => { const r = presetRange(id)!; close(); onChange(r.from, r.to); }} className={cn("rounded px-2 py-1 text-left text-[12.5px] hover:bg-surface-3", preset === id ? ACTIVE_ROW : "text-text")}>{l}</button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-border pt-2">
            <label className="text-[11.5px] text-text-3">From<Input type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} className="h-8 text-[12.5px]" /></label>
            <label className="text-[11.5px] text-text-3">To<Input type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} className="h-8 text-[12.5px]" /></label>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" className="text-[12px] font-semibold text-text-2 uppercase hover:underline" onClick={() => { close(); onChange(null, null); }}>Clear</button>
            <button type="button" className="rounded bg-brand px-3 py-1 text-[12px] font-semibold text-white uppercase" onClick={() => { close(); onChange(a || null, b || null); }}>Apply</button>
          </div>
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------- media types

function MediaSelect({ selected, counts, href }: { selected: string[]; counts: { id: string; n: number }[]; href: (id: string | null) => string }) {
  const n = (id: string) => counts.find((x) => x.id === id)?.n ?? 0;
  const list = MEDIA_TYPES.filter((m) => m.konnect || n(m.id) > 0 || selected.includes(m.id));
  return (
    <MenuButton full label={<><span className={cn("min-w-0 flex-1 truncate", !selected.length && "text-text")}>{selected.length ? selected.map(mediaLabel).join(", ") : "All media types"}</span><ChevronDown className="h-4 w-4 shrink-0 text-text-3" /></>}
      buttonClass={cn("flex h-9 w-full items-center gap-2 rounded-md border bg-surface px-3 text-left text-[13px]", selected.length ? "border-link text-link" : "border-border-strong")}>
      {() => (
        <div className="scroll-thin max-h-80 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-pop" role="menu" aria-label="Media types">
          {list.map((m) => {
            const on = selected.includes(m.id);
            return (
              <Link key={m.id} href={href(m.id)} scroll={false} role="menuitemcheckbox" aria-checked={on} className="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-surface-3">
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-brand bg-brand text-white" : "border-border-strong")}>{on && <Check className="h-3 w-3" />}</span>
                <span className={cn("min-w-0 flex-1 truncate", n(m.id) ? "text-text" : "text-text-3")}>{m.label}</span>
                <span className="text-[12px] text-text-3 tabular-nums">{num(n(m.id))}</span>
              </Link>
            );
          })}
          {selected.length > 0 && <Link href={href(null)} scroll={false} className="mt-1 block border-t border-border px-2 pt-1.5 pb-1 text-[12px] font-semibold text-link uppercase hover:underline">Clear</Link>}
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------- more filters

function MoreFilters({ more }: { more: MoreConfig }) {
  const { go, search } = useStreamHref();
  const v = (k: string) => search.get(k) ?? "";
  const sel = (k: string, label: string, options: [string, string][]) => (
    <label className="block text-[11.5px] font-medium text-text-3">{label}
      <Select value={v(k)} onChange={(e) => go({ [k]: e.target.value || null, t: null })} className={cn("mt-0.5 h-8 bg-surface text-[12.5px]", v(k) && "border-link text-link")}>
        <option value="">Any</option>
        {v(k) && !options.some(([id]) => id === v(k)) && <option value={v(k)}>{v(k).includes(",") ? `${v(k).split(",").length} selected (counter)` : v(k)}</option>}
        {options.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
      </Select>
    </label>
  );
  const active = MORE_KEYS.filter((k) => search.get(k));
  return (
    <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface p-2.5">
      {more.sentiment && sel("sentiment", "Sentiment", [["positive", "Positive"], ["neutral", "Neutral"], ["negative", "Negative"], ["mixed", "Mixed"]])}
      {more.status && sel("status", "Status", more.status)}
      {more.assignees && sel("assignee", "Assignee", more.assignees)}
      {more.priority && sel("priority", "Priority", [["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]])}
      {more.tags && more.tags.length > 0 && sel("tag", "Tag", more.tags.map((t) => [t, t]))}
      {more.languages && more.languages.length > 0 && sel("lang", "Language", more.languages)}
      {more.classifications && more.classifications.length > 0 && sel("cls", "Classification", more.classifications)}
      {more.direction && sel("direction", "Messages", [["in", "Inbound (default)"], ["out", "Replies sent"], ["note", "Private notes"], ["all", "All messages"]])}
      {more.kind && sel("kind", "Type", more.kind)}
      {more.attach && (
        <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-text-2">
          <input type="checkbox" checked={v("attach") === "1"} onChange={(e) => go({ attach: e.target.checked ? "1" : null, t: null })} className="accent-[var(--brand)]" />Has attachments
        </label>
      )}
      {active.length > 0 && <button type="button" onClick={() => go({ ...Object.fromEntries(active.map((k) => [k, null])), t: null })} className="col-span-2 text-left text-[12px] font-semibold text-link uppercase hover:underline">Clear more filters</button>}
    </div>
  );
}

// ---------------------------------------------------------------- counters

/** Konnect counter card: uppercase title, total in green, rows in a white box. */
export function CounterCard({ title, total, children, empty, totalParens }: { title: string; total?: number | null; children: ReactNode; empty?: string; totalParens?: boolean }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <section>
      <h3 className="mb-2 flex items-center justify-between px-1 text-[12px] font-bold tracking-[0.14em] text-text uppercase">
        <span>{title}</span>
        {total != null && <span className="text-good-ink tabular-nums">{totalParens ? `(${num(total)})` : num(total)}</span>}
      </h3>
      <ul className="rounded-md border border-border bg-surface px-2 py-2.5">
        {rows.length ? children : <li className="px-2 py-1 text-[12.5px] text-text-3">{empty ?? "Nothing in this scope."}</li>}
      </ul>
    </section>
  );
}
export function CounterRow({ label, n, href, active, icon, suffix }: { label: string; n: number; href: string; active?: boolean; icon?: ReactNode; suffix?: ReactNode }) {
  return (
    <li>
      <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={cn("flex items-center gap-2 rounded px-2 py-1 text-[14px]", active ? cn(ACTIVE_ROW, "font-medium") : "text-text hover:bg-surface-3")}>
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        {suffix}
        <span className="ml-auto text-[12.5px] font-semibold text-good-ink tabular-nums">{num(n)}</span>
      </Link>
    </li>
  );
}

/** Agent presence for ACTIVE USERS: green dot online, hollow circle offline, pause bars on break. */
export function PresenceDot({ status }: { status?: string | null }) {
  if (status === "available") return <span className="flex h-4 w-4 shrink-0 items-center justify-center" title="Online"><span className="h-3 w-3 rounded-full border-2 border-good bg-good-soft" /></span>;
  return <Circle className="h-4 w-4 shrink-0 text-text-3" aria-label={status === "break" ? "On break" : "Offline"} />;
}
export function BreakIcon({ status, paused, name }: { status?: string | null; paused?: boolean; name?: string | null }) {
  if (status !== "break" && !paused) return null;
  return <span className="text-[var(--cx-accent,var(--link))]" title={paused ? "Paused in the queue" : `On break${name ? `: ${name}` : ""}`}><Pause className="h-4 w-4" aria-label="On break" /></span>;
}

/** Network glyph (topics get a speech bubble) for PROFILE rows. */
export function ProfileIcon({ network }: { network: string }) {
  return network === "topic" ? <MessageCircle className="h-4 w-4 shrink-0 text-text-2" aria-label="Topic" /> : <NetworkIcon kind={network} className="h-4 w-4 shrink-0 text-text-2" />;
}
