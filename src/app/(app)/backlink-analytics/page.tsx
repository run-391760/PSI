import { GitCompareArrows, Link2 } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import {
  getBlAnchors,
  getBlBacklinks,
  getBlCompare,
  getBlCompetitors,
  getBlIndexedPages,
  getBlIps,
  getBlOutbound,
  getBlOverview,
  getBlReferringDomains,
  getBlSummary,
  blAvailable,
} from "@/lib/backlinks/report";
import { splitList } from "@/lib/backlinks/metrics";
import { looseRootDomain } from "@/lib/backlinks/normalize";
import { compact } from "@/lib/format";
import { BubbleChart } from "@/components/charts/bubble-chart";
import { NeedsData } from "@/components/seo/needs-data";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { PrintButton } from "@/components/ui/print-button";
import { ScoreRing } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { AnchorsTable, CompetitorsTable, IndexedPagesTable, IpsTable, OutboundTable, RefDomainsTable } from "@/components/backlinks/analytics-tables";
import { BacklinksTable } from "@/components/backlinks/backlinks-table";
import { CompareButton } from "@/components/backlinks/compare-dialog";
import { CompareSections } from "./compare";
import { OverviewSections } from "./overview";

export const metadata: Metadata = { title: "Backlink Analytics" };

const EXAMPLES = ["nike.com", "healthline.com", "zillow.com", "coursera.org", "paruluniversity.ac.in"];
const COMPARE_EXAMPLES = ["nike.com,adidas.com,zara.com", "coursera.org,udemy.com,edx.org,khanacademy.org"];
const TABS = ["overview", "backlinks", "anchors", "referring-domains", "referring-ips", "indexed-pages", "outbound-domains", "competitors"] as const;
type Tab = (typeof TABS)[number];

const BREADCRUMBS = [{ label: "Link building" }, { label: "Backlink Analytics", href: "/backlink-analytics" }];
const SEARCH_PLACEHOLDER = "Enter a domain — or up to 5, comma-separated, to compare";

