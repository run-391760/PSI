import { ArrowRight, Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getMarketByDomain, getMarketByTopic, matchTopic, QUADRANTS, type MarketReport, type Quadrant } from "@/lib/competitive/market-explorer";
import { CHANNEL_LABELS, CHANNEL_ORDER } from "@/lib/competitive/traffic-analytics";
import { compareHref } from "@/lib/competitive/links";
import { spStr } from "@/lib/competitive/shared";
import { NeedsData } from "@/components/seo/needs-data";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { classifyQuery, database, tryRootDomain } from "@/lib/domain";
import { TOPICS } from "@/lib/seo/engine";
import { compact, pct } from "@/lib/format";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { series } from "@/components/charts/theme";
import { AutoTable } from "@/components/competitive/auto-table";
import { GrowthQuadrant } from "@/components/competitive/growth-quadrant";
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

export const metadata: Metadata = { title: "Market Explorer" };

const CRUMBS = [{ label: "Competitive research" }, { label: "Market Explorer", href: "/market-explorer" }];
const EXAMPLE_DOMAINS = ["nike.com", "healthline.com", "booking.com", "coursera.org"];
const QUADRANT_COLORS: Record<Quadrant, string> = { leaders: "var(--series-1)", gameChangers: "var(--series-3)", established: "var(--series-7)", niche: "var(--series-4)" };

