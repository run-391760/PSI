import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { agentsOf } from "@/lib/cx/insights/team";
import { audit } from "./audit";
import { sendAdminEmail } from "./mailer";
import { breakOverrun, cleanupDue, distribute, distributeRouted, orderQueue, segmentFor, type AssignmentType, type QueueAgent, type Segment } from "./pure/queue";
import { iso } from "./util";

/**
 * Queue engine (H1–H10, G10, C16). WP1 inbox helpers:
 *   await queueTicket(projectId, ticketId)              // push a ticket into the queue (done automatically for new tickets when enabled)
 *   const q = await queueInfo(projectId, ticketIds)       // { [ticketId]: { queuedAt, agentId, minutes, tone } } for the queue timer
 *   const s = await myQueueStatus(projectId, userId)      // agent status widget data
 */
export type QueueSettings = { enabled: boolean; assignmentType: AssignmentType; maxPerAgent: number; cleanupMinutes: number | null; resetOnStatus: boolean; resetAfterMinutes: number; removeOn: string[]; segments: Segment[]; byTimezone: boolean; rrCursor: number };
export type UserStatus = { id: string; name: string; available: boolean; limit_minutes: number | null; position: number };

export async function getQueueSettings(projectId: string): Promise<QueueSettings> {
  const [r] = await query<{ enabled: boolean; assignment_type: AssignmentType; max_per_agent: number; cleanup_minutes: number | null; reset_on_status: boolean; reset_after_minutes: number; remove_on: string[]; segments: Segment[]; by_timezone: boolean; rr_cursor: number }>(
    "SELECT * FROM cx_admin_queue_settings WHERE project_id=$1", [projectId]);
  return {
    enabled: r?.enabled ?? false, assignmentType: r?.assignment_type ?? "round_robin", maxPerAgent: r?.max_per_agent ?? 10, cleanupMinutes: r?.cleanup_minutes ?? null,
    resetOnStatus: r?.reset_on_status ?? true, resetAfterMinutes: r?.reset_after_minutes ?? 0, removeOn: r?.remove_on ?? ["pending", "on_hold", "solved", "closed"], segments: r?.segments ?? [], byTimezone: r?.by_timezone ?? false, rrCursor: r?.rr_cursor ?? 0,
  };
}

export async function saveQueueSettings(projectId: string, s: Omit<QueueSettings, "rrCursor">, actor: { id: string; name: string }) {
  const segments = s.segments.filter((x) => x.name.trim() && x.match.length).map((x) => ({ ...x, id: x.id || randomUUID(), name: x.name.trim().slice(0, 60), weight: Math.round(Number(x.weight) || 0), userGroupId: typeof x.userGroupId === "string" && x.userGroupId ? x.userGroupId.slice(0, 64) : null, match: x.match.map((m) => ({ field: m.field, values: m.values.map((v) => v.trim()).filter(Boolean) })).filter((m) => m.values.length) }));
  await query(
    `INSERT INTO cx_admin_queue_settings(project_id,enabled,assignment_type,max_per_agent,cleanup_minutes,reset_on_status,reset_after_minutes,remove_on,segments,by_timezone) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
     ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled, assignment_type=excluded.assignment_type, max_per_agent=excluded.max_per_agent, cleanup_minutes=excluded.cleanup_minutes,
       reset_on_status=excluded.reset_on_status, reset_after_minutes=excluded.reset_after_minutes, remove_on=excluded.remove_on, segments=excluded.segments, by_timezone=excluded.by_timezone, updated_at=now()`,
    [projectId, s.enabled, s.assignmentType, Math.min(200, Math.max(1, s.maxPerAgent || 10)), s.cleanupMinutes ? Math.max(1, s.cleanupMinutes) : null, s.resetOnStatus, Math.max(0, s.resetAfterMinutes || 0), JSON.stringify(s.removeOn), JSON.stringify(segments), s.byTimezone],
  );
  await audit(projectId, actor, "queue.settings", s.enabled ? `on, ${s.assignmentType}` : "off");
}

