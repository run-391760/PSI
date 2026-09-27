import Link from "next/link";
import { compact, duration, num, pct } from "@/lib/format";
import { pctChange, type OwnRangeId } from "@/lib/competitive/own-site-map";
import type { OwnTrafficReport } from "@/lib/competitive/own-site";
import { NeedsData } from "@/components/seo/needs-data";
import { Grid } from "@/components/shell/page";
import { DonutChart } from "@/components/charts/donut-chart";
import { series } from "@/components/charts/theme";
import { AutoTable } from "./auto-table";
import { DailyTrend } from "./daily-trend";
import { Swatch } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar, DistributionBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const CLICKSTREAM_SHOWS = [
  "Estimated visits, unique visitors and engagement for any website",
  "Traffic channels, countries and devices of competitors",
  "Audience overlap and traffic journey",
  "Side-by-side traffic comparison of up to 5 domains",
];

export function ClickstreamNeeded({ domains, compact: small }: { domains: string[]; compact?: boolean }) {
  return (
    <NeedsData
      className={undefined}
      compact={small}
      providers={["clickstream"]}
      title={small ? `Traffic of ${domains.join(", ")} needs a clickstream provider` : `Traffic Analytics for ${domains.join(", ")} needs a clickstream provider`}
      shows={CLICKSTREAM_SHOWS}
    >
      <p className="mt-3 text-[12.5px] text-text-2">
        No API for third-party website traffic is configured. For your own sites, Traffic Analytics uses Google Analytics 4: create a project for the site and link its GA4 property in{" "}
        <Link href="/organic-traffic-insights" className="text-link hover:underline">
          Organic Traffic Insights
        </Link>
        .
      </p>
    </NeedsData>
  );
}

const TREND_VIEWS = [
  { id: "sessions", label: "Sessions", type: "area" as const, series: [{ key: "sessions", label: "Sessions" }] },
  { id: "users", label: "Users", type: "area" as const, series: [{ key: "users", label: "Users", color: "var(--series-7)" }] },
];

