import { BarChart3, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { SourceIcon } from "@/components/cx/listening/source-icon";
import { TermCloud } from "@/components/cx/listening/term-cloud";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { countBy, dailyTrend, days, delta, shareOfVoice, summary, topAuthors, topicTrend, topTerms, type MentionRow } from "@/lib/cx/listening/analytics";
import { listTopics } from "@/lib/cx/listening/data";
import { INTENTS, languageName, sourceLabel } from "@/lib/cx/listening/sources";
import { query } from "@/lib/db";
import { compact, num, pct } from "@/lib/format";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Listening dashboards" };
const PERIODS = [7, 30, 90] as const;

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Listening dashboards" />;
  const period = PERIODS.find((p) => String(p) === sp.days) ?? 30;
  const now = new Date();
  const start = new Date(now.getTime() - period * 86400000);
  const prevStart = new Date(now.getTime() - 2 * period * 86400000);
  const [topics, raw] = await Promise.all([
    listTopics(brand.id),
    query<MentionRow>(
      `SELECT id, topic_id, source, author, author_handle, author_followers, title, body, language, published_at, sentiment, intent
       FROM cx_mentions WHERE project_id=$1 AND published_at > $2 AND published_at <= now() AND status <> 'ignored' ORDER BY published_at LIMIT 50000`,
      [brand.id, prevStart.toISOString()],
    ),
  ]);
  // The driver may return timestamptz as Date objects; the aggregations work on ISO strings.
  const rows = raw.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null }));
  const cur = rows.filter((r) => r.published_at && new Date(r.published_at) > start);
  const prev = rows.filter((r) => r.published_at && new Date(r.published_at) <= start);
  const s = summary(cur);
  const p = summary(prev);
  const dayList = days(now.toISOString(), period);
  const trend = dailyTrend(cur, dayList);
  const tRefs = topics.map((t) => ({ id: t.id, name: t.name, kind: t.kind, keywords: t.keywords }));
  const sov = shareOfVoice(cur, tRefs);
  const sovTopics = tRefs.filter((t) => t.kind === "brand" || t.kind === "competitor").slice(0, 8);
  const sovTrend = topicTrend(cur, sovTopics, dayList);
  const sources = countBy(cur, (r) => r.source);
  const intents = countBy(cur, (r) => r.intent);
  const langs = countBy(cur, (r) => r.language);
  const authors = topAuthors(cur);
  const terms = topTerms(cur, tRefs, 45);
  const exportFrom = start.toISOString().slice(0, 10);
  const netDelta = s.netSentiment != null && p.netSentiment != null && p.mentions >= 10 ? s.netSentiment - p.netSentiment : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "Dashboards" }]}
        title="Listening dashboards"
        subject={brand.name}
        description="Buzz, sentiment, share of voice and conversation drivers computed from the mentions stored for this brand."
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            <div className="flex rounded-md border border-border-strong bg-surface p-0.5" role="group" aria-label="Period">
              {PERIODS.map((d) => (
                <Link
                  key={d}
                  href={`/cx/listening/dashboards?brand=${brand.id}&days=${d}`}
                  aria-current={d === period ? "true" : undefined}
                  className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium", d === period ? "bg-brand text-white" : "text-text-2 hover:text-text")}
                >
                  {d}D
                </Link>
              ))}
            </div>
            <a href={`/api/cx/listening/export?brand=${brand.id}&from=${exportFrom}`} className={buttonClass("secondary", "md")}>
              <Download className="h-4 w-4" /> Export CSV
            </a>
          </>
        }
      />
      <ListeningNav current="/cx/listening/dashboards" brandId={brand.id} />

      {cur.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title={topics.length ? `No mentions in the last ${period} days` : "No topics yet"}
            description={topics.length ? "Dashboards fill in as mentions are fetched. Try a longer period or fetch now from the Mentions page." : "Add your brand and competitors as topics to see buzz, sentiment and share of voice."}
            action={<ButtonLink href={`/cx/listening${topics.length ? "" : "/topics"}?brand=${brand.id}`} variant="primary">{topics.length ? "Go to mentions" : "Add a topic"}</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <MetricStrip>
            <Metric label="Mentions" value={num(s.mentions)} delta={delta(s.mentions, p.mentions, 10)} deltaLabel={p.mentions < 10 ? undefined : `vs previous ${period}d`} sub={p.mentions < 10 ? `${num(p.mentions)} in previous ${period}d` : undefined} />
            <Metric label="Negative share" value={s.negativeShare == null ? "n/a" : pct(s.negativeShare * 100)} delta={p.mentions < 10 ? null : delta(s.negativeShare, p.negativeShare)} upIsGood={false} deltaLabel="relative change" />
            <Metric
              label="Net sentiment"
              value={s.netSentiment == null ? "n/a" : `${s.netSentiment > 0 ? "+" : ""}${Math.round(s.netSentiment)}`}
              sub={netDelta == null ? "Positive minus negative, of opinionated mentions" : `${netDelta >= 0 ? "+" : ""}${Math.round(netDelta)} pts vs previous`}
              info="(positive − negative) / (positive + negative) × 100"
            />
            <Metric label="Unique authors" value={num(s.authors)} delta={delta(s.authors, p.authors, 10)} />
            <Metric label="Potential reach" value={s.reach == null ? "n/a" : compact(s.reach)} sub="Followers of authors, where the source reports them" />
          </MetricStrip>

          <Grid cols={2}>
            <Card>
              <CardHeader title="Buzz trend" description={`Mentions per day, last ${period} days`} />
              <CardBody>
                <TrendChart data={trend} xKey="date" xFormat="day" type="area" series={[{ key: "mentions", label: "Mentions" }]} height={230} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Sentiment trend" description="Mentions per day by sentiment" />
              <CardBody>
                <TrendChart
                  data={trend}
                  xKey="date"
                  xFormat="day"
                  type="stacked"
                  height={230}
                  showLegend
                  series={(["positive", "neutral", "negative"] as const).map((k) => ({ key: k, label: SENTIMENT_META[k].label, color: SENTIMENT_META[k].color }))}
                />
              </CardBody>
            </Card>
          </Grid>

          <Card>
            <CardHeader title="Share of voice" description="Brand vs competitor topics in this period" info="Share of mentions among brand and competitor topics. Add competitor topics to compare." />
            <CardBody>
              {sov.length < 2 ? (
                <div className="py-6 text-center text-[13px] text-text-3">
                  Add at least one competitor topic to compare share of voice.{" "}
                  <Link className="text-link" href={`/cx/listening/topics?brand=${brand.id}`}>Manage topics</Link>
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                  <DonutChart data={sov.slice(0, 6).map((t, i) => ({ label: t.name, value: t.mentions, color: `var(--series-${i + 1})` }))} centerValue={num(sov.reduce((a, t) => a + t.mentions, 0))} centerLabel="mentions" legend="bottom" />
                  <div className="min-w-0">
                    <TrendChart
                      data={sovTrend}
                      xKey="date"
                      xFormat="day"
                      height={200}
                      showLegend
                      series={sovTopics.map((t) => ({ key: t.id, label: t.name, color: `var(--series-${sov.findIndex((x) => x.id === t.id) + 1})` }))}
                    />
                    <MiniTable
                      className="mt-3"
                      columns={[{ header: "Topic" }, { header: "Mentions", align: "right" }, { header: "Share", align: "right" }, { header: "Negative", align: "right" }, { header: "Net sentiment", align: "right" }]}
                      rows={sov.map((t) => [
                        <span key="n" className="font-medium">{t.name} <span className="font-normal text-text-3">{t.kind}</span></span>,
                        num(t.mentions),
                        t.share == null ? "n/a" : pct(t.share * 100),
                        num(t.negative),
                        t.netSentiment == null ? "n/a" : Math.round(t.netSentiment),
                      ])}
                    />
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Grid cols={3}>
            <Card>
              <CardHeader title="Sources" description="Where the conversation happens" />
              <CardBody>
                <DonutChart data={sources.slice(0, 6).map((x, i) => ({ label: sourceLabel(x.key), value: x.count, color: `var(--series-${i + 1})` }))} legend="bottom" centerValue={num(cur.length)} centerLabel="mentions" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Intents" description="Rule-based intent of each mention" />
              <CardBody>
                <BarChart layout="bars" data={intents.map((x) => ({ label: INTENTS[x.key] ?? x.key, count: x.count }))} xKey="label" series={[{ key: "count", label: "Mentions" }]} height={Math.max(160, intents.length * 30)} valueLabels categoryWidth={110} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Languages" description="Detected from text (script) or reported by the source" />
              <CardBody className="grid gap-2">
                {langs.slice(0, 8).map((l) => (
                  <div key={l.key} className="grid grid-cols-[90px_1fr_44px] items-center gap-2 text-[12.5px]">
                    <span className="truncate text-text">{languageName(l.key === "unknown" ? null : l.key)}</span>
                    <Bar value={(l.count / cur.length) * 100} />
                    <span className="text-right text-text-2 tabular-nums">{num(l.count)}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </Grid>

          <Grid cols={2}>
            <Card>
              <CardHeader title="Top authors by mentions" />
              <MiniTable
                className="px-4 pb-3"
                columns={[{ header: "Author" }, { header: "Mentions", align: "right" }, { header: "Negative", align: "right" }, { header: "Followers", align: "right" }]}
                rows={authors.byMentions.map((a) => [
                  <span key="a" className="flex min-w-0 items-center gap-2">
                    <SourceIcon source={a.source} />
                    <span className="truncate">{a.author}</span>
                  </span>,
                  num(a.mentions),
                  num(a.negative),
                  a.followers == null ? "n/a" : compact(a.followers),
                ])}
              />
            </Card>
            <Card>
              <CardHeader title="Top authors by followers" description="Only sources that report follower counts (Mastodon, Bluesky)" />
              <MiniTable
                className="px-4 pb-3"
                empty="No follower data in this period."
                columns={[{ header: "Author" }, { header: "Followers", align: "right" }, { header: "Mentions", align: "right" }]}
                rows={authors.byFollowers.map((a) => [
                  <span key="a" className="flex min-w-0 items-center gap-2">
                    <SourceIcon source={a.source} />
                    <span className="max-w-56 truncate" title={a.handle ?? undefined}>{a.author}</span>
                  </span>,
                  compact(a.followers),
                  num(a.mentions),
                ])}
              />
            </Card>
          </Grid>

          <Card>
            <CardHeader title="Top terms" description="Most frequent words across mentions (excluding your topic keywords and stop words)" />
            <TermCloud terms={terms} />
          </Card>
          <p className="text-[12px] text-text-3">
            Computed from {num(cur.length)} stored mentions ({num(prev.length)} in the previous period). Ignored mentions are excluded. Sentiment and intent are rule-based and can be corrected in the feed.
          </p>
        </div>
      )}
    </Page>
  );
}
