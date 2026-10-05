import { query } from "@/lib/db";
import { getQueueSettings, queueAgents, queueTicket, runQueue } from "@/lib/cx/admin/queue";
import { orderQueue } from "@/lib/cx/admin/pure/queue";
import { logEvent } from "@/lib/cx/inbox/store";
import { MEDIA_SQL } from "./media";

/**
 * Queued Tickets (Konnect "Queued Tickets"): tickets in the assignment queue (cx_admin_ticket_state, owned by
 * the admin queue engine in src/lib/cx/admin/queue.ts) with position, wait time and segment. "Waiting" =
 * nobody assigned yet; "Assigned" = handed to an agent by the queue but not yet worked on.
 */
export type QueuedRow = {
  id: string; number: number; subject: string; priority: string; status: string; channel_kind: string; channel_name: string | null; media_type: string;
  contact_name: string | null; contact_email: string | null; queued_at: string; assigned_at: string | null; assignee_id: string | null; assignee_name: string | null;
  segment: string | null; due: string | null; created_at: string; last_body: string | null; worked: boolean; position: number | null;
};
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export async function queuedTickets(projectId: string) {
  const [settings, agents] = await Promise.all([getQueueSettings(projectId), queueAgents(projectId)]);
  const rows = await query<Omit<QueuedRow, "position">>(
    `SELECT t.id,t.number,t.subject,t.priority,t.status,t.channel_kind,ch.name AS channel_name,${MEDIA_SQL} AS media_type,c.name AS contact_name,c.email AS contact_email,
            s.queued_at,s.assigned_at,t.assignee_id,COALESCE(NULLIF(u.name,''),u.email) AS assignee_name,s.segment,LEAST(t.first_response_due,t.resolution_due) AS due,t.created_at,
            (SELECT m.body FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction='in' ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (t.assignee_id IS NOT NULL AND EXISTS (SELECT 1 FROM cx_messages m WHERE m.ticket_id=t.id AND m.author_user_id=t.assignee_id AND m.created_at >= COALESCE(s.assigned_at, s.queued_at))) AS worked
       FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id
       LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE s.project_id=$1 AND s.in_queue AND t.status NOT IN ('solved','closed') ORDER BY s.queued_at LIMIT 500`,
    [projectId],
  );
  const norm = rows.map((r) => ({ ...r, queued_at: iso(r.queued_at)!, assigned_at: iso(r.assigned_at), due: iso(r.due), created_at: iso(r.created_at)! }));
  const weights = Object.fromEntries(settings.segments.map((s) => [s.name, s.weight]));
  const waiting = orderQueue(norm.filter((r) => !r.assignee_id).map((r) => ({ ...r, segmentWeight: weights[r.segment ?? ""] ?? 0 })));
  const pos = new Map(waiting.map((w, i) => [w.id, i + 1]));
  const out: QueuedRow[] = norm.map((r) => ({ ...r, position: pos.get(r.id) ?? null }));
  out.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.queued_at.localeCompare(b.queued_at));
  return { settings, agents, rows: out };
}

/** Open, unassigned tickets that are NOT in the queue (so a supervisor can push them into it). */
export async function unqueuedCount(projectId: string) {
  const [r] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cx_tickets t LEFT JOIN cx_admin_ticket_state s ON s.ticket_id=t.id
      WHERE t.project_id=$1 AND t.assignee_id IS NULL AND t.status NOT IN ('solved','closed') AND COALESCE(s.in_queue,false)=false`,
    [projectId],
  );
  return r.n;
}

/** Push every open, unassigned ticket that isn't queued into the queue, then run assignment. */
export async function queueAllUnassigned(projectId: string) {
  const rows = await query<{ id: string }>(
    `SELECT t.id FROM cx_tickets t LEFT JOIN cx_admin_ticket_state s ON s.ticket_id=t.id
      WHERE t.project_id=$1 AND t.assignee_id IS NULL AND t.status NOT IN ('solved','closed') AND COALESCE(s.in_queue,false)=false LIMIT 500`,
    [projectId],
  );
  for (const r of rows) await queueTicket(projectId, r.id);
  const run = await runQueue(projectId).catch(() => ({ assigned: 0, cleaned: 0, removed: 0 }));
  return { queued: rows.length, assigned: run.assigned };
}

/** Record a manual pick/assignment in the queue state so the ticket leaves the waiting list immediately. */
export async function markQueueAssigned(ticketIds: string[], agentId: string | null) {
  if (!ticketIds.length) return;
  await query("UPDATE cx_admin_ticket_state SET queue_agent=$2, assigned_at=CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, queued_at=CASE WHEN $2::text IS NULL THEN now() ELSE queued_at END, updated_at=now() WHERE ticket_id = ANY($1)", [ticketIds, agentId]);
}

/** "Remove From Queue": take tickets out of the assignment queue (they stay open with their current assignee). */
export async function removeFromQueue(projectId: string, ticketIds: string[], actor: string) {
  if (!ticketIds.length) return 0;
  const rows = await query<{ ticket_id: string }>("UPDATE cx_admin_ticket_state SET in_queue=false, updated_at=now() WHERE project_id=$1 AND ticket_id = ANY($2) AND in_queue RETURNING ticket_id", [projectId, ticketIds]);
  for (const r of rows) await logEvent(query, r.ticket_id, actor, "queue", "removed the ticket from the queue").catch(() => {});
  return rows.length;
}
