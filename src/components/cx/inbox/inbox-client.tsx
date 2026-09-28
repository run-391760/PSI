"use client";

import { Inbox, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { mergeAction, newTicketAction, updateTicketsAction } from "@/app/(app)/cx/inbox/actions";
import type { Agent, Canned, TicketDetail, TicketFilters, TicketListRow, View } from "@/lib/cx/inbox/store";
import { formatSpan } from "@/lib/cx/inbox/sla";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Conversation } from "./conversation";
import { Ago, SlaChip } from "./time";
import { ChannelIcon, channelLabel, PriorityBadge, StatusBadge } from "./ui";

const VIEW_LABELS: { id: View; label: string }[] = [
  { id: "open", label: "All open" },
  { id: "mine", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
  { id: "pending", label: "Pending" },
  { id: "breached", label: "SLA breached" },
  { id: "solved", label: "Solved" },
  { id: "all", label: "All" },
];

type Stats = { open: number; unassigned: number; breached: number; created_7d: number; solved_7d: number; frt_min: number | null; csat: number | null; csat_n: number };
export type InboxProps = {
  brand: { id: string; name: string };
  me: { id: string; name: string };
  filters: TicketFilters;
  tickets: TicketListRow[];
  counts: Record<View, number>;
  stats: Stats;
  agents: Agent[];
  teams: string[];
  tags: string[];
  canned: Canned[];
  channels: { id: string; kind: string; name: string }[];
  selected: TicketDetail | null;
  ai: boolean;
};

export function InboxClient(props: InboxProps) {
  const { brand, filters, tickets, counts, stats, selected } = props;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(filters.q ?? "");
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    return `${pathname}?${p.toString()}`;
  };
  const go = (patch: Record<string, string | null>) => router.push(href(patch));

  // Live list: refresh every 20 s (new chats / emails / SLA changes).
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => setChecked((c) => new Set([...c].filter((id) => tickets.some((t) => t.id === id)))), [tickets]);

  const sel = tickets.filter((t) => checked.has(t.id));
  const bulk = async (patch: Parameters<typeof updateTicketsAction>[2]) => {
    setError(null);
    const r = await updateTicketsAction(brand.id, [...checked], patch);
    if (!r.ok) setError(r.error);
    else setChecked(new Set());
    router.refresh();
  };
  const channelKinds = useMemo(() => [...new Set([...props.channels.map((c) => c.kind), ...tickets.map((t) => t.channel_kind)])], [props.channels, tickets]);
  const activeFilters = (["channel", "priority", "status", "team", "tag", "sentiment"] as const).filter((k) => filters[k]);

  return (
    <div className="space-y-4">
      <MetricStrip className={cn("grid-cols-2 divide-y-0 rounded-lg border border-border bg-surface sm:grid-flow-row sm:grid-cols-3 sm:divide-x-0 xl:grid-flow-col xl:grid-cols-none xl:divide-x", selected && "hidden lg:grid")}>
        <Metric label="Open" value={num(stats.open)} size="sm" href={href({ view: "open", t: null })} />
        <Metric label="Unassigned" value={num(stats.unassigned)} size="sm" href={href({ view: "unassigned", t: null })} />
        <Metric label="SLA breached" value={num(stats.breached)} size="sm" href={href({ view: "breached", t: null })} info="Open tickets past their first-response or resolution due time." />
        <Metric label="Median first response" value={stats.frt_min == null ? "n/a" : formatSpan(stats.frt_min * 60_000)} size="sm" sub="last 30 days" />
        <Metric label="Created / solved (7d)" value={`${num(stats.created_7d)} / ${num(stats.solved_7d)}`} size="sm" />
        <Metric label="CSAT" value={stats.csat == null ? "n/a" : `${stats.csat.toFixed(1)} / 5`} size="sm" sub={stats.csat_n ? `${stats.csat_n} ratings` : "no ratings yet"} />
      </MetricStrip>

      <div className="flex min-h-[600px] overflow-hidden rounded-lg border border-border bg-surface shadow-card lg:h-[calc(100dvh-260px)]">
        {/* ---------------------------------------------------------------- list */}
        <section className={cn("flex w-full min-w-0 flex-col border-border lg:w-[400px] lg:shrink-0 lg:border-r", selected && "hidden lg:flex")} aria-label="Tickets">
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || null, t: null }); }}>
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, customer, message, #" className="h-8 pl-8 text-[13px]" aria-label="Search tickets" />
              </form>
              <Button size="sm" variant="primary" onClick={() => setNewOpen(true)} aria-label="New ticket"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">New</span></Button>
            </div>
            <nav className="flex flex-wrap gap-1" aria-label="Views">
              {VIEW_LABELS.map((v) => (
                <Link key={v.id} href={href({ view: v.id === "open" ? null : v.id, t: null })} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]", (filters.view ?? "open") === v.id ? "border-link bg-brand-soft font-medium text-link" : "border-border text-text-2 hover:bg-surface-3")}>
                  {v.label}
                  <span className={cn("tabular-nums", v.id === "breached" && counts[v.id] > 0 ? "text-critical-ink" : "text-text-3")}>{counts[v.id] ?? 0}</span>
                </Link>
              ))}
            </nav>
            <div className="flex flex-wrap gap-1.5">
              <FilterSelect label="Channel" value={filters.channel} onChange={(v) => go({ channel: v, t: null })} options={channelKinds.map((k) => [k, channelLabel(k)])} />
              <FilterSelect label="Priority" value={filters.priority} onChange={(v) => go({ priority: v, t: null })} options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} />
              <FilterSelect label="Status" value={filters.status} onChange={(v) => go({ status: v, t: null })} options={[["new", "New"], ["open", "Open"], ["pending", "Pending"], ["on_hold", "On hold"], ["solved", "Solved"], ["closed", "Closed"]]} />
              <FilterSelect label="Sentiment" value={filters.sentiment} onChange={(v) => go({ sentiment: v, t: null })} options={[["negative", "Negative"], ["neutral", "Neutral"], ["positive", "Positive"]]} />
              {props.teams.length > 0 && <FilterSelect label="Team" value={filters.team} onChange={(v) => go({ team: v, t: null })} options={props.teams.map((t) => [t, t])} />}
              {props.tags.length > 0 && <FilterSelect label="Tag" value={filters.tag} onChange={(v) => go({ tag: v, t: null })} options={props.tags.map((t) => [t, t])} />}
              {(activeFilters.length > 0 || filters.q) && (
                <button className="inline-flex items-center gap-1 px-1 text-[12px] text-link hover:underline" onClick={() => { setQ(""); go({ channel: null, priority: null, status: null, team: null, tag: null, sentiment: null, q: null, t: null }); }}>
                  <X className="h-3 w-3" />Clear
                </button>
              )}
            </div>
          </div>

          {checked.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="font-medium text-text">{checked.size} selected</span>
              <Button size="sm" variant="ghost" onClick={() => bulk({ assignee_id: props.me.id })}>Assign to me</Button>
              <Button size="sm" variant="ghost" onClick={() => bulk({ status: "solved" })}>Solve</Button>
              <BulkSelect label="Status" onPick={(v) => bulk({ status: v as TicketListRow["status"] })} options={[["open", "Open"], ["pending", "Pending"], ["on_hold", "On hold"], ["solved", "Solved"], ["closed", "Closed"]]} />
              <BulkSelect label="Priority" onPick={(v) => bulk({ priority: v as TicketListRow["priority"] })} options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} />
              <BulkSelect label="Assign" onPick={(v) => bulk({ assignee_id: v === "-" ? null : v })} options={[["-", "Unassigned"], ...props.agents.map((a) => [a.id, a.name] as [string, string])]} />
              {props.teams.length > 0 && <BulkSelect label="Team" onPick={(v) => bulk({ team: v === "-" ? null : v })} options={[["-", "No team"], ...props.teams.map((t) => [t, t] as [string, string])]} />}
              <BulkTag onAdd={(tag) => bulk({ addTags: [tag] })} />
              {sel.length >= 2 && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  const target = [...sel].sort((a, b) => a.number - b.number)[0];
                  const r = await mergeAction(brand.id, target.id, sel.filter((t) => t.id !== target.id).map((t) => t.id));
                  if (!r.ok) setError(r.error); else { setChecked(new Set()); go({ t: target.id }); }
                }}>Merge into #{Math.min(...sel.map((t) => t.number))}</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
            </div>
          )}
          {error && <Callout tone="critical" className="m-2">{error}</Callout>}

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {tickets.length === 0 ? (
              <EmptyState icon={<Inbox className="h-5 w-5" />} title={filters.q || activeFilters.length ? "No tickets match" : "Nothing here"} description={props.channels.length ? "New conversations from your channels appear here." : "Connect email, live chat or a web form to start receiving conversations."} action={props.channels.length ? undefined : <Link className="text-[13px] text-link hover:underline" href={`/cx/settings/channels?brand=${brand.id}`}>Connect a channel →</Link>} />
            ) : (
              <>
                <label className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] text-text-3">
                  <Checkbox checked={checked.size === tickets.length} onChange={(e) => setChecked(e.target.checked ? new Set(tickets.map((t) => t.id)) : new Set())} aria-label="Select all" />
                  {tickets.length} tickets{tickets.length >= 300 ? " (first 300)" : ""}
                </label>
                <ul>
                  {tickets.map((t) => <TicketItem key={t.id} t={t} active={selected?.ticket.id === t.id} checked={checked.has(t.id)} onCheck={(v) => setChecked((c) => { const n = new Set(c); if (v) n.add(t.id); else n.delete(t.id); return n; })} href={href({ t: t.id, ticket: null })} />)}
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
      {newOpen && <NewTicket brand={brand.id} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); go({ t: id }); }} />}
    </div>
  );
}

