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
import { Change, Heatmap, Sunburst, TrendingList } from "@/components/cx/listening/viz";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { requirePageUser } from "@/lib/auth";
import { getClassificationTree, getTicketFields, type ClassificationNode } from "@/lib/cx/admin/fields";
import { cxContext } from "@/lib/cx/context";
import { countBy, dailyTrend, days, delta, shareOfVoice, summary, topAuthors, topicTrend, topTerms, type MentionRow } from "@/lib/cx/listening/analytics";
import { listTopics } from "@/lib/cx/listening/data";
import { buzzYoYCounts, compareCounts, geoTree, peakWindows, sentimentClouds, topPhrases, withPrevious } from "@/lib/cx/listening/insights";
import { trendingFor } from "@/lib/cx/listening/monitor";
import { INTENTS, languageName, sourceLabel } from "@/lib/cx/listening/sources";
import { query } from "@/lib/db";
import { compact, monthLabel, num, pct } from "@/lib/format";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Listening dashboards" };
const PERIODS = [7, 30, 90] as const;
const TABS = [
  { id: "", label: "Overview" },
  { id: "conversation", label: "Conversation" },
  { id: "classification", label: "Classification" },
  { id: "activity", label: "Peak activity" },
  { id: "geography", label: "Geography" },
  { id: "trending", label: "Trending issues" },
];
const COUNTRY: Record<string, string> = { IN: "India", US: "United States", GB: "United Kingdom", AU: "Australia", CA: "Canada", AE: "UAE", SG: "Singapore", DE: "Germany", FR: "France" };
type Row = MentionRow & { country: string | null; ticket_id: string | null; tags: string[] };

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Listening dashboards" />;
  const period = PERIODS.find((p) => String(p) === sp.days) ?? 30;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "";
  const now = new Date();
  const start = new Date(now.getTime() - period * 86400000);
  const prevStart = new Date(now.getTime() - 2 * period * 86400000);
  const [topics, raw] = await Promise.all([
    listTopics(brand.id),
    query<Row>(
      `SELECT id, topic_id, source, author, author_handle, author_followers, title, body, language, published_at, sentiment, intent, country, ticket_id, tags
       FROM cx_mentions WHERE project_id=$1 AND published_at > $2 AND published_at <= now() AND status <> 'ignored' ORDER BY published_at LIMIT 50000`,
      [brand.id, prevStart.toISOString()],
    ),
  ]);
  // The driver may return timestamptz as Date objects; the aggregations work on ISO strings.
  const rows = raw.map((r) => ({ ...r, published_at: r.published_at ? new Date(r.published_at).toISOString() : null }));
  const cur = rows.filter((r) => r.published_at && new Date(r.published_at) > start);
  const prev = rows.filter((r) => r.published_at && new Date(r.published_at) <= start);
  const tRefs = topics.map((t) => ({ id: t.id, name: t.name, kind: t.kind, keywords: t.keywords }));
  const exportFrom = start.toISOString().slice(0, 10);
  const q = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams({ brand: brand.id, days: String(period), ...(tab ? { tab } : {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
    return `/cx/listening/dashboards?${u}`;
  };
  const cmpLabel = `vs previous ${period}d`;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "Dashboards" }]}
        title="Listening dashboards"
        subject={brand.name}
        description={`Buzz, sentiment, share of voice and conversation drivers from stored mentions. Every chart compares the last ${period} days with the ${period} days before.`}
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            <div className="flex rounded-md border border-border-strong bg-surface p-0.5" role="group" aria-label="Period">
              {PERIODS.map((d) => (
                <Link key={d} href={q({ days: d })} aria-current={d === period ? "true" : undefined} className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium", d === period ? "bg-brand text-white" : "text-text-2 hover:text-text")}>
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
      <TabsNav className="mb-5 -mt-2" items={TABS.map((t) => ({ label: t.label, href: `/cx/listening/dashboards?brand=${brand.id}&days=${period}${t.id ? `&tab=${t.id}` : ""}` }))} />

      {cur.length === 0 && prev.length === 0 && tab !== "trending" ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title={topics.length ? `No mentions in the last ${period * 2} days` : "No topics yet"}
            description={topics.length ? "Dashboards fill in as mentions are fetched. Try a longer period or fetch now from the Mentions page." : "Add your brand and competitors as topics to see buzz, sentiment and share of voice."}
            action={<ButtonLink href={`/cx/listening${topics.length ? "" : "/topics"}?brand=${brand.id}`} variant="primary">{topics.length ? "Go to mentions" : "Add a topic"}</ButtonLink>}
          />
        </Card>
      ) : tab === "conversation" ? (
        <Conversation cur={cur} prev={prev} tRefs={tRefs} period={period} />
      ) : tab === "classification" ? (
        <Classification brandId={brand.id} cur={cur} prev={prev} period={period} />
      ) : tab === "activity" ? (
        <Activity cur={cur} prev={prev} period={period} />
      ) : tab === "geography" ? (
        <Geography cur={cur} prev={prev} period={period} />
      ) : tab === "trending" ? (
        <Trending brandId={brand.id} />
      ) : (
        <Overview brandId={brand.id} cur={cur} prev={prev} tRefs={tRefs} period={period} now={now} cmpLabel={cmpLabel} />
      )}
    </Page>
  );
}