export default async function BacklinkAnalyticsPage({ searchParams }: PageProps<"/backlink-analytics">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const tabParam = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "overview";

  const entries = splitList(q);
  const invalid = entries.filter((e) => !looseRootDomain(e));
  const domains = [...new Set(entries.map((e) => looseRootDomain(e)).filter((d): d is string => !!d))];

  if (!domains.length)
    return (
      <Page className="overflow-x-clip">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Backlink Analytics" description="Explore any domain's backlink profile: authority, referring domains, anchors, new and lost links, and competitors with similar link profiles.">
          <ToolSearch placeholder={SEARCH_PLACEHOLDER} showDb={false} buttonLabel="Analyze" />
        </PageHeader>
        {q && <Callout tone="warning" className="mb-4">“{q}” is not a valid domain. Enter something like example.com.</Callout>}
        <Card>
          <EmptyState
            icon={<Link2 className="h-5 w-5" />}
            title="Analyze a backlink profile"
            description="Enter a domain above, or try one of these examples:"
            action={
              <div className="space-y-3">
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((e) => (
                    <ButtonLink key={e} href={`/backlink-analytics?q=${e}`} size="sm">
                      {e}
                    </ButtonLink>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px] text-text-3">
                  <span className="inline-flex items-center gap-1">
                    <GitCompareArrows className="h-3.5 w-3.5" /> Compare:
                  </span>
                  {COMPARE_EXAMPLES.map((e) => (
                    <ButtonLink key={e} href={`/backlink-analytics?q=${encodeURIComponent(e)}`} size="sm" variant="ghost" className="text-link">
                      {e.split(",").join(" vs ")}
                    </ButtonLink>
                  ))}
                </div>
              </div>
            }
          />
        </Card>
      </Page>
    );

  if (!blAvailable())
    return (
      <Page className="overflow-x-clip">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Backlink Analytics:" subject={domains.length > 1 ? `comparing ${Math.min(5, domains.length)} domains` : domains[0]}>
          <ToolSearch placeholder={SEARCH_PLACEHOLDER} showDb={false} buttonLabel="Analyze" />
        </PageHeader>
        <NeedsData
          providers={["dataforseo"]}
          title="Connect DataForSEO to analyze backlink profiles"
          shows={[
            "Authority Score, referring domains, backlinks and referring IPs",
            "Monthly referring-domain and backlink history",
            "New and lost links per day",
            "Every backlink with anchor, attributes and first/last seen",
            "Anchor texts and anchor-type mix",
            "Referring domains, IPs and subnets",
            "Most linked pages of the domain",
            "Backlink competitors and side-by-side comparison",
          ]}
        />
      </Page>
    );

  /* ---------------------------------------------------------------------------- compare mode */
  if (domains.length > 1) {
    const list = domains.slice(0, 5);
    const { data, source, fetchedAt } = await getBlCompare(user.id, list);
    return (
      <Page className="overflow-x-clip">
        <PageHeader
          breadcrumbs={BREADCRUMBS}
          title="Backlink Analytics:"
          subject={`comparing ${list.length} domains`}
          meta={<DataSourceBadge source={source} fetchedAt={fetchedAt} />}
          actions={
            <>
              <CompareButton initial={list} label="Edit comparison" />
              <PrintButton />
            </>
          }
        >
          <ToolSearch placeholder={SEARCH_PLACEHOLDER} showDb={false} buttonLabel="Analyze" />
        </PageHeader>
        {domains.length > 5 && <Callout tone="warning" className="mb-4">You can compare up to 5 domains; showing the first 5.</Callout>}
        {invalid.length > 0 && <Callout tone="warning" className="mb-4">Skipped invalid entries: {invalid.join(", ")}</Callout>}
        <CompareSections data={data} />
        {source === "demo" && <DemoNotice className="mt-6" />}
      </Page>
    );
  }

  /* ---------------------------------------------------------------------------- single domain */
  const domain = domains[0];
  const { data: s, source, fetchedAt } = await getBlSummary(user.id, domain);
  const link = (t: string) => `/backlink-analytics?q=${encodeURIComponent(domain)}&tab=${t}`;

  return (
    <Page className="overflow-x-clip">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Backlink Analytics:"
        subject={domain}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} />
            <Badge>Root domain</Badge>
            {s.topicName && <Badge tone="brand">{s.topicName}</Badge>}
          </>
        }
        actions={
          <>
            <CompareButton initial={[domain, ""]} />
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder={SEARCH_PLACEHOLDER} showDb={false} buttonLabel="Analyze" />
      </PageHeader>
      {invalid.length > 0 && <Callout tone="warning" className="mb-4">Skipped invalid entries: {invalid.join(", ")}</Callout>}

      <Card className="mb-4">
        <MetricStrip>
          <div className="flex items-center gap-3">
            <ScoreRing value={s.authorityScore} size={60} stroke={7} label={String(s.authorityScore)} color="var(--series-1)" />
            <Metric label="Authority Score" value={s.authorityScore} delta={s.authorityDelta} info="Compound 0–100 score of backlink profile quality, organic traffic and link spam signals." />
          </div>
          <Metric label="Referring domains" value={compact(s.referringDomains)} delta={s.referringDomainsDelta} deltaLabel="vs last month" href={link("referring-domains")} />
          <Metric label="Backlinks" value={compact(s.backlinks)} delta={s.backlinksDelta} deltaLabel="vs last month" href={link("backlinks")} />
          <Metric label="Referring IPs" value={compact(s.referringIps)} delta={s.referringIpsDelta} href={link("referring-ips")} />
          <Metric label="Outbound domains" value={s.outboundDomains ? compact(s.outboundDomains) : "n/a"} delta={s.outboundDomainsDelta} href={link("outbound-domains")} info="Unique domains this site links out to." />
        </MetricStrip>
      </Card>

      <TabsNav
        className="mb-4"
        items={[
          { href: "/backlink-analytics", label: "Overview" },
          { href: "/backlink-analytics?tab=backlinks", label: "Backlinks", count: compact(s.backlinks) },
          { href: "/backlink-analytics?tab=anchors", label: "Anchors" },
          { href: "/backlink-analytics?tab=referring-domains", label: "Referring domains", count: compact(s.referringDomains) },
          { href: "/backlink-analytics?tab=referring-ips", label: "Referring IPs" },
          { href: "/backlink-analytics?tab=indexed-pages", label: "Indexed pages" },
          { href: "/backlink-analytics?tab=outbound-domains", label: "Outbound domains" },
          { href: "/backlink-analytics?tab=competitors", label: "Competitors" },
        ]}
      />

      <TabContent tab={tab} ownerId={user.id} domain={domain} totals={{ rd: s.referringDomains, bl: s.backlinks }} summary={s} />
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

async function TabContent({ tab, ownerId, domain, totals, summary }: { tab: Tab; ownerId: string; domain: string; totals: { rd: number; bl: number }; summary: Awaited<ReturnType<typeof getBlSummary>>["data"] }) {
  const sampleNote = (n: number, total: number, what: string) => (n && n < total ? `Showing a sample of ${n.toLocaleString()} of ${compact(total)} ${what}` : `${n.toLocaleString()} ${what}`);
  switch (tab) {
    case "backlinks": {
      const { data } = await getBlBacklinks(ownerId, domain);
      return (
        <Card>
          <CardHeader title="Backlinks" description={sampleNote(data.length, totals.bl, "backlinks")} info="Every link pointing to this domain with its source page, anchor, target and attributes." />
          <BacklinksTable rows={data} domain={domain} />
        </Card>
      );
    }
    case "anchors": {
      const { data } = await getBlAnchors(ownerId, domain);
      return (
        <Card>
          <CardHeader title="Anchors" description={`${data.length.toLocaleString()} unique anchor texts`} info="Link texts used by referring pages, with the number of domains and backlinks using each." />
          <AnchorsTable rows={data} domain={domain} />
        </Card>
      );
    }
    case "referring-domains": {
      const { data } = await getBlReferringDomains(ownerId, domain);
      return (
        <Card>
          <CardHeader title="Referring domains" description={sampleNote(data.length, totals.rd, "referring domains")} />
          <RefDomainsTable rows={data} domain={domain} />
        </Card>
      );
    }
    case "referring-ips": {
      const { data } = await getBlIps(ownerId, domain);
      return (
        <Card>
          <CardHeader title="Referring IPs" description="Referring domains grouped by server IP address and /24 subnet. Many domains on one IP or subnet can indicate a link network." />
          <IpsTable ips={data.ips} subnets={data.subnets} domain={domain} />
        </Card>
      );
    }
    case "indexed-pages": {
      const { data } = await getBlIndexedPages(ownerId, domain);
      return (
        <Card>
          <CardHeader title="Indexed pages" description="Pages of this domain that receive backlinks" />
          <IndexedPagesTable rows={data} domain={domain} />
        </Card>
      );
    }
    case "outbound-domains": {
      const { data, note } = await getBlOutbound(ownerId, domain);
      return (
        <Card>
          <CardHeader title="Outbound domains" description={data.total ? `${compact(data.total)} domains linked from ${domain}${data.rows.length < data.total ? ` · top ${data.rows.length} shown` : ""}` : "Domains this site links to"} />
          {note ? (
            <CardBody>
              <Callout>{note}</Callout>
            </CardBody>
          ) : (
            <OutboundTable rows={data.rows} domain={domain} />
          )}
        </Card>
      );
    }
    case "competitors": {
      const { data } = await getBlCompetitors(ownerId, domain);
      // Only competitors with known totals can be placed on the map (unknown values are never plotted as 1).
      const top = data.filter((c) => c.referringDomains > 0 && c.authorityScore > 0).slice(0, 10);
      return (
        <>
          {top.length > 0 && (
            <Card className="mb-4">
              <CardHeader
                title="Backlink competitors map"
                description="Referring domains vs. Authority Score; bubble size is the number of common referring domains"
                actions={<CompareButton initial={[domain, ...data.slice(0, 3).map((c) => c.domain)]} label="Compare top 3" />}
              />
              <CardBody>
                <BubbleChart
                  xLabel="Referring domains"
                  yLabel="Authority Score"
                  zLabel="Common referring domains"
                  points={[
                    ...(summary.referringDomains > 0 && summary.authorityScore > 0 ? [{ label: domain, x: summary.referringDomains, y: summary.authorityScore, z: Math.max(...top.map((c) => c.common), 1), highlight: true }] : []),
                    ...top.map((c) => ({ label: c.domain, x: c.referringDomains, y: c.authorityScore, z: Math.max(1, c.common) })),
                  ]}
                  height={300}
                />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Backlink competitors" description="Domains whose backlink profiles overlap most with this domain's" info="Ranked by the share of referring domains the two domains have in common." />
            <CompetitorsTable rows={data} domain={domain} />
          </Card>
        </>
      );
    }
    default: {
      const { data } = await getBlOverview(ownerId, domain);
      return <OverviewSections s={summary} o={data} />;
    }
  }
}
