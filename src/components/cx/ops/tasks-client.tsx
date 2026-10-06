"use client";

import { ClipboardList, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { commentTaskAction, deleteTaskAction, updateTaskAction } from "@/app/(app)/cx/tasks/actions";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import { taskDueState, taskStatusLabel, TASK_PRIORITIES, TASK_STATUSES, type DueState, type TaskStatus } from "@/lib/cx/ops/model";
import type { Task, TaskView } from "@/lib/cx/ops/tasks";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TaskDialog, type AgentOpt, type TreeNode } from "./task-dialog";

const DUE_TONE: Record<DueState, Tone> = { overdue: "critical", today: "warning", soon: "info", later: "neutral", none: "neutral", done: "good" };
const PRI_TONE: Record<string, Tone> = { urgent: "critical", high: "warning", normal: "neutral", low: "neutral" };
const STATUS_TONE: Record<string, Tone> = { open: "info", in_progress: "brand", waiting: "warning", done: "good", cancelled: "neutral" };
type Detail = { task: Task; events: { id: string; actor: string; kind: string; detail: string; created_at: string }[] };

export function DueBadge({ t }: { t: Pick<Task, "status" | "due_at"> }) {
  const s = taskDueState(t);
  if (!t.due_at) return <span className="text-[12px] text-text-3">No due date</span>;
  return <span suppressHydrationWarning><Badge tone={DUE_TONE[s]} title={dateTimeLabel(t.due_at)}>{s === "overdue" ? `Overdue · ${timeAgo(t.due_at)}` : dateTimeLabel(t.due_at)}</Badge></span>;
}

