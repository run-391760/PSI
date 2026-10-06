"use client";

import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import type { AutomationInput, AutomationRow } from "@/lib/cx/admin/automation";
import { AUTO_FIELDS, AUTO_OP_LABELS, type AutoActions } from "@/lib/cx/admin/pure/automation";
import type { QuickAction, QuickActionDef } from "@/lib/cx/admin/quick-actions";
import { SETTABLE_STATUSES } from "@/lib/cx/inbox/model";
import { ConditionsEditor, type ConditionContext } from "../_admin/conditions";
import { runOk } from "../_admin/k-ui";
import { CheckRow, Field, ListInput, When, useRun } from "../_admin/ui";
import { cloneAutomationAction, deleteAutomationAction, deleteQuickActionAction, moveAutomationAction, saveAutomationAction, saveQuickActionAction, toggleAutomationAction } from "./admin-actions";

type Opt = { id: string; name: string };
export type AutoRefs = ConditionContext & { agents: Opt[]; teams: string[]; brands: Opt[] };

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const SEVERITIES = ["Low", "Medium", "High", "Critical"];

const blank = (): AutomationInput => ({ name: "", trigger: "created", social_type: "any", active: true, stop: false, match: "all", conditions: [{ field: "keyword", op: "contains", value: "" }], actions: {} });

function summary(a: AutomationRow, refs: AutoRefs) {
  const parts: string[] = [];
  const x = a.actions;
  if (x.assignee) parts.push(`assign ${refs.agents.find((g) => g.id === x.assignee)?.name ?? "agent"}`);
  if (x.queue) parts.push("send to queue");
  if (x.team) parts.push(`team ${x.team}`);
  if (x.priority) parts.push(`priority ${x.priority}`);
  if (x.severity) parts.push(`severity ${x.severity}`);
  if (x.tags?.length) parts.push(`tag ${x.tags.join(", ")}`);
  if (x.classificationId) parts.push(`classify ${refs.classifications.find((c) => c.id === x.classificationId)?.path ?? ""}`);
  if (x.fields && Object.keys(x.fields).length) parts.push(`set ${Object.keys(x.fields).length} fields`);
  if (x.status) parts.push(`status ${x.status}`);
  if (x.reply) parts.push("auto-reply");
  if (x.note) parts.push("note");
  return parts.join(" · ");
}

