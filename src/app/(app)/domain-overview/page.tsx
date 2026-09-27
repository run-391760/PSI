import { ArrowRight, Globe } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getDomainOverview } from "@/lib/competitive/domain-overview";
import { getOwnSearch, getOwnTraffic, ownSiteFor, settle } from "@/lib/competitive/own-site";
import { ownRange } from "@/lib/competitive/own-site-map";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { NoSearchSource, OwnDomainOverview, RangeBar } from "@/components/competitive/own-search-view";
import { database, tryRootDomain } from "@/lib/domain";
import { compact, displayUrl, money, pct } from "@/lib/format";
import { featureLabel, FeatureIcon, INTENT_META, DomainLink, KeywordLink, KdBadge, IntentBadges, AsBadge } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { BubbleChart } from "@/components/charts/bubble-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { MONTH_RANGES, TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { Bar, DistributionBar, ScoreRing } from "@/components/ui/progress";
import { NewProjectButton } from "@/components/projects/project-form";

export const metadata: Metadata = { title: "Domain Overview" };

const CRUMBS = [{ label: "Competitive research" }, { label: "Domain Overview", href: "/domain-overview" }];
const EXAMPLES = ["nike.com", "zillow.com", "healthline.com", "coursera.org", "paruluniversity.ac.in"];

