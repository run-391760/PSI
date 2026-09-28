import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getTicketFields } from "@/lib/cx/admin/fields";
import { dayKeys } from "./metrics";
import { topPhrases } from "./reports-math";
import { SOURCES, THEMES, chartsFor, metricDef, type DashboardFilters, type Widget, type WidgetResult } from "./widget-defs";
import { buildWidgetSql } from "./widget-sql";

export type Dashboard = { id: string; project_id: string; name: string; description: string; widgets: Widget[]; shared: boolean; created_by: string | null; creator: string | null; created_at: string; updated_at: string; theme: string; filters: DashboardFilters };

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const fieldFilter = z.object({ key: z.string().min(1).max(80), value: z.string().max(200) });
const baseFilters = z.object({ channel: z.string().max(60).optional(), sentiment: z.string().max(30).optional(), priority: z.string().max(20).optional(), status: z.string().max(20).optional(), tag: z.string().max(80).optional() });
export const dashboardFiltersInput = baseFilters.extend({ fields: z.array(fieldFilter).max(10).optional(), classificationIds: z.array(z.string().max(64)).max(30).optional() });

export const widgetInput = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1, "Title is required").max(100),
  source: z.enum(["tickets", "messages", "mentions", "surveys", "qa"]),
  metric: z.string().max(40),
  chart: z.enum(["kpi", "line", "bar", "donut", "table", "compare", "stacked", "cloud"]),
  groupBy: z.union([z.enum(["none", "date", "channel", "agent", "tag", "sentiment", "intent", "priority", "status", "direction", "survey", "scorecard"]), z.string().regex(/^field:[\w.-]{1,80}$/)]),
  range: z.number().int().min(1).max(730),
  from: isoDay.optional(),
  to: isoDay.optional(),
  fields: z.array(fieldFilter).max(10).optional(),
  classificationIds: z.array(z.string().max(64)).max(30).optional(),
  filters: baseFilters.default({}),
  size: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export const dashboardInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(300).default(""),
  shared: z.boolean().default(true),
  widgets: z.array(widgetInput).max(40).default([]),
  theme: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]).default("default"),
  filters: dashboardFiltersInput.default({}),
});

/** Normalizes a widget so metric / grouping are valid for its source and chart. */
export function normalizeWidget(w: Widget): Widget {
  const src = SOURCES[w.source];
  const metric = src.metrics.some((m) => m.id === w.metric) ? w.metric : src.metrics[0].id;
  const charts = chartsFor(w.source, metric);
  const chart = charts.includes(w.chart) ? w.chart : charts[0];
  const isField = typeof w.groupBy === "string" && w.groupBy.startsWith("field:") && w.source === "tickets";
  let groupBy = isField || src.groups.includes(w.groupBy as never) ? w.groupBy : "none";
  if (chart === "kpi" || chart === "cloud") groupBy = "none";
  else if (chart === "stacked") groupBy = "agent";
  else if (chart === "line" || chart === "compare") groupBy = "date";
  else if (groupBy === "none") groupBy = src.groups[2] ?? "date";
  const filters = Object.fromEntries(Object.entries(w.filters ?? {}).filter(([k, v]) => v && src.filters.includes(k as never)));
  const custom = w.from && w.to && w.from <= w.to ? { from: w.from, to: w.to } : { from: undefined, to: undefined };
  return { ...w, metric, chart, groupBy, filters, ...custom, fields: (w.fields ?? []).filter((f) => f.key && f.value), classificationIds: w.classificationIds ?? [] };
}

/** Widget window [from, to) and the comparison window (previous period of equal length). */
export function widgetWindow(w: Pick<Widget, "range" | "from" | "to">, now = new Date()) {
  if (w.from && w.to) {
    const from = new Date(`${w.from}T00:00:00Z`), to = new Date(new Date(`${w.to}T00:00:00Z`).getTime() + 86400000);
    const span = to.getTime() - from.getTime();
    return { from, to, prevFrom: new Date(from.getTime() - span), days: Math.round(span / 86400000) };
  }
  const from = new Date(now.getTime() - w.range * 86400000);
  return { from, to: now, prevFrom: new Date(from.getTime() - w.range * 86400000), days: w.range };
}

/** Applies dashboard-level filters on top of a widget's own (the widget wins on conflicts). */
export function withDashboardFilters(w: Widget, f: DashboardFilters | null | undefined): Widget {
  if (!f) return w;
  const { fields, classificationIds, ...base } = f;
  return { ...w, filters: { ...base, ...w.filters }, fields: [...(fields ?? []), ...(w.fields ?? [])], classificationIds: [...new Set([...(classificationIds ?? []), ...(w.classificationIds ?? [])])] };
}

