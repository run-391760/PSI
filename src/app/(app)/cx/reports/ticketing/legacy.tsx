import { Grid } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { IntervalSelect, ParamSelect } from "@/components/cx/reports/kit";
import { humanDuration } from "@/lib/cx/insights/metrics";
import { breachReport, hoursCfg, loadReportData, tatReport, userPerformance } from "@/lib/cx/insights/reports";
import type { Basis, Interval } from "@/lib/cx/insights/reports-math";
import type { ReportCtx } from "@/lib/cx/reports/data";
import { num } from "@/lib/format";

/**
 * The detailed ticket reports that lived on the old /cx/reports tabs (SLA breaches, user performance, TAT
 * analysis), kept with their behaviour under Ticketing Report → tabs, on the report's date range.
 */
const d = humanDuration;
const pctS = (x: number | null) => (x == null ? "n/a" : `${x.toFixed(0)}%`);
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function LegacyTab({ ctx, tab, sp }: { ctx: ReportCtx; tab: "sla" | "performance" | "tat"; sp: SP }) {
  const off = ctx.offsetMin * 60000;
  const from = new Date(Date.parse(`${ctx.filters.range.from}T00:00:00Z`) - off);
  const to = new Date(Date.parse(`${ctx.filters.range.to}T23:59:59.999Z`) - off);
  const interval = ctx.filters.interval as Interval;
  const data = await loadReportData(ctx.brandId, from, to);

  if (tab === "sla") {
    const rows = breachReport(data.tickets, from, new Date());
    const breached = rows.reduce((s, r) => s + r.breached, 0);
    return (
      <>
        {!data.policies && <Callout title="No SLA policies">Set first-response and resolution targets in CX settings → Team &amp; SLAs; breaches are measured against them.</Callout>}
        <Card>
          <CardBody className="py-4">
            <MetricStrip>
              <Metric label="Targets breached" value={num(breached)} />
              <Metric label="First response breached" value={num(rows.reduce((s, r) => s + r.frBreached, 0))} />
              <Metric label="Resolution breached" value={num(rows.reduce((s, r) => s + r.resBreached, 0))} />
              <Metric label="Agents with breaches" value={num(rows.filter((r) => r.breached > 0).length)} />
            </MetricStrip>
          </CardBody>
        </Card>
        <Grid cols={2}>
          <Card>
            <CardHeader title="Agent-wise SLA breaches" description="Tickets created in the selected range" />
            <CardBody>
              {breached ? (
                <BarChart data={rows.filter((r) => r.breached).slice(0, 15)} xKey="agent" layout="bars" stacked series={[{ key: "frBreached", label: "First response" }, { key: "resBreached", label: "Resolution" }]} height={Math.max(160, Math.min(15, rows.filter((r) => r.breached).length) * 30 + 50)} categoryWidth={130} showLegend />
              ) : (
                <p className="py-12 text-center text-[13px] text-text-3">No breaches in this range.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Breach rate by agent" />
            <CardBody className="pt-1">
              <MiniTable
                columns={[{ header: "Agent" }, { header: "Tickets", align: "right" }, { header: "FRT met / breached", align: "right" }, { header: "Resolution met / breached", align: "right" }, { header: "Breach rate", align: "right" }]}
                rows={rows.map((r) => [<span key="a" className="font-medium text-text">{r.agent}</span>, num(r.tickets), `${r.frMet} / ${r.frBreached}`, `${r.resMet} / ${r.resBreached}`, pctS(r.breachRate)])}
              />
            </CardBody>
          </Card>
        </Grid>
      </>
    );
  }

  if (tab === "performance") {
    const rows = await userPerformance(ctx.brandId, from, to);
    return (
      <Card>
        <CardHeader title="User performance" description="Actions taken by each agent. Manual = ticket updates they made; automated = rule/automation actions on their tickets." />
        <CardBody className="pt-1">
          <MiniTable
            columns={[{ header: "Agent" }, { header: "Replies", align: "right" }, { header: "Notes", align: "right" }, { header: "Manual actions", align: "right" }, { header: "Automated actions", align: "right" }, { header: "Assigned", align: "right" }, { header: "Solved", align: "right" }, { header: "Open now", align: "right" }, { header: "Avg CSAT", align: "right" }]}
            rows={rows.map((r) => [<span key="a" className="font-medium text-text">{r.agent}</span>, num(r.replies), num(r.notes), num(r.manual), num(r.auto), num(r.assigned), num(r.solved), num(r.open), r.csat == null ? "n/a" : r.csat.toFixed(1)])}
          />
        </CardBody>
      </Card>
    );
  }

  const basis = (one(sp.hours) === "business" ? "business" : "calendar") as Basis;
  const cfg = await hoursCfg(ctx.brandId);
  const t = tatReport(data, from, basis, cfg, interval);
  const dim = (["agent", "channel", "day"].includes(one(sp.by)) ? one(sp.by) : "agent") as "agent" | "channel" | "day";
  const metric = one(sp.m) === "reply" ? "reply" : "resolution";
  const analysis = metric === "reply" ? (dim === "channel" ? t.analysis.replyChannel : t.analysis.replyAgent) : t.analysis[dim];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <IntervalSelect value={interval} />
        <ParamSelect param="hours" value={basis === "business" ? "business" : ""} options={[{ value: "", label: "Calendar hours" }, { value: "business", label: "Business hours" }]} label="Hours basis" />
      </div>
      <Card>
        <CardHeader title="TAT summary" description={basis === "business" ? `Business hours (${cfg.timezone}), holidays excluded` : "Calendar hours"} />
        <CardBody className="pt-1">
          <MiniTable
            columns={[{ header: "Measure" }, { header: "Measured", align: "right" }, { header: "Average", align: "right" }, { header: "Median", align: "right" }, { header: "90th pct", align: "right" }, { header: "Fastest", align: "right" }, { header: "Slowest", align: "right" }]}
            rows={(
              [
                ["First response (FRT)", t.summary.frt],
                ["Reply TAT (every reply)", t.summary.reply],
                ["Resolution", t.summary.resolution],
              ] as const
            ).map(([l, x]) => [<span key="l" className="font-medium text-text">{l}</span>, num(x.n), d(x.avg), d(x.median), d(x.p90), d(x.min), d(x.max)])}
          />
        </CardBody>
      </Card>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Daywise FRT" description="Average first response per day of ticket creation (hours)" />
          <CardBody>
            {t.daywiseFrt.some((r) => r.avg != null) ? (
              <BarChart data={t.daywiseFrt.map((r) => ({ key: r.key, value: r.avg == null ? null : Math.round((r.avg / 3600) * 10) / 10 }))} xKey="key" xFormat="day" series={[{ key: "value", label: "Avg FRT (h)" }]} height={220} yFormat="number" />
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">No answered tickets yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reply TAT by agent" description="Customer message → agent reply" />
          <CardBody className="pt-1">
            <MiniTable empty="No replies in this range." columns={[{ header: "Agent" }, { header: "Replies", align: "right" }, { header: "Average", align: "right" }, { header: "Median", align: "right" }, { header: "90th pct", align: "right" }]} rows={t.replyByAgent.map((r) => [<span key="a" className="font-medium text-text">{r.key}</span>, num(r.n), d(r.avg), d(r.median), d(r.p90)])} />
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title={`TAT summary by ${interval}`} />
        <CardBody className="pt-1">
          <MiniTable
            columns={[{ header: interval === "month" ? "Month" : interval === "week" ? "Week of" : "Day" }, { header: "Tickets", align: "right" }, { header: "Avg FRT", align: "right" }, { header: "Median FRT", align: "right" }, { header: "Replies", align: "right" }, { header: "Avg reply TAT", align: "right" }, { header: "Resolved", align: "right" }, { header: "Avg resolution", align: "right" }]}
            rows={[...t.byInterval].reverse().map((r) => [r.key, num(r.tickets), d(r.frt), d(r.frtMedian), num(r.replies), d(r.reply), num(r.resolved), d(r.resolution)])}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="TAT analysis"
          description="Compare turnaround by agent, channel or day"
          actions={
            <div className="flex flex-wrap gap-2">
              <ParamSelect param="m" value={metric === "reply" ? "reply" : ""} options={[{ value: "", label: "Resolved TAT" }, { value: "reply", label: "Reply TAT" }]} label="Measure" className="w-36" />
              <ParamSelect param="by" value={dim === "agent" ? "" : dim} options={[{ value: "", label: "By agent" }, { value: "channel", label: "By channel" }, ...(metric === "reply" ? [] : [{ value: "day", label: "By day" }])]} label="Group by" className="w-32" />
            </div>
          }
        />
        <CardBody className="pt-1">
          <MiniTable
            columns={[{ header: dim[0].toUpperCase() + dim.slice(1) }, { header: metric === "reply" ? "Replies" : "Tickets", align: "right" }, { header: "Measured", align: "right" }, { header: "Average", align: "right" }, { header: "Median", align: "right" }, { header: "90th pct", align: "right" }, { header: "Slowest", align: "right" }]}
            rows={analysis.map((r) => [<span key="k" className="font-medium text-text">{r.key.replace(/_/g, " ")}</span>, num(r.count), num(r.n), d(r.avg), d(r.median), d(r.p90), d(r.max)])}
          />
        </CardBody>
      </Card>
    </>
  );
}
