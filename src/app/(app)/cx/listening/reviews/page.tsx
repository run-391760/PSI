import { Plug, Star } from "lucide-react";
import type { Metadata } from "next";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ExtraSettingsForm } from "@/components/cx/listening/crisis-v2";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getExtraSettings } from "@/lib/cx/listening/crisis2";
import { listTopics } from "@/lib/cx/listening/data";
import { days } from "@/lib/cx/listening/analytics";
import { ratingDistribution, ratingDrop, ratingSeries } from "@/lib/cx/listening/insights";
import { reviewRows } from "@/lib/cx/listening/monitor";
import { dateLabel, num } from "@/lib/format";

export const metadata: Metadata = { title: "Review monitoring" };
const stars = (v: number | null) => (v == null ? "n/a" : v.toFixed(2));

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Review monitoring" />;
  const [reviews, topics, extra] = await Promise.all([reviewRows(brand.id, 180), listTopics(brand.id), getExtraSettings(brand.id)]);
  const now = new Date();
  const withApps = topics.filter((t) => t.app_ids.length);
  const cur = reviews.filter((r) => r.published_at && new Date(r.published_at).getTime() > now.getTime() - 90 * 86400000);
  const prev = reviews.filter((r) => r.published_at && new Date(r.published_at).getTime() <= now.getTime() - 90 * 86400000);
  const avg = (a: typeof reviews) => (a.length ? a.reduce((s, r) => s + (r.rating ?? 0), 0) / a.length : null);
  const drop = ratingDrop(reviews, now, { threshold: extra.ratingDrop });
  // Start the chart at the first stored review (min. 14 days) so sparse history is readable.
  const all = ratingSeries(cur, days(now.toISOString(), 90));
  const first = all.findIndex((d) => d.reviews > 0);
  const series = all.slice(Math.max(0, Math.min(first < 0 ? 76 : first, 76)));
  const dist = ratingDistribution(cur);
  const distPrev = ratingDistribution(prev);
  const low = cur.filter((r) => (r.rating ?? 5) <= 2).slice(0, 12);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "Reviews" }]}
        title="Review monitoring"
        subject={brand.name}
        description="Star-rating trend, distribution and rating-drop alerts from app store reviews collected by your topics."
        meta={<Badge>Apple customer reviews RSS</Badge>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <ListeningNav current="/cx/listening/reviews" brandId={brand.id} />
      {!reviews.length ? (
        <Card>
          <EmptyState
            icon={<Star className="h-5 w-5" />}
            title={withApps.length ? "No reviews stored yet" : "Add an App Store app to a topic"}
            description={withApps.length ? "Reviews arrive with the next hourly fetch (or use Fetch now on the Mentions page)." : "Edit a topic, add your App Store id (e.g. 1234567890 or gb/1234567890) and enable the App Store source."}
            action={<ButtonLink href={`/cx/listening/topics?brand=${brand.id}`} variant="primary">Manage topics</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {drop.triggered && (
            <Callout tone="critical" title={`Rating dropped ${drop.drop!.toFixed(2)} stars`}>
              Last 7 days average {stars(drop.recentAvg)} ({drop.recentCount} reviews) vs {stars(drop.baselineAvg)} over the previous 30 days ({drop.baselineCount} reviews). An alert was sent.
            </Callout>
          )}
          <MetricStrip>
            <Metric label="Average rating (90d)" value={stars(avg(cur))} sub={`previous 90d: ${stars(avg(prev))}`} delta={avg(cur) != null && avg(prev) != null ? ((avg(cur)! - avg(prev)!) / avg(prev)!) * 100 : null} deltaLabel="vs previous 90d" />
            <Metric label="Reviews (90d)" value={num(cur.length)} delta={prev.length ? ((cur.length - prev.length) / prev.length) * 100 : null} deltaLabel="vs previous 90d" />
            <Metric label="Last 7 days" value={stars(drop.recentAvg)} sub={`${drop.recentCount} reviews`} />
            <Metric label="Previous 30 days" value={stars(drop.baselineAvg)} sub={`${drop.baselineCount} reviews`} />
            <Metric label="Drop alert" value={drop.ready ? (drop.triggered ? "Triggered" : "Normal") : "n/a"} sub={drop.ready ? `threshold ${extra.ratingDrop} stars` : "needs ≥3 recent and ≥5 baseline reviews"} />
          </MetricStrip>
          <Grid cols={2}>
            <Card>
              <CardHeader title="Rating trend" description="Daily average and trailing 7-day average (days without reviews are gaps; starts at the first stored review)" />
              <CardBody>
                <TrendChart data={series} xKey="date" xFormat="day" height={230} yFormat="number" yDomain={[1, 5]} showLegend series={[{ key: "rolling", label: "7-day average" }, { key: "rating", label: "Daily average", dashed: true, color: "var(--seq-300)" }]} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Star distribution" description="Last 90 days vs the 90 days before" />
              <CardBody>
                <BarChart layout="bars" data={dist.map((d, i) => ({ label: `${d.stars} ★`, current: d.count, previous: distPrev[i].count }))} xKey="label" series={[{ key: "current", label: "Last 90d" }, { key: "previous", label: "Previous 90d", color: "var(--seq-200)" }]} height={230} categoryWidth={50} showLegend />
              </CardBody>
            </Card>
          </Grid>
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <Card>
              <CardHeader title="Recent 1–2 star reviews" href={`/cx/listening?brand=${brand.id}&source=appstore&sentiment=negative`} />
              <ul className="divide-y divide-border">
                {low.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-critical-ink">{"★".repeat(Math.round(r.rating ?? 0))}</span>
                      <span className="font-medium">{r.title}</span>
                      <span className="text-[12px] text-text-3">{r.author} · {r.country} · {r.published_at ? dateLabel(r.published_at) : ""}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-text-2">{r.body}</p>
                  </li>
                ))}
                {!low.length && <li className="px-4 py-6 text-center text-[13px] text-text-3">No 1–2 star reviews in the last 90 days.</li>}
              </ul>
            </Card>
            <div className="grid content-start gap-5">
              <Card>
                <CardHeader title="Drop alert" description="Checked after every detection run; at most one alert per day" />
                <ExtraSettingsForm brandId={brand.id} initial={extra} compact />
              </Card>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Plug className="h-4 w-4" /></span>
                  <div className="text-[13px]">
                    <h3 className="text-[14px] font-semibold">Google Play and Google Business Profile reviews</h3>
                    <p className="mt-1 text-text-2">Google Play has no public reviews feed; its Developer API returns reviews only for apps you own (service account with Play Console access). Business Profile reviews need Google&apos;s API approval.</p>
                    <p className="mt-1 text-text-3">Shows star trend, distribution and drop alerts for those sources once connected.</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
