"use client";

import { AlarmClock, ArrowUpRight, Download, Expand, Filter, GitBranch, Inbox, ListOrdered, MessagesSquare, Paperclip, Plus, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { Segmented } from "@/components/ui/tabs";
import { mergeAction, newTicketAction, updateTicketsAction } from "@/app/(app)/cx/inbox/actions";
import { runQuickActionAction } from "@/app/(app)/cx/settings/automation/admin-actions";
import type { Signals } from "@/lib/cx/insights/signals";
import type { ClassificationNode, FieldDef } from "@/lib/cx/admin/fields";
import { applySuggestion, CRM_STATUSES, crmLabel, searchSuggestions, SETTABLE_STATUSES, toPlainText, type InboxPrefs, type InboxSettings } from "@/lib/cx/inbox/model";
import type { Agent, Canned, PanelCounts, TicketDetail, TicketFilters, TicketListRow, View } from "@/lib/cx/inbox/store";
import type { Task } from "@/lib/cx/ops/tasks";
import { formatSpan } from "@/lib/cx/inbox/sla";
import { dateTimeLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Conversation } from "./conversation";
import { BreakIcon, CounterCard, CounterRow, PresenceDot, ProfileIcon, StreamPanel, type MoreConfig, type ViewKind } from "./filter-panel";
import { StreamCard } from "./stream-card";
import { StreamProvider, type AgentState } from "./stream-ui";
import type { ScopeOptions } from "@/lib/cx/ops/scope-model";
import { MEDIA_TYPES } from "@/lib/cx/ops/model";
import { profilePatch, sameStatusList, selectedProfileKey, statusBuckets, ticketCard, ticketHref, TICKET_SORT_OPTIONS, toggleListValue } from "@/lib/cx/inbox/stream";
import { playAlert, PrefsProvider, useNewItems, usePrefs } from "./prefs";
import { SettingsDialog } from "./ticket-dialogs";
import { Ago, SlaChip } from "./time";
import { Avatar, ChannelIcon, channelLabel, PriorityBadge, StatusBadge } from "./ui";

const VIEW_LABELS: { id: View; label: string }[] = [
  { id: "open", label: "All open" },
  { id: "mine", label: "My tasks" },
  { id: "unassigned", label: "Unassigned" },
  { id: "pending", label: "Pending" },
  { id: "breached", label: "SLA breached" },
  { id: "solved", label: "Resolved" },
  { id: "all", label: "All" },
];
const SORTS: [string, string][] = [["", "Priority, then latest"], ["latest", "Date – Latest first"], ["sla", "SLA priority – highest first"], ["updated", "Last updated"], ["newest", "Newest first"], ["oldest", "Oldest first"]];
const MORE_KEYS = ["from", "to", "profile", "topic", "severity", "escalated", "email", "assignee"] as const;

type Stats = { open: number; unassigned: number; breached: number; created_7d: number; solved_7d: number; frt_min: number | null; csat: number | null; csat_n: number };
export type InboxProps = {
  brand: { id: string; name: string };
  me: { id: string; name: string };
  role: string;
  filters: TicketFilters;
  tickets: TicketListRow[];
  counts: Record<View, number>;
  stats: Stats;
  agents: Agent[];
  teams: string[];
  tags: string[];
  canned: Canned[];
  channels: { id: string; kind: string; name: string }[];
  topics: { id: string; name: string }[];
  severities: string[];
  selected: TicketDetail | null;
  ai: boolean;
  prefs: InboxPrefs;
  settings: InboxSettings;
  signature: { body: string; imageFileId: string | null; imageUrl: string | null; enabled: boolean };
  hasSignature: boolean;
  hasEmail: boolean;
  emailSuggestions: string[];
  fieldDefs: FieldDef[];
  tree: ClassificationNode[];
  signals: Signals | null;
  quickActions: { id: string; name: string; description: string }[];
  /** WP-B: clusters (profile groups), filter-panel counters, the selected ticket's tasks/bookmarks, a card action to open (?act=). */
  groups: { id: string; name: string }[];
  panel: PanelCounts;
  ops: { tasks: Task[]; bookmarks: { ticket: boolean; messages: string[] } } | null;
  act: string | null;
  /** WP-K2: Topic / Profile picker options, agent presence for ACTIVE USERS, More Filters options. */
  scopeOptions: ScopeOptions;
  agentStates: AgentState[];
  more: MoreConfig;
};

export function InboxClient(props: InboxProps) {
  return (
    <PrefsProvider brand={props.brand.id} initial={props.prefs}>
      <InboxInner {...props} />
    </PrefsProvider>
  );
}

function InboxInner(props: InboxProps) {
  const { brand, filters, tickets, counts, stats, selected } = props;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { prefs, setPrefs } = usePrefs();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const activeMore = MORE_KEYS.filter((k) => filters[k]);
  const [moreOpen, setMoreOpen] = useState(activeMore.length > 0);
  const cards = prefs.mode === "cards";
  const viewKind: ViewKind = cards ? "cards" : prefs.align;

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    if (!("act" in patch)) p.delete("act");
    return `${pathname}?${p.toString()}`;
  };
  const go = (patch: Record<string, string | null>) => router.push(href(patch), { scroll: false });
  const setView = (v: ViewKind) => setPrefs(v === "cards" ? { mode: "cards" } : { mode: "split", align: v });
  const toggleFilters = () => {
    if (cards && !selected && window.matchMedia("(min-width: 1024px)").matches) setPrefs({ panel: !prefs.panel });
    else setDrawer(true);
  };
  const streamCtx = { brand: brand.id, me: props.me, agents: props.agents, agentStates: props.agentStates, tree: props.tree, readOnly: props.role === "viewer" };

  // Live list: refresh every 20 s (new chats / emails / SLA changes).
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => setChecked((c) => new Set([...c].filter((id) => tickets.some((t) => t.id === id)))), [tickets]);
  // Sound alert on new tickets (My profile → "Alert me on new tickets").
  useNewItems(tickets.filter((t) => t.crm_status === "new").map((t) => t.id), () => { if (prefs.soundNewTicket) playAlert("ticket"); });

  const sel = tickets.filter((t) => checked.has(t.id));
  const bulk = async (patch: Parameters<typeof updateTicketsAction>[2]) => {
    setError(null);
    const r = await updateTicketsAction(brand.id, [...checked], patch);
    if (!r.ok) setError(r.error);
    else setChecked(new Set());
    router.refresh();
  };
  const channelKinds = useMemo(() => [...new Set([...props.channels.map((c) => c.kind), ...tickets.map((t) => t.channel_kind)])], [props.channels, tickets]);
  const activeFilters = (["channel", "priority", "status", "team", "tag", "sentiment", "group", "media", "post", ...MORE_KEYS] as const).filter((k) => filters[k] && !(k === "group" && filters[k] === "all"));
  const exportQs = new URLSearchParams([...search.entries()].filter(([k]) => !["t", "ticket", "act"].includes(k)));
  exportQs.set("brand", brand.id);
  const onCheck = (id: string) => (v: boolean) => setChecked((c) => { const n = new Set(c); if (v) n.add(id); else n.delete(id); return n; });
  const groupName = props.groups.find((g) => g.id === filters.group)?.name;
  const staticPanel = cards && !selected && prefs.panel;
  const pc = props.panel;
  const media = (filters.media ?? "").split(",").filter(Boolean);
  const pkey = selectedProfileKey(filters);
  const buckets = statusBuckets(pc.crm ?? {});
  const view = filters.view ?? "open";
  const presence = (id: string) => props.agentStates.find((a) => a.id === id);
  const counters = (
    <>
      <CounterCard title="Ticketing view">
        <CounterRow label="Responded Tickets" n={pc.crm?.responded ?? pc.responded} active={filters.status === "responded"} href={href(filters.status === "responded" ? { status: null, view: null, t: null } : { status: "responded", view: "all", t: null })} />
        <CounterRow label="My Tickets" n={counts.mine ?? 0} active={view === "mine" && !filters.status} href={href({ view: view === "mine" ? null : "mine", status: null, t: null })} />
        <CounterRow label="SLA Breached" n={counts.breached ?? 0} active={view === "breached"} href={href({ view: view === "breached" ? null : "breached", status: null, t: null })} />
      </CounterCard>
      <CounterCard title="Ticket status" total={buckets.reduce((a, b) => a + b.n, 0)}>
        {buckets.map((b) => {
          const on = sameStatusList(filters.status, b.value);
          return <CounterRow key={b.id} label={b.label} n={b.n} active={on} href={href(on ? { status: null, view: null, t: null } : { status: b.value, view: "all", t: null })} />;
        })}
      </CounterCard>
      <CounterCard title="Active users" total={pc.unassigned + pc.agents.reduce((a, x) => a + x.n, 0)}>
        <CounterRow label="Queue UnAssigned" n={pc.unassigned} icon={<PresenceDot status={null} />} active={filters.assignee === "none"} href={href({ assignee: filters.assignee === "none" ? null : "none", t: null })} />
        {pc.agents.map((a) => {
          const st = presence(a.id);
          return <CounterRow key={a.id} label={a.name} n={a.n} icon={<PresenceDot status={st?.status} />} suffix={<BreakIcon status={st?.status} paused={st?.paused} name={st?.statusName} />} active={filters.assignee === a.id} href={href({ assignee: filters.assignee === a.id ? null : a.id, t: null })} />;
        })}
      </CounterCard>
      <CounterCard title="Media type" total={pc.total}>
        {MEDIA_TYPES.filter((m) => pc.media.some((x) => x.id === m.id && x.n > 0) || media.includes(m.id)).map((m) => (
          <CounterRow key={m.id} label={m.label} n={pc.media.find((x) => x.id === m.id)?.n ?? 0} active={media.includes(m.id)} href={href({ media: toggleListValue(media, m.id), t: null })} />
        ))}
      </CounterCard>
      <CounterCard title="Profile" total={pc.total}>
        {(pc.profiles ?? []).map((p) => <CounterRow key={p.key} label={p.name} n={p.n} icon={<ProfileIcon network={p.network} />} active={pkey === p.key} href={href({ ...(pkey === p.key ? { profile: null, topic: null, channel: null } : profilePatch(p.key)), t: null })} />)}
      </CounterCard>
    </>
  );
  const panelEl = (onClose: () => void, className: string) => (
    <StreamPanel scopeOptions={props.scopeOptions} mediaCounts={pc.media} sortOptions={TICKET_SORT_OPTIONS} more={props.more} view={viewKind} onView={setView} counters={counters} onClose={onClose} className={className} />
  );

  const header = (
    <div className="space-y-2 border-b border-border p-3">
      <div className="flex items-center gap-1.5">
        <SearchBox initial={filters.q ?? ""} fields={props.fieldDefs} onSearch={(q) => go({ q: q || null, t: null })} />
        <Button size="sm" variant="primary" onClick={() => setNewOpen(true)} aria-label="New ticket" disabled={props.role === "viewer"}><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">New</span></Button>
        <button onClick={toggleFilters} className={cn("inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[12.5px]", staticPanel ? "border-link text-link" : "border-border-strong text-text-2 hover:bg-surface-3")} aria-label="Filter panel" title="Filter panel: clusters, topics and profiles, dates, media types, counters">
          <Filter className="h-3.5 w-3.5" /><span className="hidden xl:inline">Filters</span>
        </button>
        <button onClick={() => setSettingsOpen(true)} className="rounded-md border border-border-strong p-1.5 text-text-2 hover:bg-surface-3" aria-label="Inbox settings" title="Inbox settings (view, sounds, signature, ticket settings)"><Settings2 className="h-4 w-4" /></button>
      </div>
      <nav className="scroll-thin flex gap-1 overflow-x-auto pb-0.5 sm:flex-wrap" aria-label="Views">
        {VIEW_LABELS.map((v) => (
          <Link key={v.id} href={href({ view: v.id === "open" ? null : v.id, t: null })} scroll={false} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]", (filters.view ?? "open") === v.id ? "border-link bg-brand-soft font-medium text-link" : "border-border text-text-2 hover:bg-surface-3")}>
            {v.label}
            <span className={cn("tabular-nums", v.id === "breached" && counts[v.id] > 0 ? "text-critical-ink" : "text-text-3")}>{counts[v.id] ?? 0}</span>
          </Link>
        ))}
        <Link href={`/cx/inbox/queued?brand=${brand.id}`} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-3"><ListOrdered className="h-3 w-3" />Queued</Link>
      </nav>
      <div className="flex flex-wrap gap-1.5">
        <FilterSelect label="Channel" value={filters.channel} onChange={(v) => go({ channel: v, t: null })} options={channelKinds.map((k) => [k, channelLabel(k)])} />
        <FilterSelect label="Status" value={filters.status} onChange={(v) => go({ status: v, t: null })} options={CRM_STATUSES.map((s) => [s.id, s.label])} />
        <FilterSelect label="Priority" value={filters.priority} onChange={(v) => go({ priority: v, t: null })} options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} />
        <FilterSelect label="Sentiment" value={filters.sentiment} onChange={(v) => go({ sentiment: v, t: null })} options={[["negative", "Negative"], ["neutral", "Neutral"], ["positive", "Positive"], ["mixed", "Mixed"]]} />
        {props.teams.length > 0 && <FilterSelect label="Team" value={filters.team} onChange={(v) => go({ team: v, t: null })} options={props.teams.map((t) => [t, t])} />}
        {props.tags.length > 0 && <FilterSelect label="Tag" value={filters.tag} onChange={(v) => go({ tag: v, t: null })} options={props.tags.map((t) => [t, t])} />}
        <button onClick={() => setMoreOpen((x) => !x)} className={cn("inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px]", moreOpen || activeMore.length ? "border-link text-link" : "border-border-strong text-text-2 hover:bg-surface-3")} aria-expanded={moreOpen}>
          <SlidersHorizontal className="h-3 w-3" />More filters{activeMore.length ? ` (${activeMore.length})` : ""}
        </button>
        {(activeFilters.length > 0 || filters.q) && (
          <button className="inline-flex items-center gap-1 px-1 text-[12px] text-link hover:underline" onClick={() => go({ channel: null, priority: null, status: null, team: null, tag: null, sentiment: null, q: null, t: null, group: props.groups.length ? "all" : null, media: null, post: null, ...Object.fromEntries(MORE_KEYS.map((k) => [k, null])) })}>
            <X className="h-3 w-3" />Clear
          </button>
        )}
      </div>
      {moreOpen && (
        <div className={cn("grid grid-cols-2 gap-1.5 rounded-md bg-surface-2 p-2", cards && "sm:grid-cols-4")}>
          <label className="text-[11.5px] text-text-3">From<Input type="date" value={filters.from ?? ""} onChange={(e) => go({ from: e.target.value || null, t: null })} className="h-7 text-[12px]" /></label>
          <label className="text-[11.5px] text-text-3">To<Input type="date" value={filters.to ?? ""} onChange={(e) => go({ to: e.target.value || null, t: null })} className="h-7 text-[12px]" /></label>
          <FilterSelect label="Any profile" value={filters.profile} onChange={(v) => go({ profile: v, t: null })} options={props.channels.map((c) => [c.id, `${c.name} (${channelLabel(c.kind)})`])} />
          <FilterSelect label="Any topic" value={filters.topic} onChange={(v) => go({ topic: v, t: null })} options={props.topics.map((t) => [t.id, t.name])} />
          <FilterSelect label="Any severity" value={filters.severity} onChange={(v) => go({ severity: v, t: null })} options={props.severities.map((s) => [s, s])} />
          <FilterSelect label="Any assignee" value={filters.assignee} onChange={(v) => go({ assignee: v, t: null })} options={[["none", "Unassigned"], ...props.agents.map((a) => [a.id, a.name] as [string, string])]} />
          <FilterSelect label="Escalated or not" value={filters.escalated} onChange={(v) => go({ escalated: v, t: null })} options={[["1", "Escalated"], ["0", "Not escalated"]]} />
          <FilterSelect label="Any email state" value={filters.email} onChange={(v) => go({ email: v, t: null })} options={[["sent", "Email sent, no reply"], ["received", "Reply received"], ["not_sent", "No email sent"]]} />
          <Select value={filters.sort ?? ""} onChange={(e) => go({ sort: e.target.value || null, t: null })} className={cn("col-span-2 h-7 py-0 text-[12px]", filters.sort && "border-link text-link")} aria-label="Sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </Select>
        </div>
      )}
      {filters.post && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-info-soft px-2.5 py-1.5 text-[12.5px] text-text-2">
          <MessagesSquare className="h-3.5 w-3.5 text-link" />
          <span className="flex-1">All comments and tickets on this post ({tickets.length}).</span>
          {tickets.find((t) => t.post_key === filters.post)?.post_url && <a href={tickets.find((t) => t.post_key === filters.post)!.post_url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">Open post<ArrowUpRight className="h-3 w-3" /></a>}
          <Link href={href({ post: null, t: null })} className="inline-flex items-center gap-0.5 text-link hover:underline"><X className="h-3 w-3" />Clear</Link>
        </div>
      )}
      {groupName && <div className="text-[11.5px] text-text-3">Profile group: <span className="font-medium text-text-2">{groupName}</span></div>}
    </div>
  );

  const cardHeader = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <SearchBox initial={filters.q ?? ""} fields={props.fieldDefs} onSearch={(q) => go({ q: q || null, t: null })} />
      <Button variant="primary" onClick={() => setNewOpen(true)} aria-label="New ticket" disabled={props.role === "viewer"}><Plus className="h-4 w-4" /><span className="hidden sm:inline">New ticket</span></Button>
      <button onClick={toggleFilters} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border bg-surface px-3 text-[13px]", staticPanel ? "border-link text-link lg:hidden" : "border-border-strong text-text-2 hover:bg-surface-3")} aria-label="Filter panel"><Filter className="h-4 w-4" />Filter</button>
      <Menu align="right" trigger={() => <span className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-2.5 text-text-2 hover:bg-surface-3" title="Export"><Download className="h-4 w-4" /></span>}>
        {(close) => (
          <div className="w-56 p-1 text-[12.5px]">
            <a onClick={close} href={`/api/cx/inbox/export?${exportQs.toString()}`} className="block rounded px-2 py-1.5 text-text hover:bg-surface-3">Export matching tickets (Excel)</a>
            <a onClick={close} href={`/api/cx/inbox/export?${exportQs.toString()}&format=csv`} className="block rounded px-2 py-1.5 text-text hover:bg-surface-3">Export matching tickets (CSV)</a>
          </div>
        )}
      </Menu>
      <button onClick={() => setSettingsOpen(true)} className="rounded-md border border-border-strong bg-surface p-2 text-text-2 hover:bg-surface-3" aria-label="Inbox settings" title="Inbox settings"><Settings2 className="h-4 w-4" /></button>
      {(activeFilters.length > 0 || filters.q || (filters.view && filters.view !== "open")) && (
        <div className="flex w-full flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-text-3">{tickets.length}{tickets.length >= 300 ? "+" : ""} ticket{tickets.length === 1 ? "" : "s"}</span>
          {filters.post && <Link href={href({ post: null, t: null })} className="inline-flex items-center gap-1 rounded-full border border-link/40 bg-brand-soft px-2 py-0.5 text-link"><MessagesSquare className="h-3 w-3" />Same post<X className="h-3 w-3" /></Link>}
          <button className="inline-flex items-center gap-1 px-1 text-link hover:underline" onClick={() => go({ channel: null, priority: null, status: null, team: null, tag: null, sentiment: null, q: null, t: null, view: null, media: null, post: null, profile: null, topic: null, scope: null, lang: null, attach: null, cls: null, ...Object.fromEntries(MORE_KEYS.map((k) => [k, null])) })}><X className="h-3 w-3" />Clear all filters</button>
        </div>
      )}
    </div>
  );

  const bulkBar = checked.size > 0 && props.role !== "viewer" && (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-2 px-3 py-2 text-[12.5px]">
      <span className="font-medium text-text">{checked.size} selected</span>
      <Button size="sm" variant="ghost" onClick={() => bulk({ assignee_id: props.me.id })}>Assign to me</Button>
      <Button size="sm" variant="ghost" onClick={() => bulk({ status: "solved" })}>Resolve</Button>
      <BulkSelect label="Status" onPick={(v) => bulk({ status: v as TicketListRow["crm_status"] })} options={SETTABLE_STATUSES.filter((s) => s.id !== "new").map((s) => [s.id, s.label])} />
      <BulkSelect label="Priority" onPick={(v) => bulk({ priority: v as TicketListRow["priority"] })} options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} />
      {props.severities.length > 0 && <BulkSelect label="Severity" onPick={(v) => bulk({ severity: v === "-" ? null : v })} options={[["-", "Not set"], ...props.severities.map((s) => [s, s] as [string, string])]} />}
      <BulkSelect label="Assign" onPick={(v) => bulk({ assignee_id: v === "-" ? null : v })} options={[["-", "Unassigned"], ...props.agents.map((a) => [a.id, a.name] as [string, string])]} />
      {props.teams.length > 0 && <BulkSelect label="Team" onPick={(v) => bulk({ team: v === "-" ? null : v })} options={[["-", "No team"], ...props.teams.map((t) => [t, t] as [string, string])]} />}
      <BulkTag onAdd={(tag) => bulk({ addTags: [tag] })} />
      {props.quickActions.length > 0 && <BulkSelect label="Quick action" onPick={async (id) => {
        setError(null);
        const r = await runQuickActionAction(brand.id, id, [...checked]);
        if (!r.ok) setError(r.error); else { if (r.data.failed) setError(`${r.data.failed} of ${r.data.tickets + r.data.failed} tickets could not be updated.`); setChecked(new Set()); }
        router.refresh();
      }} options={props.quickActions.map((q) => [q.id, q.name] as [string, string])} />}
      {sel.length >= 2 && (
        <Button size="sm" variant="ghost" onClick={async () => {
          const target = [...sel].sort((a, b) => a.number - b.number)[0];
          const r = await mergeAction(brand.id, target.id, sel.filter((t) => t.id !== target.id).map((t) => t.id));
          if (!r.ok) setError(r.error); else { setChecked(new Set()); go({ t: target.id }); }
        }}>Merge into #{Math.min(...sel.map((t) => t.number))}</Button>
      )}
      <a className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-text-2 hover:bg-surface-3" href={`/api/cx/inbox/export?brand=${brand.id}&ids=${[...checked].join(",")}`}><Download className="h-3.5 w-3.5" />Excel</a>
      <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
    </div>
  );

  const listToolbar = (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] text-text-3">
      <Checkbox checked={tickets.length > 0 && checked.size === tickets.length} onChange={(e) => setChecked(e.target.checked ? new Set(tickets.map((t) => t.id)) : new Set())} aria-label="Select all" />
      <span className="flex-1">{tickets.length} ticket{tickets.length === 1 ? "" : "s"}{tickets.length >= 300 ? " (first 300)" : ""}</span>
      <Segmented value={prefs.layout} onChange={(v) => setPrefs({ layout: v })} options={[{ value: "ticket", label: "List" }, { value: "chat", label: "Chat" }]} />
      <button type="button" onClick={() => setView("cards")} className="inline-flex h-6 items-center rounded px-1.5 text-[12px] text-link hover:bg-surface-3" title="Ticket view (Konnect cards)">Cards</button>
      <Menu align="right" trigger={() => <span className="inline-flex h-6 items-center rounded px-1 hover:bg-surface-3" title="Export"><Download className="h-3.5 w-3.5" /></span>}>
        {(close) => (
          <div className="w-56 p-1 text-[12.5px]">
            <a onClick={close} href={`/api/cx/inbox/export?${exportQs.toString()}`} className="block rounded px-2 py-1.5 text-text hover:bg-surface-3">Export matching tickets (Excel)</a>
            <a onClick={close} href={`/api/cx/inbox/export?${exportQs.toString()}&format=csv`} className="block rounded px-2 py-1.5 text-text hover:bg-surface-3">Export matching tickets (CSV)</a>
          </div>
        )}
      </Menu>
    </div>
  );
  const empty = <EmptyState icon={<Inbox className="h-5 w-5" />} title={filters.q || activeFilters.length ? "No tickets match" : "Nothing here"} description={props.channels.length ? "New conversations from your channels appear here." : "Connect email, live chat or a web form to start receiving conversations."} action={props.channels.length ? undefined : <Link className="text-[13px] text-link hover:underline" href={`/cx/settings/channels?brand=${brand.id}`}>Connect a channel →</Link>} />;

  return (
    <div className="space-y-4">
      <div data-focus-hide>
      <MetricStrip className={cn("grid-cols-2 divide-y-0 rounded-lg border border-border bg-surface sm:grid-flow-row sm:grid-cols-3 sm:divide-x-0 xl:grid-flow-col xl:grid-cols-none xl:divide-x", selected && "hidden lg:grid")}>
        <Metric label="Open" value={num(stats.open)} size="sm" href={href({ view: "open", t: null })} />
        <Metric label="Unassigned" value={num(stats.unassigned)} size="sm" href={href({ view: "unassigned", t: null })} />
        <Metric label="SLA breached" value={num(stats.breached)} size="sm" href={href({ view: "breached", t: null })} info="Open tickets past their first-response or resolution due time." />
        <Metric label="Median first response" value={stats.frt_min == null ? "n/a" : formatSpan(stats.frt_min * 60_000)} size="sm" sub="last 30 days" />
        <Metric label="Created / resolved (7d)" value={`${num(stats.created_7d)} / ${num(stats.solved_7d)}`} size="sm" />
        <Metric label="CSAT" value={stats.csat == null ? "n/a" : `${stats.csat.toFixed(1)} / 5`} size="sm" sub={stats.csat_n ? `${stats.csat_n} ratings` : "no ratings yet"} />
      </MetricStrip>
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {cards && !selected ? (
            /* ---------------------------------------------------------------- card view */
            <section aria-label="Tickets">
              {cardHeader}
              {error && <Callout tone="critical" className="mb-2">{error}</Callout>}
              {tickets.length === 0 ? <div className="rounded-md border border-border bg-surface">{empty}</div> : (
                <StreamProvider value={streamCtx}>
                  <ul className="space-y-3">
                    {tickets.map((t) => <StreamCard key={t.id} c={ticketCard(t)} variant="ticket" />)}
                  </ul>
                  {tickets.length >= 300 && <p className="mt-3 text-center text-[12.5px] text-text-3">Showing the first 300 tickets. Narrow the date range or filters to see others.</p>}
                </StreamProvider>
              )}
            </section>
          ) : (
            <div className="flex min-h-[600px] overflow-hidden rounded-lg border border-border bg-surface shadow-card lg:h-[calc(100dvh-260px)]">
              {/* ---------------------------------------------------------------- list */}
              <section className={cn("flex w-full min-w-0 flex-col border-border lg:w-[410px] lg:shrink-0 lg:border-r", selected && "hidden lg:flex", cards && selected && "lg:hidden")} aria-label="Tickets">
                {header}
                {bulkBar}
                {error && <Callout tone="critical" className="m-2">{error}</Callout>}
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                  {tickets.length === 0 ? empty : (
                    <>
                      {listToolbar}
                      <ul>
                        {tickets.map((t) => {
                          const p = { t, active: selected?.ticket.id === t.id, checked: checked.has(t.id), onCheck: onCheck(t.id), href: href({ t: t.id, ticket: null }), full: ticketHref(brand.id, t.id) };
                          return prefs.layout === "chat" ? <ChatItem key={t.id} {...p} /> : <TicketItem key={t.id} {...p} />;
                        })}
                      </ul>
                    </>
                  )}
                </div>
              </section>

              {/* ---------------------------------------------------------------- conversation */}
              <section className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden lg:flex")} aria-label="Conversation">
                {selected ? (
                  <Conversation key={selected.ticket.id} {...props} detail={selected} backHref={href({ t: null, ticket: null })} />
                ) : (
                  <EmptyState className="my-auto" icon={<Inbox className="h-5 w-5" />} title="Select a conversation" description="Pick a ticket on the left to read the thread, reply, add notes and update its status." />
                )}
              </section>
            </div>
          )}
        </div>
        {staticPanel && <div data-focus-hide className="sticky top-4 hidden max-h-[calc(100dvh-6rem)] w-[300px] shrink-0 lg:flex xl:w-[330px]">{panelEl(() => setPrefs({ panel: false }), "h-full w-full")}</div>}
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={(e) => e.target === e.currentTarget && setDrawer(false)} role="dialog" aria-label="Filter">
          <div className="h-full w-[340px] max-w-[92vw] overflow-hidden border-l border-border bg-bg p-3 shadow-pop">{panelEl(() => setDrawer(false), "h-full")}</div>
        </div>
      )}
      {newOpen && <NewTicket brand={brand.id} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); go({ t: id }); }} />}
      {settingsOpen && <SettingsDialog brand={brand.id} canAdmin={["owner", "admin"].includes(props.role)} settings={props.settings} signature={props.signature} onClose={() => setSettingsOpen(false)} />}
      <ReminderPopup brand={brand.id} />
    </div>
  );
}