export default async function MarketExplorerPage({ searchParams }: PageProps<"/market-explorer">) {
  await requirePageUser();
  const sp = await searchParams;
  const q = spStr(sp.q).trim();
  const db = database(spStr(sp.db) || "US").code;
  const looksLikeDomain = q !== "" && classifyQuery(q).kind !== "keyword";
  const domain = looksLikeDomain ? tryRootDomain(q) : null;
  const topic = !domain && q ? matchTopic(q) : null;

  if (!domain && !topic)
    return (
      <Page>
        <PageHeader breadcrumbs={CRUMBS} title="Market Explorer" description="Size up a market: total traffic, number of players, growth quadrant, traffic share, channel strategies and audience. Define it by a domain (its competitors form the market) or by a category.">
          <ToolSearch placeholder="Enter a domain (e.g. nike.com) or a category (e.g. Travel)" buttonLabel="Explore" />
        </PageHeader>
        {q && (
          <Callout tone="warning" className="mb-4">
            “{q}” is not a valid domain or a known market. Enter a domain like example.com or one of the categories below.
          </Callout>
        )}
        <Card>
          <EmptyState
            icon={<Compass className="h-5 w-5" />}
            title="Explore a market"
            description="Start from a domain — its closest competitors define the market — or pick a category:"
            action={
              <div className="flex max-w-2xl flex-col items-center gap-3">
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_DOMAINS.map((e) => (
                    <ButtonLink key={e} href={`/market-explorer?q=${e}&db=${db}`} size="sm">
                      {e}
                    </ButtonLink>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {TOPICS.map((t) => (
                    <Link key={t.id} href={`/market-explorer?q=${t.id}&db=${db}`} className="rounded-full border border-border px-2.5 py-1 text-[12.5px] text-text-2 hover:bg-surface-3 hover:text-text">
                      {t.name}
                    </Link>
                  ))}
                </div>
              </div>
            }
          />
        </Card>
      </Page>
    );

  if (!demoAllowed())
    return (
      <Page>
        <PageHeader breadcrumbs={CRUMBS} title="Market Explorer:" subject={domain ? `${domain} market` : topic!.name}>
          <ToolSearch placeholder="Enter a domain or a category" buttonLabel="Explore" />
        </PageHeader>
        <NeedsData
         
          providers={liveEnabled() ? ["clickstream"] : ["dataforseo", "clickstream"]}
          title="Market Explorer needs market-wide traffic data"
          shows={[
            "Market players and each one's share of traffic",
            "Growth quadrant: leaders, game changers, established and niche players",
            "Total market traffic, search demand and concentration trend",
            "Channel strategies, devices, countries and audience of the market",
          ]}
        >
          <p className="mt-3 text-[12.5px] text-text-2">
            Market players and their organic keywords come from DataForSEO; visits, channels and audience across the market need a clickstream provider. Until then, compare competitors with{" "}
            {domain ? (
              <Link href={`/organic-research?q=${domain}&db=${db}&tab=competitors`} className="text-link hover:underline">Organic Research › Competitors</Link>
            ) : (
              "Organic Research › Competitors"
            )}
            .
          </p>
        </NeedsData>
      </Page>
    );

  const { data: m, source, fetchedAt, note } = domain ? await getMarketByDomain(domain, db) : await getMarketByTopic(topic!.id, db);
  const info = database(db);
  const seed = m.players.find((p) => p.isSeed);
  const seedRank = seed ? m.players.indexOf(seed) + 1 : null;
  const top = m.players.slice(0, 5);
  const donut = [...top.map((p) => ({ label: p.domain, value: p.visits })), { label: "Other players", value: m.players.slice(5).reduce((s, p) => s + p.visits, 0) }].map((d, i) => ({ ...d, color: i < 5 ? series(i) : "var(--text-3)" }));
  const trendSeries = [...m.trendPlayers.map((d, i) => ({ key: `p${i}`, label: d })), { key: "other", label: "Other players", color: "var(--text-3)" }];
  const quadrantCounts = (Object.keys(QUADRANTS) as Quadrant[]).map((q) => ({ q, n: m.players.filter((p) => p.quadrant === q).length }));
  const ageMax = Math.max(...m.demographics.age.map((a) => a.share));

  return (
    <Page>
      <PageHeader
        breadcrumbs={CRUMBS}
        title="Market Explorer:"
        subject={domain ? `${domain} market` : m.topicName}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} note={note} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            <Badge tone="brand">{m.topicName}</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/traffic-analytics?q=${encodeURIComponent(m.players.slice(0, 5).map((p) => p.domain).join(","))}`} variant="secondary">
              Compare top 5 traffic
            </ButtonLink>
            <PrintButton />
          </>
        }
      >
        <ToolSearch placeholder="Enter a domain or a category" buttonLabel="Explore" />
      </PageHeader>

      {topic && q.toLowerCase() !== topic.id && q.toLowerCase() !== topic.name.toLowerCase() && (
        <Callout className="mb-4">
          Showing the <span className="font-medium text-text">{topic.name}</span> market for “{q}”.
        </Callout>
      )}

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Market traffic" value={compact(m.totalVisits)} delta={m.mom} deltaLabel="vs last month" info="Combined monthly visits of all players in the market (all channels, worldwide)." sub={`${pct(m.growth, 1, true)} year over year`} />
          <Metric label="Players" value={m.players.length} info="Domains in the analyzed market. General-purpose platforms (Wikipedia, YouTube, Amazon…) are excluded." sub={`${quadrantCounts.find((x) => x.q === "gameChangers")?.n ?? 0} game changers`} />
          <Metric label="Search demand" value={compact(m.searchDemand)} info={`Monthly searches in ${info.name} for ${compact(m.marketKeywords)} keywords that define the market.`} sub={`${compact(m.marketKeywords)} market keywords`} />
          <Metric label="Market concentration" value={pct(m.concentration)} info="Share of market traffic held by the three largest players." sub="Top 3 players' share" />
          {seed ? (
            <Metric label={`${seed.domain} share`} value={pct(seed.share)} delta={seed.growth} deltaLabel="YoY traffic" sub={`#${seedRank} of ${m.players.length} · ${seed.quadrantLabel}`} />
          ) : (
            <Metric label="Market leader" value={<span className="text-[18px]">{m.players[0].domain}</span>} sub={`${pct(m.players[0].share)} traffic share`} />
          )}
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Growth quadrant" info="Traffic vs year-over-year growth. Dashed lines are the market medians; hover a dot for details." />
          <CardBody>
            <GrowthQuadrant
              points={m.players.map((p) => ({ label: p.domain, x: p.visits, y: p.growth, quadrant: p.quadrant, quadrantLabel: p.quadrantLabel, highlight: p.isSeed }))}
              xThreshold={m.thresholds.visits}
              yThreshold={m.thresholds.growth}
              height={360}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Traffic share" description="Top 5 players and the rest of the market" />
          <CardBody>
            <DonutChart legend="bottom" size={170} centerValue={compact(m.totalVisits)} centerLabel="visits / mo" data={donut} />
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
              {quadrantCounts.map(({ q, n }) => (
                <div key={q} className="flex items-center gap-2 text-[12.5px]" title={QUADRANTS[q].note}>
                  <Swatch color={QUADRANT_COLORS[q]} shape="dot" />
                  <span className="flex-1 truncate text-text-2">{QUADRANTS[q].label}</span>
                  <span className="tabular font-medium">{n}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Market trend" description="Monthly visits of all players, last 24 months" />
        <CardBody>
          <MetricTrend
            data={m.trend}
            views={[
              { id: "total", label: "Market traffic", type: "area", series: [{ key: "total", label: "Market traffic" }] },
              { id: "players", label: "By player", type: "stacked", series: trendSeries },
            ]}
            height={260}
          />
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Market players"
          description={`${m.players.length} domains ranked by traffic`}
          actions={
            seed ? (
              <ButtonLink href={compareHref("/keyword-gap", [seed.domain, ...m.players.filter((p) => !p.isSeed).slice(0, 4).map((p) => p.domain)], { db })} size="sm" variant="secondary">
                Keyword Gap <ArrowRight className="h-3.5 w-3.5" />
              </ButtonLink>
            ) : undefined
          }
        />
        <AutoTable
          rows={m.players.map((p, i) => ({ rank: i + 1, domain: p.domain, isSeed: p.isSeed, visits: p.visits, share: p.share, growth: p.growth, mom: p.mom, organicKeywords: p.organicKeywords, authorityScore: p.authorityScore, mobile: p.mobile, quadrant: p.quadrantLabel }))}
          rowKey="domain"
          db={db}
          highlightKey="isSeed"
          columns={[
            { key: "rank", header: "#", type: "number", width: "40px" },
            { key: "domain", header: "Domain", type: "domain", href: "/traffic-analytics?q={domain}" },
            { key: "visits", header: "Traffic", type: "compact", info: "Monthly visits, all channels" },
            { key: "share", header: "Traffic share", type: "share", max: m.players[0]?.share || 100 },
            { key: "growth", header: "Growth (YoY)", type: "delta" },
            { key: "mom", header: "Change (MoM)", type: "delta" },
            { key: "organicKeywords", header: "Organic keywords", type: "compact" },
            { key: "authorityScore", header: "AS", type: "as" },
            { key: "mobile", header: "Mobile", type: "percent" },
            { key: "quadrant", header: "Quadrant" },
          ]}
          defaultSort={{ key: "visits", dir: "desc" }}
          exportName={`market-${m.seed ?? m.topicId}-players`}
          selection={seed ? { type: "keyword-gap", key: "domain", base: seed.domain, db } : { type: "copy", key: "domain", label: "Copy domains" }}
          pageSize={25}
        />
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Traffic generation strategies" description="Channel mix of the 10 largest players" info="How each player gets its visits: share of direct, search, paid, referral, social, email and AI assistant traffic." />
          <CardBody>
            <StackedShareBars
              rows={m.players.slice(0, 10).map((p) => ({ label: p.domain, href: `/traffic-analytics?q=${p.domain}`, highlight: p.isSeed, segments: CHANNEL_ORDER.map((c) => ({ key: c, value: p.channels[c] })) }))}
              legend={CHANNEL_ORDER.map((c, i) => ({ key: c, label: CHANNEL_LABELS[c], color: series(i) }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Market channel mix" description="Share of all market visits" />
          <CardBody>
            <ul className="space-y-2">
              {m.channels.map((c, i) => (
                <li key={c.channel} className="grid grid-cols-[12px_1fr_minmax(60px,1fr)_48px_56px] items-center gap-2 text-[12.5px]">
                  <Swatch color={series(i)} />
                  <span className="truncate text-text-2">{CHANNEL_LABELS[c.channel]}</span>
                  <Bar value={c.share} max={Math.max(...m.channels.map((x) => x.share))} color={series(i)} />
                  <span className="tabular text-right text-text-3">{pct(c.share)}</span>
                  <span className="tabular text-right font-medium">{compact(c.visits)}</span>
                </li>
              ))}
            </ul>
            <Insight m={m} />
          </CardBody>
        </Card>
      </Grid>

      <h2 className="mt-7 mb-3 text-[16px] font-semibold">Audience</h2>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Age" description="Share of market visitors" />
          <CardBody>
            <BarChart data={m.demographics.age} xKey="band" series={[{ key: "share", label: "Visitors" }]} yFormat="percent" valueLabels height={190} highlight={m.demographics.age.find((a) => a.share === ageMax)?.band} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Gender & devices" />
          <CardBody className="space-y-5">
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-text-2">Gender</div>
              <DistributionBar
                segments={[
                  { label: "Female", value: m.demographics.female, color: series(4) },
                  { label: "Male", value: m.demographics.male, color: series(0) },
                ]}
                format={(v) => pct(v)}
              />
            </div>
            <div>
              <div className="mb-2 text-[12.5px] font-medium text-text-2">Devices</div>
              <DistributionBar
                segments={[
                  { label: "Mobile", value: m.devices.mobile, color: series(1) },
                  { label: "Desktop", value: m.devices.desktop, color: series(0) },
                ]}
                format={(v) => pct(v)}
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Geography" description="Where market visitors are" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Country" }, { header: "Share", className: "w-24" }, { header: "Visits", align: "right" }]}
              rows={m.countries.slice(0, 7).map((c) => [
                <span key="c" className="whitespace-nowrap">
                  {c.flag} {c.name}
                </span>,
                <Bar key="b" value={c.share} max={m.countries[0]?.share || 100} className="w-16" />,
                compact(c.visits),
              ])}
            />
          </CardBody>
        </Card>
      </Grid>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}

function Insight({ m }: { m: MarketReport }) {
  const ai = m.channels.find((c) => c.channel === "ai");
  const fastest = [...m.players].sort((a, b) => b.growth - a.growth)[0];
  return (
    <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-[12.5px] text-text-2">
      <p>
        <span className="font-medium text-text">{CHANNEL_LABELS[m.channels.slice().sort((a, b) => b.share - a.share)[0].channel]}</span> is the main traffic source in this market.
      </p>
      {ai && (
        <p>
          AI assistants already bring <span className="font-medium text-text">{compact(ai.visits)}</span> visits a month ({pct(ai.share)}).
        </p>
      )}
      {fastest && (
        <p>
          Fastest-growing player: <span className="font-medium text-text">{fastest.domain}</span> ({pct(fastest.growth, 1, true)} YoY).
        </p>
      )}
    </div>
  );
}
