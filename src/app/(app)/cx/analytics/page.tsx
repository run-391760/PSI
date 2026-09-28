import { ExternalLink, Plug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ChannelChip, NoBrand } from "@/components/cx/publishing/shared";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { requirePageUser } from "@/lib/auth";
import { pubChannel } from "@/lib/cx/publishing/core";
import { clickAnalytics, connections, listLinks, pubContext, shortUrl } from "@/lib/cx/publishing/data";
import { channelInsights, publishedSummary, statHistory, type InsightResult } from "@/lib/cx/publishing/dispatch";
import { compact, dateLabel, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Social analytics" };

const RANGES = [7, 30, 90];
const API_LABEL: Record<string, string> = { youtube: "YouTube Data API", facebook: "Meta Graph API", instagram: "Instagram Graph API", linkedin: "LinkedIn API", x: "X API v2" };
const n = (v: number | null | undefined) => (v == null ? "n/a" : compact(v));

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await pubContext(user.id, sp);
  if (!brand) return <NoBrand title="Social analytics" section="Analytics" redirect="/cx/analytics" />;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [clicks, links, insights, history, published, conns] = await Promise.all([clickAnalytics(brand.id, days), listLinks(brand.id), channelInsights(brand.id), statHistory(brand.id), publishedSummary(brand.id, days), connections(brand.id)]);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const delta = clicks.prev > 0 ? ((clicks.clicks - clicks.prev) / clicks.prev) * 100 : null;
  const live = insights.filter((i) => i.stats);
  const totalFollowers = live.reduce((s, i) => s + (i.stats!.followers ?? 0), 0);
  const topLinks = [...links].filter((l) => l.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 8);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Social analytics" }]}
        title="Social analytics"
        subject={brand.name}
        description="Performance of your own channels from their official APIs, and clicks on your tracked short links."
        meta={
          <>
            <Badge tone="good">Short links: first-party tracking</Badge>
            {live.map((i) => <Badge key={i.kind}>{API_LABEL[i.kind]}{i.fetchedAt ? ` · ${timeAgo(i.fetchedAt)}` : ""}</Badge>)}
          </>
        }
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            <div className="inline-flex rounded-md border border-border-strong bg-surface p-0.5">
              {RANGES.map((r) => (
                <Link key={r} href={`/cx/analytics?brand=${brand.id}&days=${r}`} className={cn("rounded px-2.5 py-1 text-[12.5px]", r === days ? "bg-surface-3 font-medium text-text" : "text-text-2 hover:text-text")}>
                  {r}D
                </Link>
              ))}
            </div>
          </>
        }
      />

      <MetricStrip className="mb-5">
        <Metric label={`Link clicks (${days}d)`} value={clicks.clicks.toLocaleString("en-US")} delta={delta} deltaLabel={`vs previous ${days}d`} info="Human clicks on your short links (bots and link-preview fetchers excluded)." />
        <Metric label="Tracked links" value={clicks.links.toLocaleString("en-US")} href={`/cx/publishing?brand=${brand.id}&tab=links`} />
        <Metric label="Connected channels" value={`${live.length} / ${insights.length}`} />
        <Metric label="Audience (connected)" value={live.length ? compact(totalFollowers) : "n/a"} info="Sum of followers/subscribers reported by the connected channels' APIs." />
        <Metric label={`Posts published (${days}d)`} value={published.reduce((s, p) => s + p.published, 0).toLocaleString("en-US")} info="Channel posts published through SynapseSEO (automatic or marked manually)." />
      </MetricStrip>

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Short-link clicks" description="Daily human clicks on all tracked links of this brand." />
          <CardBody>
            {clicks.clicks > 0 ? (
              <TrendChart data={clicks.series} xKey="day" xFormat="day" type="area" series={[{ key: "clicks", label: "Clicks" }]} height={220} yFormat="number" />
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">
                No clicks in the last {days} days. Add a link to a post or create one in <Link className="text-link hover:underline" href={`/cx/publishing?brand=${brand.id}&tab=links`}>Links</Link>.
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Clicks by device" />
          <CardBody>
            {clicks.byDevice.length ? <DonutChart data={clicks.byDevice.map((d) => ({ label: d.label, value: d.clicks }))} centerValue={compact(clicks.clicks)} centerLabel="clicks" legend="bottom" /> : <p className="py-12 text-center text-[13px] text-text-3">n/a</p>}
          </CardBody>
        </Card>
      </div>
      <Grid cols={3} className="mb-6">
        <Card>
          <CardHeader title="Clicks by source" description="utm_source of the link (channel)" />
          <CardBody>{clicks.byChannel.length ? <BarChart layout="bars" data={clicks.byChannel.map((c) => ({ label: pubChannel(c.label)?.name ?? c.label, clicks: c.clicks }))} xKey="label" series={[{ key: "clicks", label: "Clicks" }]} height={Math.max(120, clicks.byChannel.length * 34)} valueLabels yFormat="number" /> : <p className="py-8 text-center text-[13px] text-text-3">n/a</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Referrers" description="Where clicks came from (in-app browsers often send none)" />
          <CardBody>
            <MiniTable columns={[{ header: "Referrer" }, { header: "Clicks", align: "right" }]} rows={clicks.byRef.map((r) => [r.label, r.clicks.toLocaleString("en-US")])} empty="n/a" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top links" description="All-time clicks" href={`/cx/publishing?brand=${brand.id}&tab=links`} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Link" }, { header: "Clicks", align: "right" }]}
              rows={topLinks.map((l) => [
                <span key="l" className="block max-w-[220px] truncate" title={l.target_url}>
                  <a className="font-mono text-[12px] text-link hover:underline" href={shortUrl(origin, l.code)} target="_blank" rel="noreferrer">/l/{l.code}</a> <span className="text-text-3">{l.label || l.target_url}</span>
                </span>,
                l.clicks.toLocaleString("en-US"),
              ])}
              empty="No clicks yet"
            />
          </CardBody>
        </Card>
      </Grid>

      <h2 className="mb-3 text-[16px] font-semibold">Channels</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((i) => (
          <ChannelCard key={i.kind} i={i} brandId={brand.id} history={history.filter((h) => h.kind === i.kind)} conn={conns.find((c) => c.kind === i.kind)!} published={published.find((p) => p.kind === i.kind)} />
        ))}
      </div>
    </Page>
  );
}