export async function listStatuses(projectId: string) {
  return query<UserStatus>("SELECT id,name,available,limit_minutes,position FROM cx_admin_user_statuses WHERE project_id=$1 ORDER BY position, name", [projectId]);
}
export async function saveStatus(projectId: string, s: { id?: string; name: string; available: boolean; limit_minutes: number | null }) {
  const name = s.name.trim().slice(0, 40);
  if (!name) throw new AppError("Name the status.");
  if (s.id) await query("UPDATE cx_admin_user_statuses SET name=$3,available=$4,limit_minutes=$5 WHERE id=$1 AND project_id=$2", [s.id, projectId, name, s.available, s.limit_minutes]);
  else await query("INSERT INTO cx_admin_user_statuses(id,project_id,name,available,limit_minutes,position) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position),0)+1 FROM cx_admin_user_statuses WHERE project_id=$2))", [randomUUID(), projectId, name, s.available, s.limit_minutes]);
}
export async function deleteStatus(projectId: string, id: string) {
  await query("DELETE FROM cx_admin_user_statuses WHERE id=$1 AND project_id=$2", [id, projectId]);
}

export type QueueAgentRow = { id: string; name: string; email: string; role: string; team: string | null; status: "available" | "break" | "offline"; statusName: string; statusId: string | null; since: string; paused: boolean; capacity: number; officeStart: string | null; officeEnd: string | null; timezone: string | null; load: number; limit: number | null; overrun: boolean; lastAssignedAt: string | null };

export async function queueAgents(projectId: string): Promise<QueueAgentRow[]> {
  const [agents, settings, statuses] = await Promise.all([agentsOf(projectId), getQueueSettings(projectId), listStatuses(projectId)]);
  const rows = await query<{ user_id: string; status: string; status_id: string | null; since: string; paused: boolean; capacity: number | null; office_start: string | null; office_end: string | null; timezone: string | null; last_assigned_at: string | null }>(
    "SELECT user_id,status,status_id,since,paused,capacity,office_start,office_end,timezone,last_assigned_at FROM cx_admin_agents WHERE project_id=$1", [projectId]);
  const loads = await query<{ agent: string; n: number }>(
    "SELECT s.queue_agent AS agent, count(*)::int AS n FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id WHERE s.project_id=$1 AND s.in_queue AND s.queue_agent IS NOT NULL AND t.status NOT IN ('solved','closed') GROUP BY 1", [projectId]);
  const teamTz = await query<{ name: string; timezone: string; start_time: string; end_time: string }>("SELECT t.name,s.timezone,s.start_time,s.end_time FROM cx_admin_team_settings s JOIN cx_teams t ON t.id=s.team_id WHERE s.project_id=$1", [projectId]);
  return agents.map((a) => {
    const r = rows.find((x) => x.user_id === a.id);
    const st = statuses.find((s) => s.id === r?.status_id);
    const tz = teamTz.find((t) => t.name === a.team);
    const status = (r?.status ?? "offline") as QueueAgentRow["status"];
    const since = iso(r?.since) ?? new Date().toISOString();
    return {
      id: a.id, name: a.name, email: a.email, role: a.role, team: a.team, status, statusName: st?.name ?? (status === "available" ? "Available" : status === "break" ? "Away" : "Offline"), statusId: r?.status_id ?? null, since,
      paused: r?.paused ?? false, capacity: r?.capacity ?? settings.maxPerAgent, officeStart: r?.office_start ?? tz?.start_time ?? null, officeEnd: r?.office_end ?? tz?.end_time ?? null, timezone: r?.timezone ?? tz?.timezone ?? null,
      load: loads.find((l) => l.agent === a.id)?.n ?? 0, limit: st?.limit_minutes ?? null, overrun: status === "break" && breakOverrun(since, st?.limit_minutes), lastAssignedAt: iso(r?.last_assigned_at),
    };
  });
}

async function upsertAgent(projectId: string, userId: string, set: Record<string, unknown>) {
  const cols = Object.keys(set);
  await query(
    `INSERT INTO cx_admin_agents(project_id,user_id${cols.map((c) => `,${c}`).join("")}) VALUES($1,$2${cols.map((_, i) => `,$${i + 3}`).join("")})
     ON CONFLICT(project_id,user_id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(",")}`,
    [projectId, userId, ...Object.values(set)],
  );
}

