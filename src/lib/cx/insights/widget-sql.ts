import { SOURCES, type GroupBy, type Source, type Widget } from "./widget-defs";

/**
 * Builds a parameterized aggregate query for a BI widget. Every identifier comes from the whitelists
 * below; user values (project, dates, filters) are bound parameters. Pure — unit-tested.
 */
type Spec = {
  from: string;
  date: string;
  where: string;
  groups: Partial<Record<GroupBy, string>>;
  filters: Partial<Record<"channel" | "sentiment" | "priority" | "status" | "tag", (p: string) => string>>;
  metrics: Record<string, string>;
};

const OPEN = "('new','open','pending','on_hold')";
const agentName = (u: string) => `COALESCE(NULLIF(${u}.name,''),${u}.email,'Unassigned')`;

const SPECS: Record<Source, Spec> = {
  tickets: {
    from: `cx_tickets t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN cx_sla_policies p ON p.project_id=t.project_id AND p.priority=t.priority`,
    date: "t.created_at",
    where: "t.project_id=$1",
    groups: {
      channel: "t.channel_kind",
      agent: agentName("u"),
      tag: "COALESCE(tg.tag,'untagged')",
      sentiment: "COALESCE(t.sentiment,'unknown')",
      intent: "COALESCE(t.intent,'unknown')",
      priority: "t.priority",
      status: "t.status",
    },
    filters: {
      channel: (p) => `t.channel_kind=${p}`,
      sentiment: (p) => `t.sentiment=${p}`,
      priority: (p) => `t.priority=${p}`,
      status: (p) => `t.status=${p}`,
      tag: (p) => `t.tags ? ${p}`,
    },
    metrics: {
      count: "count(*)::float",
      solved: "(count(*) FILTER (WHERE t.resolved_at IS NOT NULL))::float",
      open: `(count(*) FILTER (WHERE t.status IN ${OPEN}))::float`,
      frt: "avg(extract(epoch FROM t.first_response_at - t.created_at)/3600) FILTER (WHERE t.first_response_at >= t.created_at)",
      art: "avg(extract(epoch FROM t.resolved_at - t.created_at)/3600) FILTER (WHERE t.resolved_at >= t.created_at)",
      sla: `100.0 * (
          count(*) FILTER (WHERE fr_due IS NOT NULL AND t.first_response_at IS NOT NULL AND t.first_response_at <= fr_due)
        + count(*) FILTER (WHERE rs_due IS NOT NULL AND t.resolved_at IS NOT NULL AND t.resolved_at <= rs_due))
        / NULLIF(
          count(*) FILTER (WHERE fr_due IS NOT NULL AND (t.first_response_at IS NOT NULL OR fr_due < now()))
        + count(*) FILTER (WHERE rs_due IS NOT NULL AND (t.resolved_at IS NOT NULL OR rs_due < now())), 0)`,
      csat: "avg(t.csat)::float",
      sentscale: "100.0 * (count(*) FILTER (WHERE t.sentiment='positive') + 0.5 * count(*) FILTER (WHERE t.sentiment='neutral')) / NULLIF(count(*) FILTER (WHERE t.sentiment IN ('positive','neutral','negative')),0)",
    },
  },
  messages: {
    from: "cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id LEFT JOIN users u ON u.id=m.author_user_id",
    date: "m.created_at",
    where: "t.project_id=$1 AND m.direction IN ('in','out')",
    groups: {
      channel: "t.channel_kind",
      agent: `CASE WHEN m.direction='in' THEN 'Customer' ELSE COALESCE(NULLIF(u.name,''),u.email,NULLIF(m.author_name,''),'Unknown') END`,
      direction: "CASE WHEN m.direction='in' THEN 'Inbound' ELSE 'Outbound' END",
      sentiment: "COALESCE(t.sentiment,'unknown')",
      intent: "COALESCE(t.intent,'unknown')",
    },
    filters: { channel: (p) => `t.channel_kind=${p}`, sentiment: (p) => `t.sentiment=${p}` },
    metrics: {
      count: "count(*)::float",
      inbound: "(count(*) FILTER (WHERE m.direction='in'))::float",
      outbound: "(count(*) FILTER (WHERE m.direction='out'))::float",
    },
  },
  mentions: {
    from: "cx_mentions x",
    date: "COALESCE(x.published_at,x.fetched_at)",
    where: "x.project_id=$1",
    groups: { channel: "x.source", tag: "COALESCE(tg.tag,'untagged')", sentiment: "COALESCE(x.sentiment,'unknown')", intent: "COALESCE(x.intent,'unknown')" },
    filters: { channel: (p) => `x.source=${p}`, sentiment: (p) => `x.sentiment=${p}`, tag: (p) => `x.tags ? ${p}` },
    metrics: {
      count: "count(*)::float",
      net: "100.0 * (count(*) FILTER (WHERE x.sentiment='positive') - count(*) FILTER (WHERE x.sentiment='negative')) / NULLIF(count(*) FILTER (WHERE x.sentiment IN ('positive','negative')),0)",
      positive: "100.0 * count(*) FILTER (WHERE x.sentiment='positive') / NULLIF(count(*),0)",
      negative: "100.0 * count(*) FILTER (WHERE x.sentiment='negative') / NULLIF(count(*),0)",
      reach: "COALESCE(sum(x.author_followers),0)::float",
    },
  },
  surveys: {
    from: "cx_survey_responses r JOIN cx_surveys s ON s.id=r.survey_id LEFT JOIN cx_tickets t ON t.id=r.ticket_id LEFT JOIN users u ON u.id=t.assignee_id",
    date: "r.created_at",
    where: "r.project_id=$1",
    groups: { survey: "s.name", channel: "COALESCE(t.channel_kind,'direct link')", agent: agentName("u"), sentiment: "COALESCE(r.sentiment,'no comment')" },
    filters: { channel: (p) => `t.channel_kind=${p}`, sentiment: (p) => `r.sentiment=${p}` },
    metrics: {
      count: "count(*)::float",
      nps: "100.0 * (count(*) FILTER (WHERE s.kind='nps' AND r.score>=9) - count(*) FILTER (WHERE s.kind='nps' AND r.score<=6)) / NULLIF(count(*) FILTER (WHERE s.kind='nps' AND r.score IS NOT NULL),0)",
      csat: "100.0 * count(*) FILTER (WHERE s.kind='csat' AND r.score>=4) / NULLIF(count(*) FILTER (WHERE s.kind='csat' AND r.score IS NOT NULL),0)",
      avg: "avg(r.score)::float",
    },
  },
  qa: {
    from: "cx_qa_reviews q LEFT JOIN cx_tickets t ON t.id=q.ticket_id LEFT JOIN cx_qa_scorecards c ON c.id=q.scorecard_id LEFT JOIN users u ON u.id=q.agent_id",
    date: "COALESCE(q.submitted_at,q.updated_at)",
    where: "q.project_id=$1 AND q.status IN ('submitted','disputed','resolved')",
    groups: { agent: agentName("u"), scorecard: "COALESCE(c.name,'Deleted scorecard')", channel: "t.channel_kind" },
    filters: { channel: (p) => `t.channel_kind=${p}` },
    metrics: {
      count: "count(*)::float",
      avg: "avg(q.score)::float",
      fatal: "100.0 * count(*) FILTER (WHERE q.fatal) / NULLIF(count(*),0)",
    },
  },
};