function TicketItem({ t, active, checked, onCheck, href }: { t: TicketListRow; active: boolean; checked: boolean; onCheck: (v: boolean) => void; href: string }) {
  const unanswered = t.last_direction === "in" && !["solved", "closed"].includes(t.status);
  return (
    <li className={cn("group flex gap-2.5 border-b border-border px-3 py-2.5", active ? "bg-brand-soft" : "hover:bg-surface-2")}>
      <Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} className="mt-0.5" aria-label={`Select ticket ${t.number}`} />
      <Link href={href} className="min-w-0 flex-1" scroll={false}>
        <div className="flex items-center gap-1.5">
          <ChannelIcon kind={t.channel_kind} className="text-text-3" />
          <span className={cn("min-w-0 flex-1 truncate text-[13px] text-text", unanswered && "font-semibold")}>{t.contact_name || t.contact_email || "Unknown"}</span>
          <Ago iso={t.last_at ?? t.updated_at} className="shrink-0 text-[11.5px] text-text-3" />
        </div>
        <div className={cn("mt-0.5 truncate text-[13px]", unanswered ? "font-medium text-text" : "text-text-2")}>
          <span className="text-text-3">#{t.number}</span> {t.subject}
        </div>
        {t.last_body && <div className="mt-0.5 truncate text-[12px] text-text-3">{t.last_direction === "out" ? "You: " : ""}{t.last_body}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <StatusBadge status={t.status} />
          <PriorityBadge priority={t.priority} />
          {t.assignee_name ? <span className="text-[11.5px] text-text-3">{t.assignee_name}</span> : !["solved", "closed"].includes(t.status) && <span className="text-[11.5px] text-warning-ink">Unassigned</span>}
          {t.team && <span className="text-[11.5px] text-text-3">· {t.team}</span>}
          {t.tags.slice(0, 2).map((g, i) => <span key={`${g}-${i}`} className="rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{g}</span>)}
          <span className="ml-auto"><SlaChip ticket={t} /></span>
        </div>
      </Link>
    </li>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string | null) => void; options: [string, string][] }) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={cn("h-7 w-auto min-w-0 py-0 text-[12px]", value && "border-link text-link")} aria-label={label}>
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
  const [f, setF] = useState({ name: "", email: "", phone: "", subject: "", body: "", channel: "phone" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onClose={onClose} title="New ticket" description="Log a conversation that happened outside connected channels (phone, walk-in, etc.)."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); const r = await newTicketAction(brand, f); setBusy(false); if (r.ok) onCreated(r.data.id); else setError(r.error); }}>{busy ? "Creating…" : "Create ticket"}</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Customer name" htmlFor="nt-n"><Input id="nt-n" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
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
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}