/** Agent sets their own status: "available", "offline" or a custom status id (break with optional limit). */
export async function setAgentStatus(projectId: string, userId: string, status: string, actorName: string) {
  const statuses = await listStatuses(projectId);
  const custom = statuses.find((s) => s.id === status);
  const kind = status === "available" || custom?.available ? "available" : status === "offline" ? "offline" : custom ? "break" : null;
  if (!kind) throw new AppError("Unknown status.");
  const name = custom?.name ?? (kind === "available" ? "Available" : "Offline");
  await query("UPDATE cx_admin_status_log SET ended_at=now() WHERE project_id=$1 AND user_id=$2 AND ended_at IS NULL", [projectId, userId]);
  await query("INSERT INTO cx_admin_status_log(id,project_id,user_id,status) VALUES($1,$2,$3,$4)", [randomUUID(), projectId, userId, name]);
  await upsertAgent(projectId, userId, { status: kind, status_id: custom?.id ?? null, since: new Date(), overrun_notified: false });
  const s = await getQueueSettings(projectId);
  // Reset My Queue (H5): leaving "available" returns unworked queued tickets (immediately or after the delay, via the tick job).
  if (kind !== "available" && s.resetOnStatus && s.resetAfterMinutes === 0) await resetQueue(projectId, userId, `${actorName} (status ${name})`);
  if (kind === "available") await runQueue(projectId).catch(() => {});
}

export async function setAgentSettings(projectId: string, userId: string, p: { capacity?: number | null; officeStart?: string | null; officeEnd?: string | null; timezone?: string | null }, actor: { id: string; name: string }) {
  const hhmm = (v?: string | null) => (v && /^\d{2}:\d{2}$/.test(v) ? v : null);
  await upsertAgent(projectId, userId, { capacity: p.capacity ? Math.min(200, Math.max(1, p.capacity)) : null, office_start: hhmm(p.officeStart), office_end: hhmm(p.officeEnd), timezone: p.timezone || null });
  await audit(projectId, actor, "queue.agent", userId, JSON.stringify(p));
}

/** Admin pauses / resumes an agent's queue (H7). */
export async function pauseAgent(projectId: string, userId: string, paused: boolean, actor: { id: string; name: string }) {
  await upsertAgent(projectId, userId, { paused, paused_by: paused ? actor.id : null });
  await audit(projectId, actor, paused ? "queue.pause" : "queue.resume", userId);
  if (!paused) await runQueue(projectId).catch(() => {});
}

/** Return an agent's queued tickets they haven't worked on to the waiting queue. */
export async function resetQueue(projectId: string, userId: string, actor: string) {
  const rows = await query<{ ticket_id: string }>(
    `SELECT s.ticket_id FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id
      WHERE s.project_id=$1 AND s.queue_agent=$2 AND s.in_queue AND t.status NOT IN ('solved','closed') AND t.assignee_id=$2
        AND NOT EXISTS (SELECT 1 FROM cx_messages m WHERE m.ticket_id=t.id AND m.author_user_id=$2 AND m.created_at >= s.assigned_at)`,
    [projectId, userId],
  );
  for (const r of rows) await unassign(r.ticket_id, userId, actor, "returned to queue");
  return rows.length;
}

async function unassign(ticketId: string, userId: string, actor: string, why: string) {
  await query("UPDATE cx_tickets SET assignee_id=NULL, updated_at=now() WHERE id=$1 AND assignee_id=$2", [ticketId, userId]);
  await query("UPDATE cx_admin_ticket_state SET queue_agent=NULL, assigned_at=NULL, queued_at=now(), updated_at=now() WHERE ticket_id=$1", [ticketId]);
  await query("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,$3,'queue',$4)", [randomUUID(), ticketId, actor, `Unassigned: ${why}`]);
}

