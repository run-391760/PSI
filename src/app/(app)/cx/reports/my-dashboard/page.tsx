import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { engagementBase, myDashboardView } from "@/lib/cx/reports/engagement";
import { dmyTime, perDay, TICKET_STATUS_COLOR } from "@/lib/cx/reports/engagement-model";
import { dhm, dmy, rangeLabel, TICKET_TILES, type DrillSpec } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportFrame } from "@/components/cx/reports/frame";
import { ColumnChartK, IntervalSelect, PieChartK, StatsColumn, TileRow, Widget } from "@/components/cx/reports/kit";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { UserRound } from "lucide-react";

export const metadata: Metadata = { title: "My Dashboard" };
type SP = Record<string, string | string[] | undefined>;
const n = (x: number) => x.toLocaleString("en-US");

export default async function MyDashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="My Dashboard" />;
  const ctx = await reportContext(brand, sp);
  const v = await myDashboardView(ctx, user);
  const range = rangeLabel(ctx.filters.range);
  const base = engagementBase(ctx, "tickets", { agent: user.id });
  const taskBase = engagementBase(ctx, "tasks", { dims: { mine: user.id } });
  const anyBase = engagementBase(ctx, "tickets");
  const replied = (window: { from: string; to: string } | undefined, label: string): DrillSpec => ({ ...anyBase, ...(window ? { window } : {}), dims: { repliedBy: user.id }, title: `Tickets you replied to · ${label}` });
  const tk = (status: string, label: string): DrillSpec => ({ ...base, status, title: `My tickets · ${label} · ${range}` });
  const task = (dims: Record<string, string>, label: string): DrillSpec => ({ ...taskBase, dims: { mine: user.id, ...dims }, title: `My tasks · ${label} · ${range}` });
  const labels = Object.fromEntries(TICKET_TILES.map((t) => [t.id, t.label]));
  const statusSeries = v.statusKeys.map((k) => ({ key: k, label: labels[k], color: TICKET_STATUS_COLOR[k] }));
  const usedSeries = statusSeries.filter((s) => v.stats[s.key] > 0);
  const td = v.today;
  const at = (x: string | null) => (x ? dmyTime(x, ctx.offsetMin).slice(11) : "n/a");

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="my-dashboard"
      title="My Dashboard"
      description={`Your own numbers${user.name ? `, ${user.name}` : ""}: tickets assigned to you that were created in the period, your replies and your tasks.`}
      source="Source: stored tickets, messages and tasks"
      filters={{ scope: false, media: false }}
    >
      <Widget
        id="cx-reports.my-dashboard.today"
        title={`Today (${dmy(ctx.today)})`}
        bare
        table={{ columns: ["Metric", "Today"], rows: [["Replies", td.replies], ["Notes", td.notes], ["Assigned", td.assigned], ["Resolved", td.resolved], ["Closed", td.closed], ["Open now", v.openNow], ["Avg reply TAT", dhm(td.replyTat.avg)], ["First activity", at(td.firstActivity)], ["Last activity", at(td.lastActivity)]] }}
      >
        <TileRow
          cols={6}
          size="md"
          tiles={[
            { key: "t-replies", label: "Replies today", value: n(td.replies), info: `${td.notes} internal notes. Click for the tickets you replied to.`, drill: td.replies ? replied({ from: ctx.today, to: ctx.today }, dmy(ctx.today)) : null },
            { key: "t-assigned", label: "Assigned today", value: n(td.assigned), info: "Tickets assigned to you today (new or reassigned)" },
            { key: "t-resolved", label: "Resolved today", value: n(td.resolved) },
            { key: "t-closed", label: "Closed today", value: n(td.closed) },
            { key: "t-open", label: "Open now", value: n(v.openNow), info: "Your tickets not resolved, closed or ignored (created in the last year)", drill: v.openNow ? { ...base, dims: { unresolved: "1" }, title: "My unresolved tickets" } : null },
            { key: "t-tat", label: "Reply TAT today", value: dhm(td.replyTat.avg), info: td.firstActivity ? `First activity ${at(td.firstActivity)}, last ${at(td.lastActivity)}` : "No activity today yet" },
          ]}
        />
      </Widget>

      {v.empty ? (
        <Card>
          <EmptyState
            icon={<UserRound className="h-5 w-5" />}
            title="Nothing of yours in this period"
            description={`No tickets created in ${range} are assigned to you, and you sent no replies or got no tasks. Widen the date range, or pick up tickets in the inbox.`}
            action={<ButtonLink href={`/cx/inbox?brand=${encodeURIComponent(brand.id)}`} variant="primary">Open the inbox</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <Widget
            id="cx-reports.my-dashboard.period"
            title="Selected Period"
            bare
            table={{ columns: ["Metric", "Value"], rows: [["Assigned to me", v.stats.total], ["Replies sent", v.replies], ["Resolved", v.stats.solved], ["Closed", v.stats.closed], ["Average reply TAT", dhm(v.tat.average)], ["First reply TAT", dhm(v.tat.first)], ["First response time", dhm(v.frt.average)], ["Close TAT", dhm(v.closeTat.average)], ["Average replies", v.tat.averageReplies == null ? null : Math.round(v.tat.averageReplies * 100) / 100]] }}
          >
            <div className="space-y-3">
              <TileRow
                cols={4}
                tiles={[
                  { key: "p-total", label: "Assigned to me", value: n(v.stats.total), info: "Tickets created in the period that are assigned to you", drill: v.stats.total ? tk("total", "All") : null },
                  { key: "p-replies", label: "Replies sent", value: n(v.replies), info: `Replies you sent in the period on ${v.repliedTickets} tickets (any ticket), plus ${v.notes} internal notes`, drill: v.replies ? replied(undefined, range) : null },
                  { key: "solved", label: "Resolved", value: n(v.stats.solved), seriesKey: "solved", drill: v.stats.solved ? tk("solved", "Resolved") : null },
                  { key: "closed", label: "Closed", value: n(v.stats.closed), seriesKey: "closed", drill: v.stats.closed ? tk("closed", "Closed") : null },
                ]}
              />
              <TileRow
                cols={5}
                size="md"
                tiles={[
                  { key: "tat-avg", label: "Average reply TAT", value: dhm(v.tat.average), info: `Customer message to your team's reply, over ${v.tat.measured} replies on your tickets` },
                  { key: "tat-first", label: "First reply TAT", value: dhm(v.tat.first) },
                  { key: "frt", label: "First response time", value: dhm(v.frt.average), info: v.frt.n ? `Ticket created to first response, ${v.frt.n} tickets` : "No first responses yet" },
                  { key: "close", label: "Close TAT", value: dhm(v.closeTat.average), info: v.closeTat.n ? `Ticket created to resolved, ${v.closeTat.n} tickets` : "None of these tickets is resolved yet" },
                  { key: "avg-replies", label: "Average replies", value: v.tat.averageReplies == null ? "n/a" : v.tat.averageReplies.toFixed(2), info: "Team replies per ticket that got a reply" },
                ]}
              />
            </div>
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
            <Widget
              id="cx-reports.my-dashboard.activity"
              title="My Activity Over Time"
              info="Your tickets by the period they were created, split by their current status."
              actions={<IntervalSelect value={ctx.filters.interval} />}
              table={{ columns: ["Period", ...statusSeries.map((s) => s.label), "Replies sent"], rows: v.activity.map((r) => [dmy(r.key), ...statusSeries.map((s) => Number(r[s.key] ?? 0)), Number(r.replies ?? 0)]) }}
              insight={{ metric: "My tickets", range, rows: v.activity.map((r) => ({ key: r.key, value: statusSeries.reduce((x, s) => x + Number(r[s.key] ?? 0), 0) })), total: v.stats.total, previous: null }}
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
                <StatsColumn
                  title="Me"
                  items={[
                    { label: "Tickets", value: n(v.stats.total), drill: v.stats.total ? tk("total", "All") : null },
                    { label: "Per day", value: perDay(v.stats.total, ctx.filters.range).toLocaleString("en-US") },
                    { label: "Replies sent", value: n(v.replies), drill: v.replies ? replied(undefined, range) : null },
                    { label: "Replies per day", value: perDay(v.replies, ctx.filters.range).toLocaleString("en-US") },
                  ]}
                />
                <ColumnChartK data={v.activity} series={usedSeries.length ? usedSeries : statusSeries} drill={{ base, series: "status", x: "bucket" }} xFormat="day" interval={ctx.filters.interval} yLabel="Number of tickets" height={290} />
              </div>
            </Widget>
            <Widget
              id="cx-reports.my-dashboard.status"
              title="My Tickets by Status"
              table={{ columns: ["Status", "Tickets"], rows: statusSeries.map((s) => [s.label, v.stats[s.key]]) }}
              insight={{ metric: "My tickets by status", range, rows: statusSeries.map((s) => ({ key: s.label, value: v.stats[s.key] })), total: v.stats.total, previous: null }}
            >
              <PieChartK donut centerLabel="Tickets" slices={statusSeries.map((s) => ({ ...s, value: v.stats[s.key] }))} drill={{ base, series: "status" }} height={290} labels={false} />
            </Widget>
          </div>

          <Widget
            id="cx-reports.my-dashboard.tasks"
            title="My Tasks"
            info="Tasks assigned to you that were created in the period."
            actions={<ButtonLink href={`/cx/reports/tasks?brand=${encodeURIComponent(brand.id)}&view=mine&from=${ctx.filters.range.from}&to=${ctx.filters.range.to}`} size="sm">My Task Report</ButtonLink>}
            table={{ columns: ["Metric", "Tasks"], rows: [["Total", v.tasks.total], ["Active", v.tasks.active], ["Done", v.tasks.byStatus.done], ["Overdue", v.tasks.overdue]] }}
          >
            <TileRow
              cols={4}
              size="md"
              tiles={[
                { key: "k-total", label: "Tasks", value: n(v.tasks.total), drill: v.tasks.total ? task({}, "All") : null },
                { key: "k-active", label: "Active", value: n(v.tasks.active), drill: v.tasks.active ? task({ status: "open_all" }, "Active") : null },
                { key: "k-done", label: "Done", value: n(v.tasks.byStatus.done), info: v.tasks.avgCompleteSeconds == null ? undefined : `Average time to complete ${dhm(v.tasks.avgCompleteSeconds)}`, drill: v.tasks.byStatus.done ? task({ status: "done" }, "Done") : null },
                { key: "k-overdue", label: "Overdue", value: n(v.tasks.overdue), drill: v.tasks.overdue ? task({ due: "overdue" }, "Overdue") : null },
              ]}
            />
          </Widget>
        </>
      )}
    </ReportFrame>
  );
}
