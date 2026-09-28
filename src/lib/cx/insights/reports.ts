import { query } from "@/lib/db";
import { getHours } from "./team";
import { slaTargetMap } from "./sla";
import { agentBreaches, bucketKey, groupSummaries, replyTats, summarize, tat, ticketTrend, type Basis, type HoursCfg, type Interval } from "./reports-math";

/** Stored-record reports for CX Reports (L6–L9, L23–L26). Server-only. */
export type RTicket = {
  id: string; number: number; subject: string; status: string; priority: string; channel_kind: string; assignee_id: string | null; agent: string | null;
  created_at: string; first_response_at: string | null; resolved_at: string | null; first_response_due: string | null; resolution_due: string | null; csat: number | null;
};
export type RMessage = { ticket_id: string; direction: "in" | "out" | "note"; created_at: string; author_user_id: string | null; author: string | null };

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const AUTO = "(e.actor IN ('Automation','System','Workflow') OR e.actor ILIKE '%(survey)%' OR e.actor ILIKE 'automation%')";

export async function hoursCfg(projectId: string): Promise<HoursCfg> {
  const h = await getHours(projectId);
  return { hours: h.hours, holidays: h.holidays, timezone: h.timezone };
}

/** Tickets created in [from, to] (plus tickets resolved in range) with their messages. */
export async function loadReportData(projectId: string, from: Date, to: Date) {
  const tickets = (
    await query<RTicket>(
      `SELECT t.id,t.number,t.subject,t.status,t.priority,t.channel_kind,t.assignee_id,COALESCE(NULLIF(u.name,''),u.email) AS agent,
              t.created_at,t.first_response_at,t.resolved_at,t.first_response_due,t.resolution_due,t.csat
       FROM cx_tickets t LEFT JOIN users u ON u.id=t.assignee_id
       WHERE t.project_id=$1 AND ((t.created_at >= $2 AND t.created_at <= $3) OR (t.resolved_at >= $2 AND t.resolved_at <= $3)) LIMIT 20000`,
      [projectId, from, to],
    )
  ).map((r) => ({ ...r, created_at: iso(r.created_at)!, first_response_at: iso(r.first_response_at), resolved_at: iso(r.resolved_at), first_response_due: iso(r.first_response_due), resolution_due: iso(r.resolution_due) }));
  // Fill missing due dates from the brand's SLA policies (calendar minutes).
  const pol = await slaTargetMap(projectId);
  for (const t of tickets) {
    const p = pol[t.priority as keyof typeof pol];
    const c = new Date(t.created_at).getTime();
    if (!t.first_response_due && p?.firstResponse != null) t.first_response_due = new Date(c + p.firstResponse * 60000).toISOString();
    if (!t.resolution_due && p?.resolution != null) t.resolution_due = new Date(c + p.resolution * 60000).toISOString();
  }
  const messages = (
    await query<RMessage>(
      `SELECT m.ticket_id,m.direction,m.created_at,m.author_user_id,COALESCE(NULLIF(u.name,''),u.email,NULLIF(m.author_name,'')) AS author
       FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id LEFT JOIN users u ON u.id=m.author_user_id
       WHERE t.project_id=$1 AND m.created_at >= $2 AND m.created_at <= $3 ORDER BY m.created_at LIMIT 100000`,
      [projectId, from, to],
    )
  ).map((m) => ({ ...m, created_at: iso(m.created_at)! }));
  return { tickets, messages, policies: Object.keys(pol).length };
}

export function trendReport(tickets: RTicket[], from: Date, to: Date, interval: Interval) {
  const rows = ticketTrend(tickets, from, to, interval);
  return { rows, created: rows.reduce((s, r) => s + r.created, 0), solved: rows.reduce((s, r) => s + r.solved, 0) };
}

export function breachReport(tickets: RTicket[], from: Date, now = new Date()) {
  return agentBreaches(tickets.filter((t) => new Date(t.created_at) >= from).map((t) => ({ ...t, assignee: t.agent })), now);
}

