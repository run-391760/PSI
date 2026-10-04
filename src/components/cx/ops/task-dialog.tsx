"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createTaskAction, updateTaskAction } from "@/app/(app)/cx/tasks/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { classificationPath } from "@/lib/cx/admin/pure/fields";
import { REMIND_OPTIONS, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/cx/ops/model";
import type { Task } from "@/lib/cx/ops/tasks";

export type TreeNode = { id: string; parentId: string | null; label: string; level: number; hidden: boolean };
export type AgentOpt = { id: string; name: string };

/** datetime-local value (local time) ⇄ ISO */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Create or edit a CRM task (standalone or linked to a ticket). */
export function TaskDialog({ brand, agents, tree, me, ticket, existing, onClose, onSaved }: {
  brand: string; agents: AgentOpt[]; tree: TreeNode[]; me: { id: string }; ticket?: { id: string; number: number; subject: string } | null;
  existing?: Task | null; onClose: () => void; onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    title: existing?.title ?? (ticket ? `Follow up on #${ticket.number}` : ""),
    description: existing?.description ?? "",
    dueAt: toLocal(existing?.due_at ?? null),
    remindMinutes: existing?.remind_minutes ?? 0,
    assigneeId: existing ? existing.assignee_id ?? "" : me.id,
    priority: (existing?.priority ?? "normal") as TaskPriority,
    status: (existing?.status ?? "open") as TaskStatus,
    classificationId: existing?.classification_id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const classes = useMemo(() => tree.filter((n) => !n.hidden).map((n) => ({ id: n.id, path: classificationPath(tree, n.id).join(" › ") })).sort((a, b) => a.path.localeCompare(b.path)), [tree]);
  const presets: [string, number][] = [["In 1 hour", 1], ["Tomorrow 10:00", -1], ["In 3 days", 72]];
  const save = async () => {
    setBusy(true);
    setError(null);
    const input = {
      title: f.title, description: f.description, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, remindMinutes: Number(f.remindMinutes),
      assigneeId: f.assigneeId || null, priority: f.priority, status: f.status, classificationId: f.classificationId || null,
    };
    const r = existing ? await updateTaskAction(brand, existing.id, input) : await createTaskAction(brand, { ...input, ticketId: ticket?.id ?? null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
    onSaved?.(existing ? existing.id : (r.data as { id: string }).id);
    onClose();
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={existing ? `Edit task T-${existing.number}` : "New task"}
      description={ticket ? `Linked to ticket #${ticket.number}: ${ticket.subject}` : existing?.ticket_number ? `Linked to ticket #${existing.ticket_number}` : "A standalone CRM task. Link it to a ticket from the ticket's menu."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : existing ? "Save task" : "Create task"}</Button></>}>
      <div className="space-y-3">
        <Field label="Title" htmlFor="tk-title"><Input id="tk-title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus /></Field>
        <Field label="Description" htmlFor="tk-desc"><Textarea id="tk-desc" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What needs to happen, context, links…" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due" htmlFor="tk-due" hint={
            <span className="flex flex-wrap gap-x-2">
              {presets.map(([l, h]) => (
                <button key={l} type="button" className="text-link hover:underline" onClick={() => {
                  const d = new Date();
                  if (h < 0) { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); } else d.setTime(d.getTime() + h * 3_600_000);
                  set("dueAt", toLocal(d.toISOString()));
                }}>{l}</button>
              ))}
              {f.dueAt && <button type="button" className="text-text-3 hover:underline" onClick={() => set("dueAt", "")}>Clear</button>}
            </span>
          }>
            <Input id="tk-due" type="datetime-local" value={f.dueAt} onChange={(e) => set("dueAt", e.target.value)} />
          </Field>
          <Field label="Reminder" htmlFor="tk-rem">
            <Select id="tk-rem" value={String(f.remindMinutes)} disabled={!f.dueAt} onChange={(e) => set("remindMinutes", Number(e.target.value))}>
              {REMIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="tk-as">
            <Select id="tk-as" value={f.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.id === me.id ? `${a.name} (me)` : a.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="tk-pr">
            <Select id="tk-pr" value={f.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="tk-st">
            <Select id="tk-st" value={f.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="CRM classification" htmlFor="tk-cl" hint={classes.length ? undefined : "Define the classification tree in Settings → Fields & classification."}>
            <Select id="tk-cl" value={f.classificationId} onChange={(e) => set("classificationId", e.target.value)} disabled={!classes.length}>
              <option value="">Not classified</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
            </Select>
          </Field>
        </div>
        {error && <Callout tone="critical">{error}</Callout>}
      </div>
    </Dialog>
  );
}
