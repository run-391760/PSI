import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getClassificationTree } from "@/lib/cx/admin/fields";
import { classificationPath } from "@/lib/cx/admin/pure/fields";
import { listAgents, logEvent } from "@/lib/cx/inbox/store";
import { normNotify, taskInputError, taskReminderDue, taskStatusLabel, TASK_DONE, type NotifyPrefs, type TaskPriority, type TaskStatus } from "./model";

/**
 * CRM tasks (Konnect "My Tasks"): standalone or linked to a ticket. Changes are logged on the task and,
 * when linked, on the ticket's activity. Assignees get notifications (respecting My Profile preferences);
 * reminders fire before the due time and once when a task becomes overdue (fireDueTasks).
 */
export type Task = {
  id: string; number: number; title: string; description: string; status: TaskStatus; priority: TaskPriority;
  due_at: string | null; remind_minutes: number; reminded_at: string | null; assignee_id: string | null; assignee_name: string | null;
  classification_id: string | null; classification_path: string; ticket_id: string | null; ticket_number: number | null; ticket_subject: string | null;
  contact_id: string | null; contact_name: string | null; created_by: string | null; created_by_name: string; completed_at: string | null; created_at: string; updated_at: string;
};
export type TaskInput = {
  title: string; description?: string; status?: TaskStatus; priority?: TaskPriority; dueAt?: string | null; remindMinutes?: number;
  assigneeId?: string | null; classificationId?: string | null; ticketId?: string | null;
};
export type TaskView = "mine" | "all" | "overdue" | "today" | "created" | "done";
export const TASK_VIEWS: { id: TaskView; label: string }[] = [
  { id: "mine", label: "My tasks" },
  { id: "today", label: "Due today" },
  { id: "overdue", label: "Overdue" },
  { id: "created", label: "Created by me" },
  { id: "all", label: "All tasks" },
  { id: "done", label: "Completed" },
];

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const SELECT = `SELECT k.id,k.number,k.title,k.description,k.status,k.priority,k.due_at,k.remind_minutes,k.reminded_at,k.assignee_id,COALESCE(NULLIF(u.name,''),u.email) AS assignee_name,
  k.classification_id,k.classification_path,k.ticket_id,t.number AS ticket_number,t.subject AS ticket_subject,k.contact_id,c.name AS contact_name,
  k.created_by,k.created_by_name,k.completed_at,k.created_at,k.updated_at
  FROM cx_ops_tasks k LEFT JOIN users u ON u.id=k.assignee_id LEFT JOIN cx_tickets t ON t.id=k.ticket_id LEFT JOIN cx_contacts c ON c.id=k.contact_id`;
const norm = (r: Task): Task => ({ ...r, due_at: iso(r.due_at), reminded_at: iso(r.reminded_at), completed_at: iso(r.completed_at), created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)! });

function viewSql(view: TaskView, user: string) {
  switch (view) {
    case "mine": return `k.assignee_id=${user} AND k.status NOT IN ('done','cancelled')`;
    case "overdue": return `k.due_at < now() AND k.status NOT IN ('done','cancelled')`;
    case "today": return `k.due_at::date = now()::date AND k.status NOT IN ('done','cancelled')`;
    case "created": return `k.created_by=${user}`;
    case "done": return `k.status IN ('done','cancelled')`;
    default: return "true";
  }
}

export async function listTasks(projectId: string, userId: string, f: { view?: TaskView; q?: string; status?: string; priority?: string; assignee?: string; ticketId?: string } = {}) {
  const params: unknown[] = [projectId, userId];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["k.project_id=$1", "$2::text IS NOT NULL"];
  if (!f.ticketId) where.push(viewSql(f.view ?? "mine", "$2"));
  if (f.ticketId) where.push(`k.ticket_id=${p(f.ticketId)}`);
  if (f.status) where.push(`k.status=${p(f.status)}`);
  if (f.priority) where.push(`k.priority=${p(f.priority)}`);
  if (f.assignee) where.push(f.assignee === "none" ? "k.assignee_id IS NULL" : `k.assignee_id=${p(f.assignee)}`);
  if (f.q) { const x = p(`%${f.q}%`); where.push(`(k.title ILIKE ${x} OR k.description ILIKE ${x} OR k.classification_path ILIKE ${x} OR t.subject ILIKE ${x})`); }
  const rows = await query<Task>(
    `${SELECT} WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN k.status IN ('done','cancelled') THEN 1 ELSE 0 END, k.due_at ASC NULLS LAST, CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, k.created_at DESC
      LIMIT 1000`,
    params,
  );
  return rows.map(norm);
}

