import { ArrowRight, Download, ExternalLink, LayoutGrid, Pencil, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/charts/bar-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { JobButton } from "@/components/cx/listening/job-button";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { MentionsFeed } from "@/components/cx/listening/mentions-feed";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { SourceIcon } from "@/components/cx/listening/source-icon";
import { Sparkline } from "@/components/seo/badges";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { DistributionBar } from "@/components/ui/progress";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getSettings, sourceStatuses } from "@/lib/cx/listening/data";
import { PERIOD_DAYS, platformDashboard, platformHub, readPeriod, readPlatformFilters, type AuthorStat, type PlatformPeriod } from "@/lib/cx/listening/platforms";
import { isListenSource, sourceLabel, type ListenSource } from "@/lib/cx/listening/sources";
import { compact, dateLabel, num, pct, timeAgo } from "@/lib/format";
import { latestJob } from "@/lib/jobs/queue";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Platforms" };
type SP = Record<string, string | string[] | undefined>;

const SENT_SEGMENTS = (p: number, n: number, neg: number) => [
  { label: "Positive", value: p, color: SENTIMENT_META.positive.color },
  { label: "Neutral", value: n, color: SENTIMENT_META.neutral.color },
  { label: "Negative", value: neg, color: SENTIMENT_META.negative.color },
];
const SENT_TONE = { positive: "good", neutral: "neutral", negative: "critical" } as const;

/** Platforms that BrandEye-style tools show but this module cannot collect yet, and why. */
const NOT_COLLECTED = [
  { name: "X (Twitter)", why: "search needs the paid X API (Basic, about $200/month)" },
  { name: "Instagram hashtags", why: "needs the Meta connection with Instagram Hashtag Search approved in App Review" },
  { name: "LinkedIn", why: "LinkedIn has no public search API; comments on your own page arrive in the Inbox once connected" },
];

function href(brandId: string, sp: Record<string, string | number | undefined>) {
  const u = new URLSearchParams({ brand: brandId });
  for (const [k, v] of Object.entries(sp)) if (v !== undefined && v !== "") u.set(k, String(v));
  return `/cx/listening/platforms?${u}`;
}

function PeriodPicker({ brandId, period, keep }: { brandId: string; period: PlatformPeriod; keep: Record<string, string | undefined> }) {
  return (
    <div className="flex rounded-md border border-border-strong bg-surface p-0.5" role="group" aria-label="Period">
      {PERIOD_DAYS.map((d) => {
        const on = !period.custom && period.days === d;
        return (
          <Link key={d} href={href(brandId, { ...keep, days: d })} aria-current={on ? "true" : undefined} className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium", on ? "bg-brand text-white" : "text-text-2 hover:text-text")}>
            {d}D
          </Link>
        );
      })}
    </div>
  );
}

export default async function PlatformsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Platforms" />;
  const period = readPeriod(sp);
  const source = typeof sp.source === "string" && isListenSource(sp.source) ? sp.source : null;
  const [settings, job] = await Promise.all([getSettings(brand.id), latestJob(brand.id, "cx.listening.fetch")]);
  const running = job && ["queued", "running"].includes(job.status) ? job.id : null;
  const periodKeep: Record<string, string> = period.custom ? { from: period.from, to: period.to } : { days: String(period.days) };

  const tabs = (
    <nav className="scroll-thin mb-5 -mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Platforms">
      {[null, ...sourceStatuses().map((s) => s.source)].map((s) => {
        const on = s === source;
        return (
          <Link
            key={s ?? "all"}
            href={href(brand.id, { ...periodKeep, source: s ?? undefined })}
            aria-current={on ? "page" : undefined}
            className={cn("relative flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium", on ? "border-brand bg-brand-soft text-text" : "border-border bg-surface text-text-2 hover:text-text")}
          >
            {s ? <SourceIcon source={s} className="[&>span:first-child]:h-5 [&>span:first-child]:w-5" /> : <LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
            {s ? sourceLabel(s) : "All platforms"}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "Platforms", href: source ? `/cx/listening/platforms?brand=${brand.id}` : undefined }, ...(source ? [{ label: sourceLabel(source) }] : [])]}
        title={source ? `${sourceLabel(source)} analysis` : "Platforms"}
        subject={brand.name}
        description={
          source
            ? `Mentions, reach, engagement and sentiment on ${sourceLabel(source)} · ${period.label}${settings.lastFetchAt ? ` · last fetch ${timeAgo(settings.lastFetchAt)}` : ""}`
            : `What people are saying about ${brand.name} on each platform · ${period.label}`
        }
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            <PeriodPicker brandId={brand.id} period={period} keep={{ source: source ?? undefined }} />
            <JobButton brandId={brand.id} kind="fetch" initialJobId={running} />
          </>
        }
      />
      <ListeningNav current="/cx/listening/platforms" brandId={brand.id} />
      {tabs}
      {source ? <PlatformView brandId={brand.id} source={source} period={period} sp={sp} /> : <Hub brandId={brand.id} period={period} periodKeep={periodKeep} />}
    </Page>
  );
}

