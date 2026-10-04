"use client";

import { Hand, ListOrdered, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { assignQueuedAction, pickQueuedAction, queueUnassignedAction, runQueueAction, setMyStatusAction } from "@/app/(app)/cx/inbox/queued/actions";
import { ChannelIcon, PriorityBadge, StatusBadge } from "@/components/cx/inbox/ui";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { mediaLabel, waitLabel } from "@/lib/cx/ops/model";
import type { QueuedRow } from "@/lib/cx/ops/queued";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type Agent = { id: string; name: string; status: string; statusName: string; paused: boolean; load: number; capacity: number; overrun: boolean };

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function QueuedClient({ brand, me, canManage, readOnly, enabled, unqueued, rows, agents, statuses, segments }: {
  brand: string; me: { id: string; status: string | null; statusName: string | null; inQueue: boolean; paused: boolean }; canManage: boolean; readOnly: boolean; enabled: boolean; unqueued: number;
  rows: QueuedRow[]; agents: Agent[]; statuses: { id: string; name: string; available: boolean }[]; segments: string[];
}) {
  const router = useRouter();
  const now = useNow();
  const [tab, setTab] = useState<"waiting" | "assigned" | "all">("waiting");
  const [segment, setSegment] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 30_000); return () => clearInterval(t); }, [router]);
  const list = useMemo(() => rows.filter((r) => (tab === "waiting" ? !r.assignee_id : tab === "assigned" ? !!r.assignee_id : true) && (!segment || (segment === "-" ? !r.segment : r.segment === segment))), [rows, tab, segment]);
  const run = async (key: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, ok: (d: unknown) => string) => {
    setBusy(key); setMsg(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMsg({ tone: "critical", text: r.error }); else { setMsg({ tone: "good", text: ok(r.data) }); setChecked(new Set()); }
    router.refresh();
  };
  const sel = [...checked];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <Segmented value={tab} onChange={setTab} options={[
            { value: "waiting", label: `Waiting ${rows.filter((r) => !r.assignee_id).length}` },
            { value: "assigned", label: `Assigned ${rows.filter((r) => r.assignee_id).length}` },
            { value: "all", label: `All ${rows.length}` },
          ]} />
          {segments.length > 0 && (
            <Select value={segment} onChange={(e) => setSegment(e.target.value)} className={cn("h-7 w-auto py-0 text-[12px]", segment && "border-link text-link")} aria-label="Segment">
              <option value="">All segments</option><option value="-">No segment</option>
              {segments.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {canManage && <Button size="sm" disabled={busy === "run" || !enabled} onClick={() => run("run", () => runQueueAction(brand), (d) => { const x = d as { assigned: number; cleaned: number }; return `Queue ran: ${x.assigned} assigned${x.cleaned ? `, ${x.cleaned} returned` : ""}.`; })} title={enabled ? "Assign waiting tickets now" : "The queue is off"}><Play className="h-3.5 w-3.5" />Run queue now</Button>}
            {canManage && unqueued > 0 && <Button size="sm" disabled={busy === "queue" || !enabled} onClick={() => run("queue", () => queueUnassignedAction(brand), (d) => { const x = d as { queued: number; assigned: number }; return `${x.queued} tickets queued, ${x.assigned} assigned.`; })}><ListOrdered className="h-3.5 w-3.5" />Queue {unqueued} unqueued</Button>}
            <button onClick={() => router.refresh()} className="rounded-md border border-border-strong p-1.5 text-text-2 hover:bg-surface-3" aria-label="Refresh" title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {sel.length > 0 && !readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 text-[12.5px]">
            <span className="font-medium text-text">{sel.length} selected</span>
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("pick", () => pickQueuedAction(brand, sel), (n) => `Picked ${n} ticket${n === 1 ? "" : "s"}.`)}><Hand className="h-3.5 w-3.5" />Pick for me</Button>
            {canManage && (
              <Select value="" onChange={(e) => { const v = e.target.value; if (v) run("assign", () => assignQueuedAction(brand, sel, v === "-" ? null : v), (n) => v === "-" ? `Returned ${n} to the waiting queue.` : `Assigned ${n}.`); }} className="h-7 w-auto py-0 text-[12px]" aria-label="Assign to">
                <option value="">Assign to…</option>
                <option value="-">Back to waiting queue</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.load}/{a.capacity}{a.status !== "available" ? ` · ${a.statusName}` : ""})</option>)}
              </Select>
            )}
            <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
          </div>
        )}
        {msg && <Callout tone={msg.tone} className="m-3">{msg.text}</Callout>}
        {list.length === 0 ? (
          <EmptyState icon={<ListOrdered className="h-5 w-5" />} title={tab === "assigned" ? "No queue assignments waiting for work" : "The queue is empty"} description={enabled ? "New tickets enter the queue automatically and are handed to available agents." : "Enable the queue in Settings → Queue & assignment to start queueing new tickets."} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-text-3">
                  <th className="w-8 border-b border-border px-3 py-2"><Checkbox checked={list.length > 0 && list.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(list.map((r) => r.id)) : new Set())} aria-label="Select all" /></th>
                  <th className="border-b border-border px-2 py-2 font-medium">Pos.</th>
                  <th className="border-b border-border px-2 py-2 font-medium">Ticket</th>
                  <th className="border-b border-border px-2 py-2 font-medium">Waiting</th>
                  <th className="border-b border-border px-2 py-2 font-medium">Segment</th>
                  <th className="border-b border-border px-2 py-2 font-medium">SLA due</th>
                  <th className="border-b border-border px-2 py-2 font-medium">Agent</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const since = Date.parse(r.assigned_at ?? r.queued_at);
                  const waitMs = Math.max(0, now - Date.parse(r.queued_at));
                  const late = r.due && Date.parse(r.due) < now;
                  return (
                    <tr key={r.id} className={cn("align-top hover:bg-surface-2", checked.has(r.id) && "bg-brand-soft")}>
                      <td className="border-b border-border px-3 py-2"><Checkbox checked={checked.has(r.id)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} aria-label={`Select #${r.number}`} /></td>
                      <td className="border-b border-border px-2 py-2 font-semibold text-text tabular-nums">{r.position ?? "–"}</td>
                      <td className="max-w-[360px] border-b border-border px-2 py-2">
                        <Link href={`/cx/inbox?brand=${brand}&view=all&t=${r.id}`} className="block truncate font-medium text-link hover:underline"><span className="text-text-3">#{r.number}</span> {r.subject}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-3">
                          <ChannelIcon kind={r.channel_kind} />{mediaLabel(r.media_type)}{r.channel_name ? ` · ${r.channel_name}` : ""} · {r.contact_name || r.contact_email || "Unknown"}
                          <StatusBadge status={r.status} /><PriorityBadge priority={r.priority} />
                        </div>
                        {r.last_body && <div className="mt-0.5 truncate text-[12px] text-text-2">{r.last_body.replace(/\s+/g, " ").slice(0, 140)}</div>}
                      </td>
                      <td className="border-b border-border px-2 py-2 whitespace-nowrap">
                        <span className={cn("font-medium tabular-nums", waitMs > 30 * 60_000 ? "text-critical-ink" : waitMs > 10 * 60_000 ? "text-warning-ink" : "text-text")}>{waitLabel(waitMs)}</span>
                        <div className="text-[11px] text-text-3" suppressHydrationWarning>since {dateTimeLabel(r.queued_at)}</div>
                      </td>
                      <td className="border-b border-border px-2 py-2">{r.segment ? <Badge tone="brand">{r.segment}</Badge> : <span className="text-text-3">–</span>}</td>
                      <td className="border-b border-border px-2 py-2 whitespace-nowrap">{r.due ? <span className={cn("text-[12px]", late ? "text-critical-ink" : "text-text-2")} suppressHydrationWarning>{late ? "Breached " : ""}{dateTimeLabel(r.due)}</span> : <span className="text-text-3">n/a</span>}</td>
                      <td className="border-b border-border px-2 py-2 whitespace-nowrap">
                        {r.assignee_name ? <><span className="text-text">{r.assignee_name}</span><div className="text-[11px] text-text-3">{r.worked ? "working" : `not started · ${waitLabel(Math.max(0, now - since))}`}</div></> : <span className="text-warning-ink">Unassigned</span>}
                      </td>
                      <td className="border-b border-border px-3 py-2 text-right">
                        {!readOnly && !r.assignee_id && <Button size="sm" disabled={!!busy} onClick={() => run(`p${r.id}`, () => pickQueuedAction(brand, [r.id]), () => `Picked #${r.number}.`)}><Hand className="h-3.5 w-3.5" />Pick</Button>}
                        {!readOnly && r.assignee_id === me.id && <Link href={`/cx/inbox?brand=${brand}&view=all&t=${r.id}`} className="text-[12.5px] text-link hover:underline">Open</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="My status" description={me.inQueue ? "The queue only assigns tickets while you're available." : "You're not a queue agent on this brand yet (add yourself in Team & SLAs)."} />
          <CardBody className="space-y-2 pt-0">
            {me.inQueue ? (
              <>
                <div className="flex items-center gap-2 text-[13px]"><Dot tone={me.status === "available" || statuses.find((s) => s.id === me.status)?.available ? "good" : me.status === "offline" ? "neutral" : "warning"} /><span className="font-medium text-text">{me.statusName}</span>{me.paused && <Badge tone="warning">Paused by admin</Badge>}</div>
                <Select value={me.status ?? ""} disabled={readOnly || busy === "status"} onChange={(e) => run("status", () => setMyStatusAction(brand, e.target.value), () => "Status updated.")} className="h-8 text-[12.5px]" aria-label="My status">
                  <option value="available">Available</option>
                  {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="offline">Offline</option>
                </Select>
              </>
            ) : <Link href={`/cx/settings/team?brand=${brand}`} className="text-[12.5px] text-link hover:underline">Team & SLAs →</Link>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Agents" description="Load is open queued tickets / capacity." href={canManage ? `/cx/settings/queue?brand=${brand}&tab=agents` : undefined} />
          <CardBody className="pt-0">
            {agents.length === 0 ? <p className="text-[12.5px] text-text-3">No agents yet.</p> : (
              <ul className="space-y-2">
                {agents.map((a) => (
                  <li key={a.id} className="text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <Dot tone={a.paused ? "neutral" : a.status === "available" ? "good" : a.status === "break" ? (a.overrun ? "critical" : "warning") : "neutral"} />
                      <span className="min-w-0 flex-1 truncate text-text">{a.name}</span>
                      <span className="text-text-3 tabular-nums">{a.load}/{a.capacity}</span>
                    </div>
                    <div className="ml-4 text-[11.5px] text-text-3">{a.paused ? "Paused" : a.statusName}{a.overrun ? " · over break limit" : ""}</div>
                    <div className="mt-1 ml-4 h-1 overflow-hidden rounded bg-surface-3"><div className="h-full bg-brand" style={{ width: `${Math.min(100, (a.load / Math.max(1, a.capacity)) * 100)}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
