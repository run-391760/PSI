import { query } from "@/lib/db";
import { avgFirstResponse, avgResolution, csat, dayKeys, netSentiment, nps, pctDelta, slaCompliance, type TicketTimes } from "./metrics";
import { slaTargetMap } from "./sla";

type TicketRow = TicketTimes & { id: string; status: string; channel_kind: string; assignee_id: string | null; csat: number | null };

const OPEN = ["new", "open", "pending", "on_hold"];

/** Scores used for CSAT: CSAT-survey responses plus ticket CSAT values not already backed by a response. */
export async function csatScores(projectId: string, from: Date, to: Date) {
  const rows = await query<{ score: number }>(
    `SELECT r.score FROM cx_survey_responses r JOIN cx_surveys s ON s.id=r.survey_id
      WHERE r.project_id=$1 AND s.kind='csat' AND r.score IS NOT NULL AND r.created_at>=$2 AND r.created_at<$3
     UNION ALL
     SELECT t.csat AS score FROM cx_tickets t WHERE t.project_id=$1 AND t.csat IS NOT NULL AND t.updated_at>=$2 AND t.updated_at<$3
      AND NOT EXISTS (SELECT 1 FROM cx_survey_responses r WHERE r.ticket_id=t.id)`,
    [projectId, from, to],
  );
  return rows.map((r) => Number(r.score));
}
export async function npsScores(projectId: string, from: Date, to: Date) {
  const rows = await query<{ score: number }>(
    `SELECT r.score FROM cx_survey_responses r JOIN cx_surveys s ON s.id=r.survey_id
     WHERE r.project_id=$1 AND s.kind='nps' AND r.score IS NOT NULL AND r.created_at>=$2 AND r.created_at<$3`,
    [projectId, from, to],
  );
  return rows.map((r) => Number(r.score));
}

async function tryCount(sql: string, params: unknown[]) {
  try {
    const [r] = await query<{ n: number }>(sql, params);
    return r ? Number(r.n) : null;
  } catch {
    return null;
  }
}

