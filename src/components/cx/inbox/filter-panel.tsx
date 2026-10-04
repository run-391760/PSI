"use client";

import { Check, ChevronDown, LayoutGrid, LayoutList, MessagesSquare, PanelRightClose, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Menu } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { mediaLabel, MEDIA_TYPES, parseMediaParam } from "@/lib/cx/ops/model";
import type { PanelCounts, TicketFilters } from "@/lib/cx/inbox/store";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ViewKind = "ticket" | "chat" | "cards";
type Patch = Record<string, string | null>;

const SORTS: [string, string][] = [["latest", "Date – Latest first"], ["oldest", "Date – Oldest first"], ["", "Priority, then latest"], ["sla", "SLA priority – highest first"], ["updated", "Last updated"], ["newest", "Newest created"]];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function preset(id: string): { from: string | null; to: string | null } {
  const now = new Date();
  const back = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return iso(d); };
  if (id === "today") return { from: iso(now), to: iso(now) };
  if (id === "7") return { from: back(6), to: iso(now) };
  if (id === "30") return { from: back(29), to: iso(now) };
  if (id === "90") return { from: back(89), to: iso(now) };
  if (id === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return { from: null, to: null };
}
function currentPreset(from?: string, to?: string) {
  if (!from && !to) return "";
  for (const id of ["today", "7", "30", "90", "month"]) { const p = preset(id); if (p.from === from && p.to === to) return id; }
  return "custom";
}

/**
 * Right-hand FILTER panel of the inbox (Konnect ticket view): change view, profile group, date range, media
 * types, sort, more filters, then clickable counters (Ticketing View, Ticket Status, Active Users, Media Type).
 */
export function FilterPanel({ counts, filters, groups, brand, view, onView, href, go, onMore, moreActive, onClose, className }: {
  counts: PanelCounts; filters: TicketFilters; groups: { id: string; name: string }[]; brand: string; view: ViewKind; onView: (v: ViewKind) => void;
  href: (p: Patch) => string; go: (p: Patch) => void; onMore: () => void; moreActive: number; onClose: () => void; className?: string;
}) {
  const media = parseMediaParam(filters.media);
  const toggleMedia = (id: string) => { const next = media.includes(id) ? media.filter((x) => x !== id) : [...media, id]; return { media: next.length ? next.join(",") : null, t: null }; };
  const pr = currentPreset(filters.from, filters.to);
  const mediaOptions = [...new Set([...counts.media.map((m) => m.id), ...media])];
  const st = filters.status ?? "";
  const viewName = filters.view ?? "open";
  const VIEW_LABEL: Record<ViewKind, string> = { ticket: "Ticket view", chat: "Chat view", cards: "Card view" };
  return (
    <aside className={cn("flex min-h-0 flex-col bg-surface", className)} aria-label="Filters and counters">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11.5px] font-semibold tracking-wider text-text-2 uppercase">Filter</span>
        <div className="flex items-center gap-1">
          <Menu align="right" trigger={() => (
            <span className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong px-2 text-[12px] text-text-2 hover:bg-surface-3">Change view: {VIEW_LABEL[view]}<ChevronDown className="h-3 w-3" /></span>
          )}>
            {(close) => (
              <div className="w-52 p-1 text-[12.5px]">
                {([["ticket", "Ticket view", LayoutList, "List + conversation"], ["chat", "Chat view", MessagesSquare, "Messenger-style list"], ["cards", "Card view", LayoutGrid, "Ticket cards with actions"]] as const).map(([id, label, I, hint]) => (
                  <button key={id} type="button" onClick={() => { close(); onView(id); }} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-3">
                    <I className="mt-0.5 h-3.5 w-3.5 text-text-3" />
                    <span className="min-w-0 flex-1"><span className="block text-text">{label}</span><span className="block text-[11.5px] text-text-3">{hint}</span></span>
                    {view === id && <Check className="mt-0.5 h-3.5 w-3.5 text-link" />}
                  </button>
                ))}
              </div>
            )}
          </Menu>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Hide filter panel" title="Hide filter panel"><PanelRightClose className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="space-y-2">
          <label className="block text-[11.5px] font-medium text-text-3">Profile group
            <Select value={filters.group ?? "all"} onChange={(e) => go({ group: e.target.value, t: null })} className={cn("mt-0.5 h-8 text-[12.5px]", filters.group && filters.group !== "all" && "border-link text-link")}>
              <option value="all">All profiles</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </label>
          <Link href={`/cx/settings/profile-groups?brand=${brand}`} className="-mt-1 inline-block pb-1 text-[11.5px] text-link hover:underline">Manage profile groups →</Link>
          <label className="block text-[11.5px] font-medium text-text-3">Date range
            <Select value={pr} onChange={(e) => { const v = e.target.value; if (v === "custom") return go({ from: filters.from ?? preset("30").from, to: filters.to ?? preset("30").to, t: null }); go({ ...preset(v), t: null }); }} className={cn("mt-0.5 h-8 text-[12.5px]", pr && "border-link text-link")}>
              <option value="">Any time</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="month">This month</option><option value="custom">Custom range…</option>
            </Select>
          </label>
          {pr === "custom" && (
            <div className="grid grid-cols-2 gap-1.5">
              <Input type="date" aria-label="From" value={filters.from ?? ""} onChange={(e) => go({ from: e.target.value || null, t: null })} className="h-7 text-[12px]" />
              <Input type="date" aria-label="To" value={filters.to ?? ""} onChange={(e) => go({ to: e.target.value || null, t: null })} className="h-7 text-[12px]" />
            </div>
          )}
          <MediaSelect media={media} counts={counts} mediaOptions={mediaOptions} href={href} toggleMedia={toggleMedia} />
          <label className="block text-[11.5px] font-medium text-text-3">Sort
            <Select value={filters.sort ?? ""} onChange={(e) => go({ sort: e.target.value || null, t: null })} className="mt-0.5 h-8 text-[12.5px]">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </label>
          <button type="button" onClick={onMore} className={cn("inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px]", moreActive ? "border-link text-link" : "border-border-strong text-text-2 hover:bg-surface-3")}>
            <SlidersHorizontal className="h-3 w-3" />More filters{moreActive ? ` (${moreActive})` : ""}
          </button>
        </div>

        <Counter title="Ticketing view">
          <Row label="Responded tickets" n={counts.responded} active={st === "responded"} href={href({ status: st === "responded" ? null : "responded", view: "all", t: null })} />
          <Row label="All tickets" n={counts.total} active={viewName === "all" && !st} href={href({ view: "all", status: null, t: null })} />
        </Counter>
        <Counter title="Ticket status">
          <Row label="Opened" n={counts.status.open} active={viewName === "open" && !st} href={href({ view: null, status: null, t: null })} />
          <Row label="New" n={counts.status.new} sub active={st === "new"} href={href({ status: st === "new" ? null : "new", view: null, t: null })} />
          <Row label="Assigned" n={counts.status.assigned} sub active={st === "assigned"} href={href({ status: st === "assigned" ? null : "assigned", view: null, t: null })} />
          <Row label="WIP" n={counts.status.wip} sub active={st === "wip"} href={href({ status: st === "wip" ? null : "wip", view: null, t: null })} />
          <Row label="Pending / on hold" n={counts.status.pending} active={viewName === "pending" && !st} href={href({ view: "pending", status: null, t: null })} />
          <Row label="Resolved" n={counts.status.resolved} active={st === "solved"} href={href({ status: st === "solved" ? null : "solved", view: "all", t: null })} />
          <Row label="Closed" n={counts.status.closed} active={st === "closed"} href={href({ status: st === "closed" ? null : "closed", view: "all", t: null })} />
        </Counter>
        <Counter title="Active users">
          <Row label="Queue unassigned" n={counts.unassigned} active={filters.assignee === "none"} href={href({ assignee: filters.assignee === "none" ? null : "none", t: null })} tone={counts.unassigned ? "warn" : undefined} />
          {counts.agents.length === 0 && <p className="px-1 text-[11.5px] text-text-3">No open tickets assigned yet.</p>}
          {counts.agents.map((a) => <Row key={a.id} label={a.name} n={a.n} active={filters.assignee === a.id} href={href({ assignee: filters.assignee === a.id ? null : a.id, t: null })} />)}
        </Counter>
        <Counter title="Media type">
          {counts.media.length === 0 && <p className="px-1 text-[11.5px] text-text-3">No tickets in this scope.</p>}
          {counts.media.map((m) => <Row key={m.id} label={mediaLabel(m.id)} n={m.n} active={media.includes(m.id)} href={href(toggleMedia(m.id))} />)}
        </Counter>
        <p className="text-[11px] text-text-3">Counters follow the profile group, dates, search and other filters; status, user and media counters stay clickable across each other.</p>
      </div>
    </aside>
  );
}

