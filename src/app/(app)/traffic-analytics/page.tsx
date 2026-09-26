import { ArrowRight, ChartNoAxesCombined, LogIn, LogOut } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { DataSource } from "@/lib/providers/labels";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { CHANNEL_LABELS, CHANNEL_ORDER, getTrafficCompare, getTrafficReport, shareOfVisits, type TrafficReport } from "@/lib/competitive/traffic-analytics";
import { parseDomains, spList, spStr } from "@/lib/competitive/shared";
import { compareHref } from "@/lib/competitive/links";
import { compact, duration, displayUrl, num, pct } from "@/lib/format";
import { DomainAvatar } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { series } from "@/components/charts/theme";
import { AutoTable } from "@/components/competitive/auto-table";
import { MetricTrend } from "@/components/competitive/metric-trend";
import { StackedShareBars } from "@/components/competitive/stacked-share";
import { Badge, Swatch } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { Bar, DistributionBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Traffic Analytics" };

const EXAMPLES = ["nike.com", "healthline.com", "coursera.org", "zillow.com"];
const COMPARE_EXAMPLES = ["nike.com,adidas.com,zara.com", "booking.com,expedia.com,airbnb.com"];
const CRUMBS = [{ label: "Competitive research" }, { label: "Traffic Analytics", href: "/traffic-analytics" }];

export default async function TrafficAnalyticsPage({ searchParams }: PageProps<"/traffic-analytics">) {
  await requirePageUser();
  const sp = await searchParams;
  const q = spStr(sp.q);
  const { domains, invalid, truncated } = parseDomains(spList(q));

  if (!domains.length)
    return (
      <Page>
        <PageHeader breadcrumbs={CRUMBS} title="Traffic Analytics" description="Estimated visits, engagement, traffic channels, geography and audience of any website. Enter up to 5 domains separated by commas to compare them.">
          <ToolSearch placeholder="Enter a domain, or up to 5 domains separated by commas" showDb={false} buttonLabel="Analyze" />
        </PageHeader>
        {q && <Callout tone="warning" className="mb-4">“{q}” does not contain a valid domain. Enter something like example.com, or a.com, b.com to compare.</Callout>}
        <Card>
          <EmptyState
            icon={<ChartNoAxesCombined className="h-5 w-5" />}
            title="See how much traffic any website gets"
            description="Analyze one domain or benchmark up to five side by side."
            action={
              <div className="flex max-w-xl flex-col items-center gap-3">
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((e) => (
                    <ButtonLink key={e} href={`/traffic-analytics?q=${e}`} size="sm">
                      {e}
                    </ButtonLink>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {COMPARE_EXAMPLES.map((e) => (
                    <ButtonLink key={e} href={`/traffic-analytics?q=${encodeURIComponent(e)}`} size="sm" variant="ghost">
                      Compare {e.split(",").join(" vs ")}
                    </ButtonLink>
                  ))}
                </div>
              </div>
            }
          />
        </Card>
      </Page>
    );

  const notices = (
    <>
      {invalid.length > 0 && <Callout tone="warning" className="mb-4">Ignored invalid entries: {invalid.join(", ")}.</Callout>}
      {truncated && <Callout tone="info" className="mb-4">Only the first 5 domains are compared.</Callout>}
    </>
  );

  if (domains.length > 1) {
    const { data, source, fetchedAt, note } = await getTrafficCompare(domains);
    return <CompareView reports={data} source={source} fetchedAt={fetchedAt} note={note} notices={notices} />;
  }

  const domain = domains[0];
  const { data: t, source, fetchedAt, note } = await getTrafficReport(domain);
  const compareWith = [domain, ...t.audienceOverlap.slice(0, 3).map((a) => a.domain)];
  const ageMax = Math.max(...t.demographics.age.map((a) => a.share));

  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Traffic Analytics:"
        subject={domain}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} note={note} />
            <Badge>🌐 Worldwide · all devices</Badge>
            {t.topicName && <Badge tone="brand">{t.topicName}</Badge>}
          </>
        }
        actions={
          <>
            <ButtonLink href={`/traffic-analytics?q=${encodeURIComponent(compareWith.join(","))}`} size="md" variant="secondary">
              Compare with competitors
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain, or up to 5 domains separated by commas" showDb={false} buttonLabel="Analyze" />
      </PageHeader>
      {notices}

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Visits" value={compact(t.visits)} delta={t.visitsChangePct} deltaLabel="vs last month" info="Estimated total monthly visits from all channels and devices." sub={`${pct(t.deltas.yoy, 1, true)} year over year`} />
          <Metric label="Unique visitors" value={compact(t.uniqueVisitors)} delta={t.deltas.uniqueVisitors} info="Estimated number of distinct people visiting in a month." sub={`${num(t.visits / Math.max(1, t.uniqueVisitors), 2)} visits per visitor`} />
          <Metric label="Pages / visit" value={num(t.pagesPerVisit, 2)} delta={t.deltas.pagesPerVisit} info="Average number of pages viewed per visit." />
          <Metric label="Avg. visit duration" value={duration(t.avgVisitDuration)} delta={t.deltas.avgVisitDuration} info="Average time between the first and last page view of a visit." />
          <Metric label="Bounce rate" value={pct(t.bounceRate)} delta={t.deltas.bounceRate} upIsGood={false} info="Share of visits that viewed only one page." />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.7fr_1fr]">
        <Card>
          <CardHeader title="Visits trend" description="Estimated monthly visits, last 24 months" />
          <CardBody>
            <MetricTrend
              data={t.history}
              views={[
                { id: "device", label: "By device", type: "stacked", series: [{ key: "desktop", label: "Desktop" }, { key: "mobile", label: "Mobile" }] },
                { id: "unique", label: "Visits vs unique visitors", type: "line", series: [{ key: "visits", label: "Visits" }, { key: "uniqueVisitors", label: "Unique visitors" }] },
              ]}
              height={250}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traffic channels" info="How visitors arrive: typed/bookmarked (direct), search engines, ads, links from other sites, social networks, email and AI assistants." />
          <CardBody>
            <DonutChart size={130} legend="none" centerValue={compact(t.visits)} centerLabel="visits" data={CHANNEL_ORDER.map((c, i) => ({ label: CHANNEL_LABELS[c], value: t.channels.find((x) => x.channel === c)?.visits ?? 0, color: series(i) }))} className="mb-3 justify-center" />
            <ul className="space-y-1.5">
              {CHANNEL_ORDER.map((c, i) => {
                const ch = t.channels.find((x) => x.channel === c)!;
                return (
                  <li key={c} className="grid grid-cols-[12px_1fr_70px_48px_56px] items-center gap-2 text-[12.5px]">
                    <Swatch color={series(i)} />
                    <span className="truncate text-text-2">{CHANNEL_LABELS[c]}</span>
                    <Bar value={ch.share} max={t.channels[0].share} color={series(i)} />
                    <span className="tabular text-right text-text-3">{pct(ch.share)}</span>
                    <span className="tabular text-right font-medium text-text">{compact(ch.visits)}</span>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Geo distribution" description={`${t.countries.length} countries with measurable traffic`} info="Share of all visits by visitor country." />
          <CardBody>
            <MiniTable
              columns={[{ header: "Country" }, { header: "Share", className: "w-32" }, { header: "Visits", align: "right" }, { header: "Unique visitors", align: "right" }]}
              rows={t.countries.slice(0, 9).map((c) => [
                <Link key="c" href={`/domain-overview?q=${domain}&db=${c.db}`} className="text-link hover:underline">
                  {c.flag} {c.name}
                </Link>,
                <div key="s" className="flex items-center gap-2">
                  <Bar value={c.share} max={t.countries[0].share} className="w-16" />
                  <span className="tabular text-[12px] text-text-2">{pct(c.share)}</span>
                </div>,
                compact(c.visits),
                compact(Math.round((c.visits * t.uniqueVisitors) / Math.max(1, t.visits))),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top pages" description="Pages that attract the most visits" />
          <AutoTable
            rows={t.topPages.map((p) => ({ ...p }))}
            rowKey="url"
            columns={[
              { key: "url", header: "Page", type: "url" },
              { key: "share", header: "Traffic share", type: "share", max: t.topPages[0]?.share ?? 100 },
              { key: "visits", header: "Visits", type: "compact" },
            ]}
            defaultSort={{ key: "visits", dir: "desc" }}
            pageSize={10}
            exportName={`${domain}-top-pages`}
            dense
          />
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Audience overlap" description="Share of this site's visitors who also visit…" info="Sites whose audiences overlap most with this domain's visitors." />
          <CardBody>
            <ul className="space-y-2.5">
              {[...t.audienceOverlap]
                .sort((a, b) => b.overlap - a.overlap)
                .slice(0, 8)
                .map((a) => (
                  <li key={a.domain} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1.2fr)_52px_64px] items-center gap-3 text-[13px]">
                    <Link href={`/traffic-analytics?q=${a.domain}`} className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline">
                      <DomainAvatar domain={a.domain} />
                      <span className="truncate">{a.domain}</span>
                    </Link>
                    <Bar value={a.overlap} max={100} />
                    <span className="tabular text-right font-medium">{pct(a.overlap)}</span>
                    <span className="tabular text-right text-text-3">{compact(a.visits)}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-[12px] text-text-3">Right column: the other site&apos;s monthly visits.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traffic journey" info="Where visitors come from right before visiting this site, and where they go next." />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <JourneyList title="Previous sites" icon={<LogIn className="h-3.5 w-3.5" />} rows={t.journey.previous} special={{ direct: "Direct / bookmarks" }} />
            <JourneyList title="Next sites" icon={<LogOut className="h-3.5 w-3.5" />} rows={t.journey.next} special={{ exit: "Exit (left the web)" }} />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Device distribution" />
          <CardBody>
            <DonutChart
              size={130}
              centerValue={pct(t.devices.mobile, 0)}
              centerLabel="mobile"
              data={[
                { label: "Mobile", value: Math.round((t.visits * t.devices.mobile) / 100), color: series(1) },
                { label: "Desktop", value: Math.round((t.visits * t.devices.desktop) / 100), color: series(0) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Age" info="Estimated share of visitors by age band." />
          <CardBody>
            <BarChart data={t.demographics.age} xKey="band" series={[{ key: "share", label: "Visitors" }]} yFormat="percent" valueLabels height={170} highlight={t.demographics.age.find((a) => a.share === ageMax)?.band} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Gender" info="Estimated share of visitors by gender." />
          <CardBody>
            <DistributionBar
              segments={[
                { label: "Female", value: t.demographics.female, color: series(4) },
                { label: "Male", value: t.demographics.male, color: series(0) },
              ]}
              format={(v) => pct(v)}
            />
            <p className="mt-4 text-[12.5px] text-text-2">
              {t.demographics.female > t.demographics.male ? "Women" : "Men"} make up the majority of visitors ({pct(Math.max(t.demographics.female, t.demographics.male))}). The largest age group is{" "}
              <span className="font-medium text-text">{t.demographics.age.find((a) => a.share === ageMax)?.band}</span>.
            </p>
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Subdomains" description={`${t.subdomains.length} subdomains receive traffic`} />
        <AutoTable
          rows={t.subdomains.map((s) => ({ ...s }))}
          rowKey="subdomain"
          columns={[
            { key: "subdomain", header: "Subdomain" },
            { key: "share", header: "Traffic share", type: "share", max: t.subdomains[0]?.share ?? 100 },
            { key: "visits", header: "Visits", type: "compact" },
            { key: "uniqueVisitors", header: "Unique visitors", type: "compact" },
          ]}
          defaultSort={{ key: "visits", dir: "desc" }}
          pageSize={10}
          exportName={`${domain}-subdomains`}
          dense
        />
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
        <Link href={`/domain-overview?q=${domain}`} className="inline-flex items-center gap-1 text-link hover:underline">
          Domain Overview <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link href={`/organic-research?q=${domain}&db=${t.countries[0]?.db ?? "US"}`} className="inline-flex items-center gap-1 text-link hover:underline">
          Organic Research <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link href={`/market-explorer?q=${domain}&db=${t.countries[0]?.db ?? "US"}`} className="inline-flex items-center gap-1 text-link hover:underline">
          Market Explorer <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

function JourneyList({ title, icon, rows, special }: { title: string; icon: ReactNode; rows: { domain: string; share: number }[]; special: Record<string, string> }) {
  const max = Math.max(...rows.map((r) => r.share), 1);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-text-2">
        {icon}
        {title}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.domain} className="text-[13px]">
            <div className="flex items-center justify-between gap-2">
              {special[r.domain] ? (
                <span className="truncate text-text-2 italic">{special[r.domain]}</span>
              ) : (
                <Link href={`/traffic-analytics?q=${r.domain}`} className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline">
                  <DomainAvatar domain={r.domain} size={16} />
                  <span className="truncate">{r.domain}</span>
                </Link>
              )}
              <span className="tabular shrink-0 font-medium">{pct(r.share)}</span>
            </div>
            <Bar value={r.share} max={max} className="mt-1" color={special[r.domain] ? "var(--text-3)" : "var(--series-1)"} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Compare mode
// ------------------------------------------------------------------------------------------------

type MetricRow = { label: string; info?: string; values: number[]; format: (v: number) => string; best?: "max" | "min" };

function CompareView({ reports, source, fetchedAt, note, notices }: { reports: TrafficReport[]; source: DataSource; fetchedAt: string; note?: string; notices: ReactNode }) {
  const domains = reports.map((r) => r.domain);
  const shares = shareOfVisits(reports);
  const months = reports[0].history.map((h) => h.month);
  const trend = months.map((month, i) => {
    const row: Record<string, string | number> = { month };
    reports.forEach((r, j) => {
      row[`v${j}`] = r.history[i]?.visits ?? 0;
      row[`u${j}`] = r.history[i]?.uniqueVisitors ?? 0;
    });
    return row;
  });
  const metrics: MetricRow[] = [
    { label: "Visits", values: reports.map((r) => r.visits), format: compact, best: "max" },
    { label: "Visits change (MoM)", values: reports.map((r) => r.visitsChangePct), format: (v) => pct(v, 1, true), best: "max" },
    { label: "Visits change (YoY)", values: reports.map((r) => r.deltas.yoy), format: (v) => pct(v, 1, true), best: "max" },
    { label: "Unique visitors", values: reports.map((r) => r.uniqueVisitors), format: compact, best: "max" },
    { label: "Pages / visit", values: reports.map((r) => r.pagesPerVisit), format: (v) => num(v, 2), best: "max" },
    { label: "Avg. visit duration", values: reports.map((r) => r.avgVisitDuration), format: duration, best: "max" },
    { label: "Bounce rate", values: reports.map((r) => r.bounceRate), format: (v) => pct(v), best: "min" },
    { label: "Mobile share", values: reports.map((r) => r.devices.mobile), format: (v) => pct(v) },
    { label: "Organic search share", values: reports.map((r) => r.channelShare.organic), format: (v) => pct(v) },
    { label: "AI assistant visits", values: reports.map((r) => r.channels.find((c) => c.channel === "ai")?.visits ?? 0), format: compact, best: "max" },
    { label: "Authority Score", values: reports.map((r) => r.authorityScore), format: (v) => String(v), best: "max" },
  ];
  const countryCodes = [...new Set(reports.flatMap((r) => r.countries.slice(0, 5).map((c) => c.db)))].slice(0, 8);
  const ageRows = reports[0].demographics.age.map((a, i) => {
    const row: Record<string, string | number> = { band: a.band };
    reports.forEach((r, j) => (row[`a${j}`] = r.demographics.age[i]?.share ?? 0));
    return row;
  });

  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Traffic Analytics:"
        subject={domains.join(" vs ")}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} note={note} />
            <Badge>🌐 Worldwide · all devices</Badge>
            <Badge tone="brand">Comparing {domains.length} domains</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={compareHref("/keyword-gap", domains)} variant="secondary">
              Keyword Gap
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain, or up to 5 domains separated by commas" showDb={false} buttonLabel="Analyze" />
      </PageHeader>
      {notices}

      <Card className="mb-4">
        <div className="grid divide-y divide-border sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0">
          {reports.map((r, i) => (
            <div key={r.domain} className="min-w-0 px-4 py-3">
              <div className="flex items-center gap-2 text-[12.5px] text-text-2">
                <Swatch color={series(i)} shape="dot" />
                <Link href={`/traffic-analytics?q=${r.domain}`} className="truncate font-medium text-link hover:underline">
                  {r.domain}
                </Link>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[22px] font-semibold tracking-tight">{compact(r.visits)}</span>
                <span className={cn("text-[12px] font-medium", r.visitsChangePct >= 0 ? "text-good-ink" : "text-critical-ink")}>{pct(r.visitsChangePct, 1, true)}</span>
              </div>
              <div className="text-[12px] text-text-3">visits · {pct(shares[i])} of group</div>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-3">
          <div className="mb-1.5 text-[12px] text-text-3">Share of combined visits</div>
          <DistributionBar showLegend={false} segments={reports.map((r, i) => ({ label: r.domain, value: r.visits, color: series(i) }))} />
        </div>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Visits trend" description="One line per domain, last 24 months" />
          <CardBody>
            <MetricTrend
              data={trend}
              views={[
                { id: "visits", label: "Visits", series: reports.map((r, j) => ({ key: `v${j}`, label: r.domain })) },
                { id: "unique", label: "Unique visitors", series: reports.map((r, j) => ({ key: `u${j}`, label: r.domain })) },
              ]}
              height={280}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Key metrics" info="Best value per row is emphasized." />
          <CardBody>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-text-3">
                    <th className="border-b border-border py-1.5 pr-2 font-medium">Metric</th>
                    {reports.map((r, i) => (
                      <th key={r.domain} className="border-b border-border px-2 py-1.5 text-right font-medium whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Swatch color={series(i)} shape="dot" />
                          <span className="max-w-[90px] truncate">{r.domain}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => {
                    const target = m.best === "max" ? Math.max(...m.values) : m.best === "min" ? Math.min(...m.values) : null;
                    return (
                      <tr key={m.label} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-2 whitespace-nowrap text-text-2">{m.label}</td>
                        {m.values.map((v, i) => (
                          <td key={i} className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                            <span className={cn(target === v && reports.length > 1 ? "rounded bg-good-soft px-1 font-semibold text-good-ink" : "text-text")}>{m.format(v)}</span>
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

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Traffic channels" description="Share of each domain's visits by channel" />
          <CardBody>
            <StackedShareBars
              rows={reports.map((r) => ({ label: r.domain, href: `/traffic-analytics?q=${r.domain}`, segments: CHANNEL_ORDER.map((c) => ({ key: c, value: r.channelShare[c] })) }))}
              legend={CHANNEL_ORDER.map((c, i) => ({ key: c, label: CHANNEL_LABELS[c], color: series(i) }))}
            />
            <div className="mt-4 border-t border-border pt-3">
              <MiniTable
                columns={[{ header: "Channel" }, ...reports.map((r, i) => ({ header: <span className="inline-flex items-center gap-1.5"><Swatch color={series(i)} shape="dot" /><span className="max-w-[90px] truncate">{r.domain}</span></span>, align: "right" as const }))]}
                rows={CHANNEL_ORDER.map((c) => [CHANNEL_LABELS[c], ...reports.map((r) => pct(r.channelShare[c]))])}
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Audience age" description="Share of visitors by age band" />
          <CardBody>
            <BarChart data={ageRows} xKey="band" series={reports.map((r, j) => ({ key: `a${j}`, label: r.domain }))} yFormat="percent" height={260} />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Geo distribution" description="Share of each domain's visits by country" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Country" }, ...reports.map((r, i) => ({ header: <span className="inline-flex items-center gap-1.5"><Swatch color={series(i)} shape="dot" /><span className="max-w-[90px] truncate">{r.domain}</span></span>, align: "right" as const }))]}
              rows={countryCodes.map((code) => {
                const c = reports.flatMap((r) => r.countries).find((x) => x.db === code)!;
                return [
                  <span key="c" className="whitespace-nowrap">
                    {c.flag} {c.name}
                  </span>,
                  ...reports.map((r) => {
                    const x = r.countries.find((y) => y.db === code);
                    return x ? pct(x.share) : "–";
                  }),
                ];
              })}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Devices & audience" />
          <CardBody>
            <ul className="space-y-3.5">
              {reports.map((r, i) => (
                <li key={r.domain}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Swatch color={series(i)} shape="dot" />
                      <span className="truncate text-text-2">{r.domain}</span>
                    </span>
                    <span className="tabular text-text-3">
                      {pct(r.devices.mobile, 0)} mobile · {pct(r.demographics.female, 0)} female
                    </span>
                  </div>
                  <DistributionBar
                    showLegend={false}
                    segments={[
                      { label: "Desktop", value: r.devices.desktop, color: "var(--seq-500)" },
                      { label: "Mobile", value: r.devices.mobile, color: "var(--seq-200)" },
                    ]}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-4 text-[12px] text-text-3">
              <span className="inline-flex items-center gap-1.5">
                <Swatch color="var(--seq-500)" /> Desktop
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Swatch color="var(--seq-200)" /> Mobile
              </span>
            </div>
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Top pages by domain" description="The three most visited pages of each domain" />
        <CardBody>
          <MiniTable
            columns={[{ header: "Domain" }, { header: "Page" }, { header: "Share", align: "right" }, { header: "Visits", align: "right" }]}
            rows={reports.flatMap((r, i) =>
              r.topPages.slice(0, 3).map((p, j) => [
                j === 0 ? (
                  <span key="d" className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Swatch color={series(i)} shape="dot" />
                    {r.domain}
                  </span>
                ) : (
                  ""
                ),
                <a key="u" href={p.url} target="_blank" rel="noopener noreferrer" className="block max-w-[420px] truncate text-link hover:underline">
                  {displayUrl(p.url)}
                </a>,
                pct(p.share),
                compact(p.visits),
              ]),
            )}
          />
        </CardBody>
      </Card>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}