export async function taskCounts(projectId: string, userId: string) {
  const [r] = await query<Record<TaskView, number>>(
    `SELECT ${TASK_VIEWS.map((v) => `count(*) FILTER (WHERE ${viewSql(v.id, "$2")})::int AS ${v.id}`).join(",")} FROM cx_ops_tasks k WHERE k.project_id=$1 AND $2::text IS NOT NULL`,
    [projectId, userId],
  );
  return r;
}

export async function getTask(projectId: string, id: string) {
  const [r] = await query<Task>(`${SELECT} WHERE k.project_id=$1 AND k.id=$2`, [projectId, id]);
  if (!r) return null;
  const events = (await query<{ id: string; actor: string; kind: string; detail: string; created_at: string }>("SELECT id,actor,kind,detail,created_at FROM cx_ops_task_events WHERE task_id=$1 ORDER BY created_at DESC LIMIT 100", [id]))
    .map((e) => ({ ...e, created_at: iso(e.created_at)! }));
  return { task: norm(r), events };
}

async function taskEvent(q: Query, taskId: string, actor: string, kind: string, detail: string) {
  await q("INSERT INTO cx_ops_task_events(id,task_id,actor,kind,detail) VALUES($1,$2,$3,$4,$5)", [randomUUID(), taskId, actor, kind, detail.slice(0, 1000)]);
}

export async function notifyPrefsOf(userId: string): Promise<NotifyPrefs> {
  const [r] = await query<{ prefs: Partial<NotifyPrefs> }>("SELECT prefs FROM cx_ops_user_prefs WHERE user_id=$1", [userId]);
  return normNotify(r?.prefs);
}
async function notifyUser(userId: string, pref: keyof NotifyPrefs, n: { projectId: string; title: string; body?: string; link: string; severity?: "info" | "warning" }) {
  if (!(await notifyPrefsOf(userId))[pref]) return;
  const { notify } = await import("@/lib/jobs/queue");
  await notify({ ownerId: userId, projectId: n.projectId, tool: "CX Tasks", severity: n.severity ?? "info", title: n.title.slice(0, 200), body: n.body, link: n.link }).catch(() => {});
}
export const taskLink = (projectId: string, id: string) => `/cx/tasks?brand=${projectId}&view=all&task=${id}`;

async function resolveRefs(projectId: string, input: TaskInput) {
  const agents = await listAgents(projectId);
  if (input.assigneeId && !agents.some((a) => a.id === input.assigneeId)) throw new AppError("That person is not on this brand.");
  let classificationPathText = "";
  if (input.classificationId) {
    const tree = await getClassificationTree(projectId);
    if (!tree.some((n) => n.id === input.classificationId)) throw new AppError("Unknown classification.");
    classificationPathText = classificationPath(tree, input.classificationId).join(" > ");
  }
  let ticket: { id: string; number: number; contact_id: string | null } | null = null;
  if (input.ticketId) {
    [ticket] = await query<{ id: string; number: number; contact_id: string | null }>("SELECT id,number,contact_id FROM cx_tickets WHERE id=$1 AND project_id=$2", [input.ticketId, projectId]);
    if (!ticket) throw new AppError("Ticket not found.", 404);
  }
  return { agents, classificationPathText, ticket };
}

