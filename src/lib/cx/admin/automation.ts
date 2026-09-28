import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { addBusinessMinutes } from "@/lib/cx/insights/metrics";
import { getHours } from "@/lib/cx/insights/team";
import { audit } from "./audit";
import { classificationPath } from "./pure/fields";
import { AUTO_FIELDS, evaluateAutomations, renderTemplate, type AutoActions, type AutoCondition, type AutoContext, type Automation } from "./pure/automation";
import { classifyTicket, getClassificationTree, getFieldDefs, getTicketFields } from "./fields";
import { iso } from "./util";

/** Automation v2: CRUD, cloning and application to tickets (G1–G4, G7). */
export type AutomationRow = Automation & { hits: number; last_hit_at: string | null };

export async function listAutomations(projectId: string): Promise<AutomationRow[]> {
  const rows = await query<AutomationRow>("SELECT id,name,trigger,social_type,position,active,stop,match,conditions,actions,hits,last_hit_at FROM cx_admin_automations WHERE project_id=$1 ORDER BY position, created_at", [projectId]);
  return rows.map((r) => ({ ...r, last_hit_at: iso(r.last_hit_at) }));
}

export type AutomationInput = Omit<Automation, "id" | "position"> & { id?: string };
function clean(a: AutomationInput) {
  if (!a.name.trim()) throw new AppError("Name the automation.");
  const conditions: AutoCondition[] = a.conditions
    .filter((c) => c.value.trim() || c.op === "empty" || c.op === "not_empty")
    .map((c) => {
      const f = AUTO_FIELDS.find((x) => x.value === c.field);
      if (!f || !f.ops.includes(c.op)) throw new AppError(`Invalid condition on ${c.field}.`);
      if (c.field === "field" && !c.key) throw new AppError("Choose which field the condition checks.");
      if (c.field === "length" && Number.isNaN(Number(c.value))) throw new AppError("Message length needs a number.");
      return { field: c.field, op: c.op, value: c.value.trim().slice(0, 500), ...(c.key ? { key: c.key } : {}) };
    });
  if (!conditions.length) throw new AppError("Add at least one condition.");
  const x = a.actions;
  const actions: AutoActions = {
    assignee: x.assignee || null, queue: !!x.queue && !x.assignee, team: x.team?.trim() || null, priority: x.priority || null, severity: x.severity || null,
    tags: [...new Set((x.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20), classificationId: x.classificationId || null,
    fields: Object.fromEntries(Object.entries(x.fields ?? {}).filter(([k, v]) => k && String(v).trim())), reply: x.reply?.trim().slice(0, 5000) || null, note: x.note?.trim().slice(0, 5000) || null, status: x.status || null,
  };
  if (!Object.values(actions).some((v) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : v))) throw new AppError("Choose at least one action.");
  return { conditions, actions };
}

export async function saveAutomation(projectId: string, a: AutomationInput, actor: { id: string; name: string }) {
  const { conditions, actions } = clean(a);
  const trigger = a.trigger === "customer_reply" ? "customer_reply" : "created";
  const social = ["any", "public", "private", "custom"].includes(a.social_type) || /^[a-z-]+$/.test(a.social_type) ? a.social_type : "any";
  if (a.id) {
    await query("UPDATE cx_admin_automations SET name=$3,trigger=$4,social_type=$5,active=$6,stop=$7,match=$8,conditions=$9::jsonb,actions=$10::jsonb WHERE id=$1 AND project_id=$2", [a.id, projectId, a.name.trim().slice(0, 120), trigger, social, a.active, a.stop, a.match, JSON.stringify(conditions), JSON.stringify(actions)]);
    await audit(projectId, actor, "automation.update", a.name);
    return a.id;
  }
  const id = randomUUID();
  await query(
    "INSERT INTO cx_admin_automations(id,project_id,name,trigger,social_type,position,active,stop,match,conditions,actions) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position),0)+1 FROM cx_admin_automations WHERE project_id=$2),$6,$7,$8,$9::jsonb,$10::jsonb)",
    [id, projectId, a.name.trim().slice(0, 120), trigger, social, a.active, a.stop, a.match, JSON.stringify(conditions), JSON.stringify(actions)],
  );
  await audit(projectId, actor, "automation.create", a.name);
  return id;
}
export async function deleteAutomation(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_admin_automations WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "automation.delete", r.name);
}
export async function toggleAutomation(projectId: string, id: string, active: boolean) {
  await query("UPDATE cx_admin_automations SET active=$3 WHERE id=$1 AND project_id=$2", [id, projectId, active]);
}
export async function moveAutomation(projectId: string, id: string, dir: -1 | 1) {
  const list = await listAutomations(projectId);
  const i = list.findIndex((a) => a.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await query("UPDATE cx_admin_automations SET position=$2 WHERE id=$1", [list[i].id, list[j].position]);
  await query("UPDATE cx_admin_automations SET position=$2 WHERE id=$1", [list[j].id, list[i].position]);
}
/** Clone an automation, optionally re-targeted at another channel/profile (G7). Clones start inactive. */
export async function cloneAutomation(projectId: string, id: string, target: { channel?: string | null; brandId?: string | null }, actor: { id: string; name: string }) {
  const [a] = (await listAutomations(projectId)).filter((x) => x.id === id);
  if (!a) throw new AppError("Automation not found.", 404);
  let conditions = a.conditions;
  if (target.channel) conditions = [...a.conditions.filter((c) => c.field !== "channel"), { field: "channel", op: "is", value: target.channel }];
  const dest = target.brandId || projectId;
  const actions = dest === projectId ? a.actions : { ...a.actions, assignee: null, classificationId: null };
  return saveAutomation(dest, { name: `${a.name} (copy${target.channel ? ` for ${target.channel}` : ""})`, trigger: a.trigger, social_type: a.social_type, active: false, stop: a.stop, match: a.match, conditions, actions }, actor);
}

// ---------------------------------------------------------------- application

/** Brand open right now (business hours + holidays)? null when hours are not set up. */
export async function businessOpen(projectId: string, at = new Date()) {
  const h = await getHours(projectId).catch(() => null);
  if (!h || !h.hours.some((d) => d.open)) return null;
  return addBusinessMinutes(at, 1, h.hours, h.holidays, h.timezone).getTime() - at.getTime() <= 60_000 + 1000;
}

type TicketCtxRow = { id: string; number: number; subject: string; channel_kind: string; intent: string | null; sentiment: string | null; language: string | null; priority: string; email: string | null; contact_name: string | null; contact_tags: string[] | null; assignee_id: string | null; segment: string | null };
export async function ticketContext(projectId: string, ticketId: string, body?: string) {
  const [t] = await query<TicketCtxRow>(
    `SELECT t.id,t.number,t.subject,t.channel_kind,t.intent,t.sentiment,t.language,t.priority,t.assignee_id,c.email,c.name AS contact_name,c.tags AS contact_tags,s.segment
       FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_admin_ticket_state s ON s.ticket_id=t.id WHERE t.id=$1 AND t.project_id=$2`,
    [ticketId, projectId],
  );
  if (!t) return null;
  const text = body ?? (await query<{ body: string }>("SELECT body FROM cx_messages WHERE ticket_id=$1 AND direction='in' ORDER BY created_at DESC LIMIT 1", [ticketId]))[0]?.body ?? "";
  const [f, tree] = await Promise.all([getTicketFields(ticketId, { reveal: true }), getClassificationTree(projectId)]);
  const leaf = f.classificationIds.at(-1);
  const ctx: AutoContext = {
    channel: t.channel_kind, subject: t.subject, body: text, intent: t.intent ?? "", sentiment: t.sentiment ?? "", language: t.language ?? "", email: t.email,
    classificationIds: f.classificationIds, classificationLabels: leaf ? classificationPath(tree, leaf) : [], fields: f.values, businessOpen: await businessOpen(projectId),
    priority: t.priority, severity: (f.values.severity as string) ?? null, segment: t.segment, contactTags: t.contact_tags ?? [],
  };
  return { ticket: t, ctx };
}

/**
 * Run automations for a ticket. Returns what was applied. Delivery of auto-replies goes through the inbox
 * dispatcher (as the brand owner, authored "Automation").
 */
export async function applyAutomations(projectId: string, ticketId: string, trigger: Automation["trigger"], body?: string) {
  const list = (await listAutomations(projectId)).filter((a) => a.active && a.trigger === trigger);
  if (!list.length) return { matched: [] as string[], queue: false };
  const tc = await ticketContext(projectId, ticketId, body);
  if (!tc) return { matched: [], queue: false };
  const { actions, matched } = evaluateAutomations(list, tc.ctx, trigger);
  if (!matched.length) return { matched, queue: false };
  const { updateTickets, projectOwner } = await import("@/lib/cx/inbox/store");
  const owner = await projectOwner(projectId);
  const names = list.filter((a) => matched.includes(a.id)).map((a) => a.name).join(", ");
  const patch: Record<string, unknown> = {};
  if (actions.priority) patch.priority = actions.priority;
  if (actions.team) patch.team = actions.team;
  if (actions.assignee) patch.assignee_id = actions.assignee;
  if (actions.tags.length) patch.addTags = actions.tags;
  if (Object.keys(patch).length) await updateTickets(projectId, [ticketId], patch as never, `Automation: ${names}`).catch(() => {});
  const values: Record<string, unknown> = { ...actions.fields };
  if (actions.severity) values.severity = actions.severity;
  if (actions.classificationId || Object.keys(values).length) {
    const defs = await getFieldDefs(projectId);
    const known = Object.fromEntries(Object.entries(values).filter(([k]) => defs.some((d) => d.key === k && d.scope === "ticket")));
    await classifyTicket(projectId, ticketId, { ...(actions.classificationId ? { classificationIds: [actions.classificationId] } : {}), values: known }).catch(() => {});
  }
  const bot = { id: owner.owner_id, name: "Automation" };
  if (actions.note || actions.reply) {
    const { postReply } = await import("@/lib/cx/inbox/dispatch");
    if (actions.note) await postReply(projectId, ticketId, bot, { body: actions.note, note: true }).catch(() => {});
    if (actions.reply) {
      const text = renderTemplate(actions.reply, { name: tc.ticket.contact_name, ticket: tc.ticket.number, brand: owner.name, fields: tc.ctx.fields });
      await postReply(projectId, ticketId, bot, { body: text, status: (actions.status as never) ?? null }).catch(() => {});
      // postReply assigns the replier when unassigned; automation replies must not claim the ticket.
      if (!actions.assignee && !tc.ticket.assignee_id) await query("UPDATE cx_tickets SET assignee_id=NULL WHERE id=$1 AND assignee_id=$2", [ticketId, owner.owner_id]);
    }
  }
  if (actions.status && !actions.reply) await updateTickets(projectId, [ticketId], { status: actions.status } as never, `Automation: ${names}`).catch(() => {});
  await query("UPDATE cx_admin_automations SET hits=hits+1,last_hit_at=now() WHERE id = ANY($1)", [matched]);
  await query("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,'Automation','rules',$3)", [randomUUID(), ticketId, `Automations applied: ${names}`]);
  return { matched, queue: !!actions.queue };
}