export async function getOverview(projectId: string, days: number, now = new Date()) {
  const cur = new Date(now.getTime() - days * 86400000);
  const prev = new Date(now.getTime() - 2 * days * 86400000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 86400000);

  const [tickets, [counts], [setup], policies] = await Promise.all([
    query<TicketRow>(
      `SELECT id,status,priority,channel_kind,assignee_id,csat,created_at,first_response_at,resolved_at,first_response_due,resolution_due
       FROM cx_tickets WHERE project_id=$1 AND (created_at>=$2 OR resolved_at>=$2) ORDER BY created_at DESC LIMIT 20000`,
      [projectId, prev],
    ),
    query<{ open: number; urgent: number; overdue: number; today: number; yesterday: number; total: number }>(
      `SELECT count(*) FILTER (WHERE status = ANY($2))::int AS open,
              count(*) FILTER (WHERE status = ANY($2) AND priority IN ('urgent','high'))::int AS urgent,
              count(*) FILTER (WHERE status = ANY($2) AND resolution_due < now())::int AS overdue,
              count(*) FILTER (WHERE created_at >= $3)::int AS today,
              count(*) FILTER (WHERE created_at >= $4 AND created_at < $3)::int AS yesterday,
              count(*)::int AS total
       FROM cx_tickets WHERE project_id=$1`,
      [projectId, OPEN, today, yesterday],
    ),
    query<{ channels: number; topics: number; members: number; surveys: number; policies: number; mentions: number; scorecards: number }>(
      `SELECT (SELECT count(*)::int FROM cx_channels WHERE project_id=$1) AS channels,
              (SELECT count(*)::int FROM cx_topics WHERE project_id=$1) AS topics,
              (SELECT count(*)::int FROM cx_members WHERE project_id=$1) AS members,
              (SELECT count(*)::int FROM cx_surveys WHERE project_id=$1) AS surveys,
              (SELECT count(*)::int FROM cx_sla_policies WHERE project_id=$1) AS policies,
              (SELECT count(*)::int FROM cx_mentions WHERE project_id=$1) AS mentions,
              (SELECT count(*)::int FROM cx_qa_scorecards WHERE project_id=$1) AS scorecards`,
      [projectId],
    ),
    slaTargetMap(projectId),
  ]);

  const createdIn = (a: Date, b: Date) => tickets.filter((t) => new Date(t.created_at) >= a && new Date(t.created_at) < b);
  const resolvedIn = (a: Date, b: Date) => tickets.filter((t) => t.resolved_at && new Date(t.resolved_at) >= a && new Date(t.resolved_at) < b);
  const curT = createdIn(cur, now), prevT = createdIn(prev, cur);
  const frt = avgFirstResponse(curT), frtPrev = avgFirstResponse(prevT);
  const art = avgResolution(resolvedIn(cur, now)), artPrev = avgResolution(resolvedIn(prev, cur));
  const sla = slaCompliance(curT, now, policies), slaPrev = slaCompliance(prevT, cur, policies);

  const [cs, csPrev, np, npPrev] = await Promise.all([csatScores(projectId, cur, now), csatScores(projectId, prev, cur), npsScores(projectId, cur, now), npsScores(projectId, prev, cur)]);
  const c = csat(cs), cPrev = csat(csPrev), n = nps(np), nPrev = nps(npPrev);

  const [mentions] = await query<{ cur: number; prev: number; pos: number; neg: number; ppos: number; pneg: number }>(
    `SELECT count(*) FILTER (WHERE ts>=$2)::int AS cur, count(*) FILTER (WHERE ts<$2)::int AS prev,
            count(*) FILTER (WHERE ts>=$2 AND sentiment='positive')::int AS pos, count(*) FILTER (WHERE ts>=$2 AND sentiment='negative')::int AS neg,
            count(*) FILTER (WHERE ts<$2 AND sentiment='positive')::int AS ppos, count(*) FILTER (WHERE ts<$2 AND sentiment='negative')::int AS pneg
     FROM (SELECT COALESCE(published_at,fetched_at) AS ts, sentiment FROM cx_mentions WHERE project_id=$1) m WHERE ts>=$3`,
    [projectId, cur, prev],
  );
  const mentionDays = await query<{ day: string; positive: number; neutral: number; negative: number }>(
    `SELECT to_char(date_trunc('day', ts AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS day,
            count(*) FILTER (WHERE sentiment='positive')::int AS positive, count(*) FILTER (WHERE sentiment='negative')::int AS negative,
            count(*) FILTER (WHERE sentiment IS NULL OR sentiment NOT IN ('positive','negative'))::int AS neutral
     FROM (SELECT COALESCE(published_at,fetched_at) AS ts, sentiment FROM cx_mentions WHERE project_id=$1) m WHERE ts>=$2 GROUP BY 1`,
    [projectId, cur],
  );
  const crises = await tryCount("SELECT count(*)::int AS n FROM cx_crisis_events WHERE project_id=$1 AND status <> 'resolved'", [projectId]);

  // Daily ticket trend.
  const keys = dayKeys(days, now);
  const day = (d: string | Date) => new Date(d).toISOString().slice(0, 10);
  const trend = keys.map((k) => ({ day: k, created: 0, solved: 0 }));
  const idx = new Map(keys.map((k, i) => [k, i]));
  for (const t of tickets) {
    const a = idx.get(day(t.created_at));
    if (a != null) trend[a].created++;
    const b = t.resolved_at ? idx.get(day(t.resolved_at)) : undefined;
    if (b != null) trend[b].solved++;
  }
  const mIdx = new Map(mentionDays.map((m) => [m.day, m]));
  const mentionTrend = keys.map((k) => ({ day: k, positive: mIdx.get(k)?.positive ?? 0, neutral: mIdx.get(k)?.neutral ?? 0, negative: mIdx.get(k)?.negative ?? 0 }));

  const channelMix = Object.entries(curT.reduce<Record<string, number>>((m, t) => ((m[t.channel_kind] = (m[t.channel_kind] ?? 0) + 1), m), {}))
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Agent leaderboard.
  const byAgent = new Map<string, TicketRow[]>();
  for (const t of curT) if (t.assignee_id) byAgent.set(t.assignee_id, [...(byAgent.get(t.assignee_id) ?? []), t]);
  const ids = [...byAgent.keys()];
  const users = ids.length ? await query<{ id: string; name: string; email: string }>("SELECT id,name,email FROM users WHERE id = ANY($1)", [ids]) : [];
  const qa = ids.length
    ? await query<{ agent_id: string; avg: number; n: number }>(
        "SELECT agent_id, avg(score)::float AS avg, count(*)::int AS n FROM cx_qa_reviews WHERE project_id=$1 AND status IN ('submitted','resolved','disputed') AND score IS NOT NULL AND agent_id = ANY($2) GROUP BY agent_id",
        [projectId, ids],
      )
    : [];
  const leaderboard = ids
    .map((id) => {
      const ts = byAgent.get(id)!;
      const u = users.find((x) => x.id === id);
      const scores = ts.flatMap((t) => (t.csat != null ? [t.csat] : []));
      return {
        id,
        name: u?.name || u?.email || "Unknown user",
        assigned: ts.length,
        solved: ts.filter((t) => t.resolved_at).length,
        frt: avgFirstResponse(ts),
        art: avgResolution(ts),
        sla: slaCompliance(ts, now, policies).rate,
        csat: csat(scores).score,
        qa: qa.find((q) => q.agent_id === id)?.avg ?? null,
      };
    })
    .sort((a, b) => b.solved - a.solved || b.assigned - a.assigned)
    .slice(0, 10);

  return {
    days,
    hasTickets: counts.total > 0,
    hasMentions: setup.mentions > 0,
    kpis: {
      open: counts.open,
      urgent: counts.urgent,
      overdue: counts.overdue,
      newToday: counts.today,
      newYesterday: counts.yesterday,
      newTodayDelta: pctDelta(counts.today, counts.yesterday),
      created: curT.length,
      createdDelta: pctDelta(curT.length, prevT.length),
      frt,
      frtDelta: pctDelta(frt, frtPrev),
      art,
      artDelta: pctDelta(art, artPrev),
      sla: sla.rate,
      slaPrev: slaPrev.rate,
      slaDetail: sla,
      csat: c.score,
      csatPrev: cPrev.score,
      csatN: c.n,
      nps: n.score,
      npsPrev: nPrev.score,
      npsN: n.n,
      mentions: mentions.cur,
      mentionsDelta: pctDelta(mentions.cur, mentions.prev),
      net: netSentiment(mentions.pos, mentions.neg),
      netPrev: netSentiment(mentions.ppos, mentions.pneg),
      crises,
    },
    trend,
    mentionTrend,
    channelMix,
    leaderboard,
    setup,
  };
}
export type Overview = Awaited<ReturnType<typeof getOverview>>;