function ChannelCard({ i, brandId, history, conn, published }: { i: InsightResult; brandId: string; history: { day: string; followers: number | null }[]; conn: Awaited<ReturnType<typeof connections>>[number]; published?: { published: number; failed: number } }) {
  const name = pubChannel(i.kind)?.name ?? i.kind;
  if (!i.connected) {
    const needsId = i.kind === "youtube" && conn.envReady;
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Plug className="h-4 w-4" /></span>
          <div className="min-w-0 text-[13px]">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold"><ChannelChip kind={i.kind} /> Connect {name}</h3>
            <p className="mt-1 text-text-2">{needsId ? "Add this brand's YouTube channel ID to see subscribers, views and recent video stats." : `${conn.api} · ${conn.costNote}.`}</p>
            <p className="mt-1 text-text-3">Shows {i.kind === "youtube" ? "subscribers, total views, video count and recent videos' views, likes and comments" : i.kind === "linkedin" ? "page followers" : "followers and recent posts' likes, comments and shares"}.</p>
            {!conn.envReady && <p className="mt-2 text-[12px] text-text-3">Server settings: {conn.env.map((e) => <code key={e} className="mx-0.5 rounded bg-surface-3 px-1 py-0.5 text-text-2">{e}</code>)}</p>}
            <Link href={`/cx/publishing?brand=${brandId}&tab=settings`} className={cn(buttonClass("secondary", "sm"), "mt-3")}>{needsId ? "Add channel ID" : "How to connect"}</Link>
          </div>
        </div>
      </Card>
    );
  }
  const s = i.stats;
  const hist = history.filter((h) => h.followers != null);
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ChannelChip kind={i.kind} /> {s?.name ?? name}</span>}
        description={s?.handle ?? undefined}
        actions={
          <>
            <Badge>{API_LABEL[i.kind]}</Badge>
            {s?.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-text-3 hover:text-text" aria-label="Open channel"><ExternalLink className="h-4 w-4" /></a>}
          </>
        }
      />
      <CardBody className="grid gap-4">
        {i.error && <Callout tone="critical" title="The API returned an error">{i.error}</Callout>}
        {s && (
          <>
            <MetricStrip>
              <Metric size="sm" label={i.kind === "youtube" ? "Subscribers" : "Followers"} value={n(s.followers)} />
              <Metric size="sm" label={i.kind === "youtube" ? "Total views" : "Views"} value={n(s.views)} />
              <Metric size="sm" label={i.kind === "youtube" ? "Videos" : "Posts"} value={n(s.posts)} />
              <Metric size="sm" label="Published here" value={published ? published.published.toLocaleString("en-US") : "0"} />
            </MetricStrip>
            {hist.length >= 2 && <TrendChart data={hist} xKey="day" xFormat="day" series={[{ key: "followers", label: i.kind === "youtube" ? "Subscribers" : "Followers" }]} height={160} />}
            {hist.length < 2 && <p className="text-[12px] text-text-3">Follower history builds from daily snapshots taken when this page loads (first snapshot {hist[0] ? dateLabel(hist[0].day) : "today"}).</p>}
            {s.recent.length > 0 && (
              <MiniTable
                columns={[{ header: i.kind === "youtube" ? "Recent videos" : "Recent posts" }, { header: "Views", align: "right" }, { header: "Likes", align: "right" }, { header: "Comments", align: "right" }]}
                rows={s.recent.slice(0, 8).map((r) => [
                  <span key="t" className="block max-w-[260px] min-w-[140px]">
                    {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-link hover:underline">{r.title || "(no text)"}</a> : <span className="line-clamp-1">{r.title}</span>}
                    {r.at && <span className="text-[11.5px] text-text-3">{dateLabel(r.at)}</span>}
                  </span>,
                  n(r.views),
                  n(r.likes),
                  n(r.comments),
                ])}
              />
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