export async function createTask(projectId: string, user: { id: string; name: string }, input: TaskInput) {
  const err = taskInputError(input);
  if (err) throw new AppError(err);
  const { classificationPathText, ticket } = await resolveRefs(projectId, input);
  const status = input.status ?? "open";
  const r = await transaction(async (q) => {
    const [{ n }] = await q<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM cx_ops_tasks WHERE project_id=$1", [projectId]);
    const id = randomUUID();
    await q(
      `INSERT INTO cx_ops_tasks(id,project_id,number,title,description,status,priority,due_at,remind_minutes,assignee_id,classification_id,classification_path,ticket_id,contact_id,created_by,created_by_name,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, projectId, n, input.title.trim().slice(0, 200), (input.description ?? "").slice(0, 10_000), status, input.priority ?? "normal", input.dueAt ? new Date(input.dueAt).toISOString() : null,
        Math.round(input.remindMinutes ?? 0), input.assigneeId || null, input.classificationId || null, classificationPathText, ticket?.id ?? null, ticket?.contact_id ?? null, user.id, user.name, TASK_DONE.has(status) ? new Date().toISOString() : null],
    );
    await taskEvent(q, id, user.name, "create", "created the task");
    if (ticket) await logEvent(q, ticket.id, user.name, "task", `created task T-${n}: ${input.title.trim().slice(0, 120)}`);
    return { id, number: n };
  });
  if (input.assigneeId && input.assigneeId !== user.id)
    await notifyUser(input.assigneeId, "taskAssigned", { projectId, title: `${user.name} assigned you task T-${r.number}: ${input.title.trim()}`, body: input.dueAt ? `Due ${new Date(input.dueAt).toUTCString()}` : undefined, link: taskLink(projectId, r.id) });
  return r;
}

export async function updateTask(projectId: string, user: { id: string; name: string }, id: string, patch: Partial<TaskInput>) {
  const cur = await getTask(projectId, id);
  if (!cur) throw new AppError("Task not found.", 404);
  const t = cur.task;
  const merged = { title: patch.title ?? t.title, status: patch.status, priority: patch.priority, dueAt: patch.dueAt, remindMinutes: patch.remindMinutes };
  const err = taskInputError(merged);
  if (err) throw new AppError(err);
  const { agents, classificationPathText, ticket } = await resolveRefs(projectId, { title: merged.title, assigneeId: patch.assigneeId, classificationId: patch.classificationId, ticketId: patch.ticketId });
  const sets: string[] = ["updated_at=now()"];
  const params: unknown[] = [id, projectId];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col}=$${params.length}`); };
  const changes: string[] = [];
  if (patch.title !== undefined && patch.title.trim() !== t.title) { set("title", patch.title.trim().slice(0, 200)); changes.push("renamed the task"); }
  if (patch.description !== undefined && patch.description !== t.description) { set("description", patch.description.slice(0, 10_000)); changes.push("edited the description"); }
  if (patch.status && patch.status !== t.status) {
    set("status", patch.status);
    set("completed_at", TASK_DONE.has(patch.status) ? new Date().toISOString() : null);
    changes.push(`status → ${taskStatusLabel(patch.status)}`);
  }
  if (patch.priority && patch.priority !== t.priority) { set("priority", patch.priority); changes.push(`priority → ${patch.priority}`); }
  if (patch.dueAt !== undefined) {
    const v = patch.dueAt ? new Date(patch.dueAt).toISOString() : null;
    if (v !== t.due_at) { set("due_at", v); set("reminded_at", null); set("overdue_notified_at", null); changes.push(v ? `due → ${v.slice(0, 16).replace("T", " ")} UTC` : "removed the due date"); }
  }
  if (patch.remindMinutes !== undefined && patch.remindMinutes !== t.remind_minutes) { set("remind_minutes", Math.round(patch.remindMinutes)); set("reminded_at", null); changes.push("changed the reminder"); }
  if (patch.assigneeId !== undefined && (patch.assigneeId || null) !== t.assignee_id) {
    set("assignee_id", patch.assigneeId || null);
    changes.push(patch.assigneeId ? `assigned to ${agents.find((a) => a.id === patch.assigneeId)?.name ?? "agent"}` : "unassigned");
  }
  if (patch.classificationId !== undefined && (patch.classificationId || null) !== t.classification_id) {
    set("classification_id", patch.classificationId || null); set("classification_path", classificationPathText);
    changes.push(`classification → ${classificationPathText || "none"}`);
  }
  if (patch.ticketId !== undefined && (patch.ticketId || null) !== t.ticket_id) {
    set("ticket_id", ticket?.id ?? null); set("contact_id", ticket?.contact_id ?? null);
    changes.push(ticket ? `linked to ticket #${ticket.number}` : "unlinked from the ticket");
  }
  if (!changes.length) return;
  await transaction(async (q) => {
    await q(`UPDATE cx_ops_tasks SET ${sets.join(",")} WHERE id=$1 AND project_id=$2`, params);
    await taskEvent(q, id, user.name, "update", changes.join("; "));
    const ticketId = ticket?.id ?? t.ticket_id;
    if (ticketId) await logEvent(q, ticketId, user.name, "task", `T-${t.number} ${t.title.slice(0, 80)}: ${changes.join("; ")}`);
  });
  if (patch.assigneeId && patch.assigneeId !== t.assignee_id && patch.assigneeId !== user.id)
    await notifyUser(patch.assigneeId, "taskAssigned", { projectId, title: `${user.name} assigned you task T-${t.number}: ${patch.title ?? t.title}`, link: taskLink(projectId, id) });
  if (patch.status && TASK_DONE.has(patch.status) && t.created_by && t.created_by !== user.id)
    await notifyUser(t.created_by, "taskAssigned", { projectId, title: `${user.name} marked task T-${t.number} ${taskStatusLabel(patch.status).toLowerCase()}`, body: t.title, link: taskLink(projectId, id) });
}

export async function addTaskComment(projectId: string, user: { id: string; name: string }, id: string, body: string) {
  const text = body.trim();
  if (!text) throw new AppError("Write a comment first.");
  const cur = await getTask(projectId, id);
  if (!cur) throw new AppError("Task not found.", 404);
  await transaction((q) => taskEvent(q, id, user.name, "comment", text.slice(0, 1000)));
  if (cur.task.assignee_id && cur.task.assignee_id !== user.id)
    await notifyUser(cur.task.assignee_id, "mentions", { projectId, title: `${user.name} commented on task T-${cur.task.number}`, body: text.slice(0, 300), link: taskLink(projectId, id) });
}

export async function deleteTask(projectId: string, user: { name: string }, id: string) {
  await transaction(async (q) => {
    const [r] = await q<{ ticket_id: string | null; number: number; title: string }>("DELETE FROM cx_ops_tasks WHERE id=$1 AND project_id=$2 RETURNING ticket_id,number,title", [id, projectId]);
    if (r?.ticket_id) await logEvent(q, r.ticket_id, user.name, "task", `deleted task T-${r.number}: ${r.title.slice(0, 80)}`);
  });
}

/**
 * Due reminders (before the due time per the task's reminder setting) and a one-time overdue alert, for one
 * brand or all brands. Notifies the assignee (or the creator when unassigned). Returns how many fired.
 */
export async function fireDueTasks(projectId?: string) {
  const rows = await query<{ id: string; project_id: string; number: number; title: string; status: string; due_at: string; remind_minutes: number; reminded_at: string | null; overdue_notified_at: string | null; assignee_id: string | null; created_by: string | null; ticket_id: string | null }>(
    `SELECT id,project_id,number,title,status,due_at,remind_minutes,reminded_at,overdue_notified_at,assignee_id,created_by,ticket_id FROM cx_ops_tasks
      WHERE ($1::text IS NULL OR project_id=$1) AND status NOT IN ('done','cancelled') AND due_at IS NOT NULL
        AND ((reminded_at IS NULL AND due_at - make_interval(mins => remind_minutes) <= now()) OR (overdue_notified_at IS NULL AND due_at < now()))
      LIMIT 500`,
    [projectId ?? null],
  );
  let fired = 0;
  for (const r of rows) {
    const who = r.assignee_id ?? r.created_by;
    const due = iso(r.due_at)!;
    if (taskReminderDue({ status: r.status, due_at: due, remind_minutes: r.remind_minutes, reminded_at: iso(r.reminded_at) })) {
      const [ok] = await query("UPDATE cx_ops_tasks SET reminded_at=now() WHERE id=$1 AND reminded_at IS NULL RETURNING id", [r.id]);
      if (ok) {
        fired++;
        await transaction((q) => taskEvent(q, r.id, "Reminder", "reminder", `reminder sent (due ${due.slice(0, 16).replace("T", " ")} UTC)`));
        if (who) await notifyUser(who, "taskDue", { projectId: r.project_id, severity: "warning", title: `Task due: T-${r.number} ${r.title}`, body: `Due ${new Date(due).toUTCString()}`, link: taskLink(r.project_id, r.id) });
      }
    }
    if (Date.parse(due) < Date.now() && !r.overdue_notified_at) {
      const [ok] = await query("UPDATE cx_ops_tasks SET overdue_notified_at=now() WHERE id=$1 AND overdue_notified_at IS NULL RETURNING id", [r.id]);
      if (ok) {
        fired++;
        await transaction(async (q) => {
          await taskEvent(q, r.id, "Reminder", "overdue", "task is overdue");
          if (r.ticket_id) await logEvent(q, r.ticket_id, "Tasks", "task", `T-${r.number} is overdue`);
        });
        if (who) await notifyUser(who, "taskDue", { projectId: r.project_id, severity: "warning", title: `Overdue: T-${r.number} ${r.title}`, link: taskLink(r.project_id, r.id) });
      }
    }
  }
  return fired;
}

/**
 * Daily digest (My Profile → "Daily digest"): once per UTC day and brand, each member who opted in gets one
 * in-app notification summarising their open assigned tickets, overdue tasks and tasks due today. The day
 * already sent is kept in cx_ops_user_prefs.prefs.digestSent[projectId].
 */
export async function sendDailyDigests(projectId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const agents = await listAgents(projectId);
  let sent = 0;
  for (const a of agents) {
    const [p] = await query<{ prefs: Record<string, unknown> | null }>("SELECT prefs FROM cx_ops_user_prefs WHERE user_id=$1", [a.id]);
    if (!normNotify(p?.prefs as Partial<NotifyPrefs>).dailyDigest) continue;
    const done = (p?.prefs?.digestSent as Record<string, string> | undefined)?.[projectId];
    if (done === today) continue;
    const [c] = await query<{ tickets: number; breached: number; overdue: number; due_today: number }>(
      `SELECT (SELECT count(*)::int FROM cx_tickets WHERE project_id=$1 AND assignee_id=$2 AND status NOT IN ('solved','closed')) AS tickets,
              (SELECT count(*)::int FROM cx_tickets WHERE project_id=$1 AND assignee_id=$2 AND status NOT IN ('solved','closed') AND ((first_response_at IS NULL AND first_response_due < now()) OR resolution_due < now())) AS breached,
              (SELECT count(*)::int FROM cx_ops_tasks WHERE project_id=$1 AND assignee_id=$2 AND status NOT IN ('done','cancelled') AND due_at < now()) AS overdue,
              (SELECT count(*)::int FROM cx_ops_tasks WHERE project_id=$1 AND assignee_id=$2 AND status NOT IN ('done','cancelled') AND due_at::date = now()::date) AS due_today`,
      [projectId, a.id],
    );
    await query(
      `INSERT INTO cx_ops_user_prefs(user_id,prefs) VALUES($1, jsonb_build_object('digestSent', jsonb_build_object($2::text, $3::text)))
       ON CONFLICT(user_id) DO UPDATE SET prefs = cx_ops_user_prefs.prefs || jsonb_build_object('digestSent', COALESCE(cx_ops_user_prefs.prefs->'digestSent','{}'::jsonb) || jsonb_build_object($2::text, $3::text)), updated_at=now()`,
      [a.id, projectId, today],
    );
    const { notify } = await import("@/lib/jobs/queue");
    await notify({
      ownerId: a.id, projectId, tool: "CX Digest", severity: c.breached || c.overdue ? "warning" : "info",
      title: `Today: ${c.tickets} open ticket${c.tickets === 1 ? "" : "s"}, ${c.due_today} task${c.due_today === 1 ? "" : "s"} due, ${c.overdue} overdue`,
      body: c.breached ? `${c.breached} of your tickets are past their SLA.` : undefined,
      link: c.overdue || c.due_today ? `/cx/tasks?brand=${projectId}&view=${c.overdue ? "overdue" : "today"}` : `/cx/inbox?brand=${projectId}&view=mine`,
    }).catch(() => {});
    sent++;
  }
  return sent;
}
