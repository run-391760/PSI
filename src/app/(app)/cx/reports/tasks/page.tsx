import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { taskLink } from "@/lib/cx/ops/tasks";
import { TASK_STATUSES } from "@/lib/cx/ops/model";
import { reportContext } from "@/lib/cx/reports/data";
import { engagementBase, taskReportView } from "@/lib/cx/reports/engagement";
import { PRIORITY_LABEL, TASK_STATUS_COLOR, taskScope } from "@/lib/cx/reports/engagement-model";
import { dhm, dmy, rangeDays, rangeLabel, type DrillSpec } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { ColumnChartK, DrillTableK, IntervalSelect, PieChartK, StatsColumn, TileRow, Widget, type KCell } from "@/components/cx/reports/kit";

export const metadata: Metadata = { title: "Task Report" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TaskReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  // view=all|mine picks the report; legacy links used scope=all|mine, which now belongs to the cluster picker.
  const legacy = one(sp.scope) === "mine" || one(sp.scope) === "all" ? one(sp.scope) : "";
  const scope = taskScope(one(sp.view) || legacy);
  const mine = scope === "mine";
  const title = mine ? "My Task Report" : "All Task Report";
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title={title} />;
  const ctx = await reportContext(brand, legacy ? { ...sp, scope: undefined } : sp);
  const v = await taskReportView(ctx, mine ? user.id : null);
  const base = engagementBase(ctx, "tasks", mine ? { dims: { mine: user.id } } : {});
  const range = rangeLabel(ctx.filters.range);
  const who = mine ? "My tasks" : "All tasks";
  const drill = (dims: Record<string, string>, label: string): DrillSpec => ({ ...base, dims: { ...(base.dims ?? {}), ...dims }, title: `${who} · ${label} · ${range}` });
  const statusSeries = TASK_STATUSES.map((s) => ({ key: s.id, label: s.label, color: TASK_STATUS_COLOR[s.id] }));
  const t = v.tiles;

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="tasks"
      title={title}
      description={mine ? "Tasks assigned to you, by the date they were created." : "Every task of the brand, by the date it was created."}
      source="Source: stored tasks"
      filters={{ scope: false, media: false }}
    >
      {v.empty ? (
        <ReportEmpty
          brand={brand.id}
          kind="tasks"
          what={
            v.everHadTasks
              ? `No ${mine ? "tasks assigned to you were" : "tasks were"} created in ${range}. The task report counts tasks by the date they were created.`
              : `The task report shows task volume, status, priority, ${mine ? "" : "assignees, "}classifications and overdue work once tasks exist.`
          }
        />
      ) : (
        <>
          <Widget id="cx-reports.tasks.tiles" title="Task Statistics" bare table={{ columns: ["Metric", "Tasks"], rows: [["Total", t.total], ["Active", t.active], ...TASK_STATUSES.map((s) => [s.label, t.byStatus[s.id]] as [string, number]), ["Overdue", t.overdue]] }}>
            <TileRow
              cols={4}
              tiles={[
                { key: "total", label: "Total tasks", value: t.total.toLocaleString("en-US"), change: v.change.total, drill: drill({}, "Total") },
                { key: "active", label: "Active", value: t.active.toLocaleString("en-US"), info: "Not done or cancelled", drill: drill({ status: "open_all" }, "Active") },
                ...TASK_STATUSES.map((s) => ({ key: s.id, label: s.label, value: t.byStatus[s.id].toLocaleString("en-US"), seriesKey: s.id, drill: drill({ status: s.id }, s.label), ...(s.id === "done" ? { change: v.change.done } : {}) })),
                { key: "overdue", label: "Overdue", value: t.overdue.toLocaleString("en-US"), change: v.change.overdue, upIsGood: false, info: "Past the due date and not done or cancelled", drill: drill({ due: "overdue" }, "Overdue") },
              ]}
            />
          </Widget>

          <Widget
            id="cx-reports.tasks.trend"
            title="Tasks Created Over Time"
            info="Tasks created in each period, split by their current status."
            actions={<IntervalSelect value={ctx.filters.interval} />}
            table={{ columns: ["Period", ...statusSeries.map((s) => s.label)], rows: v.trend.map((r) => [dmy(r.key), ...statusSeries.map((s) => Number(r[s.key] ?? 0))]) }}
            insight={{ metric: "Tasks created", range, rows: v.trend.map((r) => ({ key: r.key, value: statusSeries.reduce((s, x) => s + Number(r[x.key] ?? 0), 0) })), total: t.total, previous: null }}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
              <StatsColumn
                title={who}
                items={[
                  { label: "Tasks created", value: t.total.toLocaleString("en-US"), drill: drill({}, "Total") },
                  { label: "Average per day", value: (Math.round((t.total / rangeDays(ctx.filters.range)) * 10) / 10).toLocaleString("en-US") },
                  { label: "Completion rate", value: t.completionRate == null ? "n/a" : `${t.completionRate.toFixed(1)} %`, drill: drill({ status: "done" }, "Done") },
                  { label: "Avg time to complete", value: dhm(t.avgCompleteSeconds) },
                ]}
              />
              <ColumnChartK data={v.trend} series={statusSeries} drill={{ base, series: "dims.status", x: "bucket" }} xFormat="day" interval={ctx.filters.interval} yLabel="Number of tasks" height={300} />
            </div>
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.tasks.status"
              title="Tasks by Status"
              table={{ columns: ["Status", "Tasks"], rows: TASK_STATUSES.map((s) => [s.label, t.byStatus[s.id]]) }}
              insight={{ metric: "Tasks by status", range, rows: TASK_STATUSES.map((s) => ({ key: s.label, value: t.byStatus[s.id] })), total: t.total, previous: null }}
            >
              <PieChartK donut centerLabel="Tasks" slices={statusSeries.map((s) => ({ ...s, value: t.byStatus[s.key] }))} drill={{ base, series: "dims.status" }} height={270} />
            </Widget>
            <Widget
              id="cx-reports.tasks.priority"
              title="Tasks by Priority"
              table={{ columns: ["Priority", ...statusSeries.map((s) => s.label), "Total"], rows: v.byPriority.map((r) => [PRIORITY_LABEL[r.key] ?? r.key, ...statusSeries.map((s) => Number(r[s.key] ?? 0)), r.total]) }}
              insight={{ metric: "Tasks by priority", range, rows: v.byPriority.map((r) => ({ key: PRIORITY_LABEL[r.key] ?? r.key, value: r.total })), total: t.total, previous: null }}
            >
              <ColumnChartK data={v.byPriority} catLabels={PRIORITY_LABEL} series={statusSeries} drill={{ base, series: "dims.status", x: "dims.priority" }} yLabel="Number of tasks" height={270} />
            </Widget>
          </div>

          {!mine && (
            <Widget
              id="cx-reports.tasks.assignee"
              title="Tasks by Assignee"
              info="Click a number to see the tasks behind it."
              table={{ columns: ["Assignee", "Total", ...statusSeries.map((s) => s.label), "Overdue"], rows: v.byAssignee.map((a) => [a.name, a.total, ...statusSeries.map((s) => a.byStatus[s.key]), a.overdue]) }}
              insight={{ metric: "Tasks per assignee", range, rows: v.byAssignee.map((a) => ({ key: a.name, value: a.total })), total: t.total, previous: null }}
            >
              <DrillTableK
                columns={[{ label: "Assignee" }, { label: "Total" }, ...statusSeries.map((s) => ({ label: s.label })), { label: "Overdue" }]}
                rows={v.byAssignee.map((a): KCell[] => [
                  { v: a.name },
                  { v: a.total.toLocaleString("en-US"), drill: drill({ assignee: a.key }, a.name) },
                  ...statusSeries.map((s) => ({ v: a.byStatus[s.key].toLocaleString("en-US"), drill: a.byStatus[s.key] ? drill({ assignee: a.key, status: s.key }, `${a.name} · ${s.label}`) : null })),
                  { v: a.overdue.toLocaleString("en-US"), drill: a.overdue ? drill({ assignee: a.key, due: "overdue" }, `${a.name} · Overdue`) : null },
                ])}
              />
            </Widget>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.tasks.classification"
              title="Tasks by Classification"
              table={{ columns: ["Classification", "Tasks"], rows: v.byClassification.map((c) => [c.label, c.count]) }}
              insight={{ metric: "Tasks by classification", range, rows: v.byClassification.map((c) => ({ key: c.label, value: c.count })), total: t.total, previous: null }}
            >
              <ColumnChartK
                horizontal
                data={v.byClassification.map((c) => ({ key: c.key, count: c.count }))}
                catLabels={Object.fromEntries(v.byClassification.map((c) => [c.key, c.label]))}
                series={[{ key: "count", label: "Tasks", color: "var(--series-1)" }]}
                drill={{ base, x: "dims.classification" }}
                shared={false}
                height={Math.max(160, v.byClassification.length * 34 + 40)}
              />
            </Widget>
            <Widget
              id="cx-reports.tasks.overdue"
              title="Overdue Tasks"
              info="Tasks created in the period that are past their due date and not done or cancelled, most overdue first."
              table={{ columns: ["Task", "Title", "Assignee", "Priority", "Due", "Overdue by"], rows: v.overdue.map((o) => [`#${o.number}`, o.title, o.assignee ?? "Unassigned", PRIORITY_LABEL[o.priority] ?? o.priority, o.dueAt ? dmy(o.dueAt) : "n/a", dhm(o.overdueSeconds)]) }}
            >
              <div className="max-h-[360px] overflow-y-auto">
                <DrillTableK
                  empty="Nothing overdue. Well done."
                  columns={[{ label: "Task" }, { label: mine ? "Priority" : "Assignee", align: "left" }, { label: "Overdue by" }]}
                  rows={v.overdue.map((o): KCell[] => [
                    {
                      v: (
                        <Link href={taskLink(brand.id, o.id)} className="block max-w-[260px] truncate hover:text-link hover:underline" title={o.title}>
                          <span className="text-text-3">#{o.number}</span> {o.title || "Untitled task"}
                        </Link>
                      ),
                    },
                    { v: mine ? (PRIORITY_LABEL[o.priority] ?? o.priority) : (o.assignee ?? "Unassigned"), align: "left" },
                    { v: <span className="text-critical-ink">{dhm(o.overdueSeconds)}</span>, drill: { ...base, dims: { ...(base.dims ?? {}), id: o.id }, title: `Task #${o.number} · Overdue by ${dhm(o.overdueSeconds)}` } },
                  ])}
                />
              </div>
            </Widget>
          </div>
        </>
      )}
    </ReportFrame>
  );
}