// ---------------------------------------------------------------- search with field:value autocomplete

function SearchBox({ initial, fields, onSearch }: { initial: string; fields: FieldDef[]; onSearch: (q: string) => void }) {
  const [q, setQ] = useState(initial);
  const [focus, setFocus] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setQ(initial), [initial]);
  const extra = useMemo(() => fields.filter((f) => f.scope === "ticket" && !f.hidden && !f.encrypted).map((f) => ({ key: f.key, label: f.label, options: f.options })), [fields]);
  const sugg = focus ? searchSuggestions(q, extra) : [];
  const pick = (insert: string) => { setQ(applySuggestion(q, insert)); setIdx(0); ref.current?.focus(); };
  return (
    <form className="relative min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); setFocus(false); onSearch(q.trim()); }}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
      <Input
        ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (!sugg.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % sugg.length); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + sugg.length) % sugg.length); }
          if (e.key === "Tab") { e.preventDefault(); pick(sugg[idx].insert); }
        }}
        placeholder="Search, or status:wip assignee:me post:<url> #123" className="h-8 pl-8 text-[13px]" aria-label="Search tickets" autoComplete="off"
        role="combobox" aria-expanded={sugg.length > 0} aria-controls="cx-search-sugg"
      />
      {sugg.length > 0 && (
        <ul id="cx-search-sugg" role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-card">
          {sugg.map((s, i) => (
            <li key={s.insert} role="option" aria-selected={i === idx}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(s.insert); }} className={cn("flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-[12.5px]", i === idx ? "bg-surface-3" : "hover:bg-surface-3")}>
                <code className="text-text">{s.label}</code><span className="truncate text-text-3">{s.hint}</span>
              </button>
            </li>
          ))}
          <li className="px-2 pt-1 text-[11px] text-text-3">Tab to complete · Enter to search · prefix “-” to exclude</li>
        </ul>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- list items