// ------------------------------------------------------------------ hub

async function Hub({ brandId, period, periodKeep }: { brandId: string; period: PlatformPeriod; periodKeep: Record<string, string> }) {
  const cards = await platformHub(brandId, period);
  const statuses = new Map(sourceStatuses().map((s) => [s.source, s]));
  const total = cards.reduce((a, c) => a + c.mentions, 0);
  const pos = cards.reduce((a, c) => a + c.positive, 0);
  const neg = cards.reduce((a, c) => a + c.negative, 0);
  const active = cards.filter((c) => c.mentions > 0).length;
  const top = cards.find((c) => c.mentions > 0);
  const worst = cards.filter((c) => c.mentions >= 5 && c.negative > 0).sort((a, b) => b.negative / b.mentions - a.negative / a.mentions)[0];

  return (
    <div className="grid gap-5">
      <MetricStrip>
        <Metric label="Mentions" value={num(total)} sub={period.label} />
        <Metric label="Positive" value={total ? pct((pos / total) * 100) : "n/a"} sub={`${num(pos)} mentions`} />
        <Metric label="Negative" value={total ? pct((neg / total) * 100) : "n/a"} sub={`${num(neg)} mentions`} />
        <Metric label="Active platforms" value={`${active} of ${cards.length}`} sub={top ? `Most mentions: ${sourceLabel(top.source)}` : undefined} />
        <Metric label="Most negative platform" value={worst ? sourceLabel(worst.source) : "n/a"} sub={worst ? `${pct((worst.negative / worst.mentions) * 100)} negative` : "No negative mentions (platforms with 5+ mentions)"} />
      </MetricStrip>

      <Grid cols={3} className="items-start">
        {cards.map((c) => {
          const st = statuses.get(c.source);
          const link = href(brandId, { ...periodKeep, source: c.source });
          return (
            <Card key={c.source} className="flex flex-col">
              <CardHeader
                title={<span className="flex items-center gap-2"><SourceIcon source={c.source} />{sourceLabel(c.source)}</span>}
                description={c.latestAt ? `Latest ${timeAgo(c.latestAt)}` : st && !st.available ? "Not connected" : "No mentions in this period"}
                actions={<Badge tone={c.mentions ? "brand" : "neutral"}>{num(c.mentions)}</Badge>}
              />
              <CardBody className="flex flex-1 flex-col gap-3 pt-0">
                {c.mentions > 0 ? (
                  <>
                    <div className="flex items-end justify-between gap-3">
                      <div className="text-[12px] text-text-3">{num(c.authors)} authors</div>
                      <Sparkline values={c.spark} width={120} height={28} />
                    </div>
                    <DistributionBar segments={SENT_SEGMENTS(c.positive, c.neutral, c.negative)} format={(v) => num(v)} />
                    <ul className="grid gap-2 border-t border-border pt-3">
                      {c.recent.map((m) => (
                        <li key={m.id} className="flex min-w-0 gap-2 text-[12.5px]">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SENTIMENT_META[(m.sentiment as keyof typeof SENTIMENT_META) ?? "neutral"]?.color ?? "var(--text-3)" }} aria-label={m.sentiment ?? "neutral"} />
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 [overflow-wrap:anywhere] text-text">{(m.title || m.body).replace(/\s+/g, " ").slice(0, 160) || "(no text)"}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-text-3">
                              <span className="truncate">{m.author || "Unknown"}</span>
                              {m.published_at && <span className="shrink-0">· {timeAgo(m.published_at)}</span>}
                              {m.url && (
                                <a href={m.url} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-link" aria-label="Open original">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-[12.5px] text-text-3">
                    {st && !st.available ? `Not connected: ${st.setup || st.costNote}` : c.allTime ? `${num(c.allTime)} older ${c.allTime === 1 ? "mention" : "mentions"}; try a longer period.` : "Nothing collected yet. Make sure a topic listens on this platform, then fetch."}
                  </p>
                )}
                <Link href={link} className="mt-auto inline-flex items-center gap-1 pt-1 text-[12.5px] font-medium text-link hover:underline">
                  View {sourceLabel(c.source)} dashboard <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardBody>
            </Card>
          );
        })}
      </Grid>

      <Callout tone="info" title="Not collected by Listening yet">
        <ul className="mt-1 grid gap-0.5">
          {NOT_COLLECTED.map((p) => (
            <li key={p.name}><span className="font-medium">{p.name}</span>: {p.why}.</li>
          ))}
        </ul>
      </Callout>
    </div>
  );
}

// ------------------------------------------------------------------ one platform

function AuthorTable({ rows, metric }: { rows: AuthorStat[]; metric: "mentions" | "interactions" | "followers" }) {
  return (
    <MiniTable
      className="px-4 pb-3"
      empty="No data in this period."
      columns={[{ header: "Author" }, { header: metric === "mentions" ? "Mentions" : metric === "interactions" ? "Engagement" : "Followers", align: "right" }, { header: metric === "mentions" ? "Engagement" : "Mentions", align: "right" }, { header: "Neg.", align: "right" }]}
      rows={rows.map((a) => [
        <span key="a" className="block max-w-36 truncate" title={a.handle ?? a.author}>{a.author}</span>,
        metric === "followers" ? compact(a.followers) : metric === "interactions" ? compact(a.interactions) : num(a.mentions),
        metric === "mentions" ? (a.interactions ? compact(a.interactions) : "n/a") : num(a.mentions),
        num(a.negative),
      ])}
    />
  );
}

async function PlatformView({ brandId, source, period, sp }: { brandId: string; source: ListenSource; period: PlatformPeriod; sp: SP }) {
  const f = readPlatformFilters(sp);
  const d = await platformDashboard(brandId, source, period, f);
  const st = sourceStatuses().find((s) => s.source === source);
  const s = d.summary;
  const keep = { source, ...(period.custom ? { from: period.from, to: period.to } : { days: String(period.days) }), topic: f.topic };
  const feedKeep = { ...keep, sentiment: f.sentiment, q: f.q, sort: f.sort === "engagement" ? "engagement" : undefined, day: f.day };
  const share = (n: number) => (s.mentions ? ` (${pct((n / s.mentions) * 100)})` : "");
  const exportHref = `/api/cx/listening/export?${new URLSearchParams({ brand: brandId, source, from: f.day ?? period.from, to: f.day ?? period.to, ...(f.topic ? { topic: f.topic } : {}), ...(f.sentiment && f.sentiment !== "unknown" ? { sentiment: f.sentiment } : {}), ...(f.q ? { q: f.q } : {}) })}`;
  const sentChips = [
    { id: undefined, label: "All" },
    { id: "positive", label: "Positive" },
    { id: "negative", label: "Negative" },
    { id: "neutral", label: "Neutral" },
    { id: "unknown", label: "Unknown" },
  ];

  return (
    <div className="grid gap-5">
      {st && !st.available && (
        <Callout tone="warning" title={`${sourceLabel(source)} is not connected`}>
          {st.setup || st.costNote} Stored mentions (if any) are still shown.
        </Callout>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-2 py-3">
          <span className="text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Targeted keywords</span>
          {d.listening.length ? (
            d.listening.flatMap((t) => t.keywords.slice(0, 6).map((k) => <Badge key={`${t.id}:${k}`} tone={t.kind === "brand" ? "brand" : "neutral"} >{k}</Badge>))
          ) : (
            <span className="text-[12.5px] text-text-3">No active topic listens on {sourceLabel(source)}.</span>
          )}
          <ButtonLink href={`/cx/listening/topics?brand=${brandId}`} size="sm" variant="ghost" className="ml-auto">
            <Pencil className="h-3.5 w-3.5" /> Edit keywords
          </ButtonLink>
        </CardBody>
      </Card>

      <MetricStrip>
        <Metric label="Total mentions" value={num(s.mentions)} sub={period.label} />
        <Metric label="Social reach" value={num(s.authors)} sub="unique authors" />
        <Metric label="Engagement" value={d.interactions == null ? "n/a" : compact(d.interactions)} sub={d.views != null ? `${compact(d.views)} views` : "likes, replies, reposts, score"} info="Sum of the interaction counters the platform reports (likes, reposts, replies, comments, score, points, votes)." />
        <Metric label="Potential reach" value={s.reach == null ? "n/a" : compact(s.reach)} sub="Followers, where reported" />
        <Metric
          label="Sentiment"
          value={s.mentions ? `${num(s.positive)} pos` : "n/a"}
          sub={s.mentions ? `${num(s.negative)} neg${share(s.negative)} · ${num(d.neutral)} neutral` : undefined}
        />
      </MetricStrip>

      {s.mentions === 0 ? (
        <Card>
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title={`No ${sourceLabel(source)} mentions in this period`}
            description={d.listening.length ? "Try a longer period, or fetch now to collect the latest mentions." : `Add ${sourceLabel(source)} to a topic's media preference (or leave it empty for every source) to start listening here.`}
            action={<ButtonLink href={d.listening.length ? href(brandId, { source, days: 90 }) : `/cx/listening/topics?brand=${brandId}`} variant="primary">{d.listening.length ? "Show last 90 days" : "Manage topics"}</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <Grid cols={2}>
            <Card>
              <CardHeader title="Daily mentions trend" description={`Mentions per day on ${sourceLabel(source)} (publication date, UTC)`} />
              <CardBody>
                <BarChart data={d.trend} xKey="date" xFormat="day" series={[{ key: "mentions", label: "Mentions" }]} height={220} valueLabels={d.trend.length <= 14} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Daily sentiment trend" description="Sentiment distribution by day" />
              <CardBody>
                <BarChart data={d.trend} xKey="date" xFormat="day" stacked showLegend height={220} series={(["positive", "neutral", "negative"] as const).map((k) => ({ key: k, label: SENTIMENT_META[k].label, color: SENTIMENT_META[k].color }))} />
              </CardBody>
            </Card>
          </Grid>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <form method="get" className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 shadow-card sm:grid-cols-[1.6fr_1fr_1fr_auto]">
                <input type="hidden" name="brand" value={brandId} />
                {Object.entries({ source, ...(period.custom ? { from: period.from, to: period.to } : { days: String(period.days) }), sentiment: f.sentiment, day: f.day }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                <Input name="q" defaultValue={f.q} placeholder="Search text or author" aria-label="Search" className="col-span-2 sm:col-span-1" />
                <Select name="topic" defaultValue={f.topic ?? ""} aria-label="Topic">
                  <option value="">All keywords / topics</option>
                  {d.topics.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
                <Select name="sort" defaultValue={f.sort} aria-label="Sort">
                  <option value="newest">Newest first</option>
                  <option value="engagement">Most engagement</option>
                </Select>
                <button type="submit" className={buttonClass("primary", "md")}>Apply</button>
                <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-4">
                  {sentChips.map((c) => {
                    const on = f.sentiment === c.id;
                    return (
                      <Link key={c.label} href={href(brandId, { ...feedKeep, sentiment: c.id, page: undefined })} aria-current={on ? "true" : undefined} className={cn("rounded-full border px-2.5 py-0.5 text-[12px] font-medium", on ? "border-brand bg-brand-soft text-text" : "border-border text-text-2 hover:text-text")}>
                        {c.label}
                      </Link>
                    );
                  })}
                  <span className="ml-auto flex gap-2">
                    {(f.q || f.topic || f.sentiment || f.day || f.sort !== "newest") && <Link href={href(brandId, { source, ...(period.custom ? { from: period.from, to: period.to } : { days: period.days }) })} className={buttonClass("ghost", "sm")}>Clear</Link>}
                    <a href={exportHref} className={buttonClass("secondary", "sm")}><Download className="h-3.5 w-3.5" /> Export CSV</a>
                  </span>
                </div>
              </form>

              <div className="scroll-thin mb-3 flex gap-1.5 overflow-x-auto pb-1" aria-label="Jump to day">
                <Link href={href(brandId, { ...feedKeep, day: undefined, page: undefined })} className={cn("shrink-0 rounded-md border px-2.5 py-1 text-[12px]", !f.day ? "border-brand bg-brand-soft text-text" : "border-border text-text-2 hover:text-text")}>
                  All days
                </Link>
                {d.byDay.map((x) => (
                  <Link key={x.date} href={href(brandId, { ...feedKeep, day: x.date, page: undefined })} className={cn("shrink-0 rounded-md border px-2.5 py-1 text-[12px] tabular-nums", f.day === x.date ? "border-brand bg-brand-soft text-text" : "border-border text-text-2 hover:text-text")}>
                    {dateLabel(x.date)} <span className="text-text-3">{x.mentions}</span>
                  </Link>
                ))}
              </div>

              <div className="mb-2 text-[12.5px] text-text-3">
                {num(d.feed.total)} {d.feed.total === 1 ? "mention" : "mentions"}
                {f.day ? ` on ${dateLabel(f.day)}` : ""}
                {d.feed.pages > 1 ? ` · page ${f.page} of ${d.feed.pages}` : ""}
                {f.sort === "engagement" ? " · most engagement first" : ""}
              </div>
              {d.feed.rows.length ? (
                <MentionsFeed
                  brandId={brandId}
                  mentions={d.feed.rows.map((m) => ({
                    id: m.id, topic_name: m.topic_name, topic_kind: m.topic_kind, source: m.source, url: m.url, author: m.author, author_handle: m.author_handle,
                    author_followers: m.author_followers, title: m.title, body: m.body.slice(0, 1200), language: m.language, translation: m.translation?.slice(0, 1200) ?? null,
                    published_at: m.published_at ? new Date(m.published_at).toISOString() : null, sentiment: m.sentiment, intent: m.intent, engagement: m.engagement,
                    status: m.status, tags: m.tags, ticket_id: m.ticket_id, ticket_number: m.ticket_number,
                  }))}
                />
              ) : (
                <Card><EmptyState icon={<SearchX className="h-5 w-5" />} title="No mentions match these filters" action={<ButtonLink href={href(brandId, { ...keep, topic: undefined })}>Clear filters</ButtonLink>} /></Card>
              )}
              {d.feed.pages > 1 && (
                <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Pagination">
                  {f.page > 1 && <Link className={buttonClass("secondary", "sm")} href={href(brandId, { ...feedKeep, page: f.page - 1 })}>Previous</Link>}
                  <span className="text-[12.5px] text-text-3">Page {f.page} of {d.feed.pages}</span>
                  {f.page < d.feed.pages && <Link className={buttonClass("secondary", "sm")} href={href(brandId, { ...feedKeep, page: f.page + 1 })}>Next</Link>}
                </nav>
              )}
            </div>

            <div className="grid min-w-0 content-start gap-5 [&>*]:min-w-0">
              <Card>
                <CardHeader title="Sentiment" description={`${num(s.mentions)} mentions`} />
                <CardBody className="grid gap-3 pt-0">
                  <DistributionBar segments={SENT_SEGMENTS(s.positive, d.neutral, s.negative)} format={(v, sh) => `${num(v)} · ${sh.toFixed(0)}%`} />
                  <div className="flex flex-wrap gap-1.5">
                    {(["positive", "neutral", "negative"] as const).map((k) => (
                      <Badge key={k} tone={SENT_TONE[k]}>{SENTIMENT_META[k].label} {num(k === "positive" ? s.positive : k === "negative" ? s.negative : d.neutral)}</Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Top mentioners" description="By number of mentions" />
                <AuthorTable rows={d.authorsByMentions} metric="mentions" />
              </Card>
              {d.authorsByEngagement.length > 0 && (
                <Card>
                  <CardHeader title="Top by engagement" description="Interactions on their mentions" />
                  <AuthorTable rows={d.authorsByEngagement} metric="interactions" />
                </Card>
              )}
              {d.authorsByFollowers.length > 0 && (
                <Card>
                  <CardHeader title="Top by reach" description="Author followers, where reported" />
                  <AuthorTable rows={d.authorsByFollowers} metric="followers" />
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