const SELECT = `SELECT d.*, COALESCE(NULLIF(u.name,''),u.email) AS creator FROM cx_dashboards d LEFT JOIN users u ON u.id=d.created_by`;

export async function listDashboards(projectId: string, userId: string) {
  return query<Dashboard>(`${SELECT} WHERE d.project_id=$1 AND (d.shared OR d.created_by=$2) ORDER BY d.updated_at DESC`, [projectId, userId]);
}
export async function getDashboard(projectId: string, userId: string, id: string) {
  const [d] = await query<Dashboard>(`${SELECT} WHERE d.id=$1 AND d.project_id=$2 AND (d.shared OR d.created_by=$3)`, [id, projectId, userId]);
  if (!d) throw new AppError("Dashboard not found.", 404);
  return d;
}
export async function createDashboard(projectId: string, userId: string, raw: z.input<typeof dashboardInput>) {
  const input = dashboardInput.parse(raw);
  const id = randomUUID();
  await query("INSERT INTO cx_dashboards(id,project_id,name,description,widgets,shared,created_by,theme,filters) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    id,
    projectId,
    input.name,
    input.description,
    JSON.stringify(input.widgets.map((w) => normalizeWidget(w as Widget))),
    input.shared,
    userId,
    input.theme,
    JSON.stringify(input.filters),
  ]);
  return id;
}
export async function updateDashboard(projectId: string, userId: string, id: string, raw: Partial<z.input<typeof dashboardInput>>) {
  await getDashboard(projectId, userId, id);
  const input = dashboardInput.partial().parse(raw);
  await query(
    `UPDATE cx_dashboards SET name=COALESCE($3,name), description=COALESCE($4,description), shared=COALESCE($5,shared),
     widgets=COALESCE($6,widgets), theme=COALESCE($7,theme), filters=COALESCE($8,filters), updated_at=now() WHERE id=$1 AND project_id=$2`,
    // Only fields present in `raw` change (zod defaults would otherwise overwrite stored values).
    [
      id,
      projectId,
      raw.name !== undefined ? input.name : null,
      raw.description !== undefined ? input.description : null,
      raw.shared !== undefined ? input.shared : null,
      raw.widgets !== undefined && input.widgets ? JSON.stringify(input.widgets.map((w) => normalizeWidget(w as Widget))) : null,
      raw.theme !== undefined ? input.theme : null,
      raw.filters !== undefined ? JSON.stringify(input.filters) : null,
    ],
  );
}
export async function deleteDashboard(projectId: string, userId: string, id: string) {
  await getDashboard(projectId, userId, id);
  await query("DELETE FROM cx_dashboards WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** Ticket ids created in the window that match classification / field filters (null = no such filters). */
async function ticketsMatching(projectId: string, w: Widget, from: Date, to: Date) {
  if (!w.fields?.length && !w.classificationIds?.length) return null;
  const ids = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE project_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC LIMIT 5000", [projectId, from, to]);
  const out: string[] = [];
  for (const { id } of ids) {
    const f = await getTicketFields(id).catch(() => ({ classificationIds: [] as string[], values: {} as Record<string, unknown> }));
    if (w.classificationIds?.length && !w.classificationIds.some((c) => f.classificationIds.includes(c))) continue;
    if (!(w.fields ?? []).every((ff) => {
      const v = f.values[ff.key];
      return (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]).some((x) => x.toLowerCase() === ff.value.toLowerCase());
    })) continue;
    out.push(id);
  }
  return out;
}

const num = (v: unknown) => (v == null ? null : Number(v));

/** Executes a widget against stored records: grouped rows, the current total and the previous-period total. */
export async function runWidget(projectId: string, raw: Widget, now = new Date(), dashFilters?: DashboardFilters | null): Promise<WidgetResult> {
  const w = normalizeWidget(withDashboardFilters(raw, dashFilters));
  const { from, to, prevFrom, days } = widgetWindow(w, now);
  try {
    const ids = w.source === "mentions" ? null : await ticketsMatching(projectId, w, prevFrom, to);
    if (w.metric === "phrases") return await phraseWidget(projectId, w, from, to, ids);
    if (w.metric === "queue") return await queueWidget(projectId, w, ids);
    const total = buildWidgetSql(w, projectId, from, to, false, ids);
    const prev = buildWidgetSql(w, projectId, prevFrom, from, false, ids);
    const [[t], [p]] = await Promise.all([query<{ value: number | null }>(total.sql, total.params), query<{ value: number | null }>(prev.sql, prev.params)]);
    let rows: { key: string; value: number | null }[] = [];
    let multi: WidgetResult["multi"];
    if (w.chart === "compare") {
      const yearAgo = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
      const cur = buildWidgetSql(w, projectId, from, to, true, ids);
      const old = buildWidgetSql(w, projectId, yearAgo(from), yearAgo(to), true, null);
      const [a, b] = await Promise.all([query<{ key: string; value: number | null }>(cur.sql, cur.params), query<{ key: string; value: number | null }>(old.sql, old.params)]);
      const months: string[] = [];
      for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d < to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d.toISOString().slice(0, 7));
      const prevKey = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
      multi = {
        series: [{ key: "current", label: "This period" }, { key: "lastYear", label: "Same period last year" }],
        rows: months.map((m) => ({ key: `${m}-01`, current: num(a.find((x) => x.key === m)?.value) ?? 0, lastYear: num(b.find((x) => x.key === prevKey(m))?.value) ?? 0 })),
      };
      rows = multi.rows.map((r) => ({ key: String(r.key), value: r.current as number }));
    } else if (typeof w.groupBy === "string" && w.groupBy.startsWith("field:")) {
      rows = await fieldGrouped(projectId, w, from, to);
    } else if (w.groupBy !== "none") {
      const g = buildWidgetSql(w, projectId, from, to, true, ids);
      rows = (await query<{ key: string; value: number | null }>(g.sql, g.params)).map((r) => ({ key: String(r.key ?? "unknown"), value: num(r.value) }));
      if (w.groupBy === "date" && days <= 120) {
        const by = new Map(rows.map((r) => [r.key, r.value]));
        const additive = metricDef(w)?.additive;
        rows = dayKeys(days, new Date(to.getTime() - 1)).map((key) => ({ key, value: by.has(key) ? by.get(key)! : additive ? 0 : null }));
      }
    }
    return { rows, total: num(t?.value), previous: num(p?.value), multi };
  } catch (e) {
    return { rows: [], total: null, previous: null, error: e instanceof Error ? e.message : "Query failed" };
  }
}