export default async function DomainOverviewPage({ searchParams }: PageProps<"/domain-overview">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const domain = tryRootDomain(q);

  if (!domain)
    return (
      <Page>
        <PageHeader title="Domain Overview" description="Get an instant picture of any domain: authority, organic and paid traffic, keywords, backlinks and main competitors.">
          <ToolSearch placeholder="Enter a domain, e.g. example.com" />
        </PageHeader>
        {q && <Callout tone="warning">“{q}” is not a valid domain. Enter something like example.com.</Callout>}
        <Card>
          <EmptyState
            icon={<Globe className="h-5 w-5" />}
            title="Analyze any website"
            description="Try one of these examples:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((e) => (
                  <ButtonLink key={e} href={`/domain-overview?q=${e}&db=${db}`} size="sm">
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
    if (own) return <OwnSiteOverview userId={user.id} own={own} domain={domain} db={db} rangeParam={typeof sp.range === "string" ? sp.range : undefined} />;
    if (!demoAllowed())
      return (
        <Page>
          <PageHeader breadcrumbs={CRUMBS} title="Domain Overview:" subject={domain} actions={<NewProjectButton variant="secondary" label="Create project" defaultDomain={domain} />}>
            <ToolSearch placeholder="Enter a domain" />
          </PageHeader>
          <NoSearchSource domain={domain} tool="Domain Overview" />
        </Page>
      );
  }

  const { data: d, source, fetchedAt } = await getDomainOverview(user.id, domain, db);
  const info = database(db);
  const link = (path: string) => `${path}?q=${encodeURIComponent(domain)}&db=${db}`;
  const history = d.history.map((h) => ({
    month: h.month,
    organic: h.organicTraffic,
    paid: h.paidTraffic,
    top3: h.top3,
    top4_10: Math.max(0, h.top10 - h.top3),
    top11_20: Math.max(0, h.top20 - h.top10),
    top21_100: Math.max(0, h.top100 - h.top20),
    referringDomains: h.referringDomains,
    backlinks: h.backlinks,
  }));
  const intentTotal = d.intents.reduce((s, i) => s + i.keywords, 0) || 1;

  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Domain Overview:"
        subject={domain}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            {d.topicName && <Badge tone="brand">{d.topicName}</Badge>}
          </>
        }
        actions={
          <>
            <NewProjectButton variant="secondary" label="Create project" defaultDomain={domain} />
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain" />
      </PageHeader>

      <Card className="mb-4">
        <MetricStrip>
          <div className="flex items-center gap-3">
            <ScoreRing value={d.authorityScore} size={64} stroke={7} label={String(d.authorityScore)} color="var(--series-1)" />
            <Metric label="Authority Score" value={d.authorityScore} info="Compound 0–100 score of backlink profile quality, organic traffic and link spam signals." href={link("/backlink-analytics")} />
          </div>
          <Metric label="Organic search traffic" value={compact(d.organic.traffic)} delta={d.organic.trafficChangePct} deltaLabel="vs last month" href={link("/organic-research")} sub={`Traffic cost ${money(d.organic.trafficCost)}`} />
          <Metric label="Organic keywords" value={compact(d.organic.keywords)} delta={d.organic.keywordsChangePct} href={link("/organic-research")} sub="In Google top 100" />
          <Metric label="Paid search traffic" value={compact(d.paid.traffic)} href={link("/advertising-research")} sub={`${compact(d.paid.keywords)} paid keywords`} />
          <Metric label="Referring domains" value={compact(d.backlinks.referringDomains)} href={link("/backlink-analytics")} sub={`${compact(d.backlinks.total)} backlinks`} />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader title="Distribution by country" info="Estimated organic traffic per regional database." />
          <CardBody>
            {d.countries.length ? (
              <MiniTable
                columns={[{ header: "Country" }, { header: "Share", className: "w-28" }, { header: "Traffic", align: "right" }, { header: "Keywords", align: "right" }]}
                rows={d.countries.slice(0, 7).map((c) => [
                  <Link key="c" href={`/domain-overview?q=${domain}&db=${c.db}`} className={c.db === db ? "font-semibold text-text" : "text-link hover:underline"}>
                    {c.flag} {c.name}
                  </Link>,
                  <div key="s" className="flex items-center gap-2">
                    <Bar value={c.share} className="w-16" />
                    <span className="tabular text-[12px] text-text-2">{c.share}%</span>
                  </div>,
                  compact(c.traffic),
                  compact(c.keywords),
                ])}
              />
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">Country split is not available from the connected provider.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traffic trend" description="Estimated monthly visits from Google search" actions={<ButtonLink href={link("/organic-research")} size="sm" variant="ghost">Details <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>} />
          <CardBody>
            <TrendChart data={history} xKey="month" series={[{ key: "organic", label: "Organic traffic" }, { key: "paid", label: "Paid traffic" }]} ranges={MONTH_RANGES} defaultRange="1y" type="area" height={250} />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Organic keywords trend" description="Keywords by position band" />
          <CardBody>
            <TrendChart
              data={history}
              xKey="month"
              type="stacked"
              series={[
                { key: "top3", label: "Top 3" },
                { key: "top4_10", label: "4–10" },
                { key: "top11_20", label: "11–20" },
                { key: "top21_100", label: "21–100" },
              ]}
              ranges={MONTH_RANGES}
              defaultRange="1y"
              height={230}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Organic position distribution" description="How many keywords rank in each position band" />
          <CardBody>
            <BarChart data={d.positionBuckets} xKey="label" series={[{ key: "keywords", label: "Keywords" }]} valueLabels height={250} />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Top organic keywords" description={`${compact(d.organic.keywords)} keywords`} href={link("/organic-research")} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Keyword" }, { header: "Intent" }, { header: "Pos.", align: "right" }, { header: "Volume", align: "right" }, { header: "KD %", align: "right" }, { header: "CPC", align: "right" }, { header: "Traffic %", align: "right" }]}
              rows={d.topKeywords.slice(0, 7).map((k) => [
                <KeywordLink key="k" keyword={k.keyword} db={db} />,
                <IntentBadges key="i" intents={k.intents} />,
                k.position,
                compact(k.volume),
                <KdBadge key="kd" kd={k.kd} />,
                money(k.cpc),
                pct(k.trafficPct, 2),
              ])}
            />
          </CardBody>
          <CardFooter>
            <Link href={link("/organic-research")} className="text-link hover:underline">
              View all organic keywords →
            </Link>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader title="Keywords by intent" info="Share of ranking keywords by the primary search intent." />
          <CardBody>
            <DistributionBar
              segments={d.intents.map((i, idx) => ({ label: `${INTENT_META[i.intent].label} · ${compact(i.keywords)} kw`, value: i.keywords, color: `var(--series-${idx + 1})` }))}
              format={(v) => pct((v / intentTotal) * 100)}
            />
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 text-[12.5px] font-medium text-text-2">Branded vs non-branded traffic</div>
              <DonutChart
                size={110}
                data={[
                  { label: "Non-branded", value: d.brandedTraffic.nonBranded },
                  { label: "Branded", value: d.brandedTraffic.branded },
                ]}
              />
            </div>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Main organic competitors" description={`${d.competitors.length} competitors`} href={link("/organic-research") + "&tab=competitors"} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Competitor" }, { header: "Com. level", className: "w-32" }, { header: "Common kw", align: "right" }, { header: "SE keywords", align: "right" }]}
              rows={d.competitors.slice(0, 8).map((c) => [
                <DomainLink key="d" domain={c.domain} db={db} />,
                <Bar key="b" value={c.competitionLevel * 100} className="w-24" />,
                compact(c.commonKeywords),
                compact(c.organicKeywords),
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Competitive positioning map" info="Organic keywords vs. organic traffic; bubble size is traffic." />
          <CardBody>
            <BubbleChart
              xLabel="Organic keywords"
              yLabel="Organic traffic"
              zLabel="Traffic"
              log
              points={[{ label: domain, x: Math.max(1, d.organic.keywords), y: Math.max(1, d.organic.traffic), z: d.organic.traffic, highlight: true }, ...d.competitors.slice(0, 7).map((c) => ({ label: c.domain, x: Math.max(1, c.organicKeywords), y: Math.max(1, c.organicTraffic), z: c.organicTraffic }))]}
              height={300}
            />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="SERP features" description="Keywords that trigger each feature" />
          <CardBody>
            {d.serpFeatures.length ? (
              <ul className="space-y-2">
                {d.serpFeatures.slice(0, 8).map((f) => (
                  <li key={f.feature} className="grid grid-cols-[20px_1fr_120px_56px] items-center gap-2 text-[13px]">
                    <span className="text-text-3">
                      <FeatureIcon feature={f.feature} />
                    </span>
                    <span className="truncate text-text-2">{featureLabel(f.feature)}</span>
                    <Bar value={f.keywords} max={d.serpFeatures[0].keywords} />
                    <span className="tabular text-right text-text">{compact(f.keywords)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-text-3">No SERP feature data.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top pages" href={link("/organic-research") + "&tab=pages"} />
          <CardBody>
            <MiniTable
              columns={[{ header: "URL" }, { header: "Traffic", align: "right" }, { header: "Keywords", align: "right" }]}
              rows={d.topPages.slice(0, 7).map((p) => [
                <a key="u" href={p.url} target="_blank" rel="noopener noreferrer" className="block max-w-[340px] truncate text-link hover:underline" title={p.url}>
                  {displayUrl(p.url)}
                </a>,
                compact(p.traffic),
                compact(p.keywords),
              ])}
            />
          </CardBody>
        </Card>
      </Grid>

      <h2 className="mt-7 mb-3 text-[16px] font-semibold">Paid search</h2>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Top paid keywords" description={`${compact(d.paid.keywords)} keywords · ${money(d.paid.trafficCost)} est. monthly spend`} href={link("/advertising-research")} />
          <CardBody>
            <MiniTable
              empty="This domain does not appear to run search ads."
              columns={[{ header: "Keyword" }, { header: "Pos.", align: "right" }, { header: "Volume", align: "right" }, { header: "CPC", align: "right" }, { header: "Traffic", align: "right" }]}
              rows={d.paidKeywords.slice(0, 6).map((k) => [<KeywordLink key="k" keyword={k.keyword} db={db} />, k.position, compact(k.volume), money(k.cpc), compact(k.traffic)])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sample text ads" />
          <CardBody className="space-y-3">
            {d.ads.length === 0 && <p className="py-6 text-center text-[13px] text-text-3">No ads found.</p>}
            {d.ads.map((a) => (
              <div key={a.keyword} className="rounded-md border border-border p-3">
                <div className="text-[11.5px] text-text-3">
                  <span className="mr-1.5 font-semibold text-text">Sponsored</span>
                  {displayUrl(a.url.split("?")[0])}
                </div>
                <div className="mt-0.5 text-[14px] text-link">{a.title}</div>
                <div className="text-[12.5px] text-text-2">{a.description}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </Grid>

      <h2 className="mt-7 mb-3 text-[16px] font-semibold">Backlinks</h2>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Referring domains" description={`${compact(d.backlinks.referringDomains)} domains · ${compact(d.backlinks.total)} backlinks`} href={link("/backlink-analytics")} />
          <CardBody>
            <TrendChart data={history} xKey="month" series={[{ key: "referringDomains", label: "Referring domains" }]} ranges={MONTH_RANGES} defaultRange="2y" type="area" height={220} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Follow vs nofollow" />
          <CardBody>
            <DonutChart
              size={120}
              centerValue={pct(d.backlinks.followRatio * 100, 0)}
              centerLabel="follow"
              data={[
                { label: "Follow", value: Math.round(d.backlinks.total * d.backlinks.followRatio) },
                { label: "Nofollow", value: Math.round(d.backlinks.total * (1 - d.backlinks.followRatio)) },
              ]}
            />
            {d.linkTypes.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-2 text-[12.5px] font-medium text-text-2">Backlink types</div>
                <DistributionBar segments={d.linkTypes.map((t, i) => ({ label: t.type[0].toUpperCase() + t.type.slice(1), value: t.count, color: `var(--series-${i + 1})` }))} format={(v, s) => `${compact(v)} · ${s.toFixed(1)}%`} />
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Top anchors" href={link("/backlink-analytics") + "&tab=anchors"} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Anchor" }, { header: "Domains", align: "right" }, { header: "Backlinks", align: "right" }]}
              rows={d.anchors.slice(0, 7).map((a) => [<span key="a" className="block max-w-[320px] truncate">{a.anchor}</span>, compact(a.referringDomains), compact(a.backlinks)])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top referring domains" href={link("/backlink-analytics") + "&tab=referring-domains"} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Backlinks", align: "right" }, { header: "First seen", align: "right" }]}
              rows={d.referringDomains.slice(0, 7).map((r) => [<DomainLink key="d" domain={r.domain} />, <AsBadge key="as" score={r.authorityScore} />, compact(r.backlinks), r.firstSeen])}
            />
          </CardBody>
        </Card>
      </Grid>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

/** Real "your site" overview from Search Console (+GA4) for a domain linked in one of the user's projects. */
async function OwnSiteOverview({ userId, own, domain, db, rangeParam }: { userId: string; own: NonNullable<Awaited<ReturnType<typeof ownSiteFor>>>; domain: string; db: string; rangeParam?: string }) {
  const range = ownRange(rangeParam);
  const [search, traffic] = await Promise.all([
    own.link.gscSite ? settle(getOwnSearch(userId, own, range.id)) : Promise.resolve(null),
    own.link.ga4Property ? settle(getOwnTraffic(userId, own.link.ga4Property, range.id)) : Promise.resolve(null),
  ]);
  const base = `/domain-overview?q=${encodeURIComponent(domain)}&db=${db}`;
  const orgBase = `/organic-research?q=${encodeURIComponent(domain)}&db=${db}&range=${range.id}`;
  const insights = `/organic-traffic-insights?project=${own.project.id}`;
  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Domain Overview:"
        subject={domain}
        meta={
          <>
            {search?.data && <DataSourceBadge source="search-console" fetchedAt={search.data.fetchedAt} note={search.data.data.site} />}
            {traffic?.data && <DataSourceBadge source="google-analytics" fetchedAt={traffic.data.fetchedAt} note={own.link.ga4PropertyName ?? traffic.data.data.property} />}
            <Badge tone="brand">Your site · {own.project.name}</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={insights} variant="secondary">
              Organic Traffic Insights
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain" />
      </PageHeader>
      {search?.error && <Callout tone="critical" className="mb-4" title="Search Console data could not be loaded">{search.error}</Callout>}
      {traffic?.error && <Callout tone="warning" className="mb-4" title="Google Analytics data could not be loaded">{traffic.error}</Callout>}
      {!own.link.gscSite && (
        <Callout tone="info" className="mb-4" title="Link Search Console for search data">
          Only GA4 is linked for this project. <Link href={`${insights}&edit=1`} className="text-link hover:underline">Link a Search Console property</Link> to see clicks, queries and positions.
        </Callout>
      )}
      {search?.data ? (
        <>
          <RangeBar base={base} report={search.data.data} rangeId={range.id} />
          <OwnDomainOverview r={search.data.data} traffic={traffic?.data?.data ?? null} db={db} orgBase={orgBase} trafficHref={`/traffic-analytics?q=${encodeURIComponent(domain)}&range=${range.id}`} />
        </>
      ) : (
        traffic?.data && (
          <Card className="mb-4">
            <CardHeader title="Site traffic (GA4)" href={`/traffic-analytics?q=${encodeURIComponent(domain)}`} />
            <MetricStrip>
              <Metric label="Sessions" value={compact(traffic.data.data.totals.sessions)} />
              <Metric label="Users" value={compact(traffic.data.data.totals.users)} />
              <Metric label="Key events" value={compact(traffic.data.data.totals.keyEvents)} />
            </MetricStrip>
          </Card>
        )
      )}
      <p className="mt-2 text-[12px] text-text-3">Your own data from Google, read-only. Nothing on this page is estimated; search volume, competitors and backlinks need DataForSEO.</p>
    </Page>
  );
}
