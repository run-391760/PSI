"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Siren, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import type { EscalationLevel, SlaRule } from "@/lib/cx/admin/pure/sla";
import type { Escalation } from "@/lib/cx/admin/sla";
import { ConditionsEditor, type ConditionContext } from "../_admin/conditions";
import { runOk } from "../_admin/k-ui";
import { CheckRow, Field, ListInput, useRun } from "../_admin/ui";
import { deleteEscalationAction, deleteTatRuleAction, moveTatRuleAction, saveEscalationAction, saveTatRuleAction, type TatRuleInput } from "./tat-actions";

type Refs = ConditionContext & { agents: { id: string; name: string }[]; teams: string[] };
const PRIORITIES = ["low", "normal", "high", "urgent"];
const fmt = (m: number | null) => (m == null ? "–" : m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);
const numOrNull = (v: string) => (v === "" ? null : Number(v));
const blankRule = (): TatRuleInput => ({ name: "", priority: null, channels: [], segment: null, team: null, first_response_minutes: 60, every_response_minutes: null, resolution_minutes: 1440, business_hours: true, start_from: "created", valid_from: null, valid_to: null, windows: [], active: true });

export function TatRulesPanel({ brand, rules, refs }: { brand: string; rules: SlaRule[]; refs: Refs }) {
  const { run, busy, error, setError, messages } = useRun();
  const { confirm, confirmDialog } = useConfirm();
  const [edit, setEdit] = useState<TatRuleInput | null>(null);
  const open = (r: TatRuleInput) => { setError(null); setEdit(r); };
  const save = async () => { if (edit && busy !== "save" && (await runOk(run, "save", saveTatRuleAction(brand, edit), () => "TAT rule saved."))) setEdit(null); };
  const scope = (r: SlaRule) => [r.priority && `${r.priority} priority`, r.channels.length && r.channels.join(", "), r.segment && `segment ${r.segment}`, r.team && `team ${r.team}`].filter(Boolean).join(" · ") || "All tickets";
  const when = (r: SlaRule) => [r.valid_from || r.valid_to ? `${r.valid_from ?? "…"} → ${r.valid_to ?? "…"}` : null, r.windows.length ? r.windows.map((w) => `${w.start}–${w.end}`).join(", ") : null].filter(Boolean).join(" · ");
  return (
    <Card>
      <CardHeader title="TAT rules" description="The first matching rule (top to bottom) sets a ticket's first response, every response and resolution targets. Tickets no rule matches use the SLA policies tab. Every change is kept in the audit log."
        actions={<Button size="sm" variant="primary" onClick={() => open(blankRule())}><Plus className="h-3.5 w-3.5" />New rule</Button>} />
      <CardBody>
        {messages}
        {rules.length ? (
          <ol className="divide-y divide-border">
            {rules.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 py-2.5">
                <span className="mt-0.5 w-5 text-right text-[12px] text-text-3 tabular">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">{r.name}<Badge tone={r.active ? "good" : "neutral"}>{r.active ? "Active" : "Off"}</Badge>{r.business_hours && <Badge>Business hours</Badge>}{r.start_from === "queued" && <Badge tone="info">From queue</Badge>}</div>
                  <p className="text-[12px] text-text-2">{scope(r)}{when(r) ? ` · ${when(r)}` : ""}</p>
                  <p className="text-[12px] text-text-3">First response {fmt(r.first_response_minutes)} · every response {fmt(r.every_response_minutes)} · resolution {fmt(r.resolution_minutes)}</p>
                </div>
                <div className="flex gap-0.5">
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => run("m", moveTatRuleAction(brand, r.id, -1))}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => run("m", moveTatRuleAction(brand, r.id, 1))}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${r.name}`} onClick={() => open({ ...r })}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${r.name}`} onClick={async () => { if (await confirm({ title: `Delete “${r.name}”?`, description: "Tickets it matched use the next matching rule, or the SLA policies." })) run("d", deleteTatRuleAction(brand, r.id), () => `${r.name} deleted.`); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ol>
        ) : <EmptyState icon={<Timer className="h-5 w-5" />} title="No TAT rules" description="Set different targets per channel, customer segment or team, for a date range (a sale week) or for parts of the day (night shift)." />}
      </CardBody>
      {confirmDialog}
      <Dialog size="xl" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "New TAT rule"} error={error} onSubmit={save}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "save"}>Save rule</Button></>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Name" className="sm:col-span-2"><Input autoFocus value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Priority"><Select value={edit.priority ?? ""} onChange={(e) => setEdit({ ...edit, priority: e.target.value || null })}><option value="">Any</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
              <Field label="Team"><Select value={edit.team ?? ""} onChange={(e) => setEdit({ ...edit, team: e.target.value || null })}><option value="">Any</option>{refs.teams.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
              <Field label="Channels" className="sm:col-span-2" hint={`Empty = any. e.g. ${refs.channels.slice(0, 3).map((c) => c.value).join(", ")}`}><ListInput value={edit.channels} onChange={(v) => setEdit({ ...edit, channels: v })} /></Field>
              <Field label="Customer segment"><Select value={edit.segment ?? ""} onChange={(e) => setEdit({ ...edit, segment: e.target.value || null })}><option value="">Any</option>{(refs.segments ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
              <Field label="Clock starts"><Select value={edit.start_from} onChange={(e) => setEdit({ ...edit, start_from: e.target.value as TatRuleInput["start_from"] })}><option value="created">When the ticket arrives</option><option value="queued">When it enters the queue</option></Select></Field>
            </div>
            <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
              <legend className="px-1 text-[12.5px] font-semibold text-text">Targets (minutes)</legend>
              <Field label="First response"><Input type="number" min={1} value={edit.first_response_minutes ?? ""} onChange={(e) => setEdit({ ...edit, first_response_minutes: numOrNull(e.target.value) })} /></Field>
              <Field label="Every response" hint="Each customer message after the first."><Input type="number" min={1} value={edit.every_response_minutes ?? ""} onChange={(e) => setEdit({ ...edit, every_response_minutes: numOrNull(e.target.value) })} /></Field>
              <Field label="Resolution"><Input type="number" min={1} value={edit.resolution_minutes ?? ""} onChange={(e) => setEdit({ ...edit, resolution_minutes: numOrNull(e.target.value) })} /></Field>
              <div className="sm:col-span-3"><CheckRow checked={edit.business_hours} onChange={(v) => setEdit({ ...edit, business_hours: v })} label="Count business hours only" hint="Uses the Business hours tab and its holidays." /></div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Valid from"><Input type="date" value={edit.valid_from ?? ""} onChange={(e) => setEdit({ ...edit, valid_from: e.target.value || null })} /></Field>
                <Field label="Valid to"><Input type="date" value={edit.valid_to ?? ""} onChange={(e) => setEdit({ ...edit, valid_to: e.target.value || null })} /></Field>
              </div>
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-text-2">Time windows <span className="font-normal text-text-3">(up to 3 a day; empty = all day)</span></div>
                <div className="space-y-1.5">
                  {edit.windows.map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input aria-label="From" type="time" className="h-7.5 w-28" value={w.start} onChange={(e) => setEdit({ ...edit, windows: edit.windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                      <span className="text-text-3">to</span>
                      <Input aria-label="To" type="time" className="h-7.5 w-28" value={w.end} onChange={(e) => setEdit({ ...edit, windows: edit.windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove window" onClick={() => setEdit({ ...edit, windows: edit.windows.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                  {edit.windows.length < 3 && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, windows: [...edit.windows, { start: "09:00", end: "18:00" }] })}><Plus className="h-3.5 w-3.5" />Window</Button>}
                </div>
              </div>
            </div>
            <CheckRow checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

type EscEdit = Omit<Escalation, "id"> & { id?: string };
const blankEsc = (): EscEdit => ({ name: "", match: "all", conditions: [], prebreach: [50, 80], levels: [{ afterMinutes: 0, notifyUserIds: [], emails: [], reassignTo: null, priority: null }], active: true });

export function EscalationsPanel({ brand, list, refs }: { brand: string; list: Escalation[]; refs: Refs }) {
  const { run, busy, error, setError, messages } = useRun();
  const { confirm, confirmDialog } = useConfirm();
  const [edit, setEdit] = useState<EscEdit | null>(null);
  const open = (e: EscEdit) => { setError(null); setEdit(e); };
  const save = async () => { if (edit && busy !== "save" && (await runOk(run, "save", saveEscalationAction(brand, edit), () => "Escalation matrix saved."))) setEdit(null); };
  const setLevel = (i: number, p: Partial<EscalationLevel>) => edit && setEdit({ ...edit, levels: edit.levels.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const agent = (id: string | null) => refs.agents.find((a) => a.id === id)?.name ?? "someone";
  return (
    <Card>
      <CardHeader title="Escalation matrix" description="Warn the assignee before a TAT target is missed, then escalate level by level after the breach: notify people in the app, email managers, reassign or raise priority. Escalation emails obey the brand's allowed domains."
        actions={<Button size="sm" variant="primary" onClick={() => open(blankEsc())}><Plus className="h-3.5 w-3.5" />New matrix</Button>} />
      <CardBody>
        {messages}
        {list.length ? (
          <ul className="divide-y divide-border">
            {list.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">{e.name}<Badge tone={e.active ? "good" : "neutral"}>{e.active ? "Active" : "Off"}</Badge></div>
                  <p className="text-[12px] text-text-2">{e.conditions.length ? `${e.conditions.length} conditions (${e.match})` : "All tickets"} · warn at {e.prebreach.map((p) => `${p}%`).join(", ") || "never"}</p>
                  <ol className="mt-0.5 text-[12px] text-text-3">
                    {e.levels.map((l, i) => <li key={i}>Level {i + 1}, {l.afterMinutes ? `${fmt(l.afterMinutes)} after breach` : "at breach"}: {[l.notifyUserIds.length && `notify ${l.notifyUserIds.map(agent).join(", ")}`, l.emails.length && `email ${l.emails.join(", ")}`, l.reassignTo && `reassign to ${agent(l.reassignTo)}`, l.priority && `priority ${l.priority}`].filter(Boolean).join(" · ") || "no action"}</li>)}
                  </ol>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${e.name}`} onClick={() => open({ ...e })}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${e.name}`} onClick={async () => { if (await confirm({ title: `Delete “${e.name}”?`, description: "Tickets it covered stop getting its warnings and escalations." })) run("d", deleteEscalationAction(brand, e.id), () => `${e.name} deleted.`); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<Siren className="h-5 w-5" />} title="No escalation matrix" description="Without one, breached tickets are only flagged in the inbox." />}
      </CardBody>
      {confirmDialog}
      <Dialog size="xl" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "New escalation matrix"} error={error} onSubmit={save}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "save"}>Save</Button></>}>
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input autoFocus value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Pre-breach warnings (% of the target used)" hint="Up to four, e.g. 50, 80. The assignee is notified in the app."><ListInput value={edit.prebreach.map(String)} onChange={(v) => setEdit({ ...edit, prebreach: v.map(Number).filter((n) => !Number.isNaN(n)) })} /></Field>
            </div>
            <section>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-text">Applies to tickets where <Segmented value={edit.match} onChange={(m) => setEdit({ ...edit, match: m })} options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} /> match <span className="font-normal text-text-3">(none = every ticket)</span></div>
              <ConditionsEditor value={edit.conditions} onChange={(c) => setEdit({ ...edit, conditions: c })} ctx={refs} fieldsAllowed={["channel", "priority", "severity", "segment", "classification", "field", "sentiment", "contact_tag"]} />
            </section>
            <section className="space-y-2">
              <div className="text-[13px] font-medium text-text">Levels after breach</div>
              {edit.levels.map((l, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-4">
                  <Field label={`Level ${i + 1}: minutes after breach`}><Input type="number" min={0} value={l.afterMinutes} onChange={(e) => setLevel(i, { afterMinutes: Number(e.target.value) })} /></Field>
                  <Field label="Notify in app">
                    <Select multiple className="h-20" value={l.notifyUserIds} onChange={(e) => setLevel(i, { notifyUserIds: [...e.target.selectedOptions].map((o) => o.value) })}>{refs.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
                  </Field>
                  <Field label="Email"><ListInput value={l.emails} onChange={(v) => setLevel(i, { emails: v })} placeholder="lead@yourcompany.com" /></Field>
                  <div className="space-y-2">
                    <Field label="Reassign to"><Select value={l.reassignTo ?? ""} onChange={(e) => setLevel(i, { reassignTo: e.target.value || null })}><option value="">Keep</option>{refs.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
                    <Field label="Priority"><Select value={l.priority ?? ""} onChange={(e) => setLevel(i, { priority: e.target.value || null })}><option value="">Keep</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
                  </div>
                  {edit.levels.length > 1 && <div className="sm:col-span-4"><Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, levels: edit.levels.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" />Remove level</Button></div>}
                </div>
              ))}
              {edit.levels.length < 5 && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, levels: [...edit.levels, { afterMinutes: (edit.levels.at(-1)?.afterMinutes ?? 0) + 60, notifyUserIds: [], emails: [], reassignTo: null, priority: null }] })}><Plus className="h-3.5 w-3.5" />Add level</Button>}
            </section>
            <CheckRow checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
          </div>
        )}
      </Dialog>
    </Card>
  );
}
