import { ArrowLeft, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { ALL_BOTS, GROUP_LABELS } from "@/lib/content/logs/bots";
import { FILE_TYPE_LABELS, type LogSummary } from "@/lib/content/logs/parser";
import { findAnalysis } from "@/lib/content/logs/store";
import { compact, dateLabel, dateTimeLabel, num, pct, timeAgo } from "@/lib/format";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { CrawledPagesTable, ErrorsTable } from "@/components/content/logs/log-tables";
import { StatusBadge, frequency } from "@/components/content/logs/status";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { demoAllowed } from "@/lib/data-mode";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar, DistributionBar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

export const metadata: Metadata = { title: "Log File Analyzer" };

type Bot = LogSummary["bots"][number];
const STATUS_SERIES = [
  { key: "s2", label: "2xx", color: "var(--good)" },
  { key: "s3", label: "3xx", color: "var(--warning)" },
  { key: "s4", label: "4xx", color: "var(--serious)" },
  { key: "s5", label: "5xx", color: "var(--critical)" },
];

function Verification({ v }: { v: Bot["verification"] }) {
  const map: Record<Bot["verification"]["status"], { icon: ReactNode; label: string; cls: string; tip: string }> = {
    verified: { icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "Verified", cls: "text-good-ink", tip: v.note ?? "Reverse and forward DNS match the search engine." },
    partial: { icon: <ShieldQuestion className="h-3.5 w-3.5" />, label: "Partly verified", cls: "text-warning-ink", tip: v.note ?? "Some IPs did not pass DNS verification." },
    failed: { icon: <ShieldX className="h-3.5 w-3.5" />, label: "Failed DNS check", cls: "text-critical-ink", tip: `${v.note ?? ""} The busiest IPs don't belong to this search engine: the user agent may be spoofed.` },
    unverified: { icon: <ShieldQuestion className="h-3.5 w-3.5" />, label: "Unverified UA", cls: "text-text-3", tip: v.note ?? "Identified by user agent only; not verified by IP." },
  };
  const m = map[v.status];
  return (
    <Tooltip content={m.tip}>
      <span className={`inline-flex items-center gap-1 text-[11.5px] font-medium whitespace-nowrap ${m.cls}`}>
        {m.icon}
        {m.label}
      </span>
    </Tooltip>
  );
}

const AI_PURPOSE: Record<string, string> = {
  gptbot: "Training (OpenAI)",
  "oai-searchbot": "Search index (ChatGPT)",
  "chatgpt-user": "Live fetch for a user",
  claudebot: "Training (Anthropic)",
  "claude-user": "Live fetch / search (Claude)",
  perplexitybot: "Answer engine index",
  "google-extended": "Gemini training token",
  ccbot: "Open dataset (Common Crawl)",
  bytespider: "Training (ByteDance)",
  amazonbot: "Alexa / Amazon AI",
  "applebot-extended": "Apple Intelligence training",
  "meta-externalagent": "Training (Meta)",
  cohere: "Training (Cohere)",
  duckassistbot: "DuckDuckGo AI answers",
  youbot: "You.com search",
  diffbot: "Knowledge graph",
};

export default async function LogAnalysisPage({ params, searchParams }: PageProps<"/log-file-analyzer/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  const sp = await searchParams;
  const a = await findAnalysis(user.id, id);
  if (!a || (a.origin === "sample" && !demoAllowed())) notFound();
  const s = a.summary;
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  const base = `/log-file-analyzer/${id}`;
  const names = Object.fromEntries(ALL_BOTS.map((b) => [b.id, b.name]));
  const isDemo = a.origin === "sample";
  const fileName = a.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
  const days = Math.max(1, s.period.days);
  const google = s.bots.filter((b) => b.id.startsWith("google") && b.id !== "google-extended");
  const googleHits = google.reduce((x, b) => x + b.hits, 0);
  const aiBots = s.bots.filter((b) => b.group === "ai");
  const errorHits = s.waste.clientErrors + s.waste.serverErrors;
  const top = s.bots.slice(0, 5);
  const daily = s.daily.map((d) => {
    const row: Record<string, number | string> = { date: d.date };
    let other = 0;
    for (const b of s.bots) {
      if (top.some((t) => t.id === b.id)) row[b.id] = d[b.id] ?? 0;
      else other += Number(d[b.id] ?? 0);
    }
    row.other = other;
    row.redirects = d._s3 ?? 0;
    row.e4 = d._s4 ?? 0;
    row.e5 = d._s5 ?? 0;
    for (const b of aiBots) row[`ai_${b.id}`] = d[b.id] ?? 0;
    return row;
  });
  const ranges = days > 10 ? [{ id: "7d", label: "7D", points: 7 }, { id: "all", label: `${days}D`, points: days }] : undefined;
  const periodLabel = s.period.from ? (s.period.from === s.period.to ? dateLabel(s.period.from) : `${dateLabel(s.period.from)} – ${dateLabel(s.period.to!)}`) : "n/a";

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "On page & tech SEO" }, { label: "Log File Analyzer", href: "/log-file-analyzer" }, { label: a.name }]}
        title="Log File Analyzer:"
        subject={a.name}
        meta={
          <>
            {isDemo ? <DataSourceBadge source="demo" /> : <DataSourceBadge source="user" fetchedAt={a.created_at} note="uploaded access log" />}
            <Badge>{periodLabel}</Badge>
            <Badge>
              {num(s.totals.parsed)} line{s.totals.parsed === 1 ? "" : "s"} · {s.format === "combined" ? "Combined" : s.format === "common" ? "Common" : "Mixed"} format
            </Badge>
            {s.totals.skipped > 0 && <Badge tone="warning">{num(s.totals.skipped)} lines skipped</Badge>}
          </>
        }
        actions={
          <ButtonLink href="/log-file-analyzer" variant="ghost">
            <ArrowLeft className="h-4 w-4" /> All logs
          </ButtonLink>
        }
      />
      {isDemo && (
        <Callout tone="warning" className="mb-4" title="Sample log (demo)">
          Generated for a fictional store to show what the analyzer reports. Upload your own access log to analyze real crawler activity.
        </Callout>
      )}
      {s.format === "common" && (
        <Callout tone="warning" className="mb-4" title="No user agents in this log">
          The Common log format has no user-agent field, so crawlers can&apos;t be identified. Switch your server to the Combined format for bot analysis.
        </Callout>
      )}

      <TabsNav
        className="mb-4"
        items={[
          { href: base, label: "Overview" },
          { href: `${base}?tab=pages`, label: "Crawled pages", count: compact(s.totals.uniqueBotUrls) },
          { href: `${base}?tab=errors`, label: "Errors & crawl budget", count: compact(s.errors.length) },
          { href: `${base}?tab=ai`, label: "AI crawlers", count: aiBots.length },
        ]}
      />

      {tab === "pages" ? (
        <Card>
          <CardHeader title="Crawled URLs" description={`${num(s.totals.uniqueBotUrls)} URLs requested by bots${s.pages.length < s.totals.uniqueBotUrls ? ` · top ${num(s.pages.length)} by hits shown` : ""}`} />
          <CrawledPagesTable rows={s.pages} days={days} names={names} fileName={fileName} />
        </Card>
      ) : tab === "errors" ? (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Crawl budget waste" value={pct(s.waste.share)} upIsGood={false} sub={`${num(s.waste.total)} of ${num(s.totals.botHits)} bot hits`} info="Bot hits spent on redirects, error responses and parameter URLs instead of canonical pages." />
              <Metric label="Redirects (3xx)" value={num(s.waste.redirects)} />
              <Metric label="Client errors (4xx)" value={num(s.waste.clientErrors)} />
              <Metric label="Server errors (5xx)" value={num(s.waste.serverErrors)} />
              <Metric label="Parameter URLs" value={num(s.waste.params)} sub="200 responses to URLs with ?query" />
            </MetricStrip>
          </Card>
          <Grid cols={2} className="mb-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Non-200 responses to bots over time" description="Daily bot hits that returned redirects or errors" />
              <CardBody>
                <TrendChart
                  data={daily}
                  xKey="date"
                  xFormat="day"
                  type="line"
                  ranges={ranges}
                  series={[
                    { key: "redirects", label: "3xx redirects", color: "var(--warning)" },
                    { key: "e4", label: "4xx errors", color: "var(--serious)" },
                    { key: "e5", label: "5xx errors", color: "var(--critical)" },
                  ]}
                  height={240}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Where crawl budget goes" />
              <CardBody>
                <DistributionBar
                  segments={[
                    { label: "Useful hits (2xx, 304)", value: Math.max(0, s.totals.botHits - s.waste.total), color: "var(--series-1)" },
                    { label: "Redirects", value: s.waste.redirects, color: "var(--warning)" },
                    { label: "4xx errors", value: s.waste.clientErrors, color: "var(--serious)" },
                    { label: "5xx errors", value: s.waste.serverErrors, color: "var(--critical)" },
                    { label: "Parameter URLs", value: s.waste.params, color: "var(--series-5)" },
                  ]}
                  format={(v, sh) => `${compact(v)} · ${sh.toFixed(1)}%`}
                />
                {s.waste.paramNames.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 text-[12.5px] font-medium text-text-2">Most crawled URL parameters</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {s.waste.paramNames.map((p) => (
                        <li key={p.name} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-text-2">
                          {p.name} <span className="text-text-3">{compact(p.hits)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[12px] text-text-3">Canonicalize, block or link less to parameters that don&apos;t change content (sorting, tracking, sessions).</p>
                  </div>
                )}
              </CardBody>
            </Card>
          </Grid>
          <Card className="mb-4">
            <CardHeader title="Pages with errors" description="URLs that returned 4xx or 5xx to crawlers" />
            <ErrorsTable rows={s.errors} names={names} fileName={fileName} />
          </Card>
          {s.waste.paramUrls.length > 0 && (
            <Card>
              <CardHeader title="Most crawled parameter URLs" />
              <CardBody>
                <MiniTable
                  columns={[{ header: "URL" }, { header: "Bot hits", align: "right" }]}
                  rows={s.waste.paramUrls.slice(0, 12).map((p) => [
                    <span key="p" className="block max-w-[640px] truncate font-mono text-[12.5px]" title={p.path}>
                      {p.path}
                    </span>,
                    num(p.hits),
                  ])}
                />
              </CardBody>
            </Card>
          )}
        </>
      ) : tab === "ai" ? (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="AI crawler hits" value={compact(s.ai.hits)} sub={`${pct(s.totals.botHits ? (s.ai.hits / s.totals.botHits) * 100 : 0)} of bot hits`} />
              <Metric label="URLs fetched by AI bots" value={compact(s.ai.pages)} />
              <Metric label="AI crawlers seen" value={aiBots.length} sub={aiBots.slice(0, 3).map((b) => b.name).join(", ") || "None"} />
              <Metric label="robots.txt checks by AI bots" value={num(s.robots.filter((r) => aiBots.some((b) => b.id === r.botId)).reduce((x, r) => x + r.hits, 0))} />
            </MetricStrip>
          </Card>
          {aiBots.length ? (
            <>
              <Grid cols={2} className="mb-4 lg:grid-cols-[1.4fr_1fr]">
                <Card>
                  <CardHeader title="AI crawler hits over time" />
                  <CardBody>
                    <TrendChart data={daily} xKey="date" xFormat="day" type="stacked" ranges={ranges} series={aiBots.slice(0, 6).map((b) => ({ key: `ai_${b.id}`, label: b.name }))} height={250} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="AI crawlers" />
                  <CardBody>
                    <MiniTable
                      columns={[{ header: "Bot" }, { header: "Purpose" }, { header: "Hits", align: "right" }, { header: "URLs", align: "right" }]}
                      rows={aiBots.map((b) => [
                        <span key="n" className="font-medium">
                          {b.name}
                        </span>,
                        <span key="p" className="text-[12px] text-text-2">
                          {AI_PURPOSE[b.id] ?? "AI"}
                        </span>,
                        compact(b.hits),
                        compact(b.urls),
                      ])}
                    />
                  </CardBody>
                </Card>
              </Grid>
              <Grid cols={2} className="mb-4">
                <Card>
                  <CardHeader title="Pages AI crawlers fetch most" />
                  <CardBody>
                    <MiniTable
                      columns={[{ header: "URL" }, { header: "Bots" }, { header: "Hits", align: "right" }]}
                      rows={s.ai.topPages.slice(0, 12).map((p) => [
                        <span key="u" className="block max-w-[320px] truncate font-mono text-[12.5px]" title={p.path}>
                          {p.path}
                        </span>,
                        <span key="b" className="block max-w-[200px] truncate text-[12px] text-text-2">
                          {p.bots.map((b) => names[b] ?? b).join(", ")}
                        </span>,
                        num(p.hits),
                      ])}
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Control AI crawlers" />
                  <CardBody className="space-y-3 text-[13px] text-text-2">
                    <p>AI crawlers honor robots.txt tokens. Training crawlers can be blocked without affecting search visibility; retrieval bots (ChatGPT-User, OAI-SearchBot, PerplexityBot, Claude-User) are what cite your pages in AI answers.</p>
                    <pre className="overflow-x-auto rounded-md bg-surface-3 px-3 py-2 font-mono text-[12px] text-text">{`# Block model training, keep AI search\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /`}</pre>
                    <p className="text-[12px] text-text-3">Google-Extended is a robots.txt token only: Gemini training data is fetched by Googlebot, so it won&apos;t appear as a separate bot in your logs.</p>
                  </CardBody>
                </Card>
              </Grid>
            </>
          ) : (
            <Card>
              <p className="px-4 py-10 text-center text-[13px] text-text-3">No AI crawlers found in this log.</p>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Bot hits" value={compact(s.totals.botHits)} sub={`${pct(s.totals.parsed ? (s.totals.botHits / s.totals.parsed) * 100 : 0)} of ${compact(s.totals.parsed)} requests`} />
              <Metric label="Googlebot hits" value={compact(googleHits)} sub={`${frequency(googleHits, days)} · all Google crawlers`} />
              <Metric label="URLs crawled" value={compact(s.totals.uniqueBotUrls)} sub="Unique URLs requested by bots" href={`${base}?tab=pages`} />
              <Metric label="Crawl budget waste" value={pct(s.waste.share)} sub="Redirects, errors, parameters" href={`${base}?tab=errors`} />
              <Metric label="Error hits" value={compact(errorHits)} sub={`${pct(s.totals.botHits ? (errorHits / s.totals.botHits) * 100 : 0)} of bot hits`} href={`${base}?tab=errors`} />
              <Metric label="AI crawler hits" value={compact(s.ai.hits)} sub={`${aiBots.length} AI bots`} href={`${base}?tab=ai`} />
            </MetricStrip>
          </Card>

          {s.totals.botHits === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldQuestion className="h-5 w-5" />}
                title="No crawler requests found"
                description={
                  s.format === "common"
                    ? "Common-format logs don't record user agents, so every request is counted as a visitor. Re-export the log in Combined format to analyze bots."
                    : `All ${num(s.totals.parsed)} requests came from browsers. Search engines may not have visited during this period, or bot traffic is logged elsewhere (CDN or load balancer logs).`
                }
              />
            </Card>
          ) : (
          <>
          <Card className="mb-4">
            <CardHeader title="Hits by bot" description="Daily requests from the most active crawlers" />
            <CardBody>
              <TrendChart data={daily} xKey="date" xFormat="day" type="stacked" ranges={ranges} series={[...top.map((b) => ({ key: b.id, label: b.name })), { key: "other", label: "Other bots" }]} height={270} />
            </CardBody>
          </Card>

          <Card className="mb-4">
            <CardHeader title="Crawlers" description={`${s.bots.length} bots identified by user agent`} info="Search-engine bots are verified with reverse + forward DNS on their busiest IPs; everything else is identified by user agent only." />
            <CardBody>
              <MiniTable
                columns={[
                  { header: "Bot" },
                  { header: "Type" },
                  { header: "Hits", align: "right" },
                  { header: "Share", className: "w-32" },
                  { header: "URLs", align: "right" },
                  { header: "Errors", align: "right" },
                  { header: "Last seen", align: "right" },
                  { header: "Verification" },
                ]}
                rows={s.bots.slice(0, 16).map((b) => [
                  <span key="n" className="font-medium whitespace-nowrap">
                    {b.name}
                  </span>,
                  <span key="g" className="text-[12px] whitespace-nowrap text-text-2">
                    {GROUP_LABELS[b.group]}
                  </span>,
                  num(b.hits),
                  <div key="s" className="flex items-center gap-2">
                    <Bar value={b.share} max={s.bots[0]?.share || 100} className="w-16" />
                    <span className="tabular text-[12px] text-text-2">{b.share}%</span>
                  </div>,
                  compact(b.urls),
                  <span key="e" className={b.s4 + b.s5 > b.hits * 0.05 ? "text-critical-ink" : ""}>
                    {pct(b.hits ? ((b.s4 + b.s5) / b.hits) * 100 : 0)}
                  </span>,
                  <span key="l" className="whitespace-nowrap text-text-2" title={dateTimeLabel(b.last)}>
                    {timeAgo(b.last)}
                  </span>,
                  <Verification key="v" v={b.verification} />,
                ])}
              />
            </CardBody>
          </Card>

          <Grid cols={2} className="mb-4">
            <Card>
              <CardHeader title="Status codes by bot" description="Responses served to the busiest crawlers" />
              <CardBody>
                <BarChart
                  data={s.bots.slice(0, 8).map((b) => ({ name: b.name, s2: b.s2, s3: b.s3, s4: b.s4, s5: b.s5 }))}
                  xKey="name"
                  layout="bars"
                  stacked
                  categoryWidth={150}
                  series={STATUS_SERIES}
                  height={300}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="File types crawled" description="Bot hits by resource type" />
              <CardBody>
                <DonutChart className="max-sm:flex-col max-sm:items-stretch" data={s.fileTypes.map((f) => ({ label: FILE_TYPE_LABELS[f.type], value: f.hits }))} size={140} centerValue={compact(s.totals.botHits)} centerLabel="bot hits" />
                <div className="mt-4 border-t border-border pt-3">
                  <div className="mb-2 text-[12.5px] font-medium text-text-2">All status codes served to bots</div>
                  <ul className="flex flex-wrap gap-2">
                    {s.statusCodes.slice(0, 10).map((c) => (
                      <li key={c.code} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
                        <StatusBadge code={c.code} /> {compact(c.hits)}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardBody>
            </Card>
          </Grid>

          <Grid cols={2} className="mb-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Most crawled URLs" href={`${base}?tab=pages`} />
              <CardBody>
                <MiniTable
                  columns={[{ header: "URL" }, { header: "Hits", align: "right" }, { header: "Last crawl", align: "right" }, { header: "Status", align: "center" }, { header: "Frequency", align: "right" }]}
                  rows={s.pages
                    .filter((p) => p.type === "page")
                    .slice(0, 10)
                    .map((p) => [
                      <span key="u" className="block max-w-[340px] truncate font-mono text-[12.5px]" title={p.path}>
                        {p.path}
                      </span>,
                      num(p.hits),
                      <span key="l" className="whitespace-nowrap text-text-2">
                        {timeAgo(p.last)}
                      </span>,
                      <StatusBadge key="s" code={p.lastStatus} />,
                      <span key="f" className="whitespace-nowrap">
                        {frequency(p.hits, days)}
                      </span>,
                    ])}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Traffic mix" />
              <CardBody>
                <DistributionBar
                  segments={[
                    ...s.groups.map((g, i) => ({ label: GROUP_LABELS[g.group], value: g.hits, color: `var(--series-${i + 1})` })),
                    { label: "Visitors (browsers)", value: s.totals.humanHits, color: "var(--text-3)" },
                  ]}
                  format={(v, sh) => `${compact(v)} · ${sh.toFixed(1)}%`}
                />
                <div className="mt-4 border-t border-border pt-3">
                  <div className="mb-2 text-[12.5px] font-medium text-text-2">robots.txt and sitemap fetches</div>
                  <MiniTable
                    empty="No robots.txt or sitemap requests."
                    columns={[{ header: "Bot" }, { header: "robots.txt", align: "right" }, { header: "Sitemaps", align: "right" }]}
                    rows={[...new Set([...s.robots.map((r) => r.botId), ...s.sitemaps.map((r) => r.botId)])].slice(0, 6).map((bid) => [
                      names[bid] ?? bid,
                      num(s.robots.find((r) => r.botId === bid)?.hits ?? 0),
                      num(s.sitemaps.find((r) => r.botId === bid)?.hits ?? 0),
                    ])}
                  />
                </div>
              </CardBody>
            </Card>
          </Grid>
          </>
          )}
        </>
      )}
      <p className="mt-6 text-[12px] text-text-3">
        Bots are identified by user agent{isDemo || !s.totals.botHits ? "" : "; search-engine IPs were checked with reverse DNS"}. Only aggregates are stored — the raw log is discarded after parsing.
        {s.totals.truncatedUrls && " This log has more unique URLs than we track individually; per-URL tables cover the first 150,000."}
      </p>
      {isDemo && <DemoNotice className="mt-1" />}
    </Page>
  );
}