type Refs = { id: string; name: string; kind: string; keywords: string[] }[];

async function Overview({ brandId, cur, prev, tRefs, period, now, cmpLabel }: { brandId: string; cur: Row[]; prev: Row[]; tRefs: Refs; period: number; now: Date; cmpLabel: string }) {
  const s = summary(cur);
  const p = summary(prev);
  const dayList = days(now.toISOString(), period);
  const prevDays = days(new Date(now.getTime() - period * 86400000).toISOString(), period);
  const trend = withPrevious(dailyTrend(cur, dayList), dailyTrend(prev, prevDays), ["mentions", "negative"]);
  const sov = shareOfVoice(cur, tRefs);
  const sovPrev = new Map(shareOfVoice(prev, tRefs).map((t) => [t.id, t]));
  const sovTopics = tRefs.filter((t) => t.kind === "brand" || t.kind === "competitor").slice(0, 8);
  const sovTrend = topicTrend(cur, sovTopics, dayList);
  const sources = compareCounts(countBy(cur, (r) => r.source), countBy(prev, (r) => r.source));
  const intents = compareCounts(countBy(cur, (r) => r.intent), countBy(prev, (r) => r.intent));
  const langs = compareCounts(countBy(cur, (r) => r.language), countBy(prev, (r) => r.language));
  const authors = topAuthors(cur);
  const prevAuthors = new Map(topAuthors(prev, 1000).byMentions.map((a) => [`${a.source}:${a.handle ?? a.author}`, a.mentions]));
  const netDelta = s.netSentiment != null && p.netSentiment != null && p.mentions >= 10 ? s.netSentiment - p.netSentiment : null;
  const split = (["positive", "neutral", "negative"] as const).map((k) => ({ label: SENTIMENT_META[k].label, current: cur.filter((r) => (r.sentiment ?? "neutral") === k).length, previous: prev.filter((r) => (r.sentiment ?? "neutral") === k).length }));
  // Buzz year over year: monthly counts over 25 months + coverage start.
  const [monthly, cov] = await Promise.all([
    query<{ m: string; n: number }>("SELECT to_char(published_at,'YYYY-MM') m, count(*)::int n FROM cx_mentions WHERE project_id=$1 AND published_at > now() - interval '25 months' AND status<>'ignored' GROUP BY 1", [brandId]),
    query<{ t: string | Date | null }>("SELECT min(published_at) t FROM cx_mentions WHERE project_id=$1", [brandId]),
  ]);
  const yoy = buzzYoYCounts(new Map(monthly.map((x) => [x.m, x.n])), now, cov[0]?.t ? new Date(cov[0].t) : null, 12);
  const thisMonth = yoy[yoy.length - 1];

  return (
    <div className="grid grid-cols-1 gap-5">
      <MetricStrip>
        <Metric label="Mentions" value={num(s.mentions)} delta={delta(s.mentions, p.mentions, 10)} deltaLabel={p.mentions < 10 ? undefined : cmpLabel} sub={p.mentions < 10 ? `${num(p.mentions)} in previous ${period}d` : undefined} />
        <Metric label="Negative share" value={s.negativeShare == null ? "n/a" : pct(s.negativeShare * 100)} delta={p.mentions < 10 ? null : delta(s.negativeShare, p.negativeShare)} upIsGood={false} deltaLabel="relative change" />
        <Metric
          label="Net sentiment"
          value={s.netSentiment == null ? "n/a" : `${s.netSentiment > 0 ? "+" : ""}${Math.round(s.netSentiment)}`}
          sub={netDelta == null ? "Positive minus negative, of opinionated mentions" : `${netDelta >= 0 ? "+" : ""}${Math.round(netDelta)} pts ${cmpLabel}`}
          info="(positive − negative) / (positive + negative) × 100"
        />
        <Metric label="Unique authors" value={num(s.authors)} delta={delta(s.authors, p.authors, 10)} deltaLabel={cmpLabel} />
        <Metric label="Potential reach" value={s.reach == null ? "n/a" : compact(s.reach)} delta={delta(s.reach, p.reach, 1)} deltaLabel={cmpLabel} sub="Followers of authors, where the source reports them" />
      </MetricStrip>

      <Grid cols={2}>
        <Card>
          <CardHeader title="Buzz trend" description={`Mentions per day; dashed = previous ${period} days, aligned by day`} />
          <CardBody>
            <TrendChart data={trend} xKey="date" xFormat="day" height={230} showLegend series={[{ key: "mentions", label: `Last ${period}d` }, { key: "prev_mentions", label: `Previous ${period}d`, dashed: true, color: "var(--chart-text)" }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sentiment trend" description="Mentions per day by sentiment" />
          <CardBody>
            <TrendChart data={trend} xKey="date" xFormat="day" type="stacked" height={230} showLegend series={(["positive", "neutral", "negative"] as const).map((k) => ({ key: k, label: SENTIMENT_META[k].label, color: SENTIMENT_META[k].color }))} />
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card>
          <CardHeader title="Sentiment split" description={`This period vs previous ${period} days`} />
          <CardBody>
            <BarChart data={split} xKey="label" series={[{ key: "current", label: `Last ${period}d` }, { key: "previous", label: `Previous ${period}d`, color: "var(--seq-200)" }]} height={200} showLegend />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Buzz trend comparison" description="Mentions per month vs the same month last year" info="Months before this brand's first stored mention show n/a, not zero." />
          <CardBody>
            <BarChart data={yoy.map((m) => ({ month: m.month, mentions: m.mentions, lastYear: m.lastYear }))} xKey="month" xFormat="monthShort" series={[{ key: "mentions", label: "This year" }, { key: "lastYear", label: "Same month last year", color: "var(--seq-200)" }]} height={200} showLegend />
            <p className="mt-2 text-[12px] text-text-3">
              {monthLabel(thisMonth.month)}: {thisMonth.mentions == null ? "n/a" : num(thisMonth.mentions)} mentions vs {thisMonth.lastYear == null ? "n/a (no data a year ago)" : num(thisMonth.lastYear)} last year
              {thisMonth.change != null ? <> (<Change value={thisMonth.change} />)</> : null}.
            </p>
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Share of voice" description={`Brand vs competitor topics; change ${cmpLabel}`} info="Share of mentions among brand and competitor topics. Add competitor topics to compare." />
        <CardBody>
          {sov.length < 2 ? (
            <div className="py-6 text-center text-[13px] text-text-3">
              Add at least one competitor topic to compare share of voice. <Link className="text-link" href={`/cx/listening/topics?brand=${brandId}`}>Manage topics</Link>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
              <DonutChart data={sov.slice(0, 6).map((t, i) => ({ label: t.name, value: t.mentions, color: `var(--series-${i + 1})` }))} centerValue={num(sov.reduce((a, t) => a + t.mentions, 0))} centerLabel="mentions" legend="bottom" />
              <div className="min-w-0">
                <TrendChart data={sovTrend} xKey="date" xFormat="day" height={200} showLegend series={sovTopics.map((t) => ({ key: t.id, label: t.name, color: `var(--series-${sov.findIndex((x) => x.id === t.id) + 1})` }))} />
                <MiniTable
                  className="mt-3"
                  columns={[{ header: "Topic" }, { header: "Mentions", align: "right" }, { header: "Share", align: "right" }, { header: "Share before", align: "right" }, { header: "Change", align: "right" }, { header: "Net sentiment", align: "right" }]}
                  rows={sov.map((t) => {
                    const b = sovPrev.get(t.id);
                    return [
                      <span key="n" className="font-medium">{t.name} <span className="font-normal text-text-3">{t.kind}</span></span>,
                      num(t.mentions),
                      t.share == null ? "n/a" : pct(t.share * 100),
                      b?.share == null ? "n/a" : pct(b.share * 100),
                      <Change key="c" value={delta(t.mentions, b?.mentions ?? null)} />,
                      t.netSentiment == null ? "n/a" : Math.round(t.netSentiment),
                    ];
                  })}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Grid cols={3}>
        <Card>
          <CardHeader title="Sources" description={`Mentions by source, ${cmpLabel}`} />
          <CardBody>
            <BarChart layout="bars" data={sources.slice(0, 7).map((x) => ({ label: sourceLabel(x.key), current: x.count, previous: x.prev }))} xKey="label" series={[{ key: "current", label: `Last ${period}d` }, { key: "previous", label: "Previous", color: "var(--seq-200)" }]} height={Math.max(160, Math.min(7, sources.length) * 44)} categoryWidth={100} showLegend />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Intents" description="Rule-based intent of each mention" />
          <CardBody>
            <BarChart layout="bars" data={intents.map((x) => ({ label: INTENTS[x.key] ?? x.key, current: x.count, previous: x.prev }))} xKey="label" series={[{ key: "current", label: `Last ${period}d` }, { key: "previous", label: "Previous", color: "var(--seq-200)" }]} height={Math.max(160, intents.length * 40)} categoryWidth={110} showLegend />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Languages" description="Detected from text (script) or reported by the source" />
          <CardBody className="grid gap-2">
            {langs.slice(0, 8).map((l) => (
              <div key={l.key} className="grid grid-cols-[84px_1fr_40px_44px] items-center gap-2 text-[12.5px]">
                <span className="truncate text-text">{languageName(l.key === "unknown" ? null : l.key)}</span>
                <Bar value={cur.length ? (l.count / cur.length) * 100 : 0} />
                <span className="text-right text-text-2 tabular-nums">{num(l.count)}</span>
                <span className="text-right text-[11.5px]"><Change value={l.change} /></span>
              </div>
            ))}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2}>
        <Card>
          <CardHeader title="Top authors by mentions" description={`Previous-period mentions for comparison`} />
          <MiniTable
            className="px-4 pb-3"
            columns={[{ header: "Author" }, { header: "Mentions", align: "right" }, { header: "Before", align: "right" }, { header: "Negative", align: "right" }, { header: "Followers", align: "right" }]}
            rows={authors.byMentions.map((a) => [
              <span key="a" className="flex min-w-0 items-center gap-2"><SourceIcon source={a.source} /><span className="truncate">{a.author}</span></span>,
              num(a.mentions),
              num(prevAuthors.get(`${a.source}:${a.handle ?? a.author}`) ?? 0),
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
              <span key="a" className="flex min-w-0 items-center gap-2"><SourceIcon source={a.source} /><span className="max-w-56 truncate" title={a.handle ?? undefined}>{a.author}</span></span>,
              compact(a.followers),
              num(a.mentions),
            ])}
          />
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Top terms" description="Most frequent words (excluding topic keywords and stop words). More clouds under Conversation." />
        <TermCloud terms={topTerms(cur, tRefs, 45)} />
      </Card>
      <p className="text-[12px] text-text-3">
        Computed from {num(cur.length)} stored mentions ({num(prev.length)} in the previous period). Ignored mentions are excluded. Sentiment and intent are rule-based and can be corrected in the feed.
      </p>
    </div>
  );
}

function Conversation({ cur, prev, tRefs, period }: { cur: Row[]; prev: Row[]; tRefs: Refs; period: number }) {
  const clouds = sentimentClouds(cur, tRefs, 25, prev);
  const p2 = topPhrases(cur, tRefs, 2, 30, prev);
  const p3 = topPhrases(cur, tRefs, 3, 24, prev);
  const rising = [...p2, ...clouds.negative, ...clouds.positive, ...clouds.neutral]
    .filter((t) => t.prev != null && t.count >= 3 && t.count >= (t.prev ?? 0) * 2)
    .sort((a, b) => b.count - (b.prev ?? 0) - (a.count - (a.prev ?? 0)))
    .filter((t, i, a) => a.findIndex((x) => x.term === t.term) === i)
    .slice(0, 12);
  return (
    <div className="grid grid-cols-1 gap-5">
      <Grid cols={3}>
        {(["negative", "neutral", "positive"] as const).map((k) => (
          <Card key={k}>
            <CardHeader title={`${SENTIMENT_META[k].label} mentions`} description={`${num(cur.filter((r) => (r.sentiment ?? "neutral") === k).length)} mentions · top words`} />
            <TermCloud terms={clouds[k]} legend={false} />
          </Card>
        ))}
      </Grid>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Two-word phrases" description="Document frequency; color = dominant sentiment" />
          <TermCloud terms={p2} />
        </Card>
        <Card>
          <CardHeader title="Three-word phrases" />
          <TermCloud terms={p3} />
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Rising terms and phrases" description={`At least doubled vs the previous ${period} days (min. 3 mentions)`} />
        <MiniTable
          className="px-4 pb-3"
          empty="Nothing doubled in this period."
          columns={[{ header: "Term" }, { header: "Now", align: "right" }, { header: "Before", align: "right" }, { header: "Change", align: "right" }]}
          rows={rising.map((t) => [<span key="t" className="font-medium">{t.term}</span>, num(t.count), num(t.prev ?? 0), <Change key="c" value={t.prev ? ((t.count - t.prev) / t.prev) * 100 : null} />])}
        />
      </Card>
    </div>
  );
}

async function Classification({ brandId, cur, prev, period }: { brandId: string; cur: Row[]; prev: Row[]; period: number }) {
  const tree = await getClassificationTree(brandId).catch(() => [] as ClassificationNode[]);
  const byId = new Map(tree.map((n) => [n.id, n]));
  const topOf = (id: string) => {
    let n = byId.get(id);
    while (n?.parentId && byId.get(n.parentId)) n = byId.get(n.parentId);
    return n;
  };
  const linked = [...cur, ...prev].filter((r) => r.ticket_id).slice(-400);
  const fields = new Map<string, string[]>();
  if (tree.length) for (const r of linked) fields.set(r.ticket_id!, (await getTicketFields(r.ticket_id!).catch(() => ({ classificationIds: [] as string[] }))).classificationIds);
  const classify = (rows: Row[], level: "top" | "leaf") =>
    countBy(
      rows.flatMap((r) => (r.ticket_id ? (fields.get(r.ticket_id) ?? []) : []).map((id) => ({ id }))).filter((x) => byId.has(x.id)),
      (x) => (level === "top" ? topOf(x.id)?.label : byId.get(x.id)?.label),
    );
  const top = compareCounts(classify(cur, "top"), classify(prev, "top"));
  const leaf = compareCounts(classify(cur, "leaf"), classify(prev, "leaf"));
  const negBy = (label: string) => {
    const r = cur.filter((m) => m.ticket_id && (fields.get(m.ticket_id) ?? []).some((id) => topOf(id)?.label === label));
    return r.length ? (r.filter((m) => m.sentiment === "negative").length / r.length) * 100 : null;
  };
  const intents = compareCounts(countBy(cur, (r) => r.intent), countBy(prev, (r) => r.intent));
  const tags = compareCounts(countBy(cur.flatMap((r) => r.tags.map((t) => ({ t }))), (x) => x.t), countBy(prev.flatMap((r) => r.tags.map((t) => ({ t }))), (x) => x.t));
  const cmp = (rows: ReturnType<typeof compareCounts>, label: (k: string) => string, extra?: (k: string) => React.ReactNode) =>
    rows.slice(0, 15).map((x) => [<span key="k" className="font-medium">{label(x.key)}</span>, num(x.count), num(x.prev), <Change key="c" value={x.change} />, ...(extra ? [extra(x.key)] : [])]);
  return (
    <div className="grid grid-cols-1 gap-5">
      {!tree.length ? (
        <Callout tone="info" title="No classification tree yet">
          Classification analysis uses the brand&apos;s classification tree (parent → child → sub-child), set up by an admin under{" "}
          <Link className="text-link" href={`/cx/settings?brand=${brandId}`}>CX settings</Link>. Mentions are classified when they are turned into tickets and classified in the inbox. Intent and tag analysis below works without it.
        </Callout>
      ) : (
        <Grid cols={2}>
          <Card>
            <CardHeader title="Top-level classification" description={`Mentions turned into classified tickets, last ${period}d vs previous`} />
            <CardBody>
              {top.length ? (
                <BarChart layout="bars" data={top.slice(0, 10).map((x) => ({ label: x.key, current: x.count, previous: x.prev }))} xKey="label" series={[{ key: "current", label: `Last ${period}d` }, { key: "previous", label: "Previous", color: "var(--seq-200)" }]} height={Math.max(160, Math.min(10, top.length) * 44)} categoryWidth={130} showLegend />
              ) : (
                <p className="py-8 text-center text-[13px] text-text-3">No classified mention tickets in these periods.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Classification detail" description="Every level, with negative share of the top level" />
            <MiniTable className="px-4 pb-3" empty="No classified mention tickets." columns={[{ header: "Classification" }, { header: "Now", align: "right" }, { header: "Before", align: "right" }, { header: "Change", align: "right" }]} rows={cmp(leaf, (k) => k)} />
            {top.length > 0 && (
              <MiniTable className="px-4 pb-3" columns={[{ header: "Top level" }, { header: "Now", align: "right" }, { header: "Before", align: "right" }, { header: "Change", align: "right" }, { header: "Negative", align: "right" }]} rows={cmp(top, (k) => k, (k) => { const v = negBy(k); return v == null ? "n/a" : pct(v); })} />
            )}
          </Card>
        </Grid>
      )}
      <Grid cols={2}>
        <Card>
          <CardHeader title="Intent analysis" description={`Rule-based intent, last ${period}d vs previous`} />
          <MiniTable className="px-4 pb-3" columns={[{ header: "Intent" }, { header: "Now", align: "right" }, { header: "Before", align: "right" }, { header: "Change", align: "right" }]} rows={cmp(intents, (k) => INTENTS[k] ?? k)} />
        </Card>
        <Card>
          <CardHeader title="Tag analysis" description="Tags applied to mentions in the feed" />
          <MiniTable className="px-4 pb-3" empty="No tagged mentions. Tag mentions in the feed to analyse them here." columns={[{ header: "Tag" }, { header: "Now", align: "right" }, { header: "Before", align: "right" }, { header: "Change", align: "right" }]} rows={cmp(tags, (k) => k)} />
        </Card>
      </Grid>
    </div>
  );
}

function Activity({ cur, prev, period }: { cur: Row[]; prev: Row[]; period: number }) {
  const p = peakWindows(cur);
  const pp = new Map(peakWindows(prev).bySource.map((s) => [s.source, s]));
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <div className="grid grid-cols-1 gap-5">
      <Card>
        <CardHeader title="When the conversation happens" description={`Mentions by weekday and hour (UTC), last ${period} days`} />
        <CardBody>
          <Heatmap grid={p.grid} />
          {p.top.length > 0 && <p className="mt-2 text-[12.5px] text-text-2">Busiest slots: {p.top.map((t) => `${t.day} ${hh(t.hour)} (${num(t.count)})`).join(" · ")}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Peak windows by source" description={`Busiest 3-hour window and weekday per source; previous ${period} days for comparison`} />
        <MiniTable
          className="px-4 pb-3"
          columns={[{ header: "Source" }, { header: "Mentions", align: "right" }, { header: "Before", align: "right" }, { header: "Peak window (UTC)" }, { header: "Share", align: "right" }, { header: "Peak day" }, { header: "Previous peak" }]}
          rows={p.bySource.map((s) => {
            const b = pp.get(s.source);
            return [
              <span key="s" className="flex items-center gap-2"><SourceIcon source={s.source} />{sourceLabel(s.source)}</span>,
              num(s.total),
              num(b?.total ?? 0),
              `${hh(s.peakStart)}–${hh(s.peakEnd)}`,
              s.peakShare == null ? "n/a" : pct(s.peakShare * 100),
              s.peakDay,
              b ? `${hh(b.peakStart)}–${hh(b.peakEnd)}, ${b.peakDay}` : "n/a",
            ];
          })}
        />
      </Card>
    </div>
  );
}

function Geography({ cur, prev, period }: { cur: Row[]; prev: Row[]; period: number }) {
  const g = geoTree(cur);
  const gp = geoTree(prev);
  const prevBy = new Map(gp.root.children.map((c) => [c.name, c.value]));
  const flat = g.root.children.flatMap((c) => [{ path: COUNTRY[c.name] ?? c.name, level: 0, value: c.value, prev: prevBy.get(c.name) ?? 0 }, ...c.children.flatMap((s) => [{ path: `${COUNTRY[c.name] ?? c.name} › ${s.name}`, level: 1, value: s.value, prev: null as number | null }, ...s.children.map((ci) => ({ path: `${COUNTRY[c.name] ?? c.name} › ${s.name} › ${ci.name}`, level: 2, value: ci.value, prev: null as number | null }))])]);
  return (
    <div className="grid grid-cols-1 gap-5">
      <Card>
        <CardHeader title="Mentions by country → state → city" description={`${num(g.located)} of ${num(g.total)} mentions located (${g.total ? pct((g.located / g.total) * 100) : "n/a"}); previous ${period}d: ${num(gp.located)}`} info="Country comes from the source (App Store storefront), the publisher's country-code domain (news) or a place named in the text. State and city only from places named in the text." />
        <CardBody>
          {g.located ? (
            <div className="grid items-start gap-5 md:grid-cols-[260px_1fr]">
              <div className="flex justify-center"><Sunburst root={g.root} /></div>
              <MiniTable
                columns={[{ header: "Place" }, { header: "Mentions", align: "right" }, { header: "Before", align: "right" }, { header: "Change", align: "right" }]}
                rows={flat.slice(0, 20).map((f) => [
                  <span key="p" className={cn(f.level === 0 ? "font-medium" : "text-text-2", f.level === 1 && "pl-3", f.level === 2 && "pl-6")}>{f.path.split(" › ").pop()}</span>,
                  num(f.value),
                  f.prev == null ? "" : num(f.prev),
                  f.prev == null ? "" : <Change key="c" value={f.prev ? ((f.value - f.prev) / f.prev) * 100 : null} />,
                ])}
              />
            </div>
          ) : (
            <p className="py-8 text-center text-[13px] text-text-3">No mentions in this period carry a location. App Store reviews, country-domain news publishers and posts naming a city or state are located.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function Trending({ brandId }: { brandId: string }) {
  const [day, hours6] = await Promise.all([trendingFor(brandId, 24), trendingFor(brandId, 6)]);
  return (
    <div className="grid grid-cols-1 gap-5">
      <Grid cols={2}>
        <Card>
          <CardHeader title="Trending in the last 24 hours" description="Words and phrases in mentions and inbox tickets at ≥ 3× their normal daily rate (14-day baseline)" />
          <TrendingList issues={day.issues} brandId={brandId} empty={day.docs < 10 ? "Not enough data yet: needs mentions or tickets over the last two weeks." : undefined} />
        </Card>
        <Card>
          <CardHeader title="Trending in the last 6 hours" description="Same, against the normal 6-hour rate" />
          <TrendingList issues={hours6.issues} brandId={brandId} empty={hours6.docs < 10 ? "Not enough data yet." : undefined} />
        </Card>
      </Grid>
      <p className="text-[12px] text-text-3">Computed from {num(day.docs)} mentions and tickets of the last 15 days. New trending issues raise an alert after each detection run (at most once per issue every 3 days; configurable on the Crisis page).</p>
    </div>
  );
}
