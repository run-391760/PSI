import { query } from "@/lib/db";
import { buildAttention, headlineKpis, SLA_RISK_MINUTES, type CrisisRow, type TicketRow } from "./home-logic";

const OPEN = "('new','open','pending','on_hold')";
// Earliest unmet deadline of a ticket, mirroring nextDue() in home-logic.
const DUE = `LEAST(CASE WHEN t.first_response_at IS NULL THEN t.first_response_due END, t.resolution_due)`;
const TICKET_COLS = "t.id,t.number,t.subject,t.priority,t.channel_kind,t.created_at,t.first_response_at,t.first_response_due,t.resolution_due";

async function optional<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback; // module table not created yet
  }
}

/** Everything the calm CX landing needs, from stored real records only. */
export async function getHome(projectId: string, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const riskUntil = new Date(now.getTime() + SLA_RISK_MINUTES * 60000);
  const [[c], [m], sla, unassigned, policies, queued, crises, team] = await Promise.all([
    query<{ channels: number; tickets: number; open: number; unassigned: number; risk: number; breached: number; due: number; topics: number }>(
      `SELECT (SELECT count(*)::int FROM cx_channels WHERE project_id=$1) AS channels,
              (SELECT count(*)::int FROM cx_topics WHERE project_id=$1) AS topics,
              count(*)::int AS tickets,
              count(*) FILTER (WHERE t.status IN ${OPEN})::int AS open,
              count(*) FILTER (WHERE t.status IN ${OPEN} AND t.assignee_id IS NULL)::int AS unassigned,
              count(*) FILTER (WHERE t.status IN ${OPEN} AND ${DUE} <= $2)::int AS risk,
              count(*) FILTER (WHERE t.status IN ${OPEN} AND ${DUE} < now())::int AS breached,
              count(*) FILTER (WHERE t.status IN ${OPEN} AND ${DUE} IS NOT NULL)::int AS due
       FROM cx_tickets t WHERE t.project_id=$1`,
      [projectId, riskUntil],
    ),
    query<{ total: number; negative: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE sentiment='negative')::int AS negative
       FROM cx_mentions WHERE project_id=$1 AND COALESCE(published_at, fetched_at) >= $2`,
      [projectId, today],
    ),
    query<TicketRow>(`SELECT ${TICKET_COLS} FROM cx_tickets t WHERE t.project_id=$1 AND t.status IN ${OPEN} AND ${DUE} <= $2 ORDER BY ${DUE} ASC LIMIT 8`, [projectId, riskUntil]),
    query<TicketRow>(`SELECT ${TICKET_COLS} FROM cx_tickets t WHERE t.project_id=$1 AND t.status IN ${OPEN} AND t.assignee_id IS NULL ORDER BY t.created_at ASC LIMIT 8`, [projectId]),
    optional(
      async () =>
        (await query<{ n: number }>(`SELECT ((SELECT count(*) FROM cx_sla_policies WHERE project_id=$1) + (SELECT count(*) FROM cx_admin_sla_rules WHERE project_id=$1 AND active))::int AS n`, [projectId]))[0]?.n ?? 0,
      0,
    ),
    optional(async () => (await query<{ n: number }>("SELECT count(*)::int AS n FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id WHERE s.project_id=$1 AND s.in_queue AND t.status IN " + OPEN, [projectId]))[0]?.n ?? 0, null as number | null),
    optional(() => query<CrisisRow>("SELECT id,title,severity,status,detected_at FROM cx_crisis_events WHERE project_id=$1 AND status<>'resolved' ORDER BY detected_at DESC LIMIT 8", [projectId]), [] as CrisisRow[]),
    optional(
      async () => (await query<{ members: number; surveys: number }>("SELECT (SELECT count(*)::int FROM cx_members WHERE project_id=$1) AS members, (SELECT count(*)::int FROM cx_surveys WHERE project_id=$1) AS surveys", [projectId]))[0],
      { members: 0, surveys: 0 },
    ),
  ]);
  const kpis = headlineKpis({
    channels: c.channels,
    tickets: c.tickets,
    open: c.open,
    unassigned: c.unassigned,
    queued,
    slaConfigured: policies > 0 || c.due > 0,
    slaRisk: c.risk,
    slaBreached: c.breached,
    topics: c.topics,
    negativeToday: m.negative,
    mentionsToday: m.total,
  });
  return {
    kpis,
    attention: buildAttention({ sla, unassigned, crises }, now),
    counts: { open: c.open, unassigned: c.unassigned, breached: c.breached, crises: crises.length },
    setup: { channels: c.channels, topics: c.topics, tickets: c.tickets, policies, members: team?.members ?? 0, surveys: team?.surveys ?? 0 },
  };
}