function MediaSelect({ media, counts, mediaOptions, href, toggleMedia }: { media: string[]; counts: PanelCounts; mediaOptions: string[]; href: (p: Patch) => string; toggleMedia: (id: string) => Patch }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[11.5px] font-medium text-text-3">
      Media type
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn("mt-0.5 flex h-8 w-full items-center justify-between gap-1 rounded-md border bg-surface px-2 text-left text-[12.5px] font-normal", media.length ? "border-link text-link" : "border-border-strong text-text")}>
        <span className="truncate">{media.length ? media.map(mediaLabel).join(", ") : "All media types"}</span><ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="scroll-thin mt-1 max-h-64 overflow-y-auto rounded-md border border-border p-1 text-[12.5px] font-normal">
          {MEDIA_TYPES.filter((m) => m.id !== "other" || mediaOptions.includes("other")).map((m) => {
            const n = counts.media.find((x) => x.id === m.id)?.n ?? 0;
            const on = media.includes(m.id);
            return (
              <Link key={m.id} href={href(toggleMedia(m.id))} scroll={false} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-surface-3" role="menuitemcheckbox" aria-checked={on}>
                <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border", on ? "border-link bg-brand text-brand-ink" : "border-border-strong")}>{on && <Check className="h-2.5 w-2.5" />}</span>
                <span className={cn("min-w-0 flex-1 truncate", n ? "text-text" : "text-text-3")}>{m.label}</span><span className="text-text-3 tabular-nums">{num(n)}</span>
              </Link>
            );
          })}
          {media.length > 0 && <Link href={href({ media: null, t: null })} className="mt-1 block border-t border-border px-1.5 pt-1.5 text-link hover:underline">Clear media types</Link>}
        </div>
      )}
    </div>
  );
}

function Counter({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-2.5">
      <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-text-3 uppercase">{title}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}
function Row({ label, n, href, active, sub, tone }: { label: string; n: number; href: string; active?: boolean; sub?: boolean; tone?: "warn" }) {
  return (
    <li>
      <Link href={href} scroll={false} className={cn("flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px]", sub && "pl-4", active ? "bg-brand-soft font-medium text-link" : "text-text-2 hover:bg-surface-3")} aria-current={active ? "true" : undefined}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <X className="h-3 w-3" aria-label="Remove filter" />}
        <span className={cn("tabular-nums", tone === "warn" ? "text-warning-ink" : active ? "text-link" : "text-text")}>{num(n)}</span>
      </Link>
    </li>
  );
}
