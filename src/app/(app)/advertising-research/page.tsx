import { ArrowRight, BadgeDollarSign, Megaphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { adCopiesFrom, adsPagesFrom, getAdsChanges, getAdsCompetitors, getAdsHistory, getAdsPositions, getAdsSummary, type AdsSummary, type PaidRow } from "@/lib/competitive/advertising-research";
import { compareHref } from "@/lib/competitive/links";
import { spStr } from "@/lib/competitive/shared";
import { database, tryRootDomain } from "@/lib/domain";
import { compact, money, pct } from "@/lib/format";
import { DomainLink, INTENT_META } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { BubbleChart } from "@/components/charts/bubble-chart";
import { AdCopies } from "@/components/competitive/ad-copies";
import { AdsHistoryGrid } from "@/components/competitive/ads-history-grid";
import { AutoTable } from "@/components/competitive/auto-table";
import { CHANGE_META, CHANGE_ORDER } from "@/components/competitive/change-meta";
import { MetricTrend } from "@/components/competitive/metric-trend";
import { PositionChangesTables } from "@/components/competitive/position-changes";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { PrintButton } from "@/components/ui/print-button";
import { Bar, DistributionBar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Advertising Research" };

const CRUMBS = [{ label: "Advertising" }, { label: "Advertising Research", href: "/advertising-research" }];
const EXAMPLES = ["nike.com", "hubspot.com", "nerdwallet.com", "booking.com", "coursera.org"];
const TABS = ["positions", "changes", "competitors", "copies", "history", "pages"] as const;
type Tab = (typeof TABS)[number];

export default async function AdvertisingResearchPage({ searchParams }: PageProps<"/advertising-research">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = spStr(sp.q);
  const db = database(spStr(sp.db) || "US").code;
  const tab: Tab = (TABS as readonly string[]).includes(spStr(sp.tab)) ? (spStr(sp.tab) as Tab) : "positions";
  const domain = tryRootDomain(q);

  if (!domain)
    return (
      <Page>
        <PageHeader breadcrumbs={CRUMBS} title="Advertising Research" description="Uncover a competitor's Google Ads strategy: paid keywords, ad positions, ad copies, landing pages, budget estimates and paid search competitors.">
          <ToolSearch placeholder="Enter a domain, e.g. example.com" />
        </PageHeader>
        {q && <Callout tone="warning" className="mb-4">“{q}” is not a valid domain. Enter something like example.com.</Callout>}
        <Card>
          <EmptyState
            icon={<Megaphone className="h-5 w-5" />}
            title="See how competitors advertise on Google"
            description="Try one of these examples:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((e) => (
                  <ButtonLink key={e} href={`/advertising-research?q=${e}&db=${db}`} size="sm">
                    {e}
                  </ButtonLink>
                ))}
              </div>
            }
          />
        </Card>
      </Page>
    );

  const [{ data: s, source, fetchedAt }, { data: positions }] = await Promise.all([getAdsSummary(user.id, domain, db), getAdsPositions(user.id, domain, db)]);
  const info = database(db);
  const base = `/advertising-research?q=${encodeURIComponent(domain)}&db=${db}`;
  const avgCpc = s.paidTraffic ? s.paidTrafficCost / s.paidTraffic : null;
  const copies = adCopiesFrom(domain, positions, source !== "demo");
  const noAds = positions.length === 0 && s.paidKeywords === 0;

  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Advertising Research:"
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
            <ButtonLink href={`/organic-research?q=${domain}&db=${db}`} variant="secondary">
              Organic Research
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain" keep={["tab"]} />
      </PageHeader>

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Paid keywords" value={compact(s.paidKeywords)} delta={s.keywordsChange} deltaLabel="vs last month" info="Keywords the domain bids on in Google Ads (top and bottom ad positions)." href={`${base}&tab=positions`} />
          <Metric label="Paid traffic" value={compact(s.paidTraffic)} delta={s.trafficChange} info="Estimated monthly clicks from Google Ads." />
          <Metric label="Traffic cost" value={money(s.paidTrafficCost)} delta={s.costChange} info="Estimated monthly Google Ads budget (clicks × CPC)." />
          <Metric label="Avg. CPC" value={avgCpc == null ? "n/a" : money(avgCpc)} info="Traffic cost divided by paid traffic." />
          <Metric label="Ad copies" value={compact(copies.length)} sub={`${compact(adsPagesFrom(positions, copies).length)} landing pages`} href={`${base}&tab=copies`} />
        </MetricStrip>
      </Card>

      <TabsNav
        className="mb-4"
        items={[
          { href: "/advertising-research", label: "Positions", count: compact(s.paidKeywords) },
          { href: "/advertising-research?tab=changes", label: "Position changes" },
          { href: "/advertising-research?tab=competitors", label: "Competitors" },
          { href: "/advertising-research?tab=copies", label: "Ads copies", count: compact(copies.length) },
          { href: "/advertising-research?tab=history", label: "Ads history" },
          { href: "/advertising-research?tab=pages", label: "Pages" },
        ]}
      />

      {noAds ? (
        <Card>
          <EmptyState
            icon={<BadgeDollarSign className="h-5 w-5" />}
            title={`No Google Ads found for ${domain} in ${info.name}`}
            description="This domain doesn't appear to run search ads in this database. Try another country or a competitor."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {["US", "GB", "IN"]
                  .filter((c) => c !== db)
                  .map((c) => (
                    <ButtonLink key={c} href={`/advertising-research?q=${domain}&db=${c}`} size="sm">
                      {database(c).flag} {database(c).name}
                    </ButtonLink>
                  ))}
              </div>
            }
          />
        </Card>
      ) : (
        <>
          {tab === "positions" && <Positions domain={domain} db={db} s={s} rows={positions} />}
          {tab === "changes" && <Changes ownerId={user.id} domain={domain} db={db} />}
          {tab === "competitors" && <Competitors ownerId={user.id} domain={domain} db={db} s={s} />}
          {tab === "copies" && (
            <Card>
              <CardHeader title="Ads copies" description="Unique text ads seen for this domain and the keywords that trigger them" />
              <AdCopies copies={copies} db={db} domain={domain} />
            </Card>
          )}
          {tab === "history" && <History ownerId={user.id} domain={domain} db={db} />}
          {tab === "pages" && <Pages domain={domain} db={db} rows={positions} base={base} copies={copies} />}
        </>
      )}
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