/** `ticketIds` (optional) restricts ticket-based sources to tickets matching classification/field filters. */
export function buildWidgetSql(w: Pick<Widget, "source" | "metric" | "groupBy" | "filters" | "range"> & { chart?: Widget["chart"] }, projectId: string, from: Date, to: Date, grouped: boolean, ticketIds?: string[] | null) {
  const spec = SPECS[w.source];
  if (!spec) throw new Error("Unknown data source");
  const metric = spec.metrics[w.metric] ?? spec.metrics.count;
  const params: unknown[] = [projectId, from, to];
  const where = [spec.where, `${spec.date} >= $2`, `${spec.date} < $3`];
  const allowed = SOURCES[w.source].filters;
  for (const [k, v] of Object.entries(w.filters ?? {})) {
    const f = spec.filters[k as keyof Spec["filters"]];
    if (!v || !f || !allowed.includes(k as never)) continue;
    params.push(String(v));
    where.push(f(`$${params.length}`));
  }
  if (ticketIds && w.source !== "mentions") {
    params.push(ticketIds);
    where.push(`t.id = ANY($${params.length})`);
  }
  let from_ = spec.from;
  if (w.source === "tickets") {
    from_ += ` CROSS JOIN LATERAL (SELECT COALESCE(t.first_response_due, t.created_at + p.first_response_minutes * interval '1 minute') AS fr_due,
      COALESCE(t.resolution_due, t.created_at + p.resolution_minutes * interval '1 minute') AS rs_due) d`;
  }
  const g = grouped ? w.groupBy : "none";
  if (g === "tag") from_ += ` LEFT JOIN LATERAL jsonb_array_elements_text(${w.source === "tickets" ? "t" : "x"}.tags) AS tg(tag) ON true`;
  let key: string | null = null;
  if (g === "date") key = w.chart === "compare" ? `to_char(${spec.date} AT TIME ZONE 'UTC','YYYY-MM')` : `to_char(date_trunc('${w.range > 120 ? "week" : "day"}', ${spec.date} AT TIME ZONE 'UTC'),'YYYY-MM-DD')`;
  else if (g !== "none") key = spec.groups[g as keyof Spec["groups"]] ?? null;
  if (grouped && g !== "none" && !key) throw new Error(`Cannot group ${SOURCES[w.source].label.toLowerCase()} by ${g}`);
  const sql = key
    ? `SELECT ${key} AS key, ${metric} AS value FROM ${from_} WHERE ${where.join(" AND ")} GROUP BY 1 ORDER BY ${g === "date" ? "1 ASC" : "2 DESC NULLS LAST"} LIMIT ${g === "date" ? 400 : 25}`
    : `SELECT ${metric} AS value FROM ${from_} WHERE ${where.join(" AND ")}`;
  return { sql, params };
}
