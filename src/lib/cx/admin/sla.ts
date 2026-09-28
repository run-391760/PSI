import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getHours } from "@/lib/cx/insights/team";
import { audit } from "./audit";
import { sendAdminEmail } from "./mailer";
import { matchAutoCondition, type AutoCondition } from "./pure/automation";
import { escalationLevel, nextResponseDue, prebreachTiers, ruleDueDates, selectSlaRule, tatStart, type EscalationLevel, type Hours, type SlaRule } from "./pure/sla";
import { ticketContext } from "./automation";
import { iso } from "./util";

/**
 * SLA / TAT v2 (J1–J4, J7–J9, D16). Rules by priority/channel/segment/team with date ranges and daily
 * windows override the Team & SLAs policy per ticket; ERT tracks every customer message; pre-breach
 * tiers warn; the escalation matrix notifies, emails, reassigns and re-prioritises after a breach.
 * Exports for other packages: applySlaRule(projectId, ticketId), slaState(projectId, ticketIds).
 */
export type SlaRuleRow = SlaRule;
export type Escalation = { id: string; name: string; match: "all" | "any"; conditions: AutoCondition[]; prebreach: number[]; levels: EscalationLevel[]; active: boolean };

export async function listSlaRules(projectId: string): Promise<SlaRule[]> {
  const rows = await query<SlaRule>("SELECT id,name,priority,channels,segment,team,first_response_minutes,every_response_minutes,resolution_minutes,business_hours,start_from,valid_from,valid_to,windows,active,position FROM cx_admin_sla_rules WHERE project_id=$1 ORDER BY position", [projectId]);
  return rows.map((r) => ({ ...r, valid_from: r.valid_from ? iso(r.valid_from)!.slice(0, 10) : null, valid_to: r.valid_to ? iso(r.valid_to)!.slice(0, 10) : null }));
}

const mins = (v: unknown) => (v == null || v === "" ? null : Math.max(1, Math.round(Number(v)) || 1));
export async function saveSlaRule(projectId: string, r: Omit<SlaRule, "id" | "position"> & { id?: string }, actor: { id: string; name: string }) {
  const name = r.name.trim().slice(0, 80);
  if (!name) throw new AppError("Name the TAT rule.");
  const windows = (r.windows ?? []).filter((w) => /^\d{2}:\d{2}$/.test(w.start) && /^\d{2}:\d{2}$/.test(w.end)).slice(0, 3);
  if ((r.windows ?? []).length > 3) throw new AppError("Up to three time windows per day.");
  const fr = mins(r.first_response_minutes), er = mins(r.every_response_minutes), rs = mins(r.resolution_minutes);
  if (fr == null && er == null && rs == null) throw new AppError("Set at least one target.");
  if (r.valid_from && r.valid_to && r.valid_from > r.valid_to) throw new AppError("The date range ends before it starts.");
  const vals = [name, r.priority || null, JSON.stringify(r.channels ?? []), r.segment || null, r.team || null, fr, er, rs, r.business_hours, r.start_from === "queued" ? "queued" : "created", r.valid_from || null, r.valid_to || null, JSON.stringify(windows), r.active];
  if (r.id) {
    await query("UPDATE cx_admin_sla_rules SET name=$3,priority=$4,channels=$5::jsonb,segment=$6,team=$7,first_response_minutes=$8,every_response_minutes=$9,resolution_minutes=$10,business_hours=$11,start_from=$12,valid_from=$13,valid_to=$14,windows=$15::jsonb,active=$16 WHERE id=$1 AND project_id=$2", [r.id, projectId, ...vals]);
  } else {
    await query("INSERT INTO cx_admin_sla_rules(id,project_id,name,priority,channels,segment,team,first_response_minutes,every_response_minutes,resolution_minutes,business_hours,start_from,valid_from,valid_to,windows,active,position) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,(SELECT COALESCE(MAX(position),0)+1 FROM cx_admin_sla_rules WHERE project_id=$2))", [randomUUID(), projectId, ...vals]);
  }
  // Record log (J3): every change is kept in the audit log.
  await audit(projectId, actor, r.id ? "sla.update" : "sla.create", name, `FRT ${fr ?? "–"}m, ERT ${er ?? "–"}m, RT ${rs ?? "–"}m, ${r.valid_from ?? "…"}→${r.valid_to ?? "…"}, windows ${windows.map((w) => `${w.start}-${w.end}`).join(" ") || "all day"}`);
}
export async function deleteSlaRule(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_admin_sla_rules WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "sla.delete", r.name);
}
export async function moveSlaRule(projectId: string, id: string, dir: -1 | 1) {
  const list = await listSlaRules(projectId);
  const i = list.findIndex((a) => a.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await query("UPDATE cx_admin_sla_rules SET position=$2 WHERE id=$1", [list[i].id, list[j].position]);
  await query("UPDATE cx_admin_sla_rules SET position=$2 WHERE id=$1", [list[j].id, list[i].position]);
}

export async function listEscalations(projectId: string): Promise<Escalation[]> {
  return query<Escalation>("SELECT id,name,match,conditions,prebreach,levels,active FROM cx_admin_escalations WHERE project_id=$1 ORDER BY created_at", [projectId]);
}
export async function saveEscalation(projectId: string, e: Omit<Escalation, "id"> & { id?: string }, actor: { id: string; name: string }) {
  const name = e.name.trim().slice(0, 80);
  if (!name) throw new AppError("Name the escalation matrix.");
  const prebreach = [...new Set(e.prebreach.map(Number).filter((n) => n > 0 && n < 100))].sort((a, b) => a - b).slice(0, 4);
  const levels = e.levels.slice(0, 5).map((l) => ({ afterMinutes: Math.max(0, Math.round(Number(l.afterMinutes) || 0)), notifyUserIds: l.notifyUserIds ?? [], emails: (l.emails ?? []).map((x) => x.trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)), reassignTo: l.reassignTo || null, priority: l.priority || null }));
  const conditions = e.conditions.filter((c) => c.value.trim() || c.op === "empty" || c.op === "not_empty");
  if (e.id) await query("UPDATE cx_admin_escalations SET name=$3,match=$4,conditions=$5::jsonb,prebreach=$6::jsonb,levels=$7::jsonb,active=$8 WHERE id=$1 AND project_id=$2", [e.id, projectId, name, e.match, JSON.stringify(conditions), JSON.stringify(prebreach), JSON.stringify(levels), e.active]);
  else await query("INSERT INTO cx_admin_escalations(id,project_id,name,match,conditions,prebreach,levels,active) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)", [randomUUID(), projectId, name, e.match, JSON.stringify(conditions), JSON.stringify(prebreach), JSON.stringify(levels), e.active]);
  await audit(projectId, actor, e.id ? "escalation.update" : "escalation.create", name, `${levels.length} levels, pre-breach ${prebreach.join("/")}%`);
}
export async function deleteEscalation(projectId: string, id: string, actor: { id: string; name: string }) {
  const [r] = await query<{ name: string }>("DELETE FROM cx_admin_escalations WHERE id=$1 AND project_id=$2 RETURNING name", [id, projectId]);
  if (r) await audit(projectId, actor, "escalation.delete", r.name);
}

