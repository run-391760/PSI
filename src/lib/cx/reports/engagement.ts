import { query } from "@/lib/db";
import { getQueueSettings, queueAgents, statusLog } from "@/lib/cx/admin/queue";
import { ASSIGNMENT_TYPES } from "@/lib/cx/admin/pure/queue";
import { agentsOf } from "@/lib/cx/insights/team";
import { hoursCfg, myDashboard } from "@/lib/cx/insights/reports";
import { CHANNELS, channelInfo, type ChannelKind } from "@/lib/cx/channels";
import { channelAvailable } from "@/lib/cx/providers";
import { loadTicketRows, type ReportCtx } from "./data";
import {
  avgSpan, breakSummary, countPerBucket, csatSummary, npsSummary, overdueTasks, PHONE_KINDS, queueTrend, responseRate, scoreDistribution, statusLogRows, surveyByAgent, surveyTrend,
  taskByAssignee, taskByClassification, taskByPriority, taskTiles, taskTrend, toLocal, waitingSummary, waitToAssign, type QueueStateRow, type StatusLogRow, type SurveyRow, type TaskRow,
} from "./engagement-model";
import { pctChange, previousRange, replyTat, statusTile, ticketStats, timeSeries, TICKET_TILES, type DrillSpec, type Range } from "./model";

/**
 * View models for the Community Engagement reports (tasks, CSAT, queuing, My Dashboard) and Calls Analytics
 * (server-only, serializable output). Every count comes from stored rows and uses the drill-down source's own
 * definition (see drill.ts), so clicking a number lists exactly what was counted.
 */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const bounds = (r: Range, off: number) => ({ start: new Date(Date.parse(`${r.from}T00:00:00Z`) - off * 60000), end: new Date(Date.parse(`${r.to}T23:59:59.999Z`) - off * 60000) });

/** Drill base for tasks / surveys / tickets. No scope or media filters: these reports are brand-wide. */
export function engagementBase(ctx: ReportCtx, source: DrillSpec["source"], extra: Partial<Omit<DrillSpec, "title" | "source">> = {}): Omit<DrillSpec, "title"> {
  return { source, range: ctx.filters.range, interval: ctx.filters.interval, ...(source === "tickets" ? { basis: "created" as const } : {}), ...extra };
}

// ================================================================ tasks

async function loadTasks(ctx: ReportCtx, span: Range, assignee: string | null): Promise<TaskRow[]> {
  const { start, end } = bounds(span, ctx.offsetMin);
  const params: unknown[] = [ctx.brandId, start, end];
  if (assignee) params.push(assignee);
  const rows = await query<{
    id: string; number: number; title: string; status: string; priority: string; assignee_id: string | null; assignee: string | null; classification_id: string | null; classification_path: string;
    created_at: string; due_at: string | null; completed_at: string | null; ticket_number: number | null;
  }>(
    `SELECT k.id,k.number,k.title,k.status,k.priority,k.assignee_id,COALESCE(NULLIF(u.name,''),u.email) AS assignee,k.classification_id,k.classification_path,
            k.created_at,k.due_at,k.completed_at,t.number AS ticket_number
       FROM cx_ops_tasks k LEFT JOIN users u ON u.id=k.assignee_id LEFT JOIN cx_tickets t ON t.id=k.ticket_id
      WHERE k.project_id=$1 AND k.created_at >= $2 AND k.created_at <= $3 ${assignee ? "AND k.assignee_id=$4" : ""}
      ORDER BY k.created_at DESC LIMIT 20000`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    priority: r.priority,
    assigneeId: r.assignee_id,
    assignee: r.assignee,
    classificationId: r.classification_id,
    classification: r.classification_path,
    at: toLocal(r.created_at, ctx.offsetMin)!,
    dueAt: iso(r.due_at),
    completedAt: iso(r.completed_at),
    createdAt: iso(r.created_at)!,
    ticketNumber: r.ticket_number,
  }));
}

