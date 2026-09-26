import { Bot, FileWarning, Gauge, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { listAnalyses } from "@/lib/content/logs/store";
import { AnalysisList } from "@/components/content/logs/analysis-list";
import { LogUploader } from "@/components/content/logs/uploader";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Log File Analyzer" };

const FEATURES = [
  { icon: <Bot className="h-4 w-4" />, title: "Every crawler, identified", text: "Googlebot smartphone and desktop, Bingbot, YandexBot, Baiduspider, Applebot, AI crawlers and SEO tools — with reverse-DNS verification for search engines." },
  { icon: <Gauge className="h-4 w-4" />, title: "Crawl budget waste", text: "How many bot hits go to redirects, errors and parameter URLs instead of pages you want indexed." },
  { icon: <FileWarning className="h-4 w-4" />, title: "Errors bots see", text: "4xx and 5xx responses served to crawlers, when they happened and which bots hit them." },
  { icon: <Sparkles className="h-4 w-4" />, title: "AI crawler activity", text: "GPTBot, ClaudeBot, PerplexityBot, CCBot and others: what they fetch and how often." },
];

export default async function LogFileAnalyzerPage() {
  const user = await requirePageUser();
  const analyses = await listAnalyses(user.id);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "On page & tech SEO" }, { label: "Log File Analyzer", href: "/log-file-analyzer" }]}
        title="Log File Analyzer"
        description="See how search engine and AI bots actually crawl your site: hits, status codes, crawl frequency and wasted crawl budget, straight from your server's access logs."
        meta={<DataSourceBadge source="user" note="your uploaded logs" />}
      />
      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Analyze a log file" description="Files are parsed as they stream in; only aggregates are stored, never the raw lines." />
          <CardBody>
            <LogUploader />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Supported formats" />
          <CardBody className="space-y-3 text-[12.5px] text-text-2">
            <div>
              <div className="mb-1 font-medium text-text">Combined (Apache & Nginx default)</div>
              <code className="block overflow-x-auto rounded bg-surface-3 px-2 py-1.5 font-mono text-[11.5px] whitespace-nowrap text-text">%h %l %u %t &quot;%r&quot; %&gt;s %b &quot;%{"{Referer}"}i&quot; &quot;%{"{User-agent}"}i&quot;</code>
            </div>
            <div>
              <div className="mb-1 font-medium text-text">Common</div>
              <code className="block overflow-x-auto rounded bg-surface-3 px-2 py-1.5 font-mono text-[11.5px] whitespace-nowrap text-text">%h %l %u %t &quot;%r&quot; %&gt;s %b</code>
              <p className="mt-1">Common logs have no user agent, so bots can&apos;t be identified — use Combined when possible.</p>
            </div>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Optional leading virtual host (vhost_combined) and trailing fields (request time) are fine.</li>
              <li>Plain text or gzip (.gz); up to 50 MB per upload.</li>
              <li>Bots are identified by user agent. Search-engine IPs are checked with reverse + forward DNS; others are marked “unverified UA”.</li>
            </ul>
          </CardBody>
        </Card>
      </Grid>
      {analyses.length > 0 ? (
        <Card>
          <CardHeader title="Your analyses" description={`${analyses.length} saved`} />
          <AnalysisList
            rows={analyses.map((a) => ({ id: a.id, name: a.name, origin: a.origin, size: Number(a.size_bytes), lines: a.total_lines, parsed: a.parsed_lines, botHits: a.bot_hits, from: a.date_from, to: a.date_to, created: a.created_at }))}
          />
        </Card>
      ) : (
        <Grid cols={4}>
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardBody className="pt-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-brand-soft text-brand-ink">{f.icon}</div>
                <div className="text-[13.5px] font-semibold">{f.title}</div>
                <p className="mt-1 text-[13px] text-text-2">{f.text}</p>
              </CardBody>
            </Card>
          ))}
        </Grid>
      )}
    </Page>
  );
}
