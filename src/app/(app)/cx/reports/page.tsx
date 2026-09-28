import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { humanDuration } from "@/lib/cx/insights/metrics";
import { breachReport, hoursCfg, loadReportData, myDashboard, tatReport, trendReport, userPerformance } from "@/lib/cx/insights/reports";
import type { Basis, Interval } from "@/lib/cx/insights/reports-math";
import { fieldColumns, listFiles, listSchedules, listTemplates } from "@/lib/cx/insights/exports";
import { brandMailer } from "@/lib/cx/insights/mailer";
import { dateTimeLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { TabsNav } from "@/components/ui/tabs";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { DownloadCentre } from "@/components/cx/insights/download-centre";

export const metadata: Metadata = { title: "Reports" };
const ser = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const d = humanDuration;
const pctS = (x: number | null) => (x == null ? "n/a" : `${x.toFixed(0)}%`);

function Chips({ label, items, current }: { label: string; items: { href: string; label: string; value: string }[]; current: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-text-3">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
        {items.map((i) => (
          <Link key={i.value} href={i.href} aria-current={i.value === current ? "true" : undefined} className={cn("border-r border-border-strong px-2.5 py-1 text-[12.5px] font-medium last:border-r-0", i.value === current ? "bg-brand-soft text-text" : "bg-surface text-text-2 hover:bg-surface-3")}>
            {i.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<"/cx/reports">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Reports" />;
  const str = (k: string, def: string) => (typeof sp[k] === "string" ? (sp[k] as string) : def);
  const tab = str("tab", "trend");
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const interval = (["day", "week", "month"].includes(str("interval", "")) ? str("interval", "") : days > 30 ? "week" : "day") as Interval;
  const basis = (str("basis", "calendar") === "business" ? "business" : "calendar") as Basis;
  const h = (p: Record<string, string | number>) => cxHref("/cx/reports", brand.id, { tab, days, interval, basis, ...p });
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  const controls = (opts: { interval?: boolean; basis?: boolean }) => (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Chips label="Range" current={String(days)} items={[7, 30, 90].map((x) => ({ value: String(x), label: `${x}d`, href: h({ days: x }) }))} />
      {opts.interval && <Chips label="Interval" current={interval} items={(["day", "week", "month"] as const).map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1), href: h({ interval: x }) }))} />}
      {opts.basis && <Chips label="Hours" current={basis} items={[{ value: "calendar", label: "Calendar", href: h({ basis: "calendar" }) }, { value: "business", label: "Business", href: h({ basis: "business" }) }]} />}
    </div>
  );

  let body: React.ReactNode;
  if (tab === "downloads") {
    const [templates, schedules, files, fcols, mailer] = await Promise.all([listTemplates(brand.id), listSchedules(brand.id), listFiles(brand.id), fieldColumns(brand.id), brandMailer(brand.id)]);
    body = <DownloadCentre brand={brand.id} templates={ser(templates)} schedules={ser(schedules)} files={ser(files)} fieldColumns={fcols} mailbox={!!mailer} />;
  } else if (tab === "mine") {
    const cfg = await hoursCfg(brand.id);
    const m = await myDashboard(brand.id, { id: user.id, name: user.name, email: user.email }, cfg, now);
    body = (
      <>
        <p className="mb-3 text-[13px] text-text-2">Your numbers for today (since {dateTimeLabel(m.since)}, {cfg.timezone}). Calendar hours.</p>
        <Card className="mb-4">
          <CardBody className="py-4">
            <MetricStrip>
              <Metric label="First activity" value={m.firstActivity ? new Date(m.firstActivity).toISOString().slice(11, 16) + " UTC" : "n/a"} sub={m.lastActivity ? `Last at ${new Date(m.lastActivity).toISOString().slice(11, 16)} UTC` : "No activity yet today"} />
              <Metric label="Break time" value="n/a" sub="Needs agent status tracking" />
              <Metric label="Replies sent" value={num(m.replies)} sub={`${num(m.notes)} internal notes`} />
              <Metric label="Assigned today" value={num(m.assigned)} sub={`${num(m.open)} open in your queue`} />
              <Metric label="Resolved today" value={num(m.resolved)} />
              <Metric label="Closed today" value={num(m.closed)} />
            </MetricStrip>
          </CardBody>
        </Card>
        <Grid cols={3}>
          {[
            { t: "Reply TAT", s: m.replyTat, sub: "Customer message → your reply" },
            { t: "First response time", s: m.frt, sub: "Your tickets first answered today" },
            { t: "Close TAT", s: m.closeTat, sub: "Created → resolved/closed today" },
          ].map((x) => (
            <Card key={x.t}>
              <CardHeader title={x.t} description={x.sub} />
              <CardBody className="pt-1">
                <MetricStrip>
                  <Metric label="Average" value={d(x.s.avg)} sub={`${x.s.n} measured`} />
                  <Metric label="Median" value={d(x.s.median)} />
                  <Metric label="Slowest" value={d(x.s.max)} />
                </MetricStrip>
              </CardBody>
            </Card>
          ))}
        </Grid>
      </>
    );
  } else {
    const data = await loadReportData(brand.id, from, now);
    const empty = !data.tickets.length;
    if (empty)
      body = (
        <Card>
          <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No tickets in this range" description="Reports are computed from tickets and messages stored for this brand. Connect a channel or widen the range." action={<ButtonLink href={cxHref("/cx/inbox", brand.id)} variant="primary">Open inbox</ButtonLink>} />
        </Card>
      );
    else if (tab === "trend") {
      const t = trendReport(data.tickets, from, now, interval);
      body = (
        <>
          {controls({ interval: true })}
          <Card className="mb-4">
            <CardBody className="py-4">
              <MetricStrip>
                <Metric label="Created" value={num(t.created)} />
                <Metric label="Solved" value={num(t.solved)} />
                <Metric label="Net backlog change" value={`${t.created - t.solved >= 0 ? "+" : ""}${num(t.created - t.solved)}`} sub="Created minus solved" />
                <Metric label={`Avg per ${interval}`} value={t.rows.length ? (t.created / t.rows.length).toFixed(1) : "n/a"} />
              </MetricStrip>
            </CardBody>
          </Card>
          <Card className="mb-4">
            <CardHeader title="Ticket trend" description={`Created vs solved per ${interval}`} />
            <CardBody>
              <BarChart data={t.rows} xKey="key" xFormat={interval === "month" ? "monthShort" : "day"} series={[{ key: "created", label: "Created" }, { key: "solved", label: "Solved" }]} height={260} showLegend />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By period" />
            <CardBody className="pt-1">
              <MiniTable columns={[{ header: interval === "month" ? "Month" : interval === "week" ? "Week of" : "Day" }, { header: "Created", align: "right" }, { header: "Solved", align: "right" }, { header: "Net", align: "right" }]} rows={[...t.rows].reverse().map((r) => [r.key, num(r.created), num(r.solved), `${r.created - r.solved >= 0 ? "+" : ""}${r.created - r.solved}`])} />
            </CardBody>
          </Card>
        </>
      );
    } else if (tab === "sla") {
      const rows = breachReport(data.tickets, from, now);
      const breached = rows.reduce((s, r) => s + r.breached, 0);
      body = (
        <>
          {controls({})}
          {!data.policies && <Callout className="mb-4" title="No SLA policies">Set first-response and resolution targets in CX settings → Team &amp; SLAs; breaches are measured against them.</Callout>}
          <Card className="mb-4">
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
              <CardHeader title="Agent-wise SLA breaches" description={`Tickets created in the last ${days} days`} />
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
    } else if (tab === "performance") {
      const rows = await userPerformance(brand.id, from, now);
      body = (
        <>
          {controls({})}
          <Card>
            <CardHeader title="User performance" description="Actions taken by each agent. Manual = ticket updates they made; automated = rule/automation actions on their tickets." />
            <CardBody className="pt-1">
              <MiniTable
                columns={[{ header: "Agent" }, { header: "Replies", align: "right" }, { header: "Notes", align: "right" }, { header: "Manual actions", align: "right" }, { header: "Automated actions", align: "right" }, { header: "Assigned", align: "right" }, { header: "Solved", align: "right" }, { header: "Open now", align: "right" }, { header: "Avg CSAT", align: "right" }]}
                rows={rows.map((r) => [<span key="a" className="font-medium text-text">{r.agent}</span>, num(r.replies), num(r.notes), num(r.manual), num(r.auto), num(r.assigned), num(r.solved), num(r.open), r.csat == null ? "n/a" : r.csat.toFixed(1)])}
              />
            </CardBody>
          </Card>
        </>
      );
    } else {
      const cfg = await hoursCfg(brand.id);
      const t = tatReport(data, from, basis, cfg, interval);
      const dim = str("by", "agent") as "agent" | "channel" | "day";
      const metric = str("m", "resolution");
      const analysis = metric === "reply" ? (dim === "channel" ? t.analysis.replyChannel : t.analysis.replyAgent) : t.analysis[dim];
      body = (
        <>
          {controls({ interval: true, basis: true })}
          <Card className="mb-4">
            <CardHeader title="TAT summary" description={`${basis === "business" ? `Business hours (${cfg.timezone}), holidays excluded` : "Calendar hours"} · last ${days} days`} />
            <CardBody className="pt-1">
              <MiniTable
                columns={[{ header: "Measure" }, { header: "Measured", align: "right" }, { header: "Average", align: "right" }, { header: "Median", align: "right" }, { header: "90th pct", align: "right" }, { header: "Fastest", align: "right" }, { header: "Slowest", align: "right" }]}
                rows={[
                  ["First response (FRT)", t.summary.frt],
                  ["Reply TAT (every reply)", t.summary.reply],
                  ["Resolution", t.summary.resolution],
                ].map(([l, s]) => {
                  const x = s as typeof t.summary.frt;
                  return [<span key="l" className="font-medium text-text">{l as string}</span>, num(x.n), d(x.avg), d(x.median), d(x.p90), d(x.min), d(x.max)];
                })}
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
          <Card className="mt-4">
            <CardHeader title={`TAT summary by ${interval}`} />
            <CardBody className="pt-1">
              <MiniTable
                columns={[{ header: interval === "month" ? "Month" : interval === "week" ? "Week of" : "Day" }, { header: "Tickets", align: "right" }, { header: "Avg FRT", align: "right" }, { header: "Median FRT", align: "right" }, { header: "Replies", align: "right" }, { header: "Avg reply TAT", align: "right" }, { header: "Resolved", align: "right" }, { header: "Avg resolution", align: "right" }]}
                rows={[...t.byInterval].reverse().map((r) => [r.key, num(r.tickets), d(r.frt), d(r.frtMedian), num(r.replies), d(r.reply), num(r.resolved), d(r.resolution)])}
              />
            </CardBody>
          </Card>
          <Card className="mt-4">
            <CardHeader
              title="TAT analysis"
              description="Compare turnaround by agent, channel or day"
              actions={
                <div className="flex flex-wrap gap-2">
                  <Chips label="" current={metric} items={[{ value: "resolution", label: "Resolved TAT", href: h({ m: "resolution", by: dim }) }, { value: "reply", label: "Reply TAT", href: h({ m: "reply", by: dim === "day" ? "agent" : dim }) }]} />
                  <Chips label="" current={dim} items={(metric === "reply" ? (["agent", "channel"] as const) : (["agent", "channel", "day"] as const)).map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1), href: h({ m: metric, by: x }) }))} />
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
  }

  const tabs = [
    { t: "trend", l: "Ticket trend" },
    { t: "sla", l: "SLA breaches" },
    { t: "performance", l: "User performance" },
    { t: "tat", l: "TAT" },
    { t: "mine", l: "My dashboard" },
    { t: "downloads", l: "Download centre" },
  ];
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Reports" }]}
        title="Reports"
        subject={brand.name}
        description="Ticket volume, SLA breaches, agent activity and turnaround times from stored records, plus exports."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge>Source: stored tickets and messages</Badge>
          </BrandMeta>
        }
      />
      <TabsNav className="mb-4" items={tabs.map((x) => ({ href: cxHref("/cx/reports", brand.id, { tab: x.t, days }), label: x.l, match: x.t }))} />
      {body}
    </Page>
  );
}