async function hoursOf(projectId: string): Promise<Hours> {
  const h = await getHours(projectId).catch(() => null);
  return h ? { hours: h.hours, holidays: h.holidays, timezone: h.timezone } : null;
}

/** Apply the matching TAT rule to a ticket (sets due dates); no rule → the Team & SLAs policy stays. */
export async function applySlaRule(projectId: string, ticketId: string) {
  const rules = (await listSlaRules(projectId)).filter((r) => r.active);
  if (!rules.length) return null;
  const [t] = await query<{ priority: string; channel_kind: string; team: string | null; created_at: string; first_response_at: string | null; segment: string | null; assigned_at: string | null; sla_rule_id: string | null }>(
    "SELECT t.priority,t.channel_kind,t.team,t.created_at,t.first_response_at,s.segment,s.assigned_at,s.sla_rule_id FROM cx_tickets t LEFT JOIN cx_admin_ticket_state s ON s.ticket_id=t.id WHERE t.id=$1 AND t.project_id=$2", [ticketId, projectId]);
  if (!t) return null;
  const hours = await hoursOf(projectId);
  const created = new Date(t.created_at);
  const rule = selectSlaRule(rules, { priority: t.priority, channel: t.channel_kind, segment: t.segment, team: t.team }, created, hours?.timezone ?? "UTC");
  if (!rule) return null;
  const start = tatStart(created, t.assigned_at, rule.start_from);
  const due = ruleDueDates(rule, start, hours);
  const msgs = await query<{ direction: "in" | "out" | "note"; created_at: string }>("SELECT direction,created_at FROM cx_messages WHERE ticket_id=$1", [ticketId]);
  const nrd = nextResponseDue(msgs.map((m) => ({ ...m, created_at: iso(m.created_at)! })), rule.every_response_minutes, rule.business_hours ? hours : null);
  await query(`UPDATE cx_tickets SET first_response_due=CASE WHEN first_response_at IS NULL THEN $2::timestamptz ELSE first_response_due END, resolution_due=$3 WHERE id=$1`, [ticketId, due.firstResponseDue, due.resolutionDue]);
  await query(
    `INSERT INTO cx_admin_ticket_state(ticket_id,project_id,sla_rule_id,next_response_due) VALUES($1,$2,$3,$4)
     ON CONFLICT(ticket_id) DO UPDATE SET sla_rule_id=excluded.sla_rule_id, next_response_due=excluded.next_response_due, updated_at=now()`,
    [ticketId, projectId, rule.id, nrd],
  );
  if (t.sla_rule_id !== rule.id) await query("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,'SLA','sla',$3)", [randomUUID(), ticketId, `TAT rule "${rule.name}" applied`]);
  return rule;
}

