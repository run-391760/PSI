import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { audit } from "./audit";
import { renderTemplate } from "./pure/automation";
import { classifyTicket } from "./fields";
import { requirePermission } from "./roles";

/**
 * Quick Actions (G8, E18): admin-defined macros run from the inbox on one or many tickets.
 * WP1 inbox: list with listQuickActions(brand) and run with runQuickActionAction(brand, id, ticketIds)
 * from "@/app/(app)/cx/settings/automation/admin-actions".
 */
export type QuickActionDef = {
  reply?: string | null; note?: string | null; status?: string | null; priority?: string | null; assignee?: string | null; team?: string | null;
  addTags?: string[]; removeTags?: string[]; classificationId?: string | null; severity?: string | null;
};
export type QuickAction = { id: string; name: string; description: string; actions: QuickActionDef; uses: number; position: number };

export async function listQuickActions(projectId: string): Promise<QuickAction[]> {
  return query<QuickAction>("SELECT id,name,description,actions,uses,position FROM cx_admin_quick_actions WHERE project_id=$1 ORDER BY position, name", [projectId]);
}

export async function saveQuickAction(projectId: string, q: { id?: string; name: string; description: string; actions: QuickActionDef }, actor: { id: string; name: string }) {
  const name = q.name.trim().slice(0, 80);
  if (!name) throw new AppError("Name the quick action.");
  const a = q.actions;
  const actions: QuickActionDef = {
    reply: a.reply?.trim() || null, note: a.note?.trim() || null, status: a.status || null, priority: a.priority || null, assignee: a.assignee || null, team: a.team?.trim() || null,
    addTags: (a.addTags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean), removeTags: (a.removeTags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    classificationId: a.classificationId || null, severity: a.severity || null,
  };
  if (!Object.values(actions).some((v) => (Array.isArray(v) ? v.length : v))) throw new AppError("Choose at least one action.");
  if (q.id) await query("UPDATE cx_admin_quick_actions SET name=$3,description=$4,actions=$5::jsonb WHERE id=$1 AND project_id=$2", [q.id, projectId, name, q.description.slice(0, 200), JSON.stringify(actions)]);
  else await query("INSERT INTO cx_admin_quick_actions(id,project_id,name,description,actions,position) VALUES($1,$2,$3,$4,$5::jsonb,(SELECT COALESCE(MAX(position),0)+1 FROM cx_admin_quick_actions WHERE project_id=$2))", [randomUUID(), projectId, name, q.description.slice(0, 200), JSON.stringify(actions)]);
  await audit(projectId, actor, q.id ? "quick_action.update" : "quick_action.create", name);
}
export async function deleteQuickAction(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_admin_quick_actions WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "quick_action.delete", r.name);
}

/** Run a quick action on tickets as `user` (permission "quick_actions"; replies need "reply_public"). */
export async function runQuickAction(projectId: string, id: string, ticketIds: string[], user: { id: string; name: string }) {
  await requirePermission(projectId, user.id, "quick_actions", "run quick actions");
  const [qa] = (await listQuickActions(projectId)).filter((x) => x.id === id);
  if (!qa) throw new AppError("Quick action not found.", 404);
  const ids = [...new Set(ticketIds)].slice(0, 200);
  const a = qa.actions;
  if (a.reply) await requirePermission(projectId, user.id, "reply_public", "send public replies");
  if (a.status) await requirePermission(projectId, user.id, `status:${a.status}`, `set status ${a.status}`);
  const { updateTickets, projectOwner } = await import("@/lib/cx/inbox/store");
  const { postReply } = await import("@/lib/cx/inbox/dispatch");
  const patch: Record<string, unknown> = {};
  if (a.priority) patch.priority = a.priority;
  if (a.assignee) patch.assignee_id = a.assignee;
  if (a.team) patch.team = a.team;
  if (a.addTags?.length) patch.addTags = a.addTags;
  if (a.removeTags?.length) patch.removeTags = a.removeTags;
  if (a.status && !a.reply) patch.status = a.status;
  if (Object.keys(patch).length) await updateTickets(projectId, ids, patch as never, `${user.name} (quick action: ${qa.name})`);
  const brand = await projectOwner(projectId);
  let failed = 0;
  for (const tid of ids) {
    try {
      if (a.classificationId || a.severity) await classifyTicket(projectId, tid, { ...(a.classificationId ? { classificationIds: [a.classificationId] } : {}), ...(a.severity ? { values: { severity: a.severity } } : {}) }, user.id);
      if (a.note) await postReply(projectId, tid, user, { body: a.note, note: true });
      if (a.reply) {
        const [t] = await query<{ number: number; name: string | null }>("SELECT t.number,c.name FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1", [tid]);
        await postReply(projectId, tid, user, { body: renderTemplate(a.reply, { name: t?.name, ticket: t?.number, brand: brand.name }), status: (a.status as never) ?? null });
      }
    } catch {
      failed++;
    }
  }
  await query("UPDATE cx_admin_quick_actions SET uses=uses+$2 WHERE id=$1", [id, ids.length]);
  await audit(projectId, user, "quick_action.run", qa.name, `${ids.length} tickets${failed ? `, ${failed} failed` : ""}`);
  return { tickets: ids.length, failed };
}
