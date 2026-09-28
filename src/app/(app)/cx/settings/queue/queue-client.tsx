"use client";

import { Pause, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { MiniTable } from "@/components/ui/mini-table";
import type { QueueAgentRow, QueueSettings, UserStatus } from "@/lib/cx/admin/queue";
import { ASSIGNMENT_TYPES, type Segment } from "@/lib/cx/admin/pure/queue";
import { SETTABLE_STATUSES } from "@/lib/cx/inbox/model";
import { cn } from "@/lib/utils";
import { CheckRow, Field, ListInput, Live, When, useRun } from "../_admin/ui";
import {
  deleteStatusAction, pauseAgentAction, resetAgentQueueAction, runQueueNowAction, saveQueueSettingsAction, saveStatusAction,
  saveTeamZoneAction, setAgentSettingsAction, setAgentStatusAction,
} from "./actions";

type Settings = Omit<QueueSettings, "rrCursor">;
type Timer = { showQueueTimer: boolean; queueTimerMinutes: number };
const dur = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`; };
const ago = (iso: string) => dur(Date.now() - Date.parse(iso));
const numOrNull = (v: string) => (v === "" ? null : Number(v));

export function QueueSettingsPanel({ brand, settings, timer }: { brand: string; settings: Settings; timer: Timer }) {
  const { run, busy, messages } = useRun();
  const [s, setS] = useState(settings);
  const [t, setT] = useState(timer);
  return (
    <div className="space-y-4">
      {messages}
      <Card>
        <CardHeader title="Queue" description="When on, new tickets without an assignee wait in the queue and are handed to agents automatically." actions={<CheckRow checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Queue on" />} />
        <CardBody className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-[12.5px] font-medium text-text-2">Assignment type</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {ASSIGNMENT_TYPES.map((a) => (
                <label key={a.value} className={cn("flex cursor-pointer gap-2 rounded-md border p-2.5 text-[13px]", s.assignmentType === a.value ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-3")}>
                  <input type="radio" name="atype" className="mt-0.5 accent-[var(--brand)]" checked={s.assignmentType === a.value} onChange={() => setS({ ...s, assignmentType: a.value })} />
                  <span><span className="font-medium text-text">{a.label}</span><span className="block text-[12px] text-text-2">{a.description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Max open queued tickets per agent" hint="Default; override per agent."><Input type="number" min={1} max={200} value={s.maxPerAgent} onChange={(e) => setS({ ...s, maxPerAgent: Number(e.target.value) })} /></Field>
            <Field label="Queue cleanup (minutes)" hint="Take a ticket back if the agent hasn't acted on it. Empty = off."><Input type="number" min={1} value={s.cleanupMinutes ?? ""} onChange={(e) => setS({ ...s, cleanupMinutes: numOrNull(e.target.value) })} /></Field>
            <Field label="Reset queue after status change (minutes)" hint="0 = immediately."><Input type="number" min={0} value={s.resetAfterMinutes} onChange={(e) => setS({ ...s, resetAfterMinutes: Number(e.target.value) })} /></Field>
          </div>
          <div className="space-y-2">
            <CheckRow checked={s.resetOnStatus} onChange={(v) => setS({ ...s, resetOnStatus: v })} label="Reset My Queue when an agent goes on a break or offline" hint="Queued tickets they haven't replied to go back to the waiting queue." />
            <CheckRow checked={s.byTimezone} onChange={(v) => setS({ ...s, byTimezone: v })} label="Assign only within office hours" hint="Uses each agent's hours and time zone, falling back to their team's." />
          </div>
          <Field label="Leave the queue when status becomes" hint="Tickets in these statuses stop counting toward an agent's limit.">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {SETTABLE_STATUSES.map((st) => <CheckRow key={st.id} checked={s.removeOn.includes(st.id)} onChange={(v) => setS({ ...s, removeOn: v ? [...s.removeOn, st.id] : s.removeOn.filter((x) => x !== st.id) })} label={st.label} />)}
            </div>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Queue timer" description="Shows how long a queued ticket has waited, green under the threshold and red over it, in the inbox list." />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <CheckRow checked={t.showQueueTimer} onChange={(v) => setT({ ...t, showQueueTimer: v })} label="Show the queue timer to agents" />
          <Field label="Turn red after (minutes)"><Input type="number" min={1} value={t.queueTimerMinutes} onChange={(e) => setT({ ...t, queueTimerMinutes: Number(e.target.value) })} /></Field>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button loading={busy === "run"} onClick={() => run("run", runQueueNowAction(brand), (r) => `Assigned ${r.assigned} tickets.`)}>Run queue now</Button>
        <Button variant="primary" loading={busy === "save"} onClick={() => run("save", saveQueueSettingsAction(brand, s, t), () => "Queue settings saved.")}>Save settings</Button>
      </div>
    </div>
  );
}

const STATUS_TONE = { available: "good", break: "warning", offline: "neutral" } as const;

export function QueueAgentsPanel({ brand, agents, statuses }: { brand: string; agents: QueueAgentRow[]; statuses: UserStatus[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<QueueAgentRow | null>(null);
  return (
    <Card>
      <CardHeader title="Agents" description="Live status, load and limits. Pausing stops new assignments without changing the agent's status." />
      <CardBody>
        {messages}
        <MiniTable
          columns={[{ header: "Agent" }, { header: "Status" }, { header: "Queue", align: "right" }, { header: "Hours" }, { header: "", align: "right" }]}
          empty="No agents in this brand yet."
          rows={agents.map((a) => [
            <div key="n" className="min-w-32"><div className="font-medium text-text">{a.name}</div><div className="text-[12px] text-text-3">{a.team ?? a.role}</div></div>,
            <div key="s" className="min-w-40">
              <Select aria-label={`Status of ${a.name}`} className="h-7 w-40 text-[12.5px]" value={a.status === "available" && !a.statusId ? "available" : a.status === "offline" ? "offline" : a.statusId ?? "available"} onChange={(e) => run("st", setAgentStatusAction(brand, a.id, e.target.value))}>
                <option value="available">Available</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="offline">Offline</option>
              </Select>
              <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-text-3">
                <Dot tone={STATUS_TONE[a.status]} />{a.statusName} · <Live>{ago(a.since)}</Live>{a.limit ? ` / ${a.limit}m` : ""}
                {a.overrun && <Badge tone="critical">Over limit</Badge>}
                {a.paused && <Badge tone="warning">Paused</Badge>}
              </div>
            </div>,
            <span key="l" className={cn(a.load >= a.capacity && "text-critical-ink")}>{a.load} / {a.capacity}</span>,
            <span key="h" className="text-[12px] text-text-2 whitespace-nowrap">{a.officeStart && a.officeEnd ? `${a.officeStart}–${a.officeEnd}` : "Any time"}{a.timezone ? ` ${a.timezone}` : ""}</span>,
            <div key="x" className="flex justify-end gap-0.5">
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={a.paused ? `Resume ${a.name}` : `Pause ${a.name}`} onClick={() => run("p", pauseAgentAction(brand, a.id, !a.paused))}>{a.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Reset ${a.name}'s queue`} onClick={() => confirm(`Return ${a.name}'s unworked queued tickets to the waiting queue?`) && run("r", resetAgentQueueAction(brand, a.id), (n) => `${n} tickets returned to the queue.`)}><RotateCcw className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
            </div>,
          ])}
        />
      </CardBody>
      <Dialog size="sm" open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.name}: queue limits` : ""}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (edit && (await run("save", setAgentSettingsAction(brand, edit.id, { capacity: edit.capacity, officeStart: edit.officeStart, officeEnd: edit.officeEnd, timezone: edit.timezone })))) setEdit(null); }}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max queued tickets" className="col-span-2"><Input type="number" min={1} max={200} value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: Number(e.target.value) })} /></Field>
            <Field label="Office start"><Input type="time" value={edit.officeStart ?? ""} onChange={(e) => setEdit({ ...edit, officeStart: e.target.value || null })} /></Field>
            <Field label="Office end"><Input type="time" value={edit.officeEnd ?? ""} onChange={(e) => setEdit({ ...edit, officeEnd: e.target.value || null })} /></Field>
            <Field label="Time zone" className="col-span-2" hint="IANA name, e.g. Asia/Kolkata. Empty uses the team's."><Input value={edit.timezone ?? ""} onChange={(e) => setEdit({ ...edit, timezone: e.target.value || null })} /></Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

export function StatusesPanel({ brand, statuses, zones }: { brand: string; statuses: UserStatus[]; zones: { team_id: string; name: string; timezone: string | null; start_time: string | null; end_time: string | null }[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<{ id?: string; name: string; available: boolean; limit_minutes: number | null } | null>(null);
  const [zd, setZd] = useState<Record<string, { timezone: string; start: string; end: string }>>({});
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Agent statuses" description="Breaks agents can pick. A time limit alerts supervisors when a break runs over." actions={<Button size="sm" variant="primary" onClick={() => setEdit({ name: "", available: false, limit_minutes: 15 })}><Plus className="h-3.5 w-3.5" />Add</Button>} />
        <CardBody>
          {messages}
          <ul className="divide-y divide-border text-[13px]">
            <li className="flex items-center gap-2 py-2"><Dot tone="good" /><span className="flex-1">Available</span><span className="text-[12px] text-text-3">Built in</span></li>
            {statuses.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2">
                <Dot tone={s.available ? "good" : "warning"} />
                <span className="flex-1">{s.name}</span>
                <span className="text-[12px] text-text-3">{s.available ? "Takes tickets" : s.limit_minutes ? `${s.limit_minutes} min limit` : "No limit"}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${s.name}`} onClick={() => setEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${s.name}`} onClick={() => confirm(`Delete "${s.name}"?`) && run("d", deleteStatusAction(brand, s.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
            <li className="flex items-center gap-2 py-2"><Dot /><span className="flex-1">Offline</span><span className="text-[12px] text-text-3">Built in</span></li>
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Team time zones" description="Office hours per team, used when agents have none of their own." />
        <CardBody>
          {zones.length ? (
            <ul className="space-y-2">
              {zones.map((z) => {
                const d = zd[z.team_id] ?? { timezone: z.timezone ?? "", start: z.start_time ?? "09:00", end: z.end_time ?? "18:00" };
                const set = (p: Partial<typeof d>) => setZd({ ...zd, [z.team_id]: { ...d, ...p } });
                return (
                  <li key={z.team_id} className="rounded-md border border-border p-2.5">
                    <div className="mb-1.5 text-[13px] font-medium text-text">{z.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input aria-label="Time zone" className="h-7.5 w-40" placeholder="Asia/Kolkata" value={d.timezone} onChange={(e) => set({ timezone: e.target.value })} />
                      <Input aria-label="Start" type="time" className="h-7.5 w-28" value={d.start} onChange={(e) => set({ start: e.target.value })} />
                      <Input aria-label="End" type="time" className="h-7.5 w-28" value={d.end} onChange={(e) => set({ end: e.target.value })} />
                      <Button size="sm" disabled={!zd[z.team_id]} loading={busy === z.team_id} onClick={() => run(z.team_id, saveTeamZoneAction(brand, z.team_id, d), () => `${z.name} hours saved.`)}>Save</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="py-4 text-center text-[13px] text-text-3">No teams yet. Create teams under Team &amp; SLAs.</p>}
        </CardBody>
      </Card>
      <Dialog size="sm" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit status" : "Add status"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (edit && (await run("save", saveStatusAction(brand, edit)))) setEdit(null); }}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><Input autoFocus value={edit.name} maxLength={40} placeholder="Lunch" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <CheckRow checked={edit.available} onChange={(v) => setEdit({ ...edit, available: v })} label="Agent still takes tickets in this status" />
            {!edit.available && <Field label="Time limit (minutes)" hint="Empty = no limit."><Input type="number" min={1} value={edit.limit_minutes ?? ""} onChange={(e) => setEdit({ ...edit, limit_minutes: numOrNull(e.target.value) })} /></Field>}
          </div>
        )}
      </Dialog>
    </div>
  );
}

const SEG_FIELDS: { value: Segment["match"][number]["field"]; label: string }[] = [
  { value: "contact_tag", label: "Contact tag" }, { value: "email_domain", label: "Email domain" }, { value: "channel", label: "Channel" }, { value: "priority", label: "Priority" },
];

export function SegmentsPanel({ brand, settings, timer }: { brand: string; settings: Settings; timer: Timer }) {
  const { run, busy, messages } = useRun();
  const [segs, setSegs] = useState<Segment[]>(settings.segments);
  const set = (i: number, p: Partial<Segment>) => setSegs(segs.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <Card>
      <CardHeader title="Customer segments" description="Higher-weight segments are served first in the queue (for example VIP or enterprise customers). A ticket joins the first segment whose rules all match."
        actions={<Button size="sm" onClick={() => setSegs([...segs, { id: "", name: "", weight: 10, match: [{ field: "contact_tag", values: [] }] }])}><Plus className="h-3.5 w-3.5" />Add segment</Button>} />
      <CardBody className="space-y-3">
        {messages}
        {!segs.length && <p className="py-4 text-center text-[13px] text-text-3">No segments. Every ticket is served oldest first, by priority and due time.</p>}
        {segs.map((s, i) => (
          <div key={i} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap gap-2">
              <Field label="Name" className="min-w-40 flex-1"><Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="VIP" /></Field>
              <Field label="Weight" className="w-24"><Input type="number" value={s.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })} /></Field>
              <Button size="icon" variant="ghost" className="mt-5" aria-label="Remove segment" onClick={() => setSegs(segs.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="mt-2 space-y-1.5">
              {s.match.map((m, k) => (
                <div key={k} className="flex flex-wrap gap-1.5">
                  <Select aria-label="Rule field" className="h-7.5 w-40" value={m.field} onChange={(e) => set(i, { match: s.match.map((x, j) => (j === k ? { ...x, field: e.target.value as typeof m.field } : x)) })}>{SEG_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>
                  <span className="self-center text-[12px] text-text-3">is any of</span>
                  <ListInput className="h-7.5 min-w-0 flex-1" value={m.values} onChange={(v) => set(i, { match: s.match.map((x, j) => (j === k ? { ...x, values: v } : x)) })} placeholder="vip, enterprise" />
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove rule" onClick={() => set(i, { match: s.match.filter((_, j) => j !== k) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => set(i, { match: [...s.match, { field: "email_domain", values: [] }] })}><Plus className="h-3.5 w-3.5" />Rule</Button>
            </div>
          </div>
        ))}
        <div className="flex justify-end"><Button variant="primary" loading={busy === "save"} onClick={() => run("save", saveQueueSettingsAction(brand, { ...settings, segments: segs }, timer), () => "Segments saved.")}>Save segments</Button></div>
      </CardBody>
    </Card>
  );
}

type Waiting = { id: string; number: number; subject: string; priority: string; channel_kind: string; queued_at: string; assigned_at: string | null; queue_agent: string | null; segment: string | null; status: string; due: string | null };
export function WaitingPanel({ brand, waiting, agents, log, timerMinutes }: { brand: string; waiting: Waiting[]; agents: QueueAgentRow[]; log: { id: string; name: string; status: string; started_at: string; ended_at: string | null }[]; timerMinutes: number }) {
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "Waiting";
  return (
    <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
      <Card>
        <CardHeader title="In the queue" description={`${waiting.filter((w) => !w.queue_agent).length} waiting · ${waiting.filter((w) => w.queue_agent).length} with agents`} />
        <CardBody>
          <MiniTable
            columns={[{ header: "Ticket" }, { header: "Segment" }, { header: "With" }, { header: "Time", align: "right" }]}
            empty="The queue is empty."
            rows={waiting.map((w) => {
              const since = w.assigned_at ?? w.queued_at;
              const late = (Date.now() - Date.parse(since)) / 60000 > timerMinutes;
              return [
                <a key="t" className="block min-w-40 hover:text-link" href={`/cx/inbox?brand=${brand}&ticket=${w.id}`}><span className="text-text-3">#{w.number}</span> {w.subject || "(no subject)"}<span className="block text-[11.5px] text-text-3">{w.channel_kind} · {w.priority} · {w.status}</span></a>,
                w.segment ? <Badge key="s" tone="brand">{w.segment}</Badge> : <span key="s" className="text-text-3">n/a</span>,
                <span key="a" className="whitespace-nowrap">{name(w.queue_agent)}</span>,
                <span key="m" className={cn("font-medium", late ? "text-critical-ink" : "text-good-ink")}><Live>{ago(since)}</Live></span>,
              ];
            })}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Status log" description="Agent status changes, newest first." />
        <CardBody>
          <MiniTable
            columns={[{ header: "Agent" }, { header: "Status" }, { header: "Started" }, { header: "Length", align: "right" }]}
            empty="No status changes yet."
            rows={log.slice(0, 100).map((l) => [l.name, l.status, <span key="s" className="whitespace-nowrap text-[12px]"><When iso={l.started_at} /></span>, l.ended_at ? dur(Date.parse(l.ended_at) - Date.parse(l.started_at)) : "now"])}
          />
        </CardBody>
      </Card>
    </div>
  );
}
