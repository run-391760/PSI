import { Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { getProfile } from "@/lib/local/profile";
import { projectContext } from "@/lib/local/project-context";
import { PLATFORMS, REPLY_TEMPLATES, competitorRatings, reviewStats, reviewsWithReplies } from "@/lib/local/reviews";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { ReviewsInbox, Stars } from "@/components/local/reviews-ui";

export const metadata: Metadata = { title: "Review Management" };

const BREADCRUMBS = [{ label: "Local SEO" }, { label: "Review Management", href: "/local/reviews" }];

export default async function ReviewsPage({ searchParams }: PageProps<"/local/reviews">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { projects, project, requested, switcher } = await projectContext(user.id, sp);

  if (!project)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Review Management" description="Monitor ratings across review platforms, reply faster with templates and benchmark against nearby competitors." />
        {requested && <Callout tone="warning" className="mb-4">That project was not found. Choose one of your projects below.</Callout>}
        <ProjectGate projects={projects} basePath="/local/reviews" title="Review Management" description="Choose the business whose reviews you want to manage." />
      </Page>
    );

  const stored = await getProfile(project.id);
  if (!stored)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Review Management:" subject={project.domain} meta={<DataSourceBadge source="demo" />} actions={<ProjectSwitcher projects={switcher} current={project.id} />} />
        <Card>
          <EmptyState
            icon={<Star className="h-5 w-5" />}
            title="Add your business profile first"
            description="Reviews are matched to your business by name, category and location. Set up the profile in Listing Management."
            action={
              <ButtonLink href={`/local/listings?project=${project.id}`} variant="primary">
                Set up business profile
              </ButtonLink>
            }
          />
        </Card>
      </Page>
    );

  const profile = stored.profile;
  const reviews = await reviewsWithReplies(project, profile);
  const s = reviewStats(reviews);
  const rivals = competitorRatings(project, profile, s);
  const ratingDelta = s.last30.avg != null && s.prev30.avg != null ? ((s.last30.avg - s.prev30.avg) / s.prev30.avg) * 100 : null;
  const countDelta = s.prev30.count ? ((s.last30.count - s.prev30.count) / s.prev30.count) * 100 : null;
  const maxDist = Math.max(...s.distribution.map((d) => d.count), 1);
  const items = reviews.map((r) => ({ ...r, platformName: PLATFORMS[r.platform]?.name ?? r.platform }));
  const rank = [...rivals].sort((a, b) => b.rating - a.rating).findIndex((r) => r.you) + 1;

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Review Management:"
        subject={profile.name}
        meta={
          <>
            <DataSourceBadge source="demo" />
            <Badge>{s.platforms.length} platforms</Badge>
            <Badge>{profile.primaryCategory}</Badge>
          </>
        }
        actions={<ProjectSwitcher projects={switcher} current={project.id} />}
      />
      <Callout tone="warning" className="mb-4" title="Demo reviews">
        Review platforms are not connected in this environment. Reviews are generated deterministically from templates for your category and market; replies you draft are saved for real.
      </Callout>

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Average rating" value={s.avg == null ? "n/a" : s.avg.toFixed(2)} delta={ratingDelta} deltaLabel="last 30d vs prior" sub={<Stars rating={s.avg ?? 0} />} />
          <Metric label="Reviews (12 months)" value={s.total} delta={countDelta} deltaLabel="last 30d vs prior" sub={`${s.last30.count} in the last 30 days`} />
          <Metric label="Response rate" value={`${Math.round(s.responseRate)}%`} sub={`${s.replied} of ${s.total} replied`} />
          <Metric label="Awaiting reply" value={s.awaiting} sub={s.negativeAwaiting ? `${s.negativeAwaiting} negative (1–2★)` : "No negative reviews waiting"} />
          <Metric label="Avg. response time" value={s.avgResponseDays == null ? "n/a" : `${s.avgResponseDays} days`} sub="For replied reviews" />
        </MetricStrip>
      </Card>

      <Grid cols={3} className="mb-4 lg:grid-cols-[1fr_1.5fr] xl:grid-cols-[1fr_1.4fr_1fr]">
        <Card>
          <CardHeader title="Rating distribution" description={`${s.total} reviews`} />
          <CardBody>
            <ul className="space-y-2">
              {s.distribution.map((d) => (
                <li key={d.stars} className="grid grid-cols-[42px_1fr_64px] items-center gap-2 text-[13px]">
                  <span className="tabular inline-flex items-center gap-0.5 text-text-2">
                    {d.stars} <Star className="h-3 w-3" style={{ color: "var(--warning)" }} fill="currentColor" strokeWidth={0} />
                  </span>
                  <Bar value={d.count} max={maxDist} color="var(--series-1)" className="h-2" />
                  <span className="tabular text-right text-text">
                    {d.count} <span className="text-[11.5px] text-text-3">{s.total ? Math.round((d.count / s.total) * 100) : 0}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Rating trend" description="Average star rating per month" />
          <CardBody>
            <TrendChart data={s.months.map((m) => ({ month: m.month, rating: m.rating }))} xKey="month" series={[{ key: "rating", label: "Average rating" }]} yFormat="number" yDomain={[Math.max(1, Math.floor(Math.min(...s.months.filter((m) => m.rating != null).map((m) => m.rating!), 5)) - 1), 5]} height={210} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sentiment" info="Lexicon-based sentiment of the review text, nudged by the star rating." />
          <CardBody>
            <DonutChart
              size={120}
              centerValue={`${s.total ? Math.round((s.sentiment.positive / s.total) * 100) : 0}%`}
              centerLabel="positive"
              format="number"
              data={(["positive", "neutral", "negative"] as const).map((k) => ({ label: SENTIMENT_META[k].label, value: s.sentiment[k], color: SENTIMENT_META[k].color }))}
            />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Review volume" description="New reviews per month by sentiment" />
          <CardBody>
            <BarChart
              data={s.months.map((m) => ({ month: m.month, positive: m.positive, other: m.reviews - m.positive - m.negative, negative: m.negative }))}
              xKey="month"
              xFormat="monthShort"
              stacked
              yFormat="number"
              series={[
                { key: "positive", label: "Positive", color: "var(--good)" },
                { key: "other", label: "Neutral", color: "var(--text-3)" },
                { key: "negative", label: "Negative", color: "var(--critical)" },
              ]}
              height={220}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What reviewers talk about" description="Topics mentioned, split by praise and complaints" />
          <CardBody>
            <ul className="space-y-2.5">
              {s.aspects.map((a) => (
                <li key={a.aspect} className="grid grid-cols-[110px_1fr_76px] items-center gap-2 text-[13px]">
                  <span className="truncate text-text-2 capitalize">{a.aspect}</span>
                  <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3" title={`${a.positive} praise · ${a.negative} complaints`}>
                    <div style={{ width: `${(a.positive / a.total) * 100}%`, background: "var(--good)" }} />
                    <div style={{ width: `${(a.negative / a.total) * 100}%`, background: "var(--critical)" }} />
                  </div>
                  <span className="tabular text-right text-[12px] text-text-2">
                    <span className="text-good-ink">{a.positive}</span> / <span className="text-critical-ink">{a.negative}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-text-3">
              <span className="text-good-ink">Praise</span> / <span className="text-critical-ink">complaints</span> per topic.
            </p>
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Platforms" description="Where your reviews come from" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Platform" }, { header: "Reviews", align: "right" }, { header: "Rating", align: "right" }, { header: "Response rate", align: "right" }, { header: "Awaiting", align: "right" }]}
              rows={s.platforms.map((p) => [<span key="p" className="font-medium">{p.name}</span>, p.reviews, `${p.rating.toFixed(1)} ★`, `${p.responseRate}%`, p.unanswered ? <span key="u" className="text-warning-ink">{p.unanswered}</span> : "0"])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Competitor ratings" description={`You rank #${rank} of ${rivals.length} nearby ${profile.primaryCategory.toLowerCase()} businesses by rating`} info="Nearby businesses in your category (demo). Tracked competitor domains are included first." />
          <CardBody>
            <MiniTable
              columns={[{ header: "Business" }, { header: "Rating", className: "w-36" }, { header: "Reviews / 12 mo", align: "right" }, { header: "Replies", align: "right" }]}
              rows={rivals.map((c) => [
                <span key="n" className={c.you ? "font-semibold text-text" : "text-text"}>
                  {c.name}
                  {c.you && <Badge tone="brand" className="ml-1.5">You</Badge>}
                </span>,
                <div key="r" className="flex items-center gap-2">
                  <Bar value={c.rating} max={5} className="w-16" color={c.you ? "var(--series-1)" : "var(--text-3)"} />
                  <span className="tabular text-[12.5px]">{c.rating.toFixed(1)}</span>
                </div>,
                c.reviews12,
                `${Math.round(c.responseRate)}%`,
              ])}
            />
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Reviews inbox" description="Reply to reviews with templates; replies are saved to your project." />
        <ReviewsInbox projectId={project.id} reviews={items} templates={REPLY_TEMPLATES} business={profile.name} phone={profile.phone} />
      </Card>

      <p className="text-[12px] text-text-3">
        Reviews are <span className="font-medium text-warning-ink">Demo data</span>. Improve prominence in the{" "}
        <Link href={`/local/map-rank-tracker?project=${project.id}`} className="text-link hover:underline">
          Map Rank Tracker
        </Link>{" "}
        by growing review volume and replying consistently.
      </p>
      <DemoNotice className="mt-2" />
    </Page>
  );
}