/** Recompute ERT next-response due after new messages. */
export async function refreshNextResponse(projectId: string, ticketId: string) {
  const [s] = await query<{ every_response_minutes: number | null; business_hours: boolean }>("SELECT r.every_response_minutes,r.business_hours FROM cx_admin_ticket_state s JOIN cx_admin_sla_rules r ON r.id=s.sla_rule_id WHERE s.ticket_id=$1", [ticketId]);
  if (!s?.every_response_minutes) return;
  const msgs = await query<{ direction: "in" | "out" | "note"; created_at: string }>("SELECT direction,created_at FROM cx_messages WHERE ticket_id=$1", [ticketId]);
  const nrd = nextResponseDue(msgs.map((m) => ({ ...m, created_at: iso(m.created_at)! })), s.every_response_minutes, s.business_hours ? await hoursOf(projectId) : null);
  await query("UPDATE cx_admin_ticket_state SET next_response_due=$2, prebreach_sent=(SELECT COALESCE(jsonb_agg(x),'[]') FROM jsonb_array_elements(prebreach_sent) x WHERE x::text NOT LIKE '\"ert:%'), updated_at=now() WHERE ticket_id=$1", [ticketId, nrd]);
}

/** Per-ticket SLA v2 state (next-response due, rule, escalation level) for inbox badges. */
export async function slaState(projectId: string, ticketIds: string[]) {
  if (!ticketIds.length) return {};
  const rows = await query<{ ticket_id: string; next_response_due: string | null; rule: string | null; escalation_level: number }>(
    "SELECT s.ticket_id,s.next_response_due,r.name AS rule,s.escalation_level FROM cx_admin_ticket_state s LEFT JOIN cx_admin_sla_rules r ON r.id=s.sla_rule_id WHERE s.project_id=$1 AND s.ticket_id = ANY($2)", [projectId, ticketIds]);
  return Object.fromEntries(rows.map((r) => [r.ticket_id, { nextResponseDue: iso(r.next_response_due), rule: r.rule, escalationLevel: r.escalation_level }]));
}