/** Put a ticket in the waiting queue (segment computed now). */
export async function queueTicket(projectId: string, ticketId: string) {
  const s = await getQueueSettings(projectId);
  const [t] = await query<{ tags: string[] | null; email: string | null; channel_kind: string; priority: string }>(
    "SELECT c.tags,c.email,t.channel_kind,t.priority FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id WHERE t.id=$1 AND t.project_id=$2", [ticketId, projectId]);
  if (!t) return;
  const seg = segmentFor(s.segments, { contactTags: t.tags ?? [], email: t.email, channel: t.channel_kind, priority: t.priority });
  await query(
    `INSERT INTO cx_admin_ticket_state(ticket_id,project_id,in_queue,queued_at,segment) VALUES($1,$2,true,now(),$3)
     ON CONFLICT(ticket_id) DO UPDATE SET in_queue=true, queued_at=COALESCE(cx_admin_ticket_state.queued_at,now()), segment=excluded.segment, updated_at=now()`,
    [ticketId, projectId, seg?.name ?? null],
  );
}

/** Assign waiting tickets, apply cleanup (H6) and removal (G10), timed resets (H5). */
export async function runQueue(projectId: string) {
  const s = await getQueueSettings(projectId);
  if (!s.enabled) return { assigned: 0, cleaned: 0, removed: 0 };
  // G10: leave the queue on configured statuses.
  const removed = await query("UPDATE cx_admin_ticket_state st SET in_queue=false, updated_at=now() FROM cx_tickets t WHERE t.id=st.ticket_id AND st.project_id=$1 AND st.in_queue AND t.status = ANY($2) RETURNING st.ticket_id", [projectId, s.removeOn]);
  // Tickets assigned by hand leave the waiting list.
  await query("UPDATE cx_admin_ticket_state st SET queue_agent=t.assignee_id, assigned_at=COALESCE(st.assigned_at,now()) FROM cx_tickets t WHERE t.id=st.ticket_id AND st.project_id=$1 AND st.in_queue AND st.queue_agent IS NULL AND t.assignee_id IS NOT NULL", [projectId]);
  let cleaned = 0;
  const agents = await queueAgents(projectId);
  if (s.cleanupMinutes || s.resetAfterMinutes) {
    const busy = await query<{ ticket_id: string; queue_agent: string; assigned_at: string; last_action: string | null }>(
      `SELECT s.ticket_id,s.queue_agent,s.assigned_at,(SELECT max(m.created_at) FROM cx_messages m WHERE m.ticket_id=s.ticket_id AND m.author_user_id=s.queue_agent) AS last_action
         FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id WHERE s.project_id=$1 AND s.in_queue AND s.queue_agent IS NOT NULL AND t.assignee_id=s.queue_agent AND t.status NOT IN ('solved','closed')`, [projectId]);
    for (const b of busy) {
      const la = b.last_action ? iso(b.last_action) : null;
      const a = agents.find((x) => x.id === b.queue_agent);
      const resetDue = s.resetOnStatus && s.resetAfterMinutes > 0 && a && a.status !== "available" && Date.now() - Date.parse(a.since) >= s.resetAfterMinutes * 60_000 && !la;
      if (resetDue || (!la && cleanupDue(iso(b.assigned_at)!, la, s.cleanupMinutes))) {
        await unassign(b.ticket_id, b.queue_agent, "Queue", resetDue ? "agent status changed" : `no action within ${s.cleanupMinutes} min (smart cleanup)`);
        cleaned++;
      }
    }
  }
  const waiting = await query<{ id: string; priority: string; due: string | null; created_at: string; segment: string | null; contact_id: string | null }>(
    `SELECT t.id,t.priority,LEAST(t.first_response_due,t.resolution_due) AS due,t.created_at,s.segment,t.contact_id FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id
      WHERE s.project_id=$1 AND s.in_queue AND s.queue_agent IS NULL AND t.assignee_id IS NULL AND t.status NOT IN ('solved','closed') LIMIT 500`, [projectId]);
  if (!waiting.length) return { assigned: 0, cleaned, removed: removed.length };
  const weights = Object.fromEntries(s.segments.map((x) => [x.name, x.weight]));
  const ordered = orderQueue(waiting.map((w) => ({ ...w, due: iso(w.due), created_at: iso(w.created_at)!, segmentWeight: weights[w.segment ?? ""] ?? 0 })));
  const prev = s.assignmentType === "priority"
    ? await query<{ contact_id: string; assignee_id: string }>("SELECT DISTINCT ON (contact_id) contact_id,assignee_id FROM cx_tickets WHERE project_id=$1 AND contact_id = ANY($2) AND assignee_id IS NOT NULL ORDER BY contact_id, updated_at DESC", [projectId, ordered.map((o) => o.contact_id).filter(Boolean)])
    : [];
  const pool: QueueAgent[] = agents.map((a) => ({ id: a.id, status: a.status, paused: a.paused, load: a.load, capacity: a.capacity, lastAssignedAt: a.lastAssignedAt, officeStart: a.officeStart, officeEnd: a.officeEnd, timezone: a.timezone }));
  // Segments routed to a user group (Settings → Users) only go to that group's members.
  const routed = s.segments.filter((x) => x.userGroupId);
  const groupMembers = new Map<string, string[]>();
  if (routed.length) {
    const { userIdsForUserGroup } = await import("./users");
    for (const seg of routed) groupMembers.set(seg.name, await userIdsForUserGroup(projectId, seg.userGroupId));
  }
  const tickets = ordered.map((o) => ({ id: o.id, previousAgentId: prev.find((p) => p.contact_id === o.contact_id)?.assignee_id ?? null, allowed: o.segment ? groupMembers.get(o.segment) ?? null : null }));
  const { assignments, cursor } = routed.length
    ? distributeRouted(s.assignmentType, pool, tickets, s.rrCursor, new Date(), s.byTimezone)
    : distribute(s.assignmentType, pool, tickets, s.rrCursor, new Date(), s.byTimezone);
  for (const a of assignments) {
    const [ok] = await query("UPDATE cx_tickets SET assignee_id=$2, updated_at=now() WHERE id=$1 AND assignee_id IS NULL RETURNING id", [a.ticketId, a.agentId]);
    if (!ok) continue;
    await query("UPDATE cx_admin_ticket_state SET queue_agent=$2, assigned_at=now(), updated_at=now() WHERE ticket_id=$1", [a.ticketId, a.agentId]);
    await query("UPDATE cx_admin_agents SET last_assigned_at=now() WHERE project_id=$1 AND user_id=$2", [projectId, a.agentId]);
    const name = agents.find((x) => x.id === a.agentId)?.name ?? "agent";
    await query("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,'Queue','queue',$3)", [randomUUID(), a.ticketId, `Assigned to ${name} (${s.assignmentType.replace(/_/g, " ")})`]);
  }
  await query("UPDATE cx_admin_queue_settings SET rr_cursor=$2 WHERE project_id=$1", [projectId, cursor]);
  return { assigned: assignments.length, cleaned, removed: removed.length };
}