export function TasksClient({ brand, me, role, view, filters, tasks, agents, tree, open }: {
  brand: string; me: { id: string; name: string }; role: string; view: TaskView; filters: { q: string; status: string; priority: string; assignee: string };
  tasks: Task[]; agents: AgentOpt[]; tree: TreeNode[]; open: Detail | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  const readOnly = role === "viewer";
  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const patch = async (id: string, p: Parameters<typeof updateTaskAction>[2]) => { setError(null); const r = await updateTaskAction(brand, id, p); if (!r.ok) setError(r.error); router.refresh(); };
  const columns: Column<Task>[] = [
    { key: "done", header: "", sortable: false, noExport: true, width: "32px", render: (t) => <input type="checkbox" checked={["done", "cancelled"].includes(t.status)} disabled={readOnly} onChange={(e) => patch(t.id, { status: e.target.checked ? "done" : "open" })} className="h-3.5 w-3.5 accent-[var(--brand)]" aria-label={`Mark T-${t.number} done`} /> },
    {
      key: "title", header: "Task", sortValue: (t) => t.title, csv: (t) => `T-${t.number} ${t.title}`,
      render: (t) => (
        <div className="min-w-0 max-w-[420px]">
          <button type="button" onClick={() => go({ task: t.id })} className={cn("block truncate text-left font-medium hover:underline", ["done", "cancelled"].includes(t.status) ? "text-text-3 line-through" : "text-link")}><span className="text-text-3">T-{t.number}</span> {t.title}</button>
          <div className="truncate text-[11.5px] text-text-3">
            {t.ticket_id ? <Link href={`/cx/inbox?brand=${brand}&view=all&t=${t.ticket_id}`} className="hover:underline">Ticket #{t.ticket_number} {t.ticket_subject}</Link> : "Standalone"}
            {t.classification_path && <> · {t.classification_path}</>}
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", sortValue: (t) => t.status, csv: (t) => taskStatusLabel(t.status), render: (t) => readOnly ? <Badge tone={STATUS_TONE[t.status]}>{taskStatusLabel(t.status)}</Badge> : (
      <Select value={t.status} onChange={(e) => patch(t.id, { status: e.target.value as TaskStatus })} className="h-7 w-[118px] py-0 text-[12px]" aria-label={`Status of T-${t.number}`}>
        {TASK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </Select>
    ) },
    { key: "priority", header: "Priority", sortValue: (t) => TASK_PRIORITIES.indexOf(t.priority), csv: (t) => t.priority, render: (t) => <Badge tone={PRI_TONE[t.priority]}>{t.priority[0].toUpperCase() + t.priority.slice(1)}</Badge> },
    { key: "due", header: "Due", sortValue: (t) => (t.due_at ? Date.parse(t.due_at) : Number.MAX_SAFE_INTEGER), csv: (t) => t.due_at ?? "", render: (t) => <DueBadge t={t} /> },
    { key: "assignee", header: "Assignee", sortValue: (t) => t.assignee_name ?? "", csv: (t) => t.assignee_name ?? "", hideOnMobile: true, render: (t) => t.assignee_name ? <span className="text-text">{t.assignee_id === me.id ? `${t.assignee_name} (me)` : t.assignee_name}</span> : <span className="text-warning-ink">Unassigned</span> },
    { key: "created", header: "Created", sortValue: (t) => Date.parse(t.created_at), csv: (t) => t.created_at, hideOnMobile: true, render: (t) => <span className="text-[12px] text-text-2" suppressHydrationWarning>{timeAgo(t.created_at)} · {t.created_by_name}</span> },
    { key: "edit", header: "", sortable: false, noExport: true, render: (t) => !readOnly && <button type="button" onClick={() => setEditing(t)} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Edit T-${t.number}`}><Pencil className="h-3.5 w-3.5" /></button> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form className="relative min-w-[200px] flex-1 sm:max-w-sm" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || null, task: null }); }}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, tickets, classification" className="h-8 pl-8 text-[13px]" aria-label="Search tasks" />
        </form>
        <Select value={filters.status} onChange={(e) => go({ status: e.target.value || null })} className={cn("h-8 w-auto text-[12.5px]", filters.status && "border-link text-link")} aria-label="Status"><option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
        <Select value={filters.priority} onChange={(e) => go({ priority: e.target.value || null })} className={cn("h-8 w-auto text-[12.5px]", filters.priority && "border-link text-link")} aria-label="Priority"><option value="">Any priority</option>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</Select>
        {view !== "mine" && <Select value={filters.assignee} onChange={(e) => go({ assignee: e.target.value || null })} className={cn("h-8 w-auto text-[12.5px]", filters.assignee && "border-link text-link")} aria-label="Assignee"><option value="">Anyone</option><option value="none">Unassigned</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
        {(filters.q || filters.status || filters.priority || filters.assignee) && <button className="inline-flex items-center gap-1 text-[12.5px] text-link hover:underline" onClick={() => go({ q: null, status: null, priority: null, assignee: null })}><X className="h-3 w-3" />Clear</button>}
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => setCreating(true)} disabled={readOnly}><Plus className="h-3.5 w-3.5" />New task</Button>
      </div>
      {error && <Callout tone="critical">{error}</Callout>}
      <Card>
        {tasks.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={view === "mine" ? "No open tasks assigned to you" : "No tasks here"} description="Create a task here or from any ticket (ticket menu → Create task, or the card's “Create task” action)." action={!readOnly && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" />New task</Button>} />
        ) : (
          <DataTable rows={tasks} columns={columns} rowKey={(t) => t.id} exportName={`tasks-${view}`} pageSize={50} dense />
        )}
      </Card>
      {creating && <TaskDialog brand={brand} agents={agents} tree={tree} me={me} onClose={() => setCreating(false)} />}
      {editing && <TaskDialog brand={brand} agents={agents} tree={tree} me={me} existing={editing} onClose={() => setEditing(null)} />}
      {open && <TaskDetail brand={brand} detail={open} readOnly={readOnly} canDelete={open.task.created_by === me.id || ["owner", "admin", "supervisor"].includes(role)} onEdit={() => setEditing(open.task)} onClose={() => go({ task: null })} />}
    </div>
  );
}

function TaskDetail({ brand, detail, readOnly, canDelete, onEdit, onClose }: { brand: string; detail: Detail; readOnly: boolean; canDelete: boolean; onEdit: () => void; onClose: () => void }) {
  const router = useRouter();
  const t = detail.task;
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const remove = async () => {
    if (!(await confirm({ title: `Delete task T-${t.number}?`, description: t.title }))) return;
    setDeleting(true); setError(null);
    const r = await deleteTaskAction(brand, t.id);
    setDeleting(false);
    if (!r.ok) return setError(r.error);
    onClose(); router.refresh();
  };
  return (
    <>
    <Dialog open onClose={onClose} size="lg" title={<span><span className="font-normal text-text-3">T-{t.number}</span> {t.title}</span>} error={error}
      description={t.ticket_id ? <Link href={`/cx/inbox?brand=${brand}&view=all&t=${t.ticket_id}`} className="text-link hover:underline">Ticket #{t.ticket_number}: {t.ticket_subject}</Link> : "Standalone task"}
      footerStart={canDelete && !readOnly && <Button variant="ghost" className="text-critical-ink" loading={deleting} onClick={remove}>{!deleting && <Trash2 className="h-3.5 w-3.5" />}Delete</Button>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {!readOnly && <Button variant="primary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
      </>}>
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <KV label="Status"><Badge tone={STATUS_TONE[t.status]}>{taskStatusLabel(t.status)}</Badge></KV>
          <KV label="Priority"><Badge tone={PRI_TONE[t.priority]}>{t.priority}</Badge></KV>
          <KV label="Due"><DueBadge t={t} /></KV>
          <KV label="Assignee">{t.assignee_name ?? <span className="text-warning-ink">Unassigned</span>}</KV>
          <KV label="Classification">{t.classification_path || <span className="text-text-3">n/a</span>}</KV>
          <KV label="Customer">{t.contact_id ? <Link href={`/cx/contacts/${t.contact_id}?brand=${brand}`} className="text-link hover:underline">{t.contact_name || "Contact"}</Link> : <span className="text-text-3">n/a</span>}</KV>
        </div>
        {t.description ? <p className="rounded-md bg-surface-2 p-2.5 whitespace-pre-wrap text-text">{t.description}</p> : <p className="text-text-3">No description.</p>}
        {!readOnly && (
          <form className="space-y-1.5" onSubmit={async (e) => { e.preventDefault(); if (busy || !comment.trim()) return; setBusy(true); setError(null); const r = await commentTaskAction(brand, t.id, comment); setBusy(false); if (!r.ok) return setError(r.error); setComment(""); router.refresh(); }}>
            <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment or progress note…" aria-label="Comment" />
            <div className="flex justify-end"><Button size="sm" type="submit" loading={busy} disabled={busy || !comment.trim()}>Comment</Button></div>
          </form>
        )}
        <div>
          <div className="mb-1 text-[11.5px] font-medium tracking-wide text-text-3 uppercase">Activity</div>
          <ul className="space-y-1.5">
            {detail.events.map((e) => (
              <li key={e.id} className={cn("text-[12.5px]", e.kind === "comment" ? "rounded-md border border-border bg-surface p-2" : "text-text-2")}>
                <span className="font-medium text-text">{e.actor}</span> {e.kind === "comment" ? <span className="text-text-3">commented</span> : e.detail}{" "}
                <span className="text-text-3" suppressHydrationWarning>· {timeAgo(e.created_at)}</span>
                {e.kind === "comment" && <p className="mt-0.5 whitespace-pre-wrap text-text">{e.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
    {confirmDialog}
    </>
  );
}
const KV = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><div className="text-[11.5px] text-text-3">{label}</div><div className="mt-0.5 text-text">{children}</div></div>
);
