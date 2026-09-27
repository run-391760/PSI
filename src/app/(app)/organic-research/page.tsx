import { ArrowRight, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getOrganicChanges, getOrganicCompetitors, getOrganicPages, getOrganicPositions, getOrganicSubdomains, getOrganicSummary } from "@/lib/competitive/organic-research";
import type { DomainOverview } from "@/lib/competitive/domain-overview";
import { spStr } from "@/lib/competitive/shared";
import { getOwnSearch, ownSiteFor, settle } from "@/lib/competitive/own-site";
import { ownRange } from "@/lib/competitive/own-site-map";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { NoSearchSource, OwnOrganicResearch, RangeBar, SearchMetrics } from "@/components/competitive/own-search-view";
import { compareHref } from "@/lib/competitive/links";
import { database, tryRootDomain } from "@/lib/domain";
import { compact, displayUrl, money, pct } from "@/lib/format";
import { DomainLink, featureLabel, FeatureIcon, INTENT_META, IntentBadges, KdBadge, KeywordLink, PositionChange } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { BubbleChart } from "@/components/charts/bubble-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { AutoTable } from "@/components/competitive/auto-table";
import { MetricTrend } from "@/components/competitive/metric-trend";
import { CHANGE_META } from "@/components/competitive/change-meta";
import { PositionChangesTables } from "@/components/competitive/position-changes";
import { PositionsTable } from "@/components/competitive/positions-table";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { Bar, DistributionBar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Organic Research" };

const EXAMPLES = ["nike.com", "healthline.com", "zillow.com", "coursera.org", "paruluniversity.ac.in"];
const TABS = ["overview", "positions", "changes", "competitors", "pages", "subdomains"] as const;
type Tab = (typeof TABS)[number];
const CRUMBS = [{ label: "Competitive research" }, { label: "Organic Research", href: "/organic-research" }];

export default async function OrganicResearchPage({ searchParams }: PageProps<"/organic-research">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = spStr(sp.q);
  const db = database(spStr(sp.db) || "US").code;
  const tab: Tab = (TABS as readonly string[]).includes(spStr(sp.tab)) ? (spStr(sp.tab) as Tab) : "overview";
  const url = spStr(sp.url);
  const domain = tryRootDomain(q);

  if (!domain)
    return (
      <Page>
        <PageHeader breadcrumbs={CRUMBS} title="Organic Research" description="See the keywords any domain ranks for in Google, its position changes, top pages, subdomains and organic competitors.">
          <ToolSearch placeholder="Enter a domain, e.g. example.com" />
        </PageHeader>
        {q && <Callout tone="warning" className="mb-4">“{q}” is not a valid domain. Enter something like example.com.</Callout>}
        <Card>
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" />}
            title="Explore a competitor's organic search strategy"
            description="Try one of these examples:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((e) => (
                  <ButtonLink key={e} href={`/organic-research?q=${e}&db=${e.endsWith(".in") ? "IN" : db}`} size="sm">
                    {e}
                  </ButtonLink>
                ))}
              </div>
            }
          />
        </Card>
      </Page>
    );

  if (!liveEnabled()) {
    const own = await ownSiteFor(user.id, domain);
    if (own?.link.gscSite) {
      const range = ownRange(spStr(sp.range));
      const res = await settle(getOwnSearch(user.id, own, range.id));
      const base = `/organic-research?q=${encodeURIComponent(domain)}&db=${db}`;
      const insights = `/organic-traffic-insights?project=${own.project.id}`;
      return (
        <Page>
          <PageHeader
            breadcrumbs={CRUMBS}
            title="Organic Research:"
            subject={domain}
            meta={
              <>
                {res.data && <DataSourceBadge source="search-console" fetchedAt={res.data.fetchedAt} note={res.data.data.site} />}
                <Badge tone="brand">Your site · {own.project.name}</Badge>
              </>
            }
            actions={
              <>
                <ButtonLink href={`/domain-overview?q=${domain}&db=${db}&range=${range.id}`} variant="secondary">
                  Domain Overview
                </ButtonLink>
                <PrintButton />
              </>
            }
          >
            <ToolSearch placeholder="Enter a domain" keep={["tab", "range"]} />
          </PageHeader>
          {res.error && <Callout tone="critical" title="Search Console data could not be loaded">{res.error} <Link href={insights} className="text-link hover:underline">Check the connection</Link></Callout>}
          {res.data && (
            <>
              <RangeBar base={`${base}&tab=${tab}`} report={res.data.data} rangeId={range.id} />
              <SearchMetrics r={res.data.data} />
              <TabsNav
                className="mb-4"
                items={[
                  { href: "/organic-research", label: "Overview" },
                  { href: "/organic-research?tab=positions", label: "Positions", count: compact(res.data.data.queries.filter((x) => x.position != null).length) },
                  { href: "/organic-research?tab=changes", label: "Position changes" },
                  { href: "/organic-research?tab=competitors", label: "Competitors" },
                  { href: "/organic-research?tab=pages", label: "Pages", count: compact(res.data.data.pages.length) },
                  { href: "/organic-research?tab=subdomains", label: "Subdomains" },
                ]}
              />
              <OwnOrganicResearch r={res.data.data} tab={tab} db={db} base={base} url={url} status={spStr(sp.status)} domain={domain} />
            </>
          )}
        </Page>
      );
    }
    if (!demoAllowed())
      return (
        <Page>
          <PageHeader breadcrumbs={CRUMBS} title="Organic Research:" subject={domain}>
            <ToolSearch placeholder="Enter a domain" keep={["tab"]} />
          </PageHeader>
          {own && !own.link.gscSite && (
            <Callout tone="info" className="mb-4" title="Only GA4 is linked for this site">
              Organic Research uses Search Console. <Link href={`/organic-traffic-insights?project=${own.project.id}&edit=1`} className="text-link hover:underline">Link a Search Console property</Link>.
            </Callout>
          )}
          <NoSearchSource domain={domain} tool="Organic Research" />
        </Page>
      );
  }

  const { data: s, source, fetchedAt } = await getOrganicSummary(user.id, domain, db);
  const info = database(db);
  const base = `/organic-research?q=${encodeURIComponent(domain)}&db=${db}`;
  const history = s.history.map((h) => ({
    month: h.month,
    traffic: h.organicTraffic,
    keywords: h.organicKeywords,
    top3: h.top3,
    top4_10: Math.max(0, h.top10 - h.top3),
    top11_20: Math.max(0, h.top20 - h.top10),
    top21_100: Math.max(0, h.top100 - h.top20),
  }));
  const brandedPct = (s.brandedTraffic.branded / Math.max(1, s.brandedTraffic.branded + s.brandedTraffic.nonBranded)) * 100;
  const last = s.history[s.history.length - 1];

  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Organic Research:"
        subject={domain}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            {s.topicName && <Badge tone="brand">{s.topicName}</Badge>}
          </>
        }
        actions={
          <>
            <ButtonLink href={`/domain-overview?q=${domain}&db=${db}`} variant="secondary">
              Domain Overview
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain" keep={["tab"]} />
      </PageHeader>

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Keywords" value={compact(s.organic.keywords)} delta={s.organic.keywordsChangePct} deltaLabel="vs last month" info="Keywords the domain ranks for in Google's top 100 in this database." href={`${base}&tab=positions`} />
          <Metric label="Traffic" value={compact(s.organic.traffic)} delta={s.organic.trafficChangePct} info="Estimated monthly visits from organic search." />
          <Metric label="Traffic cost" value={money(s.organic.trafficCost)} info="What the organic traffic would cost with Google Ads at the keywords' CPC." />
          <Metric label="Branded traffic" value={pct(brandedPct)} sub={`${pct(100 - brandedPct)} non-branded`} info="Share of organic traffic from keywords that contain the brand name." />
          <Metric label="Top 3 keywords" value={last ? compact(last.top3) : "n/a"} sub={last ? `${compact(last.top10)} in top 10` : undefined} />
        </MetricStrip>
      </Card>

      <TabsNav
        className="mb-4"
        items={[
          { href: "/organic-research", label: "Overview" },
          { href: "/organic-research?tab=positions", label: "Positions", count: compact(s.organic.keywords) },
          { href: "/organic-research?tab=changes", label: "Position changes" },
          { href: "/organic-research?tab=competitors", label: "Competitors" },
          { href: "/organic-research?tab=pages", label: "Pages" },
          { href: "/organic-research?tab=subdomains", label: "Subdomains" },
        ]}
      />

      {tab === "overview" && <Overview ownerId={user.id} domain={domain} db={db} s={s} history={history} base={base} />}
      {tab === "positions" && <Positions ownerId={user.id} domain={domain} db={db} history={history} url={url} total={s.organic.keywords} />}
      {tab === "changes" && <Changes ownerId={user.id} domain={domain} db={db} />}
      {tab === "competitors" && <Competitors ownerId={user.id} domain={domain} db={db} s={s} />}
      {tab === "pages" && <Pages ownerId={user.id} domain={domain} db={db} base={base} />}
      {tab === "subdomains" && <Subdomains ownerId={user.id} domain={domain} db={db} base={base} />}

      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

type HistoryRow = { month: string; traffic: number; keywords: number; top3: number; top4_10: number; top11_20: number; top21_100: number };

const TREND_VIEWS = [
  { id: "traffic", label: "Traffic", type: "area" as const, series: [{ key: "traffic", label: "Organic traffic" }] },
  {
    id: "keywords",
    label: "Keywords by position",
    type: "stacked" as const,
    series: [
      { key: "top3", label: "Top 3" },
      { key: "top4_10", label: "4–10" },
      { key: "top11_20", label: "11–20" },
      { key: "top21_100", label: "21–100" },
    ],
  },
];

// ------------------------------------------------------------------------------------------------ Overview

async function Overview({ ownerId, domain, db, s, history, base }: { ownerId: string; domain: string; db: string; s: DomainOverview; history: HistoryRow[]; base: string }) {
  const [{ data: changes }, { data: competitors }] = await Promise.all([getOrganicChanges(ownerId, domain, db), getOrganicCompetitors(ownerId, domain, db)]);
  const intentTotal = s.intents.reduce((a, i) => a + i.keywords, 0) || 1;
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Organic trend" description="Last 24 months" />
          <CardBody>
            <MetricTrend data={history} views={TREND_VIEWS} height={250} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Position distribution" description="Keywords by ranking band" href={`${base}&tab=positions`} />
          <CardBody>
            <BarChart data={s.positionBuckets} xKey="label" series={[{ key: "keywords", label: "Keywords" }]} valueLabels height={170} />
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[12.5px] font-medium text-text-2">Keywords by intent</div>
              <DistributionBar segments={s.intents.map((i, idx) => ({ label: `${INTENT_META[i.intent].label} · ${compact(i.keywords)}`, value: i.keywords, color: `var(--series-${idx + 1})` }))} format={(v) => pct((v / intentTotal) * 100)} />
            </div>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Top organic keywords" description="By estimated traffic" href={`${base}&tab=positions`} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Keyword" }, { header: "Intent" }, { header: "Pos.", align: "right" }, { header: "Volume", align: "right" }, { header: "KD %", align: "right" }, { header: "Traffic %", align: "right" }]}
              rows={s.topKeywords.slice(0, 8).map((k) => [
                <KeywordLink key="k" keyword={k.keyword} db={db} />,
                <IntentBadges key="i" intents={k.intents} />,
                <span key="p" className="inline-flex items-center gap-1.5">
                  {k.position}
                  <PositionChange previous={k.previousPosition} current={k.position} compact />
                </span>,
                compact(k.volume),
                <KdBadge key="kd" kd={k.kd} />,
                pct(k.trafficPct, 2),
              ])}
            />
          </CardBody>
          <CardFooter>
            <Link href={`${base}&tab=positions`} className="text-link hover:underline">
              View all {compact(s.organic.keywords)} keywords →
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader title="Position changes" description="Compared with last month" href={`${base}&tab=changes`} />
          <CardBody>
            <div className="grid grid-cols-2 gap-2.5">
              {(["improved", "declined", "new", "lost"] as const).map((t) => (
                <Link key={t} href={`${base}&tab=changes`} className="rounded-md border border-border p-3 hover:bg-surface-2">
                  <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: CHANGE_META[t].color }} aria-hidden />
                    {CHANGE_META[t].label}
                  </div>
                  <div className="mt-1 text-[20px] font-semibold tracking-tight">{compact(changes.counts[t])}</div>
                </Link>
              ))}
            </div>
            {changes.trend.length > 0 && <BarChart
              className="mt-4"
              data={changes.trend.slice(-6)}
              xKey="month"
              xFormat="monthShort"
              series={(["improved", "declined", "new", "lost"] as const).map((t) => ({ key: t, label: CHANGE_META[t].label, color: CHANGE_META[t].color }))}
              height={150}
              showLegend={false}
            />}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Main organic competitors" description={`${competitors.length} competitors found`} href={`${base}&tab=competitors`} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Competitor" }, { header: "Com. level", className: "w-28" }, { header: "Common kw", align: "right" }, { header: "SE keywords", align: "right" }, { header: "SE traffic", align: "right" }]}
              rows={competitors.slice(0, 8).map((c) => [
                <DomainLink key="d" domain={c.domain} db={db} />,
                <Bar key="b" value={c.competitionLevel * 100} className="w-20" />,
                compact(c.commonKeywords),
                compact(c.organicKeywords),
                compact(c.organicTraffic),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Competitive positioning map" info="Organic keywords vs organic traffic (log scales); bubble size is traffic." />
          <CardBody>
            <BubbleChart
              xLabel="Organic keywords"
              yLabel="Organic traffic"
              zLabel="Traffic"
              log
              height={290}
              points={[
                { label: domain, x: Math.max(1, s.organic.keywords), y: Math.max(1, s.organic.traffic), z: s.organic.traffic, highlight: true },
                ...competitors.slice(0, 7).map((c) => ({ label: c.domain, x: Math.max(1, c.organicKeywords), y: Math.max(1, c.organicTraffic), z: c.organicTraffic })),
              ]}
            />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Top pages" href={`${base}&tab=pages`} />
          <CardBody>
            <MiniTable
              columns={[{ header: "URL" }, { header: "Traffic %", align: "right" }]}
              rows={s.topPages.slice(0, 7).map((p) => [
                <Link key="u" href={`${base}&tab=positions&url=${encodeURIComponent(p.url)}`} className="block max-w-[260px] truncate text-link hover:underline" title={p.url}>
                  {displayUrl(p.url)}
                </Link>,
                pct(p.trafficPct),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traffic by country" info="Organic traffic per regional database." />
          <CardBody>
            <MiniTable
              empty="Country split is not available from the connected provider."
              columns={[{ header: "Country" }, { header: "Share", className: "w-24" }, { header: "Traffic", align: "right" }]}
              rows={s.countries.slice(0, 7).map((c) => [
                <Link key="c" href={`/organic-research?q=${domain}&db=${c.db}`} className={c.db === db ? "font-semibold text-text" : "text-link hover:underline"}>
                  {c.flag} {c.name}
                </Link>,
                <Bar key="b" value={c.share} max={s.countries[0].share} className="w-16" />,
                compact(c.traffic),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="SERP features" description="Keywords triggering each feature" />
          <CardBody>
            {s.serpFeatures.length ? (
              <ul className="space-y-2">
                {s.serpFeatures.slice(0, 7).map((f) => (
                  <li key={f.feature} className="grid grid-cols-[18px_1fr_70px_48px] items-center gap-2 text-[12.5px]">
                    <span className="text-text-3">
                      <FeatureIcon feature={f.feature} />
                    </span>
                    <span className="truncate text-text-2">{featureLabel(f.feature)}</span>
                    <Bar value={f.keywords} max={s.serpFeatures[0].keywords} />
                    <span className="tabular text-right">{compact(f.keywords)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">No SERP feature data.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Positions

async function Positions({ ownerId, domain, db, history, url, total }: { ownerId: string; domain: string; db: string; history: HistoryRow[]; url: string; total: number }) {
  const { data: rows } = await getOrganicPositions(ownerId, domain, db);
  return (
    <>
      <Card className="mb-4">
        <CardHeader title="Organic keywords trend" description="Keywords in Google's top 100 and the traffic they bring" />
        <CardBody>
          <MetricTrend data={history} views={[TREND_VIEWS[1], TREND_VIEWS[0]]} height={190} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Organic positions" description="Filter, sort, export, or select keywords to add them to a keyword list." />
        <PositionsTable rows={rows} db={db} domain={domain} initialUrl={url} totalKeywords={total} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Changes

async function Changes({ ownerId, domain, db }: { ownerId: string; domain: string; db: string }) {
  const { data } = await getOrganicChanges(ownerId, domain, db);
  const kinds = ["improved", "declined", "new", "lost"] as const;
  const trafficDelta = (t: (typeof kinds)[number]) => data.rows.filter((r) => r.type === t).reduce((a, r) => a + r.trafficChange, 0);
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader title="Summary" description="Changes compared with last month, in the analyzed keyword sample" />
          <CardBody className="grid grid-cols-2 gap-3">
            {kinds.map((t) => (
              <div key={t} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHANGE_META[t].color }} aria-hidden />
                  {CHANGE_META[t].label} keywords
                </div>
                <div className="mt-1 text-[22px] font-semibold tracking-tight">{compact(data.counts[t])}</div>
                <div className="text-[12px] text-text-3">
                  Traffic {trafficDelta(t) >= 0 ? "+" : "−"}
                  {compact(Math.abs(trafficDelta(t)))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Position changes trend" description="Keywords per change type, last 12 months" />
          <CardBody>
            {data.trend.length ? (
              <BarChart data={data.trend} xKey="month" xFormat="monthShort" series={kinds.map((t) => ({ key: t, label: CHANGE_META[t].label, color: CHANGE_META[t].color }))} height={250} />
            ) : (
              <p className="py-10 text-center text-[13px] text-text-3">Monthly change history is not available from the connected provider.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Keyword changes" description="Select keywords to add them to a keyword list" />
        <PositionChangesTables rows={data.rows} db={db} exportName={`${domain}-position-changes-${db}`} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Competitors

async function Competitors({ ownerId, domain, db, s }: { ownerId: string; domain: string; db: string; s: DomainOverview }) {
  const { data: rows } = await getOrganicCompetitors(ownerId, domain, db);
  const top = rows.slice(0, 10);
  return (
    <>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Competitive positioning map" info="Organic keywords vs organic traffic (log scales); bubble size is traffic." />
          <CardBody>
            <BubbleChart
              xLabel="Organic keywords"
              yLabel="Organic traffic"
              zLabel="Traffic"
              log
              height={320}
              points={[
                { label: domain, x: Math.max(1, s.organic.keywords), y: Math.max(1, s.organic.traffic), z: s.organic.traffic, highlight: true },
                ...rows.slice(0, 9).map((c) => ({ label: c.domain, x: Math.max(1, c.organicKeywords), y: Math.max(1, c.organicTraffic), z: c.organicTraffic })),
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Competition level" info="Share of keywords the two domains have in common relative to their combined keyword sets." />
          <CardBody>
            <ul className="space-y-2.5">
              {top.map((c) => (
                <li key={c.domain} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1.3fr)_44px_64px] items-center gap-3 text-[13px]">
                  <DomainLink domain={c.domain} db={db} />
                  <Bar value={c.competitionLevel * 100} />
                  <span className="tabular text-right font-medium">{Math.round(c.competitionLevel * 100)}%</span>
                  <span className="tabular text-right text-text-3" title="Common keywords">
                    {compact(c.commonKeywords)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-text-3">Right column: common keywords.</p>
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader
          title="Organic competitors"
          description={`${rows.length} domains competing for the same keywords`}
          actions={
            <ButtonLink href={compareHref("/keyword-gap", [domain, ...rows.slice(0, 4).map((c) => c.domain)], { db })} size="sm" variant="secondary">
              Keyword Gap with top 4 <ArrowRight className="h-3.5 w-3.5" />
            </ButtonLink>
          }
        />
        <AutoTable
          rows={rows.map((c) => ({ ...c }))}
          rowKey="domain"
          db={db}
          columns={[
            { key: "domain", header: "Competitor", type: "domain", href: `/organic-research?q={domain}&db=${db}` },
            { key: "competitionLevel", header: "Com. level", type: "level", info: "Competition level based on keyword overlap." },
            { key: "commonKeywords", header: "Common keywords", type: "compact" },
            { key: "organicKeywords", header: "SE keywords", type: "compact", info: "Keywords in Google's top 100." },
            { key: "organicTraffic", header: "SE traffic", type: "compact" },
            { key: "trafficCost", header: "SE traffic cost", type: "money" },
            { key: "paidKeywords", header: "Paid keywords", type: "compact" },
            { key: "authorityScore", header: "AS", type: "as" },
          ]}
          defaultSort={{ key: "competitionLevel", dir: "desc" }}
          exportName={`${domain}-organic-competitors-${db}`}
          searchable
          searchKeys={["domain"]}
          searchPlaceholder="Filter by domain"
          selection={{ type: "keyword-gap", key: "domain", base: domain, db }}
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Pages

async function Pages({ ownerId, domain, db, base }: { ownerId: string; domain: string; db: string; base: string }) {
  const { data: rows } = await getOrganicPages(ownerId, domain, db);
  const top = rows.slice(0, 10).map((p) => ({ page: displayUrl(p.url).replace(/^www\./, "").slice(0, 38), share: p.trafficPct }));
  return (
    <>
      <Card className="mb-4">
        <CardHeader title="Traffic share of top pages" description={`${rows.length} pages rank in the analyzed sample`} />
        <CardBody>
          <BarChart data={top} xKey="page" layout="bars" series={[{ key: "share", label: "Traffic share" }]} yFormat="percent" valueLabels categoryWidth={230} height={Math.max(160, top.length * 28)} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Top pages" description="Click the keyword count to see the positions of a page." />
        <AutoTable
          rows={rows.map((p) => ({ ...p }))}
          rowKey="url"
          db={db}
          columns={[
            { key: "url", header: "URL", type: "url" },
            { key: "traffic", header: "Traffic", type: "compact" },
            { key: "trafficPct", header: "Traffic %", type: "share", max: rows[0]?.trafficPct || 100 },
            { key: "keywords", header: "Keywords", type: "link", href: `${base}&tab=positions&url={url}`, align: "right" },
            { key: "topKeyword", header: "Top keyword", type: "keyword" },
            { key: "backlinks", header: "Backlinks", type: "compact" },
          ]}
          defaultSort={{ key: "traffic", dir: "desc" }}
          exportName={`${domain}-organic-pages-${db}`}
          searchable
          searchKeys={["url", "topKeyword"]}
          searchPlaceholder="Filter by URL"
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Subdomains

async function Subdomains({ ownerId, domain, db, base }: { ownerId: string; domain: string; db: string; base: string }) {
  const { data: rows } = await getOrganicSubdomains(ownerId, domain, db);
  return (
    <Grid cols={2} className="lg:grid-cols-[1fr_2fr]">
      <Card>
        <CardHeader title="Traffic by subdomain" />
        <CardBody>
          <DonutChart legend="bottom" size={150} data={rows.map((r) => ({ label: r.subdomain, value: r.traffic }))} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Subdomains" description={`${rows.length} subdomains rank in organic search`} />
        <AutoTable
          rows={rows.map((r) => ({ ...r, prefix: `https://${r.subdomain}/` }))}
          rowKey="subdomain"
          db={db}
          columns={[
            { key: "subdomain", header: "Subdomain" },
            { key: "traffic", header: "Traffic", type: "compact" },
            { key: "trafficPct", header: "Traffic %", type: "share", max: rows[0]?.trafficPct || 100 },
            { key: "keywords", header: "Keywords", type: "link", href: `${base}&tab=positions&url={prefix}`, align: "right" },
          ]}
          defaultSort={{ key: "traffic", dir: "desc" }}
          exportName={`${domain}-subdomains-${db}`}
        />
      </Card>
    </Grid>
  );
}
