import Link from "next/link";
import type { ReactNode } from "react";
import { compact, dateLabel, displayUrl, duration, pct } from "@/lib/format";
import { OWN_RANGES, pctChange, subdomainsFromPages, type OwnRangeId } from "@/lib/competitive/own-site-map";
import type { OwnSearchReport, OwnTrafficReport } from "@/lib/competitive/own-site";
import { KeywordLink } from "@/components/seo/badges";
import { NeedsData } from "@/components/seo/needs-data";
import { Grid } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { CHANGE_META } from "./change-meta";
import { DailyTrend } from "./daily-trend";
import { OwnPagesTable, OwnQueriesTable } from "./own-search-tables";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";

/** Server-rendered "your site" views built from Search Console (+GA4) for Domain Overview and Organic Research. */

export const DFS_SHOWS_OWN = [
  "Search volume, keyword difficulty and CPC per query",
  "Organic competitors and competitive positioning map",
  "Backlinks, referring domains and Authority Score",
  "Paid search keywords and ads",
];

export function RangeLinks({ base, current }: { base: string; current: OwnRangeId }) {
  return (
    <div className="scroll-thin max-w-full overflow-x-auto">
      <div className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
        {OWN_RANGES.map((r) => (
          <Link key={r.id} href={`${base}&range=${r.id}`} className={`shrink-0 rounded px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${r.id === current ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:text-text"}`}>
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function RangeBar({ base, report, rangeId }: { base: string; report: OwnSearchReport; rangeId: OwnRangeId }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <RangeLinks base={base} current={rangeId} />
      <span className="text-[12px] text-text-3">
        {dateLabel(report.range.start)} – {dateLabel(report.range.end)}
        {report.comparable ? ` vs ${dateLabel(report.range.prevStart)} – ${dateLabel(report.range.prevEnd)}` : " · no comparable previous period inside Search Console's 16 months"}
      </span>
    </div>
  );
}

export function SearchMetrics({ r, traffic, extra }: { r: OwnSearchReport; traffic?: OwnTrafficReport | null; extra?: ReactNode }) {
  const p = r.previous;
  const label = r.comparable ? "vs previous period" : undefined;
  const organic = traffic?.channels.find((c) => c.key === "Organic Search");
  return (
    <Card className="mb-4">
      <MetricStrip>
        <Metric label="Clicks" value={compact(r.totals.clicks)} delta={pctChange(r.totals.clicks, p?.clicks)} deltaLabel={label} info="Clicks from Google Search (Search Console)." />
        <Metric label="Impressions" value={compact(r.totals.impressions)} delta={pctChange(r.totals.impressions, p?.impressions)} />
        <Metric label="CTR" value={pct(r.totals.ctr * 100, 2)} sub={p ? `was ${pct(p.ctr * 100, 2)}` : undefined} />
        <Metric label="Average position" value={r.totals.position == null ? "n/a" : r.totals.position.toFixed(1)} delta={pctChange(r.totals.position, p?.position)} upIsGood={false} sub={p?.position != null ? `was ${p.position.toFixed(1)}` : undefined} />
        <Metric
          label="Queries"
          value={compact(r.queries.filter((q) => q.position != null).length)}
          sub={r.comparable ? `${compact(r.counts.new)} new · ${compact(r.counts.lost)} lost` : r.queryLimitHit ? "top 5,000 shown" : "with impressions"}
        />
        {organic && <Metric label="Organic sessions (GA4)" value={compact(organic.sessions)} sub={`${pct(organic.engagementRate * 100)} engaged · ${compact(organic.keyEvents)} key events`} />}
        {extra}
      </MetricStrip>
    </Card>
  );
}

function dailyData(r: OwnSearchReport) {
  return r.daily.map((d) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions, ctr: Math.round(d.ctr * 10000) / 100, position: d.position }));
}
const TREND_VIEWS = [
  { id: "clicks", label: "Clicks", type: "area" as const, series: [{ key: "clicks", label: "Clicks" }] },
  { id: "impressions", label: "Impressions", type: "area" as const, series: [{ key: "impressions", label: "Impressions", color: "var(--series-7)" }] },
  { id: "ctr", label: "CTR", series: [{ key: "ctr", label: "CTR %" }], yFormat: "percent" as const },
  { id: "position", label: "Avg. position", series: [{ key: "position", label: "Average position" }], reversed: true, yFormat: "position" as const },
];

export function SearchTrendCard({ r, rangeId, title = "Search performance trend" }: { r: OwnSearchReport; rangeId: OwnRangeId; title?: string }) {
  return (
    <Card>
      <CardHeader title={title} description="Daily data from Search Console (up to 16 months)" />
      <CardBody>
        {r.daily.length ? <DailyTrend data={dailyData(r)} views={TREND_VIEWS} defaultRange={rangeId} height={250} /> : <p className="py-10 text-center text-[13px] text-text-3">No daily data yet.</p>}
      </CardBody>
    </Card>
  );
}

export function BandsAndBrandCard({ r }: { r: OwnSearchReport }) {
  const b = r.brand;
  const total = b.branded.clicks + b.nonBranded.clicks;
  return (
    <Card>
      <CardHeader title="Position distribution" description="Queries by average position in the period" />
      <CardBody>
        <BarChart data={r.bands} xKey="label" series={[{ key: "queries", label: "Queries" }]} valueLabels height={170} />
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 text-[12.5px] font-medium text-text-2">Branded vs non-branded clicks</div>
          {total ? (
            <DonutChart
              size={110}
              centerValue={pct((b.branded.clicks / total) * 100, 0)}
              centerLabel="branded"
              data={[
                { label: `Non-branded · ${compact(b.nonBranded.queries)} queries`, value: b.nonBranded.clicks },
                { label: `Branded · ${compact(b.branded.queries)} queries`, value: b.branded.clicks },
              ]}
            />
          ) : (
            <p className="text-[12.5px] text-text-3">No clicks from listed queries in this period.</p>
          )}
          <p className="mt-2 text-[11.5px] text-text-3">Brand terms: {r.brandTerms.join(", ") || "n/a"} (edit them in the project settings). Anonymized queries are not included.</p>
        </div>
      </CardBody>
    </Card>
  );
}

export function TopQueriesCard({ r, db, href }: { r: OwnSearchReport; db: string; href: string }) {
  const rows = r.queries.filter((q) => q.position != null).slice(0, 8);
  return (
    <Card>
      <CardHeader title="Top queries" description="By clicks · Search Console" href={href} />
      <CardBody>
        <MiniTable
          empty="No queries in this period."
          columns={[{ header: "Query" }, { header: "Pos.", align: "right" }, { header: "Clicks", align: "right" }, { header: "Impr.", align: "right" }, { header: "CTR", align: "right" }]}
          rows={rows.map((q) => [
            <KeywordLink key="k" keyword={q.query} db={db} className="block max-w-[220px] truncate" />,
            <span key="p" className="inline-flex items-center gap-1.5 tabular">
              {q.position!.toFixed(1)}
              {q.status === "new" && <span className="rounded bg-brand-soft px-1 text-[10.5px] font-semibold text-brand-ink">New</span>}
              {q.change != null && Math.abs(q.change) >= 0.1 && <span className={q.change > 0 ? "text-[11.5px] text-good-ink" : "text-[11.5px] text-critical-ink"}>{q.change > 0 ? "▲" : "▼"}{Math.abs(q.change).toFixed(1)}</span>}
            </span>,
            compact(q.clicks),
            compact(q.impressions),
            pct(q.ctr * 100, 1),
          ])}
        />
      </CardBody>
      <CardFooter>
        <Link href={href} className="text-link hover:underline">
          View all queries →
        </Link>
      </CardFooter>
    </Card>
  );
}

export function ChangesCard({ r, href }: { r: OwnSearchReport; href: string }) {
  return (
    <Card>
      <CardHeader title="Position changes" description={r.comparable ? "Average positions vs the previous period" : "Choose 3 or 6 months to compare periods"} href={r.comparable ? href : undefined} />
      <CardBody>
        {r.comparable ? (
          <div className="grid grid-cols-2 gap-2.5">
            {(["improved", "declined", "new", "lost"] as const).map((t) => (
              <Link key={t} href={`${href}&status=${t}`} className="rounded-md border border-border p-3 hover:bg-surface-2">
                <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHANGE_META[t].color }} aria-hidden />
                  {CHANGE_META[t].label}
                </div>
                <div className="mt-1 text-[20px] font-semibold tracking-tight">{compact(r.counts[t])}</div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-text-3">Search Console keeps 16 months of data, so a {r.range.days}-day period has no full previous period to compare with.</p>
        )}
        <p className="mt-3 text-[11.5px] text-text-3">Improved/declined = average position moved by 1 or more. Compared within the top 5,000 queries of each period.</p>
      </CardBody>
    </Card>
  );
}

export function PagesMiniCard({ r, href }: { r: OwnSearchReport; href: string }) {
  return (
    <Card>
      <CardHeader title="Top pages" href={href} />
      <CardBody>
        <MiniTable
          empty="No pages in this period."
          columns={[{ header: "URL" }, { header: "Clicks", align: "right" }, { header: "Pos.", align: "right" }]}
          rows={r.pages.slice(0, 7).map((p) => [
            <a key="u" href={p.url} target="_blank" rel="noopener noreferrer" className="block max-w-[240px] truncate text-link hover:underline" title={p.url}>
              {displayUrl(p.url)}
            </a>,
            compact(p.clicks),
            p.position.toFixed(1),
          ])}
        />
      </CardBody>
    </Card>
  );
}

export function CountriesCard({ r, limit = 7 }: { r: OwnSearchReport; limit?: number }) {
  return (
    <Card>
      <CardHeader title="Countries" description="Search Console clicks" />
      <CardBody>
        <MiniTable
          empty="No country data."
          columns={[{ header: "Country" }, { header: "Share", className: "w-24" }, { header: "Clicks", align: "right" }, { header: "Pos.", align: "right" }]}
          rows={r.countries.slice(0, limit).map((c) => [
            <span key="c" className="whitespace-nowrap">
              {c.flag} {c.label}
            </span>,
            <Bar key="b" value={c.clicks} max={r.countries[0]?.clicks || 1} className="w-16" />,
            compact(c.clicks),
            c.position.toFixed(1),
          ])}
        />
      </CardBody>
    </Card>
  );
}

export function DevicesCard({ r }: { r: OwnSearchReport }) {
  return (
    <Card>
      <CardHeader title="Devices" description="Search Console" />
      <CardBody>
        <DonutChart size={110} legend="right" data={r.devices.map((d) => ({ label: d.label, value: d.clicks }))} />
        <MiniTable
          className="mt-3"
          columns={[{ header: "Device" }, { header: "Clicks", align: "right" }, { header: "Impr.", align: "right" }, { header: "CTR", align: "right" }, { header: "Pos.", align: "right" }]}
          rows={r.devices.map((d) => [d.label, compact(d.clicks), compact(d.impressions), pct(d.ctr * 100), d.position.toFixed(1)])}
        />
      </CardBody>
    </Card>
  );
}

export function NotFromGsc({ className }: { className?: string }) {
  return <NeedsData compact className={className} providers={["dataforseo"]} title="Volumes, competitors and backlinks need DataForSEO" shows={DFS_SHOWS_OWN} />;
}

// -------------------------------------------------------------------------------- page bodies

/** Domain Overview body for a linked own site. */
export function OwnDomainOverview({ r, traffic, db, orgBase, trafficHref }: { r: OwnSearchReport; traffic: OwnTrafficReport | null; db: string; orgBase: string; trafficHref: string }) {
  const organic = traffic?.channels.find((c) => c.key === "Organic Search");
  return (
    <>
      <SearchMetrics r={r} traffic={traffic} />
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <SearchTrendCard r={r} rangeId={rangeOf(r)} />
        <BandsAndBrandCard r={r} />
      </Grid>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <TopQueriesCard r={r} db={db} href={`${orgBase}&tab=positions`} />
        <ChangesCard r={r} href={`${orgBase}&tab=changes`} />
      </Grid>
      <Grid cols={3} className="mb-4">
        <PagesMiniCard r={r} href={`${orgBase}&tab=pages`} />
        <CountriesCard r={r} />
        <DevicesCard r={r} />
      </Grid>
      {traffic && (
        <Card className="mb-4">
          <CardHeader title="Site traffic (GA4)" description="All channels for the same period" href={trafficHref} />
          <MetricStrip>
            <Metric label="Sessions" value={compact(traffic.totals.sessions)} delta={pctChange(traffic.totals.sessions, traffic.previous.sessions)} deltaLabel="vs previous period" />
            <Metric label="Users" value={compact(traffic.totals.users)} delta={pctChange(traffic.totals.users, traffic.previous.users)} />
            <Metric label="Engagement rate" value={pct(traffic.totals.engagementRate * 100)} sub={`avg. ${duration(traffic.totals.avgDuration)}`} />
            <Metric label="Organic search share" value={organic && traffic.totals.sessions ? pct((organic.sessions / traffic.totals.sessions) * 100) : "n/a"} />
            <Metric label="Key events" value={compact(traffic.totals.keyEvents)} delta={pctChange(traffic.totals.keyEvents, traffic.previous.keyEvents)} />
          </MetricStrip>
        </Card>
      )}
      <NotFromGsc className="mb-4" />
    </>
  );
}

const rangeOf = (r: OwnSearchReport): OwnRangeId => OWN_RANGES.find((x) => x.days === r.range.days)?.id ?? "3m";

export type OwnResearchTab = "overview" | "positions" | "changes" | "competitors" | "pages" | "subdomains";

/** Organic Research body for a linked own site. */
export function OwnOrganicResearch({ r, tab, db, base, url, status, domain }: { r: OwnSearchReport; tab: OwnResearchTab; db: string; base: string; url: string; status: string; domain: string }) {
  const rangeId = rangeOf(r);
  const tabBase = `${base}&range=${rangeId}`;
  if (tab === "positions")
    return (
      <>
        <Card className="mb-4">
          <CardHeader title="Organic positions" description={`Search Console queries with average positions${r.queryLimitHit ? " (top 5,000 by clicks)" : ""}. Click a URL to see its queries.`} />
          <OwnQueriesTable key={url} rows={r.queries} db={db} comparable={r.comparable} initialUrl={url} exportName={`${domain}-search-console-positions`} />
        </Card>
        <NotFromGsc />
      </>
    );
  if (tab === "changes") {
    if (!r.comparable)
      return (
        <Card>
          <EmptyState title="No comparable previous period" description="Search Console keeps 16 months of data. Choose 3 or 6 months to compare positions with the previous period." />
        </Card>
      );
    const kinds = ["improved", "declined", "new", "lost"] as const;
    const initial = (kinds as readonly string[]).includes(status) ? (status as (typeof kinds)[number]) : "improved";
    const clicksDelta = (t: (typeof kinds)[number]) => r.queries.filter((q) => q.status === t).reduce((a, q) => a + q.clicks - (q.previousClicks ?? 0), 0);
    return (
      <>
        <Card className="mb-4">
          <CardHeader title="Summary" description={`${dateLabel(r.range.start)} – ${dateLabel(r.range.end)} vs the previous ${r.range.days} days`} />
          <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kinds.map((t) => (
              <Link key={t} href={`${tabBase}&tab=changes&status=${t}`} className="rounded-md border border-border p-3 hover:bg-surface-2">
                <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHANGE_META[t].color }} aria-hidden />
                  {CHANGE_META[t].label} queries
                </div>
                <div className="mt-1 text-[22px] font-semibold tracking-tight">{compact(r.counts[t])}</div>
                <div className="text-[12px] text-text-3">
                  Clicks {clicksDelta(t) >= 0 ? "+" : "−"}
                  {compact(Math.abs(clicksDelta(t)))}
                </div>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Query changes" description="Average position moved by 1 or more, new queries with impressions, and queries that lost all impressions." />
          <OwnQueriesTable key={initial} rows={r.queries} db={db} comparable initialStatus={initial} exportName={`${domain}-search-console-changes`} />
        </Card>
      </>
    );
  }
  if (tab === "pages")
    return (
      <Card>
        <CardHeader title="Pages" description="Search Console clicks, impressions and positions per URL. Click the query count to see a page's queries." />
        <OwnPagesTable rows={r.pages} comparable={r.comparable} positionsHref={`${tabBase}&tab=positions`} exportName={`${domain}-search-console-pages`} />
      </Card>
    );
  if (tab === "subdomains") {
    const subs = subdomainsFromPages(r.pages);
    return (
      <Grid cols={2} className="lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader title="Clicks by host" />
          <CardBody>{subs.length ? <DonutChart legend="bottom" size={150} data={subs.slice(0, 6).map((s) => ({ label: s.subdomain, value: s.clicks }))} /> : <p className="py-6 text-center text-[13px] text-text-3">No pages.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Hosts" description="Subdomains with pages in Search Console (from the top 1,000 pages)" />
          <CardBody>
            <MiniTable
              empty="No pages in this period."
              columns={[{ header: "Host" }, { header: "Share", className: "w-24" }, { header: "Clicks", align: "right" }, { header: "Impressions", align: "right" }, { header: "Pages", align: "right" }]}
              rows={subs.map((s) => [s.subdomain, <Bar key="b" value={s.share} max={subs[0]?.share || 100} className="w-16" />, compact(s.clicks), compact(s.impressions), compact(s.pages)])}
            />
          </CardBody>
        </Card>
      </Grid>
    );
  }
  if (tab === "competitors")
    return (
      <NeedsData
       
        providers={["dataforseo"]}
        title="Organic competitors need DataForSEO"
        shows={["Domains competing for the same keywords", "Common keywords and competition level", "Competitors' organic keywords and traffic", "Competitive positioning map"]}
      >
        <p className="mt-2 text-[12.5px] text-text-2">Search Console only reports your own site, so it cannot tell who else ranks for your queries.</p>
      </NeedsData>
    );
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <SearchTrendCard r={r} rangeId={rangeId} title="Organic trend" />
        <BandsAndBrandCard r={r} />
      </Grid>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <TopQueriesCard r={r} db={db} href={`${tabBase}&tab=positions`} />
        <ChangesCard r={r} href={`${tabBase}&tab=changes`} />
      </Grid>
      <Grid cols={3} className="mb-4">
        <PagesMiniCard r={r} href={`${tabBase}&tab=pages`} />
        <CountriesCard r={r} />
        <DevicesCard r={r} />
      </Grid>
      <NotFromGsc />
    </>
  );
}

/** Neither DataForSEO nor a linked Google property: explain both ways to get real data. */
export function NoSearchSource({ domain, tool }: { domain: string; tool: string }) {
  return (
    <NeedsData
     
      providers={["dataforseo", "google"]}
      title={`${tool} needs a data source for ${domain}`}
      shows={[
        "Your own site: real clicks, impressions, CTR and average positions (Search Console)",
        "Your own site: queries, pages, countries, devices, branded vs non-branded, new/lost queries",
        "Any domain: organic keywords with search volume, KD and CPC (DataForSEO)",
        "Any domain: competitors, traffic estimates, backlinks and paid search (DataForSEO)",
      ]}
    >
      <p className="mt-3 text-[12.5px] text-text-2">
        Is {domain} your site? Create a project for it and link Search Console in{" "}
        <Link href="/organic-traffic-insights" className="text-link hover:underline">
          Organic Traffic Insights
        </Link>
        . For any other domain, connect DataForSEO.
      </p>
    </NeedsData>
  );
}