type ItemProps = { t: TicketListRow; active: boolean; checked: boolean; onCheck: (v: boolean) => void; href: string; full: string };
function Flags({ t }: { t: TicketListRow }) {
  return (
    <>
      {t.has_attachment && <span title="Has attachments"><Paperclip className="h-3 w-3 text-text-3" /></span>}
      {t.escalated_at && <span title="Escalated"><ArrowUpRight className="h-3 w-3 text-serious-ink" /></span>}
      {t.next_reminder && <span title={`Reminder ${dateTimeLabel(t.next_reminder)}`}><AlarmClock className="h-3 w-3 text-warning-ink" /></span>}
      {(t.parent_id || t.children > 0) && <span title={t.parent_id ? "Child ticket" : `${t.children} child tickets`}><GitBranch className="h-3 w-3 text-text-3" /></span>}
    </>
  );
}
function FullLink({ href }: { href: string }) {
  return <Link href={href} className="shrink-0 self-start rounded p-1 text-text-3 opacity-60 hover:bg-surface-3 hover:text-text hover:opacity-100 group-hover:opacity-100" title="Open One Ticket View" aria-label="Open One Ticket View"><Expand className="h-3.5 w-3.5" /></Link>;
}
function TicketItem({ t, active, checked, onCheck, href, full }: ItemProps) {
  const unanswered = t.last_direction === "in" && !["solved", "closed", "ignored"].includes(t.crm_status);
  return (
    <li className={cn("group flex gap-2.5 border-b border-border px-3 py-2.5", active ? "bg-brand-soft" : "hover:bg-surface-2")}>
      <Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} className="mt-0.5" aria-label={`Select ticket ${t.number}`} />
      <Link href={href} className="min-w-0 flex-1" scroll={false}>
        <div className="flex items-center gap-1.5">
          <ChannelIcon kind={t.channel_kind} className="text-text-3" />
          <span className={cn("min-w-0 flex-1 truncate text-[13px] text-text", unanswered && "font-semibold")}>{t.contact_name || t.contact_email || "Unknown"}</span>
          <Flags t={t} />
          <Ago iso={t.last_at ?? t.updated_at} className="shrink-0 text-[11.5px] text-text-3" />
        </div>
        <div className={cn("mt-0.5 truncate text-[13px]", unanswered ? "font-medium text-text" : "text-text-2")}>
          <span className="text-text-3">#{t.number}</span> {t.subject}
        </div>
        {t.last_body && <div className="mt-0.5 truncate text-[12px] text-text-3">{t.last_direction === "out" ? "You: " : ""}{toPlainText(t.last_body)}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <StatusBadge status={t.crm_status} />
          <PriorityBadge priority={t.priority} />
          {t.severity && <span className="rounded border border-border px-1 text-[11px] text-text-2">{t.severity}</span>}
          {t.assignee_name ? <span className="text-[11.5px] text-text-3">{t.assignee_name}</span> : !["solved", "closed", "ignored"].includes(t.crm_status) && <span className="text-[11.5px] text-warning-ink">Unassigned</span>}
          {t.team && <span className="text-[11.5px] text-text-3">· {t.team}</span>}
          {t.tags.slice(0, 2).map((g, i) => <span key={`${g}-${i}`} className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{g}</span>)}
          <span className="ml-auto"><SlaChip ticket={t} /></span>
        </div>
      </Link>
      <FullLink href={full} />
    </li>
  );
}
/** Chat View: customer-first rows like a messenger (avatar, last message, unread marker). */
function ChatItem({ t, active, checked, onCheck, href, full }: ItemProps) {
  const unanswered = t.last_direction === "in" && !["solved", "closed", "ignored"].includes(t.crm_status);
  return (
    <li className={cn("group flex items-center gap-2 border-b border-border px-3 py-2", active ? "bg-brand-soft" : "hover:bg-surface-2")}>
      <Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ticket ${t.number}`} />
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5" scroll={false}>
        <span className="relative">
          <Avatar name={t.contact_name || t.contact_email || "?"} className="h-9 w-9" />
          <span className="absolute -right-0.5 -bottom-0.5 rounded-full border border-border bg-surface p-0.5"><ChannelIcon kind={t.channel_kind} className="h-3 w-3 text-text-2" /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("min-w-0 flex-1 truncate text-[13px] text-text", unanswered && "font-semibold")}>{t.contact_name || t.contact_email || "Unknown"}</span>
            <Flags t={t} />
            <Ago iso={t.last_at ?? t.updated_at} className="shrink-0 text-[11px] text-text-3" />
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", unanswered ? "text-text" : "text-text-3")}>{t.last_direction === "out" ? "You: " : ""}{t.last_body ? toPlainText(t.last_body) : t.subject}</span>
            {unanswered && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Awaiting reply" />}
            <span className="shrink-0 text-[11px] text-text-3">{crmLabel(t.crm_status)}</span>
          </span>
        </span>
      </Link>
      <FullLink href={full} />
    </li>
  );
}

// ---------------------------------------------------------------- reminder pop-up

type Due = { id: string; ticket_id: string; number: number; subject: string; note: string; remind_at: string; created_by_name: string };
function ReminderPopup({ brand }: { brand: string }) {
  const [due, setDue] = useState<Due[]>([]);
  // Closing (Esc, backdrop, X) only hides these for now; they stay due until dismissed explicitly.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/cx/inbox/reminders?brand=${brand}`, { cache: "no-store" });
        if (!r.ok || stop) return;
        const d = (await r.json()) as { reminders: Due[] };
        setDue((prev) => { if (d.reminders.some((x) => !prev.some((p) => p.id === x.id))) playAlert("ticket"); return d.reminders; });
      } catch {}
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => { stop = true; clearInterval(iv); };
  }, [brand]);
  const dismiss = async (id: string) => {
    setDue((d) => d.filter((x) => x.id !== id));
    await fetch(`/api/cx/inbox/reminders?brand=${brand}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  };
  const shown = due.filter((d) => !hidden.has(d.id));
  if (!shown.length) return null;
  return (
    <Dialog
      open
      onClose={() => setHidden((h) => new Set([...h, ...shown.map((d) => d.id)]))}
      size="sm"
      title={shown.length > 1 ? `${shown.length} reminders` : "Reminder"}
      initialFocus="none"
      footer={shown.length > 1 ? <Button variant="ghost" onClick={() => shown.forEach((d) => dismiss(d.id))}>Dismiss all</Button> : undefined}
    >
      <ul className="space-y-3">
        {shown.map((r) => (
          <li key={r.id} className="rounded-md border border-border p-2.5">
            <div className="flex items-center gap-1.5 text-[12px] text-text-3"><AlarmClock className="h-3.5 w-3.5 text-warning-ink" /><span suppressHydrationWarning>{dateTimeLabel(r.remind_at)}</span> · set by {r.created_by_name}</div>
            <div className="mt-0.5 text-[13px] font-medium text-text">#{r.number} {r.subject}</div>
            {r.note && <p className="mt-0.5 text-[13px] text-text-2">{r.note}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" onClick={() => dismiss(r.id)}>Dismiss</Button>
              <Button size="sm" variant="primary" onClick={() => { dismiss(r.id); router.push(`/cx/inbox?brand=${brand}&view=all&t=${r.ticket_id}`); }}>Open ticket</Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// ---------------------------------------------------------------- small controls

function FilterSelect({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string | null) => void; options: [string, string][] }) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={cn("h-7 w-auto max-w-full min-w-0 py-0 text-[12px]", value && "border-link text-link")} aria-label={label}>
      <option value="">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}
function BulkSelect({ label, onPick, options }: { label: string; onPick: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value="" onChange={(e) => e.target.value && onPick(e.target.value)} className="h-7 w-auto py-0 text-[12px]" aria-label={`Set ${label.toLowerCase()}`}>
      <option value="">{label}…</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}
function BulkTag({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }}>
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="+ tag" className="h-7 w-24 text-[12px]" aria-label="Add tag" />
    </form>
  );
}

function NewTicket({ brand, onClose, onCreated }: { brand: string; onClose: () => void; onCreated: (id: string) => void }) {
  const empty = { name: "", email: "", phone: "", subject: "", body: "", channel: "phone" };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await newTicketAction(brand, f);
    setBusy(false);
    if (r.ok) onCreated(r.data.id); else setError(r.error);
  };
  return (
    <Dialog open onClose={onClose} size="lg" title="New ticket" description="Log a conversation that happened outside connected channels (phone, walk-in, etc.)."
      error={error}
      onSubmit={create}
      footerStart={<Button variant="ghost" disabled={busy} onClick={() => { setF(empty); setError(null); }}>Reset</Button>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Create ticket</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Customer name" htmlFor="nt-n"><Input id="nt-n" autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Email" htmlFor="nt-e"><Input id="nt-e" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone" htmlFor="nt-p"><Input id="nt-p" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Subject" htmlFor="nt-s"><Input id="nt-s" value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
          <Field label="Source" htmlFor="nt-c">
            <Select id="nt-c" value={f.channel} onChange={(e) => set("channel", e.target.value)}>
              <option value="phone">Phone</option><option value="email">Email</option><option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <Field label="What the customer said" htmlFor="nt-b"><Textarea id="nt-b" rows={5} value={f.body} onChange={(e) => set("body", e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
