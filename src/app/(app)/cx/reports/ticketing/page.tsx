import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { drillBase } from "@/lib/cx/reports/listening";
import { dhm, dmy, FTR_LABEL, hourLabel, rangeLabel, TICKET_TILES, type FtrBucket } from "@/lib/cx/reports/model";
import { ticketingView } from "@/lib/cx/reports/ticketing";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { IntervalSelect, LineChartK, ParamSelect, PieChartK, StatsColumn, TileRow, Widget } from "@/components/cx/reports/kit";
import { TabsNav } from "@/components/ui/tabs";
import { LegacyTab } from "./legacy";

export const metadata: Metadata = { title: "Ticketing Report" };
type SP = Record<string, string | string[] | undefined>;
const TABS = [
  { id: "", label: "Overview" },
  { id: "sla", label: "SLA breaches" },
  { id: "performance", label: "User performance" },
  { id: "tat", label: "TAT analysis" },
] as const;
const FTR_ORDER: FtrBucket[] = ["first", "multi", "noreply", "open"];
const FTR_COLOR: Record<FtrBucket, string> = { first: "var(--series-3)", multi: "var(--series-4)", noreply: "var(--series-7)", open: "var(--series-1)" };

export default async function TicketingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Ticketing Report" />;
  const ctx = await reportContext(brand, sp);
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "";
  const keep = new URLSearchParams();
  for (const [k, val] of Object.entries(sp)) if (typeof val === "string" && k !== "tab") keep.set(k, val);
  const tabs = <TabsNav items={TABS.map((t) => ({ href: `/cx/reports/ticketing?${new URLSearchParams({ ...Object.fromEntries(keep), ...(t.id ? { tab: t.id } : {}) }).toString()}`, label: t.label, match: t.id }))} />;

  if (tab) {
    return (
      <ReportFrame ctx={ctx} switcher={switcher} page="ticketing" title="Ticketing Report" source="Source: stored tickets and messages" filters={{ scope: false, media: false }}>
        {tabs}
        <LegacyTab ctx={ctx} tab={tab} sp={sp} />
      </ReportFrame>
    );
  }

  const v = await ticketingView(ctx, sp);
  const base = drillBase(ctx, "tickets");
  const range = rangeLabel(ctx.filters.range);
  const tatTiles = [
    { key: "avg", label: "Average reply TAT", value: v.tat.average, replies: 1 },
    { key: "first", label: "First reply TAT", value: v.tat.first, replies: 1 },
    { key: "second", label: "Second reply TAT", value: v.tat.second, replies: 2 },
    { key: "third", label: "Third reply TAT", value: v.tat.third, replies: 3 },
  ];
  const profOptions = [{ value: "", label: ctx.scope.isDefault ? `All of ${brand.name}` : "All selected" }, ...v.profiles.map((p) => ({ value: p.id, label: p.name }))];

  return (
    <ReportFrame ctx={ctx} switcher={switcher} page="ticketing" title="Ticketing Report" source="Source: stored tickets and messages" mediaOptions={v.mediaOptions} filters={{ scope: true, media: true, basis: true }}>
      {tabs}
      {v.empty ? (
        <ReportEmpty brand={brand.id} kind="tickets" what="The Ticketing Report counts tickets by status, measures reply turnaround and first-time resolution, and trends tickets per profile." />
      ) : (
        <>
          <Widget id="cx-reports.ticketing.stats" title="Ticket Statistics" bare table={{ columns: ["Status", "Tickets"], rows: TICKET_TILES.map((t) => [t.label, v.stats[t.id]]) }}>
            <TileRow
              cols={6}
              center
              size="md"
              tiles={TICKET_TILES.map((t) => ({
                key: t.id,
                label: t.label,
                value: v.stats[t.id].toLocaleString("en-US"),
                info: t.info,
                drill: { ...base, ...(t.id === "total" ? {} : { status: t.id }), title: `${t.label} · ${range}` },
              }))}
            />
          </Widget>

          <Widget
            id="cx-reports.ticketing.tat"
            title="Reply TAT"
            bare
            table={{ columns: ["Measure", "Value"], rows: [...tatTiles.map((t) => [t.label, dhm(t.value)]), ["Average replies", v.tat.averageReplies == null ? null : Math.round(v.tat.averageReplies * 10) / 10]] }}
          >
            <TileRow
              cols={5}
              center
              size="md"
              tiles={[
                ...tatTiles.map((t) => ({
                  key: t.key,
                  label: t.label,
                  value: dhm(t.value),
                  info: "Customer message → next agent reply, calendar time. Click to see the tickets measured.",
                  drill: t.value == null ? null : { ...base, dims: { replies: String(t.replies) }, title: `${t.label} · tickets measured` },
                })),
                { key: "replies", label: "Average replies", value: v.tat.averageReplies == null ? "n/a" : (Math.round(v.tat.averageReplies * 10) / 10).toLocaleString("en-US"), info: "Agent replies per ticket that got at least one reply", drill: v.tat.averageReplies == null ? null : { ...base, dims: { replies: "1" }, title: "Tickets with replies" } },
              ]}
            />
          </Widget>

          <Widget
            id="cx-reports.ticketing.trend"
            title="Ticket Trend"
            info={v.profiles.length >= 8 ? "The 8 profiles with the most tickets." : undefined}
            actions={
              <>
                <IntervalSelect value={ctx.filters.interval} />
                <ParamSelect param="tp" value={v.trendStats.profile} options={profOptions} label="Stats for" />
              </>
            }
            table={{ columns: ["Period", ...v.profiles.map((p) => p.name)], rows: v.trend.map((r) => [dmy(String(r.key)), ...v.profiles.map((p) => Number(r[p.id] ?? 0))]) }}
            insight={{ metric: "Tickets created", range, rows: v.trend.map((r) => ({ key: String(r.key), value: v.profiles.reduce((s, p) => s + Number(r[p.id] ?? 0), 0) })), total: v.total, previous: null }}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
              <StatsColumn
                title={v.trendStats.name}
                items={[
                  { label: "Total tickets", value: v.trendStats.total.toLocaleString("en-US"), drill: { ...base, profile: v.trendStats.profile || undefined, title: `${v.trendStats.name} · ${range}` } },
                  { label: "Average tickets per day", value: v.trendStats.avgPerDay.toLocaleString("en-US") },
                  { label: "Peak date", value: v.trendStats.peakDate ? dmy(v.trendStats.peakDate) : "n/a", drill: v.trendStats.peakDate ? { ...base, profile: v.trendStats.profile || undefined, bucket: v.trendStats.peakDate, interval: "day", title: `${v.trendStats.name} · ${dmy(v.trendStats.peakDate)}` } : null },
                  { label: "Peak time", value: hourLabel(v.trendStats.peakHour) },
                ]}
              />
              <LineChartK data={v.trend} series={v.profiles.map((p) => ({ key: p.id, label: p.name }))} drill={{ base, series: "profile", x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of tickets" height={300} />
            </div>
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.ticketing.ftr"
              title="First Time Resolution"
              info="Resolved tickets that needed exactly one agent reply and were never reopened, as a share of resolved tickets that got a reply."
              table={{ columns: ["Bucket", "Tickets"], rows: FTR_ORDER.map((k) => [FTR_LABEL[k], v.ftr.counts[k]]) }}
            >
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[28px] font-light text-text tabular">{v.ftr.rate == null ? "n/a" : `${v.ftr.rate.toFixed(1)} %`}</span>
                <span className="text-[11.5px] font-medium tracking-[0.08em] text-text-2 uppercase">First time resolution rate</span>
              </div>
              <PieChartK slices={FTR_ORDER.map((k) => ({ key: `ftr-${k}`, dim: k, label: FTR_LABEL[k], value: v.ftr.counts[k], color: FTR_COLOR[k] }))} drill={{ base, series: "ftr" }} donut centerLabel="tickets" height={260} labels={false} />
            </Widget>
            <Widget id="cx-reports.ticketing.tracker" title="Ticket Tracker" table={{ columns: ["Status", "Tickets"], rows: v.tracker.map((t) => [t.label, t.value]) }}>
              <PieChartK slices={v.tracker.map((t, i) => ({ key: `st-${t.key}`, dim: t.dim, label: t.label, value: t.value, color: `var(--series-${i + 1})` })).filter((t) => t.value > 0)} drill={{ base, series: "status" }} donut centerLabel="total tickets" height={300} labels={false} />
            </Widget>
          </div>
        </>
      )}
    </ReportFrame>
  );
}