/** FRT / sentiment scale / counts grouped by an Additional or Custom field value (L10, L21). */
async function fieldGrouped(projectId: string, w: Widget, from: Date, to: Date) {
  const key = String(w.groupBy).slice(6);
  const rows = await query<{ id: string; created_at: string; first_response_at: string | null; resolved_at: string | null; sentiment: string | null; csat: number | null }>(
    "SELECT id,created_at,first_response_at,resolved_at,sentiment,csat FROM cx_tickets WHERE project_id=$1 AND created_at >= $2 AND created_at < $3 LIMIT 5000",
    [projectId, from, to],
  );
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const v = (await getTicketFields(r.id).catch(() => ({ values: {} as Record<string, unknown> }))).values[key];
    for (const k of Array.isArray(v) ? v.map(String) : [v == null || v === "" ? "(empty)" : String(v)]) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const hrs = (a: string, b: string | null) => (b ? (new Date(b).getTime() - new Date(a).getTime()) / 3600000 : null);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null && x >= 0);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  return [...groups.entries()]
    .map(([k, ts]) => {
      let value: number | null;
      if (w.metric === "frt") value = avg(ts.map((t) => hrs(t.created_at, t.first_response_at)));
      else if (w.metric === "art") value = avg(ts.map((t) => hrs(t.created_at, t.resolved_at)));
      else if (w.metric === "csat") value = avg(ts.map((t) => t.csat));
      else if (w.metric === "sentscale") {
        const s = ts.filter((t) => t.sentiment && t.sentiment !== "unknown");
        value = s.length ? (100 * (s.filter((t) => t.sentiment === "positive").length + 0.5 * s.filter((t) => t.sentiment === "neutral").length)) / s.length : null;
      } else if (w.metric === "solved") value = ts.filter((t) => t.resolved_at).length;
      else value = ts.length;
      return { key: k, value };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .slice(0, 25);
}

/** Agent-wise queue: open / pending / on hold / reopened tickets per assignee right now (L13). */
async function queueWidget(projectId: string, w: Widget, ids: string[] | null): Promise<WidgetResult> {
  const rows = await query<{ agent: string; open: number; pending: number; on_hold: number; reopened: number }>(
    `SELECT COALESCE(NULLIF(u.name,''),u.email,'Unassigned') AS agent,
            count(*) FILTER (WHERE t.status IN ('new','open'))::int AS open, count(*) FILTER (WHERE t.status='pending')::int AS pending,
            count(*) FILTER (WHERE t.status='on_hold')::int AS on_hold,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM cx_inbox_events e WHERE e.ticket_id=t.id AND (e.kind='reopen' OR e.detail ILIKE '%reopen%')))::int AS reopened
     FROM cx_tickets t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=$1 AND t.status IN ('new','open','pending','on_hold') ${w.filters.channel ? "AND t.channel_kind=$3" : ""} ${ids ? "AND t.id = ANY($2)" : "AND $2::text[] IS NULL"}
     GROUP BY 1 ORDER BY count(*) DESC LIMIT 25`,
    w.filters.channel ? [projectId, ids, w.filters.channel] : [projectId, ids],
  );
  const total = rows.reduce((s, r) => s + r.open + r.pending + r.on_hold, 0);
  return {
    rows: rows.map((r) => ({ key: r.agent, value: r.open + r.pending + r.on_hold })),
    total,
    previous: null,
    multi: { series: [{ key: "open", label: "Open" }, { key: "pending", label: "Pending" }, { key: "on_hold", label: "On hold" }, { key: "reopened", label: "Reopened" }], rows: rows.map((r) => ({ key: r.agent, open: r.open, pending: r.pending, on_hold: r.on_hold, reopened: r.reopened })) },
  };
}

/** Top 2–3 word phrases from mentions or inbound messages (L15). */
async function phraseWidget(projectId: string, w: Widget, from: Date, to: Date, ids: string[] | null): Promise<WidgetResult> {
  const texts =
    w.source === "mentions"
      ? await query<{ text: string }>(
          `SELECT concat_ws(' ', title, body) AS text FROM cx_mentions x WHERE x.project_id=$1 AND COALESCE(x.published_at,x.fetched_at) >= $2 AND COALESCE(x.published_at,x.fetched_at) < $3
           ${w.filters.channel ? "AND x.source=$4" : ""} ${w.filters.sentiment ? `AND x.sentiment=$${w.filters.channel ? 5 : 4}` : ""} LIMIT 5000`,
          [projectId, from, to, ...(w.filters.channel ? [w.filters.channel] : []), ...(w.filters.sentiment ? [w.filters.sentiment] : [])],
        )
      : await query<{ text: string }>(
          `SELECT m.body AS text FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.direction='in' AND m.created_at >= $2 AND m.created_at < $3
           ${ids ? "AND t.id = ANY($4)" : ""} LIMIT 5000`,
          ids ? [projectId, from, to, ids] : [projectId, from, to],
        );
  const terms = topPhrases(texts.map((t) => t.text ?? ""), 40);
  return { rows: terms.map((t) => ({ key: t.term, value: t.count })), total: texts.length, previous: null, terms };
}

// ------------------------------------------------------------- public share links (L31) and MCP tokens

export type ShareLink = { token: string; kind: "dashboard" | "mcp"; target_id: string | null; label: string; created_at: string; last_used_at: string | null; creator: string | null };
export async function createShareLink(projectId: string, userId: string, kind: "dashboard" | "mcp", targetId: string | null, label = "") {
  if (kind === "dashboard") await getDashboard(projectId, userId, targetId ?? "");
  const token = randomBytes(18).toString("base64url");
  await query("INSERT INTO cx_share_links(token,project_id,kind,target_id,label,created_by) VALUES($1,$2,$3,$4,$5,$6)", [token, projectId, kind, targetId, label.slice(0, 100), userId]);
  return token;
}
export async function listShareLinks(projectId: string, kind: "dashboard" | "mcp", targetId?: string) {
  return query<ShareLink>(
    `SELECT s.token,s.kind,s.target_id,s.label,s.created_at,s.last_used_at,COALESCE(NULLIF(u.name,''),u.email) AS creator FROM cx_share_links s LEFT JOIN users u ON u.id=s.created_by
     WHERE s.project_id=$1 AND s.kind=$2 AND s.revoked_at IS NULL AND ($3::text IS NULL OR s.target_id=$3) ORDER BY s.created_at DESC`,
    [projectId, kind, targetId ?? null],
  );
}
export async function revokeShareLink(projectId: string, token: string) {
  await query("UPDATE cx_share_links SET revoked_at=now() WHERE token=$1 AND project_id=$2", [token, projectId]);
}
/** Resolves an unrevoked token (no sign-in); records last use. */
export async function resolveShareLink(token: string, kind: "dashboard" | "mcp") {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  const [r] = await query<{ project_id: string; target_id: string | null }>("UPDATE cx_share_links SET last_used_at=now() WHERE token=$1 AND kind=$2 AND revoked_at IS NULL RETURNING project_id,target_id", [token, kind]);
  return r ?? null;
}
/** A shared dashboard for the public page (no user scoping: the token is the credential). */
export async function sharedDashboard(token: string) {
  const link = await resolveShareLink(token, "dashboard");
  if (!link?.target_id) return null;
  const [d] = await query<Dashboard & { brand: string }>("SELECT d.*, p.name AS brand, NULL AS creator FROM cx_dashboards d JOIN projects p ON p.id=d.project_id WHERE d.id=$1 AND d.project_id=$2", [link.target_id, link.project_id]);
  return d ?? null;
}