/** TAT summary, reply TAT, daywise FRT and TAT analysis on a calendar or business-hours basis. */
export function tatReport(data: { tickets: RTicket[]; messages: RMessage[] }, from: Date, basis: Basis, cfg: HoursCfg, interval: Interval) {
  const tickets = data.tickets.filter((t) => new Date(t.created_at) >= from);
  const withTat = tickets.map((t) => ({ ...t, frt: tat(t.created_at, t.first_response_at, basis, cfg), rt: tat(t.created_at, t.resolved_at, basis, cfg) }));
  const replies = replyTats(data.messages, basis, cfg).filter((r) => new Date(r.at) >= from);
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  const summary = {
    frt: summarize(withTat.flatMap((t) => (t.frt == null ? [] : [t.frt]))),
    reply: summarize(replies.map((r) => r.seconds)),
    resolution: summarize(withTat.flatMap((t) => (t.rt == null ? [] : [t.rt]))),
  };
  const byInterval = (() => {
    const fr = groupSummaries(withTat, (t) => bucketKey(t.created_at, interval), (t) => t.frt, true);
    const rs = new Map(groupSummaries(withTat, (t) => bucketKey(t.created_at, interval), (t) => t.rt, true).map((r) => [r.key, r]));
    const rp = new Map(groupSummaries(replies, (r) => bucketKey(r.at, interval), (r) => r.seconds, true).map((r) => [r.key, r]));
    return fr.map((r) => ({ key: r.key, tickets: r.count, frt: r.avg, frtMedian: r.median, reply: rp.get(r.key)?.avg ?? null, replies: rp.get(r.key)?.n ?? 0, resolution: rs.get(r.key)?.avg ?? null, resolved: rs.get(r.key)?.n ?? 0 }));
  })();
  const replyByAgent = groupSummaries(replies, (r) => r.agent ?? "Unknown", (r) => r.seconds);
  const daywiseFrt = groupSummaries(withTat, (t) => bucketKey(t.created_at, "day"), (t) => t.frt, true);
  const analysis = {
    agent: groupSummaries(withTat, (t) => t.agent ?? "Unassigned", (t) => t.rt),
    channel: groupSummaries(withTat, (t) => t.channel_kind, (t) => t.rt),
    day: groupSummaries(withTat, (t) => bucketKey(t.created_at, "day"), (t) => t.rt, true),
    replyAgent: replyByAgent,
    replyChannel: groupSummaries(replies, (r) => ticketById.get(r.ticket_id)?.channel_kind ?? "unknown", (r) => r.seconds),
  };
  return { summary, byInterval, replyByAgent, daywiseFrt, analysis, tickets: withTat };
}

/** Per-agent actions in the range: replies, notes, status changes and assignments (manual) vs automation. */
export async function userPerformance(projectId: string, from: Date, to: Date) {
  const rows = await query<{ agent_id: string; agent: string; replies: number; notes: number; manual: number; auto: number; assigned: number; solved: number; open: number; csat: number | null }>(
    `WITH agents AS (
       SELECT p.owner_id AS id FROM projects p WHERE p.id=$1
       UNION SELECT m.user_id FROM cx_members m WHERE m.project_id=$1 AND m.role<>'viewer'
     )
     SELECT u.id AS agent_id, COALESCE(NULLIF(u.name,''),u.email) AS agent,
       (SELECT count(*)::int FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=u.id AND m.direction='out' AND m.created_at BETWEEN $2 AND $3) AS replies,
       (SELECT count(*)::int FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=u.id AND m.direction='note' AND m.created_at BETWEEN $2 AND $3) AS notes,
       (SELECT count(*)::int FROM cx_inbox_events e JOIN cx_tickets t ON t.id=e.ticket_id WHERE t.project_id=$1 AND e.actor IN (u.name,u.email) AND e.created_at BETWEEN $2 AND $3) AS manual,
       (SELECT count(*)::int FROM cx_inbox_events e JOIN cx_tickets t ON t.id=e.ticket_id WHERE t.project_id=$1 AND t.assignee_id=u.id AND ${AUTO} AND e.created_at BETWEEN $2 AND $3) AS auto,
       (SELECT count(*)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=u.id AND t.created_at BETWEEN $2 AND $3) AS assigned,
       (SELECT count(*)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=u.id AND t.resolved_at BETWEEN $2 AND $3) AS solved,
       (SELECT count(*)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=u.id AND t.status IN ('new','open','pending','on_hold')) AS open,
       (SELECT avg(t.csat)::float FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=u.id AND t.csat IS NOT NULL AND t.resolved_at BETWEEN $2 AND $3) AS csat
     FROM agents a JOIN users u ON u.id=a.id ORDER BY 3 DESC`,
    [projectId, from, to],
  );
  return rows;
}