export function OwnTraffic({ t, rangeId, domain }: { t: OwnTrafficReport; rangeId: OwnRangeId; domain: string }) {
  const p = t.previous;
  const label = "vs previous period";
  const chMax = t.channels[0]?.share || 1;
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Sessions" value={compact(t.totals.sessions)} delta={pctChange(t.totals.sessions, p.sessions)} deltaLabel={label} info="All sessions in GA4 for the period." />
          <Metric label="Users" value={compact(t.totals.users)} delta={pctChange(t.totals.users, p.users)} sub={`${compact(t.totals.newUsers)} new users`} />
          <Metric label="Engagement rate" value={pct(t.totals.engagementRate * 100)} sub={p.sessions ? `was ${pct(p.engagementRate * 100)}` : undefined} info="Share of sessions that lasted 10+ seconds, had a key event or 2+ page views." />
          <Metric label="Avg. session duration" value={duration(t.totals.avgDuration)} delta={pctChange(t.totals.avgDuration, p.avgDuration)} />
          <Metric label="Pages / session" value={t.totals.pagesPerSession == null ? "n/a" : num(t.totals.pagesPerSession, 2)} delta={pctChange(t.totals.pagesPerSession, p.pagesPerSession)} />
          <Metric label="Key events" value={compact(t.totals.keyEvents)} delta={pctChange(t.totals.keyEvents, p.keyEvents)} />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHeader title="Sessions trend" description="Daily sessions and users (GA4)" />
          <CardBody>
            {t.daily.length ? <DailyTrend data={t.daily} views={TREND_VIEWS} defaultRange={rangeId} height={250} /> : <p className="py-10 text-center text-[13px] text-text-3">No daily data for this period.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traffic channels" info="GA4 default channel group." />
          <CardBody>
            <DonutChart size={130} legend="none" centerValue={compact(t.totals.sessions)} centerLabel="sessions" data={t.channels.slice(0, 8).map((c, i) => ({ label: c.label, value: c.sessions, color: series(i) }))} className="mb-3 justify-center" />
            <ul className="space-y-1.5">
              {t.channels.slice(0, 8).map((c, i) => (
                <li key={c.key} className="grid grid-cols-[12px_1fr_60px_48px_56px] items-center gap-2 text-[12.5px]">
                  <Swatch color={series(i)} />
                  <span className="truncate text-text-2">{c.label}</span>
                  <Bar value={c.share} max={chMax} color={series(i)} />
                  <span className="tabular text-right text-text-3">{pct(c.share)}</span>
                  <span className="tabular text-right font-medium text-text">{compact(c.sessions)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Countries" description="Sessions by visitor country" />
          <CardBody>
            <MiniTable
              empty="No country data."
              columns={[{ header: "Country" }, { header: "Share", className: "w-28" }, { header: "Sessions", align: "right" }, { header: "Users", align: "right" }, { header: "Engaged", align: "right" }]}
              rows={t.countries.slice(0, 9).map((c) => [
                <span key="c" className="whitespace-nowrap">
                  {c.flag} {c.label}
                </span>,
                <div key="s" className="flex items-center gap-2">
                  <Bar value={c.share} max={t.countries[0]?.share || 1} className="w-14" />
                  <span className="tabular text-[12px] text-text-2">{pct(c.share)}</span>
                </div>,
                compact(c.sessions),
                compact(c.users),
                pct(c.engagementRate * 100, 0),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Landing pages" description="Where sessions start" />
          <AutoTable
            rows={t.landingPages.map((l) => ({ page: l.label, sessions: l.sessions, share: l.share, engagementRate: Math.round(l.engagementRate * 1000) / 10, keyEvents: l.keyEvents }))}
            rowKey="page"
            columns={[
              { key: "page", header: "Landing page" },
              { key: "sessions", header: "Sessions", type: "compact" },
              { key: "share", header: "Share", type: "share", max: t.landingPages[0]?.share || 100 },
              { key: "engagementRate", header: "Engagement", type: "percent" },
              { key: "keyEvents", header: "Key events", type: "compact" },
            ]}
            defaultSort={{ key: "sessions", dir: "desc" }}
            pageSize={10}
            exportName={`${domain}-ga4-landing-pages`}
            dense
          />
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Devices" />
          <CardBody>
            <DonutChart size={130} legend="right" data={t.devices.map((d, i) => ({ label: d.label, value: d.sessions, color: series(i) }))} />
            <MiniTable
              className="mt-3"
              columns={[{ header: "Device" }, { header: "Sessions", align: "right" }, { header: "Share", align: "right" }, { header: "Engaged", align: "right" }, { header: "Avg. duration", align: "right" }]}
              rows={t.devices.map((d) => [d.label, compact(d.sessions), pct(d.share), pct(d.engagementRate * 100, 0), duration(d.avgDuration)])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="New vs returning" description="Sessions by visitor type" />
          <CardBody>
            {t.newReturning.length ? (
              <>
                <DistributionBar segments={t.newReturning.map((x, i) => ({ label: `${x.label} · ${compact(x.sessions)}`, value: x.sessions, color: series(i) }))} format={(v, s) => `${compact(v)} · ${s.toFixed(1)}%`} />
                <MiniTable
                  className="mt-4"
                  columns={[{ header: "Visitors" }, { header: "Users", align: "right" }, { header: "Engaged", align: "right" }, { header: "Pages / session", align: "right" }, { header: "Key events", align: "right" }]}
                  rows={t.newReturning.map((x) => [x.label, compact(x.users), pct(x.engagementRate * 100, 0), x.pagesPerSession == null ? "n/a" : num(x.pagesPerSession, 2), compact(x.keyEvents)])}
                />
              </>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">No new/returning data for this period.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
      <ClickstreamNeeded domains={["competitors"]} compact />
    </>
  );
}

type CompareRow = { label: string; values: (number | null)[]; format: (v: number) => string; best?: "max" | "min" };

/** Compare mode: only the user's own GA4-linked sites have numbers; the rest show n/a. */
export function OwnTrafficCompare({ domains, reports }: { domains: string[]; reports: (OwnTrafficReport | null)[] }) {
  const v = (f: (t: OwnTrafficReport) => number | null) => reports.map((t) => (t ? f(t) : null));
  const organic = (t: OwnTrafficReport) => t.channels.find((c) => c.key === "Organic Search")?.share ?? 0;
  const rows: CompareRow[] = [
    { label: "Sessions", values: v((t) => t.totals.sessions), format: compact, best: "max" },
    { label: "Sessions change", values: v((t) => pctChange(t.totals.sessions, t.previous.sessions)), format: (x) => pct(x, 1, true), best: "max" },
    { label: "Users", values: v((t) => t.totals.users), format: compact, best: "max" },
    { label: "Engagement rate", values: v((t) => t.totals.engagementRate * 100), format: (x) => pct(x), best: "max" },
    { label: "Avg. session duration", values: v((t) => t.totals.avgDuration), format: duration, best: "max" },
    { label: "Pages / session", values: v((t) => t.totals.pagesPerSession), format: (x) => num(x, 2), best: "max" },
    { label: "Key events", values: v((t) => t.totals.keyEvents), format: compact, best: "max" },
    { label: "Organic search share", values: v(organic), format: (x) => pct(x) },
    { label: "Mobile share", values: v((t) => t.devices.find((d) => d.key === "mobile")?.share ?? 0), format: (x) => pct(x) },
  ];
  const own = reports.map((t, i) => ({ t, i })).filter((x): x is { t: OwnTrafficReport; i: number } => !!x.t);
  const others = domains.filter((_, i) => !reports[i]);
  const dates = [...new Set(own.flatMap((x) => x.t.daily.map((d) => d.date)))].sort();
  const trend = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const { t, i } of own) row[`s${i}`] = t.daily.find((d) => d.date === date)?.sessions ?? 0;
    return row;
  });
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Sessions trend" description="Your GA4-linked sites only" />
          <CardBody>
            {own.length ? (
              <DailyTrend data={trend} views={[{ id: "sessions", label: "Sessions", series: own.map(({ i }) => ({ key: `s${i}`, label: domains[i], color: series(i) })) }]} height={270} />
            ) : (
              <p className="py-10 text-center text-[13px] text-text-3">None of these domains is one of your GA4-linked sites.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Key metrics" info="GA4 for your own linked sites; n/a where no traffic source is available. Best value per row is emphasized." />
          <CardBody>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-text-3">
                    <th className="border-b border-border py-1.5 pr-2 font-medium">Metric</th>
                    {domains.map((d, i) => (
                      <th key={d} className="border-b border-border px-2 py-1.5 text-right font-medium whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Swatch color={series(i)} shape="dot" />
                          <span className="max-w-[90px] truncate">{d}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const known = m.values.filter((x): x is number => x != null);
                    const target = known.length > 1 ? (m.best === "max" ? Math.max(...known) : m.best === "min" ? Math.min(...known) : null) : null;
                    return (
                      <tr key={m.label} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-2 whitespace-nowrap text-text-2">{m.label}</td>
                        {m.values.map((x, i) => (
                          <td key={i} className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                            {x == null ? <span className="text-text-3">n/a</span> : <span className={cn(target === x ? "rounded bg-good-soft px-1 font-semibold text-good-ink" : "text-text")}>{m.format(x)}</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </Grid>
      {own.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Traffic channels" description="Share of sessions by GA4 default channel group" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Channel" }, ...own.map(({ i }) => ({ header: <span className="inline-flex items-center gap-1.5"><Swatch color={series(i)} shape="dot" /><span className="max-w-[110px] truncate">{domains[i]}</span></span>, align: "right" as const }))]}
              rows={[...new Set(own.flatMap(({ t }) => t.channels.slice(0, 8).map((c) => c.key)))].map((key) => [key, ...own.map(({ t }) => pct(t.channels.find((c) => c.key === key)?.share ?? 0))])}
            />
          </CardBody>
        </Card>
      )}
      {others.length > 0 && <ClickstreamNeeded domains={others} compact />}
    </>
  );
}
