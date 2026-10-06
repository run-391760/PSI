import { ExternalLink, Plug, Star } from "lucide-react";
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
import { ErFormulaForm } from "@/components/cx/listening/er-formula";
import { Heatmap } from "@/components/cx/listening/viz";
import { NeedsData } from "@/components/seo/needs-data";
import { formulaText } from "@/lib/cx/listening/social";
import { contentTags, ga4Audience, getFormula, prevClickSeries, scorePosts, suggestionInputs } from "@/lib/cx/listening/social-data";
import { getLiveReviews } from "@/lib/local/live";
import { liveEnabled } from "@/lib/providers/source";

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
  const formula = await getFormula(brand.id);
  const scored = scorePosts(insights, formula);
  const [sugg, prevClicks, tags, ga4] = await Promise.all([suggestionInputs(brand.id, scored), prevClickSeries(brand.id, days), contentTags(brand.id, days, scored), ga4Audience(brand.owner_id, brand.id, days)]);
  // Google reviews come from DataForSEO (SEO Local reviews, also ingested by brand listening topics).
  const reviewsLive = liveEnabled();
  const gReviews = reviewsLive ? await getLiveReviews(brand.id).catch(() => null) : null;
  const newReviews = gReviews ? gReviews.reviews.filter((r) => Date.parse(r.date) >= Date.now() - days * 86_400_000).length : 0;
  const clickSeries = clicks.series.map((d, i) => ({ ...d, prev_clicks: prevClicks[i] ?? 0 }));
  const hh = (x: number) => `${String(x).padStart(2, "0")}:00`;
  const topPosts = [...scored].filter((p) => (formula.denominator === "none" ? p.engagements : p.rate) != null).sort((a, b) => ((formula.denominator === "none" ? b.engagements : b.rate) ?? 0) - ((formula.denominator === "none" ? a.engagements : a.rate) ?? 0)).slice(0, 8);
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
              <TrendChart data={clickSeries} xKey="day" xFormat="day" series={[{ key: "clicks", label: `Last ${days}d` }, { key: "prev_clicks", label: `Previous ${days}d`, dashed: true, color: "var(--chart-text)" }]} height={220} yFormat="number" showLegend />
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

      <h2 className="mb-3 text-[16px] font-semibold">Smart suggestions</h2>
      <Grid cols={2} className="mb-6">
        <Card>
          <CardHeader title="Best time to post: engagement" description={`Engagements on connected channels' recent posts by weekday and hour (UTC), ${sugg.engagement.events} posts`} />
          <CardBody>
            {sugg.engagement.events >= 3 ? (
              <>
                <Heatmap grid={sugg.engagement.grid} unit="engagements" />
                <p className="mt-2 text-[12.5px] text-text-2">Best days: {sugg.engagement.bestDays.join(", ") || "n/a"} · best hours: {sugg.engagement.bestHours.map(hh).join(", ") || "n/a"}{sugg.engagement.worstDay ? ` · weakest day: ${sugg.engagement.worstDay}` : ""} (average engagements per post)</p>
              </>
            ) : (
              <p className="py-8 text-center text-[13px] text-text-3">Needs at least 3 recent posts with engagement from a connected channel (see Channels below).</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="When your audience clicks" description={`Human short-link clicks by weekday and hour (UTC), last 90 days: ${sugg.clicks.events} clicks`} />
          <CardBody>
            {sugg.clicks.events >= 5 ? (
              <>
                <Heatmap grid={sugg.clicks.grid} unit="clicks" />
                <p className="mt-2 text-[12.5px] text-text-2">Most clicks on {[...sugg.clicks.dayTotals].sort((a, b) => b.value - a.value).slice(0, 2).map((d) => d.day).join(" and ")}; peak hours {sugg.clicks.bestHours.map(hh).join(", ")}. Schedule link posts shortly before these hours.</p>
              </>
            ) : (
              <p className="py-8 text-center text-[13px] text-text-3">Needs at least 5 clicks on tracked links (first-party, no API needed).</p>
            )}
          </CardBody>
        </Card>
      </Grid>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Engagement rate" description="Your formula, applied to every connected channel's recent posts" info="Konnect-style configurable engagement rate: weight each metric, pick the denominator. Unknown inputs give n/a." />
          <CardBody className="grid gap-4">
            <ErFormulaForm brandId={brand.id} initial={formula} />
            <MiniTable
              columns={[{ header: "Top posts" }, { header: "Engagements", align: "right" }, { header: formula.denominator === "none" ? "" : "Rate", align: "right" }]}
              empty={`No scored posts: connect a channel below. Formula: ${formulaText(formula)}`}
              rows={topPosts.map((p) => [
                <span key="t" className="flex max-w-[280px] min-w-0 items-center gap-2"><ChannelChip kind={p.kind} />{p.url ? <a className="truncate text-link hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.title || "(no text)"}</a> : <span className="truncate">{p.title}</span>}</span>,
                n(p.engagements),
                formula.denominator === "none" ? "" : p.rate == null ? "n/a" : `${p.rate.toFixed(2)}%`,
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Content tags" description={`Posts published here by campaign tag, last ${days}d vs previous ${days}d`} href={`/cx/publishing?brand=${brand.id}`} />
          <CardBody>
            <MiniTable
              empty={tags.tags ? "No published posts in these periods." : "No campaign tags yet: tag posts with a campaign in Publishing."}
              columns={[{ header: "Tag" }, { header: "Posts", align: "right" }, { header: "Before", align: "right" }, { header: "Clicks", align: "right" }, { header: "Before", align: "right" }, { header: "Clicks/post", align: "right" }, { header: "Eng. rate", align: "right" }]}
              rows={tags.rows.map((t) => [
                <span key="t" className="font-medium">{t.tag}</span>,
                t.posts.toLocaleString("en-US"),
                t.prevPosts.toLocaleString("en-US"),
                t.clicks.toLocaleString("en-US"),
                t.prevClicks.toLocaleString("en-US"),
                t.clicksPerPost == null ? "n/a" : t.clicksPerPost.toFixed(1),
                t.avgRate == null ? "n/a" : `${t.avgRate.toFixed(2)}%`,
              ])}
            />
          </CardBody>
        </Card>
      </div>

      <h2 className="mb-3 text-[16px] font-semibold">Website audience (GA4)</h2>
      <div className="mb-6">
        {ga4.state === "not-configured" ? (
          <NeedsData compact providers={["google"]} shows={["Active users by country, city and language", "Device split and top acquisition channels", "Same period as the rest of this page"]} />
        ) : ga4.state === "not-linked" ? (
          <Callout tone="info" title="Link a GA4 property to this brand">Google is connected, but this brand&apos;s project has no GA4 property. Link one in the project&apos;s settings to see audience charts here.</Callout>
        ) : ga4.state === "error" ? (
          <Callout tone="critical" title="GA4 returned an error">{ga4.error}</Callout>
        ) : (
          <Grid cols={3}>
            {([["Countries", ga4.data.byCountry], ["Cities", ga4.data.byCity], ["Languages", ga4.data.byLanguage], ["Devices", ga4.data.byDevice], ["Top channels", ga4.data.byChannel]] as const).map(([title, rows]) => (
              <Card key={title}>
                <CardHeader title={title} description={`Active users, last ${days}d · GA4 ${timeAgo(ga4.fetchedAt)}`} />
                <CardBody>
                  <BarChart layout="bars" data={rows.map((r) => ({ label: r.label, users: r.users }))} xKey="label" series={[{ key: "users", label: "Active users" }]} height={Math.max(120, rows.length * 30)} valueLabels categoryWidth={110} yFormat="number" />
                </CardBody>
              </Card>
            ))}
          </Grid>
        )}
      </div>

      <h2 className="mb-3 text-[16px] font-semibold">Channels</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((i) => (
          <ChannelCard key={i.kind} i={i} brandId={brand.id} history={history.filter((h) => h.kind === i.kind)} conn={conns.find((c) => c.kind === i.kind)!} published={published.find((p) => p.kind === i.kind)} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {reviewsLive ? (
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Star className="h-4 w-4" /></span>
              <div className="min-w-0 text-[13px]">
                <h3 className="text-[14px] font-semibold">Google reviews</h3>
                {gReviews ? (
                  <p className="mt-1 text-text-2">
                    {gReviews.rating == null ? "No average rating" : `${gReviews.rating.toFixed(1)} average`} · {n(gReviews.total)} reviews · {newReviews.toLocaleString("en-US")} new in {days}D · DataForSEO {timeAgo(gReviews.fetchedAt)}
                  </p>
                ) : (
                  <p className="mt-1 text-text-2">Not fetched yet. Add Google reviews to a brand listening topic (it needs the Local SEO business profile); reviews are refreshed at most daily.</p>
                )}
                <p className="mt-1 text-text-3">Direction requests, website and call clicks need the Business Profile API.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/cx/listening?brand=${brand.id}&source=google-reviews`} className={buttonClass("secondary", "sm")}>Reviews in listening</Link>
                  <Link href={`/local/reviews?project=${brand.id}`} className={buttonClass("ghost", "sm")}>Local SEO reviews</Link>
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <NeedsData compact providers={["business-profile"]} title="Connect Google Business Profile for location insights" shows={["Star breakdown, new reviews and average rating per location", "Direction requests, website and call clicks", "Location filter"]} />
        )}
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Plug className="h-4 w-4" /></span>
            <div className="min-w-0 text-[13px]">
              <h3 className="text-[14px] font-semibold">Competitor public profiles, stories and reels</h3>
              <p className="mt-1 text-text-2">Per-network post types, stories/reels insights, organic vs paid and competitor public-profile benchmarks need the Meta Graph (business discovery), X API v2 and LinkedIn APIs with approved apps.</p>
              <p className="mt-1 text-text-3">Once connected: followers growth, posting frequency and engagement rate per competitor, reel watch time, accounts engaged. Competitor share of voice is already available from listening topics.</p>
              <Link href={`/cx/listening/dashboards?brand=${brand.id}`} className={cn(buttonClass("secondary", "sm"), "mt-3")}>Competitor share of voice</Link>
            </div>
          </div>
        </Card>
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