/** Same-day numbers for one agent (My Dashboard). Day boundaries are UTC midnight in the brand timezone. */
export async function myDashboard(projectId: string, user: { id: string; name: string; email: string }, cfg: HoursCfg, now = new Date()) {
  const { tzOffset } = await import("./metrics");
  const off = tzOffset(cfg.timezone, now) * 60000;
  const local = new Date(now.getTime() + off);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off);
  const [row] = await query<{ first_at: string | null; last_at: string | null; replies: number; assigned: number; resolved: number; closed: number; open: number; notes: number }>(
    `SELECT
       (SELECT min(x) FROM (SELECT min(m.created_at) AS x FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=$2 AND m.created_at >= $3
                           UNION ALL SELECT min(e.created_at) FROM cx_inbox_events e JOIN cx_tickets t ON t.id=e.ticket_id WHERE t.project_id=$1 AND e.actor IN ($4,$5) AND e.created_at >= $3) a) AS first_at,
       (SELECT max(x) FROM (SELECT max(m.created_at) AS x FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=$2 AND m.created_at >= $3
                           UNION ALL SELECT max(e.created_at) FROM cx_inbox_events e JOIN cx_tickets t ON t.id=e.ticket_id WHERE t.project_id=$1 AND e.actor IN ($4,$5) AND e.created_at >= $3) b) AS last_at,
       (SELECT count(*)::int FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=$2 AND m.direction='out' AND m.created_at >= $3) AS replies,
       (SELECT count(*)::int FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=$2 AND m.direction='note' AND m.created_at >= $3) AS notes,
       (SELECT count(DISTINCT t.id)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=$2 AND (t.created_at >= $3 OR EXISTS (SELECT 1 FROM cx_inbox_events e WHERE e.ticket_id=t.id AND e.detail ILIKE '%assigned%' AND e.detail NOT ILIKE '%unassigned%' AND e.created_at >= $3))) AS assigned,
       (SELECT count(*)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=$2 AND t.status='solved' AND t.resolved_at >= $3) AS resolved,
       (SELECT count(*)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=$2 AND t.status='closed' AND t.resolved_at >= $3) AS closed,
       (SELECT count(*)::int FROM cx_tickets t WHERE t.project_id=$1 AND t.assignee_id=$2 AND t.status IN ('new','open','pending','on_hold')) AS open`,
    [projectId, user.id, start, user.name || user.email, user.email],
  );
  const data = await loadReportData(projectId, new Date(start.getTime() - 30 * 86400000), now);
  const mine = data.tickets.filter((t) => t.assignee_id === user.id);
  const basis: Basis = "calendar";
  const replies = replyTats(data.messages.filter((m) => mine.some((t) => t.id === m.ticket_id)), basis).filter((r) => new Date(r.at) >= start && r.agent_id === user.id);
  const frt = summarize(mine.filter((t) => t.first_response_at && new Date(t.first_response_at) >= start).flatMap((t) => { const s = tat(t.created_at, t.first_response_at, basis); return s == null ? [] : [s]; }));
  const closeTat = summarize(mine.filter((t) => t.resolved_at && new Date(t.resolved_at) >= start).flatMap((t) => { const s = tat(t.created_at, t.resolved_at, basis); return s == null ? [] : [s]; }));
  return {
    since: start.toISOString(),
    firstActivity: iso(row?.first_at),
    lastActivity: iso(row?.last_at),
    replies: row?.replies ?? 0,
    notes: row?.notes ?? 0,
    assigned: row?.assigned ?? 0,
    resolved: row?.resolved ?? 0,
    closed: row?.closed ?? 0,
    open: row?.open ?? 0,
    replyTat: summarize(replies.map((r) => r.seconds)),
    frt,
    closeTat,
  };
}