/** Break overrun (H4): notify + email once per break. */
export async function checkBreaks(projectId: string) {
  const agents = (await queueAgents(projectId)).filter((a) => a.overrun);
  if (!agents.length) return 0;
  const { notify } = await import("@/lib/jobs/queue");
  const [p] = await query<{ owner_id: string; email: string }>("SELECT p.owner_id,u.email FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1", [projectId]);
  let n = 0;
  for (const a of agents) {
    const [row] = await query("UPDATE cx_admin_agents SET overrun_notified=true WHERE project_id=$1 AND user_id=$2 AND NOT overrun_notified RETURNING user_id", [projectId, a.id]);
    if (!row || !p) continue;
    n++;
    const text = `${a.name} has been on "${a.statusName}" since ${new Date(a.since).toUTCString()}, over the ${a.limit}-minute limit.`;
    await notify({ ownerId: p.owner_id, projectId, tool: "CX Queue", severity: "warning", title: `Break over limit: ${a.name}`, body: text, link: `/cx/settings/queue?brand=${projectId}` });
    await sendAdminEmail(projectId, { to: [p.email], subject: `Break over limit: ${a.name}`, text });
  }
  return n;
}

export async function waitingTickets(projectId: string) {
  const rows = await query<{ id: string; number: number; subject: string; priority: string; channel_kind: string; queued_at: string; assigned_at: string | null; queue_agent: string | null; segment: string | null; status: string; due: string | null }>(
    `SELECT t.id,t.number,t.subject,t.priority,t.channel_kind,t.status,s.queued_at,s.assigned_at,s.queue_agent,s.segment,LEAST(t.first_response_due,t.resolution_due) AS due
       FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id WHERE s.project_id=$1 AND s.in_queue AND t.status NOT IN ('solved','closed') ORDER BY s.queued_at LIMIT 300`, [projectId]);
  return rows.map((r) => ({ ...r, queued_at: iso(r.queued_at)!, assigned_at: iso(r.assigned_at), due: iso(r.due) }));
}

