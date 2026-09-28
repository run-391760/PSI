import { query } from "@/lib/db";
import { iso } from "./util";

/**
 * Ticket lifecycle hooks of the admin engine. The tick job (every minute) catches up on everything, so
 * calling these is optional — WP1 may call them right after its own writes for instant automation:
 *   after createTicket():          await onTicketCreated(projectId, ticketId)
 *   after addInbound():            await onCustomerMessage(projectId, ticketId, body)
 * Both are idempotent and never throw.
 */
export async function onTicketCreated(projectId: string, ticketId: string) {
  try {
    const [claim] = await query(
      `INSERT INTO cx_admin_ticket_state(ticket_id,project_id,automated_at) VALUES($1,$2,now())
       ON CONFLICT(ticket_id) DO UPDATE SET automated_at=now() WHERE cx_admin_ticket_state.automated_at IS NULL RETURNING ticket_id`,
      [ticketId, projectId],
    );
    if (!claim) return;
    const { getQueueSettings, queueTicket, runQueue } = await import("./queue");
    const { applyAutomations } = await import("./automation");
    const { applySlaRule } = await import("./sla");
    const { emitEvent } = await import("./webhooks");
    const qs = await getQueueSettings(projectId);
    if (qs.enabled) await queueTicket(projectId, ticketId); // computes the segment used by automations and SLA rules
    const auto = await applyAutomations(projectId, ticketId, "created").catch(() => ({ matched: [], queue: false }));
    const [t] = await query<{ number: number; subject: string; status: string; priority: string; channel_kind: string; assignee_id: string | null; contact_id: string | null; created_at: string }>(
      "SELECT number,subject,status,priority,channel_kind,assignee_id,contact_id,created_at FROM cx_tickets WHERE id=$1", [ticketId]);
    if (!t) return;
    if (!qs.enabled && auto.queue) await queueTicket(projectId, ticketId);
    if (qs.enabled && t.assignee_id) await query("UPDATE cx_admin_ticket_state SET queue_agent=$2, assigned_at=now() WHERE ticket_id=$1", [ticketId, t.assignee_id]);
    await applySlaRule(projectId, ticketId).catch(() => null);
    if (qs.enabled) await runQueue(projectId).catch(() => null);
    await applySlaRule(projectId, ticketId).catch(() => null); // re-run: "queue assigned" TAT start needs the assignment
    await emitEvent(projectId, "ticket.created", { ticket_id: ticketId, number: t.number, subject: t.subject, status: t.status, priority: t.priority, channel: t.channel_kind, contact_id: t.contact_id, created_at: iso(t.created_at) });
  } catch (e) {
    console.error("[cx.admin] onTicketCreated", e instanceof Error ? e.message : e);
  }
}

export async function onCustomerMessage(projectId: string, ticketId: string, body?: string) {
  try {
    const { applyAutomations } = await import("./automation");
    const { refreshNextResponse } = await import("./sla");
    await applyAutomations(projectId, ticketId, "customer_reply", body).catch(() => null);
    await refreshNextResponse(projectId, ticketId).catch(() => null);
  } catch (e) {
    console.error("[cx.admin] onCustomerMessage", e instanceof Error ? e.message : e);
  }
}

async function cursor(projectId: string, name: string) {
  const [c] = await query<{ at: string }>("INSERT INTO cx_admin_cursors(project_id,name) VALUES($1,$2) ON CONFLICT(project_id,name) DO UPDATE SET name=excluded.name RETURNING at", [projectId, name]);
  return iso(c.at)!;
}
const advance = (projectId: string, name: string, at: string) => query("UPDATE cx_admin_cursors SET at=$3 WHERE project_id=$1 AND name=$2 AND at < $3", [projectId, name, at]);

/** Catch-up pass (tick job): new tickets, new messages and ticket events → hooks and webhook events. */
export async function catchUp(projectId: string) {
  const { emitEvent } = await import("./webhooks");
  const fresh = await query<{ id: string }>(
    `SELECT t.id FROM cx_tickets t LEFT JOIN cx_admin_ticket_state s ON s.ticket_id=t.id
      WHERE t.project_id=$1 AND s.automated_at IS NULL AND t.created_at > now() - interval '1 day' ORDER BY t.created_at LIMIT 100`, [projectId]);
  for (const t of fresh) await onTicketCreated(projectId, t.id);

  const since = await cursor(projectId, "messages");
  const msgs = await query<{ id: string; ticket_id: string; direction: "in" | "out" | "note"; body: string; author_name: string; created_at: string; first: boolean; number: number; delivery: string }>(
    `SELECT m.id,m.ticket_id,m.direction,m.body,m.author_name,m.created_at,m.delivery,t.number,
            NOT EXISTS (SELECT 1 FROM cx_messages p WHERE p.ticket_id=m.ticket_id AND p.created_at < m.created_at) AS first
       FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.created_at > $2 ORDER BY m.created_at LIMIT 300`, [projectId, since]);
  for (const m of msgs) {
    const data = { message_id: m.id, ticket_id: m.ticket_id, number: m.number, author: m.author_name, body: m.body.slice(0, 5000), created_at: iso(m.created_at) };
    if (m.direction === "in") {
      if (!m.first) await onCustomerMessage(projectId, m.ticket_id, m.body);
      await emitEvent(projectId, "message.received", data);
    } else if (m.direction === "out") {
      const { refreshNextResponse } = await import("./sla");
      await refreshNextResponse(projectId, m.ticket_id).catch(() => null);
      await emitEvent(projectId, "message.sent", { ...data, delivery: m.delivery });
    } else await emitEvent(projectId, "note.added", data);
  }
  if (msgs.length) await advance(projectId, "messages", iso(msgs.at(-1)!.created_at)!);

  const evSince = await cursor(projectId, "events");
  const events = await query<{ ticket_id: string; actor: string; kind: string; detail: string; created_at: string; number: number; status: string; priority: string; assignee_id: string | null }>(
    `SELECT e.ticket_id,e.actor,e.kind,e.detail,e.created_at,t.number,t.status,t.priority,t.assignee_id FROM cx_inbox_events e JOIN cx_tickets t ON t.id=e.ticket_id
      WHERE t.project_id=$1 AND e.created_at > $2 ORDER BY e.created_at LIMIT 300`, [projectId, evSince]);
  for (const e of events) {
    const data = { ticket_id: e.ticket_id, number: e.number, actor: e.actor, change: e.detail, status: e.status, priority: e.priority, assignee_id: e.assignee_id, at: iso(e.created_at) };
    if (e.kind === "classify") await emitEvent(projectId, "ticket.classified", data);
    else if (["update", "rules", "queue", "merge", "escalation"].includes(e.kind) || e.kind.startsWith("status")) await emitEvent(projectId, "ticket.updated", data);
  }
  if (events.length) await advance(projectId, "events", iso(events.at(-1)!.created_at)!);
  return { tickets: fresh.length, messages: msgs.length, events: events.length };
}