/** Pre-breach warnings and escalation levels for open tickets (runs every minute from the tick job). */
export async function slaTick(projectId: string) {
  const escalations = (await listEscalations(projectId)).filter((e) => e.active);
  if (!escalations.length) return { warnings: 0, escalations: 0 };
  const { notify } = await import("@/lib/jobs/queue");
  const { emitEvent } = await import("./webhooks");
  const [p] = await query<{ owner_id: string; name: string }>("SELECT owner_id,name FROM projects WHERE id=$1", [projectId]);
  if (!p) return { warnings: 0, escalations: 0 };
  const tickets = await query<{ id: string; number: number; subject: string; created_at: string; first_response_at: string | null; first_response_due: string | null; resolution_due: string | null; next_response_due: string | null; prebreach_sent: string[] | null; escalation_level: number | null; assigned_at: string | null }>(
    `SELECT t.id,t.number,t.subject,t.created_at,t.first_response_at,t.first_response_due,t.resolution_due,s.next_response_due,s.prebreach_sent,s.escalation_level,s.assigned_at
       FROM cx_tickets t LEFT JOIN cx_admin_ticket_state s ON s.ticket_id=t.id WHERE t.project_id=$1 AND t.status NOT IN ('solved','closed') ORDER BY t.updated_at DESC LIMIT 1000`, [projectId]);
  const users = await query<{ id: string; email: string; name: string }>("SELECT u.id,u.email,u.name FROM users u WHERE u.id IN (SELECT user_id FROM cx_members WHERE project_id=$1 UNION SELECT owner_id FROM projects WHERE id=$1)", [projectId]);
  const now = new Date();
  let warnings = 0, escalated = 0;
  for (const t of tickets) {
    const matching = [] as Escalation[];
    let ctx: Awaited<ReturnType<typeof ticketContext>> | undefined;
    for (const e of escalations) {
      if (e.conditions.length) {
        ctx ??= await ticketContext(projectId, t.id);
        if (!ctx) continue;
        const ok = e.match === "any" ? e.conditions.some((c) => matchAutoCondition(c, ctx!.ctx)) : e.conditions.every((c) => matchAutoCondition(c, ctx!.ctx));
        if (!ok) continue;
      }
      matching.push(e);
    }
    if (!matching.length) continue;
    const sent = new Set(t.prebreach_sent ?? []);
    const clocks: { key: string; label: string; start: string; due: string | null }[] = [
      ...(!t.first_response_at ? [{ key: "frt", label: "first response", start: iso(t.created_at)!, due: iso(t.first_response_due) }] : []),
      { key: "rt", label: "resolution", start: iso(t.created_at)!, due: iso(t.resolution_due) },
      ...(t.next_response_due ? [{ key: "ert", label: "next response", start: iso(t.assigned_at ?? t.created_at)!, due: iso(t.next_response_due) }] : []),
    ];
    const tiers = [...new Set(matching.flatMap((e) => e.prebreach))];
    const newSent: string[] = [];
    let breachedAt = null as string | null;
    for (const c of clocks) {
      if (!c.due) continue;
      if (Date.parse(c.due) <= now.getTime()) breachedAt = !breachedAt || c.due < breachedAt ? c.due : breachedAt;
      const crossed = prebreachTiers(c.start, c.due, tiers, now).filter((x) => Date.parse(c.due!) > now.getTime());
      const top = crossed.at(-1);
      if (top != null && !sent.has(`${c.key}:${top}`)) {
        crossed.forEach((x) => newSent.push(`${c.key}:${x}`));
        warnings++;
        await notify({ ownerId: p.owner_id, projectId, tool: "CX SLA", severity: "warning", title: `SLA ${top}% used: ${c.label} on #${t.number}`, body: `Due ${new Date(c.due).toUTCString()}. ${t.subject.slice(0, 150)}`, link: `/cx/inbox?brand=${projectId}&ticket=${t.id}` });
        await emitEvent(projectId, "sla.warning", { ticket_id: t.id, number: t.number, clock: c.key, percent: top, due: c.due });
      }
    }
    if (newSent.length) await query("INSERT INTO cx_admin_ticket_state(ticket_id,project_id,prebreach_sent) VALUES($1,$2,$3::jsonb) ON CONFLICT(ticket_id) DO UPDATE SET prebreach_sent=cx_admin_ticket_state.prebreach_sent || excluded.prebreach_sent", [t.id, projectId, JSON.stringify(newSent)]);
    if (!breachedAt) continue;
    const levels = matching[0].levels;
    const level = escalationLevel(breachedAt, levels, now);
    if (level <= (t.escalation_level ?? 0)) continue;
    await query("INSERT INTO cx_admin_ticket_state(ticket_id,project_id,escalation_level) VALUES($1,$2,$3) ON CONFLICT(ticket_id) DO UPDATE SET escalation_level=excluded.escalation_level", [t.id, projectId, level]);
    for (let i = (t.escalation_level ?? 0); i < level; i++) {
      const l = levels[i];
      escalated++;
      const text = `Ticket #${t.number} "${t.subject.slice(0, 150)}" breached its SLA at ${new Date(breachedAt).toUTCString()} — escalation level ${i + 1} (${matching[0].name}).`;
      for (const u of l.notifyUserIds.length ? l.notifyUserIds : [p.owner_id]) await notify({ ownerId: u, projectId, tool: "CX SLA", severity: "critical", title: `Escalation L${i + 1}: #${t.number}`, body: text, link: `/cx/inbox?brand=${projectId}&ticket=${t.id}` });
      const emails = [...l.emails, ...users.filter((u) => l.notifyUserIds.includes(u.id)).map((u) => u.email)];
      if (emails.length) await sendAdminEmail(projectId, { to: emails, subject: `[${p.name}] Escalation L${i + 1}: ticket #${t.number}`, text });
      if (l.reassignTo) await query("UPDATE cx_tickets SET assignee_id=$2, updated_at=now() WHERE id=$1", [t.id, l.reassignTo]);
      if (l.priority) await query("UPDATE cx_tickets SET priority=$2, updated_at=now() WHERE id=$1", [t.id, l.priority]);
      await query("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,'SLA','escalation',$3)", [randomUUID(), t.id, `Escalated to level ${i + 1}${emails.length ? `; emailed ${emails.join(", ")}` : ""}${l.reassignTo ? "; reassigned" : ""}${l.priority ? `; priority → ${l.priority}` : ""}`]);
      await emitEvent(projectId, "sla.breached", { ticket_id: t.id, number: t.number, level: i + 1, breached_at: breachedAt });
    }
  }
  return { warnings, escalations: escalated };
}
