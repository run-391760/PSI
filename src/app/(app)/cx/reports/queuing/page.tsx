import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { engagementBase, queueReportView } from "@/lib/cx/reports/engagement";
import { dmyTime } from "@/lib/cx/reports/engagement-model";
import { dhm, dmy, rangeLabel, type DrillSpec } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportFrame } from "@/components/cx/reports/frame";
import { ColumnChartK, DrillTableK, IntervalSelect, StatsColumn, TileRow, Widget, type KCell } from "@/components/cx/reports/kit";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Queuing Report" };
type SP = Record<string, string | string[] | undefined>;

const STATUS_TONE: Record<string, Tone> = { available: "good", break: "warning", offline: "neutral" };
const STATUS_LABEL: Record<string, string> = { available: "Available", break: "Break", offline: "Offline" };
const removeLabel = (s: string) => ({ pending: "Pending", on_hold: "On hold", solved: "Resolved", closed: "Closed", wip: "WIP", follow_up: "Follow up" })[s] ?? s;

export default async function QueuingReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Queuing Report" />;
  const ctx = await reportContext(brand, sp);
  const v = await queueReportView(ctx);
  const range = rangeLabel(ctx.filters.range);
  const at = (v: string) => dmyTime(v, ctx.offsetMin);
  const base = engagementBase(ctx, "tickets");
  const settingsHref = `/cx/settings/queue?brand=${encodeURIComponent(brand.id)}`;
  const st = v.settings;
  const waitingDrill: DrillSpec | null = v.waiting.count && v.waiting.window ? { ...base, window: v.waiting.window, status: "assign_pending", title: "Waiting in the queue now" } : null;
  // Queue dimension for the drill (tickets queued / assigned in a bucket by cx_admin_ticket_state times).
  const queueBase = { ...base, dims: { queue: "queued" } };
  const settingsRows: [string, string][] = [
    ["Queue", st.enabled ? "On" : "Off"],
    ["Assignment", st.assignment],
    ["Max tickets per agent", String(st.maxPerAgent)],
    ["Return unworked tickets", st.resetOnStatus ? (st.resetAfterMinutes ? `When an agent leaves "available", after ${st.resetAfterMinutes} min` : `When an agent leaves "available"`) : "Never"],
    ["Clean up waiting tickets", st.cleanupMinutes ? `After ${st.cleanupMinutes} min` : "Never"],
    ["Remove from queue on", st.removeOn.length ? st.removeOn.map(removeLabel).join(", ") : "n/a"],
    ["Segments", st.segments ? String(st.segments) : "None"],
    ["Office hours by timezone", st.byTimezone ? "Yes" : "No"],
  ];

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="queuing"
      title="Queuing Report"
      description="How tickets wait for and get assigned through the assignment queue, and agent availability."
      source="Source: stored queue state and agent status log"
      filters={{ scope: false, media: false }}
      actions={<ButtonLink href={settingsHref} size="sm">Queue settings</ButtonLink>}
    >
      {!st.enabled && (
        <Callout tone="warning" title="The assignment queue is off" action={<ButtonLink href={settingsHref} size="sm" variant="primary">Turn on the queue</ButtonLink>}>
          New tickets are not queued or auto-assigned. {v.hasHistory ? "The history below is from when the queue was on." : "Turn it on in Settings → Queue to start collecting queue history."}
        </Callout>
      )}

      <Widget id="cx-reports.queuing.tiles" title="Queue Now" bare table={{ columns: ["Metric", "Value"], rows: [["Waiting now", v.waiting.count], ["Oldest wait", dhm(v.waiting.oldestSeconds)], ["Assigned, still in queue", v.inQueueAssigned], ["Queued in period", v.totals.queued], ["Assigned in period", v.totals.assigned], ["Average wait to assign", dhm(v.wait.average)]] }}>
        <TileRow
          cols={3}
          size="md"
          tiles={[
            { key: "waiting", label: "Waiting now", value: v.waiting.count.toLocaleString("en-US"), info: "In the queue with no assignee", drill: waitingDrill },
            { key: "oldest", label: "Oldest wait", value: dhm(v.waiting.oldestSeconds), info: "Time since the longest-waiting ticket was queued", drill: waitingDrill },
            { key: "agents", label: "Agents available", value: `${v.agentStatus.available} / ${v.agents.length}`, info: `${v.agentStatus.break} on a break, ${v.agentStatus.offline} offline` },
            { key: "queued", label: "Queued in period", value: v.totals.queued.toLocaleString("en-US"), info: "Tickets that entered the queue in the period (latest queue entry per ticket)", drill: v.totals.queued ? { ...queueBase, title: `Queued · ${range}` } : null },
            { key: "assigned", label: "Assigned from queue", value: v.totals.assigned.toLocaleString("en-US"), drill: v.totals.assigned ? { ...base, dims: { queue: "assigned" }, title: `Assigned from queue · ${range}` } : null },
            { key: "wait", label: "Avg wait to assign", value: dhm(v.wait.average), info: v.wait.n ? `Median ${dhm(v.wait.median)}, longest ${dhm(v.wait.longest)} over ${v.wait.n} assignments` : "No assignments from the queue in the period" },
          ]}
        />
      </Widget>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Widget
          id="cx-reports.queuing.trend"
          title="Queued and Assigned Over Time"
          info="Tickets entering the queue (queued time) and leaving it with an agent (assigned time). A ticket returned to the queue counts at its latest queue entry."
          actions={<IntervalSelect value={ctx.filters.interval} />}
          table={{ columns: ["Period", "Queued", "Assigned"], rows: v.trend.map((r) => [dmy(r.key), r.queued, r.assigned]) }}
          insight={{ metric: "Tickets queued", range, rows: v.trend.map((r) => ({ key: r.key, value: r.queued })), total: v.totals.queued, previous: null }}
        >
          {v.totals.queued + v.totals.assigned === 0 ? (
            <p className="flex h-full min-h-48 items-center justify-center text-center text-[13px] text-text-3">No tickets were queued or assigned from the queue in {range}.</p>
          ) : (
            <ColumnChartK
              data={v.trend}
              series={[{ key: "queued", label: "Queued" }, { key: "assigned", label: "Assigned" }]}
              mode="grouped"
              drill={{ base: queueBase, series: "dims.queue", x: "bucket" }}
              xFormat="day"
              interval={ctx.filters.interval}
              yLabel="Number of tickets"
              height={290}
            />
          )}
        </Widget>
        <Widget id="cx-reports.queuing.settings" title="Queue Settings" table={{ columns: ["Setting", "Value"], rows: settingsRows }} actions={<Badge tone={st.enabled ? "good" : "neutral"}>{st.enabled ? "On" : "Off"}</Badge>}>
          <dl className="divide-y divide-border text-[13px]">
            {settingsRows.slice(1).map(([k, val]) => (
              <div key={k} className="flex items-start justify-between gap-3 py-2">
                <dt className="text-text-2">{k}</dt>
                <dd className="text-right font-medium text-text">{val}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <StatsColumn items={[{ label: "Assigned, still in queue", value: v.inQueueAssigned.toLocaleString("en-US") }, { label: "Median wait to assign", value: dhm(v.wait.median) }]} />
          </div>
        </Widget>
      </div>

      <Widget
        id="cx-reports.queuing.agents"
        title="Queue Agents"
        info="Live status, queued tickets they are working on (load) against their capacity, and whether an admin paused their queue."
        table={{ columns: ["Agent", "Team", "Status", "Since", "Load", "Capacity", "Paused", "Last assigned"], rows: v.agents.map((a) => [a.name, a.team, a.statusName, at(a.since), a.load, a.capacity, a.paused ? "Yes" : "No", a.lastAssignedAt ? at(a.lastAssignedAt) : null]) }}
      >
        <DrillTableK
          empty="No agents in this brand yet. Invite team members in Settings → Users."
          columns={[{ label: "Agent" }, { label: "Status", align: "left" }, { label: "Since", align: "left" }, { label: "Load / capacity" }, { label: "Paused" }, { label: "Last assigned", align: "left" }]}
          rows={v.agents.map((a): KCell[] => [
            { v: <span className="block max-w-[200px] truncate" title={a.team ? `${a.name} · ${a.team}` : a.name}>{a.name}{a.team && <span className="ml-1 text-[12px] font-normal text-text-3">{a.team}</span>}</span> },
            { v: <Badge tone={a.overrun ? "critical" : STATUS_TONE[a.status]} title={a.overrun ? "Over the break limit" : undefined}>{a.statusName || STATUS_LABEL[a.status]}</Badge>, align: "left" },
            { v: <span className="text-text-2">{at(a.since)}</span>, align: "left" },
            { v: <span className={a.load >= a.capacity ? "font-semibold text-warning-ink" : undefined}>{a.load} / {a.capacity}</span> },
            { v: a.paused ? <Badge tone="warning">Paused</Badge> : "No" },
            { v: a.lastAssignedAt ? at(a.lastAssignedAt) : "n/a", align: "left" },
          ])}
        />
      </Widget>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Widget
          id="cx-reports.queuing.breaks"
          title="Break Time by Agent"
          info="Time agents spent on a break status (anything other than available or offline) in the period."
          table={{ columns: ["Agent", "Breaks", "Total", "Longest"], rows: v.breaks.map((b) => [b.name, b.sessions, dhm(b.total), dhm(b.longest)]) }}
        >
          <DrillTableK
            empty="No breaks logged in this period."
            columns={[{ label: "Agent" }, { label: "Breaks" }, { label: "Total" }, { label: "Longest" }]}
            rows={v.breaks.map((b): KCell[] => [{ v: b.name }, { v: b.sessions.toLocaleString("en-US") }, { v: dhm(b.total) }, { v: dhm(b.longest) }])}
          />
        </Widget>
        <Widget
          id="cx-reports.queuing.log"
          title="Status Log"
          info="Agent status changes that overlap the period, newest first."
          table={{ columns: ["Agent", "Status", "Started", "Ended", "Duration"], rows: v.log.map((l) => [l.name, l.status, at(l.started_at), l.ended_at ? at(l.ended_at) : "ongoing", dhm(l.seconds)]) }}
        >
          <div className="max-h-[360px] overflow-y-auto">
            <DrillTableK
              empty="No status changes in this period."
              columns={[{ label: "Agent" }, { label: "Status", align: "left" }, { label: "Started", align: "left" }, { label: "Duration" }]}
              rows={v.log.map((l): KCell[] => [
                { v: l.name },
                { v: <Badge tone={l.isBreak ? "warning" : /^available$/i.test(l.status) ? "good" : "neutral"}>{l.status}</Badge>, align: "left" },
                { v: <span className="text-text-2">{at(l.started_at)}</span>, align: "left" },
                { v: l.open ? <span title="Still in this status">{dhm(l.seconds)} (ongoing)</span> : dhm(l.seconds) },
              ])}
            />
          </div>
        </Widget>
      </div>
    </ReportFrame>
  );
}
