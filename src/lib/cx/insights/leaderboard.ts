import { query } from "@/lib/db";
import { avgFirstResponse, avgResolution, csat, slaCompliance, type SlaTargetsMinutes, type TicketTimes } from "./metrics";
import { slaTargetMap } from "./sla";
import { listMembers } from "./team";

/**
 * User leaderboard for Settings → Users: every member of the brand with their work in the period — replies
 * sent, tickets assigned and solved, average first response and resolution time, SLA met, CSAT and QA score.
 * Ranked by tickets solved, then replies sent, then faster first response. Missing data is null ("n/a"),
 * never 0; a member with no activity still appears with zero counts.
 */
export const LEADERBOARD_DAYS = [7, 30, 90] as const;

export type LeaderMember = { id: string; name: string; email: string; role: string };
export type LeaderTicket = TicketTimes & { assignee_id: string | null; csat: number | null };
export type LeaderRow = {
  rank: number; id: string; name: string; email: string; role: string;
  replies: number; assigned: number; solved: number;
  frt: number | null; art: number | null; sla: number | null; csat: number | null; csatN: number; qa: number | null;
};

/** Pure: per-member stats and ranking (unit-tested). */
export function rankLeaders(
  members: LeaderMember[], tickets: LeaderTicket[], replies: Map<string, number>, qa: Map<string, number>,
  now: Date, policies: SlaTargetsMinutes = {},
): LeaderRow[] {
  const rows = members.map((m) => {
    const ts = tickets.filter((t) => t.assignee_id === m.id);
    const c = csat(ts.flatMap((t) => (t.csat != null ? [Number(t.csat)] : [])));
    return {
      rank: 0, id: m.id, name: m.name, email: m.email, role: m.role,
      replies: replies.get(m.id) ?? 0,
      assigned: ts.length,
      solved: ts.filter((t) => t.resolved_at).length,
      frt: avgFirstResponse(ts),
      art: avgResolution(ts),
      sla: ts.length ? slaCompliance(ts, now, policies).rate : null,
      csat: c.score, csatN: c.n,
      qa: qa.get(m.id) ?? null,
    };
  });
  rows.sort((a, b) => b.solved - a.solved || b.replies - a.replies || (a.frt ?? Infinity) - (b.frt ?? Infinity) || a.name.localeCompare(b.name));
  // Equal work shares a rank; nobody ranks while they have no activity at all.
  let rank = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const active = r.solved + r.replies + r.assigned > 0;
    if (!active) return;
    rank = prev && prev.solved === r.solved && prev.replies === r.replies && prev.frt === r.frt ? rank : i + 1;
    r.rank = rank;
  });
  return rows;
}

export async function getLeaderboard(projectId: string, days: number, now = new Date()) {
  const from = new Date(now.getTime() - days * 86400000);
  const [members, tickets, replyRows, qaRows, policies] = await Promise.all([
    listMembers(projectId).then((ms) => ms.map((m) => ({ id: m.user_id, name: m.name || m.email.split("@")[0], email: m.email, role: m.owner ? "owner" : m.role }))),
    query<LeaderTicket>(
      `SELECT assignee_id, csat, priority, created_at, first_response_at, resolved_at, first_response_due, resolution_due
         FROM cx_tickets WHERE project_id=$1 AND assignee_id IS NOT NULL AND (created_at>=$2 OR resolved_at>=$2) LIMIT 50000`,
      [projectId, from],
    ),
    query<{ user_id: string; n: number }>(
      `SELECT m.author_user_id AS user_id, count(*)::int AS n FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
        WHERE t.project_id=$1 AND m.direction='out' AND m.author_user_id IS NOT NULL AND m.delivery<>'failed' AND m.created_at>=$2
        GROUP BY m.author_user_id`,
      [projectId, from],
    ),
    query<{ agent_id: string; avg: number }>(
      `SELECT agent_id, avg(score)::float AS avg FROM cx_qa_reviews
        WHERE project_id=$1 AND status IN ('submitted','resolved','disputed') AND score IS NOT NULL AND created_at>=$2 GROUP BY agent_id`,
      [projectId, from],
    ).catch(() => []),
    slaTargetMap(projectId),
  ]);
  // People who did work here but are no longer members still count for the period.
  const known = new Set(members.map((m) => m.id));
  const extra = [...new Set([...tickets.map((t) => t.assignee_id!), ...replyRows.map((r) => r.user_id)])].filter((id) => !known.has(id));
  const others = extra.length
    ? await query<{ id: string; name: string; email: string }>("SELECT id, COALESCE(NULLIF(name,''), split_part(email,'@',1)) AS name, email FROM users WHERE id = ANY($1)", [extra])
    : [];
  const all: LeaderMember[] = [...members, ...others.map((o) => ({ ...o, role: "former member" }))];
  return rankLeaders(all, tickets, new Map(replyRows.map((r) => [r.user_id, Number(r.n)])), new Map(qaRows.map((q) => [q.agent_id, Number(q.avg)])), now, policies);
}