export function AutomationsPanel({ brand, list, refs }: { brand: string; list: AutomationRow[]; refs: AutoRefs }) {
  const { run, busy, error, setError, messages } = useRun();
  const { confirm, confirmDialog } = useConfirm();
  const [edit, setEdit] = useState<AutomationInput | null>(null);
  const [clone, setClone] = useState<{ id: string; channel: string; brandId: string } | null>(null);
  const open = (a: AutomationInput) => { setError(null); setEdit(a); };
  const save = async () => { if (edit && busy !== "save" && (await runOk(run, "save", saveAutomationAction(brand, edit), () => `${edit.name || "Automation"} saved.`))) setEdit(null); };
  const doClone = async () => {
    if (!clone || busy === "clone") return;
    if (await runOk(run, "clone", cloneAutomationAction(brand, clone.id, { channel: clone.channel || null, brandId: clone.brandId }), () => "Cloned. The copy is switched off.")) setClone(null);
  };
  const cond = (a: AutomationRow) => a.conditions.map((c) => `${AUTO_FIELDS.find((f) => f.value === c.field)?.label ?? c.field}${c.key ? ` (${c.key})` : ""} ${AUTO_OP_LABELS[c.op]} ${c.field === "classification" ? refs.classifications.find((n) => n.id === c.value)?.path ?? c.value : c.value}`).join(a.match === "all" ? " and " : " or ");

  return (
    <Card>
      <CardHeader
        title="Automations"
        description="Run on new tickets or when the customer replies, in order. Every matching automation applies; later ones override single values, tags merge, and “stop” ends the chain."
        actions={<Button size="sm" variant="primary" onClick={() => open(blank())}><Plus className="h-3.5 w-3.5" />New automation</Button>}
      />
      <CardBody>
        {messages}
        {list.length ? (
          <ol className="divide-y divide-border">
            {list.map((a, i) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 py-2.5">
                <span className="mt-0.5 w-5 text-right text-[12px] text-text-3 tabular">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">
                    {a.name}
                    <Badge tone={a.active ? "good" : "neutral"}>{a.active ? "Active" : "Off"}</Badge>
                    <Badge tone="info">{a.trigger === "created" ? "New ticket" : "Customer reply"}</Badge>
                    {a.social_type !== "any" && <Badge>{a.social_type}</Badge>}
                    {a.stop && <Badge tone="warning">Stops chain</Badge>}
                  </div>
                  <p className="mt-0.5 text-[12px] text-text-2"><span className="text-text-3">If</span> {cond(a)}</p>
                  <p className="text-[12px] text-text-2"><span className="text-text-3">Then</span> {summary(a, refs)}</p>
                  <p className="text-[11.5px] text-text-3">{a.hits} runs{a.last_hit_at && <> · last <When iso={a.last_hit_at} /></>}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <CheckRow checked={a.active} onChange={(v) => run("t", toggleAutomationAction(brand, a.id, v))} label={<span className="sr-only">Active</span>} />
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => run("m", moveAutomationAction(brand, a.id, -1))}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" disabled={i === list.length - 1} onClick={() => run("m", moveAutomationAction(brand, a.id, 1))}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Clone" onClick={() => { setError(null); setClone({ id: a.id, channel: "", brandId: brand }); }}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit" onClick={() => open({ ...a })}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete “${a.name}”?`, description: "New tickets and replies stop running through it. To pause it instead, switch it off." })) run("d", deleteAutomationAction(brand, a.id), () => `${a.name} deleted.`); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ol>
        ) : <EmptyState icon={<Zap className="h-5 w-5" />} title="No automations yet" description="Route, tag, classify, prioritise or auto-reply to tickets based on channel, keywords, sentiment, fields, business hours and more." />}
      </CardBody>

      {confirmDialog}
      <Dialog size="xl" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit automation" : "New automation"} error={error} onSubmit={save}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "save"}>Save</Button></>}>
        {edit && <AutomationForm value={edit} onChange={setEdit} refs={refs} />}
      </Dialog>

      <Dialog size="sm" open={!!clone} onClose={() => setClone(null)} title="Clone automation" description="The copy starts switched off so you can review it." error={error} onSubmit={doClone}
        footer={<><Button variant="ghost" onClick={() => setClone(null)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "clone"}>Clone</Button></>}>
        {clone && (
          <div className="space-y-3">
            <Field label="Brand"><Select value={clone.brandId} onChange={(e) => setClone({ ...clone, brandId: e.target.value })}>{refs.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
            <Field label="Retarget to channel" hint="Replaces the channel condition. Leave empty to keep it.">
              <Select value={clone.channel} onChange={(e) => setClone({ ...clone, channel: e.target.value })}><option value="">Keep as is</option>{refs.channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
            </Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function AutomationForm({ value: a, onChange, refs }: { value: AutomationInput; onChange: (a: AutomationInput) => void; refs: AutoRefs }) {
  const x = a.actions;
  const setX = (p: Partial<AutoActions>) => onChange({ ...a, actions: { ...x, ...p } });
  const fieldEntries = Object.entries(x.fields ?? {});
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-3"><Input autoFocus value={a.name} maxLength={120} onChange={(e) => onChange({ ...a, name: e.target.value })} /></Field>
        <Field label="Runs when">
          <Select value={a.trigger} onChange={(e) => onChange({ ...a, trigger: e.target.value as AutomationInput["trigger"] })}><option value="created">A ticket is created</option><option value="customer_reply">The customer replies</option></Select>
        </Field>
        <Field label="Social type" hint="Public comments, private messages or custom channels.">
          <Select value={a.social_type} onChange={(e) => onChange({ ...a, social_type: e.target.value })}><option value="any">Any</option><option value="public">Public</option><option value="private">Private</option><option value="custom">Custom</option></Select>
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <CheckRow checked={a.active} onChange={(v) => onChange({ ...a, active: v })} label="Active" />
          <CheckRow checked={a.stop} onChange={(v) => onChange({ ...a, stop: v })} label="Stop after this one" />
        </div>
      </div>
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-text">
          If
          <Segmented size="sm" value={a.match} onChange={(m) => onChange({ ...a, match: m })} options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} />
          of these match
        </div>
        <ConditionsEditor value={a.conditions} onChange={(c) => onChange({ ...a, conditions: c })} ctx={refs} />
      </section>
      <section>
        <div className="mb-2 text-[13px] font-medium text-text">Then</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Assign to">
            <Select value={x.queue ? "__queue" : x.assignee ?? ""} onChange={(e) => setX(e.target.value === "__queue" ? { queue: true, assignee: null } : { queue: false, assignee: e.target.value || null })}>
              <option value="">Don&apos;t change</option><option value="__queue">Queue (auto-assign)</option>
              {refs.agents.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </Field>
          <Field label="Team">
            <Input list="auto-teams" value={x.team ?? ""} onChange={(e) => setX({ team: e.target.value || null })} />
            <datalist id="auto-teams">{refs.teams.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Status">
            <Select value={x.status ?? ""} onChange={(e) => setX({ status: e.target.value || null })}><option value="">Don&apos;t change</option>{SETTABLE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </Field>
          <Field label="Priority">
            <Select value={x.priority ?? ""} onChange={(e) => setX({ priority: (e.target.value || null) as AutoActions["priority"] })}><option value="">Don&apos;t change</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
          </Field>
          <Field label="Severity">
            <Select value={x.severity ?? ""} onChange={(e) => setX({ severity: e.target.value || null })}><option value="">Don&apos;t change</option>{SEVERITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
          </Field>
          <Field label="Add tags"><ListInput value={x.tags ?? []} onChange={(t) => setX({ tags: t })} placeholder="billing, vip" /></Field>
          <Field label="Classify as" className="sm:col-span-3">
            <Select value={x.classificationId ?? ""} onChange={(e) => setX({ classificationId: e.target.value || null })}><option value="">Don&apos;t change</option>{refs.classifications.map((n) => <option key={n.id} value={n.id}>{n.path}</option>)}</Select>
          </Field>
          <div className="space-y-1.5 sm:col-span-3">
            <div className="text-[12.5px] font-medium text-text-2">Set fields</div>
            {fieldEntries.map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <Select aria-label="Field" className="w-44" value={k} onChange={(e) => { const f = { ...x.fields }; delete f[k]; f[e.target.value] = v; setX({ fields: f }); }}>{refs.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
                <Input aria-label="Value" value={v} onChange={(e) => setX({ fields: { ...x.fields, [k]: e.target.value } })} />
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => { const f = { ...x.fields }; delete f[k]; setX({ fields: f }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            {refs.fields.some((f) => !(f.key in (x.fields ?? {}))) && (
              <Button size="sm" variant="ghost" onClick={() => { const k = refs.fields.find((f) => !(f.key in (x.fields ?? {})))!.key; setX({ fields: { ...x.fields, [k]: "" } }); }}><Plus className="h-3.5 w-3.5" />Set a field</Button>
            )}
          </div>
          <Field label="Auto-reply" className="sm:col-span-3" hint="Sent publicly on the ticket's channel. Placeholders: {{name}}, {{ticket}}, {{brand}}, {{field.key}}.">
            <Textarea value={x.reply ?? ""} onChange={(e) => setX({ reply: e.target.value || null })} className="min-h-20" />
          </Field>
          <Field label="Internal note" className="sm:col-span-3"><Textarea value={x.note ?? ""} onChange={(e) => setX({ note: e.target.value || null })} className="min-h-16" /></Field>
        </div>
      </section>
    </div>
  );
}

/* ---------------- Quick actions ---------------- */

type QAEdit = { id?: string; name: string; description: string; actions: QuickActionDef };

export function QuickActionsPanel({ brand, list, refs }: { brand: string; list: QuickAction[]; refs: AutoRefs }) {
  const { run, busy, error, setError, messages } = useRun();
  const { confirm, confirmDialog } = useConfirm();
  const [edit, setEdit] = useState<QAEdit | null>(null);
  const open = (q: QAEdit) => { setError(null); setEdit(q); };
  const save = async () => { if (edit && busy !== "save" && (await runOk(run, "save", saveQuickActionAction(brand, edit), () => `${edit.name || "Quick action"} saved.`))) setEdit(null); };
  const x = edit?.actions ?? {};
  const setX = (p: Partial<QuickActionDef>) => edit && setEdit({ ...edit, actions: { ...edit.actions, ...p } });
  const describe = (a: QuickActionDef) => [a.reply && "reply", a.note && "note", a.status && `status ${a.status}`, a.priority && `priority ${a.priority}`, a.assignee && `assign ${refs.agents.find((g) => g.id === a.assignee)?.name ?? ""}`, a.team && `team ${a.team}`, a.addTags?.length && `+${a.addTags.join(", +")}`, a.removeTags?.length && `-${a.removeTags.join(", -")}`, a.classificationId && "classify", a.severity && `severity ${a.severity}`].filter(Boolean).join(" · ");
  return (
    <Card>
      <CardHeader title="Quick actions" description="One-click macros agents run from the inbox on one or many selected tickets. Replies need the Public reply permission; statuses follow the agent's role."
        actions={<Button size="sm" variant="primary" onClick={() => open({ name: "", description: "", actions: {} })}><Plus className="h-3.5 w-3.5" />New quick action</Button>} />
      <CardBody>
        {messages}
        {list.length ? (
          <ul className="divide-y divide-border">
            {list.map((q) => (
              <li key={q.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text">{q.name} <span className="ml-1 text-[12px] font-normal text-text-3">{q.uses} uses</span></div>
                  {q.description && <p className="text-[12px] text-text-2">{q.description}</p>}
                  <p className="text-[12px] text-text-3">{describe(q.actions)}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit" onClick={() => open({ id: q.id, name: q.name, description: q.description, actions: q.actions })}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete “${q.name}”?`, description: "Agents can no longer run it from the inbox." })) run("d", deleteQuickActionAction(brand, q.id), () => `${q.name} deleted.`); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<Zap className="h-5 w-5" />} title="No quick actions" description="For example: “Refund processed” sends a templated reply, tags refund and resolves the ticket." />}
      </CardBody>
      {confirmDialog}
      <Dialog size="lg" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit quick action" : "New quick action"} error={error} onSubmit={save}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === "save"}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input autoFocus value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Description"><Input value={edit.description} maxLength={200} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Reply" className="sm:col-span-2" hint="Placeholders: {{name}}, {{ticket}}, {{brand}}."><Textarea value={x.reply ?? ""} onChange={(e) => setX({ reply: e.target.value })} className="min-h-20" /></Field>
            <Field label="Internal note" className="sm:col-span-2"><Textarea value={x.note ?? ""} onChange={(e) => setX({ note: e.target.value })} className="min-h-14" /></Field>
            <Field label="Status"><Select value={x.status ?? ""} onChange={(e) => setX({ status: e.target.value || null })}><option value="">Don&apos;t change</option>{SETTABLE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
            <Field label="Priority"><Select value={x.priority ?? ""} onChange={(e) => setX({ priority: e.target.value || null })}><option value="">Don&apos;t change</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
            <Field label="Assign to"><Select value={x.assignee ?? ""} onChange={(e) => setX({ assignee: e.target.value || null })}><option value="">Don&apos;t change</option>{refs.agents.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
            <Field label="Team"><Input list="qa-teams" value={x.team ?? ""} onChange={(e) => setX({ team: e.target.value })} /><datalist id="qa-teams">{refs.teams.map((t) => <option key={t} value={t} />)}</datalist></Field>
            <Field label="Add tags"><ListInput value={x.addTags ?? []} onChange={(t) => setX({ addTags: t })} /></Field>
            <Field label="Remove tags"><ListInput value={x.removeTags ?? []} onChange={(t) => setX({ removeTags: t })} /></Field>
            <Field label="Classify as"><Select value={x.classificationId ?? ""} onChange={(e) => setX({ classificationId: e.target.value || null })}><option value="">Don&apos;t change</option>{refs.classifications.map((n) => <option key={n.id} value={n.id}>{n.path}</option>)}</Select></Field>
            <Field label="Severity"><Select value={x.severity ?? ""} onChange={(e) => setX({ severity: e.target.value || null })}><option value="">Don&apos;t change</option>{SEVERITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