export async function taskReportView(ctx: ReportCtx, mine: string | null) {
  const now = Date.now();
  const { range, interval } = ctx.filters;
  const prev = previousRange(range);
  const [rows, prevRows, anyTask] = await Promise.all([
    loadTasks(ctx, range, mine),
    loadTasks(ctx, prev, mine),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM cx_ops_tasks WHERE project_id=$1 ${mine ? "AND assignee_id=$2" : ""}`, mine ? [ctx.brandId, mine] : [ctx.brandId]),
  ]);
  const tiles = taskTiles(rows, now), before = taskTiles(prevRows, now);
  return {
    empty: rows.length === 0,
    everHadTasks: (anyTask[0]?.n ?? 0) > 0,
    tiles,
    change: { total: pctChange(tiles.total, before.total), done: pctChange(tiles.byStatus.done, before.byStatus.done), overdue: pctChange(tiles.overdue, before.overdue) },
    trend: taskTrend(rows, range, interval),
    byPriority: taskByPriority(rows),
    byAssignee: mine ? [] : taskByAssignee(rows, now),
    byClassification: taskByClassification(rows),
    overdue: overdueTasks(rows, now, 50),
  };
}

// ================================================================ CSAT

async function loadResponses(ctx: ReportCtx, span: Range, where: { survey?: string; kind?: string }): Promise<SurveyRow[]> {
  const { start, end } = bounds(span, ctx.offsetMin);
  const params: unknown[] = [ctx.brandId, start, end];
  const cond = where.survey ? (params.push(where.survey), `r.survey_id=$${params.length}`) : (params.push(where.kind ?? "csat"), `s.kind=$${params.length}`);
  const rows = await query<{ id: string; survey_id: string; kind: SurveyRow["kind"]; score: number | null; comment: string; sentiment: string | null; created_at: string; agent_id: string | null; agent: string | null; ticket_id: string | null; ticket_number: number | null; contact: string | null }>(
    `SELECT r.id,r.survey_id,s.kind,r.score,r.comment,r.sentiment,r.created_at,t.assignee_id AS agent_id,COALESCE(NULLIF(u.name,''),u.email) AS agent,r.ticket_id,t.number AS ticket_number,
            COALESCE(NULLIF(c.name,''),c.email) AS contact
       FROM cx_survey_responses r JOIN cx_surveys s ON s.id=r.survey_id LEFT JOIN cx_tickets t ON t.id=r.ticket_id LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN cx_contacts c ON c.id=r.contact_id
      WHERE r.project_id=$1 AND r.created_at >= $2 AND r.created_at <= $3 AND ${cond} ORDER BY r.created_at DESC LIMIT 20000`,
    params,
  );
  return rows.map((r) => ({
    id: r.id, surveyId: r.survey_id, kind: r.kind, score: r.score, comment: r.comment ?? "", sentiment: r.sentiment, at: toLocal(r.created_at, ctx.offsetMin)!,
    agentId: r.agent_id, agent: r.agent, ticketId: r.ticket_id, ticketNumber: r.ticket_number, contact: r.contact,
  }));
}

export async function csatReportView(ctx: ReportCtx, sp: SP) {
  const { range, interval } = ctx.filters;
  const surveys = await query<{ id: string; name: string; kind: "csat" | "nps" | "custom"; status: string }>("SELECT id,name,kind,status FROM cx_surveys WHERE project_id=$1 ORDER BY created_at DESC", [ctx.brandId]);
  const csatSurveys = surveys.filter((s) => s.kind === "csat");
  const hasNps = surveys.some((s) => s.kind === "nps");
  const selected = csatSurveys.some((s) => s.id === one(sp.survey)) ? one(sp.survey) : "";
  const where = selected ? { survey: selected } : { kind: "csat" };
  const { start, end } = bounds(range, ctx.offsetMin);
  const [rows, prevRows, npsRows, inv] = await Promise.all([
    loadResponses(ctx, range, where),
    loadResponses(ctx, previousRange(range), where),
    hasNps ? loadResponses(ctx, range, { kind: "nps" }) : Promise.resolve([] as SurveyRow[]),
    query<{ invites: number; responded: number }>(
      `SELECT count(*)::int AS invites, count(*) FILTER (WHERE i.responded_at IS NOT NULL)::int AS responded
         FROM cx_survey_invites i JOIN cx_surveys s ON s.id=i.survey_id
        WHERE i.project_id=$1 AND i.created_at >= $2 AND i.created_at <= $3 AND ${selected ? "i.survey_id=$4" : "s.kind='csat'"}`,
      selected ? [ctx.brandId, start, end, selected] : [ctx.brandId, start, end],
    ),
  ]);
  const sum = csatSummary(rows), before = csatSummary(prevRows);
  const invites = inv[0]?.invites ?? 0, responded = inv[0]?.responded ?? 0;
  return {
    surveys: csatSurveys.map((s) => ({ id: s.id, name: s.name, paused: s.status === "paused" })),
    noSurveys: csatSurveys.length === 0,
    hasNps,
    selected,
    selectedName: selected ? csatSurveys.find((s) => s.id === selected)!.name : "All CSAT surveys",
    empty: rows.length === 0,
    summary: sum,
    change: { responses: pctChange(sum.responses, before.responses), average: pctChange(sum.average, before.average), satisfied: pctChange(sum.satisfiedPct, before.satisfiedPct) },
    nps: npsSummary(npsRows.map((r) => r.score)),
    npsResponses: npsRows.length,
    invites,
    responded,
    responseRate: responseRate(responded, invites),
    distribution: scoreDistribution(rows, 1, 5),
    trend: surveyTrend(rows, range, interval),
    byAgent: surveyByAgent(rows),
    comments: rows.filter((r) => r.comment.trim()).slice(0, 40),
    drillDims: (selected ? { survey: selected } : { kind: "csat" }) as Record<string, string>,
  };
}

// ================================================================ queuing

export async function queueReportView(ctx: ReportCtx) {
  const now = Date.now();
  const { range, interval } = ctx.filters;
  const { start, end } = bounds(range, ctx.offsetMin);
  const [settings, agents, log, waiting, inQueueAssigned, state, ever] = await Promise.all([
    getQueueSettings(ctx.brandId),
    queueAgents(ctx.brandId),
    statusLog(ctx.brandId, 1000),
    // Same rule as the "assign_pending" ticket tile: in the queue with no assignee.
    query<{ id: string; created_at: string; queued_at: string | null }>(
      "SELECT t.id,t.created_at,s.queued_at FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id WHERE s.project_id=$1 AND s.in_queue AND t.assignee_id IS NULL ORDER BY s.queued_at NULLS LAST LIMIT 5000",
      [ctx.brandId],
    ),
    query<{ n: number }>("SELECT count(*)::int AS n FROM cx_admin_ticket_state s JOIN cx_tickets t ON t.id=s.ticket_id WHERE s.project_id=$1 AND s.in_queue AND t.assignee_id IS NOT NULL AND t.status NOT IN ('solved','closed')", [ctx.brandId]),
    query<{ ticket_id: string; queued_at: string | null; assigned_at: string | null }>(
      "SELECT ticket_id,queued_at,assigned_at FROM cx_admin_ticket_state WHERE project_id=$1 AND ((queued_at >= $2 AND queued_at <= $3) OR (assigned_at >= $2 AND assigned_at <= $3)) LIMIT 40000",
      [ctx.brandId, start, end],
    ),
    query<{ n: number }>("SELECT count(*)::int AS n FROM cx_admin_ticket_state WHERE project_id=$1 AND queued_at IS NOT NULL", [ctx.brandId]),
  ]);
  const rows: QueueStateRow[] = state.map((r) => ({ ticketId: r.ticket_id, queuedAt: iso(r.queued_at), assignedAt: iso(r.assigned_at) }));
  const logRows = statusLogRows(log as StatusLogRow[], range, ctx.offsetMin, now);
  const trend = queueTrend(rows, range, interval, ctx.offsetMin);
  const oldestCreated = waiting.reduce<string | null>((m, w) => { const d = toLocal(w.created_at, ctx.offsetMin)!.slice(0, 10); return !m || d < m ? d : m; }, null);
  const agentStatus = { available: agents.filter((a) => a.status === "available").length, break: agents.filter((a) => a.status === "break").length, offline: agents.filter((a) => a.status === "offline").length };
  return {
    settings: {
      enabled: settings.enabled,
      assignment: ASSIGNMENT_TYPES.find((t) => t.value === settings.assignmentType)?.label ?? settings.assignmentType,
      maxPerAgent: settings.maxPerAgent,
      cleanupMinutes: settings.cleanupMinutes,
      resetOnStatus: settings.resetOnStatus,
      resetAfterMinutes: settings.resetAfterMinutes,
      removeOn: settings.removeOn,
      segments: settings.segments.length,
      byTimezone: settings.byTimezone,
    },
    hasHistory: (ever[0]?.n ?? 0) > 0 || log.length > 0,
    waiting: { ...waitingSummary(waiting.map((w) => ({ queuedAt: iso(w.queued_at) })), now), window: oldestCreated ? { from: oldestCreated, to: ctx.today } : null },
    inQueueAssigned: inQueueAssigned[0]?.n ?? 0,
    trend,
    totals: { queued: trend.reduce((s, r) => s + r.queued, 0), assigned: trend.reduce((s, r) => s + r.assigned, 0) },
    wait: waitToAssign(rows, range, ctx.offsetMin),
    agents: agents.map((a) => ({ id: a.id, name: a.name, team: a.team, status: a.status, statusName: a.statusName, since: a.since, paused: a.paused, capacity: a.capacity, load: a.load, overrun: a.overrun, lastAssignedAt: a.lastAssignedAt })),
    agentStatus,
    log: logRows.slice(0, 100),
    breaks: breakSummary(logRows),
  };
}

// ================================================================ my dashboard

export async function myDashboardView(ctx: ReportCtx, user: { id: string; name: string; email: string }) {
  const { range, interval } = ctx.filters;
  const { start, end } = bounds(range, ctx.offsetMin);
  const all = await loadTicketRows(ctx, range, { basis: "created" });
  const mine = all.filter((r) => r.agent === user.id);
  const ids = mine.map((r) => r.ticketId!).filter(Boolean);
  const [msgs, times, replies, notes, tasks, today] = await Promise.all([
    ids.length
      ? query<{ ticket_id: string; direction: "in" | "out" | "note"; created_at: string }>("SELECT ticket_id,direction,created_at FROM cx_messages WHERE ticket_id = ANY($1::text[]) AND direction<>'note' ORDER BY created_at LIMIT 100000", [ids])
      : Promise.resolve([]),
    ids.length ? query<{ id: string; created_at: string; first_response_at: string | null; resolved_at: string | null }>("SELECT id,created_at,first_response_at,resolved_at FROM cx_tickets WHERE id = ANY($1::text[])", [ids]) : Promise.resolve([]),
    query<{ created_at: string; ticket_id: string }>("SELECT m.created_at,m.ticket_id FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=$2 AND m.direction='out' AND m.created_at >= $3 AND m.created_at <= $4 LIMIT 100000", [ctx.brandId, user.id, start, end]),
    query<{ n: number }>("SELECT count(*)::int AS n FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.author_user_id=$2 AND m.direction='note' AND m.created_at >= $3 AND m.created_at <= $4", [ctx.brandId, user.id, start, end]),
    loadTasks(ctx, range, user.id),
    myDashboard(ctx.brandId, user, await hoursCfg(ctx.brandId)),
  ]);
  // "Open now" with the drill's dims.unresolved definition (created within the last year, not solved/closed/ignored).
  const yearAgo = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 365 * 86400000).toISOString().slice(0, 10);
  const openNow = (await loadTicketRows(ctx, { from: yearAgo, to: ctx.today }, { basis: "created" })).filter((r) => r.agent === user.id && !["solved", "closed", "ignored"].includes(r.status ?? "")).length;
  const tat = replyTat(msgs.map((m) => ({ ...m, created_at: iso(m.created_at)! })));
  const t = times.map((x) => ({ created: iso(x.created_at), first: iso(x.first_response_at), resolved: iso(x.resolved_at) }));
  const stats = ticketStats(mine.map((r) => ({ status: r.status ?? "", in_queue: !!r.inQueue, assignee_id: r.agent ?? null })));
  const statusKeys = TICKET_TILES.filter((x) => x.id !== "total" && x.id !== "assign_pending").map((x) => x.id);
  const replyAts = replies.map((r) => toLocal(r.created_at, ctx.offsetMin)!);
  const activity = timeSeries(mine, range, interval, (r) => [statusTile(r.status ?? "")], statusKeys);
  const repliesPer = countPerBucket(replyAts, range, interval);
  const taskTilesMine = taskTiles(tasks, Date.now());
  return {
    empty: mine.length === 0 && replies.length === 0 && tasks.length === 0,
    stats,
    statusKeys,
    replies: replies.length,
    repliedTickets: new Set(replies.map((r) => r.ticket_id)).size,
    openNow,
    notes: notes[0]?.n ?? 0,
    tat: { average: tat.average, first: tat.first, second: tat.second, third: tat.third, averageReplies: tat.averageReplies, measured: tat.measured },
    frt: avgSpan(t, (x) => x.created, (x) => x.first),
    closeTat: avgSpan(t.filter((x) => x.resolved), (x) => x.created, (x) => x.resolved),
    activity: activity.map((row, i) => ({ ...row, replies: repliesPer[i]?.count ?? 0 }) as Record<string, number | string> & { key: string }),
    tasks: { ...taskTilesMine, total: tasks.length },
    today,
  };
}

// ================================================================ calls

export async function callsView(ctx: ReportCtx) {
  const info = channelInfo("phone");
  const catalogued = CHANNELS.some((c) => (c.kind as string) === "phone");
  const available = catalogued ? channelAvailable("phone" as ChannelKind) : false;
  const [[ever], rows, agents] = await Promise.all([
    query<{ n: number }>("SELECT count(*)::int AS n FROM cx_tickets WHERE project_id=$1 AND channel_kind = ANY($2::text[])", [ctx.brandId, PHONE_KINDS]),
    loadTicketRows(ctx, ctx.filters.range, { basis: "created" }),
    agentsOf(ctx.brandId),
  ]);
  // Same rule as the drill's mediaType dimension (mediaTypeOf maps channel_kind "phone" to "phone").
  const calls = rows.filter((r) => r.mediaType === "phone");
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const byAgent = new Map<string, number>();
  for (const r of calls) byAgent.set(r.agent ?? "none", (byAgent.get(r.agent ?? "none") ?? 0) + 1);
  return {
    info: info ? { name: info.name, api: info.api, cost: info.cost, costNote: info.costNote, env: info.env, setup: info.setup } : null,
    available,
    everCalls: ever?.n ?? 0,
    calls: calls.length,
    stats: ticketStats(calls.map((r) => ({ status: r.status ?? "", in_queue: !!r.inQueue, assignee_id: r.agent ?? null }))),
    trend: timeSeries(calls, ctx.filters.range, ctx.filters.interval, () => ["calls"], ["calls"]),
    byAgent: [...byAgent.entries()].map(([id, n]) => ({ id, name: id === "none" ? "Unassigned" : (names.get(id) ?? "Unknown user"), calls: n })).sort((a, b) => b.calls - a.calls),
  };
}