/** Queue timer data for inbox rows (C16). */
export async function queueInfo(projectId: string, ticketIds: string[]) {
  if (!ticketIds.length) return {};
  const { adminSettings } = await import("./settings");
  const st = await adminSettings(projectId);
  const rows = await query<{ ticket_id: string; queued_at: string | null; assigned_at: string | null; queue_agent: string | null; in_queue: boolean }>(
    "SELECT ticket_id,queued_at,assigned_at,queue_agent,in_queue FROM cx_admin_ticket_state WHERE project_id=$1 AND ticket_id = ANY($2)", [projectId, ticketIds]);
  return Object.fromEntries(rows.filter((r) => r.in_queue && st.showQueueTimer).map((r) => {
    const since = iso(r.assigned_at ?? r.queued_at)!;
    const minutes = Math.floor((Date.now() - Date.parse(since)) / 60_000);
    return [r.ticket_id, { queuedAt: iso(r.queued_at), agentId: r.queue_agent, minutes, tone: minutes < st.queueTimerMinutes ? "good" : "critical" }];
  })) as Record<string, { queuedAt: string | null; agentId: string | null; minutes: number; tone: "good" | "critical" }>;
}

export async function myQueueStatus(projectId: string, userId: string) {
  const [agents, statuses, s] = await Promise.all([queueAgents(projectId), listStatuses(projectId), getQueueSettings(projectId)]);
  const me = agents.find((a) => a.id === userId) ?? null;
  return { enabled: s.enabled, me, statuses };
}

export async function statusLog(projectId: string, limit = 200) {
  const rows = await query<{ id: string; name: string; status: string; started_at: string; ended_at: string | null }>(
    "SELECT l.id,u.name,l.status,l.started_at,l.ended_at FROM cx_admin_status_log l JOIN users u ON u.id=l.user_id WHERE l.project_id=$1 ORDER BY l.started_at DESC LIMIT $2", [projectId, limit]);
  return rows.map((r) => ({ ...r, started_at: iso(r.started_at)!, ended_at: iso(r.ended_at) }));
}

export async function teamZones(projectId: string) {
  return query<{ team_id: string; name: string; timezone: string | null; start_time: string | null; end_time: string | null }>(
    "SELECT t.id AS team_id,t.name,s.timezone,s.start_time,s.end_time FROM cx_teams t LEFT JOIN cx_admin_team_settings s ON s.team_id=t.id WHERE t.project_id=$1 ORDER BY t.name", [projectId]);
}
export async function saveTeamZone(projectId: string, teamId: string, z: { timezone: string; start: string; end: string }) {
  const [t] = await query("SELECT 1 FROM cx_teams WHERE id=$1 AND project_id=$2", [teamId, projectId]);
  if (!t) throw new AppError("Team not found.", 404);
  await query("INSERT INTO cx_admin_team_settings(team_id,project_id,timezone,start_time,end_time) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id) DO UPDATE SET timezone=excluded.timezone,start_time=excluded.start_time,end_time=excluded.end_time",
    [teamId, projectId, z.timezone || "UTC", /^\d{2}:\d{2}$/.test(z.start) ? z.start : "09:00", /^\d{2}:\d{2}$/.test(z.end) ? z.end : "18:00"]);
}