// ------------------------------------------------------------------------------------------------ Positions

function Positions({ domain, db, s, rows }: { domain: string; db: string; s: AdsSummary; rows: PaidRow[] }) {
  const dist = [1, 2, 3, 4].map((p) => ({ label: `#${p}`, keywords: rows.filter((r) => (p < 4 ? r.position === p : r.position >= 4)).length }));
  const intents = (["commercial", "transactional", "informational", "navigational"] as const).map((i, idx) => ({ label: INTENT_META[i].label, value: rows.filter((r) => r.intents[0] === i).length, color: `var(--series-${idx + 1})` }));
  const total = rows.length || 1;
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Paid search trend" description="Last 24 months" />
          <CardBody>
            <MetricTrend
              data={s.history}
              views={[
                { id: "traffic", label: "Paid traffic", type: "area", series: [{ key: "traffic", label: "Paid traffic" }] },
                { id: "keywords", label: "Paid keywords", type: "area", series: [{ key: "keywords", label: "Paid keywords" }] },
                { id: "cost", label: "Traffic cost", type: "area", yFormat: "money", series: [{ key: "cost", label: "Traffic cost" }] },
              ]}
              height={240}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ad position distribution" description="Keywords by ad position" />
          <CardBody>
            <BarChart data={dist} xKey="label" series={[{ key: "keywords", label: "Keywords" }]} valueLabels height={150} />
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[12.5px] font-medium text-text-2">Paid keywords by intent</div>
              <DistributionBar segments={intents} format={(v) => pct((v / total) * 100)} />
            </div>
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Paid search positions" description={`${rows.length.toLocaleString()} keywords in the analyzed sample · select keywords to add them to a keyword list`} />
        <AutoTable
          rows={rows.map((r) => ({ ...r }))}
          rowKey="keyword"
          db={db}
          columns={[
            { key: "keyword", header: "Keyword", type: "keyword" },
            { key: "intents", header: "Intent", type: "intents" },
            { key: "position", header: "Position", type: "position", prevKey: "previousPosition" },
            { key: "volume", header: "Volume", type: "compact" },
            { key: "cpc", header: "CPC", type: "money" },
            { key: "traffic", header: "Traffic", type: "compact" },
            { key: "trafficPct", header: "Traffic %", type: "percent" },
            { key: "trafficCost", header: "Cost", type: "money", info: "Estimated monthly spend on this keyword" },
            { key: "costPct", header: "Cost %", type: "percent" },
            { key: "competition", header: "Com.", type: "decimal", info: "Paid competition (0–1)" },
            { key: "url", header: "Landing page", type: "url" },
            { key: "trend", header: "Trend", type: "trend", sortable: false },
          ]}
          defaultSort={{ key: "traffic", dir: "desc" }}
          exportName={`${domain}-paid-positions-${db}`}
          searchable
          searchKeys={["keyword", "url"]}
          selection={{ type: "keyword-list", key: "keyword", db }}
          pageSize={50}
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Changes

async function Changes({ ownerId, domain, db }: { ownerId: string; domain: string; db: string }) {
  const { data } = await getAdsChanges(ownerId, domain, db);
  const delta = (t: (typeof CHANGE_ORDER)[number]) => data.rows.filter((r) => r.type === t).reduce((a, r) => a + r.trafficChange, 0);
  return (
    <>
      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader title="Summary" description="Paid keyword changes compared with last month" />
          <CardBody className="grid grid-cols-2 gap-3">
            {CHANGE_ORDER.map((t) => (
              <div key={t} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHANGE_META[t].color }} aria-hidden />
                  {CHANGE_META[t].label}
                </div>
                <div className="mt-1 text-[22px] font-semibold tracking-tight">{compact(data.counts[t])}</div>
                <div className="text-[12px] text-text-3">
                  Traffic {delta(t) >= 0 ? "+" : "−"}
                  {compact(Math.abs(delta(t)))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Position changes trend" description="Paid keywords per change type, last 12 months" />
          <CardBody>
            <BarChart data={data.trend} xKey="month" xFormat="monthShort" series={CHANGE_ORDER.map((t) => ({ key: t, label: CHANGE_META[t].label, color: CHANGE_META[t].color }))} height={240} />
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Paid keyword changes" />
        <PositionChangesTables rows={data.rows} db={db} exportName={`${domain}-paid-changes-${db}`} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Competitors

async function Competitors({ ownerId, domain, db, s }: { ownerId: string; domain: string; db: string; s: AdsSummary }) {
  const { data: rows } = await getAdsCompetitors(ownerId, domain, db);
  if (!rows.length)
    return (
      <Card>
        <EmptyState title="No paid search competitors found" description="No other advertiser bids on the same keywords in this database." />
      </Card>
    );
  return (
    <>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Paid positioning map" info="Paid keywords vs paid traffic (log scales); bubble size is traffic." />
          <CardBody>
            <BubbleChart
              xLabel="Paid keywords"
              yLabel="Paid traffic"
              zLabel="Paid traffic"
              log
              height={310}
              points={[
                { label: domain, x: Math.max(1, s.paidKeywords), y: Math.max(1, s.paidTraffic), z: s.paidTraffic, highlight: true },
                ...rows.slice(0, 9).map((c) => ({ label: c.domain, x: Math.max(1, c.paidKeywords), y: Math.max(1, c.paidTraffic), z: c.paidTraffic })),
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Competition level" info="Share of paid keywords the two domains both bid on, relative to their combined paid keywords." />
          <CardBody>
            <ul className="space-y-2.5">
              {rows.slice(0, 10).map((c) => (
                <li key={c.domain} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1.3fr)_44px_56px] items-center gap-3 text-[13px]">
                  <DomainLink domain={c.domain} db={db} />
                  <Bar value={c.competitionLevel * 100} max={Math.max(...rows.map((x) => x.competitionLevel)) * 100} />
                  <span className="tabular text-right font-medium">{Math.round(c.competitionLevel * 100)}%</span>
                  <span className="tabular text-right text-text-3" title="Common paid keywords">
                    {compact(c.commonKeywords)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-text-3">Right column: common paid keywords.</p>
          </CardBody>
        </Card>
      </Grid>
      <Card>
        <CardHeader
          title="Paid search competitors"
          description={`${rows.length} advertisers bidding on the same keywords`}
          actions={
            <ButtonLink href={compareHref("/keyword-gap", [domain, ...rows.slice(0, 4).map((c) => c.domain)], { db, type: "paid" })} size="sm" variant="secondary">
              Paid Keyword Gap <ArrowRight className="h-3.5 w-3.5" />
            </ButtonLink>
          }
        />
        <AutoTable
          rows={rows.map((c) => ({ ...c }))}
          rowKey="domain"
          db={db}
          columns={[
            { key: "domain", header: "Competitor", type: "domain", href: `/advertising-research?q={domain}&db=${db}` },
            { key: "competitionLevel", header: "Com. level", type: "level" },
            { key: "commonKeywords", header: "Common keywords", type: "compact" },
            { key: "paidKeywords", header: "Paid keywords", type: "compact" },
            { key: "paidTraffic", header: "Paid traffic", type: "compact" },
            { key: "paidTrafficCost", header: "Traffic cost", type: "money" },
            { key: "organicKeywords", header: "Organic keywords", type: "compact" },
          ]}
          defaultSort={{ key: "competitionLevel", dir: "desc" }}
          exportName={`${domain}-paid-competitors-${db}`}
          searchable
          searchKeys={["domain"]}
          searchPlaceholder="Filter by domain"
          selection={{ type: "keyword-gap", key: "domain", base: domain, db, gapType: "paid" }}
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ History

async function History({ ownerId, domain, db }: { ownerId: string; domain: string; db: string }) {
  const { data } = await getAdsHistory(ownerId, domain, db);
  return (
    <Card>
      <CardHeader title="Ads history" description="Ad position per keyword over the last 12 months (top keywords by traffic, plus keywords the domain stopped bidding on)" />
      {data.rows.length ? (
        <AdsHistoryGrid history={data} db={db} domain={domain} />
      ) : (
        <CardBody>
          <p className="py-8 text-center text-[13px] text-text-3">Ads history is not available from the connected provider.</p>
        </CardBody>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ Pages

function Pages({ domain, db, rows, base, copies }: { domain: string; db: string; rows: PaidRow[]; base: string; copies: ReturnType<typeof adCopiesFrom> }) {
  const pages = adsPagesFrom(rows, copies);
  return (
    <Card>
      <CardHeader title="Landing pages" description={`${pages.length} pages receive paid traffic`} actions={<Link href={`${base}&tab=copies`} className="text-[12.5px] text-link hover:underline">View ad copies →</Link>} />
      <AutoTable
        rows={pages.map((p) => ({ ...p }))}
        rowKey="url"
        db={db}
        columns={[
          { key: "url", header: "Landing page", type: "url" },
          { key: "keywords", header: "Keywords", type: "compact" },
          { key: "ads", header: "Ads", type: "compact" },
          { key: "traffic", header: "Paid traffic", type: "compact" },
          { key: "trafficPct", header: "Traffic %", type: "share", max: pages[0]?.trafficPct || 100 },
        ]}
        defaultSort={{ key: "traffic", dir: "desc" }}
        exportName={`${domain}-paid-pages-${db}`}
        searchable
        searchKeys={["url"]}
        searchPlaceholder="Filter by URL"
      />
    </Card>
  );
}
