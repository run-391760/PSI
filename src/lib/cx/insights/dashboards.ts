import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { dayKeys } from "./metrics";
import { SOURCES, metricDef, type Widget, type WidgetResult } from "./widget-defs";
import { buildWidgetSql } from "./widget-sql";

export type Dashboard = { id: string; project_id: string; name: string; description: string; widgets: Widget[]; shared: boolean; created_by: string | null; creator: string | null; created_at: string; updated_at: string };

export const widgetInput = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1, "Title is required").max(100),
  source: z.enum(["tickets", "messages", "mentions", "surveys", "qa"]),
  metric: z.string().max(40),
  chart: z.enum(["kpi", "line", "bar", "donut", "table"]),
  groupBy: z.enum(["none", "date", "channel", "agent", "tag", "sentiment", "intent", "priority", "status", "direction", "survey", "scorecard"]),
  range: z.number().int().min(1).max(730),
  filters: z.object({ channel: z.string().max(60).optional(), sentiment: z.string().max(30).optional(), priority: z.string().max(20).optional(), status: z.string().max(20).optional(), tag: z.string().max(80).optional() }).default({}),
  size: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export const dashboardInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(300).default(""),
  shared: z.boolean().default(true),
  widgets: z.array(widgetInput).max(40).default([]),
});

/** Normalizes a widget so metric / grouping are valid for its source and chart. */
export function normalizeWidget(w: Widget): Widget {
  const src = SOURCES[w.source];
  const metric = src.metrics.some((m) => m.id === w.metric) ? w.metric : src.metrics[0].id;
  let groupBy = src.groups.includes(w.groupBy) ? w.groupBy : "none";
  if (w.chart === "kpi") groupBy = "none";
  else if (groupBy === "none") groupBy = w.chart === "line" ? "date" : src.groups[2] ?? "date";
  if (w.chart === "line" && groupBy !== "date") groupBy = "date";
  const filters = Object.fromEntries(Object.entries(w.filters ?? {}).filter(([k, v]) => v && src.filters.includes(k as never)));
  return { ...w, metric, groupBy, filters };
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
  await query("INSERT INTO cx_dashboards(id,project_id,name,description,widgets,shared,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [
    id,
    projectId,
    input.name,
    input.description,
    JSON.stringify(input.widgets.map((w) => normalizeWidget(w as Widget))),
    input.shared,
    userId,
  ]);
  return id;
}
export async function updateDashboard(projectId: string, userId: string, id: string, raw: Partial<z.input<typeof dashboardInput>>) {
  await getDashboard(projectId, userId, id);
  const input = dashboardInput.partial().parse(raw);
  await query(
    `UPDATE cx_dashboards SET name=COALESCE($3,name), description=COALESCE($4,description), shared=COALESCE($5,shared),
     widgets=COALESCE($6,widgets), updated_at=now() WHERE id=$1 AND project_id=$2`,
    [id, projectId, input.name ?? null, input.description ?? null, input.shared ?? null, input.widgets ? JSON.stringify(input.widgets.map((w) => normalizeWidget(w as Widget))) : null],
  );
}
export async function deleteDashboard(projectId: string, userId: string, id: string) {
  await getDashboard(projectId, userId, id);
  await query("DELETE FROM cx_dashboards WHERE id=$1 AND project_id=$2", [id, projectId]);
}

/** Executes a widget against stored records: grouped rows, the current total and the previous-period total. */
export async function runWidget(projectId: string, raw: Widget, now = new Date()): Promise<WidgetResult> {
  const w = normalizeWidget(raw);
  const to = now, from = new Date(now.getTime() - w.range * 86400000), prevFrom = new Date(from.getTime() - w.range * 86400000);
  try {
    const total = buildWidgetSql(w, projectId, from, to, false);
    const prev = buildWidgetSql(w, projectId, prevFrom, from, false);
    const [[t], [p]] = await Promise.all([query<{ value: number | null }>(total.sql, total.params), query<{ value: number | null }>(prev.sql, prev.params)]);
    let rows: { key: string; value: number | null }[] = [];
    if (w.groupBy !== "none") {
      const g = buildWidgetSql(w, projectId, from, to, true);
      rows = (await query<{ key: string; value: number | null }>(g.sql, g.params)).map((r) => ({ key: String(r.key ?? "unknown"), value: r.value == null ? null : Number(r.value) }));
      if (w.groupBy === "date" && w.range <= 120) {
        const by = new Map(rows.map((r) => [r.key, r.value]));
        const additive = metricDef(w)?.additive;
        rows = dayKeys(w.range, now).map((key) => ({ key, value: by.has(key) ? by.get(key)! : additive ? 0 : null }));
      }
    }
    const num = (v: unknown) => (v == null ? null : Number(v));
    return { rows, total: num(t?.value), previous: num(p?.value) };
  } catch (e) {
    return { rows: [], total: null, previous: null, error: e instanceof Error ? e.message : "Query failed" };
  }
}
